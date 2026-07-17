#!/usr/bin/env tsx
//
// Queue exactly ONE live-mainnet order for human approval.
//
// This places nothing. On live-mainnet the executor routes to
// recordPendingMainnetOrder, which runs the full risk gate, persists the CAPPED
// notional as pending_approval, and throws PendingApprovalError. The order only
// reaches the venue when a human calls POST /api/orders/approve.
//
// It seeds an agent_runs row THEN a theses row first, because orders.runId and
// orders.thesisId are both notNull FKs and recordPendingMainnetOrder resolves the
// run strictly (an unattributable order is refused loudly rather than dropped).
//
// Usage:
//   pnpm tsx scripts/sodex-mainnet-pending.ts            # BTC-PERP buy $11
//   pnpm tsx scripts/sodex-mainnet-pending.ts sell 0.00017
//     ^ close form: sizes by QUANTITY so the close matches the fill exactly.

import "./_env";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/utils/env";
import { placeOrder } from "@/lib/sodex/executor";
import { PendingApprovalError } from "@/lib/sodex/live";
import { getPriceUSD } from "@/lib/prices";

async function main() {
  const mode = env().SONAR_EXECUTION_MODE;
  if (mode !== "live-mainnet") {
    console.error(`Refusing: mode is ${mode}, expected live-mainnet.`);
    process.exit(2);
  }

  const side = (process.argv[2] === "sell" ? "sell" : "buy") as "buy" | "sell";
  const qtyArg = process.argv[3];

  // For a close we size from the quantity we actually hold, converted to USD, so
  // the reducing order matches the position rather than a round number.
  let notionalUSD = 11;
  if (qtyArg) {
    const px = await getPriceUSD("BTC");
    if (!px) {
      console.error("No BTC price; cannot size the close.");
      process.exit(1);
    }
    notionalUSD = Number(qtyArg) * px;
    console.log(`Sizing close: ${qtyArg} BTC x $${px.toFixed(2)} = $${notionalUSD.toFixed(2)}`);
  }

  const runId = randomUUID();
  const thesisId = randomUUID();
  const now = new Date();
  await db().insert(schema.agentRuns).values({
    id: runId,
    startedAt: now,
    finishedAt: now,
    model: "mainnet-one-fill",
    dataSource: "live",
    ok: true,
  });
  await db().insert(schema.theses).values({
    id: thesisId,
    runId,
    generatedAt: now,
    asOf: now,
    mode: "trade",
    status: "valid",
    reasoning:
      `Wave 3 mainnet verification: one human-approved BTC-PERP ${side} on the live SoDEX venue, ` +
      `to prove the gated mainnet path end to end with symbolic capital. Not a directional view.`,
    payload: { verification: "wave-3-one-fill", side },
  });

  console.log(`\nrunId:    ${runId}`);
  console.log(`thesisId: ${thesisId}`);
  console.log(`queueing: BTC-PERP ${side} $${notionalUSD.toFixed(2)}\n`);

  try {
    await placeOrder({
      thesisId,
      kind: "perp",
      market: "BTC-PERP",
      side,
      type: "market",
      notionalUSD,
      slippageBps: 50,
    });
    console.error("UNEXPECTED: the executor returned a trade. On mainnet it must queue and throw.");
    process.exit(1);
  } catch (err) {
    if (!(err instanceof PendingApprovalError)) {
      console.error("FAILED (not a queue):", err instanceof Error ? err.message : err);
      process.exit(1);
    }
    console.log("Queued, nothing submitted:");
    console.log(`  orderId:  ${err.orderId}`);
    console.log(`  market:   ${err.market}`);
    console.log(`  notional: $${err.notionalUSD} (post risk gate)`);
  }

  const rows = await db()
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.thesisId, thesisId));
  console.log(`\nDB rows for this thesis: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  status=${r.status} mode=${r.mode} side=${r.side} notional=${r.notionalUsd} ` +
        `sodexOrderId=${r.sodexOrderId ?? "null"} approvedAt=${r.approvedAt ?? "null"}`,
    );
  }
  console.log("\nApprove it with:");
  console.log(
    `  curl -X POST -H "Authorization: Bearer $CRON_SECRET" -H "x-approved-by: <you>" \\\n` +
      `    -H 'Content-Type: application/json' \\\n` +
      `    -d '{"orderId":"${rows[0]?.id}"}' https://sonar.my.id/api/orders/approve`,
  );
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
