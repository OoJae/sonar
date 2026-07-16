// SoDEX live testnet executor.
//
// Implements the same placeOrder contract as lib/sodex/paper.ts so the
// executor facade (lib/sodex/executor.ts) can route between them per env
// without the runner caring. Phase 2.2 builds; Phase 2.3 layers a dedicated
// risk gate module that Phase 2.4 wires in front of submitPerpOrder.
//
// Flow:
//   1. Compute a deterministic clientOrderId from (thesisId, market). The
//      DB unique constraint on orders.client_order_id catches double-places
//      regardless of any retry path; this is the load-bearing idempotency.
//   2. Insert the orders row as `pending`. On unique-violation, the previous
//      attempt's row is read and we resume from its state.
//   3. Risk gate (lib/sodex/risk.ts): dust floor, per-order downsize,
//      per-cycle cap, then the position caps (per-market + gross) that bound
//      the resulting book. Reducing orders are never gated.
//   4. Sign + POST /perps/trade/orders via lib/sodex/client.ts.
//   5. Update the orders row to `submitted` with the SoDEX order id.
//   6. Poll listPerpOrders by clOrdID with capped backoff until terminal.
//   7. On `filled` / `partially_filled`: insert a paper_trades row using
//      the real fill price + quantity. The existing paper engine's
//      position-tracking code then maintains paper_positions correctly,
//      so /portfolio works unchanged across modes.
//   8. Return an ExecutedTrade.

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { keccak256, stringToBytes } from "viem";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { resolveMarket } from "./markets";
import { assertOrderDelegated } from "@/lib/delegation/store";
import { getPriceUSD } from "@/lib/prices";
import {
  findOrderByClOrdID,
  getGrossPerpExposureUsd,
  getPerpPositionUsd,
  getPerpSymbolInfo,
  listPerpOrders,
  submitPerpOrder,
} from "./client";
import {
  assertModeAllowed,
  enforceGrossExposureCap,
  enforcePerCycleCap,
  enforcePerOrderCap,
  enforcePositionCap,
  isDust,
  recordPlaced,
} from "./risk";
import { mapSodexStatus, OrderRequestSchema } from "./types";
import type {
  ExecutedTrade,
  OrderRequest,
  OrderRequestInput,
  SodexOrderStatus,
  StrategyKey,
} from "./types";

// Polling: 500ms initial, 1.5x backoff, 5s cap, 30s total timeout.
const POLL_INITIAL_MS = 500;
const POLL_MULTIPLIER = 1.5;
const POLL_CAP_MS = 5000;
const POLL_TIMEOUT_MS = 30_000;

// Thrown by recordPendingMainnetOrder when a live-mainnet order has been
// recorded for human approval instead of submitted. It is a success, not a
// failure: the order is queued and waiting for a person. Callers distinguish it
// with instanceof (the DelegationDeniedError pattern) so the runner does not log
// a queued order as a skipped one. Throwing rather than returning is forced by
// ExecutedTrade, which requires a fillPrice, fillQuantity and executedAt that a
// pending order does not have.
export class PendingApprovalError extends Error {
  orderId: string;
  market: string;
  notionalUSD: number;
  constructor(orderId: string, market: string, notionalUSD: number) {
    super(
      `pending_approval: ${market} order ${orderId} recorded for human approval; approve it via POST /api/orders/approve`,
    );
    this.name = "PendingApprovalError";
    this.orderId = orderId;
    this.market = market;
    this.notionalUSD = notionalUSD;
  }
}

// Thrown when a mainnet order cannot be attributed to a real agent run. Distinct
// from PendingApprovalError so a queued order and a dropped one never look alike
// in the logs (see the strict runId resolution in recordPendingMainnetOrder).
export class OrderAttributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderAttributionError";
  }
}

// DO NOT make this stable across cycles without re-reading the idempotency
// branch in placeOrder. thesisId is a fresh uuid per cycle (runner.ts), so a
// later cycle never recomputes an earlier cycle's clOrdID and therefore never
// lands on an earlier row. That accident is load-bearing: schema.ts describes a
// clOrdID keyed by "(thesisId, market, cycleSeq)", and anyone implementing that
// stable-key idea would make a live-mainnet pending_approval row reachable by a
// later cycle, whose "pending -> fall through and submit" tail would then submit
// real money with no human approval. The explicit pending_approval branch below
// is the belt to this suspenders.
function clientOrderId(
  strategy: string,
  thesisId: string,
  market: string,
): string {
  // Deterministic 24-char alphanumeric+dash key. SoDEX testnet rejects the
  // bare keccak hex ("0x..." format) with `code: -1, error: clOrdID is
  // invalid`, so we hash and then format as `sonar-<16 lowercase hex>`. This
  // stays deterministic per (thesisId, market), matches common exchange
  // clOrdID conventions, and stays well under any reasonable length cap.
  const hash = keccak256(stringToBytes(`${strategy}:${thesisId}:${market}`));
  return `sonar-${hash.slice(2, 18)}`;
}

// Look up the current cycle's runId for the in-process cap accumulator.
// Read the most recent agent_runs row that holds this thesisId. If it does
// not exist (e.g. when invoked from a smoke script outside the runner), use
// the thesisId itself as a stable per-thesis key.
async function resolveRunIdForCap(thesisId: string): Promise<string> {
  const rows = await db()
    .select({ runId: schema.theses.runId })
    .from(schema.theses)
    .where(eq(schema.theses.id, thesisId))
    .limit(1);
  return rows[0]?.runId ?? thesisId;
}

