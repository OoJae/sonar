import { z } from "zod";

const EnvShape = z.object({
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

  // SoSoValue REST API (High Frequency tier, 100 req/min)
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

  // SoDEX live client (Wave 1: spot pair listing only). Mainnet API-key name.
  // Testnet uses SODEX_WALLET_PRIVATE_KEY directly per docs/sodex-live.md §1.
  SODEX_API_KEY: z.string().min(1).optional(),
  SODEX_BASE_URL: z.string().url().default("https://api.sodex.com"),

  // Wave 2 execution: mode + risk caps + testnet auth.
  SONAR_EXECUTION_MODE: z
    .enum(["paper", "live-testnet", "live-mainnet"])
    .default("paper"),
  SONAR_ALLOW_MAINNET: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  SONAR_REQUIRE_MANUAL_APPROVAL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SONAR_MAX_NOTIONAL_PER_ORDER: z.coerce.number().positive().default(500),
  SONAR_MAX_NOTIONAL_PER_CYCLE: z.coerce.number().positive().default(2000),
  // Wave 3 session-key delegation. When "true", every order must be covered by
  // an active user-signed grant to the agent session key or the executor blocks
  // it. Default off so the autonomous cron trades under operator authority as
  // before. Toggling requires an app restart (env() is cached), like the mode.
  SONAR_REQUIRE_DELEGATION: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SONAR_DELEGATION_RATELIMIT: z
    .string()
    .regex(/^\d+\/\d+$/)
    .default("20/60"),
  // Macro circuit breaker lookahead window (hours). When a high-impact macro
  // event (CPI, FOMC, etc.) falls within this horizon, the agent de-risks.
  SONAR_MACRO_HALT_HORIZON_HOURS: z.coerce.number().positive().default(6),
  // Wave 3 production risk engine. When the reconstructed book drawdown exceeds
  // SONAR_MAX_DRAWDOWN_PCT, the cycle de-risks (same server-side path as the
  // macro breaker). SONAR_VAR_CONFIDENCE is the confidence level for the
  // historical VaR shown on /risk and used by the risk metrics.
  SONAR_MAX_DRAWDOWN_PCT: z.coerce.number().positive().default(25),
  SONAR_VAR_CONFIDENCE: z.coerce.number().gt(0).lt(1).default(0.95),
  // Interactive public run-a-cycle demo budget, "<count>/<windowSeconds>".
  // Default: 1 run per 300s globally. Parsed by the demo-run endpoint.
  SONAR_PUBLIC_RUN_RATELIMIT: z
    .string()
    .regex(/^\d+\/\d+$/, { message: "SONAR_PUBLIC_RUN_RATELIMIT must be '<count>/<seconds>'" })
    .default("1/300"),
  SODEX_TESTNET_BASE_URL: z
    .string()
    .url()
    .default("https://testnet-gw.sodex.dev/api/v1"),
  SODEX_API_SECRET: z.string().min(1).optional(),
  // Hex-encoded 32-byte private key (0x + 64 hex chars). Server-side only.
  // Used by viem privateKeyToAccount() for EIP-712 SoDEX signing. Never log.
  SODEX_WALLET_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, {
      message:
        "SODEX_WALLET_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string",
    })
    .optional(),

  // Wave 2 cross-chain: USDC contract addresses + Mirror Protocol bridge.
  // Base mainnet USDC default is Circle's well-known address. ValueChain
  // testnet USDC and the bridge contracts are UNCONFIRMED pending Discord
  // (see docs/mirror-bridge.md).
  BASE_USDC_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .default("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  VALUECHAIN_USDC_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  MIRROR_BRIDGE_BASE_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  MIRROR_BRIDGE_VALUECHAIN_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  NEXT_PUBLIC_WALLETCONNECT_ID: z.string().min(1).optional(),

  // Langfuse observability (Wave 2 traces; logger noops if absent).
  LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
  LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
  LANGFUSE_BASE_URL: z.string().url().default("https://cloud.langfuse.com"),

  // Cron secret (protects app/api/cron/daily and app/api/agent/run)
  CRON_SECRET: z.string().min(1).optional(),
});

// Production hardening + Wave 2 execution gates.
const EnvSchema = EnvShape.superRefine((cfg, ctx) => {
  // CRON_SECRET is mandatory in production so the cron and manual-run endpoints
  // are not open to the public internet. Dev mode is unaffected.
  if (cfg.NODE_ENV === "production" && !cfg.CRON_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["CRON_SECRET"],
      message:
        "CRON_SECRET is required in production to gate /api/cron/daily and /api/agent/run",
    });
  }

  // Any live execution mode requires the testnet hot wallet key so we can sign
  // SoDEX EIP-712 payloads. Catching this at boot prevents a runtime panic on
  // the first order attempt.
  if (
    cfg.SONAR_EXECUTION_MODE.startsWith("live") &&
    !cfg.SODEX_WALLET_PRIVATE_KEY
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["SODEX_WALLET_PRIVATE_KEY"],
      message: `SODEX_WALLET_PRIVATE_KEY is required when SONAR_EXECUTION_MODE=${cfg.SONAR_EXECUTION_MODE}`,
    });
  }

  // Requiring delegation needs the hot wallet key so the agent session key
  // (getSignerAddress()) is derivable inside the enforcement gate.
  if (cfg.SONAR_REQUIRE_DELEGATION && !cfg.SODEX_WALLET_PRIVATE_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["SODEX_WALLET_PRIVATE_KEY"],
      message:
        "SODEX_WALLET_PRIVATE_KEY is required when SONAR_REQUIRE_DELEGATION=true (the session key is derived from it)",
    });
  }

  // Mainnet is gated behind a second explicit opt-in plus forced manual approval.
  // See docs/sodex-live.md §0 and CLAUDE-WAVE2.md §3.5.
  if (cfg.SONAR_EXECUTION_MODE === "live-mainnet") {
    if (!cfg.SONAR_ALLOW_MAINNET) {
      ctx.addIssue({
        code: "custom",
        path: ["SONAR_ALLOW_MAINNET"],
        message:
          "SONAR_ALLOW_MAINNET must be \"true\" when SONAR_EXECUTION_MODE=live-mainnet (mainnet uses real funds)",
      });
    }
    if (!cfg.SONAR_REQUIRE_MANUAL_APPROVAL) {
      ctx.addIssue({
        code: "custom",
        path: ["SONAR_REQUIRE_MANUAL_APPROVAL"],
        message:
          "SONAR_REQUIRE_MANUAL_APPROVAL must be \"true\" on live-mainnet (forced manual approval is mandatory)",
      });
    }
  }
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
  const keys = Object.keys(EnvShape.shape) as (keyof Env)[];
  return keys.map((key) => {
    const raw = process.env[key as string];
    return {
      key,
      present: raw !== undefined && raw !== "",
      valid: parsed.success,
    };
  });
}
