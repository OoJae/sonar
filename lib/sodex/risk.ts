// Risk gate. Pure functions plus a per-process cycle accumulator.
//
// Layers of protection between an agent thesis and a wire-side order:
//   1. Dust floor: orders smaller than DUST_FLOOR_USD are silently dropped.
//      The runner already does this on allocation deltas before invoking
//      placeOrder; risk.ts is the second backstop, applied to hedges too.
//   2. Per-order cap: orders larger than SONAR_MAX_NOTIONAL_PER_ORDER are
//      downsized to the cap. The downsizing is logged so the user can see
//      it on /log, and the order continues with the capped value.
//   3. Per-cycle cap: once the cumulative notional across the cycle would
//      exceed SONAR_MAX_NOTIONAL_PER_CYCLE, further orders are rejected
//      outright. Already-placed orders in the same cycle are NOT clawed
//      back; the cap stops future placement only.
//   4. Position caps: per-market and gross. Layers 2 and 3 bound each order
//      and each cycle but NOT the book, so a thesis that hedges the same way
//      every day compounds into an unbounded position. That is not
//      hypothetical: on testnet, 32 capped BTC sells across ~30 cycles
//      accumulated into a 0.234 BTC short (~$14.8k notional at 20x on a
//      $1.5k account), which exhausted margin and made every subsequent
//      order fail. Layer 4 bounds the resulting position, not the flow.
//
// The invariant that makes layer 4 safe: an order that REDUCES exposure is
// never blocked or downsized. A cap that could block a de-risking order would
// trap the book above its own limit, which is worse than no cap at all.
//
// Mode gate runs at boot via lib/utils/env.ts:superRefine and is reinforced
// at the executor entrypoint (lib/sodex/executor.ts) for live-mainnet.
//
// State: the cycle accumulator is keyed by runId so each agent cycle gets a
// fresh budget. The map lives in the process; restart resets all budgets.
// That is intentional for Wave 2 cadence (one cron per weekday); the
// risk-gate accumulator is not a hardened ledger and does not need to be.

import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";

export const DUST_FLOOR_USD = 10;

const cycleNotionalSpent = new Map<string, number>();

// Macro circuit-breaker de-risk factor. 1 = normal; a fraction (e.g. 1/3)
// scales the per-order and per-cycle caps down for the active cycle so live
// hedges shrink during a high-impact macro window. The runner sets this at
// cycle start and clears it after. Process-scoped, like the cycle accumulator.
let deRiskFactor = 1;
export function setDeRiskFactor(factor: number): void {
  deRiskFactor = factor > 0 && factor <= 1 ? factor : 1;
}
export function clearDeRisk(): void {
  deRiskFactor = 1;
}
export function currentDeRiskFactor(): number {
  return deRiskFactor;
}

export type OrderCapResult = {
  notionalUSD: number;
  downsized: boolean;
};

export type CycleCapResult =
  | { allow: true }
  | { allow: false; reason: string; spent: number; cap: number };

export type PositionCapResult =
  | { allow: true; notionalUSD: number; downsized: boolean; reducing: boolean }
  | { allow: false; reason: string };

export function isDust(notionalUSD: number): boolean {
  return notionalUSD < DUST_FLOOR_USD;
}

export function enforcePerOrderCap(requestedUSD: number): OrderCapResult {
  // The de-risk factor shrinks the cap during an active macro window.
  const cap = env().SONAR_MAX_NOTIONAL_PER_ORDER * deRiskFactor;
  if (requestedUSD > cap) {
    logger.info("risk.per_order_downsize", {
      requested: requestedUSD,
      cap,
      deRiskFactor,
    });
    return { notionalUSD: cap, downsized: true };
  }
  return { notionalUSD: requestedUSD, downsized: false };
}

export function enforcePerCycleCap(
  runId: string,
  requestedUSD: number,
): CycleCapResult {
  const cap = env().SONAR_MAX_NOTIONAL_PER_CYCLE * deRiskFactor;
  const spent = cycleNotionalSpent.get(runId) ?? 0;
  if (spent + requestedUSD > cap) {
    const reason = `per-cycle cap of $${cap} would be exceeded: already spent $${spent}, requested $${requestedUSD}`;
    logger.warn("risk.per_cycle_block", { runId, cap, spent, requested: requestedUSD });
    return { allow: false, reason, spent, cap };
  }
  return { allow: true };
}

