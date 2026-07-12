// Wave 3 production risk engine - governance layer.
//
// Portfolio-level pre-cycle risk control that composes with the macro circuit
// breaker. Today it enforces a drawdown cap: when the reconstructed book
// drawdown exceeds SONAR_MAX_DRAWDOWN_PCT, the cycle de-risks through the same
// server-side path the macro breaker uses (scaled notional caps + a tilt toward
// USSI), with the reason persisted to agent_runs.halt_reason and surfaced on
// /log and /risk. VaR and correlation are surfaced on /risk as monitoring.

import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { computeRiskMetrics } from "./metrics";

export type RiskGuardState = {
  active: boolean;
  deRiskFactor: number;
  reason: string | null;
  drawdownPct: number | null;
  cap: number;
};

// When a limit is breached, cap notional to a third and tilt to USSI, matching
// the macro breaker's posture so the two compose predictably (min factor wins).
const DERISK_FACTOR = 1 / 3;

export async function evaluateDrawdownGuard(): Promise<RiskGuardState> {
  const cap = env().SONAR_MAX_DRAWDOWN_PCT;
  try {
    const m = await computeRiskMetrics(env().SONAR_VAR_CONFIDENCE);
    if (m.hasEnoughData && m.currentDrawdownPct >= cap) {
      const reason =
        `Book drawdown ${m.currentDrawdownPct.toFixed(1)}% exceeds the ` +
        `${cap}% cap; notional capped to ${Math.round(DERISK_FACTOR * 100)}% ` +
        `and allocations tilted toward USSI.`;
      logger.info("risk.drawdown_guard_active", {
        drawdownPct: m.currentDrawdownPct,
        cap,
      });
      return {
        active: true,
        deRiskFactor: DERISK_FACTOR,
        reason,
        drawdownPct: m.currentDrawdownPct,
        cap,
      };
    }
    return {
      active: false,
      deRiskFactor: 1,
      reason: null,
      drawdownPct: m.hasEnoughData ? m.currentDrawdownPct : null,
      cap,
    };
  } catch (err) {
    logger.warn("risk.drawdown_guard_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { active: false, deRiskFactor: 1, reason: null, drawdownPct: null, cap };
  }
}
