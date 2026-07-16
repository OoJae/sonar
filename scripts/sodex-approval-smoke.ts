#!/usr/bin/env tsx
//
// live-mainnet human-approval gate smoke.
//
// The single question this answers: on mainnet, can the autonomous cycle put an
// order on the wire? It must not, ever. Everything else here is secondary.
//
// It runs with SONAR_EXECUTION_MODE forced to live-mainnet in-process, but it
// NEVER contacts the mainnet venue: every assertion is about what we record and
// what we refuse, and the one place a real submit could happen (approve) is not
// exercised here. That is deliberate. A smoke that needed real mainnet
// credentials and real funds to prove "we do not submit" would be a smoke nobody
// runs. The wire itself is covered by the Phase 6 runbook, once, by a human.
//
// Asserts:
//   1. The cycle RECORDS pending_approval and nothing reaches the wire.
//   2. The recorded notional is the CAPPED one, not the agent's raw request
//      (feed it $100k, expect the $500 per-order cap). This is the flaw the
//      adversarial review caught: gate at record time, not approve time.
//   3. A second cycle SUPERSEDES the first row, so at most one row per market is
//      ever approvable.
//   4. A row with no agent run attached is REFUSED loudly (OrderAttributionError)
//      rather than silently dropped by an FK error.
//   5. placeOrder itself refuses live-mainnet.
//   6. submitApprovedOrder refuses an unclaimed row, a row queued under a
//      different mode, and a row past its approval TTL.
//   7. Delta-neutral skips entirely on mainnet rather than half-executing.
//   8. submitAndFinalize forwards reduceOnly, so an approved CLOSE is actually a
//      close. Without it the engine margins a close as new exposure and can
//      reject it at exactly the moment you need out.
//
// Usage: pnpm tsx scripts/sodex-approval-smoke.ts

import "./_env";
// Force mainnet BEFORE any module reads env() (it is cached on first read).
process.env.SONAR_EXECUTION_MODE = "live-mainnet";
process.env.SONAR_ALLOW_MAINNET = "true";
process.env.SONAR_REQUIRE_MANUAL_APPROVAL = "true";
// `||` not `??`: .env.local carries these as EMPTY strings, which ?? would keep
// (only null/undefined trigger it) and which env.ts then normalizes to undefined,
// tripping the mainnet boot guard.
process.env.SODEX_API_KEY = process.env.SODEX_API_KEY || "smoke-key-name";
process.env.SODEX_MAINNET_SIGNING_KEY =
  process.env.SODEX_MAINNET_SIGNING_KEY || `0x${"1".repeat(64)}`;
process.env.VALUECHAIN_USDC_ADDRESS =
  process.env.VALUECHAIN_USDC_ADDRESS || `0x${"2".repeat(40)}`;

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/utils/env";
import { placeOrder as executorPlaceOrder } from "@/lib/sodex/executor";
import {
  placeOrder as livePlaceOrder,
  submitApprovedOrder,
  PendingApprovalError,
  OrderAttributionError,
} from "@/lib/sodex/live";
import { runDeltaNeutral } from "@/lib/strategy/delta-neutral";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

async function seedRunAndThesis(): Promise<{ runId: string; thesisId: string }> {
  const runId = randomUUID();
  const thesisId = randomUUID();
  const now = new Date();
  await db().insert(schema.agentRuns).values({
    id: runId,
    startedAt: now,
    finishedAt: now,
    model: "approval-smoke",
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
    reasoning: "approval gate smoke",
    payload: { smoke: "approval" },
  });
  return { runId, thesisId };
}

