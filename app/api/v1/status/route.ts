import { statusData } from "@/lib/api/v1-data";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Service status: version, execution mode, last cycle outcome, data freshness.
// Never includes raw error text (agent_runs.error stays internal).
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  try {
    return v1Json(await statusData(), 15);
  } catch {
    return v1Error("database_unavailable");
  }
}
