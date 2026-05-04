#!/usr/bin/env tsx
// SoDEX MCP server. Wave 1: paper trading + live spot-pair listing.
// Runs over stdio.
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  placeOrder,
  markToMarket,
  getPositions,
} from "../../lib/sodex/paper.js";
import { listSpotPairs, healthCheck } from "../../lib/sodex/client.js";

const server = new McpServer({
  name: "sonar-sodex",
  version: "0.1.0",
});

server.tool(
  "placePaperOrder",
  "Submit a paper-trading order. Wave 1 execution is simulated.",
  {
    thesisId: z.string().uuid(),
    kind: z.enum(["spot", "perp"]),
    market: z.string(),
    side: z.enum(["buy", "sell"]),
    type: z.enum(["market", "limit"]),
    notionalUSD: z.number().positive(),
    limitPrice: z.number().positive().optional(),
    slippageBps: z.number().int().nonnegative().default(50),
  },
  async (args) => {
    const trade = await placeOrder(args);
    return {
      content: [{ type: "text", text: JSON.stringify(trade) }],
    };
  },
);

server.tool(
  "markToMarket",
  "Mark all paper positions to current reference prices and return them",
  {},
  async () => {
    const positions = await markToMarket();
    return {
      content: [{ type: "text", text: JSON.stringify(positions) }],
    };
  },
);

server.tool("getPositions", "Return current paper positions", {}, async () => {
  const positions = await getPositions();
  return {
    content: [{ type: "text", text: JSON.stringify(positions) }],
  };
});

server.tool(
  "listSpotPairs",
  "List live SoDEX spot pairs (falls back to static pairs when key is missing)",
  {},
  async () => {
    const pairs = await listSpotPairs();
    return {
      content: [{ type: "text", text: JSON.stringify(pairs) }],
    };
  },
);

server.tool("healthCheck", "SoDEX REST health probe", {}, async () => {
  const status = await healthCheck();
  return {
    content: [{ type: "text", text: JSON.stringify(status) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
