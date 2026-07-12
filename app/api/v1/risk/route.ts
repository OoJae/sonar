import { computeRiskMetrics } from "@/lib/risk/metrics";
import { env } from "@/lib/utils/env";
import { memo } from "@/lib/api/memo";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Portfolio risk metrics: historical VaR, drawdowns, correlation matrix,
// exposure and concentration. Directional book.
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  try {
    const data = await memo("v1:risk", 60_000, () =>
      computeRiskMetrics(env().SONAR_VAR_CONFIDENCE),
    );
    return v1Json(data);
  } catch {
    return v1Error("database_unavailable");
  }
}
