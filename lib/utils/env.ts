import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Core model access. We use Xiaomi MiMo V2.5 Pro via its Anthropic-compatible
  // endpoint (https://platform.xiaomimimo.com), so the @ai-sdk/anthropic
  // provider is reused with a custom baseURL.
  MIMO_API_KEY: z.string().min(1).optional(),
  MIMO_BASE_URL: z
    .string()
    .url()
    // The @ai-sdk/anthropic provider appends `/messages` to the baseURL, so
    // we include the `/v1` segment here. Final URL: `<baseURL>/messages`.
    .default("https://token-plan-sgp.xiaomimimo.com/anthropic/v1"),

  // SoSoValue REST API (beta tier, 20 req/min)
  SOSOVALUE_API_KEY: z.string().min(1).optional(),
  SOSOVALUE_BASE_URL: z
    .string()
    .url()
    .default("https://openapi.sosovalue.com"),

  // Swap fixtures vs live SoSoValue client without touching code
  SONAR_DATA_SOURCE: z.enum(["live", "fixture"]).default("fixture"),

  // Postgres (Supabase pooled + direct)
  DATABASE_URL: z.string().url().optional(),
  DIRECT_URL: z.string().url().optional(),

  // Upstash Redis (REST API, Edge friendly)
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  // Chain RPCs (public defaults work for reads)
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
  VALUECHAIN_RPC_URL: z.string().url().default("https://rpc.valuechain.xyz"),

  // SoDEX live client (optional in Wave 1, used for spot pair listing)
  SODEX_API_KEY: z.string().min(1).optional(),
  SODEX_BASE_URL: z.string().url().default("https://api.sodex.com"),

  // Langfuse observability (optional; logger noops if absent)
  LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
  LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
  LANGFUSE_BASE_URL: z.string().url().default("https://cloud.langfuse.com"),

  // Vercel Cron secret (protects app/api/cron/daily)
  CRON_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

function normalizeProcessEnv() {
  // Empty string in a .env file ("FOO=") round-trips as "" in process.env.
  // For optional fields (.min(1).optional()) that would fail validation.
  // Treat empty and whitespace-only strings as absent.
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    out[k] = typeof v === "string" && v.trim() === "" ? undefined : v;
  }
  return out;
}

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(normalizeProcessEnv());
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  cached = parsed.data;
  return cached;
}

export function envReport() {
  const parsed = EnvSchema.safeParse(process.env);
  const keys = Object.keys(EnvSchema.shape) as (keyof Env)[];
  return keys.map((key) => {
    const raw = process.env[key as string];
    return {
      key,
      present: raw !== undefined && raw !== "",
      valid: parsed.success,
    };
  });
}
