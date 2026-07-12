// Wave 3 session-key delegation: persistence + enforcement.
//
// Verifies user-signed EIP-712 grants, stores them, and answers the executor's
// question "is this order covered by an active grant to the agent session key?".
// No "server-only" import so scripts/routes can share it. All addresses stored
// lowercased and compared checksum-insensitively.

import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { DelegationRow } from "@/lib/db/schema";
import { getSignerAddress } from "@/lib/sodex/client";
import type { OrderRequestInput } from "@/lib/sodex/types";
import {
  CANONICAL_MARKETS,
  SESSION_GRANT_DOMAIN,
  canonicalMarket,
  grantScopeCovers,
  microToUsd,
  usdToMicro,
  verifyGrantSignature,
  verifyRevokeSignature,
  type ScopeDenyReason,
  type SessionGrant,
  type RevokeGrant,
} from "./grant";

const MAX_TTL_SEC = 30 * 24 * 3600; // grants may not run longer than 30 days
const ABSURD_CEILING_MICRO = usdToMicro(1_000_000_000); // $1B sanity ceiling
const CANONICAL_SET = new Set<string>(CANONICAL_MARKETS);

// Thrown by createGrant/revokeGrant with an HTTP status the route maps directly.
export class GrantValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "GrantValidationError";
    this.status = status;
  }
}

// Thrown by assertOrderDelegated when enforcement is on and no active grant
// covers the order. reason is machine-readable for the runner logs.
export type DenyReason = "no_active_grant" | ScopeDenyReason;
export class DelegationDeniedError extends Error {
  reason: DenyReason;
  constructor(reason: DenyReason) {
    super(`delegation_denied: ${reason}`);
    this.name = "DelegationDeniedError";
    this.reason = reason;
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// Reconstruct the enforceable scope of a stored grant. maxNotional round-trips
// through USD; enforcement only needs markets, notional, expiry.
function rowToGrant(row: DelegationRow): SessionGrant {
  return {
    grantor: row.grantor as `0x${string}`,
    sessionKey: row.sessionKey as `0x${string}`,
    allowedMarkets: row.allowedMarkets as string[],
    maxNotionalPerOrder: usdToMicro(Number(row.maxNotionalPerOrderUsd)),
    issuedAt: BigInt(Math.floor(row.signedAt.getTime() / 1000)),
    expiry: BigInt(Math.floor(row.expiresAt.getTime() / 1000)),
    nonce: BigInt(row.nonce),
  };
}

// A public view (no signature leakage needed, but the sig is not secret; we omit
// it from list responses for compactness and to keep payloads small).
export type GrantView = {
  id: string;
  grantor: string;
  sessionKey: string;
  allowedMarkets: string[];
  maxNotionalPerOrderUsd: number;
  chainId: number;
  signedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  supersededAt: string | null;
  status: "active" | "revoked" | "superseded" | "expired";
};

function statusOf(row: DelegationRow): GrantView["status"] {
  if (row.revokedAt) return "revoked";
  if (row.supersededAt) return "superseded";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
}

export function toGrantView(row: DelegationRow): GrantView {
  return {
    id: row.id,
    grantor: row.grantor,
    sessionKey: row.sessionKey,
    allowedMarkets: row.allowedMarkets as string[],
    maxNotionalPerOrderUsd: Number(row.maxNotionalPerOrderUsd),
    chainId: row.chainId,
    signedAt: row.signedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
    status: statusOf(row),
  };
}

// Verify a signed grant, sanity-check its scope, supersede the grantor's prior
// active grant to the same session key, and store it. Idempotent on signature.
export async function createGrant(
  g: SessionGrant,
  signature: `0x${string}`,
): Promise<DelegationRow> {
  if (!(await verifyGrantSignature(g, signature))) {
    throw new GrantValidationError("invalid_signature", 401);
  }

  // The grant must authorize THIS agent's session key, or it can never apply.
  let sessionKey: string;
  try {
    sessionKey = getSignerAddress().toLowerCase();
  } catch {
    throw new GrantValidationError("agent_session_key_unavailable", 503);
  }
  if (g.sessionKey.toLowerCase() !== sessionKey) {
    throw new GrantValidationError("session_key_mismatch", 400);
  }

  const now = nowSec();
  if (g.expiry <= BigInt(now)) {
    throw new GrantValidationError("expired_on_arrival", 400);
  }
  if (g.expiry > BigInt(now + MAX_TTL_SEC)) {
    throw new GrantValidationError("expiry_too_far", 400);
  }
  if (g.allowedMarkets.length === 0) {
    throw new GrantValidationError("empty_scope", 400);
  }
  for (const m of g.allowedMarkets) {
    if (!CANONICAL_SET.has(canonicalMarket(m))) {
      throw new GrantValidationError(`unknown_market:${m}`, 400);
    }
  }
  if (g.maxNotionalPerOrder <= 0n || g.maxNotionalPerOrder > ABSURD_CEILING_MICRO) {
    throw new GrantValidationError("notional_out_of_bounds", 400);
  }

  const grantor = g.grantor.toLowerCase();
  const values = {
    grantor,
    sessionKey,
    allowedMarkets: g.allowedMarkets,
    maxNotionalPerOrderUsd: String(microToUsd(g.maxNotionalPerOrder)),
    chainId: Number(SESSION_GRANT_DOMAIN.chainId ?? 8453),
    nonce: g.nonce.toString(),
    signature,
    signedAt: new Date(Number(g.issuedAt) * 1000),
    expiresAt: new Date(Number(g.expiry) * 1000),
  };

  return db().transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.delegations)
      .values(values)
      .onConflictDoNothing({ target: schema.delegations.signature })
      .returning();

    if (inserted.length === 0) {
      // Duplicate signature: idempotent no-op, return the existing row.
      const [existing] = await tx
        .select()
        .from(schema.delegations)
        .where(eq(schema.delegations.signature, signature))
        .limit(1);
      return existing!;
    }

    const row = inserted[0]!;
    // Supersede the grantor's other active grants to this session key.
    await tx
      .update(schema.delegations)
      .set({ supersededAt: new Date(), supersededBy: row.id })
      .where(
        and(
          eq(schema.delegations.grantor, grantor),
          eq(schema.delegations.sessionKey, sessionKey),
          ne(schema.delegations.id, row.id),
          isNull(schema.delegations.revokedAt),
          isNull(schema.delegations.supersededAt),
          gt(schema.delegations.expiresAt, new Date()),
        ),
      );
    return row;
  });
}

