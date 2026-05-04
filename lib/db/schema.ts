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

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  model: text("model").notNull(),
  traceId: text("trace_id"),
  dataSource: text("data_source").notNull(),
  ok: boolean("ok").notNull().default(false),
  error: text("error"),
});

export const theses = pgTable("theses", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").references(() => agentRuns.id),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  mode: thesisModeEnum("mode").notNull().default("trade"),
  status: thesisStatusEnum("status").notNull().default("valid"),
  reasoning: text("reasoning").notNull(),
  payload: jsonb("payload").notNull(),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const signals = pgTable("signals", {
  id: text("id").primaryKey(),
  thesisId: uuid("thesis_id")
    .notNull()
    .references(() => theses.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  sourceEndpoint: text("source_endpoint"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const paperTrades = pgTable("paper_trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  thesisId: uuid("thesis_id")
    .notNull()
    .references(() => theses.id),
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

export const paperPositions = pgTable("paper_positions", {
  market: text("market").primaryKey(),
  kind: orderKindEnum("kind").notNull(),
  side: positionSideEnum("side").notNull(),
  quantity: numeric("quantity", { precision: 30, scale: 12 }).notNull(),
  avgEntryPrice: numeric("avg_entry_price", { precision: 20, scale: 10 }).notNull(),
  markPrice: numeric("mark_price", { precision: 20, scale: 10 }).notNull(),
  unrealizedPnlUsd: numeric("unrealized_pnl_usd", { precision: 20, scale: 6 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AgentRunRow = typeof agentRuns.$inferSelect;
export type ThesisRow = typeof theses.$inferSelect;
export type SignalRow = typeof signals.$inferSelect;
export type PaperTradeRow = typeof paperTrades.$inferSelect;
export type PaperPositionRow = typeof paperPositions.$inferSelect;
