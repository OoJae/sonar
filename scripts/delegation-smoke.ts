// Wave 3 delegation spike: proves the EIP-712 SessionGrant sign -> verify ->
// scope roundtrip with a viem test key. No DB, no network, no file writes.
// Run: pnpm tsx scripts/delegation-smoke.ts
import "./_env";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildGrantTypedData,
  buildRevokeTypedData,
  verifyGrantSignature,
  verifyRevokeSignature,
  grantScopeCovers,
  usdToMicro,
  type SessionGrant,
  type RevokeGrant,
} from "@/lib/delegation/grant";

// Hardhat well-known test account 0. Disposable, never used for anything real.
const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const NOW = 1_800_000_000; // fixed reference instant (year 2027) for determinism

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}`);
  }
}

async function main() {
  const account = privateKeyToAccount(TEST_KEY);
  const grantor = account.address;
  const sessionKey =
    "0x00000000000000000000000000000000000000a1" as `0x${string}`;

  const grant: SessionGrant = {
    grantor,
    sessionKey,
    allowedMarkets: ["MAG7.ssi", "BTC-PERP"],
    maxNotionalPerOrder: usdToMicro(500),
    issuedAt: BigInt(NOW),
    expiry: BigInt(NOW + 24 * 3600),
    nonce: BigInt(NOW),
  };

  const signature = await account.signTypedData(buildGrantTypedData(grant));

  console.log("Signature + verification");
  check("valid grant verifies", await verifyGrantSignature(grant, signature));
  const tampered: SessionGrant = {
    ...grant,
    maxNotionalPerOrder: usdToMicro(5_000_000),
  };
  check(
    "tampered field fails verification",
    !(await verifyGrantSignature(tampered, signature)),
  );
  check(
    "signature from a different grantor fails",
    !(await verifyGrantSignature(
      { ...grant, grantor: sessionKey },
      signature,
    )),
  );

  console.log("Scope coverage");
  check(
    "in-scope order (MAG7.ssi, $200) is covered",
    grantScopeCovers(grant, { market: "MAG7.ssi", notionalUSD: 200 }, NOW).ok,
  );
  const outOfMarket = grantScopeCovers(
    grant,
    { market: "SOL-PERP", notionalUSD: 100 },
    NOW,
  );
  check(
    "out-of-market order -> market_out_of_scope",
    !outOfMarket.ok && outOfMarket.reason === "market_out_of_scope",
  );
  const overNotional = grantScopeCovers(
    grant,
    { market: "MAG7.ssi", notionalUSD: 501 },
    NOW,
  );
  check(
    "over-notional order -> notional_exceeds_grant",
    !overNotional.ok && overNotional.reason === "notional_exceeds_grant",
  );
  const expired = grantScopeCovers(
    grant,
    { market: "MAG7.ssi", notionalUSD: 100 },
    NOW + 48 * 3600,
  );
  check(
    "past-expiry check -> expired",
    !expired.ok && expired.reason === "expired",
  );
  check(
    "BTC-USD order is covered by a BTC-PERP grant (canonicalization)",
    grantScopeCovers(grant, { market: "BTC-USD", notionalUSD: 100 }, NOW).ok,
  );

  console.log("Revoke");
  const revoke: RevokeGrant = {
    grantId: "11111111-1111-4111-8111-111111111111",
    grantor,
    issuedAt: BigInt(NOW),
  };
  const revokeSig = await account.signTypedData(buildRevokeTypedData(revoke));
  check(
    "valid revoke verifies",
    await verifyRevokeSignature(revoke, revokeSig),
  );
  check(
    "revoke bound to a different grantor fails",
    !(await verifyRevokeSignature({ ...revoke, grantor: sessionKey }, revokeSig)),
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
