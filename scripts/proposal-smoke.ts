// Wave 3 custom-index proposal spike: validates the schema + citation rules and
// prices a known basket. No DB, no LLM. Run: pnpm tsx scripts/proposal-smoke.ts
import "./_env";
import { env } from "@/lib/utils/env";
import {
  IndexProposalSchema,
  type IndexProposalPayload,
} from "@/lib/proposals/schema";
import { priceProposal } from "@/lib/proposals/price";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean) {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
}

const valid: IndexProposalPayload = {
  id: "11111111-1111-4111-8111-111111111111",
  generatedAt: "2026-07-13T00:00:00.000Z",
  asOf: "2026-07-13T00:00:00.000Z",
  theme: "Solana ecosystem",
  name: "Solana Ecosystem Index",
  symbol: "SOLX.ssi",
  constituents: [
    { symbol: "SOL", targetWeight: 0.4 },
    { symbol: "JUP", targetWeight: 0.2 },
    { symbol: "BONK", targetWeight: 0.2 },
    { symbol: "WIF", targetWeight: 0.2 },
  ],
  evidence: [
    {
      id: "sol-anchor",
      kind: "market",
      label: "SOL as the ecosystem anchor",
      url: "https://openapi.sosovalue.com",
    },
  ],
  rationale:
    "The basket anchors 40% [ref:sol-anchor] in SOL and spreads the rest across liquid Solana tokens.",
  riskNotes: [
    "Concentrated in a single ecosystem; correlated drawdowns are likely.",
  ],
  citations: [{ ref: "sol-anchor", url: "https://openapi.sosovalue.com" }],
};

function errText(input: unknown): string {
  const r = IndexProposalSchema.safeParse(input);
  return r.success ? "" : r.error.issues.map((i) => i.message).join(" | ");
}

async function main() {
  console.log("Schema + citation validator");
  check("valid proposal passes", IndexProposalSchema.safeParse(valid).success);

  const badSum = {
    ...valid,
    constituents: [
      { symbol: "SOL", targetWeight: 0.9 },
      { symbol: "JUP", targetWeight: 0.2 },
      { symbol: "BONK", targetWeight: 0.2 },
      { symbol: "WIF", targetWeight: 0.2 },
    ],
  };
  check(
    "weights summing to 1.5 -> band violation",
    errText(badSum).includes("sum to ~1"),
  );

  const unknownRef = {
    ...valid,
    rationale: "Anchored 40% [ref:ghost] in SOL.",
  };
  check(
    "unknown [ref:id] -> unknown evidence id",
    errText(unknownRef).includes("unknown evidence id"),
  );

  const numberNoCite = {
    ...valid,
    rationale: "The basket holds $5B across four tokens.",
  };
  check(
    "number with no [ref:] -> numbers-without-citation",
    errText(numberNoCite).includes("no [ref:<evidenceId>] citations"),
  );

  console.log(`\nPricing (SONAR_DATA_SOURCE=${env().SONAR_DATA_SOURCE})`);
  const tickers = [
    "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "LINK", "UNI", "AAVE",
    "JUP", "ENA", "ONDO", "CAKE", "HYPE", "SKY", "CRV", "SHIB", "PEPE", "WIF",
    "BONK", "FLOKI", "TRUMP", "PENGU", "SPX", "PUMP",
  ];
  const w = 1 / tickers.length;
  const pricing = await priceProposal(
    tickers.map((symbol) => ({ symbol, targetWeight: w })),
  );
  console.log(
    `  coverage: ${pricing.coverage} | pricedWeight ${pricing.pricedWeight.toFixed(2)} | perUnitNavUsd ${pricing.perUnitNavUsd === null ? "null" : "$" + pricing.perUnitNavUsd.toFixed(2)}`,
  );
  if (env().SONAR_DATA_SOURCE === "fixture") {
    console.log("  (fixture mode: only ~7 symbols resolve and all price at $1)");
    check("pricing returns a coverage summary", pricing.total === tickers.length);
  } else if (pricing.priced === 0) {
    console.log("  (live mode but 0 priced: the SoSoValue key is likely 401; degrade path)");
    check("degrades to coverage 0 with null NAV", pricing.perUnitNavUsd === null);
  } else {
    check(
      "live pricing resolves most tickers with a positive NAV",
      pricing.priced >= 20 && (pricing.perUnitNavUsd ?? 0) > 0,
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
