// Tiny in-process TTL memo for the public API. computeTrackData and
// computeRiskMetrics full-scan several tables and the underlying data changes
// once per daily cycle, so a short memo neutralizes hostile refresh loops
// against Postgres. Single-process deploy, so in-process state is correct.

type Entry = { value: unknown; expiresAt: number };
const cache = new Map<string, Entry>();

export async function memo<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await fn();
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

// Test/ops escape hatch.
export function clearMemo(): void {
  cache.clear();
}
