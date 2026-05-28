import { Redis } from "@upstash/redis";
import { env } from "@/lib/utils/env";
import type { CachedResponse } from "./types";

// SoSoValue High Frequency Package: 100 requests per minute, 100k calls/month.
// Beta tier was 20 rpm. If we ever drop back, change this and the comment.
const RATE_LIMIT_RPM = 100;
const RATE_LIMIT_WINDOW_SEC = 60;
const BUCKET_KEY = "sonar:sosovalue:bucket";

type LocalCacheEntry = {
  value: unknown;
  expiresAt: number;
};

const localCache = new Map<string, LocalCacheEntry>();
const localBucket = {
  windowStart: 0,
  count: 0,
};

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const e = env();
  if (!e.UPSTASH_REDIS_REST_URL || !e.UPSTASH_REDIS_REST_TOKEN) return null;
  redis = new Redis({
    url: e.UPSTASH_REDIS_REST_URL,
    token: e.UPSTASH_REDIS_REST_TOKEN,
  });
  return redis;
}

export function cacheKey(endpoint: string, params: Record<string, unknown>) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join("&");
  return `sonar:sosovalue:${endpoint}${sorted ? `?${sorted}` : ""}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (r) {
    const raw = await r.get<T>(key);
    return raw ?? null;
  }
  const entry = localCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    localCache.delete(key);
    return null;
  }
  return entry.value as T;
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  const r = getRedis();
  if (r) {
    await r.set(key, value, { ex: ttlSeconds });
    return;
  }
  localCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

// Token bucket: at most RATE_LIMIT_RPM requests per rolling RATE_LIMIT_WINDOW_SEC window.
// Shared across the process via Redis INCR with EXPIRE, or in-memory fallback.
export async function acquireToken(): Promise<boolean> {
  const r = getRedis();
  if (r) {
    const count = await r.incr(BUCKET_KEY);
    if (count === 1) {
      await r.expire(BUCKET_KEY, RATE_LIMIT_WINDOW_SEC);
    }
    return count <= RATE_LIMIT_RPM;
  }
  const now = Date.now();
  if (now - localBucket.windowStart > RATE_LIMIT_WINDOW_SEC * 1000) {
    localBucket.windowStart = now;
    localBucket.count = 0;
  }
  if (localBucket.count >= RATE_LIMIT_RPM) return false;
  localBucket.count += 1;
  return true;
}

export async function waitForToken(maxWaitMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await acquireToken()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

type FetchFn<T> = () => Promise<T>;

export async function cached<T>(opts: {
  key: string;
  ttlSeconds: number;
  staleSeconds?: number;
  fetcher: FetchFn<T>;
}): Promise<CachedResponse<T>> {
  const hit = await cacheGet<T>(opts.key);
  if (hit !== null) {
    return {
      data: hit,
      staleAt: new Date(Date.now() + opts.ttlSeconds * 1000),
      source: "cache",
    };
  }

  const gotToken = await waitForToken(5_000);
  if (!gotToken) {
    const staleKey = `${opts.key}:stale`;
    const stale = await cacheGet<T>(staleKey);
    if (stale !== null) {
      return {
        data: stale,
        staleAt: new Date(0),
        source: "cache",
      };
    }
    throw new Error(
      `SoSoValue rate limit exceeded and no stale cache available for ${opts.key}`,
    );
  }

  const fresh = await opts.fetcher();
  await cacheSet(opts.key, fresh, opts.ttlSeconds);
  await cacheSet(`${opts.key}:stale`, fresh, opts.staleSeconds ?? opts.ttlSeconds * 4);
  return {
    data: fresh,
    staleAt: new Date(Date.now() + opts.ttlSeconds * 1000),
    source: "live",
  };
}

export const CACHE_TTL = {
  currencyList: 24 * 60 * 60,
  newsFeatured: 15 * 60,
  newsFeaturedCurrency: 15 * 60,
  historicalInflowChart: 6 * 60 * 60,
  currentEtfDataMetrics: 60 * 60,
  // 5 minutes is enough that one cron cycle prices all 27 tokens fresh and
  // intra-day re-renders hit cache. Well under the 100 rpm budget.
  marketSnapshot: 5 * 60,
} as const;
