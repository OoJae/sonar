import { z } from "zod";
import { thesesData } from "@/lib/api/v1-data";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LimitSchema = z.coerce.number().int().min(1).max(100).default(20);

// Thesis history (metadata + headline allocations; full payloads via
// /thesis/latest). Smoke-script theses are excluded.
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  const url = new URL(request.url);
  const parsedLimit = LimitSchema.safeParse(
    url.searchParams.get("limit") ?? undefined,
  );
  const limit = parsedLimit.success ? parsedLimit.data : 20;
  try {
    return v1Json(await thesesData(limit));
  } catch {
    return v1Error("database_unavailable");
  }
}
