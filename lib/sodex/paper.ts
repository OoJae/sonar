// No `import "server-only"`: this module is called both from Next API routes
// and from CLI scripts (scripts/seed.ts). Same reasoning as lib/db/client.ts.
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  OrderRequestSchema,
  type ExecutedTrade,
  type OrderRequestInput,
  type PaperPosition,
  type StrategyKey,
} from "./types";
import { logger } from "@/lib/utils/logger";
import { getPriceUSD } from "@/lib/prices";
import { computeNav } from "@/lib/ssi/nav";
import type { SsiIndexKey } from "@/lib/ssi/addresses";

// Position marks come from live sources, never hardcoded quotes. SSI index legs
// mark to live computeNav (the same source the NAV-per-share chart uses, so the
// Positions table and the chart never disagree); perp legs mark to the base
// asset's live SoSoValue price. FALLBACK_PRICES_USD is an emergency-only path
// for a brief live-source outage (an RPC blip), never the primary mark.
const SSI_MARKETS: Record<string, SsiIndexKey> = {
  "MAG7.ssi": "MAG7",
  "DEFI.ssi": "DEFI",
  "MEME.ssi": "MEME",
  USSI: "USSI",
};

const FALLBACK_PRICES_USD: Record<string, number> = {
  "BTC-PERP": 64_000,
  "ETH-PERP": 1_900,
  "SOL-PERP": 82,
};

const FEE_BPS = 10;

async function priceOf(market: string): Promise<number> {
  const ssiIndex = SSI_MARKETS[market];
  if (ssiIndex) {
    const nav = await computeNav(ssiIndex);
    if (nav.navPerShareUSD !== null && nav.navPerShareUSD > 0) {
      return nav.navPerShareUSD;
    }
  } else {
    const base = market.replace(/-(perp|usd)$/i, "");
    const px = await getPriceUSD(base);
    if (px && px > 0) return px;
  }
  const fallback = FALLBACK_PRICES_USD[market];
  if (fallback === undefined) {
    throw new Error(
      `Paper engine: no live price for ${market} and no fallback configured.`,
    );
  }
  logger.warn("paper.using_fallback_price", { market, fallback });
  return fallback;
}

function applySlippage(price: number, side: "buy" | "sell", bps: number): number {
  const factor = side === "buy" ? 1 + bps / 10_000 : 1 - bps / 10_000;
  return price * factor;
}

export async function placeOrder(
  input: OrderRequestInput,
): Promise<ExecutedTrade> {
  const req = OrderRequestSchema.parse(input);
  const mid = await priceOf(req.market);
  const fillPrice =
    req.type === "limit" && req.limitPrice
      ? req.limitPrice
      : applySlippage(mid, req.side, req.slippageBps);
  const quantity = req.notionalUSD / fillPrice;
  const feeUSD = (req.notionalUSD * FEE_BPS) / 10_000;

  const trade: ExecutedTrade = {
    id: randomUUID(),
    thesisId: req.thesisId,
    strategy: req.strategy,
    market: req.market,
    side: req.side,
    kind: req.kind,
    type: req.type,
    notionalUSD: req.notionalUSD,
    fillPrice,
    fillQuantity: quantity,
    slippageBps: req.slippageBps,
    feeUSD,
    executedAt: new Date().toISOString(),
  };

  await db().insert(schema.paperTrades).values({
    id: trade.id,
    thesisId: trade.thesisId,
    strategy: trade.strategy,
    market: trade.market,
    kind: trade.kind,
    side: trade.side,
    type: trade.type,
    notionalUsd: String(trade.notionalUSD),
    fillPrice: String(trade.fillPrice),
    fillQuantity: String(trade.fillQuantity),
    slippageBps: trade.slippageBps,
    feeUsd: String(trade.feeUSD),
    executedAt: new Date(trade.executedAt),
  });

  await upsertPosition(trade);

  logger.info("paper.trade_executed", {
    market: trade.market,
    side: trade.side,
    notionalUSD: trade.notionalUSD,
    fillPrice: trade.fillPrice,
  });

  return trade;
}