// Record a live-mainnet order for human approval instead of submitting it.
//
// This runs the FULL risk gate before persisting and stores the CAPPED notional,
// which is the whole point: the gate lives inside placeOrder, so a mainnet path
// that skipped it would be the only path in the codebase with no dust floor and
// no per-order, per-cycle, position or gross caps. The operator must approve the
// number that will actually reach the wire, not the agent's raw request. Risk
// rejections still write their `rejected` rows exactly as the testnet path does.
//
// Always throws: PendingApprovalError on success (the order is queued), or a
// risk/attribution error. It never returns, because ExecutedTrade cannot
// describe an order that has not filled.
export async function recordPendingMainnetOrder(
  rawReq: OrderRequestInput,
): Promise<never> {
  const req = OrderRequestSchema.parse(rawReq);
  const resolution = resolveMarket(req.market);
  if (!resolution.tradeable || resolution.kind !== "perp") {
    throw new Error(
      `recordPendingMainnetOrder received a non-tradeable market "${req.market}"; the executor should have routed this to paper.`,
    );
  }

  const clOrdID = clientOrderId(req.strategy, req.thesisId, req.market);

  // Strict attribution. resolveRunIdForCap falls back to thesisId when no run
  // row exists, but orders.runId is a notNull FK to agent_runs.id, so that
  // fallback would raise a Postgres error here rather than a
  // PendingApprovalError. The runner's per-leg catch would log it as a skipped
  // leg and the mainnet order would be silently DROPPED: nothing queued, nothing
  // to approve, no visible error. Refuse loudly instead.
  const runRows = await db()
    .select({ runId: schema.theses.runId })
    .from(schema.theses)
    .where(eq(schema.theses.id, req.thesisId))
    .limit(1);
  const runId = runRows[0]?.runId;
  if (!runId) {
    throw new OrderAttributionError(
      `Cannot queue a mainnet order for thesis ${req.thesisId}: no agent run is attached to it. orders.runId is a required FK, so this order would be dropped rather than queued.`,
    );
  }

  // The full gate, in the same order as placeOrder.
  if (isDust(req.notionalUSD)) {
    throw new Error(
      `Order notional $${req.notionalUSD} for ${req.market} is below the dust floor.`,
    );
  }
  const { notionalUSD: perOrderCapped } = enforcePerOrderCap(req.notionalUSD);
  const cycleCheck = enforcePerCycleCap(runId, perOrderCapped);
  if (!cycleCheck.allow) {
    await insertOrderRow({
      clOrdID,
      thesisId: req.thesisId,
      strategy: req.strategy,
      runId,
      market: resolution.symbolName,
      kind: "perp",
      side: req.side,
      notionalUSD: perOrderCapped,
      status: "rejected",
      rejectionReason: cycleCheck.reason,
      mode: "live-mainnet",
    });
    throw new Error(`Order rejected by risk gate: ${cycleCheck.reason}`);
  }

  const currentPositionUSD = await getPerpPositionUsd(resolution.symbolName);
  const positionCheck = enforcePositionCap({
    market: resolution.symbolName,
    side: req.side,
    notionalUSD: perOrderCapped,
    currentPositionUSD,
  });
  if (!positionCheck.allow) {
    await insertOrderRow({
      clOrdID,
      thesisId: req.thesisId,
      strategy: req.strategy,
      runId,
      market: resolution.symbolName,
      kind: "perp",
      side: req.side,
      notionalUSD: perOrderCapped,
      status: "rejected",
      rejectionReason: positionCheck.reason,
      mode: "live-mainnet",
    });
    throw new Error(`Order rejected by risk gate: ${positionCheck.reason}`);
  }

  const grossCheck = enforceGrossExposureCap({
    market: resolution.symbolName,
    notionalUSD: positionCheck.notionalUSD,
    grossExposureUSD: await getGrossPerpExposureUsd(),
    reducing: positionCheck.reducing,
  });
  if (!grossCheck.allow) {
    await insertOrderRow({
      clOrdID,
      thesisId: req.thesisId,
      strategy: req.strategy,
      runId,
      market: resolution.symbolName,
      kind: "perp",
      side: req.side,
      notionalUSD: positionCheck.notionalUSD,
      status: "rejected",
      rejectionReason: grossCheck.reason,
      mode: "live-mainnet",
    });
    throw new Error(`Order rejected by risk gate: ${grossCheck.reason}`);
  }

  const capped = grossCheck.notionalUSD;

  // At most one approvable row per (strategy, market). thesisId is fresh each
  // cycle, so without this every cycle mints another pending row for the same
  // intent and the operator's queue fills with near-identical candidates, which
  // is how a wrong click happens. Supersede the old one rather than leaving two
  // live options.
  const superseded = await db()
    .update(schema.orders)
    .set({
      status: "rejected",
      rejectionReason: `superseded by a newer ${resolution.symbolName} order`,
    })
    .where(
      and(
        eq(schema.orders.status, "pending_approval"),
        eq(schema.orders.strategy, req.strategy),
        eq(schema.orders.market, resolution.symbolName),
      ),
    )
    .returning({ id: schema.orders.id });
  if (superseded.length > 0) {
    logger.info("live.pending_superseded", {
      market: resolution.symbolName,
      strategy: req.strategy,
      supersededIds: superseded.map((r) => r.id),
    });
  }

  const orderRowId = await insertOrderRow({
    clOrdID,
    thesisId: req.thesisId,
    strategy: req.strategy,
    runId,
    market: resolution.symbolName,
    kind: "perp",
    side: req.side,
    notionalUSD: capped,
    status: "pending_approval",
    mode: "live-mainnet",
  });

  // Reserve the cycle budget now. The accumulator is keyed by runId and only
  // lives for the duration of the cycle (runner.ts resetCycle's it in a finally),
  // so it cannot be charged at approve time. Reserving at queue time is the
  // conservative direction: an order that is never approved has still consumed
  // the budget its cycle intended to spend.
  recordPlaced(runId, capped);

  logger.info("live.recorded_pending_approval", {
    orderId: orderRowId,
    clOrdID,
    market: resolution.symbolName,
    side: req.side,
    requestedUSD: req.notionalUSD,
    cappedUSD: capped,
  });

  throw new PendingApprovalError(orderRowId, resolution.symbolName, capped);
}

