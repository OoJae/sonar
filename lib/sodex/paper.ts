// No `import "server-only"`: this module is called both from Next API routes
// and from CLI scripts (scripts/seed.ts). Same reasoning as lib/db/client.ts.
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  OrderRequestSchema,
  type ExecutedTrade,
  type OrderRequest,
  type PaperPosition,
} from "./types";
import { logger } from "@/lib/utils/logger";

// Wave 1 reference prices: simple static quotes. In Phase B step 18 we swap
// these for marks derived from SoSoValue currentEtfDataMetrics + a public
// price oracle. Keeping a single source-of-prices function lets us swap later
// in one place.
const REFERENCE_PRICES_USD: Record<string, number> = {
  "BTC-PERP": 97_500,
  "ETH-PERP": 3_650,
  "SOL-PERP": 172,
  "MAG7.ssi": 132.4,
  "DEFI.ssi": 48.2,
  "MEME.ssi": 12.7,
  "USSI": 1.0,
};

const FEE_BPS = 10;

function priceOf(market: string): number {
  const p = REFERENCE_PRICES_USD[market];
  if (p === undefined) {
    throw new Error(
      `Paper engine has no reference price for ${market}. Add it to REFERENCE_PRICES_USD or resolve from a live source.`,
    );
  }
  return p;
}

function applySlippage(price: number, side: "buy" | "sell", bps: number): number {
  const factor = side === "buy" ? 1 + bps / 10_000 : 1 - bps / 10_000;
  return price * factor;
}

export async function placeOrder(input: OrderRequest): Promise<ExecutedTrade> {
  const req = OrderRequestSchema.parse(input);
  const mid = priceOf(req.market);
  const fillPrice =
    req.type === "limit" && req.limitPrice
      ? req.limitPrice
      : applySlippage(mid, req.side, req.slippageBps);
  const quantity = req.notionalUSD / fillPrice;
  const feeUSD = (req.notionalUSD * FEE_BPS) / 10_000;

  const trade: ExecutedTrade = {
    id: randomUUID(),
    thesisId: req.thesisId,
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
    .where(eq(schema.paperPositions.market, trade.market))
    .limit(1);

  const current = existing[0];
  const delta = trade.side === "buy" ? trade.fillQuantity : -trade.fillQuantity;

  if (!current) {
    if (delta === 0) return;
    await db().insert(schema.paperPositions).values({
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
  const markPrice = priceOf(trade.market);
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
    .where(eq(schema.paperPositions.market, trade.market));
}

export async function markToMarket(): Promise<PaperPosition[]> {
  const rows = await db().select().from(schema.paperPositions);
  const updates: PaperPosition[] = [];
  for (const row of rows) {
    const mark = priceOf(row.market);
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
      .where(eq(schema.paperPositions.market, row.market));
    updates.push({
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

export async function getPositions(): Promise<PaperPosition[]> {
  const rows = await db().select().from(schema.paperPositions);
  return rows.map((row) => ({
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
    .select()
    .from(schema.paperTrades)
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
