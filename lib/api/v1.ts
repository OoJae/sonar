// Shared helpers for the public read-only API v1.
//
// Contract: every v1 endpoint returns { ok: true, data } or
// { ok: false, error: "<code>" } with machine-readable codes only. Raw error
// messages (driver text, table names) must never reach a response. All v1 GETs
// are public, CORS-open, per-IP rate limited, and lightly cached.

import { NextResponse } from "next/server";
import { env } from "@/lib/utils/env";
import { allowRequest, parseRateLimit } from "@/lib/utils/ratelimit";

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-real-ip")?.trim() ??
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
    "unknown"
  );
}

function corsHeaders(maxAgeSec: number): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": `public, max-age=${maxAgeSec}`,
  };
}

// Returns a 429 response when the caller is over budget, else null.
export async function v1RateLimit(
  request: Request,
): Promise<NextResponse | null> {
  const { count, windowSec } = parseRateLimit(env().SONAR_API_RATELIMIT);
  const ip = clientIp(request);
  const ok = await allowRequest(`apiv1:ip:${ip}`, count, windowSec);
  if (ok) return null;
  return NextResponse.json(
    { ok: false, error: "rate_limited" },
    {
      status: 429,
      headers: {
        "Retry-After": String(windowSec),
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

export function v1Json(data: unknown, maxAgeSec = 60): NextResponse {
  return NextResponse.json(
    { ok: true, data },
    { headers: corsHeaders(maxAgeSec) },
  );
}

export function v1Error(code: string, status = 500): NextResponse {
  return NextResponse.json(
    { ok: false, error: code },
    { status, headers: { "Access-Control-Allow-Origin": "*" } },
  );
}
