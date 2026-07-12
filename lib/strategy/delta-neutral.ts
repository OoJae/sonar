// Wave 3 delta-neutral strategy (rules-based, no LLM).
//
// A market-neutral carry book that runs beside the directional strategy in the
// same cycle: long the MAG7 SSI basket and short a BTC-USD perp sized to the
// basket's on-chain BTC weight, so the dominant crypto beta nets to ~0 while
// the book harvests the index-vs-perp basis and funding. Legs are sized to one
// order cap so the executed book is genuinely balanced (the short is not
// downsized by the risk gate). It reuses the executor, the paper/live book
// (tagged strategy "delta-neutral"), and the thesis persistence + validator.

import { randomUUID } from "node:crypto";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { getPriceUSD } from "@/lib/prices";
import { readIndexSnapshot } from "@/lib/ssi/reader";
import { placeOrder, getPositions } from "@/lib/sodex/executor";
import { persistThesis } from "@/lib/agent/persist";
import { ThesisSchema } from "@/lib/agent/thesis";
import type { OrderRequestInput, PaperPosition } from "@/lib/sodex/types";

const STRATEGY = "delta-neutral" as const;
const LONG_MARKET = "MAG7.ssi";
const SHORT_MARKET = "BTC-PERP";
const DUST_USD = 10;
// Fallback if the on-chain tokenset does not expose a recognizable BTC symbol.
const FALLBACK_BTC_WEIGHT = 0.4;

// MAG7's BTC weight (fraction of NAV in bitcoin) from the on-chain tokenset x
// live prices, so the BTC-perp short offsets the dominant beta.
async function mag7BtcWeight(): Promise<number> {
  const snap = await readIndexSnapshot("MAG7");
  if (snap.tokenset.length === 0) return FALLBACK_BTC_WEIGHT;
  let nav = 0;
  let btcValue = 0;
  for (const t of snap.tokenset) {
    const price = await getPriceUSD(t.symbol);
    if (price === null) continue;
    const v = Number(t.amount) * price;
    if (!Number.isFinite(v) || v <= 0) continue;
    nav += v;
    const sym = t.symbol.toUpperCase();
    if (sym === "BTC" || sym === "WBTC" || sym === "BTCB") btcValue += v;
  }
  if (nav <= 0 || btcValue <= 0) return FALLBACK_BTC_WEIGHT;
  return btcValue / nav;
}

// Signed USD value of a market in the book (positive long, negative short).
function signedValue(positions: PaperPosition[], market: string): number {
  const p = positions.find((x) => x.market === market);
  if (!p) return 0;
  return p.markPrice * p.quantity * (p.side === "long" ? 1 : -1);
}

export async function runDeltaNeutral(
  runId: string,
  deRiskFactor = 1,
): Promise<void> {
  const scale = Math.max(0, Math.min(1, deRiskFactor));
  const N = env().SONAR_MAX_NOTIONAL_PER_ORDER * scale;
  if (N < DUST_USD) return;

  // Prices are required to size the neutral hedge; skip gracefully without them
  // (e.g. the SoSoValue key is down).
  let btcPrice: number | null;
  let btcWeight: number;
  try {
    btcPrice = await getPriceUSD("BTC");
    if (btcPrice === null || btcPrice <= 0) {
      logger.info("delta_neutral.skip_no_price", {});
      return;
    }
    btcWeight = await mag7BtcWeight();
  } catch (err) {
    logger.warn("delta_neutral.price_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const targetLongUsd = N;
  const targetShortUsd = N * btcWeight;

  const positions = await getPositions(STRATEGY).catch(() => [] as PaperPosition[]);
  const curLongUsd = signedValue(positions, LONG_MARKET); // >0 when long
  const curShortUsd = -signedValue(positions, SHORT_MARKET); // >0 when short

  const longDelta = targetLongUsd - curLongUsd; // >0 buy, <0 sell
  const shortDelta = targetShortUsd - curShortUsd; // >0 add short, <0 cover

  const thesisId = randomUUID();
  const legs: OrderRequestInput[] = [];
  if (Math.abs(longDelta) >= DUST_USD) {
    legs.push({
      thesisId,
      strategy: STRATEGY,
      kind: "spot",
      market: LONG_MARKET,
      side: longDelta > 0 ? "buy" : "sell",
      type: "market",
      notionalUSD: Math.abs(longDelta),
      slippageBps: 50,
    });
  }
  if (Math.abs(shortDelta) >= DUST_USD) {
    legs.push({
      thesisId,
      strategy: STRATEGY,
      kind: "perp",
      market: SHORT_MARKET,
      side: shortDelta > 0 ? "sell" : "buy", // sell opens/increases the short
      type: "market",
      notionalUSD: Math.abs(shortDelta),
      slippageBps: 50,
    });
  }

  if (legs.length === 0) {
    logger.info("delta_neutral.already_balanced", { runId });
    return; // no thesis persisted once the book is at target
  }

  const nowIso = new Date().toISOString();
  const payload = {
    id: thesisId,
    generatedAt: nowIso,
    asOf: nowIso,
    universe: ["MAG7"],
    signals: {
      etfFlowSignal: [
        {
          id: "dn-btc-mark",
          asset: "BTC",
          direction: "neutral",
          magnitudeUSD: btcPrice,
          windowDays: 1,
          confidence: 0.9,
          sourceEndpoint: "/currencies/bitcoin/market-snapshot",
        },
      ],
      newsSignals: [],
    },
    reasoning:
      `Delta-neutral carry. Long the MAG7 basket and short a BTC-USD perp sized ` +
      `to the basket's on-chain BTC weight of ${(btcWeight * 100).toFixed(0)}% ` +
      `[ref:dn-btc-mark], so the dominant crypto beta nets to about zero while ` +
      `the book harvests the index-versus-perp basis and funding. BTC marked ` +
      `near $${Math.round(btcPrice).toLocaleString()} [ref:dn-btc-mark]. This ` +
      `strategy is rules-based, not a discretionary call.`,
    proposedAllocations: [
      { index: "MAG7", targetWeight: 1, deltaFromCurrent: 0 },
    ],
    hedges: [
      {
        market: SHORT_MARKET,
        side: "short",
        notionalUSD: targetShortUsd,
        reason: "Offset the MAG7 basket's BTC beta to stay market-neutral.",
      },
    ],
    riskNotes: [
      "Funding can invert and erode the carry.",
      "The short hedges only the BTC beta of the basket; residual alt exposure remains.",
    ],
    citations: [{ ref: "dn-btc-mark", url: env().SOSOVALUE_BASE_URL }],
    mode: "trade",
  };

  const parsed = ThesisSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn("delta_neutral.invalid_thesis", {
      issues: parsed.error.issues.slice(0, 3),
    });
    return;
  }

  await persistThesis(runId, parsed.data, STRATEGY);

  for (const leg of legs) {
    try {
      await placeOrder(leg);
    } catch (err) {
      logger.warn("delta_neutral.leg_skipped", {
        market: leg.market,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  logger.info("delta_neutral.executed", {
    runId,
    longDelta,
    shortDelta,
    btcWeight,
  });
}
