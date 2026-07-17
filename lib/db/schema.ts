import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  numeric,
  integer,
  boolean,
  bigint,
  pgEnum,
  primaryKey,
  index,
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

// States the SoDEX round trip flows through.
// pending_approval: recorded by a live-mainnet cycle and NEVER submitted. Only
//   the bearer-gated POST /api/orders/approve moves it on. The autonomous cycle
//   cannot submit real money; a human claims the row first.
// pending: persisted before any network call (idempotency floor). On mainnet a
//   row reaches this only via an approval claim, which also stamps approvedAt.
// submitted: SoDEX accepted the order and returned a sodexOrderId. Also the
//   parking state for a poll timeout, so the row stays reconcilable.
// partially_filled / filled / failed: terminal states from order status polling.
// rejected: blocked by the risk gate before submission (never reached the wire),
//   or superseded by a newer pending_approval row for the same market.
export const orderStatusEnum = pgEnum("order_status", [
  "pending_approval",
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
  // True when a test script, not the agent, created this run. Smoke tests must
  // seed a run because orders.runId is a notNull FK, so their rows land in the
  // same tables the public /log reads. The flag keeps them out of the decision
  // log without deleting real fill history, and a crashed smoke leaves a row
  // that is marked rather than one that lies.
  synthetic: boolean("synthetic").notNull().default(false),
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
  // The execution mode this order was recorded under ("paper" | "live-testnet"
  // | "live-mainnet"). Load-bearing, not informational: the SoDEX gateway is
  // chosen from the CURRENT env at submit time (lib/sodex/client.ts sodexChain),
  // so without this a row queued on mainnet, then approved after someone pulls
  // the kill switch to testnet, would fill on TESTNET and be recorded as a
  // mainnet fill. submitApprovedOrder refuses when this does not match.
  mode: text("mode"),
  // Approval audit for the live-mainnet human gate. approvedAt is stamped by
  // the atomic claim in POST /api/orders/approve, which is the only writer that
  // may move a row out of pending_approval.
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: text("approved_by"),
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

// Wave 3 session-key delegation. One row per signed EIP-712 SessionGrant: a
// user authorizes the agent's session key to trade a scoped set of markets up
// to a per-order notional, until an expiry, revocably. Enforced app-side at the
// executor when SONAR_REQUIRE_DELEGATION is on. "Active" is derived, not stored:
// revokedAt IS NULL AND supersededAt IS NULL AND expiresAt > now().
export const delegations = pgTable(
  "delegations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Lowercased 0x addresses; compared checksum-insensitively.
    grantor: text("grantor").notNull(),
    sessionKey: text("session_key").notNull(),
    // Canonical executor-entry market tokens (MAG7.ssi, BTC-PERP, ...).
    allowedMarkets: jsonb("allowed_markets").notNull(),
    maxNotionalPerOrderUsd: numeric("max_notional_per_order_usd", {
      precision: 20,
      scale: 6,
    }).notNull(),
    chainId: integer("chain_id").notNull().default(8453),
    // uint256 nonce as text to avoid bigint precision loss.
    nonce: text("nonce").notNull(),
    // 0x + 130 hex. Unique => idempotent re-POST, replay-safe.
    signature: text("signature").notNull().unique(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeSignature: text("revoke_signature"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    sessionKeyIdx: index("delegations_session_key_idx").on(t.sessionKey),
    grantorIdx: index("delegations_grantor_idx").on(t.grantor),
  }),
);

// Wave 3 custom SSI index proposals. One row per agent-generated themed basket
// (constituents + weights + cited rationale + pricing coverage). A design
// artifact that maps onto SSI Protocol on-chain index creation; never created
// on-chain. Decoupled from runAgentCycle (its own on-demand generator), so no
// agent_runs FK. The full validated object + pricing snapshot lives in payload.
export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey(), // app-stamped
  theme: text("theme").notNull(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("valid"),
  coveragePriced: integer("coverage_priced").notNull().default(0),
  coverageTotal: integer("coverage_total").notNull().default(0),
  perUnitNavUsd: numeric("per_unit_nav_usd", { precision: 20, scale: 6 }),
  rationale: text("rationale").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Wave 3 delta-neutral track. One row per cycle capturing the delta-neutral
// book's mark-to-market state (after markToMarket), so /track can plot the second
// strategy's net-exposure neutrality curve + P&L. Written only when the DN book
// has positions, so the series starts when the book is established (no backfill).
export const dnSnapshots = pgTable("dn_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  longUsd: numeric("long_usd", { precision: 20, scale: 6 }).notNull(),
  shortUsd: numeric("short_usd", { precision: 20, scale: 6 }).notNull(),
  netUsd: numeric("net_usd", { precision: 20, scale: 6 }).notNull(),
  grossUsd: numeric("gross_usd", { precision: 20, scale: 6 }).notNull(),
  unrealizedPnlUsd: numeric("unrealized_pnl_usd", {
    precision: 20,
    scale: 6,
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Wave 3+ proposal arena: one row per proposal per daily cycle, capturing the
// basket's pricing so each AI-designed index accrues a FORWARD test from its
// creation. marks (per-symbol {symbol, weight, priceUsd}) is load-bearing: the
// indexed curve chain-links per-period returns over the intersection of symbols
// priced in consecutive snapshots (the lib/track/compute.ts methodology), so a
// symbol dropping out of coverage cannot fake a return.
export const proposalSnapshots = pgTable(
  "proposal_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    perUnitNavUsd: numeric("per_unit_nav_usd", { precision: 20, scale: 6 }),
    pricedWeight: numeric("priced_weight", { precision: 10, scale: 6 })
      .notNull()
      .default(sql`0`),
    priced: integer("priced").notNull().default(0),
    total: integer("total").notNull().default(0),
    marks: jsonb("marks").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byProposal: index("proposal_snapshots_proposal_as_of_idx").on(
      t.proposalId,
      t.asOf,
    ),
  }),
);

// Telegram subscribers (users who sent /start to the bot). chat_id is BIGINT:
// Telegram ids exceed int32. Broadcast marks blocked users inactive (403).
export const telegramSubscribers = pgTable("telegram_subscribers", {
  chatId: bigint("chat_id", { mode: "number" }).primaryKey(),
  active: boolean("active").notNull().default(true),
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
export type DelegationRow = typeof delegations.$inferSelect;
export type ProposalRow = typeof proposals.$inferSelect;
export type DnSnapshotRow = typeof dnSnapshots.$inferSelect;
export type TelegramSubscriberRow = typeof telegramSubscribers.$inferSelect;
export type ProposalSnapshotRow = typeof proposalSnapshots.$inferSelect;
