import { z } from "zod";
import {
  VALUECHAIN_MAINNET_USDC,
  VALUECHAIN_TESTNET_USDC,
  VALUECHAIN_MAINNET_RPC,
  VALUECHAIN_TESTNET_RPC,
  isMainnetRpc,
  sameAddressLoose,
} from "@/lib/chain/valuechain";

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
  // Default to the TESTNET RPC: the default mode is paper, and the mode-bound
  // guard below rejects a mainnet RPC on any non-mainnet mode. Defaulting to
  // mainnet made `cp .env.example .env.local && pnpm dev` fail env validation on
  // a fresh clone. The mainnet RPC is supplied only by the mode drop-in.
  VALUECHAIN_RPC_URL: z.string().url().default(VALUECHAIN_TESTNET_RPC),

  // SoDEX live client: the Wave 1 unsigned spot-pair-listing helper only.
  // NOT used for execution auth on either venue: both testnet and mainnet sign
  // with SODEX_WALLET_PRIVATE_KEY and omit X-API-Key entirely (probed
  // 2026-07-17; see the header of lib/sodex/client.ts).
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
  // Comma-separated 0x addresses permitted to flip the execution mode from the
  // browser (POST /api/admin/mode). Server-only and deliberately NOT
  // NEXT_PUBLIC_: the list must never reach the bundle. A visitor can only ever
  // learn "am I an admin" by producing a valid signature from the address being
  // probed, so the list cannot be enumerated. Unset means the toggle is closed.
  SONAR_ADMIN_ADDRESSES: z.string().optional(),
  SONAR_REQUIRE_MANUAL_APPROVAL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SONAR_MAX_NOTIONAL_PER_ORDER: z.coerce.number().positive().default(500),
  SONAR_MAX_NOTIONAL_PER_CYCLE: z.coerce.number().positive().default(2000),
  // Position caps. The per-order and per-cycle caps bound the FLOW; these bound
  // the resulting BOOK. Without them a thesis that hedges the same direction
  // every cycle compounds into an unbounded position (it did: see risk.ts
  // layer 4). Per-market is the absolute notional one market's position may
  // reach; gross is the sum of absolute notionals across all markets. Orders
  // that reduce exposure are never gated by either.
  SONAR_MAX_POSITION_NOTIONAL_USD: z.coerce.number().positive().default(1000),
  SONAR_MAX_GROSS_EXPOSURE_USD: z.coerce.number().positive().default(3000),
  // How long a live-mainnet order may sit awaiting human approval before it is
  // refused. A stale row would market-order a notional sized days ago, under a
  // thesis whose own 36h freshness rule expired long before. Default 2h: well
  // inside one daily cycle, so at most one order is ever approvable per market.
  SONAR_APPROVAL_TTL_MINUTES: z.coerce.number().positive().default(120),
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
    // No API-key / registered-key requirement: probed 2026-07-17, mainnet signs
    // exactly like testnet (master wallet, no X-API-Key, no addAPIKey ceremony),
    // so SODEX_WALLET_PRIVATE_KEY (already required for any live mode above) is
    // the only credential. See the header of lib/sodex/client.ts.
    //
    // The margin asset and RPC are asserted BY VALUE, not by presence. A presence
    // check is worthless here: .env.local always supplies a USDC address (the
    // testnet one), so `if (!cfg.VALUECHAIN_USDC_ADDRESS)` could never fire and a
    // config that set the mode but not the margin asset would boot straight into
    // mainnet holding a testnet address. Probed 2026-07-17: each USDC address is
    // dead code on the other chain, so that mismatch reads as a silent zero
    // balance, never as an error. The value check is the only thing that catches
    // it. See lib/chain/valuechain.ts for the probe log.
    if (!sameAddressLoose(cfg.VALUECHAIN_USDC_ADDRESS, VALUECHAIN_MAINNET_USDC)) {
      ctx.addIssue({
        code: "custom",
        path: ["VALUECHAIN_USDC_ADDRESS"],
        message: `VALUECHAIN_USDC_ADDRESS must be the ValueChain MAINNET USDC (${VALUECHAIN_MAINNET_USDC}) on live-mainnet; got ${cfg.VALUECHAIN_USDC_ADDRESS ?? "unset"}. It is the margin asset.`,
      });
    }
    if (!isMainnetRpc(cfg.VALUECHAIN_RPC_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["VALUECHAIN_RPC_URL"],
        message: `VALUECHAIN_RPC_URL must be a ValueChain mainnet RPC (e.g. ${VALUECHAIN_MAINNET_RPC}, chainId 286623) on live-mainnet; got ${cfg.VALUECHAIN_RPC_URL ?? "unset"}.`,
      });
    }
  }

  // The symmetric assertion. Without it, a half-removed mainnet config (mode
  // reverted to testnet but the mainnet USDC/RPC left behind) would boot as
  // "testnet" while reading mainnet contracts, which is the same silent-zero
  // failure pointed the other way.
  if (cfg.SONAR_EXECUTION_MODE !== "live-mainnet") {
    if (sameAddressLoose(cfg.VALUECHAIN_USDC_ADDRESS, VALUECHAIN_MAINNET_USDC)) {
      ctx.addIssue({
        code: "custom",
        path: ["VALUECHAIN_USDC_ADDRESS"],
        message: `VALUECHAIN_USDC_ADDRESS is the MAINNET USDC but SONAR_EXECUTION_MODE=${cfg.SONAR_EXECUTION_MODE}. Off mainnet it must be the testnet USDC (${VALUECHAIN_TESTNET_USDC}).`,
      });
    }
    if (isMainnetRpc(cfg.VALUECHAIN_RPC_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["VALUECHAIN_RPC_URL"],
        message: `VALUECHAIN_RPC_URL is a mainnet RPC but SONAR_EXECUTION_MODE=${cfg.SONAR_EXECUTION_MODE}. Off mainnet it must point at ValueChain testnet (chainId 138565).`,
      });
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

// Empty string in a .env file ("FOO=") round-trips as "" in process.env.
// For optional fields (.min(1).optional()) that would fail validation.
// Treat empty and whitespace-only strings as absent.
function normalizeRecord(rec: Record<string, string | undefined>) {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = typeof v === "string" && v.trim() === "" ? undefined : v;
  }
  return out;
}

