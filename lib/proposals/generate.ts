// Wave 3 custom SSI index proposals: the LLM generator.
//
// Given a theme, MiMo proposes a themed basket via a single submitProposal tool
// (mirroring the thesis submitThesis capture pattern). The server stamps the id
// and clock, normalizes the weights to sum exactly 1, prices the basket, and
// returns a StoredProposal. This is a design artifact, not an on-chain action.

import { randomUUID } from "node:crypto";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool } from "ai";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import {
  IndexProposalSchema,
  IndexProposalPayloadSchema,
  type IndexProposal,
  type StoredProposal,
} from "./schema";
import { priceProposal } from "./price";

const MODEL_ID = "mimo-v2.5-pro";

// Bias set: tickers proven to resolve through getPriceUSD, so coverage stays
// high. The model may go beyond these (priced server-side); this is a hint, not
// a constraint (the universe is open by decision).
const COVERED_TICKERS =
  "BTC, ETH, BNB, SOL, XRP, DOGE, ADA, LINK, UNI, AAVE, JUP, ENA, ONDO, CAKE, HYPE, SKY, CRV, SHIB, PEPE, WIF, BONK, FLOKI, TRUMP, PENGU, SPX, PUMP";

const SYSTEM_PROMPT = `You design themed index baskets in the style of the SoSoValue SSI protocol (MAG7.ssi, DEFI.ssi, MEME.ssi). Given a theme, propose a NEW index: a basket of constituent tokens with target weights and a sourced rationale.

This is a design artifact. It is NOT created on-chain and moves no funds. Do not claim the index exists, is live, or is tradeable.

Hard rules, no exceptions:
1. Output ONLY by calling submitProposal exactly once. Do not write the proposal as prose.
2. 3 to 15 constituents, prefer 6 to 10. Each targetWeight is in [0,1]; the full set must sum to about 1.0 (between 0.98 and 1.02).
3. Use canonical exchange tickers (BTC, ETH, SOL, UNI, AAVE, ONDO), never project names ("Uniswap"). This keeps the basket priceable.
4. Provide evidence entries (id, kind, label, optional url). Cite every numeric claim in the rationale inline as [ref:<evidenceId>]. Numbers without a citation are rejected.
5. At least one citations entry with a real http or https URL. At least one riskNote.
6. rationale is flowing neutral prose. Never use investment-advice wording ("guaranteed", "you should buy"). Do not use em dashes anywhere; use commas or parentheses.
7. symbol is uppercase ending in .ssi (for example AGENTS.ssi); name is human-readable.

Method: pick constituents that genuinely fit the theme, weight them by conviction and liquidity, and explain the construction in the rationale with cited evidence. Note residual risks honestly in riskNotes.`;

function userPrompt(theme: string): string {
  return `Theme: "${theme}"

Design a custom index for this theme.

Tokens Sonar can price cleanly (bias toward these where they fit the theme; you may include others, which are priced if the data supports them): ${COVERED_TICKERS}.

For structure only, here is a well-formed example basket (do not copy it; design for the theme): a DeFi index of LINK 0.25, UNI 0.20, AAVE 0.20, JUP 0.20, ENA 0.15.`;
}

function tryParseFromText(text: string): IndexProposal | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = IndexProposalSchema.safeParse(JSON.parse(match[0]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function generateProposal(
  theme: string,
): Promise<{ ok: true; proposal: StoredProposal } | { ok: false; error: string }> {
  const e = env();
  if (!e.MIMO_API_KEY) {
    return { ok: false, error: "model_unavailable" };
  }
  const provider = createAnthropic({
    apiKey: e.MIMO_API_KEY,
    baseURL: e.MIMO_BASE_URL,
  });

  const capture: { proposal: IndexProposal | null } = { proposal: null };
  const tools = {
    submitProposal: tool({
      description:
        "Submit the final index proposal. The server validates it and rejects on failure. Call exactly once.",
      inputSchema: IndexProposalPayloadSchema,
      execute: async (proposal) => {
        const parsed = IndexProposalSchema.safeParse(proposal);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".")}: ${i.message}`);
          logger.warn("proposal.rejected", { issues });
          return { ok: false, errors: issues } as const;
        }
        capture.proposal = parsed.data;
        return { ok: true, id: parsed.data.id } as const;
      },
    }),
  };

  const result = await generateText({
    model: provider(MODEL_ID),
    system: SYSTEM_PROMPT,
    prompt: userPrompt(theme),
    tools,
    stopWhen: stepCountIs(4),
    temperature: 0.4,
    maxOutputTokens: 12000,
  });

  if (!capture.proposal) {
    capture.proposal = tryParseFromText(result.text);
  }
  if (!capture.proposal) {
    logger.warn("proposal.no_output", { finishReason: result.finishReason });
    return { ok: false, error: "no_proposal" };
  }

  // Server-stamp id/clock and force the sanitized theme (never trust the echo).
  const now = new Date().toISOString();
  let proposal: IndexProposal = {
    ...capture.proposal,
    id: randomUUID(),
    generatedAt: now,
    asOf: now,
    theme,
  };

  // Normalize the weights to sum exactly 1 (the band guard already passed).
  const total = proposal.constituents.reduce((s, c) => s + c.targetWeight, 0);
  if (total > 0) {
    proposal = {
      ...proposal,
      constituents: proposal.constituents.map((c) => ({
        ...c,
        targetWeight: c.targetWeight / total,
      })),
    };
  }

  const pricing = await priceProposal(proposal.constituents);
  logger.info("proposal.generated", {
    id: proposal.id,
    theme,
    constituents: proposal.constituents.length,
    coverage: pricing.coverage,
  });
  return { ok: true, proposal: { ...proposal, pricing } };
}
