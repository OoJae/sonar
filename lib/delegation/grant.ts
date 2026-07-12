// Wave 3 session-key delegation: the EIP-712 "SessionGrant" scheme.
//
// A user connects their wallet and signs a scoped, expiring, revocable grant
// authorizing the agent's session key (the executor signer address) to trade a
// bounded set of markets up to a per-order notional. Sonar verifies the
// signature server-side and enforces the scope at the single executor
// chokepoint. This is an application-level authorization artifact: the SoDEX
// venue does not see or verify it. The design maps 1:1 onto an on-chain
// session-key module (ERC-4337 / ERC-7715 style) for mainnet.
//
// This module is pure crypto + scope logic (no DB, no network, no "server-only")
// so it can be exercised by scripts and reused on both the client (rebuild the
// same typed data to sign) and the server (recover + verify).

import {
  recoverTypedDataAddress,
  getAddress,
  type TypedDataDomain,
} from "viem";

// Fixed domain. The grant is verified server-side and never submitted to any
// chain or contract, so chainId here is purely a domain separator. Base (8453)
// is where the user's wallet and SSI assets live, minimizing the wallet's
// "wrong network" warning at signing time. No verifyingContract/salt: there is
// no on-chain contract to bind to.
export const SESSION_GRANT_DOMAIN: TypedDataDomain = {
  name: "Sonar Session Delegation",
  version: "1",
  chainId: 8453,
};

// Only fields that are actually enforced are signed.
export const SESSION_GRANT_TYPES = {
  SessionGrant: [
    { name: "grantor", type: "address" },
    { name: "sessionKey", type: "address" },
    { name: "allowedMarkets", type: "string[]" },
    { name: "maxNotionalPerOrder", type: "uint256" }, // USD * 1e6
    { name: "issuedAt", type: "uint256" }, // unix seconds
    { name: "expiry", type: "uint256" }, // unix seconds
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const REVOKE_GRANT_TYPES = {
  RevokeGrant: [
    { name: "grantId", type: "string" },
    { name: "grantor", type: "address" },
    { name: "issuedAt", type: "uint256" },
  ],
} as const;

export type SessionGrant = {
  grantor: `0x${string}`;
  sessionKey: `0x${string}`;
  allowedMarkets: string[];
  maxNotionalPerOrder: bigint; // USD * 1e6
  issuedAt: bigint;
  expiry: bigint;
  nonce: bigint;
};

export type RevokeGrant = {
  grantId: string;
  grantor: `0x${string}`;
  issuedAt: bigint;
};

// The canonical executor-entry market vocabulary. Grant scope is checked against
// the string that reaches lib/sodex/executor.ts placeOrder, which is the Sonar
// market string (not the SoDEX symbol). SSI legs route to paper; PERP legs to
// the live venue.
export const CANONICAL_MARKETS = [
  "MAG7.ssi",
  "DEFI.ssi",
  "MEME.ssi",
  "BTC-PERP",
  "ETH-PERP",
  "SOL-PERP",
] as const;

// The delta-neutral strategy places its short as "BTC-USD"; directional hedges
// use "BTC-PERP". Collapse the venue-symbol spelling onto the canonical perp
// token so a "BTC-PERP" grant covers the delta-neutral "BTC-USD" short.
const MARKET_ALIASES: Record<string, string> = {
  "BTC-USD": "BTC-PERP",
  "ETH-USD": "ETH-PERP",
  "SOL-USD": "SOL-PERP",
};

export function canonicalMarket(market: string): string {
  return MARKET_ALIASES[market] ?? market;
}

// USD <-> 1e6-scaled micro-USD helpers (the app's 6-decimal USDC convention).
export function usdToMicro(usd: number): bigint {
  return BigInt(Math.floor(usd * 1e6));
}

export function microToUsd(micro: bigint): number {
  return Number(micro) / 1e6;
}

export function buildGrantTypedData(g: SessionGrant) {
  return {
    domain: SESSION_GRANT_DOMAIN,
    types: SESSION_GRANT_TYPES,
    primaryType: "SessionGrant" as const,
    message: {
      grantor: g.grantor,
      sessionKey: g.sessionKey,
      allowedMarkets: g.allowedMarkets,
      maxNotionalPerOrder: g.maxNotionalPerOrder,
      issuedAt: g.issuedAt,
      expiry: g.expiry,
      nonce: g.nonce,
    },
  };
}

export function buildRevokeTypedData(r: RevokeGrant) {
  return {
    domain: SESSION_GRANT_DOMAIN,
    types: REVOKE_GRANT_TYPES,
    primaryType: "RevokeGrant" as const,
    message: {
      grantId: r.grantId,
      grantor: r.grantor,
      issuedAt: r.issuedAt,
    },
  };
}

// Case-insensitive address equality via checksum normalization.
function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

export async function recoverGrantSigner(
  g: SessionGrant,
  signature: `0x${string}`,
): Promise<`0x${string}`> {
  return recoverTypedDataAddress({ ...buildGrantTypedData(g), signature });
}

export async function verifyGrantSignature(
  g: SessionGrant,
  signature: `0x${string}`,
): Promise<boolean> {
  try {
    const recovered = await recoverGrantSigner(g, signature);
    return sameAddress(recovered, g.grantor);
  } catch {
    return false;
  }
}

export async function verifyRevokeSignature(
  r: RevokeGrant,
  signature: `0x${string}`,
): Promise<boolean> {
  try {
    const recovered = await recoverTypedDataAddress({
      ...buildRevokeTypedData(r),
      signature,
    });
    return sameAddress(recovered, r.grantor);
  } catch {
    return false;
  }
}

export type ScopeDenyReason =
  | "market_out_of_scope"
  | "notional_exceeds_grant"
  | "expired";

// Does this grant cover this order at this moment? Expiry, then market
// membership (canonicalized on both sides), then per-order notional.
export function grantScopeCovers(
  g: SessionGrant,
  order: { market: string; notionalUSD: number },
  nowSec: number,
): { ok: true } | { ok: false; reason: ScopeDenyReason } {
  if (BigInt(Math.floor(nowSec)) >= g.expiry) {
    return { ok: false, reason: "expired" };
  }
  const wanted = canonicalMarket(order.market);
  const allowed = g.allowedMarkets.map(canonicalMarket);
  if (!allowed.includes(wanted)) {
    return { ok: false, reason: "market_out_of_scope" };
  }
  if (usdToMicro(order.notionalUSD) > g.maxNotionalPerOrder) {
    return { ok: false, reason: "notional_exceeds_grant" };
  }
  return { ok: true };
}
