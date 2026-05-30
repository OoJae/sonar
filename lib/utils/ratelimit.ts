// Rate limiter + concurrency lock for the public interactive demo endpoint.
//
// Uses Upstash Redis when configured (shared across processes), falling back to
// in-process state otherwise. Sonar runs as a single Next process, so the
// in-process path is correct here; the Redis path is coded so a future
// multi-instance deploy stays safe. Never touches CRON_SECRET or any secret.

import { Redis } from "@upstash/redis";
import { env } from "./env";

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

export function parseRateLimit(spec: string): { count: number; windowSec: number } {
  const [c, w] = spec.split("/");
  return {
    count: Math.max(1, Number(c) || 1),
    windowSec: Math.max(1, Number(w) || 300),
  };
}

// Fixed-window limiter. Returns true if the request is within budget.
const localWindows = new Map<string, { windowStart: number; count: number }>();
export async function allowRequest(
  key: string,
  count: number,
  windowSec: number,
): Promise<boolean> {
  const r = getRedis();
  if (r) {
    const k = `sonar:rl:${key}`;
    const n = await r.incr(k);
    if (n === 1) await r.expire(k, windowSec);
    return n <= count;
  }
  const now = Date.now();
  const w = localWindows.get(key);
  if (!w || now - w.windowStart > windowSec * 1000) {
    localWindows.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (w.count >= count) return false;
  w.count += 1;
  return true;
}

// Single-flight lock so only one demo cycle runs at a time (cost guard).
let localLock: { until: number } | null = null;
export async function acquireRunLock(ttlSec: number): Promise<boolean> {
  const r = getRedis();
  if (r) {
    const ok = await r.set("sonar:demo:lock", "1", { nx: true, ex: ttlSec });
    return ok === "OK";
  }
  const now = Date.now();
  if (localLock && localLock.until > now) return false;
  localLock = { until: now + ttlSec * 1000 };
  return true;
}
export async function releaseRunLock(): Promise<void> {
  const r = getRedis();
  if (r) {
    await r.del("sonar:demo:lock");
    return;
  }
  localLock = null;
}
