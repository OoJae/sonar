// Wave 2 risk gate. Pure functions plus a per-process cycle accumulator.
//
// Three layers of protection between an agent thesis and a wire-side order:
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

export type OrderCapResult = {
  notionalUSD: number;
  downsized: boolean;
};

export type CycleCapResult =
  | { allow: true }
  | { allow: false; reason: string; spent: number; cap: number };

export function isDust(notionalUSD: number): boolean {
  return notionalUSD < DUST_FLOOR_USD;
}

export function enforcePerOrderCap(requestedUSD: number): OrderCapResult {
  const cap = env().SONAR_MAX_NOTIONAL_PER_ORDER;
  if (requestedUSD > cap) {
    logger.info("risk.per_order_downsize", {
      requested: requestedUSD,
      cap,
    });
    return { notionalUSD: cap, downsized: true };
  }
  return { notionalUSD: requestedUSD, downsized: false };
}

export function enforcePerCycleCap(
  runId: string,
  requestedUSD: number,
): CycleCapResult {
  const cap = env().SONAR_MAX_NOTIONAL_PER_CYCLE;
  const spent = cycleNotionalSpent.get(runId) ?? 0;
  if (spent + requestedUSD > cap) {
    const reason = `per-cycle cap of $${cap} would be exceeded: already spent $${spent}, requested $${requestedUSD}`;
    logger.warn("risk.per_cycle_block", { runId, cap, spent, requested: requestedUSD });
    return { allow: false, reason, spent, cap };
  }
  return { allow: true };
}

// Mode gate. Called by the live executor on each placeOrder invocation as
// a defence-in-depth against env reload races. Mainnet additionally requires
// SONAR_ALLOW_MAINNET=true and SONAR_REQUIRE_MANUAL_APPROVAL=true; the boot
// guard in lib/utils/env.ts catches the misconfiguration earlier, but
// re-checking here means a live cycle cannot slip through if the env state
// changes mid-process.
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
    // Mainnet code path is not implemented in Wave 2; defend against any
    // accidental wiring. The executor facade already throws, this is the
    // second backstop.
    throw new Error(
      "live-mainnet execution is disabled in Wave 2; only live-testnet is supported.",
    );
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
