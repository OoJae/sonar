import { z } from "zod";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LimitSchema = z.coerce.number().int().min(1).max(100).default(20);

// Thesis history (metadata + headline allocations; full payloads via
// /thesis/latest). Includes both strategies, tagged.
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  const url = new URL(request.url);
  const parsedLimit = LimitSchema.safeParse(
    url.searchParams.get("limit") ?? undefined,
  );
  const limit = parsedLimit.success ? parsedLimit.data : 20;
  try {
    const rows = await db()
      .select({
        id: schema.theses.id,
        runId: schema.theses.runId,
        strategy: schema.theses.strategy,
        generatedAt: schema.theses.generatedAt,
        asOf: schema.theses.asOf,
        mode: schema.theses.mode,
        status: schema.theses.status,
        payload: schema.theses.payload,
      })
      .from(schema.theses)
      .orderBy(desc(schema.theses.generatedAt))
      .limit(limit);

    const theses = rows.map((r) => {
      const payload = r.payload as Record<string, unknown> | null;
      const allocs = Array.isArray(payload?.proposedAllocations)
        ? (payload.proposedAllocations as Array<Record<string, unknown>>).map(
            (a) => ({ index: a.index, targetWeight: a.targetWeight }),
          )
        : [];
      return {
        id: r.id,
        runId: r.runId,
        strategy: r.strategy,
        generatedAt: r.generatedAt.toISOString(),
        asOf: r.asOf.toISOString(),
        mode: r.mode,
        status: r.status,
        allocations: allocs,
      };
    });
    return v1Json({ theses });
  } catch {
    return v1Error("database_unavailable");
  }
}
