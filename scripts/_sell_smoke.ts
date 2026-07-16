import "./_env";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { placeOrder } from "@/lib/sodex/executor";
async function main() {
  const runId = randomUUID(); const thesisId = randomUUID(); const now = new Date();
  await db().insert(schema.agentRuns).values({ id: runId, startedAt: now, finishedAt: now, model: "sell-smoke", dataSource: "fixture", ok: true });
  await db().insert(schema.theses).values({ id: thesisId, runId, generatedAt: now, asOf: now, mode: "trade", status: "valid", reasoning: "sell fix", payload: {} });
  console.log("placing $60 BTC-PERP sell...");
  const t = await placeOrder({ thesisId, kind: "perp", market: "BTC-PERP", side: "sell", type: "market", notionalUSD: 60, slippageBps: 50 });
  console.log(`RESULT FILLED qty=${t.fillQuantity} price=${t.fillPrice}`);
}
main().then(()=>process.exit(0)).catch((e)=>{console.error("ERR:", String(e).slice(0,300));process.exit(1);});
