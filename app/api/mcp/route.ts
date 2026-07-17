import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SONAR_TOOLS, setV1Resolver } from "@/mcp-servers/sonar/tools";
import { env } from "@/lib/utils/env";
import { allowRequest, parseRateLimit } from "@/lib/utils/ratelimit";
import {
  trackData,
  riskData,
  portfolioData,
  deltaNeutralData,
  proposalsData,
  statusData,
  thesesData,
  latestThesisData,
} from "@/lib/api/v1-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Resolve v1 tool paths IN-PROCESS rather than over HTTP. The stdio server keeps
// the HTTP resolver; this hosted route calls lib/api/v1-data directly, so MCP
// traffic no longer round-trips through Sonar's own public API and no longer
// shares one per-IP v1 rate-limit bucket across every MCP client. Installed once
// at module load.
setV1Resolver(async (path: string): Promise<string> => {
  try {
    const [p, query] = path.split("?");
    switch (p) {
      case "/track":
        return JSON.stringify(await trackData());
      case "/risk":
        return JSON.stringify(await riskData());
      case "/portfolio":
        return JSON.stringify(await portfolioData());
      case "/delta-neutral":
        return JSON.stringify(await deltaNeutralData());
      case "/proposals":
        return JSON.stringify(await proposalsData());
      case "/status":
        return JSON.stringify(await statusData());
      case "/theses": {
        const raw = new URLSearchParams(query ?? "").get("limit");
        const n = Math.min(100, Math.max(1, Number(raw ?? 20) || 20));
        return JSON.stringify(await thesesData(n));
      }
      case "/thesis/latest": {
        const data = await latestThesisData();
        return JSON.stringify(data ?? { error: "no_thesis" });
      }
      default:
        return JSON.stringify({ error: `unknown_path:${p}` });
    }
  } catch {
    return JSON.stringify({ error: "database_unavailable" });
  }
});

// Hosted MCP endpoint (Streamable HTTP, stateless). Any MCP client can attach
// with zero install:
//   claude mcp add --transport http sonar https://sonar.my.id/api/mcp
// Stateless mode: a fresh McpServer + transport per POST, no session state.
// enableJsonResponse avoids SSE (and any proxy buffering interaction).
export async function POST(request: Request) {
  const { count, windowSec } = parseRateLimit(env().SONAR_API_RATELIMIT);
  const ip =
    request.headers.get("x-real-ip")?.trim() ??
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
    "unknown";
  if (!(await allowRequest(`mcp:ip:${ip}`, count, windowSec))) {
    return Response.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(windowSec) } },
    );
  }

  const server = new McpServer({ name: "sonar", version: "1.0.0" });
  for (const t of SONAR_TOOLS) {
    server.tool(t.name, t.description, t.shape, t.handler);
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

function methodNotAllowed(): Response {
  return Response.json(
    { ok: false, error: "method_not_allowed" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
export function GET() {
  return methodNotAllowed();
}
export function DELETE() {
  return methodNotAllowed();
}