async function main() {
  const e = env();
  if (e.SONAR_EXECUTION_MODE !== "live-mainnet") {
    console.error(
      `Expected live-mainnet in-process, got ${e.SONAR_EXECUTION_MODE}. env() may have been read before the override.`,
    );
    process.exit(2);
  }
  console.log(`Mode (in-process): ${e.SONAR_EXECUTION_MODE}`);
  console.log("No mainnet venue is contacted by this smoke.\n");

  const created: string[] = [];

  console.log("1. The autonomous cycle records instead of submitting");
  const { thesisId } = await seedRunAndThesis();
  let queuedOrderId = "";
  try {
    await executorPlaceOrder({
      thesisId,
      kind: "perp",
      market: "BTC-PERP",
      side: "buy",
      type: "market",
      // The agent's RAW request, far above the $500 per-order cap.
      notionalUSD: 100_000,
      slippageBps: 50,
    });
    assert("executor throws instead of returning a trade", false, "it returned");
  } catch (err) {
    assert("executor throws PendingApprovalError", err instanceof PendingApprovalError, String(err).slice(0, 120));
    if (err instanceof PendingApprovalError) queuedOrderId = err.orderId;
  }

  const rows = await db()
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.thesisId, thesisId));
  const queued = rows.find((r) => r.status === "pending_approval");
  created.push(...rows.map((r) => r.id));
  assert("exactly one row recorded", rows.length === 1, `got ${rows.length}`);
  assert("status is pending_approval", queued?.status === "pending_approval");
  assert("NOTHING reached the wire (sodexOrderId is null)", queued?.sodexOrderId === null);
  assert("row is stamped mode=live-mainnet", queued?.mode === "live-mainnet");
  assert("approvedAt is null until a human claims it", queued?.approvedAt === null);

  console.log("\n2. The recorded notional is the CAPPED one, not the raw request");
  const recorded = Number(queued?.notionalUsd ?? 0);
  assert(
    `$100,000 request recorded as the $${e.SONAR_MAX_NOTIONAL_PER_ORDER} cap (got $${recorded})`,
    recorded === e.SONAR_MAX_NOTIONAL_PER_ORDER,
    `recorded=${recorded}`,
  );

  console.log("\n3. A second cycle supersedes the first row");
  const second = await seedRunAndThesis();
  try {
    await executorPlaceOrder({
      thesisId: second.thesisId,
      kind: "perp",
      market: "BTC-PERP",
      side: "buy",
      type: "market",
      notionalUSD: 200,
      slippageBps: 50,
    });
  } catch {
    // expected: PendingApprovalError
  }
  const afterSecond = await db()
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.status, "pending_approval"),
        eq(schema.orders.market, "BTC-USD"),
      ),
    );
  const secondRows = await db()
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.thesisId, second.thesisId));
  created.push(...secondRows.map((r) => r.id));
  assert(
    "only one BTC-USD row is still approvable",
    afterSecond.length === 1,
    `got ${afterSecond.length}`,
  );
  const oldRow = await db()
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, queuedOrderId))
    .limit(1);
  assert("the older row was superseded to rejected", oldRow[0]?.status === "rejected");
  assert(
    "supersede reason is recorded",
    (oldRow[0]?.rejectionReason ?? "").includes("superseded"),
    oldRow[0]?.rejectionReason ?? "",
  );

  console.log("\n4. An unattributable order is refused loudly, not dropped");
  try {
    await executorPlaceOrder({
      thesisId: randomUUID(), // no thesis row, therefore no run
      kind: "perp",
      market: "BTC-PERP",
      side: "buy",
      type: "market",
      notionalUSD: 100,
      slippageBps: 50,
    });
    assert("throws for an unattributable order", false, "it returned");
  } catch (err) {
    assert(
      "throws OrderAttributionError (not a raw FK error)",
      err instanceof OrderAttributionError,
      String(err).slice(0, 120),
    );
  }

  console.log("\n5. live.placeOrder refuses mainnet outright");
  try {
    await livePlaceOrder({
      thesisId,
      kind: "perp",
      market: "BTC-PERP",
      side: "buy",
      type: "market",
      notionalUSD: 100,
      slippageBps: 50,
    });
    assert("placeOrder refuses live-mainnet", false, "it did not throw");
  } catch (err) {
    assert(
      "placeOrder refuses live-mainnet",
      String(err).includes("must not run on live-mainnet"),
      String(err).slice(0, 120),
    );
  }

  console.log("\n6. submitApprovedOrder refuses unclaimed / wrong-mode / stale rows");
  const target = afterSecond[0];
  if (!target) {
    assert("a pending row exists to test against", false);
  } else {
    // Unclaimed (approvedAt still null).
    try {
      await submitApprovedOrder(target.id);
      assert("refuses an unclaimed row", false, "it submitted");
    } catch (err) {
      assert(
        "refuses an unclaimed row",
        String(err).includes("not been claimed"),
        String(err).slice(0, 120),
      );
    }

    // Claimed but queued under a different mode.
    await db()
      .update(schema.orders)
      .set({ approvedAt: new Date(), approvedBy: "smoke", mode: "live-testnet" })
      .where(eq(schema.orders.id, target.id));
    try {
      await submitApprovedOrder(target.id);
      assert("refuses a row queued under a different mode", false, "it submitted");
    } catch (err) {
      assert(
        "refuses a row queued under a different mode",
        String(err).includes("queued under mode"),
        String(err).slice(0, 120),
      );
    }

    // Correct mode but past the approval TTL.
    const stale = new Date(Date.now() - (e.SONAR_APPROVAL_TTL_MINUTES + 60) * 60_000);
    await db()
      .update(schema.orders)
      .set({ mode: "live-mainnet", createdAt: stale })
      .where(eq(schema.orders.id, target.id));
    try {
      await submitApprovedOrder(target.id);
      assert("refuses a row past the approval TTL", false, "it submitted");
    } catch (err) {
      assert(
        "refuses a row past the approval TTL",
        String(err).includes("approval TTL"),
        String(err).slice(0, 120),
      );
    }
  }

  console.log("\n7. Delta-neutral does not half-execute on mainnet");
  const dnRun = await seedRunAndThesis();
  const before = await db().select().from(schema.orders);
  await runDeltaNeutral(dnRun.runId, 1);
  const after = await db().select().from(schema.orders);
  assert(
    "delta-neutral placed and queued nothing on mainnet",
    after.length === before.length,
    `orders went ${before.length} -> ${after.length}`,
  );

  // Clean up every row this smoke created so /signals and /track stay honest.
  const allSmoke = await db().select().from(schema.orders);
  const smokeIds = allSmoke
    .filter((r) => created.includes(r.id) || r.thesisId === dnRun.thesisId)
    .map((r) => r.id);
  for (const id of smokeIds) {
    await db().delete(schema.orders).where(eq(schema.orders.id, id));
  }
  console.log(`\nCleaned up ${smokeIds.length} smoke order rows.`);

  console.log("\n8. reduceOnly reaches the wire on a reducing order");
  {
    // Static guarantee rather than a live submit: this smoke never contacts the
    // venue. Assert the wiring exists, because its absence is silent (the venue
    // just says "insufficient margin" much later, on the close you needed).
    const src = readFileSync("lib/sodex/live.ts", "utf8");
    assert(
      "submitAndFinalize accepts a `reducing` flag",
      /async function submitAndFinalize\(input: \{[\s\S]*?reducing: boolean;/.test(src),
    );
    assert(
      "it forwards reduceOnly to submitPerpOrder",
      /reduceOnly: reducing,/.test(src),
    );
    const callers = src.match(/submitAndFinalize\(\{[\s\S]*?\}\);/g) ?? [];
    assert(
      `every submitAndFinalize caller passes reducing (${callers.length} found)`,
      callers.length >= 2 && callers.every((c) => c.includes("reducing:")),
      callers.map((c) => c.slice(0, 60)).join(" | "),
    );
  }

  console.log(`\nResults: ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Approval smoke FAILED:", err);
  process.exit(1);
});
