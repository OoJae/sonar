import { riskData } from "@/lib/api/v1-data";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Portfolio risk metrics: historical VaR, drawdowns, correlation matrix,
// exposure and concentration. Directional book.
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  try {
    return v1Json(await riskData());
  } catch {
    return v1Error("database_unavailable");
  }
}
