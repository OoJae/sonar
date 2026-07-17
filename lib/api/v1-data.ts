// Shared data layer for the public v1 API.
//
// One function per endpoint, returning exactly the `data` object the route wraps
// in v1Json. Both the v1 routes AND the hosted MCP resolver (app/api/mcp) call
// these directly, so the MCP surface no longer HTTP-fetches Sonar's own public
// API. That round trip made every hosted-MCP call worldwide egress from the
// server's single IP and share ONE per-IP v1 rate-limit bucket, so one client at
// its budget could deny the whole MCP surface. Calling in-process removes both
// the round trip and the shared bucket, and keeps the two consumers from drifting.

import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/utils/env";
import { memo } from "@/lib/api/memo";
import { computeTrackData } from "@/lib/track/compute";
import { computeRiskMetrics } from "@/lib/risk/metrics";
import { computeDeltaNeutralTrack } from "@/lib/track/delta-neutral";
import { getPositions } from "@/lib/sodex/paper";
import { listProposals } from "@/lib/proposals/store";
import { computeArena } from "@/lib/proposals/arena";
import { ThesisSchema } from "@/lib/agent/thesis";

export function trackData() {
  return memo("v1:track", 60_000, () => computeTrackData());
}

export function riskData() {
  return memo("v1:risk", 60_000, () =>
    computeRiskMetrics(env().SONAR_VAR_CONFIDENCE),
  );
}

export function deltaNeutralData() {
  return computeDeltaNeutralTrack();
}

type Position = Awaited<ReturnType<typeof getPositions>>[number];
function summarize(ps: Position[]) {
  let longUsd = 0;
  let shortUsd = 0;
  let unrealizedPnlUsd = 0;
  for (const p of ps) {
    const mv = p.markPrice * p.quantity;
    if (p.side === "long") longUsd += mv;
    else shortUsd += mv;
    unrealizedPnlUsd += p.unrealizedPnlUSD;
  }
  return {
    longUsd,
    shortUsd,
    netUsd: longUsd - shortUsd,
    grossUsd: longUsd + shortUsd,
    unrealizedPnlUsd,
    positions: ps.length,
  };
}

export async function portfolioData() {
  const positions = await getPositions();
  const directional = positions.filter((p) => p.strategy === "directional");
  const deltaNeutral = positions.filter((p) => p.strategy === "delta-neutral");
  return {
    positions,
    summary: {
      directional: summarize(directional),
      deltaNeutral: summarize(deltaNeutral),
      combinedNetUsd:
        summarize(directional).netUsd + summarize(deltaNeutral).netUsd,
    },
  };
}

export async function proposalsData() {
  const proposals = await listProposals();
  const arena = await computeArena(proposals.map((p) => p.id));
  return {
    proposals: proposals.map((p) => ({
      ...p,
      forwardTest: arena.get(p.id) ?? null,
    })),
  };
}

export async function statusData() {
  const [lastRun] = await db()
    .select({
      startedAt: schema.agentRuns.startedAt,
      finishedAt: schema.agentRuns.finishedAt,
      ok: schema.agentRuns.ok,
    })
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.synthetic, false))
    .orderBy(desc(schema.agentRuns.startedAt))
    .limit(1);

  const [latestThesis] = await db()
    .select({ asOf: schema.theses.asOf })
    .from(schema.theses)
    .innerJoin(schema.agentRuns, eq(schema.theses.runId, schema.agentRuns.id))
    .where(
      and(
        eq(schema.theses.strategy, "directional"),
        eq(schema.agentRuns.synthetic, false),
      ),
    )
    .orderBy(desc(schema.theses.generatedAt))
    .limit(1);

  const dataFreshHours = latestThesis
    ? Math.round(((Date.now() - latestThesis.asOf.getTime()) / 3_600_000) * 10) / 10
    : null;

  return {
    version: process.env.SONAR_GIT_SHA ?? "dev",
    mode: env().SONAR_EXECUTION_MODE,
    lastRunAt: lastRun?.startedAt.toISOString() ?? null,
    lastRunFinished: Boolean(lastRun?.finishedAt),
    lastRunOk: lastRun?.ok ?? null,
    dataFreshHours,
  };
}

export async function thesesData(limit: number) {
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
    // Exclude smoke-script theses, same as /log and /track.
    .innerJoin(schema.agentRuns, eq(schema.theses.runId, schema.agentRuns.id))
    .where(eq(schema.agentRuns.synthetic, false))
    .orderBy(desc(schema.theses.generatedAt))
    .limit(limit);

  const theses = rows.map((r) => {
    const payload = r.payload as Record<string, unknown> | null;
    const allocs = Array.isArray(payload?.proposedAllocations)
      ? (payload.proposedAllocations as Array<Record<string, unknown>>).map((a) => ({
          index: a.index,
          targetWeight: a.targetWeight,
        }))
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
  return { theses };
}

/** null when no non-synthetic directional thesis parses (the route 404s on it). */
export async function latestThesisData() {
  const rows = await db()
    .select({
      runId: schema.theses.runId,
      strategy: schema.theses.strategy,
      status: schema.theses.status,
      payload: schema.theses.payload,
    })
    .from(schema.theses)
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
      return {
        runId: row.runId,
        strategy: row.strategy,
        status: row.status,
        thesis: parsed.data,
      };
    }
  }
  return null;
}
