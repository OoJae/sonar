import { NextResponse } from "next/server";
import { env } from "@/lib/utils/env";
import { runAgentCycle } from "@/lib/agent/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const e = env();
  const auth = request.headers.get("authorization") ?? "";
  const expected = e.CRON_SECRET ? `Bearer ${e.CRON_SECRET}` : null;
  if (expected && auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runAgentCycle();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
