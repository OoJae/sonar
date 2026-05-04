import { NextResponse } from "next/server";
import { getPositions, recentTrades } from "@/lib/sodex/paper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [positions, trades] = await Promise.all([
      getPositions(),
      recentTrades(20),
    ]);
    const equity = positions.reduce(
      (acc, p) => acc + p.markPrice * p.quantity,
      0,
    );
    const unrealized = positions.reduce(
      (acc, p) => acc + p.unrealizedPnlUSD,
      0,
    );
    return NextResponse.json({
      positions,
      trades,
      totals: { equity, unrealizedPnlUSD: unrealized },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "database_unavailable",
        message: err instanceof Error ? err.message : String(err),
        positions: [],
        trades: [],
        totals: { equity: 0, unrealizedPnlUSD: 0 },
      },
      { status: 200 },
    );
  }
}
