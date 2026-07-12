// Wave 3 risk-engine smoke: computes the portfolio risk metrics against the
// live DB and prints them for a hand-check. Run: pnpm tsx scripts/risk-smoke.ts
import "./_env";
import { computeRiskMetrics } from "@/lib/risk/metrics";

async function main() {
  const m = await computeRiskMetrics(0.95);
  console.log("hasEnoughData:", m.hasEnoughData, " sampleSize:", m.sampleSize);
  console.log(`VaR(${m.varConfidence * 100}%): ${m.varPct.toFixed(3)}% one-cycle loss`);
  console.log(`maxDrawdown: ${m.maxDrawdownPct.toFixed(3)}%  current: ${m.currentDrawdownPct.toFixed(3)}%`);
  console.log("concentration HHI:", m.concentrationHHI.toFixed(4));
  console.log("correlation", m.correlation.indices.join("/"));
  for (let i = 0; i < m.correlation.indices.length; i++) {
    console.log(
      "  " + m.correlation.indices[i] + " " +
        m.correlation.matrix[i]!
          .map((v) => (v === null ? " n/a " : v.toFixed(2).padStart(5)))
          .join(" "),
    );
  }
  console.log("exposure:");
  for (const e of m.exposure) {
    console.log(`  ${e.index.padEnd(5)} $${e.marketValueUsd.toFixed(2).padStart(12)}  ${(e.weight * 100).toFixed(1)}%`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
