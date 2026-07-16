#!/usr/bin/env tsx
//
// Does the SoDEX venue dedupe a repeated clOrdID on the WIRE?
//
// docs/sodex-live.md has carried this as UNCONFIRMED since May: "the server
// SHOULD return the existing order rather than creating a new one". Nothing ever
// checked. The existing "idempotency" assertion in sodex-live-smoke.ts does not
// test this at all: the second placeOrder call is served from our own DB by the
// idempotency branch and never touches the network.
//
// It matters now. The mainnet approval gate's rule is "the atomic claim is the
// only writer, and a second approve must never submit". If the venue deduped, a
// double-submit would be survivable; if it does not, a double-submit is two real
// market orders, and the claim is load-bearing rather than belt-and-braces. We
// should know which, rather than assume the kind one.
//
// This bypasses our DB idempotency deliberately and talks straight to the wire,
// twice, with the same clOrdID. Testnet only, smallest legal size, and it
// flattens whatever it opens.
//
// Usage: pnpm tsx scripts/sodex-clordid-dedupe-probe.ts

import "./_env";
import {
  submitPerpOrder,
  findOrderByClOrdID,
  getPerpSymbolInfo,
  getAccountState,
} from "@/lib/sodex/client";
import { getPriceUSD } from "@/lib/prices";
import { env } from "@/lib/utils/env";

async function main() {
  const mode = env().SONAR_EXECUTION_MODE;
  if (mode !== "live-testnet") {
    console.error(`Refusing to run in ${mode}. This probe places real orders and is testnet only.`);
    process.exit(2);
  }

  const symbol = "BTC-USD";
  const price = await getPriceUSD("BTC");
  if (!price) {
    console.error("No BTC price; cannot size the probe.");
    process.exit(1);
  }
  const info = await getPerpSymbolInfo(symbol);
  const step = info?.stepSize ? Number(info.stepSize) : 1e-5;
  const precision = info?.quantityPrecision ?? 5;
  // Just above the $10 minNotional.
  const qty = (Math.ceil(11 / price / step) * step).toFixed(precision);

  const clOrdID = `dedupe-${Date.now().toString(16)}`;
  console.log(`symbol=${symbol} qty=${qty} (~$${(Number(qty) * price).toFixed(2)})`);
  console.log(`clOrdID=${clOrdID}`);
  console.log("");

  console.log("Submit #1 (same clOrdID) ...");
  const first = await submitPerpOrder({
    symbolName: symbol,
    side: "buy",
    type: "market",
    quantity: qty,
    clOrdID,
  });
  console.log(`  accepted: sodexOrderId=${first.sodexOrderId} status=${first.status}`);

  console.log("Submit #2 (SAME clOrdID) ...");
  let secondOutcome: string;
  let secondOrderId: string | null = null;
  try {
    const second = await submitPerpOrder({
      symbolName: symbol,
      side: "buy",
      type: "market",
      quantity: qty,
      clOrdID,
    });
    secondOrderId = second.sodexOrderId;
    if (second.sodexOrderId === first.sodexOrderId) {
      secondOutcome = "DEDUPED: same sodexOrderId returned, no second order created";
    } else {
      secondOutcome = `NOT DEDUPED: a SECOND order was created (${second.sodexOrderId})`;
    }
    console.log(`  accepted: sodexOrderId=${second.sodexOrderId} status=${second.status}`);
  } catch (err) {
    secondOutcome = `REJECTED: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`;
    console.log(`  ${secondOutcome}`);
  }

  console.log("");
  console.log("=== VERDICT ===");
  console.log(`  ${secondOutcome}`);
  console.log("");

  // What does the venue's own history say happened?
  const hist = await findOrderByClOrdID(clOrdID, symbol);
  console.log(`history lookup by clOrdID: ${hist ? JSON.stringify(hist).slice(0, 220) : "not found"}`);

  const state = (await getAccountState({ kind: "perps" })) as unknown as {
    P?: Array<Record<string, unknown>>;
  };
  const pos = (state.P ?? []).find((p) => p.s === symbol);
  console.log(`resulting ${symbol} position size: ${pos?.sz ?? 0}`);
  console.log("");
  console.log(
    "If a second order was created, the position is ~2x the single-order size, and the",
  );
  console.log(
    "approval gate's atomic claim is the ONLY thing standing between a double-click and",
  );
  console.log("two real market orders. Record the answer in docs/sodex-live.md.");
  console.log("");
  console.log("Now run: pnpm tsx scripts/sodex-flatten.ts --execute");
  void secondOrderId;
}

main().catch((err) => {
  console.error("Probe FAILED:", err);
  process.exit(1);
});
