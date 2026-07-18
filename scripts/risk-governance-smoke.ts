// Portfolio risk guard smoke: the pure decision across every branch.
//
// Deterministic, no DB, no network. Exercises the drawdown + VaR + correlation
// guard (decidePortfolioRiskGuard) and the correlation averaging helper.
//
// Usage: pnpm tsx scripts/risk-governance-smoke.ts

import "./_env";
import {
  decidePortfolioRiskGuard,
  averageOffDiagonalCorrelation,
  type RiskCaps,
} from "@/lib/risk/governance";
import type { RiskMetrics, CorrelationMatrix } from "@/lib/risk/metrics";

const CAPS: RiskCaps = { drawdownPct: 25, varPct: 8, correlation: 0.85 };

function corr(m: (number | null)[][]): CorrelationMatrix {
  return { indices: ["MAG7", "DEFI", "MEME"], matrix: m };
}

// A benign 3x3 correlation matrix (avg off-diagonal 0.66), like the live book.
const CALM = corr([
  [1, 0.62, 0.76],
  [0.62, 1, 0.61],
  [0.76, 0.61, 1],
]);
// Everything moves together (avg 0.95).
const HOT = corr([
  [1, 0.95, 0.95],
  [0.95, 1, 0.95],
  [0.95, 0.95, 1],
]);
const ALL_NULL = corr([
  [1, null, null],
  [null, 1, null],
  [null, null, 1],
]);

function metrics(over: Partial<RiskMetrics>): RiskMetrics {
  return {
    hasEnoughData: true,
    sampleSize: 30,
    varConfidence: 0.95,
    varPct: 3,
    maxDrawdownPct: 13,
    currentDrawdownPct: 8,
    correlation: CALM,
    exposure: [],
    concentrationHHI: 0.4,
    ...over,
  };
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond && detail) console.log(`          ${detail}`);
}

console.log("\n1. averaging helper");
check("calm avg is 0.66", Math.abs((averageOffDiagonalCorrelation(CALM) ?? 0) - 0.663) < 0.01);
check("all-null averages to null", averageOffDiagonalCorrelation(ALL_NULL) === null);
check(
  "partial-null averages only the defined pair",
  averageOffDiagonalCorrelation(corr([[1, 0.9, null], [0.9, 1, null], [null, null, 1]])) === 0.9,
);

console.log("\n2. normal book: no de-risk");
{
  const s = decidePortfolioRiskGuard(metrics({}), CAPS);
  check("inactive on VaR 3% / dd 8% / corr 0.66", !s.active && s.deRiskFactor === 1, JSON.stringify(s));
}

console.log("\n3. VaR breach fires");
{
  const s = decidePortfolioRiskGuard(metrics({ varPct: 9 }), CAPS);
  check("active with 1/3 factor", s.active && Math.abs(s.deRiskFactor - 1 / 3) < 1e-9);
  check("reason names VaR", !!s.reason && s.reason.includes("VaR"), s.reason ?? "");
}

console.log("\n4. correlation breach fires");
{
  const s = decidePortfolioRiskGuard(metrics({ correlation: HOT }), CAPS);
  check("active", s.active && Math.abs(s.deRiskFactor - 1 / 3) < 1e-9);
  check("reason names correlation", !!s.reason && s.reason.includes("correlation"), s.reason ?? "");
}

console.log("\n5. drawdown breach still fires (unchanged behaviour)");
{
  const s = decidePortfolioRiskGuard(metrics({ currentDrawdownPct: 30 }), CAPS);
  check("active", s.active);
  check("reason names drawdown", !!s.reason && s.reason.includes("drawdown"), s.reason ?? "");
}

console.log("\n6. multiple breaches compose into one reason");
{
  const s = decidePortfolioRiskGuard(metrics({ varPct: 9, correlation: HOT }), CAPS);
  check("active, both named", s.active && !!s.reason && s.reason.includes("VaR") && s.reason.includes("correlation"));
}

console.log("\n7. insufficient data: never gates");
{
  const s = decidePortfolioRiskGuard(metrics({ hasEnoughData: false, varPct: 99, correlation: HOT }), CAPS);
  check("inactive despite huge VaR", !s.active && s.deRiskFactor === 1);
}

console.log("\n8. all-null correlation does not fire the correlation cap");
{
  const s = decidePortfolioRiskGuard(metrics({ correlation: ALL_NULL }), CAPS);
  check("inactive (VaR/dd normal, corr undefined)", !s.active);
}

console.log(`\n  ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
