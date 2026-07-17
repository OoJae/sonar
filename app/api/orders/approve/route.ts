import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { submitApprovedOrder } from "@/lib/sodex/live";
import { isCycleInFlight } from "@/lib/agent/runner";
import { acquireRunLock, releaseRunLock } from "@/lib/utils/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The human half of the live-mainnet approval gate, and the only path in the
// codebase that submits real money.
//
// On mainnet the autonomous cycle records orders as pending_approval and never
// submits them (lib/sodex/executor.ts -> recordPendingMainnetOrder). A person
// reads the queued order on /signals, then claims it here.
//
// Bearer parity with /api/agent/run. Note that guard is fail-open when
// CRON_SECRET is unset, which is fine for local dev but is why the env boot
// guard makes CRON_SECRET mandatory in production: without it this endpoint
// would be an open door to real funds.
export async function POST(request: Request) {
  const e = env();
  const auth = request.headers.get("authorization") ?? "";
  const expected = e.CRON_SECRET ? `Bearer ${e.CRON_SECRET}` : null;
  if (expected && auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Approval only means something on mainnet; refuse everywhere else rather than
  // let this become a second, weaker way to place a testnet order.
  if (e.SONAR_EXECUTION_MODE !== "live-mainnet") {
    return NextResponse.json(
      {
        error: "not_mainnet",
        message: `The approval gate is live-mainnet only; current mode is ${e.SONAR_EXECUTION_MODE}. Testnet and paper place orders inline.`,
      },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const orderIdRaw =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).orderId
      : undefined;
  if (typeof orderIdRaw !== "string" || orderIdRaw.length === 0) {
    return NextResponse.json(
      { error: "missing_order_id", message: "Body must be {\"orderId\": \"<uuid>\"}." },
      { status: 400 },
    );
  }
  // Narrowed to string; a const so the handBackClaim closure below keeps the type
  // (control-flow narrowing does not cross a nested-function boundary).
  const orderId: string = orderIdRaw;

  const approvedBy = request.headers.get("x-approved-by")?.slice(0, 120) ?? "operator";

  // THE CLAIM. This conditional UPDATE is the only writer that may move a row out
  // of pending_approval, and it is what makes a double-click safe: the second
  // request matches zero rows and stops. Do not add a "resume a stranded row"
  // path here. It looks harmless and is not: the clientOrderId UNIQUE constraint
  // protects an INSERT, not this path, and the venue does NOT dedupe clOrdID. We
  // tested that rather than trusting the docs, which had called it UNCONFIRMED
  // since May: the same key submitted twice created two distinct orders and both
  // filled (scripts/sodex-clordid-dedupe-probe.ts; docs/sodex-live.md 5.2). So a
  // resume would be a second real market order. Crash recovery belongs in
  // POST /api/orders/reconcile, which never submits.
  const claimed = await db()
    .update(schema.orders)
    .set({
      status: "pending",
      approvedAt: new Date(),
      approvedBy,
    })
    .where(
      and(
        eq(schema.orders.id, orderId),
        eq(schema.orders.status, "pending_approval"),
      ),
    )
    .returning();

  if (claimed.length === 0) {
    // Already claimed, terminal, or unknown. Report the current state; never
    // submit on this branch.
    const rows = await db()
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: "not_found", orderId }, { status: 404 });
    }
    logger.info("approve.already_claimed", { orderId, status: row.status });
    return NextResponse.json(
      {
        ok: false,
        error: "not_claimable",
        message: `Order is ${row.status}, not pending_approval. Nothing was submitted.`,
        order: { id: row.id, status: row.status, market: row.market },
      },
      { status: 409 },
    );
  }

  // Serialize against the agent cycle. submitApprovedOrder reaches
  // upsertPositionFromLiveFill, a read/modify/write on paper_positions with no
  // row lock, and the cron's markToMarket writes the same rows; approving mid
  // cycle would lose an update.
  //
  // acquireRunLock alone does NOT cover the cron cycle: runAgentCycle takes no
  // lock (it guards itself with the module-level cycleInFlight mutex), so the
  // lock only serialized this route against demo-run and proposals, never the
  // one writer that matters. Check that mutex directly first. acquireRunLock is
  // kept below for approve-vs-approve and approve-vs-demo exclusion.
  async function handBackClaim() {
    await db()
      .update(schema.orders)
      .set({ status: "pending_approval", approvedAt: null, approvedBy: null })
      .where(eq(schema.orders.id, orderId));
  }

  if (isCycleInFlight()) {
    await handBackClaim();
    return NextResponse.json(
      {
        ok: false,
        error: "busy",
        message: "An agent cycle is in flight; the claim was released. Retry shortly.",
      },
      { status: 409 },
    );
  }

  const locked = await acquireRunLock(120);
  if (!locked) {
    // Hand the claim back so the operator can retry once the other flow finishes.
    await handBackClaim();
    return NextResponse.json(
      {
        ok: false,
        error: "busy",
        message: "Another operation holds the run lock; the claim was released. Retry shortly.",
      },
      { status: 409 },
    );
  }

  try {
    logger.info("approve.claimed", { orderId, approvedBy });
    const trade = await submitApprovedOrder(orderId);
    return NextResponse.json({ ok: true, trade }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("approve.submit_failed", { orderId, error: message });
    // The row already carries its own terminal state (submitAndFinalize and the
    // gates write `failed` / `rejected` themselves), so do not overwrite it here.
    return NextResponse.json({ ok: false, error: "submit_failed", message }, { status: 500 });
  } finally {
    await releaseRunLock();
  }
}
