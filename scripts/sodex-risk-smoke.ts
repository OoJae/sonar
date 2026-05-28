#!/usr/bin/env tsx
//
// Phase 2.3 risk gate smoke. Pure-function checks; no wire, no DB.
//
// Asserts:
//   1. isDust returns true for amounts below $10.
//   2. enforcePerOrderCap downsizes amounts above SONAR_MAX_NOTIONAL_PER_ORDER
//      and leaves smaller amounts unchanged.
//   3. enforcePerCycleCap allows the first order, blocks the order that
//      would push the running total past SONAR_MAX_NOTIONAL_PER_CYCLE.
//   4. recordPlaced advances the per-cycle accumulator.
//   5. resetCycle wipes the per-cycle accumulator.
//
// Run any time the risk gate changes:
//   pnpm tsx scripts/sodex-risk-smoke.ts

import "./_env";
import {
  DUST_FLOOR_USD,
  cycleSpent,
  enforcePerCycleCap,
  enforcePerOrderCap,
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

console.log(`\nResults: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
