import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SONAR_TOOLS } from "@/mcp-servers/sonar/tools";
import { env } from "@/lib/utils/env";
import { allowRequest, parseRateLimit } from "@/lib/utils/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
