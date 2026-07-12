// Thesis persistence, shared by the runner (directional) and the strategy
// modules (delta-neutral). Extracted from runner.ts so a strategy module can
// persist a thesis without a circular import back into the runner.

import { db, schema } from "@/lib/db/client";
import type { Thesis } from "./thesis";
import type { StrategyKey } from "@/lib/sodex/types";

export async function persistThesis(
  runId: string,
  thesis: Thesis,
  strategy: StrategyKey = "directional",
): Promise<void> {
  await db().insert(schema.theses).values({
    id: thesis.id,
    runId,
    strategy,
    generatedAt: new Date(thesis.generatedAt),
    asOf: new Date(thesis.asOf),
    mode: thesis.mode,
    status: "valid",
    reasoning: thesis.reasoning,
    payload: thesis,
  });

  const signalRows = [
    ...thesis.signals.etfFlowSignal.map((s) => ({
      id: s.id,
      thesisId: thesis.id,
      kind: "etf_flow",
      payload: s,
      sourceEndpoint: s.sourceEndpoint,
    })),
    ...thesis.signals.newsSignals.map((s) => ({
      id: s.id,
      thesisId: thesis.id,
      kind: "news",
      payload: s,
      sourceEndpoint: null,
    })),
  ];
  if (signalRows.length > 0) {
    await db().insert(schema.signals).values(signalRows);
  }
}
