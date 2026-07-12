#!/usr/bin/env tsx
// Sonar MCP server (stdio). Exposes Sonar's public research surface (theses,
// track record, risk, portfolio, proposals, status) to Claude Desktop, Claude
// Code, Cursor, or any MCP client. All tools read the public API v1; no keys.
//
// Run: npx tsx mcp-servers/sonar/index.ts
// Point elsewhere: SONAR_API_BASE=https://<host>/api/v1
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SONAR_TOOLS } from "./tools.js";

const server = new McpServer({
  name: "sonar",
  version: "1.0.0",
});

for (const t of SONAR_TOOLS) {
  server.tool(t.name, t.description, t.shape, t.handler);
}

const transport = new StdioServerTransport();
await server.connect(transport);
