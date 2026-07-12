// Wave 3 delta-neutral track. Reads the per-cycle dn_snapshots series (written by
// the runner after markToMarket) and returns the neutrality/P&L points plus the
// current book and rebalance count. Independent of computeTrackData (the
// directional reconstruction), so the directional /track is unaffected.

import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

export type DnTrackPoint = {
  asOf: string;
  netUsd: number;
  pnlUsd: number;
  grossUsd: number;
};

export type DeltaNeutralTrack = {
  hasData: boolean;
  points: DnTrackPoint[];
  current: {
    longUsd: number;
    shortUsd: number;
    netUsd: number;
    unrealizedPnlUsd: number;
  } | null;
  rebalanceCount: number;
};

export async function computeDeltaNeutralTrack(): Promise<DeltaNeutralTrack> {
  try {
    const rows = await db()
      .select()
      .from(schema.dnSnapshots)
      .orderBy(asc(schema.dnSnapshots.asOf));

    const points: DnTrackPoint[] = rows.map((r) => ({
      asOf: r.asOf.toISOString(),
      netUsd: Number(r.netUsd),
      pnlUsd: Number(r.unrealizedPnlUsd),
      grossUsd: Number(r.grossUsd),
    }));

    const last = rows[rows.length - 1];
    const current = last
      ? {
          longUsd: Number(last.longUsd),
          shortUsd: Number(last.shortUsd),
          netUsd: Number(last.netUsd),
          unrealizedPnlUsd: Number(last.unrealizedPnlUsd),
        }
      : null;

    // Each delta-neutral thesis is persisted only when a rebalance leg is placed,
    // so the row count is the rebalance count.
    const rebalanceRows = await db()
      .select({ id: schema.theses.id })
      .from(schema.theses)
      .where(eq(schema.theses.strategy, "delta-neutral"));

    return {
      hasData: points.length > 0,
      points,
      current,
      rebalanceCount: rebalanceRows.length,
    };
  } catch {
    return { hasData: false, points: [], current: null, rebalanceCount: 0 };
  }
}
