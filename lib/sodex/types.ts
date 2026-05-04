import { z } from "zod";

// Wave 1 speaks a shape that mirrors what we expect SoDEX REST to require
// once the live docs are fully public. The paper engine consumes this shape
// directly, so Wave 2 swap from paper to live is a one-file change.

export const OrderSideSchema = z.enum(["buy", "sell"]);
export const OrderKindSchema = z.enum(["spot", "perp"]);
export const OrderTypeSchema = z.enum(["market", "limit"]);
export const PositionSideSchema = z.enum(["long", "short"]);

export const OrderRequestSchema = z.object({
  thesisId: z.string().uuid(),
  kind: OrderKindSchema,
  market: z.string(),
  side: OrderSideSchema,
  type: OrderTypeSchema,
  notionalUSD: z.number().positive(),
  limitPrice: z.number().positive().optional(),
  slippageBps: z.number().int().nonnegative().default(50),
});
export type OrderRequest = z.infer<typeof OrderRequestSchema>;

export const ExecutedTradeSchema = z.object({
  id: z.string().uuid(),
  thesisId: z.string().uuid(),
  market: z.string(),
  side: OrderSideSchema,
  kind: OrderKindSchema,
  type: OrderTypeSchema,
  notionalUSD: z.number(),
  fillPrice: z.number(),
  fillQuantity: z.number(),
  slippageBps: z.number(),
  feeUSD: z.number().nonnegative(),
  executedAt: z.string().datetime(),
});
export type ExecutedTrade = z.infer<typeof ExecutedTradeSchema>;

export const PaperPositionSchema = z.object({
  market: z.string(),
  kind: OrderKindSchema,
  side: PositionSideSchema,
  quantity: z.number(),
  avgEntryPrice: z.number(),
  markPrice: z.number(),
  unrealizedPnlUSD: z.number(),
  updatedAt: z.string().datetime(),
});
export type PaperPosition = z.infer<typeof PaperPositionSchema>;

export const SpotPairSchema = z.object({
  symbol: z.string(),
  baseAsset: z.string(),
  quoteAsset: z.string(),
  minNotional: z.number().optional(),
});
export type SpotPair = z.infer<typeof SpotPairSchema>;
