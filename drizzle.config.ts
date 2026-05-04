import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

// drizzle-kit runs outside Next, so it does not pick up .env.local by itself.
loadEnv({ path: ".env.local" });
loadEnv();

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
