#!/usr/bin/env tsx
//
// Flatten open perp positions by submitting the opposite market order for each.
//
// Why this exists: the position caps (risk.ts layer 4) bound the book going
// forward, but they cannot unwind a book that already breached them. On
// 2026-07-16 the testnet account held 0.234 BTC short + 2.12 ETH short +
// 6.049 SOL long (~$18.8k gross at 20x on a $1.5k account, ~-$766 unrealized),
// which exhausted margin and made every new order fail with "insufficient
// margin". This is the one-shot cleanup for that state.
//
// Safety:
//   - Dry run by default. Pass --execute to actually submit.
//   - Only ever REDUCES: each order is the exact opposite side and size of an
//     open position, so the risk gate's reducing-order path lets it through
//     at full size (a cap that blocked a close would trap the book).
//   - Refuses to run on live-mainnet. Mainnet closes go through the
//     human-approval path (POST /api/orders/approve), never a bulk script.
//
// Usage:
//   pnpm tsx scripts/sodex-flatten.ts            # dry run, prints the plan
//   pnpm tsx scripts/sodex-flatten.ts --execute  # submit the closing orders

import "./_env";
import { getAccountState, submitPerpOrder, getPerpSymbolInfo } from "@/lib/sodex/client";
import { env } from "@/lib/utils/env";

const EXECUTE = process.argv.includes("--execute");

function priceOf(p: Record<string, unknown>): number {
  const mark = Number(p.cp ?? 0);
  const entry = Number(p.ep ?? 0);
  return Number.isFinite(mark) && mark > 0 ? mark : entry;
}

async function main() {
  const mode = env().SONAR_EXECUTION_MODE;
  if (mode === "live-mainnet") {
    console.error(
      "Refusing to run on live-mainnet: closes there go through the approval endpoint, not a bulk script.",
    );
    process.exit(1);
  }
  if (mode === "paper") {
    console.error("Nothing to flatten: mode is paper (no venue positions).");
    process.exit(1);
  }

  const state = (await getAccountState({ kind: "perps" })) as unknown as {
    P?: Array<Record<string, unknown>>;
  };
  const positions = (state.P ?? []).filter((p) => Number(p.sz ?? 0) !== 0);

  if (positions.length === 0) {
    console.log("Book is already flat. Nothing to do.");
    return;
  }

  console.log(`Mode: ${mode}`);
  console.log(`${EXECUTE ? "EXECUTING" : "DRY RUN (pass --execute to submit)"}`);
  console.log("");

  let gross = 0;
  const plan: Array<{ symbol: string; side: "buy" | "sell"; qty: number }> = [];
  for (const p of positions) {
    const symbol = String(p.s);
    const size = Number(p.sz);
    const px = priceOf(p);
    const notional = Math.abs(size) * px;
    gross += notional;
    // Opposite side closes it: a short (negative size) is closed by buying.
    const side: "buy" | "sell" = size < 0 ? "buy" : "sell";
    plan.push({ symbol, side, qty: Math.abs(size) });
    console.log(
      `  ${symbol.padEnd(9)} size=${String(size).padEnd(10)} ~$${notional.toFixed(2).padStart(10)} ur=${String(p.ur ?? "?").slice(0, 10).padStart(11)}  ->  ${side} ${Math.abs(size)}`,
    );
  }
  console.log("");
  console.log(`  gross notional: $${gross.toFixed(2)}`);
  console.log("");

  if (!EXECUTE) {
    console.log("Dry run only. Re-run with --execute to submit these closes.");
    return;
  }

  for (const leg of plan) {
    process.stdout.write(`  ${leg.side} ${leg.qty} ${leg.symbol} ... `);
    try {
      // Step-align the quantity to the venue's rules, or it rejects with
      // "quantity is invalid" (seen 2026-07-12). Market SELLs in particular
      // must carry a quantity, not funds.
      const info = await getPerpSymbolInfo(leg.symbol);
      const precision = info?.quantityPrecision ?? 3;
      const qty = leg.qty.toFixed(precision);
      const res = await submitPerpOrder({
        symbolName: leg.symbol,
        side: leg.side,
        type: "market",
        quantity: qty,
        // Mandatory here: without it the engine margins the close as new
        // exposure and rejects it ("insufficient margin"), which is exactly
        // the trap this script exists to escape.
        reduceOnly: true,
        clOrdID: `flat-${Date.now().toString(16)}-${leg.symbol.slice(0, 3).toLowerCase()}`,
      });
      console.log(`OK (${JSON.stringify(res).slice(0, 120)})`);
    } catch (err) {
      console.log(`FAIL: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    }
  }

  console.log("");
  const after = (await getAccountState({ kind: "perps" })) as unknown as {
    P?: Array<Record<string, unknown>>;
  };
  const left = (after.P ?? []).filter((p) => Number(p.sz ?? 0) !== 0);
  console.log(`Remaining open positions: ${left.length}`);
  for (const p of left) console.log(`  ${p.s} size=${p.sz}`);
}

main().catch((err) => {
  console.error("Flatten FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
