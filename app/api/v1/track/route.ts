import { computeTrackData } from "@/lib/track/compute";
import { memo } from "@/lib/api/memo";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The verifiable track record: rebalanced book vs buy-and-hold baseline,
// win rate, per-thesis attribution. Directional strategy.
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  try {
    const data = await memo("v1:track", 60_000, () => computeTrackData());
    return v1Json(data);
  } catch {
    return v1Error("database_unavailable");
  }
}
