#!/usr/bin/env tsx
import "./_env";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { ThesisSchema, type Thesis } from "@/lib/agent/thesis";
import { placeOrder } from "@/lib/sodex/paper";

function demoThesis(): Thesis {
  const now = new Date().toISOString();
  const flowId = `flow-BTC-${randomUUID().slice(0, 8)}`;
  const newsId = `news-seed-1`;
  return {
    id: randomUUID(),
    generatedAt: now,
    asOf: now,
    universe: ["MAG7", "DEFI", "MEME"],
    mode: "trade",
    signals: {
      etfFlowSignal: [
        {
          id: flowId,
          asset: "BTC",
          direction: "inflow",
          magnitudeUSD: 1_240_000_000,
          windowDays: 7,
          confidence: 0.82,
          sourceEndpoint: "/api/v1/etf/historicalInflowChart",
        },
      ],
      newsSignals: [
        {
          id: newsId,
          currency: "BTC",
          category: "etf",
          headline: "Seeded: BTC ETFs log fifth straight day of net inflows",
          url: "https://sosovalue.com/news/btc-etf-streak",
          stance: "bullish",
          confidence: 0.7,
          publishedAt: now,
        },
      ],
    },
    reasoning:
      "Seed thesis. BTC ETFs printed $1.24B of net inflow over the last seven sessions [ref:" +
      flowId +
      "] and news flow is constructive [ref:" +
      newsId +
      "]. MAG7 gets the majority weight on that read. Residual stays in USSI to preserve optionality.",
    proposedAllocations: [
      { index: "MAG7", targetWeight: 0.5, deltaFromCurrent: 5000 },
      { index: "DEFI", targetWeight: 0.25, deltaFromCurrent: 0 },
      { index: "MEME", targetWeight: 0.1, deltaFromCurrent: -1500 },
    ],
    hedges: [],
    riskNotes: [
      "ETF flows are end-of-day, not intraday; cadence is 24h minimum.",
      "This is a seed thesis produced by scripts/seed.ts, not a real agent run.",
    ],
    citations: [
      { ref: flowId, url: "https://openapi.sosovalue.com" },
      { ref: newsId, url: "https://sosovalue.com/news/btc-etf-streak" },
    ],
  };
}

async function main() {
  const run = {
    id: randomUUID(),
    model: "seed",
    dataSource: "fixture",
    startedAt: new Date(),
    finishedAt: new Date(),
    ok: true,
    // A dev fixture, not an agent decision: keep it off /log, /track, /signals,
    // and the public API, which all now filter on this flag.
    synthetic: true,
  };
  await db().insert(schema.agentRuns).values(run);

  const t = demoThesis();
  const parsed = ThesisSchema.safeParse(t);
  if (!parsed.success) {
    console.error("Seed thesis invalid", parsed.error.issues);
    process.exit(1);
  }

  await db().insert(schema.theses).values({
    id: t.id,
    runId: run.id,
    generatedAt: new Date(t.generatedAt),
    asOf: new Date(t.asOf),
    mode: t.mode,
    status: "valid",
    reasoning: t.reasoning,
    payload: t,
  });

  const signalRows = [
    ...t.signals.etfFlowSignal.map((s) => ({
      id: s.id,
      thesisId: t.id,
      kind: "etf_flow",
      payload: s,
      sourceEndpoint: s.sourceEndpoint,
    })),
    ...t.signals.newsSignals.map((s) => ({
      id: s.id,
      thesisId: t.id,
      kind: "news",
      payload: s,
      sourceEndpoint: null,
    })),
  ];
  await db().insert(schema.signals).values(signalRows);

  // Execute the seeded thesis's allocations through the paper engine so
  // Portfolio renders populated rows even before the first live agent run.
  let tradeCount = 0;
  for (const alloc of t.proposedAllocations) {
    if (alloc.deltaFromCurrent === 0) continue;
    await placeOrder({
      thesisId: t.id,
      kind: "spot",
      market: `${alloc.index}.ssi`,
      side: alloc.deltaFromCurrent > 0 ? "buy" : "sell",
      type: "market",
      notionalUSD: Math.abs(alloc.deltaFromCurrent),
      slippageBps: 50,
    });
    tradeCount += 1;
  }

  console.log(`Seeded thesis ${t.id} with ${tradeCount} paper trade(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
