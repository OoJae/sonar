// Wave 2 verifiable track record. Computes Sonar's cumulative return versus a
// buy-and-hold baseline of the same index universe, plus per-thesis attribution
// and win rate, entirely from data we already persist: theses (with their
// proposedAllocations weights), nav_snapshots, and orders. No new schema.
//
// Method (NAV-weighted reconstruction, the clean index-NAV math):
//   - Group nav_snapshots into per-cycle batches by created_at second; each
//     batch carries the four index NAVs at that cycle.
//   - For each batch, the governing thesis is the most recent thesis at or
//     before the batch time; its targetWeights drive Sonar's book that cycle.
//   - Book curve (rebalanced): chain-link per-cycle returns
//     periodReturn = sum_i weight_i * (nav_i(t+1)/nav_i(t) - 1), USSI held at
//     $1 so its leg returns 0. Start the index at 100.
//   - Baseline curve (buy-and-hold): buy the first thesis's weights at
//     inception, never rebalance; value(t) = sum_i units_i * nav_i(t).
//   Both normalized to 100 at inception, so the gap is active rebalancing vs
//   static hold. Honest framing: paper plus testnet during the buildathon.

import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

type IndexKey = "MAG7" | "DEFI" | "MEME" | "USSI";
const RISK_INDICES: IndexKey[] = ["MAG7", "DEFI", "MEME"];

export type CurvePoint = { at: string; book: number; baseline: number };

export type ThesisAttribution = {
  thesisId: string;
  runId: string | null;
  generatedAt: string;
  mode: "trade" | "no-trade";
  weights: Record<string, number>;
  notionalPlacedUsd: number;
  periodReturnPct: number | null;
  win: boolean | null;
};

export type TrackData = {
  hasEnoughData: boolean;
  inceptionAt: string | null;
  latestAt: string | null;
  curve: CurvePoint[];
  bookReturnPct: number;
  baselineReturnPct: number;
  winRate: number | null;
  tradeCount: number;
  noTradeCount: number;
  attributions: ThesisAttribution[];
};

type NavBatch = { at: Date; nav: Partial<Record<IndexKey, number>> };
type ThesisRow = {
  id: string;
  runId: string | null;
  generatedAt: Date;
  mode: "trade" | "no-trade";
  weights: Record<string, number>;
};

function weightsFromPayload(payload: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof payload !== "object" || payload === null) return out;
  const allocs = (payload as Record<string, unknown>).proposedAllocations;
  if (!Array.isArray(allocs)) return out;
  for (const a of allocs) {
    if (typeof a === "object" && a !== null) {
      const idx = (a as Record<string, unknown>).index;
      const w = (a as Record<string, unknown>).targetWeight;
      if (typeof idx === "string" && typeof w === "number") out[idx] = w;
    }
  }
  return out;
}

// USSI absorbs the residual weight and is held at $1, so it contributes no
// return but dampens the risky legs.
function ussiWeight(weights: Record<string, number>): number {
  const risk = RISK_INDICES.reduce((acc, k) => acc + (weights[k] ?? 0), 0);
  return Math.max(0, 1 - risk);
}