export async function listGrantsForGrantor(
  grantor: string,
): Promise<DelegationRow[]> {
  return db()
    .select()
    .from(schema.delegations)
    .where(eq(schema.delegations.grantor, grantor.toLowerCase()))
    .orderBy(desc(schema.delegations.createdAt));
}

export async function activeGrantsForSessionKey(
  sessionKey: string,
): Promise<DelegationRow[]> {
  return db()
    .select()
    .from(schema.delegations)
    .where(
      and(
        eq(schema.delegations.sessionKey, sessionKey.toLowerCase()),
        isNull(schema.delegations.revokedAt),
        isNull(schema.delegations.supersededAt),
        gt(schema.delegations.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.delegations.createdAt));
}

export async function findGrantById(
  id: string,
): Promise<DelegationRow | null> {
  const [row] = await db()
    .select()
    .from(schema.delegations)
    .where(eq(schema.delegations.id, id))
    .limit(1);
  return row ?? null;
}

// Verify a signed revoke and mark the grant revoked. Idempotent.
export async function revokeGrant(
  r: RevokeGrant,
  signature: `0x${string}`,
): Promise<DelegationRow> {
  if (!(await verifyRevokeSignature(r, signature))) {
    throw new GrantValidationError("invalid_signature", 401);
  }
  const row = await findGrantById(r.grantId);
  if (!row) throw new GrantValidationError("grant_not_found", 404);
  if (row.grantor !== r.grantor.toLowerCase()) {
    throw new GrantValidationError("not_grant_owner", 403);
  }
  if (row.revokedAt) return row; // already revoked, idempotent

  const [updated] = await db()
    .update(schema.delegations)
    .set({ revokedAt: new Date(), revokeSignature: signature })
    .where(eq(schema.delegations.id, row.id))
    .returning();
  return updated!;
}

// Enforcement: does an active grant to the agent session key cover this order?
// Throws DelegationDeniedError with a precise reason if not. Called from the
// executor only when SONAR_REQUIRE_DELEGATION is on (fail-closed).
export async function assertOrderDelegated(
  req: OrderRequestInput,
): Promise<void> {
  const sessionKey = getSignerAddress();
  const active = await activeGrantsForSessionKey(sessionKey);
  if (active.length === 0) throw new DelegationDeniedError("no_active_grant");

  const order = { market: req.market, notionalUSD: req.notionalUSD };
  const now = nowSec();
  let sawMarketMatch = false;
  for (const row of active) {
    const res = grantScopeCovers(rowToGrant(row), order, now);
    if (res.ok) return; // covered
    if (res.reason === "notional_exceeds_grant") sawMarketMatch = true;
  }
  // No active grant covered it. Prefer the more specific reason.
  throw new DelegationDeniedError(
    sawMarketMatch ? "notional_exceeds_grant" : "market_out_of_scope",
  );
}
