import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { reconcileOrder } from "@/lib/sodex/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Repair an order whose recorded state may have drifted from the venue's.
// This endpoint NEVER submits. That is the whole distinction from
// /api/orders/approve: reconcile only reads the venue and makes our row tell the
// truth about what already happened there.
//
// Two jobs:
//
//  1. A `submitted` row with a sodexOrderId. The poll window is 30s but a market
//     order can fill later, and the timeout branch deliberately parks the row at
//     `submitted` so it stays reconcilable. On testnet the next cycle re-polls it
//     via the idempotency branch; on mainnet nothing ever does (placeOrder is
//     guarded off and the clOrdID never recurs), so without this a real fill
//     would be stranded forever: no paper_trades row, no position, /portfolio and
//     /track blind to money that actually moved.
//
//  2. A claim that crashed between the approve UPDATE and the submit, leaving
//     `pending` + approvedAt with no sodexOrderId. Ask the venue whether it ever
//     saw the clOrdID: if yes, adopt its order id and poll; if no, hand the row
//     back to pending_approval for a fresh human decision.
export async function POST(request: Request) {
  const e = env();
  const auth = request.headers.get("authorization") ?? "";
  const expected = e.CRON_SECRET ? `Bearer ${e.CRON_SECRET}` : null;
  if (expected && auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const orderId =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).orderId
      : undefined;
  if (typeof orderId !== "string" || orderId.length === 0) {
    return NextResponse.json(
      { error: "missing_order_id", message: "Body must be {\"orderId\": \"<uuid>\"}." },
      { status: 400 },
    );
  }

  const rows = await db()
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);
  if (!rows[0]) {
    return NextResponse.json({ error: "not_found", orderId }, { status: 404 });
  }

  try {
    const result = await reconcileOrder(orderId);
    logger.info("reconcile.done", { orderId, outcome: result.outcome });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("reconcile.failed", { orderId, error: message });
    return NextResponse.json({ ok: false, error: "reconcile_failed", message }, { status: 500 });
  }
}