export async function computeTrackData(): Promise<TrackData> {
  const navRows = await db()
    .select({
      index: schema.navSnapshots.index,
      nav: schema.navSnapshots.navPerShareUsd,
      createdAt: schema.navSnapshots.createdAt,
    })
    .from(schema.navSnapshots)
    .orderBy(asc(schema.navSnapshots.createdAt));

  // Group into cycle batches by created_at truncated to the second.
  const batchMap = new Map<string, NavBatch>();
  for (const r of navRows) {
    const key = new Date(Math.floor(r.createdAt.getTime() / 1000) * 1000).toISOString();
    let b = batchMap.get(key);
    if (!b) {
      b = { at: new Date(key), nav: {} };
      batchMap.set(key, b);
    }
    const n = Number(r.nav);
    if (Number.isFinite(n)) b.nav[r.index as IndexKey] = n;
  }
  const batches = Array.from(batchMap.values()).sort(
    (a, b) => a.at.getTime() - b.at.getTime(),
  );

  const thesisRows = await db()
    .select({
      id: schema.theses.id,
      runId: schema.theses.runId,
      generatedAt: schema.theses.generatedAt,
      mode: schema.theses.mode,
      payload: schema.theses.payload,
    })
    .from(schema.theses)
    // Directional book only: the delta-neutral strategy has its own thesis rows
    // (Wave 3) and must not become a governing thesis for this reconstruction.
    .where(eq(schema.theses.strategy, "directional"))
    .orderBy(asc(schema.theses.generatedAt));

  const theses: ThesisRow[] = thesisRows.map((t) => ({
    id: t.id,
    runId: t.runId,
    generatedAt: t.generatedAt,
    mode: t.mode as "trade" | "no-trade",
    weights: weightsFromPayload(t.payload),
  }));

  const tradeCount = theses.filter((t) => t.mode === "trade").length;
  const noTradeCount = theses.filter((t) => t.mode === "no-trade").length;

  // Notional actually placed per thesis, for the attribution table.
  //
  // ONE ledger: paper_trades. It already carries every executed leg in every
  // mode, live fills included (lib/sodex/live.ts writes a paper_trades row from
  // the real fill price x quantity alongside the orders row), and it only exists
  // once an order actually executed.
  //
  // This previously summed `orders` too, which double-counted every live fill
  // (the same fill has a row in both tables) and counted rows that never reached
  // the venue at all as "placed". With the approval gate that would get worse
  // still: an order queued for a human and never approved would be published as
  // notional we placed. Do not re-add an `orders` sum here.
  const notionalByThesis = new Map<string, number>();
  try {
    const tradeRows = await db()
      .select({ thesisId: schema.paperTrades.thesisId, notional: schema.paperTrades.notionalUsd })
      .from(schema.paperTrades);
    for (const t of tradeRows) {
      notionalByThesis.set(
        t.thesisId,
        (notionalByThesis.get(t.thesisId) ?? 0) + Number(t.notional),
      );
    }
  } catch {
    // attribution notional is best-effort
  }

  // Need at least two NAV batches to compute a return.
  if (batches.length < 2) {
    return {
      hasEnoughData: false,
      inceptionAt: batches[0]?.at.toISOString() ?? null,
      latestAt: batches[batches.length - 1]?.at.toISOString() ?? null,
      curve: batches.map((b) => ({ at: b.at.toISOString(), book: 100, baseline: 100 })),
      bookReturnPct: 0,
      baselineReturnPct: 0,
      winRate: null,
      tradeCount,
      noTradeCount,
      attributions: [],
    };
  }

  // Governing thesis for a batch: the most recent thesis at or before it.
  function governingThesis(at: Date): ThesisRow | null {
    let gov: ThesisRow | null = null;
    for (const t of theses) {
      if (t.generatedAt.getTime() <= at.getTime() + 5000) gov = t;
      else break;
    }
    return gov ?? theses[0] ?? null;
  }

  // Baseline units from the first batch and its governing thesis weights.
  const first = batches[0]!;
  const w0 = governingThesis(first.at)?.weights ?? {};
  const baseUnits: Record<string, number> = {};
  for (const k of RISK_INDICES) {
    const nav0 = first.nav[k];
    if (nav0 && nav0 > 0) baseUnits[k] = (100 * (w0[k] ?? 0)) / nav0;
  }
  const baseUssiValue = 100 * ussiWeight(w0); // USSI held at $1, constant value

  const curve: CurvePoint[] = [];
  let bookIndex = 100;
  curve.push({ at: first.at.toISOString(), book: 100, baseline: 100 });

  // Attribution: a thesis "wins" if the cycle it governed produced a positive
  // book period return.
  const periodReturnByThesis = new Map<string, number>();

  // Last good NAV per index, carried forward across batches. An index missing or
  // non-positive in a batch (a data outage, or a partial persist) must NOT drop
  // that index's contribution to zero for one curve while the other holds it
  // flat: that asymmetry published a fabricated buy-and-hold crash on /track.
  // Both curves hold flat on missing data by reading the carried-forward value.
  const lastNav: Record<string, number> = {};
  for (const i of RISK_INDICES) {
    const n0 = first.nav[i];
    if (n0 && n0 > 0) lastNav[i] = n0;
  }

  for (let k = 1; k < batches.length; k++) {
    const prev = batches[k - 1]!;
    const cur = batches[k]!;
    const gov = governingThesis(prev.at);
    const w = gov?.weights ?? {};

    let periodReturn = 0;
    let baselineValue = baseUssiValue;
    for (const i of RISK_INDICES) {
      const prevNav = lastNav[i];
      const raw = cur.nav[i];
      // Hold flat when the current read is missing or non-positive: the ratio is
      // 1 (no period return) and the baseline keeps the last good value.
      const curNav = raw && raw > 0 ? raw : prevNav;

      if (prevNav && prevNav > 0 && curNav && curNav > 0) {
        periodReturn += (w[i] ?? 0) * (curNav / prevNav - 1);
      }
      const units = baseUnits[i] ?? 0;
      if (curNav && curNav > 0) baselineValue += units * curNav;

      // Advance only on a real read, so a gap does not concentrate a move.
      if (raw && raw > 0) lastNav[i] = raw;
    }

    bookIndex *= 1 + periodReturn;
    if (gov) periodReturnByThesis.set(gov.id, periodReturn);

    curve.push({
      at: cur.at.toISOString(),
      book: bookIndex,
      baseline: baselineValue,
    });
  }

  const bookReturnPct = bookIndex - 100;
  const baselineReturnPct = (curve[curve.length - 1]?.baseline ?? 100) - 100;

  // Win rate over trade theses that governed a measured cycle.
  let wins = 0;
  let measured = 0;
  for (const t of theses) {
    if (t.mode !== "trade") continue;
    const r = periodReturnByThesis.get(t.id);
    if (r === undefined) continue;
    measured++;
    if (r > 0) wins++;
  }
  const winRate = measured > 0 ? wins / measured : null;

  const attributions: ThesisAttribution[] = theses
    .slice()
    .reverse()
    .map((t) => ({
      thesisId: t.id,
      runId: t.runId,
      generatedAt: t.generatedAt.toISOString(),
      mode: t.mode,
      weights: t.weights,
      notionalPlacedUsd: notionalByThesis.get(t.id) ?? 0,
      periodReturnPct:
        periodReturnByThesis.has(t.id)
          ? (periodReturnByThesis.get(t.id) ?? 0) * 100
          : null,
      win:
        t.mode === "trade" && periodReturnByThesis.has(t.id)
          ? (periodReturnByThesis.get(t.id) ?? 0) > 0
          : null,
    }));

  return {
    hasEnoughData: true,
    inceptionAt: first.at.toISOString(),
    latestAt: batches[batches.length - 1]!.at.toISOString(),
    curve,
    bookReturnPct,
    baselineReturnPct,
    winRate,
    tradeCount,
    noTradeCount,
    attributions,
  };
}
