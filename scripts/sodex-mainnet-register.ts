#!/usr/bin/env tsx
//
// Mainnet auth ceremony, one-shot. Registers SODEX_API_KEY (a NAME) against the
// address derived from SODEX_MAINNET_SIGNING_KEY, signed by the master wallet.
// After this, every signed mainnet write is signed by the registered key and
// attributed via X-API-Key; see docs/sodex-live.md §13.
//
// Order of operations matters (verify-first convention):
//   1. Read the account state UNSIGNED. If the gateway or account is wrong,
//      fail here where nothing is at stake.
//   2. Register the key.
//   3. Read again to confirm the credentials the app will actually use.
//
// This moves no funds. It only authorizes a key that the master can revoke.
//
// Usage: SONAR_EXECUTION_MODE=live-mainnet pnpm tsx scripts/sodex-mainnet-register.ts

import "./_env";
import {
  getAccountState,
  getSignerAddress,
  getMainnetSigningAddress,
  registerApiKey,
} from "@/lib/sodex/client";
import { env } from "@/lib/utils/env";

async function main() {
  const e = env();
  if (e.SONAR_EXECUTION_MODE !== "live-mainnet") {
    console.error(
      `Refusing to run: SONAR_EXECUTION_MODE is "${e.SONAR_EXECUTION_MODE}", expected "live-mainnet".`,
    );
    console.error(
      "Registration is a mainnet-only ceremony. Testnet signs with the master wallet directly.",
    );
    process.exit(1);
  }

  const keyName = e.SODEX_API_KEY;
  if (!keyName) {
    console.error("SODEX_API_KEY (the key NAME to register) is not set.");
    process.exit(1);
  }

  const master = getSignerAddress();
  const signer = getMainnetSigningAddress();

  console.log("SoDEX mainnet API key registration");
  console.log(`  gateway:        ${e.SODEX_MAINNET_BASE_URL}`);
  console.log(`  master wallet:  ${master}   (account owner, signs this request)`);
  console.log(`  registered key: ${signer}   (will sign every write from now on)`);
  console.log(`  key name:       ${keyName}`);
  console.log("");

  if (master.toLowerCase() === signer.toLowerCase()) {
    console.error(
      "Refusing to run: the signing key equals the master wallet. The whole point is",
    );
    console.error(
      "that a leaked write key is revocable without risking the account owner. Generate",
    );
    console.error("a fresh SODEX_MAINNET_SIGNING_KEY.");
    process.exit(1);
  }

  // 1. Unsigned read first. Proves the gateway is reachable and the account exists.
  process.stdout.write("1. getAccountState(perps) unsigned ... ");
  const before = await getAccountState({ kind: "perps" });
  console.log(`OK (aid=${before.aid})`);

  // 2. Register.
  process.stdout.write("2. registerApiKey (signed by master) ... ");
  const result = await registerApiKey({ name: keyName, signerAddress: signer });
  console.log("OK");
  console.log(`   response: ${JSON.stringify(result.raw).slice(0, 300)}`);

  // 3. Read back through the credentials the app will use.
  process.stdout.write("3. getAccountState(perps) post-register ... ");
  const after = await getAccountState({ kind: "perps" });
  console.log(`OK (aid=${after.aid})`);

  console.log("");
  console.log("Registered. The app can now sign mainnet writes with the registered key.");
  console.log("Next: scripts/sodex-auth-smoke.ts, then fund, then queue one order.");
}

main().catch((err) => {
  console.error("");
  console.error("Registration FAILED:", err instanceof Error ? err.message : err);
  console.error("");
  console.error(
    "If the engine named a bad field, fix the shape in registerApiKey (lib/sodex/client.ts)",
  );
  console.error("against docs/sodex-live.md §13 and retry. Nothing was moved.");
  process.exit(1);
});
