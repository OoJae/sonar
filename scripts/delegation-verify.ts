// Wave 3 delegation Phase 2 verification: exercises the real routes + store +
// DB + the executor enforcement assertion, then cleans up its test rows.
// Run (server must be up on :3005): pnpm tsx scripts/delegation-verify.ts
import "./_env";
import { privateKeyToAccount } from "viem/accounts";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getSignerAddress } from "@/lib/sodex/client";
import {
  buildGrantTypedData,
  buildRevokeTypedData,
  usdToMicro,
  type SessionGrant,
  type RevokeGrant,
} from "@/lib/delegation/grant";
import {
  assertOrderDelegated,
  DelegationDeniedError,
} from "@/lib/delegation/store";
import type { OrderRequestInput } from "@/lib/sodex/types";

const BASE = "http://localhost:3005";
// Hardhat well-known test account 1 (the "user" grantor). Disposable.
const GRANTOR_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const NOW = Math.floor(Date.now() / 1000);

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean) {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function grantBody(g: SessionGrant, signature: string) {
  return {
    grantor: g.grantor,
    sessionKey: g.sessionKey,
    allowedMarkets: g.allowedMarkets,
    maxNotionalPerOrder: g.maxNotionalPerOrder.toString(),
    issuedAt: g.issuedAt.toString(),
    expiry: g.expiry.toString(),
    nonce: g.nonce.toString(),
    signature,
  };
}

function order(market: string, notionalUSD: number): OrderRequestInput {
  return {
    thesisId: "00000000-0000-4000-8000-000000000000",
    kind: market.endsWith(".ssi") ? "spot" : "perp",
    market,
    side: "buy",
    type: "market",
    notionalUSD,
  };
}

async function expectDeny(o: OrderRequestInput, reason: string): Promise<boolean> {
  try {
    await assertOrderDelegated(o);
    return false;
  } catch (e) {
    return e instanceof DelegationDeniedError && e.reason === reason;
  }
}
async function expectAllow(o: OrderRequestInput): Promise<boolean> {
  try {
    await assertOrderDelegated(o);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const grantorAcct = privateKeyToAccount(GRANTOR_KEY);
  const grantor = grantorAcct.address;
  const sessionKey = getSignerAddress();
  console.log(`agent session key: ${sessionKey}`);
  console.log(`test grantor:      ${grantor}\n`);

  const grant: SessionGrant = {
    grantor,
    sessionKey,
    allowedMarkets: ["MAG7.ssi", "BTC-PERP"],
    maxNotionalPerOrder: usdToMicro(500),
    issuedAt: BigInt(NOW),
    expiry: BigInt(NOW + 3600),
    nonce: BigInt(NOW),
  };
  const sig = await grantorAcct.signTypedData(buildGrantTypedData(grant));

  console.log("Route: create + validation");
  const r1 = await post("/api/delegation", grantBody(grant, sig));
  check("valid grant -> 200", r1.status === 200 && r1.json.ok === true);
  const grantId = r1.json?.grant?.id as string;

  const r2 = await post("/api/delegation", grantBody(grant, sig));
  check(
    "duplicate re-POST -> 200 same id (idempotent)",
    r2.status === 200 && r2.json?.grant?.id === grantId,
  );

  // Mutate a byte of r (not v: flipping v to an equivalent yParity would still
  // recover the same address), so the signature recovers a different signer.
  const tamperedSig = "0x" + (sig[2] === "0" ? "1" : "0") + sig.slice(3);
  const r3 = await post("/api/delegation", grantBody(grant, tamperedSig));
  check("tampered signature -> 401", r3.status === 401);

  const foreign: SessionGrant = { ...grant, sessionKey: grantor, nonce: BigInt(NOW + 1) };
  const foreignSig = await grantorAcct.signTypedData(buildGrantTypedData(foreign));
  const r4 = await post("/api/delegation", grantBody(foreign, foreignSig));
  check("foreign sessionKey -> 400 session_key_mismatch", r4.status === 400);

  const expiredG: SessionGrant = { ...grant, expiry: BigInt(NOW - 10), nonce: BigInt(NOW + 2) };
  const expiredSig = await grantorAcct.signTypedData(buildGrantTypedData(expiredG));
  const r5 = await post("/api/delegation", grantBody(expiredG, expiredSig));
  check("expired-on-arrival -> 400", r5.status === 400);

  const listRes = await fetch(`${BASE}/api/delegation?grantor=${grantor}`);
  const listJson = await listRes.json();
  const active = (listJson.grants ?? []).find(
    (x: { id: string; status: string }) => x.id === grantId && x.status === "active",
  );
  check("GET lists the active grant", Boolean(active));

  console.log("\nEnforcement (assertOrderDelegated, direct)");
  check("in-scope MAG7.ssi $200 -> allowed", await expectAllow(order("MAG7.ssi", 200)));
  check(
    "out-of-market SOL-PERP -> market_out_of_scope",
    await expectDeny(order("SOL-PERP", 100), "market_out_of_scope"),
  );
  check(
    "over-notional MAG7.ssi $600 -> notional_exceeds_grant",
    await expectDeny(order("MAG7.ssi", 600), "notional_exceeds_grant"),
  );
  check(
    "BTC-USD $100 -> allowed (canonical BTC-PERP)",
    await expectAllow(order("BTC-USD", 100)),
  );

  console.log("\nRevoke");
  const revoke: RevokeGrant = { grantId, grantor, issuedAt: BigInt(NOW) };
  const revokeSig = await grantorAcct.signTypedData(buildRevokeTypedData(revoke));
  const rv = await post("/api/delegation/revoke", {
    grantId,
    grantor,
    issuedAt: revoke.issuedAt.toString(),
    signature: revokeSig,
  });
  check("signed revoke -> 200", rv.status === 200 && rv.json?.grant?.status === "revoked");
  check(
    "after revoke, no active grant -> no_active_grant",
    await expectDeny(order("MAG7.ssi", 200), "no_active_grant"),
  );

  console.log("\nRate limit (isolated bucket)");
  let saw429 = false;
  for (let i = 0; i < 25; i++) {
    const rr = await post("/api/delegation", "{}", { "x-real-ip": "rl-verify-bucket" });
    if (rr.status === 429) saw429 = true;
  }
  check("burst trips 429", saw429);

  // Cleanup: remove the test grantor's rows so the table stays clean.
  await db()
    .delete(schema.delegations)
    .where(eq(schema.delegations.grantor, grantor.toLowerCase()));
  const remaining = await db()
    .select()
    .from(schema.delegations)
    .where(eq(schema.delegations.grantor, grantor.toLowerCase()));
  check("cleanup removed test rows", remaining.length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