function normalizeProcessEnv() {
  return normalizeRecord(process.env as Record<string, string | undefined>);
}

/**
 * Validate a PROSPECTIVE environment without touching the cache.
 *
 * This is the preflight for the mode toggle: POST /api/admin/mode builds the env
 * as it would be after its drop-in lands and runs it through the real schema
 * BEFORE writing anything. That ordering is the whole safety property, because
 * an invalid env is not a boot failure here. There is no module-scope env() call
 * outside instrumentation.ts, so `next start` would bind the port, look healthy
 * to systemd, and 500 every request forever. Never write a config that cannot
 * boot; do not rely on finding out afterwards.
 */
export function validateEnvCandidate(
  raw: Record<string, string | undefined>,
): { ok: true } | { ok: false; issues: string[] } {
  const parsed = EnvSchema.safeParse(normalizeRecord(raw));
  if (parsed.success) return { ok: true };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
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

// The operator-facing report behind `pnpm verify:env`, which is the tool you
// reach for when the app will not boot. It had two bugs, and both mattered
// precisely then:
//
//  1. It parsed the RAW process.env while env() parses normalizeProcessEnv().
//     .env.local carries 7 empty-string vars, systemd injects them as "", and an
//     empty string fails .url()/.regex() (a .default() only fills undefined). So
//     the parse always failed and the report disagreed with the running app.
//  2. `valid: parsed.success` stamped ONE global boolean onto every row, so a
//     single bad key reported all 52 as invalid and pointed at nothing.
//
// Now: normalize like env() does, and attribute each issue to its own key.
export function envReport() {
  const parsed = EnvSchema.safeParse(normalizeProcessEnv());
  const failed = new Set<string>(
    parsed.success ? [] : parsed.error.issues.map((i) => String(i.path[0] ?? "")),
  );
  const keys = Object.keys(EnvShape.shape) as (keyof Env)[];
  return keys.map((key) => {
    const raw = process.env[key as string];
    return {
      key,
      present: raw !== undefined && raw !== "",
      valid: !failed.has(String(key)),
    };
  });
}
