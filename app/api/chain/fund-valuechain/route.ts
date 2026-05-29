import { NextResponse } from "next/server";
import { env } from "@/lib/utils/env";
import { withdrawVusdcToOnchain } from "@/lib/sodex/client";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-chain funding: withdraw vUSDC from the SoDEX testnet spot ledger to the
// agent wallet's on-chain ValueChain address. There is no testnet bridge
// between Base and ValueChain (confirmed by the SoSoValue team), so this
// withdrawal is the funding path.
//
// Bearer-guarded like /api/agent/run: a funding action moves balances, so it is
// not a public endpoint.
//
// Honest fallback: the programmatic on-chain withdrawal destination constant is
// not publicly documented (see lib/sodex/client.ts:withdrawVusdcToOnchain).
// When the engine rejects it, we return a clear, structured message pointing
// the operator at the SoDEX testnet withdrawal UI rather than pretending the
// call succeeded. The method flips to fully working the moment the destination
// constant is confirmed.
export async function POST(request: Request) {
  const e = env();
  const auth = request.headers.get("authorization") ?? "";
  const expected = e.CRON_SECRET ? `Bearer ${e.CRON_SECRET}` : null;
  if (expected && auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let amountUSD = "5";
  try {
    const body = (await request.json()) as { amountUSD?: unknown };
    if (typeof body.amountUSD === "string" && /^\d+(\.\d+)?$/.test(body.amountUSD)) {
      amountUSD = body.amountUSD;
    }
  } catch {
    // No body or invalid JSON; use the default amount.
  }

  try {
    const result = await withdrawVusdcToOnchain({ amountUSD });
    return NextResponse.json(
      { ok: true, amountUSD, raw: result.raw },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("fund_valuechain.withdrawal_failed", { amountUSD, message });
    return NextResponse.json(
      {
        ok: false,
        amountUSD,
        message,
        guidance:
          "Programmatic on-chain withdrawal is not available on testnet (the destination constant is undocumented; the SoDEX SDK directs on-chain deposits and withdrawals through the SoDEX web UI). Fund the ValueChain address by withdrawing from the SoDEX testnet dashboard. The three-balance panel reflects on-chain and venue balances either way.",
      },
      { status: 200 },
    );
  }
}
