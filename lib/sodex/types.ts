import { z } from "zod";

// Wave 1 speaks a shape that mirrors what we expect SoDEX REST to require
// once the live docs are fully public. The paper engine consumes this shape
// directly, so Wave 2 swap from paper to live is a one-file change.

export const OrderSideSchema = z.enum(["buy", "sell"]);
export const OrderKindSchema = z.enum(["spot", "perp"]);
export const OrderTypeSchema = z.enum(["market", "limit"]);
export const PositionSideSchema = z.enum(["long", "short"]);

// Wave 3 strategy dimension: which strategy book a trade/position belongs to.
export const StrategyKeySchema = z.enum(["directional", "delta-neutral"]);
export type StrategyKey = z.infer<typeof StrategyKeySchema>;
export const DEFAULT_STRATEGY: StrategyKey = "directional";

export const OrderRequestSchema = z.object({
  thesisId: z.string().uuid(),
  strategy: StrategyKeySchema.default(DEFAULT_STRATEGY),
  kind: OrderKindSchema,
  market: z.string(),
  side: OrderSideSchema,
  type: OrderTypeSchema,
  notionalUSD: z.number().positive(),
  limitPrice: z.number().positive().optional(),
  slippageBps: z.number().int().nonnegative().default(50),
});
export type OrderRequest = z.infer<typeof OrderRequestSchema>;
// Input shape (strategy optional; defaults to "directional" on parse). placeOrder
// accepts this so existing callers need not specify strategy.
export type OrderRequestInput = z.input<typeof OrderRequestSchema>;

export const ExecutedTradeSchema = z.object({
  id: z.string().uuid(),
  thesisId: z.string().uuid(),
  strategy: StrategyKeySchema.default(DEFAULT_STRATEGY),
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
  strategy: StrategyKeySchema.default(DEFAULT_STRATEGY),
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

// ----------------------------------------------------------------------------
// Wave 2 SoDEX testnet response shapes.
//
// All schemas use .passthrough() so the wire returning fields beyond what we
// model does not break parsing. Per docs/sodex-live.md, the SoDEX REST surface
// is not exhaustively documented; we only validate the fields we read.
//
// Order status responses use single-character field codes (c, X, i, ps, etc.)
// per the REST v1 schema page; we coerce them into the longer-form names that
// our internal code uses.
// ----------------------------------------------------------------------------

// Documented wire-side status enum per the schema page.
export const SodexOrderStatusSchema = z.enum([
  "NEW",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
]);
export type SodexOrderStatus = z.infer<typeof SodexOrderStatusSchema>;

// Map the SoDEX wire status onto our internal lib/db/schema.ts orderStatusEnum
// per docs/sodex-live.md §6. CANCELED and EXPIRED collapse onto failed.
export function mapSodexStatus(
  s: SodexOrderStatus,
): "submitted" | "partially_filled" | "filled" | "failed" | "rejected" {
  switch (s) {
    case "NEW":
      return "submitted";
    case "PARTIALLY_FILLED":
      return "partially_filled";
    case "FILLED":
      return "filled";
    case "REJECTED":
      return "rejected";
    case "CANCELED":
    case "EXPIRED":
      return "failed";
  }
}

// Account state response. We only read `aid` (account id); everything else
// flows through .passthrough().
export const AccountStateSchema = z
  .object({
    aid: z.number(),
  })
  .passthrough();
export type AccountState = z.infer<typeof AccountStateSchema>;

// Symbol info returned from the listing endpoint. The schema page documents
// id + name as mandatory; we don't read the other fields directly.
export const SymbolInfoSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    // Venue trading rules (present in the live symbols listing). Used to size
    // market sells, which must send a step-aligned quantity, not funds.
    quantityPrecision: z.number().optional(),
    stepSize: z.string().optional(),
    minQuantity: z.string().optional(),
    minNotional: z.string().optional(),
  })
  .passthrough();
export type SymbolInfo = z.infer<typeof SymbolInfoSchema>;

// Order status payload (single-character field codes). Phase 2.2 uses this
// when polling for fills.
export const SodexOrderSnapshotSchema = z
  .object({
    c: z.string(),               // clOrdID
    X: SodexOrderStatusSchema,   // status
    i: z.union([z.string(), z.number()]).optional(), // system order id (we coerce to string)
  })
  .passthrough();
export type SodexOrderSnapshot = z.infer<typeof SodexOrderSnapshotSchema>;
