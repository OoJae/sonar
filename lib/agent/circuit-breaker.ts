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
  // The macro API gives DATE-only events, anchored to ~13:30 UTC (the US release
  // time). The old check was a symmetric +/-horizon window around that anchor,
  // which pretends an hour-level precision the data does not have AND, with the
  // 6h default, can never contain the 04:00 UTC daily cron: 04:00 is 9.5h before
  // a 13:30 print, so the ONLY scheduled cycle never de-risked for any event,
  // while /about, /risk, and the landing page advertised it as an active control.
  //
  // Evaluate at day granularity to match the data: a high-impact event is in
  // window if it falls on the current UTC trading day (the volatility spans the
  // whole session, before and after the print), or if it is still upcoming
  // within the hours horizon (so a late-night run also catches an early event).
  const nowMs = now.getTime();
  const nowUtcDay = now.toISOString().slice(0, 10);
  let chosen: MacroEvent | null = null;
  for (const ev of events) {
    if (ev.impact !== "high") continue;
    const at = new Date(ev.at);
    const delta = at.getTime() - nowMs;
    const sameUtcDay = at.toISOString().slice(0, 10) === nowUtcDay;
    const upcomingWithinHorizon = delta >= 0 && delta <= horizonMs;
    if (sameUtcDay || upcomingWithinHorizon) {
      if (!chosen || Math.abs(delta) < Math.abs(new Date(chosen.at).getTime() - nowMs)) {
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
