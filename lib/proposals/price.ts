// Wave 3 custom SSI index proposals: pricing coverage.
//
// Prices a proposed basket by the same pattern lib/ssi/nav.ts uses for real
// indices (sum of weight_i * priceUSD_i), via getPriceUSD (SoSoValue). Every
// constituent that resolves in the SoSoValue catalogue contributes; ones that do
// not are skipped and reported as coverage, never silently renormalized. When
// the data key is down (all null), coverage is 0 and perUnitNavUsd is null, so
// the basket + weights + rationale still render.

import { getPriceUSD } from "@/lib/prices";
import type { Constituent, Pricing } from "./schema";

export async function priceProposal(
  constituents: Pick<Constituent, "symbol" | "targetWeight">[],
): Promise<Pricing> {
  const marks: Pricing["marks"] = [];
  let priced = 0;
  let skipped = 0;
  let pricedWeight = 0;
  let nav = 0;

  for (const c of constituents) {
    // Sequential so the getPriceUSD symbol-map cache is warm, matching nav.ts.
    const priceUsd = await getPriceUSD(c.symbol);
    marks.push({ symbol: c.symbol, weight: c.targetWeight, priceUsd });
    if (priceUsd === null || !Number.isFinite(priceUsd)) {
      skipped++;
      continue;
    }
    priced++;
    pricedWeight += c.targetWeight;
    nav += c.targetWeight * priceUsd;
  }

  return {
    marks,
    priced,
    skipped,
    total: constituents.length,
    coverage: `${priced} of ${constituents.length} priceable`,
    pricedWeight,
    perUnitNavUsd: priced === 0 ? null : nav,
    asOf: new Date().toISOString(),
  };
}
