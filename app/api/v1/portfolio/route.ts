import { getPositions } from "@/lib/sodex/paper";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

// The current book, split by strategy, with net-exposure totals.
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  try {
    const positions = await getPositions();
    const directional = positions.filter((p) => p.strategy === "directional");
    const deltaNeutral = positions.filter(
      (p) => p.strategy === "delta-neutral",
    );
    return v1Json({
      positions,
      summary: {
        directional: summarize(directional),
        deltaNeutral: summarize(deltaNeutral),
        combinedNetUsd:
          summarize(directional).netUsd + summarize(deltaNeutral).netUsd,
      },
    });
  } catch {
    return v1Error("database_unavailable");
  }
}