// Submit an order a human has already claimed via POST /api/orders/approve.
//
// This is the ONLY path that reaches the wire with real money, so every gate the
// autonomous path gets for free has to be re-asserted here, at the moment of
// submission rather than the moment of queueing:
//   - mode, twice: the process must be on mainnet AND the row must have been
//     queued for mainnet, or a kill-switch flip between queue and approve would
//     fill a "mainnet" order on testnet (the gateway comes from current env).
//   - freshness: a stale row would market-order a days-old notional under a
//     thesis whose own 36h freshness rule has long expired.
//   - delegation: the grant may have been revoked since the order was queued,
//     which is precisely the thing delegation exists to prevent.
//   - the venue-reading caps: position and gross exposure move independently of
//     us, so the numbers that were safe at queue time may not be now.
// The per-order/per-cycle caps are NOT re-run: the stored notional is already
// capped (recordPendingMainnetOrder), and the cycle accumulator for that runId
// was evicted when its cycle ended, so re-running it would read 0 and silently
// degrade to a per-order cap across N approvals.
export async function submitApprovedOrder(orderRowId: string): Promise<ExecutedTrade> {
  const rows = await db()
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderRowId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Order ${orderRowId} not found.`);

  const mode = env().SONAR_EXECUTION_MODE;
  if (mode !== "live-mainnet") {
    throw new Error(
      `submitApprovedOrder is live-mainnet only; current mode is ${mode}. The approval gate exists to protect real money and has no meaning off mainnet.`,
    );
  }
  if (row.mode && row.mode !== mode) {
    throw new Error(
      `Order ${orderRowId} was queued under mode "${row.mode}" but the process is now "${mode}". Refusing: it would execute against a different venue than the one it was approved for.`,
    );
  }
  if (!row.approvedAt) {
    throw new Error(
      `Order ${orderRowId} has not been claimed by an approver. Only POST /api/orders/approve may move a row out of pending_approval.`,
    );
  }

  const ageMs = Date.now() - row.createdAt.getTime();
  const ttlMs = env().SONAR_APPROVAL_TTL_MINUTES * 60_000;
  if (ageMs > ttlMs) {
    const msg = `Order ${orderRowId} is ${(ageMs / 60_000).toFixed(0)}m old, past the ${env().SONAR_APPROVAL_TTL_MINUTES}m approval TTL. Its sizing and its thesis are stale; queue a fresh one.`;
    await db()
      .update(schema.orders)
      .set({ status: "rejected", rejectionReason: msg })
      .where(eq(schema.orders.id, orderRowId));
    throw new Error(msg);
  }

  const resolution = resolveMarket(row.market);
  if (!resolution.tradeable || resolution.kind !== "perp") {
    throw new Error(
      `Order ${orderRowId} market "${row.market}" is not a tradeable perp.`,
    );
  }

  const capped = Number(row.notionalUsd);
  const req: OrderRequest = OrderRequestSchema.parse({
    thesisId: row.thesisId,
    strategy: row.strategy,
    kind: "perp",
    market: row.market,
    side: row.side,
    type: "market",
    notionalUSD: capped,
    slippageBps: 50,
  });

  // Re-check the grant: it may have been revoked or expired since queueing.
  if (env().SONAR_REQUIRE_DELEGATION) {
    await assertOrderDelegated(req);
  }

  // Re-check only the caps that read live venue state.
  const currentPositionUSD = await getPerpPositionUsd(resolution.symbolName);
  const positionCheck = enforcePositionCap({
    market: resolution.symbolName,
    side: req.side,
    notionalUSD: capped,
    currentPositionUSD,
  });
  if (!positionCheck.allow) {
    await db()
      .update(schema.orders)
      .set({ status: "rejected", rejectionReason: positionCheck.reason })
      .where(eq(schema.orders.id, orderRowId));
    throw new Error(`Order rejected by risk gate at approval: ${positionCheck.reason}`);
  }
  const grossCheck = enforceGrossExposureCap({
    market: resolution.symbolName,
    notionalUSD: positionCheck.notionalUSD,
    grossExposureUSD: await getGrossPerpExposureUsd(),
    reducing: positionCheck.reducing,
  });
  if (!grossCheck.allow) {
    await db()
      .update(schema.orders)
      .set({ status: "rejected", rejectionReason: grossCheck.reason })
      .where(eq(schema.orders.id, orderRowId));
    throw new Error(`Order rejected by risk gate at approval: ${grossCheck.reason}`);
  }

  logger.info("live.submitting_approved_order", {
    orderId: orderRowId,
    market: resolution.symbolName,
    side: row.side,
    notionalUSD: grossCheck.notionalUSD,
    approvedBy: row.approvedBy,
  });

  return submitAndFinalize({
    req,
    symbolName: resolution.symbolName,
    clOrdID: row.clientOrderId,
    runId: row.runId,
    capped: grossCheck.notionalUSD,
    orderRowId,
    // The budget was reserved when the order was queued; see the flag's comment.
    countAgainstCycleBudget: false,
  });
}

export type ReconcileResult = {
  outcome:
    | "finalized"        // venue had a terminal state; our row now matches it
    | "still_open"       // venue still working it; nothing to do yet
    | "adopted"          // crashed claim; venue had the order, now polled
    | "returned_to_queue" // crashed claim; venue never saw it, back to the human
    | "nothing_to_do";
  status: string;
  detail?: string;
};

// Make an order row tell the truth about what the venue actually did.
//
// NEVER submits. That is the invariant that separates this from the approve
// path: reconcile is a read of the venue plus a write to our own row, so it is
// always safe to call, retry, or cron.
export async function reconcileOrder(orderRowId: string): Promise<ReconcileResult> {
  const rows = await db()
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderRowId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Order ${orderRowId} not found.`);

  const resolution = resolveMarket(row.market);
  if (!resolution.tradeable || resolution.kind !== "perp") {
    return { outcome: "nothing_to_do", status: row.status, detail: "not a perp order" };
  }

  const req: OrderRequest = OrderRequestSchema.parse({
    thesisId: row.thesisId,
    strategy: row.strategy,
    kind: "perp",
    market: row.market,
    side: row.side,
    type: "market",
    notionalUSD: Number(row.notionalUsd),
    slippageBps: 50,
  });

  // Case 1: submitted (possibly parked there by a poll timeout). Re-poll.
  if (row.status === "submitted" && row.sodexOrderId) {
    const polled = await pollUntilTerminal(
      row.sodexOrderId,
      row.clientOrderId,
      resolution.symbolName,
    );
    if (polled.kind === "timeout") {
      return { outcome: "still_open", status: row.status, detail: "venue has no terminal state yet" };
    }
    await finalizeOrder(row.id, row.clientOrderId, req, resolution.symbolName, polled);
    const after = await db()
      .select({ status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderRowId))
      .limit(1);
    return { outcome: "finalized", status: after[0]?.status ?? "unknown" };
  }

  // Case 2: a claim that crashed before or during submit. Ask the venue whether
  // it ever saw this clOrdID before deciding anything.
  if (row.status === "pending" && row.approvedAt) {
    const venueOrder = await findOrderByClOrdID(row.clientOrderId, resolution.symbolName);
    if (venueOrder) {
      const sodexOrderId =
        (venueOrder as { i?: string | number }).i !== undefined
          ? String((venueOrder as { i?: string | number }).i)
          : null;
      await db()
        .update(schema.orders)
        .set({ status: "submitted", sodexOrderId, submittedAt: row.submittedAt ?? new Date() })
        .where(eq(schema.orders.id, orderRowId));
      const polled = await pollUntilTerminal(sodexOrderId, row.clientOrderId, resolution.symbolName);
      if (polled.kind === "timeout") {
        return { outcome: "adopted", status: "submitted", detail: "venue has it; still open" };
      }
      await finalizeOrder(row.id, row.clientOrderId, req, resolution.symbolName, polled);
      const after = await db()
        .select({ status: schema.orders.status })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderRowId))
        .limit(1);
      return { outcome: "adopted", status: after[0]?.status ?? "unknown" };
    }
    // The venue never saw it, so nothing was placed and no money moved. Hand it
    // back to the human rather than submitting it on their behalf.
    await db()
      .update(schema.orders)
      .set({ status: "pending_approval", approvedAt: null, approvedBy: null })
      .where(eq(schema.orders.id, orderRowId));
    logger.info("reconcile.returned_to_queue", { orderId: orderRowId, market: row.market });
    return {
      outcome: "returned_to_queue",
      status: "pending_approval",
      detail: "the venue never received it; re-approve to place it",
    };
  }

  return { outcome: "nothing_to_do", status: row.status };
}

