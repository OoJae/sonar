import { NextResponse } from "next/server";
import { env } from "@/lib/utils/env";
import { runAgentCycle } from "@/lib/agent/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bearer check parity with /api/cron/daily. When CRON_SECRET is set, clients
// must send Authorization: Bearer <secret>. When unset, the endpoint stays
// open, which is convenient for local dev. Production deploys must set
// CRON_SECRET; Phase B adds a boot-time guard that refuses to start without
// it when NODE_ENV === "production".
export async function POST(request: Request) {
  const e = env();
  const auth = request.headers.get("authorization") ?? "";
  const expected = e.CRON_SECRET ? `Bearer ${e.CRON_SECRET}` : null;
  if (expected && auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runAgentCycle();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
