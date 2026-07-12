// Shared tool definitions for the Sonar MCP surface.
//
// Every handler fetches the PUBLIC read-only API v1 (no DB access, no secrets),
// so the same definitions power both the stdio server (runnable anywhere) and
// the hosted Streamable HTTP endpoint at /api/mcp. Point SONAR_API_BASE at a
// different deployment to consume it.

import { z } from "zod";

const DEFAULT_BASE = "https://sonar.my.id/api/v1";

function apiBase(): string {
  return (process.env.SONAR_API_BASE ?? DEFAULT_BASE).replace(/\/$/, "");
}

async function fetchV1(path: string): Promise<string> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: unknown;
    error?: string;
  } | null;
  if (!res.ok || !body?.ok) {
    return JSON.stringify({ error: body?.error ?? `http_${res.status}` });
  }
  return JSON.stringify(body.data);
}

type ToolResult = { content: Array<{ type: "text"; text: string }> };
function text(t: string): ToolResult {
  return { content: [{ type: "text", text: t }] };
}

export type SonarTool = {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  // Args are validated by the MCP SDK against `shape` before the handler runs.
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
};

export const SONAR_TOOLS: SonarTool[] = [
  {
    name: "get_latest_thesis",
    description:
      "Sonar's latest directional research thesis: cited reasoning over crypto ETF flows and news, proposed index allocations, hedges, and risk notes. Every numeric claim carries an inline [ref:id] citation.",
    shape: {},
    handler: () => fetchV1("/thesis/latest").then(text),
  },
  {
    name: "list_theses",
    description:
      "Thesis history (both strategies, newest first): id, strategy, generatedAt, asOf, mode (trade/no-trade), status, and headline allocations.",
    shape: { limit: z.number().int().min(1).max(100).default(20) },
    handler: (args) =>
      fetchV1(`/theses?limit=${Number(args.limit ?? 20)}`).then(text),
  },
  {
    name: "get_track_record",
    description:
      "The verifiable track record: cumulative return of Sonar's rebalanced book vs a buy-and-hold baseline (both indexed to 100), win rate, and per-thesis P&L attribution.",
    shape: {},
    handler: () => fetchV1("/track").then(text),
  },
  {
    name: "get_risk_metrics",
    description:
      "Portfolio risk metrics: historical VaR, max and current drawdown, index correlation matrix, exposure by index, and concentration (HHI).",
    shape: {},
    handler: () => fetchV1("/risk").then(text),
  },
  {
    name: "get_portfolio",
    description:
      "The current book: positions split by strategy (directional and delta-neutral) with long/short/net/gross exposure and unrealized P&L.",
    shape: {},
    handler: () => fetchV1("/portfolio").then(text),
  },
  {
    name: "get_delta_neutral_track",
    description:
      "The delta-neutral strategy's mark-to-market track: net exposure over time (long MAG7 basket minus sized BTC perp short), current book, and rebalance count.",
    shape: {},
    handler: () => fetchV1("/delta-neutral").then(text),
  },
  {
    name: "list_proposals",
    description:
      "AI-designed custom index proposals: themed baskets with target weights, live pricing coverage, per-unit NAV, and cited rationales. Design artifacts, not on-chain products.",
    shape: {},
    handler: () => fetchV1("/proposals").then(text),
  },
  {
    name: "get_status",
    description:
      "Service status: version, execution mode (paper/live-testnet), last agent run outcome, and data freshness in hours.",
    shape: {},
    handler: () => fetchV1("/status").then(text),
  },
];
