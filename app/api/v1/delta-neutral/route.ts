import { computeDeltaNeutralTrack } from "@/lib/track/delta-neutral";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The delta-neutral strategy's mark-to-market track (net exposure over time,
// current book, rebalance count).
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  try {
    const data = await computeDeltaNeutralTrack();
    return v1Json(data);
  } catch {
    return v1Error("database_unavailable");
  }
}