// Layer 4a: per-market position cap.
//
// Bounds the absolute notional a single market's position may reach, given the
// position the venue currently holds. Reducing orders always pass at full size
// (see the header invariant): only orders that grow the absolute exposure are
// measured against the cap, and they are downsized to the remaining headroom
// rather than rejected, unless the headroom is dust.
//
// currentPositionUSD is SIGNED: positive long, negative short.
export function enforcePositionCap(input: {
  market: string;
  side: "buy" | "sell";
  notionalUSD: number;
  currentPositionUSD: number;
}): PositionCapResult {
  const { market, side, notionalUSD, currentPositionUSD } = input;
  const signedDelta = side === "buy" ? notionalUSD : -notionalUSD;
  const projected = currentPositionUSD + signedDelta;

  // Reducing (or flattening, or flipping through flat to a smaller absolute
  // position): never gate. Closing a position must always be possible.
  if (Math.abs(projected) <= Math.abs(currentPositionUSD)) {
    return { allow: true, notionalUSD, downsized: false, reducing: true };
  }

  const cap = env().SONAR_MAX_POSITION_NOTIONAL_USD * deRiskFactor;
  if (Math.abs(projected) <= cap) {
    return { allow: true, notionalUSD, downsized: false, reducing: false };
  }

  // Growing past the cap: allow only the headroom that remains.
  const headroom = cap - Math.abs(currentPositionUSD);
  if (headroom < DUST_FLOOR_USD) {
    const reason = `per-market position cap of $${cap.toFixed(2)} reached on ${market}: position is $${currentPositionUSD.toFixed(2)}, refusing to grow it further`;
    logger.warn("risk.position_cap_block", {
      market,
      side,
      cap,
      currentPositionUSD,
      requested: notionalUSD,
    });
    return { allow: false, reason };
  }
  logger.info("risk.position_cap_downsize", {
    market,
    side,
    cap,
    currentPositionUSD,
    requested: notionalUSD,
    allowed: headroom,
  });
  return { allow: true, notionalUSD: headroom, downsized: true, reducing: false };
}

// Layer 4b: gross exposure cap across all markets.
//
// The per-market cap alone still lets N markets each sit at the cap. This
// bounds the sum of absolute notionals. Same invariant: reducing orders pass.
export function enforceGrossExposureCap(input: {
  market: string;
  notionalUSD: number;
  grossExposureUSD: number;
  reducing: boolean;
}): PositionCapResult {
  const { market, notionalUSD, grossExposureUSD, reducing } = input;
  if (reducing) {
    return { allow: true, notionalUSD, downsized: false, reducing: true };
  }
  const cap = env().SONAR_MAX_GROSS_EXPOSURE_USD * deRiskFactor;
  const projected = grossExposureUSD + notionalUSD;
  if (projected <= cap) {
    return { allow: true, notionalUSD, downsized: false, reducing: false };
  }
  const headroom = cap - grossExposureUSD;
  if (headroom < DUST_FLOOR_USD) {
    const reason = `gross exposure cap of $${cap.toFixed(2)} reached: open notional is $${grossExposureUSD.toFixed(2)}, refusing to add ${market}`;
    logger.warn("risk.gross_cap_block", {
      market,
      cap,
      grossExposureUSD,
      requested: notionalUSD,
    });
    return { allow: false, reason };
  }
  logger.info("risk.gross_cap_downsize", {
    market,
    cap,
    grossExposureUSD,
    requested: notionalUSD,
    allowed: headroom,
  });
  return { allow: true, notionalUSD: headroom, downsized: true, reducing: false };
}

// Mode gate. Called by the live executor on each placeOrder invocation as
// Cheap belt-and-braces re-assert of the two mainnet opt-in flags.
//
// Read this honestly: it is NOT the gate, and nothing should rely on it. Both
// flags are already enforced at boot (lib/utils/env.ts superRefine) and env() is
// cached for the process lifetime, so on any process that is running at all in
// live-mainnet both are provably true and this function cannot throw. It is kept
// only because it costs nothing and would catch a future refactor that made env
// mutable.
//
// The real gates on the real-money path are elsewhere and are load-bearing:
// the record-time risk caps in recordPendingMainnetOrder, and in
// submitApprovedOrder the mode check, the row.mode binding, the approval TTL,
// the delegation re-check, and the venue-reading position/gross caps.
export function assertModeAllowed(): void {
  const mode = env().SONAR_EXECUTION_MODE;
  if (mode === "live-mainnet") {
    if (!env().SONAR_ALLOW_MAINNET) {
      throw new Error(
        "live-mainnet mode requires SONAR_ALLOW_MAINNET=true; refusing to place real-money orders.",
      );
    }
    if (!env().SONAR_REQUIRE_MANUAL_APPROVAL) {
      throw new Error(
        "live-mainnet mode requires SONAR_REQUIRE_MANUAL_APPROVAL=true; refusing without forced manual approval.",
      );
    }
  }
}

// Record a placed order against the cycle budget. Call after the wire-side
// submission succeeds (so cancelled orders do not consume budget).
export function recordPlaced(runId: string, notionalUSD: number): void {
  const current = cycleNotionalSpent.get(runId) ?? 0;
  cycleNotionalSpent.set(runId, current + notionalUSD);
}

// Reset the accumulator for a given cycle. Useful for tests; not used in
// the normal runner path because each runId is fresh.
export function resetCycle(runId: string): void {
  cycleNotionalSpent.delete(runId);
}

// Introspection for the dashboard, tests, and the Phase 2.5 order preview UI.
export function cycleSpent(runId: string): number {
  return cycleNotionalSpent.get(runId) ?? 0;
}
