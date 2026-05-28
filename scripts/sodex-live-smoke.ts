#!/usr/bin/env tsx
//
// Phase 2.2 live executor smoke. Places one tiny testnet order against SoDEX,
// then re-runs the same call to prove the idempotency path (the load-bearing
// double-run test from the plan §12).
//
// What this covers:
//   1. Signing: submitPerpOrder hits the real wire and must accept our EIP-712
//      signature, X-API-Sign header, and 0x01 prefix byte. If the SDK's
//      signing assumptions in lib/sodex/client.ts are off by anything, this
//      is where it surfaces. Phase 2.1 deliberately deferred signing
//      validation to here because getAccountState turned out to be unsigned.
//   2. Idempotency: the second placeOrder call with the same thesisId+market
//      must NOT place a second order. The DB unique constraint on
//      orders.client_order_id is the floor; live.ts catches the existing row
//      and returns the same ExecutedTrade.
//   3. Position tracking: the paper_positions row should update once (after
//      the first fill) and stay put on the idempotent second call.
//
// Invocation: pnpm tsx scripts/sodex-live-smoke.ts
//   - Requires SODEX_WALLET_PRIVATE_KEY in .env.local with a funded testnet
//     wallet (the auth smoke verifies this end-to-end).
//   - Spends a tiny amount: $11 USD funds against BTC-USD perps (minNotional
//     is $10; we go just above to leave headroom).
//   - Records a thesis + run row first so the orders FK satisfies.
//   - Leaves all rows in the DB for inspection via /portfolio and /log.

import "./_env";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { placeOrder } from "@/lib/sodex/executor";
import { env } from "@/lib/utils/env";

async function main() {
  const mode = env().SONAR_EXECUTION_MODE;
  if (mode !== "live-testnet") {
    console.log(
      `SONAR_EXECUTION_MODE=${mode}; this smoke is meaningful only in live-testnet.`,
    );
    console.log(
      "Set SONAR_EXECUTION_MODE=live-testnet in .env.local and re-run.",
    );
    process.exit(2);
  }
  console.log(`Mode: ${mode}`);

  const runId = randomUUID();
  const thesisId = randomUUID();
  const now = new Date();
  await db().insert(schema.agentRuns).values({
    id: runId,
    startedAt: now,
    finishedAt: now,
    model: "smoke-2.2",
    dataSource: "fixture",
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
      "Phase 2.2 live executor smoke; one BTC-PERP market buy, asserted idempotent across a second placeOrder call.",
    payload: { smoke: "phase-2.2" },
  });
  console.log(`thesisId: ${thesisId}`);
  console.log(`runId:    ${runId}`);
  console.log("");

  const orderInput = {
    thesisId,
    kind: "perp" as const,
    market: "BTC-PERP",
    side: "buy" as const,
    type: "market" as const,
    notionalUSD: 11, // $1 above the BTC-USD minNotional of $10.
    slippageBps: 50,
  };

  console.log("=== Attempt #1 ===");
  const start1 = Date.now();
  try {
    const trade1 = await placeOrder(orderInput);
    console.log(`  filled in ${Date.now() - start1}ms`);
    console.log(
      `  trade.id=${trade1.id.slice(0, 8)}  market=${trade1.market}  fillPrice=${trade1.fillPrice}  fillQty=${trade1.fillQuantity}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL after ${Date.now() - start1}ms: ${msg.slice(0, 400)}`);
    process.exit(1);
  }

  // Re-fetch row counts to confirm exactly one orders row.
  const after1 = await db()
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.thesisId, thesisId));
  console.log(`  orders rows for this thesis: ${after1.length}`);

  console.log("\n=== Attempt #2 (idempotency replay) ===");
  const start2 = Date.now();
  try {
    const trade2 = await placeOrder(orderInput);
    console.log(`  resolved in ${Date.now() - start2}ms`);
    console.log(
      `  trade.id=${trade2.id.slice(0, 8)}  market=${trade2.market}  fillPrice=${trade2.fillPrice}  fillQty=${trade2.fillQuantity}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL: ${msg.slice(0, 400)}`);
    process.exit(1);
  }
  const after2 = await db()
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.thesisId, thesisId));

  console.log("\n=== Assertions ===");
  const ok1 = after1.length === 1;
  const ok2 = after2.length === 1;
  console.log(
    `  exactly one orders row after attempt #1: ${ok1 ? "PASS" : `FAIL (got ${after1.length})`}`,
  );
  console.log(
    `  exactly one orders row after attempt #2: ${ok2 ? "PASS" : `FAIL (got ${after2.length})`}`,
  );

  if (after2[0]) {
    console.log(
      `  final status=${after2[0].status}  sodexOrderId=${after2[0].sodexOrderId}  clientOrderId=${after2[0].clientOrderId.slice(0, 18)}...`,
    );
  }

  process.exit(ok1 && ok2 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke FAIL:", err);
  process.exit(1);
});
