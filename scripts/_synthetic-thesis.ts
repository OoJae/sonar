// Seed a run + thesis for scripts that need one.
//
// Why this exists: orders.runId and orders.thesisId are notNull FKs, so any
// script that places an order MUST write into the same theses/agent_runs tables
// the public pages read. Scripts used to seed junk payloads like
// `{ smoke: "approval" }`, which fail ThesisSchema. /signals then rendered its
// empty state ("The agent has not run yet") on the live site, because a thesis
// that does not parse is indistinguishable from no thesis at all.
//
// So: the payload here is schema-VALID and validated before insert, and the run
// is marked synthetic so /log excludes it from the decision log. Seed through
// this helper rather than hand-rolling an insert.

import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { ThesisSchema } from "@/lib/agent/thesis";

const SIGNAL_ID = "smoke-fixture";

/**
 * Build a thesis payload that satisfies ThesisSchema.
 *
 * Mind the validator: it requires >= 1 riskNote, >= 1 citation, allocation
 * weights summing to <= 1, and every numeric token in `reasoning` to sit near a
 * resolvable [ref:<signalId>] tag. Keep numbers out of `note` unless you add a
 * citation for them.
 */
export function syntheticThesisPayload(input: {
  thesisId: string;
  note: string;
}) {
  const nowIso = new Date().toISOString();
  const payload = {
    id: input.thesisId,
    generatedAt: nowIso,
    asOf: nowIso,
    universe: ["MAG7"],
    signals: {
      etfFlowSignal: [
        {
          id: SIGNAL_ID,
          asset: "BTC",
          direction: "neutral",
          magnitudeUSD: 0,
          windowDays: 1,
          confidence: 0,
          sourceEndpoint: "fixture://smoke",
        },
      ],
      newsSignals: [],
    },
    reasoning:
      `${input.note} This thesis was seeded by a test script, not produced by ` +
      `the agent, and carries no market view: the fixture signal is neutral at ` +
      `zero confidence [ref:${SIGNAL_ID}].`,
    proposedAllocations: [{ index: "MAG7", targetWeight: 0, deltaFromCurrent: 0 }],
    hedges: [],
    riskNotes: ["Synthetic fixture. Not a trading signal."],
    citations: [{ ref: SIGNAL_ID, url: "https://sonar.my.id/about" }],
    mode: "trade",
  };

  // Refuse rather than persist junk: this is the check whose absence blanked
  // /signals in the first place.
  const parsed = ThesisSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `synthetic thesis payload is invalid: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`,
    );
  }
  return parsed.data;
}

/** Seed a synthetic-marked run and a schema-valid thesis attached to it. */
export async function seedSyntheticRunAndThesis(input: {
  model: string;
  note: string;
  dataSource?: string;
}): Promise<{ runId: string; thesisId: string }> {
  const runId = randomUUID();
  const thesisId = randomUUID();
  const now = new Date();

  await db().insert(schema.agentRuns).values({
    id: runId,
    startedAt: now,
    finishedAt: now,
    model: input.model,
    dataSource: input.dataSource ?? "fixture",
    ok: true,
    synthetic: true,
  });

  const payload = syntheticThesisPayload({ thesisId, note: input.note });
  await db().insert(schema.theses).values({
    id: thesisId,
    runId,
    generatedAt: now,
    asOf: now,
    mode: "trade",
    status: "valid",
    reasoning: payload.reasoning,
    payload,
  });

  return { runId, thesisId };
}
