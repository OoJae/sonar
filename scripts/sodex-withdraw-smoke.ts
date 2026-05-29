#!/usr/bin/env tsx
//
// Wave 2 funding-pivot smoke. Withdraws a tiny amount of vUSDC from the SoDEX
// spot ledger to the agent wallet's on-chain ValueChain address, then reports
// the before/after balances on both sides.
//
// This is the cross-chain funding path the SoSoValue team confirmed: there is
// no testnet bridge, so an on-chain ValueChain balance comes from a SoDEX
// withdrawal. The withdrawal params (type=EVM_WITHDRAW, toAccountID) are
// UNCONFIRMED in the docs; this smoke is where they get pinned down, the same
// way the spot->perps magic 999 / type=3 were discovered.
//
// Usage:
//   pnpm tsx scripts/sodex-withdraw-smoke.ts        # default 5 vUSDC
//   pnpm tsx scripts/sodex-withdraw-smoke.ts 10     # custom amount

import "./_env";
import { createPublicClient, http, formatUnits, getAddress } from "viem";
import { getSignerAddress, getVenueVusdc, withdrawVusdcToOnchain } from "@/lib/sodex/client";
import { env } from "@/lib/utils/env";

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function onchainVusdc(): Promise<string> {
  const e = env();
  if (!e.VALUECHAIN_USDC_ADDRESS) return "n/a (VALUECHAIN_USDC_ADDRESS unset)";
  const client = createPublicClient({
    chain: {
      id: 138565,
      name: "ValueChain Testnet",
      nativeCurrency: { name: "Soso", symbol: "tSOSO", decimals: 18 },
      rpcUrls: { default: { http: [e.VALUECHAIN_RPC_URL] } },
    },
    transport: http(e.VALUECHAIN_RPC_URL),
  });
  const raw = await client.readContract({
    address: getAddress(e.VALUECHAIN_USDC_ADDRESS) as `0x${string}`,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [getSignerAddress()],
  });
  return formatUnits(raw, 6);
}

async function main() {
  const amount = process.argv[2] ?? "5";
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    console.error(`Invalid amount "${amount}". Pass a positive decimal.`);
    process.exit(2);
  }

  console.log(`Signer: ${getSignerAddress()}`);
  console.log(`Withdraw amount: ${amount} vUSDC`);
  console.log("");

  const venueBefore = await getVenueVusdc();
  const onchainBefore = await onchainVusdc();
  console.log("=== Before ===");
  console.log(`  SoDEX spot ledger: ${venueBefore.spot} vUSDC`);
  console.log(`  on-chain wallet:   ${onchainBefore} vUSDC`);
  console.log("");

  console.log("=== Withdrawing ===");
  try {
    const res = await withdrawVusdcToOnchain({ amountUSD: amount });
    console.log("  OK");
    console.log("  " + JSON.stringify(res.raw).slice(0, 300));
  } catch (err) {
    console.log("  FAIL: " + (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
  console.log("");

  // On-chain settlement may lag a block; read venue immediately, on-chain after a moment.
  const venueAfter = await getVenueVusdc();
  const onchainAfter = await onchainVusdc();
  console.log("=== After ===");
  console.log(`  SoDEX spot ledger: ${venueAfter.spot} vUSDC (was ${venueBefore.spot})`);
  console.log(`  on-chain wallet:   ${onchainAfter} vUSDC (was ${onchainBefore})`);
  console.log("");

  const spotDropped = Number(venueAfter.spot) < Number(venueBefore.spot);
  console.log(
    `  spot ledger decreased: ${spotDropped ? "PASS" : "PENDING (settlement may lag; re-check on-chain shortly)"}`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Smoke FAIL:", err);
  process.exit(1);
});
