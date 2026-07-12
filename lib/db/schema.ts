import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  numeric,
  integer,
  boolean,
  pgEnum,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const thesisModeEnum = pgEnum("thesis_mode", ["trade", "no-trade"]);
export const thesisStatusEnum = pgEnum("thesis_status", [
  "valid",
  "rejected",
  "superseded",
]);
export const orderSideEnum = pgEnum("order_side", ["buy", "sell"]);
export const orderKindEnum = pgEnum("order_kind", ["spot", "perp"]);
export const orderTypeEnum = pgEnum("order_type", ["market", "limit"]);
export const positionSideEnum = pgEnum("position_side", ["long", "short"]);

// Wave 2 live executor: states the SoDEX testnet round trip flows through.
// pending: persisted before any network call (idempotency floor).
// submitted: SoDEX accepted the order and returned a sodexOrderId.
// partially_filled / filled / failed: terminal states from order status polling.
// rejected: blocked by the risk gate before submission (never reached the wire).
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "submitted",
  "partially_filled",
  "filled",
  "failed",
  "rejected",
]);

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  model: text("model").notNull(),
  traceId: text("trace_id"),
  dataSource: text("data_source").notNull(),
  ok: boolean("ok").notNull().default(false),
  error: text("error"),
  // Macro circuit breaker (Wave 2 edge): set when a high-impact macro event in
  // the lookahead horizon made the cycle de-risk. Human-readable, cites the
  // event. Null on normal cycles.
  haltReason: text("halt_reason"),
});

export const theses = pgTable("theses", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").references(() => agentRuns.id),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  mode: thesisModeEnum("mode").notNull().default("trade"),
  status: thesisStatusEnum("status").notNull().default("valid"),
  // Wave 3 strategy dimension: which strategy book this thesis belongs to.
  // "directional" (the Wave 2 LLM rebalance) or "delta-neutral" (rules-based).
  strategy: text("strategy").notNull().default("directional"),
  reasoning: text("reasoning").notNull(),
  payload: jsonb("payload").notNull(),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const signals = pgTable(
  "signals",
  {
    id: text("id").notNull(),
    thesisId: uuid("thesis_id")
      .notNull()
      .references(() => theses.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    sourceEndpoint: text("source_endpoint"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.thesisId, t.id] }),
  }),
);

export const paperTrades = pgTable("paper_trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  thesisId: uuid("thesis_id")
    .notNull()
    .references(() => theses.id),
  strategy: text("strategy").notNull().default("directional"),
  market: text("market").notNull(),
  kind: orderKindEnum("kind").notNull(),
  side: orderSideEnum("side").notNull(),
  type: orderTypeEnum("type").notNull(),
  notionalUsd: numeric("notional_usd", { precision: 20, scale: 6 }).notNull(),
  fillPrice: numeric("fill_price", { precision: 20, scale: 10 }).notNull(),
  fillQuantity: numeric("fill_quantity", { precision: 30, scale: 12 }).notNull(),
  slippageBps: integer("slippage_bps").notNull().default(50),
  feeUsd: numeric("fee_usd", { precision: 20, scale: 6 }).notNull().default(sql`0`),
  executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const paperPositions = pgTable(
  "paper_positions",
  {
    // Composite PK (strategy, market): each strategy keeps an isolated book, so
    // two strategies can hold a position in the same market independently.
    strategy: text("strategy").notNull().default("directional"),
    market: text("market").notNull(),
    kind: orderKindEnum("kind").notNull(),
    side: positionSideEnum("side").notNull(),
    quantity: numeric("quantity", { precision: 30, scale: 12 }).notNull(),
    avgEntryPrice: numeric("avg_entry_price", { precision: 20, scale: 10 }).notNull(),
    markPrice: numeric("mark_price", { precision: 20, scale: 10 }).notNull(),
    unrealizedPnlUsd: numeric("unrealized_pnl_usd", { precision: 20, scale: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.strategy, t.market] }),
  }),
);

// Wave 2 live orders. Mirrors the paperTrades shape for the fields we already
// track, plus the live-only fields (clientOrderId for idempotency, sodexOrderId
// for the wire-side correlation, status for the polling state machine).
// clientOrderId carries a UNIQUE constraint: a retried cycle with the same
// (thesisId, market, cycleSeq) computes the same clientOrderId and the second
// insert fails fast at the database, so a double-place is impossible. This is
// the load-bearing test in scripts/sodex-live-smoke.ts.
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientOrderId: text("client_order_id").notNull().unique(),
  sodexOrderId: text("sodex_order_id"),
  thesisId: uuid("thesis_id")
    .notNull()
    .references(() => theses.id),
  runId: uuid("run_id")
    .notNull()
    .references(() => agentRuns.id),
  strategy: text("strategy").notNull().default("directional"),
  market: text("market").notNull(),
  side: orderSideEnum("side").notNull(),
  kind: orderKindEnum("kind").notNull(),
  notionalUsd: numeric("notional_usd", { precision: 20, scale: 6 }).notNull(),
  status: orderStatusEnum("status").notNull().default("pending"),
  rejectionReason: text("rejection_reason"),
  fillPrice: numeric("fill_price", { precision: 20, scale: 10 }),
  fillQuantity: numeric("fill_quantity", { precision: 30, scale: 12 }),
  feeUsd: numeric("fee_usd", { precision: 20, scale: 6 }),
  // Cross-chain transaction reference (ValueChain tx hash or similar). For
  // off-chain venue fills this stays the sodexOrderId as a stable handle.
  txRef: text("tx_ref"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  filledAt: timestamp("filled_at", { withTimezone: true }),
});

// Wave 2 NAV snapshots. One row per index per cycle. The Portfolio chart reads
// these as the time series and overlays a buy-and-hold baseline computed from
// the earliest snapshot of each index.
export const navSnapshots = pgTable("nav_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  // index symbol without the .ssi suffix: "MAG7" | "DEFI" | "MEME" | "USSI".
  index: text("index").notNull(),
  navPerShareUsd: numeric("nav_per_share_usd", {
    precision: 20,
    scale: 10,
  }).notNull(),
  // The wall-clock the NAV reflects (computed from the freshest price snapshot
  // input). asOf may lag createdAt by minutes due to SoSoValue cache TTLs.
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type AgentRunRow = typeof agentRuns.$inferSelect;
export type ThesisRow = typeof theses.$inferSelect;
export type SignalRow = typeof signals.$inferSelect;
export type PaperTradeRow = typeof paperTrades.$inferSelect;
export type PaperPositionRow = typeof paperPositions.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type NavSnapshotRow = typeof navSnapshots.$inferSelect;
