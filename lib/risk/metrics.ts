// Wave 3 production risk engine - metrics layer.
//
// Portfolio-level risk measures derived entirely from data we already persist
// (nav_snapshots + the reconstructed book curve + paper_positions). No new
// external calls, so this works even when the live data source is down.
//
//   - Historical VaR: the empirical one-cycle loss at a confidence level, taken
//     from the book's per-cycle return distribution (lib/track/compute curve).
//   - Max / current drawdown: peak-to-trough of the book curve.
//   - Index correlation matrix: pairwise Pearson correlation of the risk
//     indices' per-cycle NAV returns (USSI is the flat $1 anchor, excluded).
//   - Exposure / concentration: current book weight per index + a Herfindahl
//     concentration index across the risk legs.

import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { computeTrackData } from "@/lib/track/compute";
import { getPositions } from "@/lib/sodex/paper";

export type RiskIndexKey = "MAG7" | "DEFI" | "MEME";
const RISK_INDICES: RiskIndexKey[] = ["MAG7", "DEFI", "MEME"];
const SSI_MARKET: Record<string, RiskIndexKey> = {
  "MAG7.ssi": "MAG7",
  "DEFI.ssi": "DEFI",
  "MEME.ssi": "MEME",
};

export type CorrelationMatrix = {
  indices: RiskIndexKey[];
  matrix: (number | null)[][];
};

export type IndexExposure = {
  index: RiskIndexKey | "USSI";
  marketValueUsd: number;
  weight: number;
};

export type RiskMetrics = {
  hasEnoughData: boolean;
  sampleSize: number;
  varConfidence: number;
  varPct: number; // positive % expected one-cycle loss at the confidence level
  maxDrawdownPct: number; // positive %
  currentDrawdownPct: number; // positive %
  correlation: CorrelationMatrix;
  exposure: IndexExposure[];
  concentrationHHI: number; // 0..1 Herfindahl across the risk legs
};

// Historical VaR: the confidence-level quantile of the loss distribution.
// e.g. 95% VaR = negative of the 5th-percentile return, reported as a positive %.
export function historicalVaRPct(returns: number[], confidence: number): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((1 - confidence) * sorted.length)),
  );
  const q = sorted[idx] ?? 0;
  return Math.max(0, -q) * 100;
}

// Max and current drawdown from an index-value series (e.g. book curve).
export function drawdowns(series: number[]): {
  maxPct: number;
  currentPct: number;
} {
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - v) / peak);
  }
  const last = series[series.length - 1] ?? 0;
  const current = peak > 0 ? Math.max(0, (peak - last) / peak) : 0;
  return { maxPct: maxDd * 100, currentPct: current * 100 };
}

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va <= 0 || vb <= 0) return null; // a flat series has undefined correlation
  return cov / Math.sqrt(va * vb);
}

// Per-index one-cycle NAV return series, grouped into the same per-second cycle
// batches the track page uses.
async function indexReturnSeries(): Promise<Record<RiskIndexKey, number[]>> {
  const rows = await db()
    .select({
      index: schema.navSnapshots.index,
      nav: schema.navSnapshots.navPerShareUsd,
      createdAt: schema.navSnapshots.createdAt,
    })
    .from(schema.navSnapshots)
    .orderBy(asc(schema.navSnapshots.createdAt));

  const batchMap = new Map<string, Partial<Record<RiskIndexKey, number>>>();
  const order: string[] = [];
  for (const r of rows) {
    const key = new Date(
      Math.floor(r.createdAt.getTime() / 1000) * 1000,
    ).toISOString();
    let b = batchMap.get(key);
    if (!b) {
      b = {};
      batchMap.set(key, b);
      order.push(key);
    }
    const idx = SSI_MARKET[`${r.index}.ssi`] ?? (r.index as RiskIndexKey);
    if (RISK_INDICES.includes(idx as RiskIndexKey)) {
      const n = Number(r.nav);
      if (Number.isFinite(n)) b[idx as RiskIndexKey] = n;
    }
  }

  const series: Record<RiskIndexKey, number[]> = {
    MAG7: [],
    DEFI: [],
    MEME: [],
  };
  for (let k = 1; k < order.length; k++) {
    const prev = batchMap.get(order[k - 1]!)!;
    const cur = batchMap.get(order[k]!)!;
    for (const i of RISK_INDICES) {
      const a = prev[i];
      const b = cur[i];
      if (a && a > 0 && b && b > 0) series[i].push(b / a - 1);
    }
  }
  return series;
}

export async function computeRiskMetrics(
  varConfidence = 0.95,
): Promise<RiskMetrics> {
  const track = await computeTrackData();

  // Book per-cycle returns from the reconstructed curve.
  const bookSeries = track.curve.map((p) => p.book);
  const bookReturns: number[] = [];
  for (let i = 1; i < bookSeries.length; i++) {
    const a = bookSeries[i - 1]!;
    const b = bookSeries[i]!;
    if (a > 0) bookReturns.push(b / a - 1);
  }

  const varPct = historicalVaRPct(bookReturns, varConfidence);
  const dd = drawdowns(bookSeries.length ? bookSeries : [100]);

  const series = await indexReturnSeries();
  const matrix: (number | null)[][] = RISK_INDICES.map((ri) =>
    RISK_INDICES.map((rj) =>
      ri === rj ? 1 : pearson(series[ri], series[rj]),
    ),
  );

  // Current exposure from the (directional) paper book.
  const positions = await getPositions().catch(() => []);
  const mvByIndex = new Map<RiskIndexKey | "USSI", number>();
  for (const p of positions) {
    const idx =
      SSI_MARKET[p.market] ?? (p.market === "USSI" ? "USSI" : null);
    if (!idx) continue;
    const mv = Math.abs(p.markPrice * p.quantity);
    mvByIndex.set(idx, (mvByIndex.get(idx) ?? 0) + mv);
  }
  const totalMv = Array.from(mvByIndex.values()).reduce((a, b) => a + b, 0);
  const exposure: IndexExposure[] = ([...RISK_INDICES, "USSI"] as const).map(
    (index) => {
      const marketValueUsd = mvByIndex.get(index) ?? 0;
      return {
        index,
        marketValueUsd,
        weight: totalMv > 0 ? marketValueUsd / totalMv : 0,
      };
    },
  );
  const concentrationHHI = RISK_INDICES.reduce((acc, i) => {
    const w = totalMv > 0 ? (mvByIndex.get(i) ?? 0) / totalMv : 0;
    return acc + w * w;
  }, 0);

  return {
    hasEnoughData: track.hasEnoughData && bookReturns.length >= 2,
    sampleSize: bookReturns.length,
    varConfidence,
    varPct,
    maxDrawdownPct: dd.maxPct,
    currentDrawdownPct: dd.currentPct,
    correlation: { indices: RISK_INDICES, matrix },
    exposure,
    concentrationHHI,
  };
}
