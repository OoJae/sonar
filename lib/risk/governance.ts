// Wave 3 production risk engine - governance layer.
//
// Portfolio-level pre-cycle risk control that composes with the macro circuit
// breaker. It enforces three limits off the reconstructed book: a drawdown cap,
// a one-cycle VaR cap, and an average-index-correlation cap. When any is
// breached, the cycle de-risks through the same server-side path the macro
// breaker uses (scaled notional caps + a tilt toward USSI), with the reason
// persisted to agent_runs.halt_reason and surfaced on /log and /risk. All three
// share the DERISK_FACTOR, so the composition in the runner (min factor wins)
// stays predictable. Concentration/HHI stays measured-only.

import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { computeRiskMetrics, type CorrelationMatrix, type RiskMetrics } from "./metrics";

export type RiskCaps = {
  drawdownPct: number;
  varPct: number;
  correlation: number;
};

export type RiskGuardState = {
  active: boolean;
  deRiskFactor: number;
  reason: string | null;
  // The metric values that drove the decision, for logging and inspection.
  drawdownPct: number | null;
  varPct: number | null;
  avgCorrelation: number | null;
};

// When a limit is breached, cap notional to a third and tilt to USSI, matching
// the macro breaker's posture so the two compose predictably (min factor wins).
const DERISK_FACTOR = 1 / 3;

// Average of the unique off-diagonal (i<j) pairwise correlations, ignoring null
// cells (a flat or too-short return series yields null). Returns null when no
// pair has a defined correlation, so the guard treats it as inactive rather than
// firing on missing data.
export function averageOffDiagonalCorrelation(c: CorrelationMatrix): number | null {
  const n = c.indices.length;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = c.matrix[i]?.[j];
      if (typeof v === "number" && Number.isFinite(v)) {
        sum += v;
        count += 1;
      }
    }
  }
  return count > 0 ? sum / count : null;
}

function inactive(): RiskGuardState {
  return {
    active: false,
    deRiskFactor: 1,
    reason: null,
    drawdownPct: null,
    varPct: null,
    avgCorrelation: null,
  };
}

// Pure decision, no IO: given a metrics snapshot and the caps, return the guard
// state. Exported so the smoke can exercise every branch deterministically.
export function decidePortfolioRiskGuard(
  m: RiskMetrics,
  caps: RiskCaps,
): RiskGuardState {
  // Insufficient history: no gate, exactly as the drawdown guard behaved.
  if (!m.hasEnoughData) return inactive();

  const avgCorr = averageOffDiagonalCorrelation(m.correlation);

  const breaches: string[] = [];
  if (m.currentDrawdownPct >= caps.drawdownPct) {
    breaches.push(`book drawdown ${m.currentDrawdownPct.toFixed(1)}% over the ${caps.drawdownPct}% cap`);
  }
  if (m.varPct >= caps.varPct) {
    breaches.push(`one-cycle VaR ${m.varPct.toFixed(1)}% over the ${caps.varPct}% cap`);
  }
  if (avgCorr !== null && avgCorr >= caps.correlation) {
    breaches.push(`average index correlation ${avgCorr.toFixed(2)} over the ${caps.correlation} cap`);
  }

  if (breaches.length > 0) {
    const reason =
      `Portfolio risk limit breached (${breaches.join("; ")}); notional capped ` +
      `to ${Math.round(DERISK_FACTOR * 100)}% and allocations tilted toward USSI.`;
    return {
      active: true,
      deRiskFactor: DERISK_FACTOR,
      reason,
      drawdownPct: m.currentDrawdownPct,
      varPct: m.varPct,
      avgCorrelation: avgCorr,
    };
  }

  return {
    active: false,
    deRiskFactor: 1,
    reason: null,
    drawdownPct: m.currentDrawdownPct,
    varPct: m.varPct,
    avgCorrelation: avgCorr,
  };
}

// Renamed from evaluateDrawdownGuard: now checks drawdown + VaR + correlation off
// a single metrics computation. The runner's combinedDeRisk composition consumes
// the same RiskGuardState shape (active / deRiskFactor / reason) unchanged.
export async function evaluatePortfolioRiskGuard(): Promise<RiskGuardState> {
  try {
    const m = await computeRiskMetrics(env().SONAR_VAR_CONFIDENCE);
    const state = decidePortfolioRiskGuard(m, {
      drawdownPct: env().SONAR_MAX_DRAWDOWN_PCT,
      varPct: env().SONAR_MAX_VAR_PCT,
      correlation: env().SONAR_MAX_CORRELATION,
    });
    if (state.active) {
      logger.info("risk.portfolio_guard_active", {
        drawdownPct: state.drawdownPct,
        varPct: state.varPct,
        avgCorrelation: state.avgCorrelation,
        reason: state.reason,
      });
    }
    return state;
  } catch (err) {
    logger.warn("risk.portfolio_guard_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return inactive();
  }
}
