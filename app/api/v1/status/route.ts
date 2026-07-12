import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/utils/env";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Service status: version, execution mode, last cycle outcome, data freshness.
// Never includes raw error text (agent_runs.error stays internal).
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  try {
    const [lastRun] = await db()
      .select({
        startedAt: schema.agentRuns.startedAt,
        finishedAt: schema.agentRuns.finishedAt,
        ok: schema.agentRuns.ok,
      })
      .from(schema.agentRuns)
      .orderBy(desc(schema.agentRuns.startedAt))
      .limit(1);

    const [latestThesis] = await db()
      .select({ asOf: schema.theses.asOf })
      .from(schema.theses)
      .where(eq(schema.theses.strategy, "directional"))
      .orderBy(desc(schema.theses.generatedAt))
      .limit(1);

    const dataFreshHours = latestThesis
      ? Math.round(
          ((Date.now() - latestThesis.asOf.getTime()) / 3_600_000) * 10,
        ) / 10
      : null;

    return v1Json(
      {
        version: process.env.SONAR_GIT_SHA ?? "dev",
        mode: env().SONAR_EXECUTION_MODE,
        lastRunAt: lastRun?.startedAt.toISOString() ?? null,
        lastRunFinished: Boolean(lastRun?.finishedAt),
        lastRunOk: lastRun?.ok ?? null,
        dataFreshHours,
      },
      15,
    );
  } catch {
    return v1Error("database_unavailable");
  }
}
