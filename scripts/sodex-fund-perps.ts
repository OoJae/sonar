#!/usr/bin/env tsx
//
// One-shot helper: transfer vUSDC from the agent wallet's spot sub-account to
// its perps sub-account so live-testnet orders have margin. The SoDEX testnet
// faucet only funds spot; perps starts empty.
//
// Usage:
//   pnpm tsx scripts/sodex-fund-perps.ts          # default 100 vUSDC
//   pnpm tsx scripts/sodex-fund-perps.ts 250      # custom amount in vUSDC
//
// After this runs successfully, scripts/sodex-live-smoke.ts produces a real
// BTC-PERP fill instead of `insufficient margin`.

import "./_env";
import { transferSpotToPerps, getSignerAddress } from "@/lib/sodex/client";

async function main() {
  const arg = process.argv[2];
  const amount = arg ?? "100";
  // Reject obvious garbage early.
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    console.error(`Invalid amount "${amount}". Pass a positive decimal.`);
    process.exit(2);
  }

  console.log(`Signer: ${getSignerAddress()}`);
  console.log(`Transferring ${amount} vUSDC: spot -> perps ...`);

  try {
    const result = await transferSpotToPerps({ amountUSD: amount });
    console.log("OK");
    console.log(JSON.stringify(result.raw, null, 2).slice(0, 600));
  } catch (err) {
    console.error("FAIL:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
