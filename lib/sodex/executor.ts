// Single dispatch point between the runner and the execution backend.
//
// The runner imports placeOrder from this file (never from paper.ts or live.ts
// directly). Switching SONAR_EXECUTION_MODE in .env.local plus restarting the
// app is the only thing required to flip between paper and live execution.
// This is also the kill switch documented in CLAUDE-WAVE2.md §3.5: setting
// the mode back to "paper" instantly reverts to safe behaviour with no code
// change.
//
// Routing rules:
//   paper          all orders go to lib/sodex/paper.ts (Wave 1 unchanged)
//   live-testnet   tradeable markets go to lib/sodex/live.ts; SSI-primitive
//                  legs (non-tradeable per lib/sodex/markets.ts) fall back to
//                  paper.ts so the dashboard still records the allocation
//                  decision. The order preview UI surfaces the per-leg split.
//   live-mainnet   throws; Wave 2 keeps mainnet disabled. The lib/utils/env.ts
//                  boot guard prevents this state from being reachable without
//                  SONAR_ALLOW_MAINNET=true plus forced manual approval.
//
// Re-exports getPositions and markToMarket from paper.ts unchanged because
// those reads operate on the paper_trades / paper_positions tables which the
// live executor will also write to (the executor records real fills as
// paper-table rows to keep the Wave 1 position-tracking code intact).

import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { resolveMarket } from "./markets";
import * as paper from "./paper";
import * as live from "./live";
import type { ExecutedTrade, OrderRequest } from "./types";

export { getPositions, markToMarket, recentTrades, tradesForThesis } from "./paper";

export async function placeOrder(req: OrderRequest): Promise<ExecutedTrade> {
  const mode = env().SONAR_EXECUTION_MODE;

  if (mode === "live-mainnet") {
    throw new Error(
      "live-mainnet execution is disabled in Wave 2. Set SONAR_EXECUTION_MODE=live-testnet or paper.",
    );
  }

  if (mode === "paper") {
    return paper.placeOrder(req);
  }

  // mode === "live-testnet": route per-market.
  const resolution = resolveMarket(req.market);
  if (!resolution.tradeable) {
    logger.info("executor.routed_to_paper", {
      market: req.market,
      reason: resolution.reason,
      mode,
    });
    return paper.placeOrder(req);
  }

  return live.placeOrder(req);
}
