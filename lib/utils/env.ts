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

  // SoDEX live client (Wave 1: spot pair listing only). On live-mainnet this is
  // the NAME of the API key registered via scripts/sodex-mainnet-register.ts,
  // sent as X-API-Key. Testnet omits X-API-Key and signs with
  // SODEX_WALLET_PRIVATE_KEY directly per docs/sodex-live.md §1.
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
  // Rate limit for the public on-demand index-proposal generator (count/windowSec).
  SONAR_PROPOSAL_RATELIMIT: z
    .string()
    .regex(/^\d+\/\d+$/)
    .default("5/600"),
  // Per-IP rate limit for the public read-only API v1 (count/windowSec).
  SONAR_API_RATELIMIT: z
    .string()
    .regex(/^\d+\/\d+$/)
    .default("120/60"),
  // Telegram notifications (all optional; the notify module no-ops when the
  // token is unset). Channel id is "@name" or "-100..."; the bot must be a
  // channel admin with the post-messages right.
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHANNEL_ID: z.string().min(1).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  // Public join link rendered as the site CTA (e.g. https://t.me/sonarfund).
  TELEGRAM_CHANNEL_URL: z.string().url().optional(),
  // X (Twitter) publisher. OAuth 1.0a user context for the Sonar account
  // (pay-per-use app; the free tier was discontinued Feb 2026). All optional;
  // the publisher no-ops without them. X_AUTOPOST is the explicit go-live
  // switch: keys alone enable the smoke script, autoposting stays off until
  // the smoke has passed on the real app.
  X_API_KEY: z.string().min(1).optional(),
  X_API_SECRET: z.string().min(1).optional(),
  X_ACCESS_TOKEN: z.string().min(1).optional(),
  X_ACCESS_SECRET: z.string().min(1).optional(),
  X_AUTOPOST: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
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
  // Mainnet gateway. Like the testnet URL it must carry /api/v1; do not strip.
  // Only read when SONAR_EXECUTION_MODE=live-mainnet (docs/sodex-live.md §2).
  SODEX_MAINNET_BASE_URL: z
    .string()
    .url()
    .default("https://mainnet-gw.sodex.dev/api/v1"),
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
  // Mainnet signs writes with a SEPARATE registered keypair, not the master
  // wallet (docs/sodex-live.md §13): the master calls addAPIKey once to
  // register SODEX_API_KEY (the name) against this key's address, then every
  // signed write is signed by this key. Master stays the account owner, so a
  // leak of this key is master-revocable. Server-side only. Never log.
  SODEX_MAINNET_SIGNING_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, {
      message:
        "SODEX_MAINNET_SIGNING_KEY must be a 0x-prefixed 32-byte hex string",
    })
    .optional(),

  // Cross-chain: USDC contract addresses + Mirror Protocol bridge.
  // Base mainnet USDC default is Circle's well-known address.
  // VALUECHAIN_USDC_ADDRESS carries the testnet USDC on live-testnet and the
  // ValueChain MAINNET USDC on live-mainnet (it is the margin asset deposited
  // into the SoDEX account; funding is a direct deposit, not a bridge hop).
  // The Mirror bridge contracts are still UNCONFIRMED pending Discord, so the
  // bridge stays dormant and off the funding path (see docs/mirror-bridge.md).
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

  // A bot token without a webhook secret would leave the webhook route
  // unauthenticated; require them together.
  if (cfg.TELEGRAM_BOT_TOKEN && !cfg.TELEGRAM_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["TELEGRAM_WEBHOOK_SECRET"],
      message:
        "TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_BOT_TOKEN is set (openssl rand -hex 24)",
    });
  }

  // Mainnet is gated behind a second explicit opt-in plus forced manual approval,
  // and it needs the registered-key credentials the mainnet auth flow signs with.
  // See docs/sodex-live.md §0 + §13.
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
    // Mainnet writes are signed by the registered key and stamped with its name
    // (X-API-Key); missing either would fail at the first signed action.
    if (!cfg.SODEX_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["SODEX_API_KEY"],
        message:
          "SODEX_API_KEY (the registered mainnet key name, sent as X-API-Key) is required on live-mainnet; register it with scripts/sodex-mainnet-register.ts",
      });
    }
    if (!cfg.SODEX_MAINNET_SIGNING_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["SODEX_MAINNET_SIGNING_KEY"],
        message:
          "SODEX_MAINNET_SIGNING_KEY is required on live-mainnet (the registered key signs every write; the master wallet only registers it)",
      });
    }
    // The margin asset must be known before any real funds are deposited.
    if (!cfg.VALUECHAIN_USDC_ADDRESS) {
      ctx.addIssue({
        code: "custom",
        path: ["VALUECHAIN_USDC_ADDRESS"],
        message:
          "VALUECHAIN_USDC_ADDRESS (ValueChain mainnet USDC) is required on live-mainnet; it is the margin asset",
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
