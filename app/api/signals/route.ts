import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db()
      .select()
      .from(schema.theses)
      .orderBy(desc(schema.theses.generatedAt))
      .limit(20);
    return NextResponse.json({ theses: rows });
  } catch (err) {
    return NextResponse.json(
      {
        error: "database_unavailable",
        message: err instanceof Error ? err.message : String(err),
        theses: [],
      },
      { status: 200 },
    );
  }
}
