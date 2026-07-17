import { deltaNeutralData } from "@/lib/api/v1-data";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Delta-neutral book track: neutrality and P&L over time.
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  try {
    return v1Json(await deltaNeutralData());
  } catch {
    return v1Error("database_unavailable");
  }
}
