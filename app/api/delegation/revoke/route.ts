import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/utils/env";
import { allowRequest, parseRateLimit } from "@/lib/utils/ratelimit";
import { logger } from "@/lib/utils/logger";
import {
  revokeGrant,
  toGrantView,
  GrantValidationError,
} from "@/lib/delegation/store";
import type { RevokeGrant } from "@/lib/delegation/grant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RevokeBody = z.object({
  grantId: z.string().uuid(),
  grantor: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  issuedAt: z.string().regex(/^\d+$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

function clientIp(request: Request): string {
  return (
    request.headers.get("x-real-ip")?.trim() ??
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
    "unknown"
  );
}

export async function POST(request: Request) {
  const e = env();
  const { count, windowSec } = parseRateLimit(e.SONAR_DELEGATION_RATELIMIT);
  const ip = clientIp(request);
  if (!(await allowRequest(`deleg:ip:${ip}`, count, windowSec))) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(windowSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const parsed = RevokeBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.issues.slice(0, 4) },
      { status: 400 },
    );
  }
  const b = parsed.data;

  const revoke: RevokeGrant = {
    grantId: b.grantId,
    grantor: b.grantor as `0x${string}`,
    issuedAt: BigInt(b.issuedAt),
  };

  try {
    const row = await revokeGrant(revoke, b.signature as `0x${string}`);
    logger.info("delegation.revoked", { id: row.id, grantor: row.grantor });
    return NextResponse.json({ ok: true, grant: toGrantView(row) });
  } catch (err) {
    if (err instanceof GrantValidationError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.status },
      );
    }
    logger.error("delegation.revoke_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
