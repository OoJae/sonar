import { randomUUID } from "node:crypto";
import {
  newsItemTitle,
  type EtfSummaryHistoryItem,
  type EtfSummaryHistoryResponse,
  type NewsFeaturedResponse,
  type NewsItem,
} from "./types";
import type { EtfAsset, EtfFlowSignal, NewsSignal } from "@/lib/agent/thesis";
import { SosoEndpoint } from "./types";

const FLOW_WINDOW_DAYS = 7;

export function normalizeEtfFlow(
  asset: EtfAsset,
  resp: EtfSummaryHistoryResponse,
): EtfFlowSignal {
  // The API returns rows in reverse-chronological order; oldest at the end.
  // Normalize to chronological for windowing math.
  const series = [...resp.data].reverse().filter(
    (p): p is EtfSummaryHistoryItem => p !== undefined,
  );
  const window = series.slice(-FLOW_WINDOW_DAYS);

  const sum = window.reduce((acc, p) => acc + (p.total_net_inflow ?? 0), 0);
  const absSum = window.reduce(
    (acc, p) => acc + Math.abs(p.total_net_inflow ?? 0),
    0,
  );

  const direction =
    sum > absSum * 0.05
      ? "inflow"
      : sum < -absSum * 0.05
      ? "outflow"
      : "neutral";

  const confidence =
    absSum === 0 ? 0 : Math.min(1, Math.abs(sum) / absSum);

  return {
    id: `flow-${asset}-${randomUUID().slice(0, 8)}`,
    asset,
    direction,
    magnitudeUSD: sum,
    windowDays: window.length,
    confidence: Number(confidence.toFixed(3)),
    sourceEndpoint: SosoEndpoint.EtfSummaryHistory,
  };
}

// SoSoValue does not expose sentiment on news items; the agent infers stance
// in its reasoning text. We default to "neutral" with low confidence so the
// validator still passes and the signal is auditable.
function defaultStance(): NewsSignal["stance"] {
  return "neutral";
}

export function normalizeNews(
  resp: NewsFeaturedResponse,
  limit = 12,
): NewsSignal[] {
  const list = resp.data.list ?? [];
  return list.slice(0, limit).flatMap((item: NewsItem) => {
    const url = item.sourceLink ?? item.originalLink ?? null;
    const headline = newsItemTitle(item);
    if (!url || !headline) return [];
    const currency = item.matchedCurrencies?.[0]?.name ?? "GLOBAL";
    const publishedAt = item.releaseTime
      ? new Date(item.releaseTime).toISOString()
      : new Date().toISOString();
    return [
      {
        id: `news-${item.id}`,
        currency,
        category: String(item.category ?? "news"),
        headline,
        url,
        stance: defaultStance(),
        confidence: 0.4,
        publishedAt,
      } satisfies NewsSignal,
    ];
  });
}
