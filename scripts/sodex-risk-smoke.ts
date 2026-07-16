#!/usr/bin/env tsx
//
// Risk gate smoke. Pure-function checks; no wire, no DB.
//
// Asserts:
//   1. isDust returns true for amounts below $10.
//   2. enforcePerOrderCap downsizes amounts above SONAR_MAX_NOTIONAL_PER_ORDER
//      and leaves smaller amounts unchanged.
//   3. enforcePerCycleCap allows the first order, blocks the order that
//      would push the running total past SONAR_MAX_NOTIONAL_PER_CYCLE.
//   4. recordPlaced advances the per-cycle accumulator.
//   5. resetCycle wipes the per-cycle accumulator.
//   6. enforcePositionCap bounds the resulting per-market position, and
//      NEVER gates a reducing order (the layer-4 invariant).
//   7. enforceGrossExposureCap bounds the sum of absolute notionals, with
//      the same reducing-order invariant.
//
// Section 6 is regression cover for a real incident: 32 individually-capped
// BTC sells compounded into a 0.234 BTC short (~$14.8k notional at 20x on a
// $1.5k account) because nothing bounded the book. The $14,812 figures below
// are the real numbers from that book.
//
// Run any time the risk gate changes:
//   pnpm tsx scripts/sodex-risk-smoke.ts

import "./_env";
import {
  DUST_FLOOR_USD,
  cycleSpent,
  enforceGrossExposureCap,
  enforcePerCycleCap,
  enforcePerOrderCap,
  enforcePositionCap,
  isDust,
  recordPlaced,
  resetCycle,
} from "@/lib/sodex/risk";
import { env } from "@/lib/utils/env";

const runId = `risk-smoke-${Date.now()}`;
const e = env();
const perOrderCap = e.SONAR_MAX_NOTIONAL_PER_ORDER;
const perCycleCap = e.SONAR_MAX_NOTIONAL_PER_CYCLE;
console.log(
  `Caps: per-order=$${perOrderCap}  per-cycle=$${perCycleCap}  dust-floor=$${DUST_FLOOR_USD}`,
);

let pass = 0;
let fail = 0;

function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ""}`);
    fail++;
  }
}

console.log("\n1. Dust floor");
assert("isDust($5) === true", isDust(5));
assert("isDust($10) === false", !isDust(10));
assert("isDust($50) === false", !isDust(50));

console.log("\n2. Per-order cap");
const small = enforcePerOrderCap(perOrderCap / 2);
assert(`small order unchanged`, !small.downsized && small.notionalUSD === perOrderCap / 2);
const large = enforcePerOrderCap(perOrderCap * 2);
assert(`large order downsized to cap`, large.downsized && large.notionalUSD === perOrderCap);
const exact = enforcePerOrderCap(perOrderCap);
assert(`exactly-at-cap unchanged`, !exact.downsized && exact.notionalUSD === perOrderCap);

console.log("\n3. Per-cycle cap (using a fresh runId)");
resetCycle(runId);
assert(`fresh cycle starts at 0 spent`, cycleSpent(runId) === 0);
const half = perCycleCap / 2;
const allow1 = enforcePerCycleCap(runId, half);
assert(`first half-cycle order allowed`, allow1.allow);
recordPlaced(runId, half);
assert(`accumulator advanced to half`, cycleSpent(runId) === half);
const allow2 = enforcePerCycleCap(runId, half);
assert(`second half-cycle order allowed`, allow2.allow);
recordPlaced(runId, half);
assert(`accumulator at cap`, cycleSpent(runId) === perCycleCap);
const blocked = enforcePerCycleCap(runId, 1);
assert(`next $1 blocked`, !blocked.allow);

console.log("\n4. Cycle isolation (different runIds get separate budgets)");
const otherRun = `risk-smoke-other-${Date.now()}`;
assert(`other runId starts at 0`, cycleSpent(otherRun) === 0);
const allowOther = enforcePerCycleCap(otherRun, half);
assert(`other runId can spend independently`, allowOther.allow);

console.log("\n5. resetCycle wipes the accumulator");
resetCycle(runId);
assert(`runId budget reset`, cycleSpent(runId) === 0);
const reallow = enforcePerCycleCap(runId, half);
assert(`fresh order allowed after reset`, reallow.allow);

console.log("\n6. Per-market position cap (layer 4a)");
{
  const cap = e.SONAR_MAX_POSITION_NOTIONAL_USD;
  const flat = enforcePositionCap({
    market: "BTC-USD", side: "sell", notionalUSD: 500, currentPositionUSD: 0,
  });
  assert("flat book: order allowed in full", flat.allow && flat.notionalUSD === 500);

  // The incident: an already-oversized short must not grow.
  const grow = enforcePositionCap({
    market: "BTC-USD", side: "sell", notionalUSD: 500, currentPositionUSD: -14812,
  });
  assert("oversized short: further sell BLOCKED", !grow.allow);

  // The invariant: reducing is never gated, at any size.
  const reduce = enforcePositionCap({
    market: "BTC-USD", side: "buy", notionalUSD: 500, currentPositionUSD: -14812,
  });
  assert(
    "oversized short: reducing buy ALLOWED in full",
    reduce.allow && reduce.notionalUSD === 500 && reduce.reducing,
  );

  const close = enforcePositionCap({
    market: "BTC-USD", side: "buy", notionalUSD: 14812, currentPositionUSD: -14812,
  });
  assert(
    "oversized short: full close ALLOWED in full",
    close.allow && close.notionalUSD === 14812,
  );

  // Growth is downsized to the remaining headroom, not rejected outright.
  const near = cap - 200;
  const partial = enforcePositionCap({
    market: "BTC-USD", side: "sell", notionalUSD: 500, currentPositionUSD: -near,
  });
  assert(
    "near cap: growth downsized to headroom",
    partial.allow && partial.downsized && Math.abs(partial.notionalUSD - 200) < 0.01,
  );

  const atCap = enforcePositionCap({
    market: "BTC-USD", side: "sell", notionalUSD: 500, currentPositionUSD: -cap,
  });
  assert("at cap: growth BLOCKED (headroom is dust)", !atCap.allow);
}

console.log("\n7. Gross exposure cap (layer 4b)");
{
  const gcap = e.SONAR_MAX_GROSS_EXPOSURE_USD;
  const empty = enforceGrossExposureCap({
    market: "ETH-USD", notionalUSD: 500, grossExposureUSD: 0, reducing: false,
  });
  assert("empty book: allowed in full", empty.allow && empty.notionalUSD === 500);

  const over = enforceGrossExposureCap({
    market: "ETH-USD", notionalUSD: 500, grossExposureUSD: 18800, reducing: false,
  });
  assert("book far over cap: new exposure BLOCKED", !over.allow);

  const reducing = enforceGrossExposureCap({
    market: "ETH-USD", notionalUSD: 500, grossExposureUSD: 18800, reducing: true,
  });
  assert(
    "book far over cap: reducing ALLOWED (invariant)",
    reducing.allow && reducing.notionalUSD === 500,
  );

  const partial = enforceGrossExposureCap({
    market: "ETH-USD", notionalUSD: 500, grossExposureUSD: gcap - 200, reducing: false,
  });
  assert(
    "near gross cap: downsized to headroom",
    partial.allow && partial.downsized && Math.abs(partial.notionalUSD - 200) < 0.01,
  );
}

console.log(`\nResults: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
