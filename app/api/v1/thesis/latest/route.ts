import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { ThesisSchema } from "@/lib/agent/thesis";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Latest directional research thesis (the delta-neutral strategy persists its
// own synthetic theses; those are not the research note).
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  try {
    const rows = await db()
      .select({
        runId: schema.theses.runId,
        strategy: schema.theses.strategy,
        status: schema.theses.status,
        payload: schema.theses.payload,
      })
      .from(schema.theses)
      // Exclude smoke-script theses (marked synthetic on their run), which are
      // schema-valid and would otherwise surface here as the latest research note.
      .innerJoin(schema.agentRuns, eq(schema.theses.runId, schema.agentRuns.id))
      .where(
        and(
          eq(schema.theses.strategy, "directional"),
          eq(schema.agentRuns.synthetic, false),
        ),
      )
      .orderBy(desc(schema.theses.generatedAt))
      .limit(5);
    for (const row of rows) {
      const parsed = ThesisSchema.safeParse(row.payload);
      if (parsed.success) {
        return v1Json({
          runId: row.runId,
          strategy: row.strategy,
          status: row.status,
          thesis: parsed.data,
        });
      }
    }
    return v1Error("no_thesis", 404);
  } catch {
    return v1Error("database_unavailable");
  }
}
