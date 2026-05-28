#!/usr/bin/env tsx
//
// Phase 2.1 auth smoke. The single most important test before any order
// code is written: confirm a SIGNED READ endpoint works end to end.
// Signing bugs are silent and maddening; isolating them after a failed
// order submit wastes hours.
//
// What this exercises:
//   1. SODEX_WALLET_PRIVATE_KEY loads and viem derives the address.
//   2. EIP-712 typed-data signature against ExchangeAction parses correctly
//      on the SoDEX testnet gateway.
//   3. X-API-Sign + X-API-Nonce + X-API-Chain header trio is accepted.
//   4. The response unwraps and the aid field surfaces.
//
// On success: prints address + aid for both perps and spot accounts.
// On 401: logs request shape (never the secret) for debugging.

import "./_env";
import { getAccountState, getSignerAddress } from "@/lib/sodex/client";

async function main() {
  const address = getSignerAddress();
  console.log(`Signer address:        ${address}`);
  console.log("");

  for (const kind of ["perps", "spot"] as const) {
    process.stdout.write(`getAccountState(${kind}) ... `);
    try {
      const state = await getAccountState({ kind });
      console.log(`OK (aid=${state.aid})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAIL: ${msg.slice(0, 300)}`);
    }
  }
}

main().catch((err) => {
  console.error("Smoke FAIL:", err);
  process.exit(1);
});
