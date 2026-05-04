import "server-only";
import { z } from "zod";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { SpotPairSchema, type SpotPair } from "./types";

// Thin Wave 1 SoDEX client. We hit the documented REST endpoints to prove
// integration (bonus credit) without committing to live execution. Paper
// trading in paper.ts is the Wave 1 execution path.
//
// The exact response envelope on https://sodex.com/documentation/api/rest-v1
// is still being verified by the SoDEX team. We parse defensively: unknown
// top-level fields are allowed.

const SpotPairsEnvelopeSchema = z.union([
  z.object({ data: z.array(SpotPairSchema) }).passthrough(),
  z.array(SpotPairSchema),
]);

export type SodexHealth = {
  ok: boolean;
  latencyMs: number;
  note: string;
};

const FALLBACK_PAIRS: SpotPair[] = [
  { symbol: "USSI-USDC", baseAsset: "USSI", quoteAsset: "USDC" },
  { symbol: "MAG7-USDC", baseAsset: "MAG7.ssi", quoteAsset: "USDC" },
  { symbol: "DEFI-USDC", baseAsset: "DEFI.ssi", quoteAsset: "USDC" },
  { symbol: "MEME-USDC", baseAsset: "MEME.ssi", quoteAsset: "USDC" },
];

export async function listSpotPairs(): Promise<SpotPair[]> {
  const e = env();
  if (!e.SODEX_API_KEY) {
    logger.info("sodex.fallback_pairs", { reason: "no_key" });
    return FALLBACK_PAIRS;
  }
  try {
    const res = await fetch(new URL("/rest/v1/spot/pairs", e.SODEX_BASE_URL), {
      headers: {
        "x-api-key": e.SODEX_API_KEY,
        accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      logger.warn("sodex.pairs_http_error", { status: res.status });
      return FALLBACK_PAIRS;
    }
    const json: unknown = await res.json();
    const parsed = SpotPairsEnvelopeSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn("sodex.pairs_parse_error", {
        issues: parsed.error.issues.slice(0, 3),
      });
      return FALLBACK_PAIRS;
    }
    return Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
  } catch (err) {
    logger.warn("sodex.pairs_exception", {
      error: err instanceof Error ? err.message : String(err),
    });
    return FALLBACK_PAIRS;
  }
}

export async function healthCheck(): Promise<SodexHealth> {
  const e = env();
  if (!e.SODEX_API_KEY) {
    return {
      ok: false,
      latencyMs: 0,
      note: "SODEX_API_KEY not set; using fallback spot pair list",
    };
  }
  const start = Date.now();
  try {
    const res = await fetch(new URL("/rest/v1/time", e.SODEX_BASE_URL), {
      cache: "no-store",
    });
    return {
      ok: res.ok,
      latencyMs: Date.now() - start,
      note: res.ok ? "live" : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      note: err instanceof Error ? err.message : "network error",
    };
  }
}
