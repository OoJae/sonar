// Composes and broadcasts the one-per-cycle Telegram message: mode, headline
// weights, a reasoning excerpt, the cycle's live fills, and the de-risk state.
// Called fire-and-forget after finishRun; failures are logged, never thrown.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { logger } from "@/lib/utils/logger";
import type { Thesis } from "@/lib/agent/thesis";
import { broadcast, escapeHtml, telegramEnabled } from "./telegram";

function pct(w: number): string {
  return `${Math.round(w * 100)}%`;
}

export async function notifyCycleFinished(input: {
  runId: string;
  thesis: Thesis;
  deRiskFactor: number;
}): Promise<void> {
  if (!telegramEnabled()) return;
  try {
    const { runId, thesis, deRiskFactor } = input;

    const allocs = thesis.proposedAllocations
      .map((a) => `${a.index} ${pct(a.targetWeight)}`)
      .join(" / ");

    // First sentence of the reasoning, citation tags stripped.
    const excerpt = thesis.reasoning
      .replace(/\[ref:[^\]]+\]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);

    let fillsLine = "no live fills this cycle";
    try {
      const orders = await db()
        .select({
          market: schema.orders.market,
          side: schema.orders.side,
          status: schema.orders.status,
          notionalUsd: schema.orders.notionalUsd,
        })
        .from(schema.orders)
        .where(eq(schema.orders.runId, runId));
      const filled = orders.filter((o) => o.status === "filled");
      if (filled.length > 0) {
        fillsLine = filled
          .map(
            (o) =>
              `${o.market} ${o.side} $${Math.round(Number(o.notionalUsd))}`,
          )
          .join(", ");
      }
      // On live-mainnet a cycle places nothing; it queues. Without this the
      // broadcast would report "no live fills this cycle" next to a green run
      // and nothing would tell the human that orders are waiting on them, which
      // is the one thing the approval gate depends on.
      const awaiting = orders.filter((o) => o.status === "pending_approval");
      if (awaiting.length > 0) {
        const queued = awaiting
          .map((o) => `${o.market} ${o.side} $${Math.round(Number(o.notionalUsd))}`)
          .join(", ");
        fillsLine =
          `${awaiting.length} order${awaiting.length === 1 ? "" : "s"} awaiting approval: ${queued}` +
          (filled.length > 0 ? ` | filled: ${fillsLine}` : "");
      }
    } catch {
      // fills line is best-effort
    }

    const lines = [
      `<b>Sonar cycle: ${thesis.mode === "trade" ? "TRADE" : "NO-TRADE"}</b>`,
      `Allocations: ${escapeHtml(allocs)}`,
      `Fills: ${escapeHtml(fillsLine)}`,
    ];
    if (deRiskFactor < 1) {
      lines.push(
        `De-risk active: sizing scaled to ${Math.round(deRiskFactor * 100)}%`,
      );
    }
    lines.push(`<i>${escapeHtml(excerpt)}...</i>`);
    lines.push(`https://sonar.my.id/signals`);

    await broadcast(lines.join("\n"));
  } catch (err) {
    logger.warn("telegram.cycle_notify_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function notifyProposalCreated(input: {
  name: string;
  symbol: string;
  theme: string;
  coverage: string;
  perUnitNavUsd: number | null;
}): Promise<void> {
  if (!telegramEnabled()) return;
  try {
    const nav =
      input.perUnitNavUsd === null
        ? "pricing unavailable"
        : `$${input.perUnitNavUsd.toFixed(2)} per unit`;
    await broadcast(
      [
        `<b>New index proposal: ${escapeHtml(input.name)}</b> (${escapeHtml(input.symbol)})`,
        `Theme: ${escapeHtml(input.theme)}`,
        `Priced: ${escapeHtml(input.coverage)}, ${escapeHtml(nav)}`,
        `https://sonar.my.id/proposals`,
      ].join("\n"),
    );
  } catch (err) {
    logger.warn("telegram.proposal_notify_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
