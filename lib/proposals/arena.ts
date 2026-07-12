// The proposal arena: every AI-designed index accrues a FORWARD test from the
// moment it is created. One pricing snapshot per proposal per daily cycle; the
// indexed curve (start 100) chain-links per-period returns over the
// INTERSECTION of symbols priced in consecutive snapshots, weights renormalized
// over that intersection, so partial price coverage cannot fake a move (the
// lib/track/compute.ts methodology). This is a paper-priced design forward
// test, not an investable product.

import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { logger } from "@/lib/utils/logger";
import { listProposals } from "./store";
import { priceProposal } from "./price";
import type { Mark, Pricing } from "./schema";

const ARENA_CAP = 25; // most recent proposals repriced per cycle
const MIN_SNAPSHOT_GAP_HOURS = 20; // demo-run clicks must not densify curves

export async function insertProposalSnapshot(
  proposalId: string,
  pricing: Pricing,
): Promise<void> {
  await db()
    .insert(schema.proposalSnapshots)
    .values({
      proposalId,
      perUnitNavUsd:
        pricing.perUnitNavUsd === null ? null : String(pricing.perUnitNavUsd),
      pricedWeight: String(pricing.pricedWeight),
      priced: pricing.priced,
      total: pricing.total,
      marks: pricing.marks,
      asOf: new Date(pricing.asOf),
    });
}

// Reprice the arena (called once per cycle, non-fatal). Coverage-0 snapshots
// are stored with a null NAV: an auditable "we tried, source was down" row.
export async function repriceArena(): Promise<void> {
  const proposals = (await listProposals(ARENA_CAP)).slice(0, ARENA_CAP);
  if (proposals.length === 0) return;

  const cutoff = Date.now() - MIN_SNAPSHOT_GAP_HOURS * 3_600_000;
  for (const p of proposals) {
    try {
      const [latest] = await db()
        .select({ asOf: schema.proposalSnapshots.asOf })
        .from(schema.proposalSnapshots)
        .where(eq(schema.proposalSnapshots.proposalId, p.id))
        .orderBy(desc(schema.proposalSnapshots.asOf))
        .limit(1);
      if (latest && latest.asOf.getTime() > cutoff) continue;

      const pricing = await priceProposal(p.constituents);
      await insertProposalSnapshot(p.id, pricing);
    } catch (err) {
      logger.warn("arena.reprice_failed", {
        proposalId: p.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  logger.info("arena.repriced", { proposals: proposals.length });
}

export type ArenaPoint = { asOf: string; value: number };
export type ArenaEntry = {
  proposalId: string;
  points: ArenaPoint[]; // indexed curve, 100 at inception
  returnSincePct: number | null; // null until 2 priced snapshots exist
  snapshots: number;
};

function marksBySymbol(marks: Mark[]): Map<string, Mark> {
  const m = new Map<string, Mark>();
  for (const mark of marks) {
    if (mark.priceUsd !== null && mark.priceUsd > 0) m.set(mark.symbol, mark);
  }
  return m;
}

// Chain-linked per-period return over the priced intersection of consecutive
// snapshots, weights renormalized over that intersection.
function periodReturn(prev: Mark[], cur: Mark[]): number {
  const prevMap = marksBySymbol(prev);
  const curMap = marksBySymbol(cur);
  let weightSum = 0;
  let weighted = 0;
  for (const [symbol, p0] of prevMap) {
    const p1 = curMap.get(symbol);
    if (!p1) continue;
    weightSum += p0.weight;
    weighted += p0.weight * (p1.priceUsd! / p0.priceUsd! - 1);
  }
  if (weightSum <= 0) return 0;
  return weighted / weightSum;
}

export async function computeArena(
  proposalIds: string[],
): Promise<Map<string, ArenaEntry>> {
  const out = new Map<string, ArenaEntry>();
  if (proposalIds.length === 0) return out;
  try {
    const rows = await db()
      .select()
      .from(schema.proposalSnapshots)
      .where(inArray(schema.proposalSnapshots.proposalId, proposalIds))
      .orderBy(asc(schema.proposalSnapshots.asOf));

    const byProposal = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byProposal.get(row.proposalId) ?? [];
      list.push(row);
      byProposal.set(row.proposalId, list);
    }

    for (const [proposalId, snaps] of byProposal) {
      // Only snapshots with at least one priced mark participate in the curve.
      const priced = snaps.filter((s) => s.priced > 0);
      const points: ArenaPoint[] = [];
      let value = 100;
      for (let i = 0; i < priced.length; i++) {
        if (i > 0) {
          value *=
            1 +
            periodReturn(
              priced[i - 1]!.marks as Mark[],
              priced[i]!.marks as Mark[],
            );
        }
        points.push({ asOf: priced[i]!.asOf.toISOString(), value });
      }
      out.set(proposalId, {
        proposalId,
        points,
        returnSincePct: points.length >= 2 ? value - 100 : null,
        snapshots: snaps.length,
      });
    }
  } catch (err) {
    logger.warn("arena.compute_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}
