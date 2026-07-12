import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/utils/env";
import { allowRequest, parseRateLimit } from "@/lib/utils/ratelimit";
import { logger } from "@/lib/utils/logger";
import {
  createGrant,
  listGrantsForGrantor,
  toGrantView,
  GrantValidationError,
} from "@/lib/delegation/store";
import type { SessionGrant } from "@/lib/delegation/grant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// User-signed grant routes. The EIP-712 signature is the auth; these never read
// or return CRON_SECRET or the private key. Rate-limited per IP.
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Uint = z.string().regex(/^\d+$/);
const SigSchema = z.string().regex(/^0x[0-9a-fA-F]{130}$/);

const GrantBody = z.object({
  grantor: AddressSchema,
  sessionKey: AddressSchema,
  allowedMarkets: z.array(z.string().min(1)).min(1).max(20),
  maxNotionalPerOrder: Uint, // USD * 1e6
  issuedAt: Uint,
  expiry: Uint,
  nonce: Uint,
  signature: SigSchema,
});

function clientIp(request: Request): string {
  return (
    request.headers.get("x-real-ip")?.trim() ??
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
    "unknown"
  );
}

export async function POST(request: Request) {
  const e = env();
  const { count, windowSec } = parseRateLimit(e.SONAR_DELEGATION_RATELIMIT);
  const ip = clientIp(request);
  if (!(await allowRequest(`deleg:ip:${ip}`, count, windowSec))) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(windowSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const parsed = GrantBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.issues.slice(0, 4) },
      { status: 400 },
    );
  }
  const b = parsed.data;

  // Reconstruct the grant server-side from the fields (do not trust a client
  // typed-data blob), so the signature covers exactly what we store.
  const grant: SessionGrant = {
    grantor: b.grantor as `0x${string}`,
    sessionKey: b.sessionKey as `0x${string}`,
    allowedMarkets: b.allowedMarkets,
    maxNotionalPerOrder: BigInt(b.maxNotionalPerOrder),
    issuedAt: BigInt(b.issuedAt),
    expiry: BigInt(b.expiry),
    nonce: BigInt(b.nonce),
  };

  try {
    const row = await createGrant(grant, b.signature as `0x${string}`);
    logger.info("delegation.granted", {
      id: row.id,
      grantor: row.grantor,
      markets: row.allowedMarkets,
    });
    return NextResponse.json({ ok: true, grant: toGrantView(row) });
  } catch (err) {
    if (err instanceof GrantValidationError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.status },
      );
    }
    logger.error("delegation.grant_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const grantor = url.searchParams.get("grantor");
  if (!grantor || !AddressSchema.safeParse(grantor).success) {
    return NextResponse.json(
      { ok: false, error: "grantor query param (0x address) required" },
      { status: 400 },
    );
  }
  try {
    const rows = await listGrantsForGrantor(grantor);
    return NextResponse.json({ ok: true, grants: rows.map(toGrantView) });
  } catch (err) {
    logger.error("delegation.list_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
