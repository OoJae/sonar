// Wave 2 price source. Resolves a token symbol to its USD spot price by
// hitting SoSoValue's per-currency market-snapshot endpoint. Used by
// lib/ssi/nav.ts to compute per-share NAV for the SSI indices.
//
// Symbol resolution: SSI's on-chain tokenset uses chain-prefixed identifiers
// like ETH_LINK, SOL_WIF, BSC_BNB; canonical SoSoValue tickers are the part
// after the underscore, with a small alias map for project-name vs ticker
// mismatches (uniswap -> uni) and SSI-internal versioning suffixes
// (trump1 -> trump, etc.). The full coverage table lives in
// docs/price-coverage.md (B3); 27/27 tokens are covered without a fallback
// source, so this module is single-provider by design.
//
// Caching: SoSoValue's currency list is already cached for 24h in
// lib/sosovalue/cache.ts; we build the symbol -> currency_id map once per
// process. Per-token snapshot calls go through the same cache layer with a
// 5-minute TTL, so one NAV cycle prices all 27 tokens fresh and intra-day
// re-renders hit cache.

import { logger } from "@/lib/utils/logger";
import {
  getCurrencyList,
  getCurrencyMarketSnapshot,
} from "@/lib/sosovalue/client";

const SYMBOL_ALIASES: Record<string, string> = {
  uniswap: "uni",
  trump1: "trump",
  pengu1: "pengu",
  pump1: "pump",
};

function tickerCandidates(rawSymbol: string): string[] {
  const lower = rawSymbol.toLowerCase();
  const out = new Set<string>();
  out.add(lower);
  const underscore = lower.lastIndexOf("_");
  if (underscore >= 0) {
    const tail = lower.slice(underscore + 1);
    out.add(tail);
    const aliased = SYMBOL_ALIASES[tail];
    if (aliased) out.add(aliased);
    const stripped = tail.replace(/[0-9]+$/, "");
    if (stripped && stripped !== tail) out.add(stripped);
  } else {
    const aliased = SYMBOL_ALIASES[lower];
    if (aliased) out.add(aliased);
  }
  return Array.from(out);
}

let symbolToCurrencyId: Map<string, string> | null = null;

async function loadSymbolMap(): Promise<Map<string, string>> {
  if (symbolToCurrencyId) return symbolToCurrencyId;
  const res = await getCurrencyList();
  const map = new Map<string, string>();
  for (const c of res.data.data) {
    map.set(c.symbol.toLowerCase(), c.currency_id);
  }
  symbolToCurrencyId = map;
  return map;
}

function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Public API: returns the USD price for a token symbol, or null when the
// symbol is not in the SoSoValue catalogue (caller decides whether to drop
// the leg or surface a UI warning). Symbol matching is case-insensitive and
// applies the same resolution rules as the B3 coverage script.
export async function getPriceUSD(symbol: string): Promise<number | null> {
  const map = await loadSymbolMap();
  let currencyId: string | undefined;
  let resolved = "";
  for (const candidate of tickerCandidates(symbol)) {
    const hit = map.get(candidate);
    if (hit) {
      currencyId = hit;
      resolved = candidate;
      break;
    }
  }
  if (!currencyId) {
    logger.warn("prices.no_currency_id", { symbol });
    return null;
  }
  try {
    const snapshot = await getCurrencyMarketSnapshot(currencyId);
    const price = parsePrice(snapshot.data.data.price);
    if (price === null) {
      logger.warn("prices.no_price_in_snapshot", {
        symbol,
        resolved,
        currencyId,
      });
      return null;
    }
    return price;
  } catch (err) {
    logger.warn("prices.fetch_failed", {
      symbol,
      resolved,
      currencyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// Reset the in-process symbol cache. Used by tests and not on the runner
// path; the cached map is process-stable because the SoSoValue catalogue
// itself only changes when SoSoValue lists a new token.
export function resetSymbolCache(): void {
  symbolToCurrencyId = null;
}
