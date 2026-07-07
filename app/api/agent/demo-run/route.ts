import { NextResponse } from "next/server";
import { env } from "@/lib/utils/env";
import { runAgentCycle } from "@/lib/agent/runner";
import {
  acquireRunLock,
  allowRequest,
  parseRateLimit,
  releaseRunLock,
} from "@/lib/utils/ratelimit";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public interactive demo trigger. Unlike /api/agent/run (bearer-protected),
// this lets a judge trigger a real live-testnet cycle and watch it. It is
// hard rate-limited and single-flighted. A stranger triggering it cannot do
// anything the agent would not do on its own schedule: the executor runs in
// the configured mode with the existing strict risk caps, and the kill switch
// (SONAR_EXECUTION_MODE=paper) still applies. It never reads or returns
// CRON_SECRET or the private key.
export async function POST(request: Request) {
  const e = env();
  const { count, windowSec } = parseRateLimit(e.SONAR_PUBLIC_RUN_RATELIMIT);

  // Use X-Real-IP (nginx sets it from $remote_addr, unspoofable through the
  // proxy). A client-supplied X-Forwarded-For prepends attacker-controlled
  // tokens, so the first XFF token cannot be trusted for a per-IP cap; fall back
  // to the last XFF hop only if X-Real-IP is absent.
  const ip =
    request.headers.get("x-real-ip")?.trim() ??
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
    "unknown";

  // Global budget plus a per-IP budget (per-IP a bit stricter window).
  const globalOk = await allowRequest("demo:global", count, windowSec);
  const ipOk = await allowRequest(`demo:ip:${ip}`, count, windowSec * 2);
  if (!globalOk || !ipOk) {
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        message: `The public demo is limited to ${count} run per ${windowSec}s. Try again shortly.`,
      },
      { status: 429, headers: { "Retry-After": String(windowSec) } },
    );
  }

  // Single-flight: only one demo cycle at a time. The lock TTL bounds a stuck
  // cycle so the control recovers on its own.
  const locked = await acquireRunLock(180);
  if (!locked) {
    return NextResponse.json(
      {
        ok: false,
        error: "busy",
        message: "A demo cycle is already running. Watch it on Signals, then try again.",
      },
      { status: 429, headers: { "Retry-After": "30" } },
    );
  }

  try {
    logger.info("demo_run.triggered", { ip, mode: e.SONAR_EXECUTION_MODE });
    const result = await runAgentCycle();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } finally {
    await releaseRunLock();
  }
}
