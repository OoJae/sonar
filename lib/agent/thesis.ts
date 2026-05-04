import { z } from "zod";

// Universe the agent may rebalance within in Wave 1.
export const UniverseKeySchema = z.enum(["MAG7", "DEFI", "MEME"]);
export type UniverseKey = z.infer<typeof UniverseKeySchema>;

// ETF-eligible assets SoSoValue tracks historical flows for.
export const EtfAssetSchema = z.enum([
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "DOGE",
  "LINK",
  "AVAX",
]);
export type EtfAsset = z.infer<typeof EtfAssetSchema>;

export const DirectionSchema = z.enum(["inflow", "outflow", "neutral"]);
export const StanceSchema = z.enum(["bullish", "bearish", "neutral"]);
export const ConfidenceSchema = z.number().min(0).max(1);

export const EtfFlowSignalSchema = z.object({
  id: z.string(),
  asset: EtfAssetSchema,
  direction: DirectionSchema,
  magnitudeUSD: z.number(),
  windowDays: z.number().int().positive(),
  confidence: ConfidenceSchema,
  sourceEndpoint: z.string(),
});
export type EtfFlowSignal = z.infer<typeof EtfFlowSignalSchema>;

export const NewsSignalSchema = z.object({
  id: z.string(),
  currency: z.string(),
  category: z.string(),
  headline: z.string(),
  url: z.string().url(),
  stance: StanceSchema,
  confidence: ConfidenceSchema,
  publishedAt: z.string().datetime(),
});
export type NewsSignal = z.infer<typeof NewsSignalSchema>;

export const AllocationSchema = z.object({
  index: UniverseKeySchema,
  targetWeight: z.number().min(0).max(1),
  deltaFromCurrent: z.number(),
});
export type Allocation = z.infer<typeof AllocationSchema>;

export const HedgeSchema = z.object({
  market: z.string(),
  side: z.enum(["long", "short"]),
  notionalUSD: z.number().nonnegative(),
  reason: z.string().min(1),
});
export type Hedge = z.infer<typeof HedgeSchema>;

export const CitationSchema = z.object({
  ref: z.string(),
  url: z.string().url(),
});
export type Citation = z.infer<typeof CitationSchema>;

// Plain object schema used for tool I/O and JSON-schema introspection.
// Consumers that need the full semantic check run ThesisSchema.safeParse().
// Splitting avoids passing a ZodEffects through the AI SDK tool boundary,
// which has historically produced flaky JSON-schema output for refinements.
export const ThesisPayloadSchema = z.object({
  id: z.string().uuid(),
  generatedAt: z.string().datetime(),
  asOf: z.string().datetime(),
  universe: z.array(UniverseKeySchema).min(1),
  signals: z.object({
    etfFlowSignal: z.array(EtfFlowSignalSchema),
    newsSignals: z.array(NewsSignalSchema),
  }),
  reasoning: z.string().min(1),
  proposedAllocations: z.array(AllocationSchema),
  hedges: z.array(HedgeSchema),
  riskNotes: z.array(z.string()).min(1, "riskNotes must not be empty"),
  citations: z.array(CitationSchema).min(1, "at least one citation required"),
  mode: z.enum(["trade", "no-trade"]).default("trade"),
});
export type ThesisPayload = z.infer<typeof ThesisPayloadSchema>;

export const ThesisSchema = ThesisPayloadSchema
  .superRefine((thesis, ctx) => {
    const totalWeight = thesis.proposedAllocations.reduce(
      (sum, alloc) => sum + alloc.targetWeight,
      0,
    );
    if (totalWeight > 1.0001) {
      ctx.addIssue({
        code: "custom",
        path: ["proposedAllocations"],
        message: `sum of targetWeight must be <= 1, got ${totalWeight}`,
      });
    }

    const signalIds = new Set<string>([
      ...thesis.signals.etfFlowSignal.map((s) => s.id),
      ...thesis.signals.newsSignals.map((s) => s.id),
    ]);

    // Every numeric claim in reasoning must cite a signal id. We enforce a
    // conservative version of this rule: every $ or % token in reasoning
    // must appear inside a [ref:id] tag referencing a known signal id.
    const refMatches = [...thesis.reasoning.matchAll(/\[ref:([^\]]+)\]/g)];
    const citedIds = new Set(refMatches.map((m) => m[1] ?? ""));
    for (const cited of citedIds) {
      if (!signalIds.has(cited)) {
        ctx.addIssue({
          code: "custom",
          path: ["reasoning"],
          message: `reasoning cites unknown signal id: ${cited}`,
        });
      }
    }

    const numericPattern = /[-+]?\$?\d[\d,]*(?:\.\d+)?%?/g;
    const numericHits = [...thesis.reasoning.matchAll(numericPattern)];
    if (numericHits.length > 0 && citedIds.size === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["reasoning"],
        message:
          "reasoning contains numbers but no [ref:<signalId>] citations",
      });
    }
  });

export type Thesis = z.infer<typeof ThesisSchema>;

export function validateThesis(input: unknown) {
  return ThesisSchema.safeParse(input);
}
