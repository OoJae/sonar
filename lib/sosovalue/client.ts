// No `import "server-only"`: this module is imported from scripts/*.ts smoke
// tests under tsx (scripts/prices-coverage-smoke.ts, scripts/nav-smoke.ts,
// future Phase 3 work). Same reasoning as lib/db/client.ts, lib/sodex/paper.ts,
// lib/ssi/reader.ts. None of these functions are safe to bundle into a client
// component; the boundary is enforced by route-level use.
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { cached, cacheKey, CACHE_TTL } from "./cache";
import {
  CurrencyListResponseSchema,
  NewsFeaturedResponseSchema,
  EtfSummaryHistoryResponseSchema,
  EtfListResponseSchema,
  MarketSnapshotResponseSchema,
  SosoEndpoint,
  type CachedResponse,
  type CurrencyListResponse,
  type NewsFeaturedResponse,
  type EtfSummaryHistoryResponse,
  type EtfListResponse,
  type MarketSnapshotResponse,
} from "./types";
import {
  currencyListFixture,
  newsFeaturedFixture,
  etfSummaryHistoryFixture,
  etfListFixture,
} from "./fixtures";
import { ZodType } from "zod";

type QueryParams = Record<string, string | number | undefined>;

function buildUrl(endpoint: string, params: QueryParams): string {
  const e = env();
  const url = new URL(endpoint, e.SOSOVALUE_BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function callLive<T>(
  endpoint: string,
  params: QueryParams,
  schema: ZodType<T>,
): Promise<T> {
  const e = env();
  if (!e.SOSOVALUE_API_KEY) {
    throw new Error(
      "SOSOVALUE_API_KEY is missing. Set it or flip SONAR_DATA_SOURCE=fixture.",
    );
  }
  const url = buildUrl(endpoint, params);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-soso-api-key": e.SOSOVALUE_API_KEY,
      accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn("sosovalue.http_error", {
      endpoint,
      status: res.status,
      body: body.slice(0, 500),
    });
    throw new Error(`SoSoValue ${endpoint} returned ${res.status}`);
  }
  const json: unknown = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    logger.warn("sosovalue.parse_error", {
      endpoint,
      issues: parsed.error.issues.slice(0, 5),
    });
    throw new Error(
      `SoSoValue ${endpoint} response did not match schema: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  }
  return parsed.data;
}

function fixtureResponse<T>(data: T): CachedResponse<T> {
  return {
    data,
    staleAt: new Date(Date.now() + 60_000),
    source: "fixture",
  };
}

async function readEndpoint<T>(opts: {
  endpoint: string;
  params: QueryParams;
  ttl: number;
  schema: ZodType<T>;
  fixture: T;
}): Promise<CachedResponse<T>> {
  const e = env();
  if (e.SONAR_DATA_SOURCE === "fixture") {
    return fixtureResponse(opts.fixture);
  }
  return cached<T>({
    key: cacheKey(opts.endpoint, opts.params),
    ttlSeconds: opts.ttl,
    fetcher: () => callLive(opts.endpoint, opts.params, opts.schema),
  });
}

// 1.1 Currency List
export function getCurrencyList(): Promise<CachedResponse<CurrencyListResponse>> {
  return readEndpoint({
    endpoint: SosoEndpoint.CurrencyList,
    params: {},
    ttl: CACHE_TTL.currencyList,
    schema: CurrencyListResponseSchema,
    fixture: currencyListFixture,
  });
}

// 6.3 Featured News (live API expects camelCase pageNum/pageSize; the docs
// say snake_case but the wire rejects that).
export function getNewsFeatured(opts?: {
  pageSize?: number;
}): Promise<CachedResponse<NewsFeaturedResponse>> {
  const pageSize = opts?.pageSize ?? 30;
  return readEndpoint({
    endpoint: SosoEndpoint.NewsFeatured,
    params: { pageNum: 1, pageSize },
    ttl: CACHE_TTL.newsFeatured,
    schema: NewsFeaturedResponseSchema,
    fixture: newsFeaturedFixture,
  });
}

// 2.1 ETF Summary History (replaces the spec's "historicalInflowChart").
// Country defaults to US, the only market with full coverage in Wave 1.
export function getEtfSummaryHistory(
  symbol: string,
  opts?: { countryCode?: string; limit?: number },
): Promise<CachedResponse<EtfSummaryHistoryResponse>> {
  const countryCode = opts?.countryCode ?? "US";
  const limit = opts?.limit ?? 30;
  return readEndpoint({
    endpoint: SosoEndpoint.EtfSummaryHistory,
    params: { symbol, country_code: countryCode, limit },
    ttl: CACHE_TTL.historicalInflowChart,
    schema: EtfSummaryHistoryResponseSchema,
    fixture: etfSummaryHistoryFixture(symbol),
  });
}

// 2.2 ETF List for a given symbol (replaces the spec's per-fund metrics tool;
// the live API exposes per-fund metrics one ticker at a time, so the agent
// gets the list of available funds and the aggregate flow series).
export function getEtfList(
  symbol: string,
  opts?: { countryCode?: string },
): Promise<CachedResponse<EtfListResponse>> {
  const countryCode = opts?.countryCode ?? "US";
  return readEndpoint({
    endpoint: SosoEndpoint.EtfList,
    params: { symbol, country_code: countryCode },
    ttl: CACHE_TTL.currentEtfDataMetrics,
    schema: EtfListResponseSchema,
    fixture: etfListFixture(symbol),
  });
}

// 3.1 Per-currency market snapshot (Wave 2 NAV input). The path interpolates
// the currency_id, so we can't use the standard readEndpoint helper which
// expects a static path + query params. Fixtures are intentionally minimal:
// dev mode without a SoSoValue key returns a price of 1 for everything so
// the NAV computation degrades gracefully without crashing.
export async function getCurrencyMarketSnapshot(
  currency_id: string,
): Promise<CachedResponse<MarketSnapshotResponse>> {
  const e = env();
  const endpoint = SosoEndpoint.CurrencyMarketSnapshot.replace(
    "{currency_id}",
    currency_id,
  );
  const cacheKeyStr = cacheKey(endpoint, {});
  if (e.SONAR_DATA_SOURCE === "fixture") {
    return {
      data: {
        code: 0,
        message: null,
        data: { price: "1" },
      },
      staleAt: new Date(Date.now() + CACHE_TTL.marketSnapshot * 1000),
      source: "fixture",
    };
  }
  return cached<MarketSnapshotResponse>({
    key: cacheKeyStr,
    ttlSeconds: CACHE_TTL.marketSnapshot,
    fetcher: () => callLive(endpoint, {}, MarketSnapshotResponseSchema),
  });
}
