# Session-key delegation (Wave 3)

Sonar is non-custodial by design: the agent acts under a scoped session approval,
not custody of user funds. This document describes what the delegation layer does,
and, importantly, what it does not do, so the claim is not overstated.

## The grant

A user connects their wallet on `/delegation` and signs an EIP-712 `SessionGrant`:

| Field | Meaning |
|---|---|
| `grantor` | the user's wallet address (the signer) |
| `sessionKey` | the agent's session key (the executor signer address) |
| `allowedMarkets` | the markets the agent may trade (MAG7.ssi, DEFI.ssi, MEME.ssi, BTC-PERP, ETH-PERP, SOL-PERP) |
| `maxNotionalPerOrder` | per-order size ceiling, USD * 1e6 |
| `issuedAt` / `expiry` | validity window (up to 30 days) |
| `nonce` | uniqueness / revocability |

Domain: `{ name: "Sonar Session Delegation", version: "1", chainId: 8453 }`. The
grant is verified server-side and never submitted to any chain, so `chainId` is a
domain separator only; Base is used because the user's wallet and SSI assets live
there. The scheme lives in `lib/delegation/grant.ts` (pure, reusable client and
server).

## Verify, store, revoke

`POST /api/delegation` recovers the signer, confirms it matches `grantor`,
sanity-checks the scope (expiry in the future and within 30 days, markets known,
notional positive, `sessionKey` equal to the running agent), then stores it
(`lib/delegation/store.ts`, `delegations` table). Re-signing supersedes the prior
active grant for that `(grantor, sessionKey)`; a signed `RevokeGrant`
(`POST /api/delegation/revoke`) ends it. The signature is the auth on both routes:
they never read `CRON_SECRET` or the private key, and they are rate-limited per IP.
A duplicate re-POST is idempotent (unique `signature`).

## Enforcement

When `SONAR_REQUIRE_DELEGATION=true`, the executor checks, at the top of
`placeOrder` (before the paper/live switch, on the raw Sonar market string), that
an active grant to the agent session key covers the order's market and size. Out
of scope means the order is blocked before anything is placed, with a precise
reason. The existing risk gate (per-order and per-cycle notional caps) still
applies on top, so the effective per-order spend is the smaller of the grant and
the system cap. The check fails closed (a DB error blocks the order). The flag is
off by default, so the autonomous cron trades under operator authority unchanged
until the flag is flipped for a demo.

## Honest scope

Enforcement is at the application layer. The SoDEX venue does not see or verify the
grant; Sonar enforces it. The signed grant is the verifiable authorization
artifact, and the same design maps directly onto an on-chain session-key module
(ERC-4337 / ERC-7715 style) for mainnet, where the venue itself would enforce the
scope. It is not trustless on-chain enforcement today. Grants are EOA-signed;
smart-wallet (ERC-1271) grantors are a known future extension, not built.

## Verification

- `pnpm tsx scripts/delegation-smoke.ts` (pure crypto: sign/verify/scope, 10/10).
- `pnpm tsx scripts/delegation-verify.ts` (routes + store + enforcement + revoke +
  rate limit against the live DB, 14/14; cleans up its test rows).
