// SoSoValue macro events reader for the circuit breaker.
//
// Endpoint confirmed in docs/sosovalue-macro.md:
//   GET /openapi/v1/macro/events
//   -> { code, message, data: [{ date: "YYYY-MM-DD", events: string[] }] }
//
// Two gaps the reader closes (both documented in docs/sosovalue-macro.md):
//   1. No per-event time, only a date. We approximate the event time as
//      13:30 UTC (08:30 ET, the modal US release time) so a horizon check in
//      hours is meaningful.
//   2. No impact field. A name allowlist classifies historically market-moving
//      releases (CPI, FOMC, NFP, PCE, GDP, PPI) as high impact; everything else
//      (PMI, home sales) is normal so the breaker does not fire on every print.

import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { cached, cacheKey, CACHE_TTL } from "./cache";
import { SosoEndpoint } from "./types";
import { z } from "zod";

export type MacroEvent = {
  name: string;
  at: string; // ISO, event date at 13:30 UTC
  impact: "high" | "normal";
};

const MacroEventsResponseSchema = z
  .object({
    code: z.number().optional(),
    data: z
      .array(
        z
          .object({
            date: z.string(),
            events: z.array(z.string()),
          })
          .passthrough(),
      )
      .nullable(),
  })
  .passthrough();

// Case-insensitive substring allowlist. "CPI (MoM)" and "Core CPI (MoM)" both
// match "cpi"; "FOMC Economic Projections" matches "fomc".
const HIGH_IMPACT_NEEDLES = [
  "cpi",
  "pce",
  "fomc",
  "interest rate decision",
  "non-farm payrolls",
  "nonfarm payrolls",
  "nfp",
  "unemployment rate",
  "gdp",
  "ppi",
];

function classify(name: string): "high" | "normal" {
  const lower = name.toLowerCase();
  return HIGH_IMPACT_NEEDLES.some((n) => lower.includes(n)) ? "high" : "normal";
}

function eventTimeIso(date: string): string {
  // date is "YYYY-MM-DD"; place the event at 13:30 UTC (modal US 08:30 ET).
  return `${date}T13:30:00.000Z`;
}

const FIXTURE_EVENTS: MacroEvent[] = [
  { name: "CPI (YoY)", at: eventTimeIso("2026-06-09"), impact: "high" },
  { name: "FOMC Interest Rate Decision", at: eventTimeIso("2026-06-17"), impact: "high" },
  { name: "ISM Manufacturing PMI", at: eventTimeIso("2026-06-01"), impact: "normal" },
];

export async function getMacroEvents(): Promise<MacroEvent[]> {
  const e = env();
  if (e.SONAR_DATA_SOURCE === "fixture" || !e.SOSOVALUE_API_KEY) {
    return FIXTURE_EVENTS;
  }
  try {
    const res = await cached({
      key: cacheKey(SosoEndpoint.MacroEvents, {}),
      ttlSeconds: CACHE_TTL.macroEvents,
      fetcher: async () => {
        const url = new URL(SosoEndpoint.MacroEvents, e.SOSOVALUE_BASE_URL);
        const r = await fetch(url, {
          headers: { "x-soso-api-key": e.SOSOVALUE_API_KEY!, accept: "application/json" },
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`macro/events ${r.status}`);
        const json: unknown = await r.json();
        const parsed = MacroEventsResponseSchema.safeParse(json);
        if (!parsed.success) {
          throw new Error(
            `macro/events response did not match schema: ${parsed.error.issues[0]?.message ?? "unknown"}`,
          );
        }
        return parsed.data;
      },
    });
    const out: MacroEvent[] = [];
    for (const day of res.data.data ?? []) {
      for (const name of day.events) {
        out.push({ name, at: eventTimeIso(day.date), impact: classify(name) });
      }
    }
    return out;
  } catch (err) {
    logger.warn("macro.fetch_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
