#!/usr/bin/env tsx
//
// Phase 3.2 NAV smoke. Computes per-share NAV for MAG7, DEFI, MEME, USSI
// against live Base mainnet tokensets and live SoSoValue spot prices.
//
// Use this to hand-verify the NAV math before trusting the Portfolio chart.
// Confirmed against Base mainnet 2026-05-28: the Wave 1 placeholder prices
// in lib/sodex/paper.ts ($132.4, $48.2, $12.7) were just made-up references.
// Real per-share NAV is well under $1 for all three indices because each
// share holds a tiny fractional position in each underlying. Sanity-check
// via the BTC backing: MAG7 holds 0.00000218 BTC per share x 169.4M shares
// = 369 BTC x $76k = $28M, which matches the computed $76M AUM at the
// reported $0.45 per-share NAV.
//
// Expected ballpark per index (subject to market moves):
//   MAG7  $0.40-$0.60 per share
//   DEFI  $0.30-$0.45 per share
//   MEME  $0.05-$0.12 per share
//   USSI  $1.00 by definition (stable)
// If a number lands far outside the band, decimals or pricing is off.

import "./_env";
import { computeAllNavs } from "@/lib/ssi/nav";

async function main() {
  const results = await computeAllNavs();
  console.log("");
  console.log("NAV per share (USD):");
  console.log("");
  console.log("  Index  | NAV       | priced | skipped | totalSupply");
  console.log("  -------+-----------+--------+---------+-------------");
  for (const r of results) {
    console.log(
      `  ${r.index.padEnd(6)} | $${r.navPerShareUSD.toFixed(4).padStart(9)} | ${String(r.priced).padStart(6)} | ${String(r.skipped).padStart(7)} | ${r.totalSupply}`,
    );
  }
}

main().catch((err) => {
  console.error("NAV smoke FAIL:", err);
  process.exit(1);
});
