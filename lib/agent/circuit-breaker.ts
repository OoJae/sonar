// Macro circuit breaker. Pre-cycle check: if a high-impact macro event falls
// within the lookahead horizon, the agent de-risks (the user-chosen default):
// the risk gate scales notional caps down and the runner tilts target weights
// toward USSI before sizing. The agent is also told in the prompt so it cites
// the event in its reasoning. Defence in depth: the server-side de-risk holds
// even if the model ignores the prompt.

import { env } from "@/lib/utils/env";
import { getMacroEvents, type MacroEvent } from "@/lib/sosovalue/macro";

export type BreakerState = {
  active: boolean;
  action: "de-risk";
  event: MacroEvent | null;
  // How hard to de-risk: notional caps multiply by this, and target weights
  // tilt toward USSI by (1 - this) of their risky weight.
  deRiskFactor: number;
  reason: string | null;
};

const INACTIVE: BreakerState = {
  active: false,
  action: "de-risk",
  event: null,
  deRiskFactor: 1,
  reason: null,
};

// When active, keep a third of normal notional and shift two-thirds of risky
// weight into USSI. Conservative but not a full halt (the user chose de-risk).
const DE_RISK_FACTOR = 1 / 3;

export async function evaluateMacroWindow(opts?: {
  nowIso?: string;
  events?: MacroEvent[]; // injectable for tests
}): Promise<BreakerState> {
  const now = opts?.nowIso ? new Date(opts.nowIso) : new Date();
  const horizonHours = env().SONAR_MACRO_HALT_HORIZON_HOURS;
  const horizonMs = horizonHours * 60 * 60 * 1000;

  const events = opts?.events ?? (await getMacroEvents());
  // The nearest upcoming high-impact event within the horizon. An event that
  // already passed today still counts as "in window" until it falls behind
  // by the horizon, because the volatility tail outlasts the print.
  let chosen: MacroEvent | null = null;
  for (const ev of events) {
    if (ev.impact !== "high") continue;
    const at = new Date(ev.at).getTime();
    const delta = at - now.getTime();
    // Active if the event is within [now - horizon, now + horizon].
    if (delta <= horizonMs && delta >= -horizonMs) {
      if (!chosen || Math.abs(at - now.getTime()) < Math.abs(new Date(chosen.at).getTime() - now.getTime())) {
        chosen = ev;
      }
    }
  }

  if (!chosen) return INACTIVE;

  const whenH = (new Date(chosen.at).getTime() - now.getTime()) / (60 * 60 * 1000);
  const tense = whenH >= 0 ? `in ${whenH.toFixed(1)}h` : `${Math.abs(whenH).toFixed(1)}h ago`;
  return {
    active: true,
    action: "de-risk",
    event: chosen,
    deRiskFactor: DE_RISK_FACTOR,
    reason: `Macro circuit breaker: high-impact event "${chosen.name}" ${tense} (within the ${horizonHours}h horizon). De-risking: notional capped to ${Math.round(DE_RISK_FACTOR * 100)}% and allocations tilted toward USSI.`,
  };
}