export async function placeOrder(
  rawReq: OrderRequestInput,
): Promise<ExecutedTrade> {
  // Mainnet never places inline. The executor routes live-mainnet to
  // recordPendingMainnetOrder, and only submitApprovedOrder (behind the
  // bearer-gated approve endpoint, after a human claims the row) may reach the
  // wire with real money. This guard means that stays true even if a future
  // caller reaches placeOrder directly.
  if (env().SONAR_EXECUTION_MODE === "live-mainnet") {
    throw new Error(
      "live.placeOrder must not run on live-mainnet: mainnet orders are recorded for human approval and submitted only via submitApprovedOrder.",
    );
  }
  const req = OrderRequestSchema.parse(rawReq);
  // Sanity: only tradeable markets should ever reach this function. The
  // executor facade routes non-tradeable markets to paper. Defence in depth.
  const resolution = resolveMarket(req.market);
  if (!resolution.tradeable) {
    throw new Error(
      `lib/sodex/live.ts received a non-tradeable market "${req.market}"; the executor should have routed this to paper.`,
    );
  }
  if (resolution.kind !== "perp") {
    throw new Error(
      `lib/sodex/live.ts only handles perp markets in Wave 2; got kind="${resolution.kind}" for market "${req.market}".`,
    );
  }

  const clOrdID = clientOrderId(req.strategy, req.thesisId, req.market);
  const runId = await resolveRunIdForCap(req.thesisId);

  // Idempotency: if this leg was already attempted, resume from the existing
  // orders row rather than placing a fresh order.
  const existing = await db()
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.clientOrderId, clOrdID))
    .limit(1);

  if (existing[0]) {
    const row = existing[0];
    logger.info("live.idempotent_hit", {
      clOrdID,
      market: req.market,
      status: row.status,
    });
    if (
      row.status === "filled" ||
      row.status === "partially_filled"
    ) {
      return tradeFromOrderRow(row);
    }
    // A row still awaiting a human must never be submitted by an automated
    // caller. This branch stops it short of the "pending -> fall through and
    // submit" tail below. It is unreachable today (the mainnet guard at the top
    // returns first, and clOrdID never recurs across cycles; see clientOrderId),
    // which is exactly why it is written down: both of those are accidents of
    // the current design, and this is the branch that survives either changing.
    if (row.status === "pending_approval") {
      throw new PendingApprovalError(row.id, row.market, Number(row.notionalUsd));
    }
    // Pending / submitted / failed / rejected: replay the poll loop on the
    // existing sodexOrderId or surface the terminal state.
    if (row.status === "submitted" && row.sodexOrderId) {
      const polled = await pollUntilTerminal(row.sodexOrderId, clOrdID, resolution.symbolName);
      return finalizeOrder(row.id, clOrdID, req, resolution.symbolName, polled);
    }
    if (row.status === "failed" || row.status === "rejected") {
      throw new Error(
        `Order ${clOrdID} previously ${row.status}: ${row.rejectionReason ?? "no reason recorded"}`,
      );
    }
    // pending without sodexOrderId means submission never happened; fall
    // through to attempt submission again under the same clOrdID.
  }

  // Risk gate: mode + dust + per-order cap + per-cycle cap. Order matters:
  // assertModeAllowed first (catches misconfiguration before any DB work),
  // then dust, then per-order downsizing, then per-cycle cap check against
  // the (possibly downsized) notional.
  assertModeAllowed();
  if (isDust(req.notionalUSD)) {
    throw new Error(
      `Order notional $${req.notionalUSD} for ${req.market} is below the dust floor; the runner should drop these before reaching the executor.`,
    );
  }
  const { notionalUSD: perOrderCapped } = enforcePerOrderCap(req.notionalUSD);
  const cycleCheck = enforcePerCycleCap(runId, perOrderCapped);
  if (!cycleCheck.allow) {
    const id = await insertOrderRow({
      clOrdID,
      thesisId: req.thesisId,
      strategy: req.strategy,
      runId,
      market: resolution.symbolName,
      kind: "perp",
      side: req.side,
      notionalUSD: perOrderCapped,
      status: "rejected",
      rejectionReason: cycleCheck.reason,
    });
    void id;
    throw new Error(`Order rejected by risk gate: ${cycleCheck.reason}`);
  }

  // Position caps (risk.ts layer 4): bound the resulting book, not just the
  // flow. Read the venue's actual position for this market, since it is
  // authoritative for what we are about to add to. A reducing order passes
  // both gates untouched.
  const currentPositionUSD = await getPerpPositionUsd(resolution.symbolName);
  const positionCheck = enforcePositionCap({
    market: resolution.symbolName,
    side: req.side,
    notionalUSD: perOrderCapped,
    currentPositionUSD,
  });
  if (!positionCheck.allow) {
    await insertOrderRow({
      clOrdID,
      thesisId: req.thesisId,
      strategy: req.strategy,
      runId,
      market: resolution.symbolName,
      kind: "perp",
      side: req.side,
      notionalUSD: perOrderCapped,
      status: "rejected",
      rejectionReason: positionCheck.reason,
    });
    throw new Error(`Order rejected by risk gate: ${positionCheck.reason}`);
  }

  const grossCheck = enforceGrossExposureCap({
    market: resolution.symbolName,
    notionalUSD: positionCheck.notionalUSD,
    grossExposureUSD: await getGrossPerpExposureUsd(),
    reducing: positionCheck.reducing,
  });
  if (!grossCheck.allow) {
    await insertOrderRow({
      clOrdID,
      thesisId: req.thesisId,
      strategy: req.strategy,
      runId,
      market: resolution.symbolName,
      kind: "perp",
      side: req.side,
      notionalUSD: positionCheck.notionalUSD,
      status: "rejected",
      rejectionReason: grossCheck.reason,
    });
    throw new Error(`Order rejected by risk gate: ${grossCheck.reason}`);
  }

  const capped = grossCheck.notionalUSD;

  // Insert as pending; the UNIQUE constraint on client_order_id is the DB-level
  // backstop. Concurrent inserts with the same clOrdID will throw and the
  // existing-row branch above will catch on retry.
  const orderRowId = await insertOrderRow({
    clOrdID,
    thesisId: req.thesisId,
    strategy: req.strategy,
    runId,
    market: resolution.symbolName,
    kind: "perp",
    side: req.side,
    notionalUSD: capped,
    status: "pending",
  });

  return submitAndFinalize({
    req,
    symbolName: resolution.symbolName,
    clOrdID,
    runId,
    capped,
    orderRowId,
    // Testnet places inline, so the cycle budget is consumed here after a
    // successful submit, exactly as it was before this extraction.
    countAgainstCycleBudget: true,
  });
}

