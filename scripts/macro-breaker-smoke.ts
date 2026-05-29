#!/usr/bin/env tsx
//
// Part 5 macro circuit breaker smoke. Pure-function checks against the
// evaluator plus the risk-gate cap scaling. No wire, no model.
//
// Asserts:
//   1. A synthetic high-impact event inside the horizon activates the breaker
//      with action de-risk and a cited reason.
//   2. A high-impact event outside the horizon does not activate it.
//   3. A normal-impact event inside the horizon does not activate it.
//   4. setDeRiskFactor scales the per-order and per-cycle caps; clearDeRisk
//      restores them.
//
//   pnpm tsx scripts/macro-breaker-smoke.ts

import "./_env";
import { evaluateMacroWindow } from "@/lib/agent/circuit-breaker";
import {
  clearDeRisk,
  enforcePerOrderCap,
  setDeRiskFactor,
} from "@/lib/sodex/risk";
import { env } from "@/lib/utils/env";
import type { MacroEvent } from "@/lib/sosovalue/macro";

const now = new Date("2026-06-09T10:00:00.000Z");
const horizon = env().SONAR_MACRO_HALT_HORIZON_HOURS;

let pass = 0;
let fail = 0;
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ""}`);
    fail++;
  }
}

function hoursFromNow(h: number): string {
  return new Date(now.getTime() + h * 60 * 60 * 1000).toISOString();
}

async function main() {
  console.log(`Horizon: ${horizon}h, now: ${now.toISOString()}`);

  console.log("\n1. High-impact event inside the horizon activates de-risk");
  const inWindow: MacroEvent[] = [
    { name: "CPI (YoY)", at: hoursFromNow(2), impact: "high" },
  ];
  const s1 = await evaluateMacroWindow({ nowIso: now.toISOString(), events: inWindow });
  assert("active", s1.active);
  assert("action de-risk", s1.action === "de-risk");
  assert("event cited", s1.event?.name === "CPI (YoY)");
  assert("reason mentions CPI", Boolean(s1.reason?.includes("CPI")));
  assert("deRiskFactor < 1", s1.deRiskFactor < 1);

  console.log("\n2. High-impact event outside the horizon does not activate");
  const outWindow: MacroEvent[] = [
    { name: "FOMC Interest Rate Decision", at: hoursFromNow(horizon + 24), impact: "high" },
  ];
  const s2 = await evaluateMacroWindow({ nowIso: now.toISOString(), events: outWindow });
  assert("inactive", !s2.active);

  console.log("\n3. Normal-impact event inside the horizon does not activate");
  const normal: MacroEvent[] = [
    { name: "ISM Manufacturing PMI", at: hoursFromNow(1), impact: "normal" },
  ];
  const s3 = await evaluateMacroWindow({ nowIso: now.toISOString(), events: normal });
  assert("inactive", !s3.active);

  console.log("\n4. De-risk factor scales the risk-gate caps");
  clearDeRisk();
  const cap = env().SONAR_MAX_NOTIONAL_PER_ORDER;
  const normalCap = enforcePerOrderCap(cap + 1);
  assert("normal cap unchanged", normalCap.notionalUSD === cap);
  setDeRiskFactor(s1.deRiskFactor);
  const scaled = enforcePerOrderCap(cap);
  assert(
    "scaled cap is deRiskFactor x cap",
    Math.abs(scaled.notionalUSD - cap * s1.deRiskFactor) < 0.001,
  );
  clearDeRisk();
  const restored = enforcePerOrderCap(cap / 2);
  assert("clearDeRisk restores", !restored.downsized && restored.notionalUSD === cap / 2);

  console.log(`\nResults: ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke FAIL:", err);
  process.exit(1);
});
