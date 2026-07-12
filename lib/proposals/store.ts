// Wave 3 custom SSI index proposals: persistence.
//
// Persists a StoredProposal (validated proposal + pricing snapshot) as one row.
// Evidence lives in the jsonb payload (never queried individually), so there are
// no child rows. Reads re-validate payload leniently and skip invalid rows, like
// loadLatestThesis. No "server-only" so scripts can exercise it.

import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { StoredProposalSchema, type StoredProposal } from "./schema";

export async function persistProposal(p: StoredProposal): Promise<void> {
  await db()
    .insert(schema.proposals)
    .values({
      id: p.id,
      theme: p.theme,
      name: p.name,
      symbol: p.symbol,
      generatedAt: new Date(p.generatedAt),
      asOf: new Date(p.asOf),
      status: "valid",
      coveragePriced: p.pricing.priced,
      coverageTotal: p.pricing.total,
      perUnitNavUsd:
        p.pricing.perUnitNavUsd === null
          ? null
          : String(p.pricing.perUnitNavUsd),
      rationale: p.rationale,
      payload: p,
    });
}

export async function listProposals(limit = 50): Promise<StoredProposal[]> {
  try {
    const rows = await db()
      .select()
      .from(schema.proposals)
      .orderBy(desc(schema.proposals.generatedAt))
      .limit(limit);
    const out: StoredProposal[] = [];
    for (const row of rows) {
      const parsed = StoredProposalSchema.safeParse(row.payload);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  } catch {
    return [];
  }
}

export async function getProposal(id: string): Promise<StoredProposal | null> {
  try {
    const [row] = await db()
      .select()
      .from(schema.proposals)
      .where(eq(schema.proposals.id, id))
      .limit(1);
    if (!row) return null;
    const parsed = StoredProposalSchema.safeParse(row.payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
