import "server-only";
import { randomUUID } from "node:crypto";
import { generateText, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { eq } from "drizzle-orm";
import { env } from "@/lib/utils/env";
import { logger, startCycleTrace, type CycleTrace } from "@/lib/utils/logger";
import { db, schema } from "@/lib/db/client";
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from "./prompts";
import { buildAgentTools } from "./tools";
import { ThesisSchema, type Thesis, type UniverseKey } from "./thesis";
// All execution routes through the executor facade. Paper / live-testnet /
// live-mainnet switching is governed by SONAR_EXECUTION_MODE; the runner
// stays the same regardless. See lib/sodex/executor.ts for the routing rules.
import { placeOrder, getPositions } from "@/lib/sodex/executor";
import { computeAllNavs } from "@/lib/ssi/nav";
import { getEtfSummaryHistory } from "@/lib/sosovalue/client";
import { evaluateMacroWindow, type BreakerState } from "@/lib/agent/circuit-breaker";
import { setDeRiskFactor, clearDeRisk } from "@/lib/sodex/risk";

// Xiaomi MiMo V2.5 Pro via its Anthropic-compatible endpoint. The @ai-sdk/
// anthropic package handles the Messages API + tool calls; we just override
// baseURL and apiKey. If MiMo's relay ever rejects tool blocks, fall back to
// `@ai-sdk/openai-compatible` against the /v1 endpoint.
// Lowercase per MiMo's /v1/models listing; the screenshot's "MiMo-V2.5-Pro"
// is a display name. The relay rejects mixed-case ids with HTTP 400.
const MODEL_ID = "mimo-v2.5-pro";
const DEFAULT_UNIVERSE: UniverseKey[] = ["MAG7", "DEFI", "MEME"];

export type RunResult =
  | { ok: true; runId: string; thesisId: string; mode: Thesis["mode"] }
  | { ok: false; runId: string; error: string };

export async function runAgentCycle(opts?: {
  universe?: UniverseKey[];
}): Promise<RunResult> {
  const e = env();
  const universe = opts?.universe ?? DEFAULT_UNIVERSE;

  const runId = randomUUID();
  await db().insert(schema.agentRuns).values({
    id: runId,
    model: MODEL_ID,
    dataSource: e.SONAR_DATA_SOURCE,
    startedAt: new Date(),
  });

  const capture: { thesis: Thesis | null } = { thesis: null };
  const tools = buildAgentTools(capture);

  let trace: CycleTrace | null = null;
  let breaker: BreakerState = {
    active: false,
    action: "de-risk",
    event: null,
    deRiskFactor: 1,
    reason: null,
  };

  try {
    if (!e.MIMO_API_KEY) {
      throw new Error("MIMO_API_KEY is not set; agent cannot run.");
    }

    const provider = createAnthropic({
      apiKey: e.MIMO_API_KEY,
      baseURL: e.MIMO_BASE_URL,
    });

    const nowIso = new Date().toISOString();
    // Pre-fetch the freshness clock the agent will reason against. The
    // existing 7-day rollup signals do not carry per-signal dates, so without
    // this injection prompt rule #2 (the 36-hour freshness rule) could not
    // grade them. We peek at the same ETF history endpoint the agent would
    // call via getHistoricalFlows; the call results are cached so the agent's
    // subsequent tool call is a no-op on the wire.
    const dataFreshness = await fetchDataFreshness();

    // Macro circuit breaker: if a high-impact macro event is within the
    // lookahead horizon, the cycle de-risks. The state is injected into the
    // prompt (so the agent cites the event and tilts toward USSI) AND enforced
    // server-side (the risk gate scales caps, executeAllocations tilts weights),
    // so the de-risk holds even if the model ignores the prompt.
    breaker = await evaluateMacroWindow({ nowIso });
    if (breaker.active) {
      setDeRiskFactor(breaker.deRiskFactor);
      await db()
        .update(schema.agentRuns)
        .set({ haltReason: breaker.reason })
        .where(eq(schema.agentRuns.id, runId));
      logger.info("agent.circuit_breaker_active", {
        runId,
        event: breaker.event?.name,
        deRiskFactor: breaker.deRiskFactor,
      });
    }

    // Open a Langfuse trace keyed by runId. If Langfuse is not configured,
    // startCycleTrace returns null and the rest of the cycle runs unchanged.
    trace = startCycleTrace({
      runId,
      input: { universe, nowIso, dataFreshness, mode: e.SONAR_EXECUTION_MODE, circuitBreaker: breaker.reason },
      model: MODEL_ID,
    });
    if (trace) {
      await db()
        .update(schema.agentRuns)
        .set({ traceId: trace.id })
        .where(eq(schema.agentRuns.id, runId));
    }
    const result = await generateText({
      model: provider(MODEL_ID),
      system: SYSTEM_PROMPT,
      prompt: USER_PROMPT_TEMPLATE({
        nowIso,
        universe,
        dataFreshness,
        circuitBreaker: breaker.active ? breaker.reason : null,
      }),
      tools,
      stopWhen: stepCountIs(16),
      temperature: 0.2,
      // MiMo emits Anthropic-style "thinking" content blocks that count toward
      // the output token budget. The default 4096 is too tight: thinking can
      // consume the entire budget before the model gets to submitThesis. 16k
      // gives the loop room to think, call tools, and still finalize.
      maxOutputTokens: 16000,
    });

    logger.info("agent.generation_done", {
      runId,
      finishReason: result.finishReason,
      steps: result.steps.length,
      tokens: {
        input: result.usage?.inputTokens ?? 0,
        output: result.usage?.outputTokens ?? 0,
      },
    });

    if (!capture.thesis) {
      // Fall back: try to parse JSON from the final text output.
      const parsed = tryParseFromText(result.text);
      if (parsed) capture.thesis = parsed;
    }

    if (!capture.thesis) {
      await finishRun(runId, false, "agent did not submit a valid thesis");
      return { ok: false, runId, error: "no_thesis" };
    }

    // Override the agent's id with a fresh UUID. Models often emit
    // placeholder UUIDs (e.g. "a1b2c3d4-...") and reuse them across cycles,
    // which would cause primary-key collisions on insert. The id is internal
    // bookkeeping; the agent does not need to control it.
    capture.thesis = { ...capture.thesis, id: randomUUID() };

    await persistThesis(runId, capture.thesis);
    // NAV snapshot per index per cycle. Runs regardless of trade/no-trade
    // mode so the Portfolio chart picks up timepoints even on freshness
    // skips. Failure is non-fatal: a stale snapshot is preferable to a
    // failed cycle. See lib/ssi/nav.ts.
    await persistNavSnapshots().catch((err) =>
      logger.warn("agent.nav_persist_failed", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );

    if (capture.thesis.mode === "trade") {
      await executeAllocations(capture.thesis, breaker);
    }

    if (trace) {
      trace.update({
        output: {
          thesisId: capture.thesis.id,
          mode: capture.thesis.mode,
          headline:
            capture.thesis.reasoning.slice(0, 200) +
            (capture.thesis.reasoning.length > 200 ? "..." : ""),
          signals: {
            etfFlow: capture.thesis.signals.etfFlowSignal.length,
            news: capture.thesis.signals.newsSignals.length,
          },
        },
      });
    }

    await finishRun(runId, true, null);
    return {
      ok: true,
      runId,
      thesisId: capture.thesis.id,
      mode: capture.thesis.mode,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("agent.run_failed", { runId, error: message });
    if (trace) {
      trace.update({ output: { error: message } });
    }
    await finishRun(runId, false, message);
    return { ok: false, runId, error: message };
  } finally {
    // Always clear the process de-risk factor so it never leaks into the next
    // cycle (the runner sets it per cycle when the breaker fires).
    clearDeRisk();
    if (trace) {
      try {
        await trace.flush();
      } catch (err) {
        logger.warn("agent.trace_flush_failed", {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

function tryParseFromText(text: string): Thesis | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = ThesisSchema.safeParse(JSON.parse(match[0]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function finishRun(
  runId: string,
  ok: boolean,
  error: string | null,
): Promise<void> {
  await db()
    .update(schema.agentRuns)
    .set({
      finishedAt: new Date(),
      ok,
      error,
    })
    .where(eq(schema.agentRuns.id, runId));
}

async function persistThesis(runId: string, thesis: Thesis): Promise<void> {
  await db().insert(schema.theses).values({
    id: thesis.id,
    runId,
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

// Returns the latest ETF history date across the universe, or null if no
// underlying history is reachable. The runner uses this to inject a "Data
// freshness" line into the user prompt so rule #2 (the 36-hour rule) can
// grade 7-day rollup signals that do not carry per-signal dates. Failure
// to fetch any history surfaces as null and the prompt explicitly tells
// the agent to emit a no-trade thesis.
async function fetchDataFreshness(): Promise<string | null> {
  const probeAssets = ["BTC", "ETH", "SOL"] as const;
  let latest: string | null = null;
  for (const asset of probeAssets) {
    try {
      const res = await getEtfSummaryHistory(asset);
      // API is reverse-chronological; first element is the freshest.
      const first = res.data.data?.[0];
      const date = first?.date;
      if (typeof date === "string" && (!latest || date > latest)) {
        latest = date;
      }
    } catch (err) {
      logger.warn("runner.data_freshness_probe_failed", {
        asset,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return latest;
}

async function persistNavSnapshots(): Promise<void> {
  const navs = await computeAllNavs();
  if (navs.length === 0) return;
  await db().insert(schema.navSnapshots).values(
    navs.map((n) => ({
      index: n.index,
      navPerShareUsd: String(n.navPerShareUSD),
      asOf: new Date(n.asOf),
    })),
  );
}

// Wave 1 paper book sizing. The thesis declares targetWeight; the runner is
// responsible for translating those weights into USD notionals against the
// current paper book. `deltaFromCurrent` in the thesis is informational only
// (the agent's narrative description of its move in percentage points).
const NOTIONAL_BOOK_SIZE_USD = 100_000;
const DUST_THRESHOLD_USD = 10;

async function executeAllocations(
  thesis: Thesis,
  breaker: BreakerState,
): Promise<void> {
  const positions = await getPositions();
  const equity = positions.reduce(
    (acc, p) =>
      acc + p.markPrice * p.quantity * (p.side === "long" ? 1 : -1),
    0,
  );
  // Treat the book as having at least the seed capital; otherwise the very
  // first cycle would size every trade at zero.
  const bookSize = Math.max(equity, NOTIONAL_BOOK_SIZE_USD);

  // Circuit breaker de-risk tilt: scale every risky index target weight down
  // by the de-risk factor so more of the book sits in USSI during a macro
  // window. The hedges are scaled separately by the risk gate's cap factor.
  const weightScale = breaker.active ? breaker.deRiskFactor : 1;

  for (const alloc of thesis.proposedAllocations) {
    const market = `${alloc.index}.ssi`;
    const targetUSD = bookSize * alloc.targetWeight * weightScale;
    const current = positions.find((p) => p.market === market);
    const currentUSD = current
      ? current.markPrice *
        current.quantity *
        (current.side === "long" ? 1 : -1)
      : 0;
    const deltaUSD = targetUSD - currentUSD;
    if (Math.abs(deltaUSD) < DUST_THRESHOLD_USD) continue;
    try {
      await placeOrder({
        thesisId: thesis.id,
        kind: "spot",
        market,
        side: deltaUSD > 0 ? "buy" : "sell",
        type: "market",
        notionalUSD: Math.abs(deltaUSD),
        slippageBps: 50,
      });
    } catch (err) {
      logger.warn("agent.allocation_skipped", {
        market,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  for (const hedge of thesis.hedges) {
    if (hedge.notionalUSD <= 0) continue;
    try {
      await placeOrder({
        thesisId: thesis.id,
        kind: "perp",
        market: hedge.market,
        side: hedge.side === "long" ? "buy" : "sell",
        type: "market",
        notionalUSD: hedge.notionalUSD,
        slippageBps: 50,
      });
    } catch (err) {
      logger.warn("agent.hedge_skipped", {
        market: hedge.market,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
