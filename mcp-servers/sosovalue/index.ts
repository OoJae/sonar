#!/usr/bin/env tsx
// SoSoValue MCP server. Mirrors the agent's SoSoValue tools over stdio so
// Claude Desktop, Cursor, or any MCP client can invoke the same endpoints.
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getCurrencyList,
  getEtfSummaryHistory,
  getEtfList,
  getNewsFeatured,
} from "../../lib/sosovalue/client.js";

const server = new McpServer({
  name: "sonar-sosovalue",
  version: "0.2.0",
});

server.tool(
  "listCurrencies",
  "SoSoValue master currency table",
  {},
  async () => {
    const res = await getCurrencyList();
    return {
      content: [
        { type: "text", text: JSON.stringify((res.data.data ?? []).slice(0, 20)) },
      ],
    };
  },
);

server.tool(
  "getHistoricalFlows",
  "30-day ETF net inflow series for a single asset (US market)",
  { asset: z.string() },
  async ({ asset }) => {
    const res = await getEtfSummaryHistory(asset);
    return {
      content: [{ type: "text", text: JSON.stringify(res.data.data ?? []) }],
    };
  },
);

server.tool(
  "getEtfList",
  "List of spot ETFs available for an asset on a given country market",
  { asset: z.string(), countryCode: z.string().default("US") },
  async ({ asset, countryCode }) => {
    const res = await getEtfList(asset, { countryCode });
    return {
      content: [{ type: "text", text: JSON.stringify(res.data.data ?? []) }],
    };
  },
);

server.tool(
  "getFeaturedNews",
  "Global featured news feed",
  { pageSize: z.number().int().min(20).max(100).default(30) },
  async ({ pageSize }) => {
    const res = await getNewsFeatured({ pageSize });
    return {
      content: [{ type: "text", text: JSON.stringify(res.data.data.list) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
