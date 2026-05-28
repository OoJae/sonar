import "server-only";
import { randomUUID } from "node:crypto";
import { generateText, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { eq } from "drizzle-orm";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { db, schema } from "@/lib/db/client";
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from "./prompts";
import { buildAgentTools } from "./tools";
import { ThesisSchema, type Thesis, type UniverseKey } from "./thesis";
// All execution routes through the executor facade. Paper / live-testnet /
// live-mainnet switching is governed by SONAR_EXECUTION_MODE; the runner
// stays the same regardless. See lib/sodex/executor.ts for the routing rules.
import { placeOrder, getPositions } from "@/lib/sodex/executor";

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

  try {
    if (!e.MIMO_API_KEY) {
      throw new Error("MIMO_API_KEY is not set; agent cannot run.");
    }

    const provider = createAnthropic({
      apiKey: e.MIMO_API_KEY,
      baseURL: e.MIMO_BASE_URL,
    });

    const nowIso = new Date().toISOString();
    const result = await generateText({
      model: provider(MODEL_ID),
      system: SYSTEM_PROMPT,
      prompt: USER_PROMPT_TEMPLATE({ nowIso, universe }),
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

    if (capture.thesis.mode === "trade") {
      await executeAllocations(capture.thesis);
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
    await finishRun(runId, false, message);
    return { ok: false, runId, error: message };
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

// Wave 1 paper book sizing. The thesis declares targetWeight; the runner is
// responsible for translating those weights into USD notionals against the
// current paper book. `deltaFromCurrent` in the thesis is informational only
// (the agent's narrative description of its move in percentage points).
const NOTIONAL_BOOK_SIZE_USD = 100_000;
const DUST_THRESHOLD_USD = 10;

async function executeAllocations(thesis: Thesis): Promise<void> {
  const positions = await getPositions();
  const equity = positions.reduce(
    (acc, p) =>
      acc + p.markPrice * p.quantity * (p.side === "long" ? 1 : -1),
    0,
  );
  // Treat the book as having at least the seed capital; otherwise the very
  // first cycle would size every trade at zero.
  const bookSize = Math.max(equity, NOTIONAL_BOOK_SIZE_USD);

  for (const alloc of thesis.proposedAllocations) {
    const market = `${alloc.index}.ssi`;
    const targetUSD = bookSize * alloc.targetWeight;
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
