// SoDEX live testnet executor.
//
// Phase 1 stub: throws on placeOrder so paper mode is unaffected but any
// attempt to actually route a live order surfaces immediately. Phase 2 fills
// this in with EIP-712 signing (lib/sodex/client.ts), the risk gate
// (lib/sodex/risk.ts), idempotent clientOrderId generation, order submission,
// and status polling. The current lib/sodex/executor.ts already routes here
// only when SONAR_EXECUTION_MODE = "live-testnet", so importing this module
// is safe at Phase 1.
//
// Contract: same as lib/sodex/paper.ts:placeOrder. Returns an ExecutedTrade
// reflecting the real fill; persists an orders row with the SoDEX order id;
// reuses the paper-engine position-tracking code path via paperTrades insert
// so the dashboard works unchanged across modes.

import type { ExecutedTrade, OrderRequest } from "./types";

export async function placeOrder(req: OrderRequest): Promise<ExecutedTrade> {
  void req;
  throw new Error(
    "lib/sodex/live.ts placeOrder is not implemented yet. Phase 2 wires this. Set SONAR_EXECUTION_MODE=paper to fall back to the paper engine.",
  );
}