// The wire half of an order, shared by the testnet direct path and the mainnet
// approve path. Everything above this (mode, dust, per-order, per-cycle,
// position and gross caps, plus the delegation gate in executor.ts) is the
// gate; this function assumes those already ran and that `capped` is the
// post-gate notional. Do not call it from anywhere that has not been gated.
async function submitAndFinalize(input: {
  req: OrderRequest;
  symbolName: string;
  clOrdID: string;
  runId: string;
  capped: number;
  orderRowId: string;
  countAgainstCycleBudget: boolean;
}): Promise<ExecutedTrade> {
  const { req, symbolName, clOrdID, runId, capped, orderRowId, countAgainstCycleBudget } = input;

  // Market buys take funds (USD notional); market sells require quantity (asset
  // units) or the venue rejects them as "funds is invalid". For a sell we size
  // quantity from a live price of the base symbol (BTC-USD -> BTC), rounded to a
  // granularity the venue accepts (it filled a BTC buy at 5 decimals). Funds is
  // the natural shape for buys since the hedge notional is USD-denominated.
  let sizing: { funds: string } | { quantity: string };
  if (req.side === "sell") {
    const base = symbolName.replace(/-usd$/i, "");
    const price = await getPriceUSD(base);
    if (price === null || price <= 0) {
      const msg = `Cannot size market sell for ${symbolName}: no live price for ${base}.`;
      await db()
        .update(schema.orders)
        .set({ status: "failed", rejectionReason: msg })
        .where(eq(schema.orders.id, orderRowId));
      throw new Error(msg);
    }
    // The venue rejects an over-precise or unaligned quantity as "quantity is
    // invalid". Floor capped/price to the symbol's step size (so the notional
    // never rounds up past the cap) and format at the symbol's quantity
    // precision. Defaults match BTC-USD when the listing is unavailable.
    const info = await getPerpSymbolInfo(symbolName);
    const step = info?.stepSize ? Number(info.stepSize) : 1e-5;
    const precision = info?.quantityPrecision ?? 5;
    const qty = Math.floor(capped / price / step) * step;
    if (qty <= 0) {
      const msg = `Market sell for ${symbolName} sizes to zero at $${capped} / $${price}.`;
      await db()
        .update(schema.orders)
        .set({ status: "failed", rejectionReason: msg })
        .where(eq(schema.orders.id, orderRowId));
      throw new Error(msg);
    }
    sizing = { quantity: qty.toFixed(precision) };
  } else {
    sizing = { funds: String(capped) };
  }

  // Submit.
  let submitResult: Awaited<ReturnType<typeof submitPerpOrder>>;
  try {
    submitResult = await submitPerpOrder({
      side: req.side,
      symbolName: symbolName,
      type: req.type,
      clOrdID,
      ...sizing,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db()
      .update(schema.orders)
      .set({ status: "failed", rejectionReason: msg })
      .where(eq(schema.orders.id, orderRowId));
    throw err;
  }

  await db()
    .update(schema.orders)
    .set({
      status: "submitted",
      sodexOrderId: submitResult.sodexOrderId,
      submittedAt: new Date(),
    })
    .where(eq(schema.orders.id, orderRowId));

  // Count against the per-cycle cap only after submission succeeded so that
  // rejected orders do not consume budget. The approve path passes false: a
  // mainnet order reserves its budget at RECORD time (recordPendingMainnetOrder),
  // and by approve time runner.ts has already resetCycle'd that runId, so
  // charging it again would both double-count and re-create a map entry that
  // nothing will ever evict.
  if (countAgainstCycleBudget) {
    recordPlaced(runId, capped);
  }

  // Poll for terminal status. The SoDEX response on submit usually gives
  // the initial status (NEW); we poll the open-orders listing to detect
  // fills. Once an order leaves open, the listing no longer returns it,
  // which is also a terminal signal.
  const terminal: PolledOutcome = await pollUntilTerminal(
    submitResult.sodexOrderId,
    clOrdID,
    symbolName,
  );

  return finalizeOrder(orderRowId, clOrdID, req, symbolName, terminal);
}

type PolledOutcome =
  | { kind: "filled"; fillPrice: number; fillQuantity: number; sodexOrderId: string | null }
  | { kind: "partially_filled"; fillPrice: number; fillQuantity: number; sodexOrderId: string | null }
  | { kind: "failed"; reason: string }
  | { kind: "rejected"; reason: string }
  // Non-terminal: the client-side poll gave up (or a fill had no usable price).
  // The venue may still have filled; the row is left reconcilable, NOT failed.
  | { kind: "timeout"; sodexOrderId: string | null };

async function pollUntilTerminal(
  sodexOrderId: string | null,
  clOrdID: string,
  symbolName: string,
): Promise<PolledOutcome> {
  const start = Date.now();
  let delay = POLL_INITIAL_MS;
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    let openOrders: Awaited<ReturnType<typeof listPerpOrders>>;
    try {
      openOrders = await listPerpOrders();
    } catch (err) {
      logger.warn("live.poll_error", {
        clOrdID,
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(delay);
      delay = Math.min(delay * POLL_MULTIPLIER, POLL_CAP_MS);
      continue;
    }

    const match = openOrders.find(
      (o) =>
        o.c === clOrdID ||
        (sodexOrderId !== null && o.i !== undefined && String(o.i) === sodexOrderId),
    );

    if (!match) {
      // Order no longer in the open list. IOC market orders (our default)
      // leave the open list within ~hundreds of ms; the terminal record
      // lives in orders/history. Fetch it for the real fill values.
      const historyRecord = await findOrderByClOrdID(clOrdID, symbolName);
      if (!historyRecord) {
        // History not yet visible (eventually consistent); keep polling.
        await sleep(delay);
        delay = Math.min(delay * POLL_MULTIPLIER, POLL_CAP_MS);
        continue;
      }
      return outcomeFromHistory(historyRecord, sodexOrderId);
    }

    const internal = mapSodexStatus(match.X as SodexOrderStatus);
    if (internal === "filled") {
      return {
        kind: "filled",
        fillPrice: numericField(match, ["avgPrice", "price", "lastPrice"]),
        fillQuantity: numericField(match, ["execQty", "filled", "quantity"]),
        sodexOrderId: match.i !== undefined ? String(match.i) : sodexOrderId,
      };
    }
    if (internal === "partially_filled") {
      // Keep polling; partial may go to filled.
    }
    if (internal === "failed" || internal === "rejected") {
      return { kind: internal, reason: `SoDEX status ${match.X}` };
    }

    await sleep(delay);
    delay = Math.min(delay * POLL_MULTIPLIER, POLL_CAP_MS);
  }
  // Timeout. Surface as failed; the row stays with sodexOrderId set so a
  // future manual check can reconcile.
  // Poll window elapsed with no terminal status. This is a client-side timeout,
  // not a venue rejection: the order may still fill. Return a non-terminal
  // timeout so the row stays "submitted" and reconcilable via sodexOrderId.
  return { kind: "timeout", sodexOrderId };
}

// IOC partial fills come back from orders/history as status=CANCELED with a
// non-zero executedQty. From the trading perspective that is a fill: we got
// the position, the remainder simply did not cross the book. Treat any
// terminal record with executedQty > 0 as a fill.
function outcomeFromHistory(
  o: Awaited<ReturnType<typeof findOrderByClOrdID>>,
  sodexOrderId: string | null,
): PolledOutcome {
  if (!o) return { kind: "failed", reason: "order missing from history" };
  const executedQty = Number(o.executedQty ?? 0);
  const executedValue = Number(o.executedValue ?? 0);
  const resolvedSodexId = o.orderID !== undefined ? String(o.orderID) : sodexOrderId;
  if (executedQty > 0) {
    const avgFillPrice = executedValue > 0 ? executedValue / executedQty : Number(o.price ?? 0);
    if (avgFillPrice > 0) {
      return {
        kind: "filled",
        fillPrice: avgFillPrice,
        fillQuantity: executedQty,
        sodexOrderId: resolvedSodexId,
      };
    }
    // executedQty > 0 but no usable price: do NOT book a zero-price fill (it
    // would store avgEntry 0 and book the whole mark as profit, and write
    // notional 0). Leave it reconcilable via sodexOrderId.
    return { kind: "timeout", sodexOrderId: resolvedSodexId };
  }
  if (o.status === "REJECTED") {
    return { kind: "rejected", reason: `SoDEX status ${o.status}` };
  }
  return { kind: "failed", reason: `SoDEX status ${o.status}, executedQty=0` };
}

function numericField(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

async function insertOrderRow(input: {
  clOrdID: string;
  thesisId: string;
  strategy: string;
  runId: string;
  market: string;
  kind: "spot" | "perp";
  side: "buy" | "sell";
  notionalUSD: number;
  // The writable set at insert time. Never "submitted" or a terminal status:
  // those are only ever reached by an update after the wire has answered.
  status: "pending" | "rejected" | "pending_approval";
  rejectionReason?: string;
  // Defaults to the current mode. Stamped so a queued row is bound to the venue
  // it was queued for (see schema.ts orders.mode).
  mode?: string;
}): Promise<string> {
  const id = randomUUID();
  await db()
    .insert(schema.orders)
    .values({
      id,
      clientOrderId: input.clOrdID,
      thesisId: input.thesisId,
      strategy: input.strategy,
      runId: input.runId,
      market: input.market,
      kind: input.kind,
      side: input.side,
      notionalUsd: String(input.notionalUSD),
      status: input.status,
      rejectionReason: input.rejectionReason ?? null,
      mode: input.mode ?? env().SONAR_EXECUTION_MODE,
    });
  return id;
}

async function finalizeOrder(
  orderRowId: string,
  clOrdID: string,
  req: OrderRequest,
  symbolName: string,
  outcome: PolledOutcome,
): Promise<ExecutedTrade> {
  if (outcome.kind === "failed" || outcome.kind === "rejected") {
    await db()
      .update(schema.orders)
      .set({ status: outcome.kind, rejectionReason: outcome.reason })
      .where(eq(schema.orders.id, orderRowId));
    throw new Error(
      `SoDEX order ${clOrdID} ended in ${outcome.kind}: ${outcome.reason}`,
    );
  }

  if (outcome.kind === "timeout") {
    // Not a terminal failure: leave the row "submitted" (keep sodexOrderId) so
    // it stays reconcilable and the idempotent-retry path re-polls instead of
    // hard-throwing on a "failed" status. Skip this leg for the cycle; the
    // hedge loop in executeAllocations catches per-leg.
    await db()
      .update(schema.orders)
      .set({ status: "submitted", sodexOrderId: outcome.sodexOrderId })
      .where(eq(schema.orders.id, orderRowId));
    throw new Error(
      `SoDEX order ${clOrdID} did not confirm within the poll window; left submitted for reconciliation.`,
    );
  }

  // Update the orders row with the fill.
  const filledAt = new Date();
  const dbStatus = outcome.kind;
  const fillPrice = outcome.fillPrice;
  const fillQuantity = outcome.fillQuantity;
  if (!(fillPrice > 0) || !(fillQuantity > 0)) {
    // A "filled" status with no usable price/qty (e.g. the open-orders path
    // reported zero avgPrice) is not a real fill; never book a zero-entry
    // position. Leave submitted for reconciliation.
    await db()
      .update(schema.orders)
      .set({ status: "submitted", sodexOrderId: outcome.sodexOrderId })
      .where(eq(schema.orders.id, orderRowId));
    throw new Error(
      `SoDEX order ${clOrdID} reported a fill with no usable price/quantity; left submitted for reconciliation.`,
    );
  }
  await db()
    .update(schema.orders)
    .set({
      status: dbStatus,
      sodexOrderId: outcome.sodexOrderId,
      fillPrice: String(fillPrice),
      fillQuantity: String(fillQuantity),
      txRef: outcome.sodexOrderId,
      filledAt,
    })
    .where(eq(schema.orders.id, orderRowId));

  // Insert a paper_trades row so the Wave 1 position upsert logic (paper.ts)
  // keeps maintaining paper_positions correctly. Real fills coexist with paper
  // fills in the same table; the /portfolio dashboard does not differentiate
  // because the data shape is identical.
  const tradeId = randomUUID();
  await db()
    .insert(schema.paperTrades)
    .values({
      id: tradeId,
      thesisId: req.thesisId,
      strategy: req.strategy,
      market: symbolName,
      kind: "perp",
      side: req.side,
      type: req.type,
      // Record the actual filled notional (fill price x fill quantity), not the
      // pre-risk-gate request notional. Otherwise the paper_trades row would
      // claim the agent's intended size (e.g. $100k) while the position and the
      // live orders row reflect the downsized fill (e.g. $500), an inconsistency
      // a reviewer would catch on /portfolio.
      notionalUsd: String((fillPrice || 0) * (fillQuantity || 0)),
      fillPrice: String(fillPrice || 0),
      fillQuantity: String(fillQuantity || 0),
      slippageBps: req.slippageBps,
      feeUsd: "0",
      executedAt: filledAt,
    });

  // Best-effort position update via the existing upsert helper.
  await upsertPositionFromLiveFill({
    strategy: req.strategy,
    market: symbolName,
    side: req.side,
    fillPrice,
    fillQuantity,
    kind: "perp",
  });

  return {
    id: tradeId,
    thesisId: req.thesisId,
    strategy: req.strategy,
    market: symbolName,
    side: req.side,
    kind: "perp",
    type: req.type,
    notionalUSD: req.notionalUSD,
    fillPrice,
    fillQuantity,
    slippageBps: req.slippageBps,
    feeUSD: 0,
    executedAt: filledAt.toISOString(),
  };
}

// Lightweight position upsert; mirrors lib/sodex/paper.ts:upsertPosition but
// reads from the actual fill numbers rather than synthesized ones.
async function upsertPositionFromLiveFill(input: {
  strategy: string;
  market: string;
  side: "buy" | "sell";
  fillPrice: number;
  fillQuantity: number;
  kind: "spot" | "perp";
}): Promise<void> {
  const existing = await db()
    .select()
    .from(schema.paperPositions)
    .where(
      and(
        eq(schema.paperPositions.strategy, input.strategy),
        eq(schema.paperPositions.market, input.market),
      ),
    )
    .limit(1);

  const delta =
    input.side === "buy" ? input.fillQuantity : -input.fillQuantity;
  if (delta === 0) return;

  const current = existing[0];
  if (!current) {
    await db().insert(schema.paperPositions).values({
      strategy: input.strategy,
      market: input.market,
      kind: input.kind,
      side: delta > 0 ? "long" : "short",
      quantity: String(Math.abs(delta)),
      avgEntryPrice: String(input.fillPrice || 0),
      markPrice: String(input.fillPrice || 0),
      unrealizedPnlUsd: "0",
      updatedAt: new Date(),
    });
    return;
  }
  const prevQty = Number(current.quantity) * (current.side === "long" ? 1 : -1);
  const nextQty = prevQty + delta;
  const absNext = Math.abs(nextQty);
  const sameDirection = Math.sign(prevQty) === Math.sign(nextQty) && nextQty !== 0;
  const avgEntryPrice = sameDirection
    ? (Number(current.avgEntryPrice) * Math.abs(prevQty) +
        input.fillPrice * Math.abs(delta)) /
      (Math.abs(prevQty) + Math.abs(delta))
    : input.fillPrice;
  const nextSide: "long" | "short" = nextQty >= 0 ? "long" : "short";
  await db()
    .update(schema.paperPositions)
    .set({
      kind: input.kind,
      side: nextSide,
      quantity: String(absNext),
      avgEntryPrice: String(avgEntryPrice),
      markPrice: String(input.fillPrice || 0),
      unrealizedPnlUsd: "0",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.paperPositions.strategy, input.strategy),
        eq(schema.paperPositions.market, input.market),
      ),
    );
}

// Replays an idempotent ExecutedTrade view of an orders row that already
// fully filled. Used when a retried call hits the existing-row branch.
function tradeFromOrderRow(
  row: typeof schema.orders.$inferSelect,
): ExecutedTrade {
  return {
    id: row.id,
    thesisId: row.thesisId,
    strategy: row.strategy as StrategyKey,
    market: row.market,
    side: row.side,
    kind: row.kind,
    type: "market", // Wave 2 only places market orders on the testnet; the orders row does not currently carry type.
    notionalUSD: Number(row.notionalUsd),
    fillPrice: Number(row.fillPrice ?? 0),
    fillQuantity: Number(row.fillQuantity ?? 0),
    slippageBps: 50,
    feeUSD: Number(row.feeUsd ?? 0),
    executedAt: (row.filledAt ?? row.createdAt).toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-export drizzle's and() placeholder if needed by tests downstream.
void and;
