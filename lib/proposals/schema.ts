// Wave 3 custom SSI index proposals: the proposal schema + citation validator.
//
// A proposal is a themed basket of constituent tokens with target weights, a
// cited rationale, and (server-computed) pricing coverage. It is a design
// artifact that maps onto SSI Protocol on-chain index creation for mainnet; it
// is never created on-chain here. The schema reuses the thesis citation rules
// (adapted for a basket) but has its own shape because the thesis schema is
// locked to the MAG7/DEFI/MEME + 7-asset enums.

import { z } from "zod";

export const ConstituentSchema = z.object({
  symbol: z.string().min(1).max(20), // canonical exchange ticker, e.g. "BTC", "UNI"
  targetWeight: z.number().min(0).max(1),
  note: z.string().max(200).optional(),
});
export type Constituent = z.infer<typeof ConstituentSchema>;

export const EvidenceSchema = z.object({
  id: z.string().min(1).max(60), // the [ref:id] target
  kind: z.enum(["market", "news", "onchain", "macro", "thesis"]),
  label: z.string().min(1).max(200),
  url: z.string().optional(), // scheme-checked at render via safeHttpUrl
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ProposalCitationSchema = z.object({
  ref: z.string().min(1),
  url: z.string().url(),
});

// Plain payload used at the AI-SDK tool boundary (no ZodEffects, so JSON-schema
// introspection stays clean, mirroring ThesisPayloadSchema).
export const IndexProposalPayloadSchema = z.object({
  id: z.string().uuid(),
  generatedAt: z.string().datetime(),
  asOf: z.string().datetime(),
  theme: z.string().min(1).max(80),
  name: z.string().min(1).max(60), // "AI Agents Index"
  symbol: z.string().regex(/^[A-Z0-9]{2,10}\.ssi$/), // "AGENTS.ssi"
  constituents: z.array(ConstituentSchema).min(3).max(15),
  evidence: z.array(EvidenceSchema).min(1),
  rationale: z.string().min(1),
  riskNotes: z.array(z.string().min(1)).min(1),
  citations: z.array(ProposalCitationSchema).min(1),
});
export type IndexProposalPayload = z.infer<typeof IndexProposalPayloadSchema>;

// The three thesis citation checks, adapted for a basket.
export const IndexProposalSchema = IndexProposalPayloadSchema.superRefine(
  (p, ctx) => {
    // (1) Weight-sum tolerance band. A basket sums to ~1 (unlike the thesis
    // <=1 rule); the server normalizes to exactly 1 after this guard.
    const total = p.constituents.reduce((s, c) => s + c.targetWeight, 0);
    if (Math.abs(total - 1) > 0.02) {
      ctx.addIssue({
        code: "custom",
        path: ["constituents"],
        message: `constituent targetWeight must sum to ~1 (0.98..1.02), got ${total}`,
      });
    }

    // (2) Every [ref:id] in rationale must resolve to an evidence id or a citation ref.
    const citeable = new Set<string>([
      ...p.evidence.map((e) => e.id),
      ...p.citations.map((c) => c.ref),
    ]);
    const cited = new Set(
      [...p.rationale.matchAll(/\[ref:([^\]]+)\]/g)].map((m) => m[1] ?? ""),
    );
    for (const id of cited) {
      if (!citeable.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["rationale"],
          message: `rationale cites unknown evidence id: ${id}`,
        });
      }
    }

    // (3) Numbers in rationale with zero citations are rejected (verbatim from thesis.ts).
    const numericHits = [
      ...p.rationale.matchAll(/[-+]?\$?\d[\d,]*(?:\.\d+)?%?/g),
    ];
    if (numericHits.length > 0 && cited.size === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["rationale"],
        message: "rationale contains numbers but no [ref:<evidenceId>] citations",
      });
    }
  },
);
export type IndexProposal = z.infer<typeof IndexProposalSchema>;

export function validateProposal(input: unknown) {
  return IndexProposalSchema.safeParse(input);
}

// Server-computed pricing coverage, folded into the stored payload.
export const MarkSchema = z.object({
  symbol: z.string(),
  weight: z.number(),
  priceUsd: z.number().nullable(),
});
export type Mark = z.infer<typeof MarkSchema>;

export const PricingSchema = z.object({
  marks: z.array(MarkSchema),
  priced: z.number(),
  skipped: z.number(),
  total: z.number(),
  coverage: z.string(), // "6 of 8 priceable"
  pricedWeight: z.number(), // sum of weights that priced
  perUnitNavUsd: z.number().nullable(), // sum(weight_i * price_i) over priced; null if none
  asOf: z.string(),
});
export type Pricing = z.infer<typeof PricingSchema>;

// The stored object = the validated proposal + its pricing snapshot. Read
// leniently on the page (safeParse + skip), like loadLatestThesis.
export const StoredProposalSchema = IndexProposalPayloadSchema.extend({
  pricing: PricingSchema,
});
export type StoredProposal = z.infer<typeof StoredProposalSchema>;
