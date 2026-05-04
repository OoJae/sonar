import "server-only";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { cached, cacheKey, CACHE_TTL } from "./cache";
import {
  CurrencyListResponseSchema,
  NewsFeaturedResponseSchema,
  EtfSummaryHistoryResponseSchema,
  EtfListResponseSchema,
  SosoEndpoint,
  type CachedResponse,
  type CurrencyListResponse,
  type NewsFeaturedResponse,
  type EtfSummaryHistoryResponse,
  type EtfListResponse,
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
