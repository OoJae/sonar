#!/usr/bin/env tsx
// SSI Protocol MCP server. Exposes read-only snapshots of MAG7, DEFI, MEME,
// and USSI on Base mainnet. Runs over stdio.
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  readIndexSnapshot,
  readAllIndexSnapshots,
} from "../../lib/ssi/reader.js";
import { SSI_INDEX_KEYS } from "../../lib/ssi/addresses.js";

const server = new McpServer({
  name: "sonar-ssi",
  version: "0.1.0",
});

server.tool(
  "readIndex",
  "Snapshot a single SSI index on Base (NAV, composition, supply)",
  { index: z.enum(SSI_INDEX_KEYS as [string, ...string[]]) },
  async ({ index }) => {
    const snap = await readIndexSnapshot(index as (typeof SSI_INDEX_KEYS)[number]);
    return {
      content: [{ type: "text", text: JSON.stringify(snap) }],
    };
  },
);

server.tool(
  "readAllIndexes",
  "Snapshot MAG7, DEFI, MEME, and USSI in one call",
  {},
  async () => {
    const snaps = await readAllIndexSnapshots();
    return {
      content: [{ type: "text", text: JSON.stringify(snaps) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