async function upsertPosition(trade: ExecutedTrade): Promise<void> {
  const existing = await db()
    .select()
    .from(schema.paperPositions)
    .where(
      and(
        eq(schema.paperPositions.strategy, trade.strategy),
        eq(schema.paperPositions.market, trade.market),
      ),
    )
    .limit(1);

  const current = existing[0];
  let delta = trade.side === "buy" ? trade.fillQuantity : -trade.fillQuantity;

  // Spot (SSI index) legs cannot go short in the paper book: a sell may only
  // reduce a held long, never flip it negative. Clamp the sell to the held
  // quantity so /portfolio never shows a nonsensical short SSI position.
  if (trade.kind === "spot" && delta < 0) {
    const heldLong =
      current && current.side === "long" ? Number(current.quantity) : 0;
    delta = Math.max(delta, -heldLong);
  }

  if (!current) {
    if (delta === 0) return;
    await db().insert(schema.paperPositions).values({
      strategy: trade.strategy,
      market: trade.market,
      kind: trade.kind,
      side: delta > 0 ? "long" : "short",
      quantity: String(Math.abs(delta)),
      avgEntryPrice: String(trade.fillPrice),
      markPrice: String(trade.fillPrice),
      unrealizedPnlUsd: "0",
      updatedAt: new Date(),
    });
    return;
  }

  const prevQty = Number(current.quantity) * (current.side === "long" ? 1 : -1);
  const nextQty = prevQty + delta;
  const absNext = Math.abs(nextQty);

  // If we flipped through zero, start a new avg on the residual.
  const sameDirection = Math.sign(prevQty) === Math.sign(nextQty) && nextQty !== 0;
  const avgEntryPrice = sameDirection
    ? (Number(current.avgEntryPrice) * Math.abs(prevQty) +
        trade.fillPrice * Math.abs(delta)) /
      (Math.abs(prevQty) + Math.abs(delta))
    : trade.fillPrice;

  const nextSide: "long" | "short" = nextQty >= 0 ? "long" : "short";
  const markPrice = await priceOf(trade.market);
  const unrealized =
    (markPrice - avgEntryPrice) * absNext * (nextSide === "long" ? 1 : -1);

  await db()
    .update(schema.paperPositions)
    .set({
      kind: trade.kind,
      side: nextSide,
      quantity: String(absNext),
      avgEntryPrice: String(avgEntryPrice),
      markPrice: String(markPrice),
      unrealizedPnlUsd: String(unrealized),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.paperPositions.strategy, trade.strategy),
        eq(schema.paperPositions.market, trade.market),
      ),
    );
}

export async function markToMarket(): Promise<PaperPosition[]> {
  const rows = await db().select().from(schema.paperPositions);
  const updates: PaperPosition[] = [];
  for (const row of rows) {
    let mark: number;
    try {
      mark = await priceOf(row.market);
    } catch (err) {
      logger.warn("paper.mark_to_market_skip", {
        market: row.market,
        error: err instanceof Error ? err.message : String(err),
      });
      mark = Number(row.markPrice);
    }
    const qty = Number(row.quantity);
    const entry = Number(row.avgEntryPrice);
    const unrealized = (mark - entry) * qty * (row.side === "long" ? 1 : -1);
    await db()
      .update(schema.paperPositions)
      .set({
        markPrice: String(mark),
        unrealizedPnlUsd: String(unrealized),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.paperPositions.strategy, row.strategy),
          eq(schema.paperPositions.market, row.market),
        ),
      );
    updates.push({
      strategy: row.strategy as StrategyKey,
      market: row.market,
      kind: row.kind,
      side: row.side,
      quantity: qty,
      avgEntryPrice: entry,
      markPrice: mark,
      unrealizedPnlUSD: unrealized,
      updatedAt: new Date().toISOString(),
    });
  }
  return updates;
}

export async function getPositions(
  strategy?: StrategyKey,
): Promise<PaperPosition[]> {
  const rows = await db()
    .select()
    .from(schema.paperPositions)
    .where(
      strategy ? eq(schema.paperPositions.strategy, strategy) : undefined,
    );
  return rows.map((row) => ({
    strategy: row.strategy as StrategyKey,
    market: row.market,
    kind: row.kind,
    side: row.side,
    quantity: Number(row.quantity),
    avgEntryPrice: Number(row.avgEntryPrice),
    markPrice: Number(row.markPrice),
    unrealizedPnlUSD: Number(row.unrealizedPnlUsd),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function recentTrades(limit = 20) {
  return db()
    .select({
      trade: schema.paperTrades,
      thesisGeneratedAt: schema.theses.generatedAt,
      thesisMode: schema.theses.mode,
      thesisRunId: schema.theses.runId,
    })
    .from(schema.paperTrades)
    .leftJoin(
      schema.theses,
      eq(schema.paperTrades.thesisId, schema.theses.id),
    )
    .orderBy(desc(schema.paperTrades.executedAt))
    .limit(limit);
}

export async function tradesForThesis(thesisId: string) {
  return db()
    .select()
    .from(schema.paperTrades)
    .where(and(eq(schema.paperTrades.thesisId, thesisId)))
    .orderBy(desc(schema.paperTrades.executedAt));
}
