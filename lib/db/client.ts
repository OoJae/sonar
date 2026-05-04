// Note: no `import "server-only"` here. The DB client is shared by Next server
// routes, the agent runner, and CLI scripts (scripts/seed.ts, drizzle-kit).
// Next.js + RSC already prevents server code from leaking to client bundles.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/utils/env";
import * as schema from "./schema";

let cached: ReturnType<typeof drizzle> | null = null;

export function db() {
  if (cached) return cached;
  const e = env();
  if (!e.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Set it in .env.local before using the database.",
    );
  }
  const client = postgres(e.DATABASE_URL, {
    prepare: false,
    max: 5,
  });
  cached = drizzle(client, { schema });
  return cached;
}

export { schema };
