import { latestThesisData } from "@/lib/api/v1-data";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Latest directional research thesis (delta-neutral and smoke theses excluded).
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  try {
    const data = await latestThesisData();
    if (!data) return v1Error("no_thesis", 404);
    return v1Json(data);
  } catch {
    return v1Error("database_unavailable");
  }
}
