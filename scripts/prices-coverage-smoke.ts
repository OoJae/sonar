#!/usr/bin/env tsx
//
// B3 / Phase 3.1 coverage probe.
//
// Reads the live MAG7 / DEFI / MEME tokensets from Base mainnet, looks each
// underlying token up against the SoSoValue /openapi/v1/currencies catalogue,
// then probes /openapi/v1/currencies/{currency_id}/market-snapshot to confirm
// a USD price is returned. Prints a markdown coverage table; the same output
// is hand-pasted into docs/price-coverage.md.
//
// This script intentionally hits SoSoValue directly with fetch() rather than
// going through lib/sosovalue/client.ts, because Phase 3.1 will add the
// market-snapshot method to the client cleanly. Treat this as discovery only;
// the production-grade caching + price abstraction lives in lib/prices/.
//
import "./_env";
import { readAllIndexSnapshots } from "@/lib/ssi/reader";
import { env } from "@/lib/utils/env";

type CurrencyEntry = { currency_id: string; symbol: string; name: string };

type SnapshotProbe = {
  ok: boolean;
  status: number;
  price?: number;
  marketcap?: number;
  raw?: unknown;
};

// On-chain tokenset symbols use prefixed identifiers like "ETH_LINK",
// "SOL_WIF", "BSC_BNB". The actual canonical ticker is the part after the
// underscore (or the whole string for unprefixed entries like "BTC", "DOGE").
// SoSoValue uses lowercase symbols. This function returns one or more
// candidate lookup keys ordered by likelihood.
//
// A few SSI-side symbols deviate from the standard CoinGecko-style ticker:
//   ETH_UNISWAP -> UNI (the project name in the SSI registry vs the ticker)
//   SOL_TRUMP1, SOL_PENGU1, SOL_PUMP1 -> TRUMP, PENGU, PUMP
//     (the trailing "1" appears to be an SSI-internal versioning suffix)
// Add new aliases here as SSI adds underlyings that don't match the obvious
// pattern.
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
    // Last-resort heuristic: strip trailing digits (TRUMP1 -> TRUMP).
    const stripped = tail.replace(/[0-9]+$/, "");
    if (stripped && stripped !== tail) out.add(stripped);
  } else {
    const aliased = SYMBOL_ALIASES[lower];
    if (aliased) out.add(aliased);
  }
  return Array.from(out);
}

async function fetchCurrencies(): Promise<CurrencyEntry[]> {
  const e = env();
  if (!e.SOSOVALUE_API_KEY) {
    throw new Error("SOSOVALUE_API_KEY required for coverage probe.");
  }
  const url = new URL("/openapi/v1/currencies", e.SOSOVALUE_BASE_URL);
  const res = await fetch(url, {
    headers: {
      "x-soso-api-key": e.SOSOVALUE_API_KEY,
      accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`currencies returned ${res.status}`);
  const json = (await res.json()) as { data: CurrencyEntry[] };
  return json.data;
}

async function probeMarketSnapshot(
  currency_id: string,
): Promise<SnapshotProbe> {
  const e = env();
  if (!e.SOSOVALUE_API_KEY) throw new Error("SOSOVALUE_API_KEY missing");
  const url = new URL(
    `/openapi/v1/currencies/${currency_id}/market-snapshot`,
    e.SOSOVALUE_BASE_URL,
  );
  const res = await fetch(url, {
    headers: {
      "x-soso-api-key": e.SOSOVALUE_API_KEY,
      accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const json = (await res.json()) as {
    data?: { price?: string | number; marketcap?: string | number };
  };
  const data = json.data;
  if (!data) return { ok: false, status: res.status, raw: json };
  const priceNum =
    typeof data.price === "string" ? Number(data.price) : data.price;
  const mcapNum =
    typeof data.marketcap === "string"
      ? Number(data.marketcap)
      : data.marketcap;
  return {
    ok: typeof priceNum === "number" && Number.isFinite(priceNum),
    status: res.status,
    price: priceNum,
    marketcap: mcapNum,
    raw: data,
  };
}

async function main() {
  console.log("# SoSoValue price coverage probe\n");
  console.log("Pulling currency list...");
  const currencies = await fetchCurrencies();
  console.log(`  ${currencies.length} currencies in SoSoValue catalogue.`);

  const bySymbol = new Map<string, CurrencyEntry>();
  for (const c of currencies) {
    bySymbol.set(c.symbol.toLowerCase(), c);
  }

  console.log("\nReading SSI tokensets from Base...");
  const snapshots = await readAllIndexSnapshots();

  console.log("\n| Index | Token (on-chain symbol) | Canonical | currency_id | Covered? | Price USD | Notes |");
  console.log("|---|---|---|---|---|---|---|");

  let total = 0;
  let covered = 0;
  const misses: string[] = [];

  for (const s of snapshots) {
    if (s.tokenset.length === 0) continue;
    for (const t of s.tokenset) {
      total++;
      const candidates = tickerCandidates(t.symbol);
      let match: CurrencyEntry | undefined;
      let resolvedFrom = "";
      for (const cand of candidates) {
        const m = bySymbol.get(cand);
        if (m) {
          match = m;
          resolvedFrom = cand;
          break;
        }
      }
      if (!match) {
        const list = candidates.join("|");
        console.log(
          `| ${s.index} | ${t.symbol} | (none of: ${list}) | - | no | - | not in currencies catalogue |`,
        );
        misses.push(`${s.index}/${t.symbol}`);
        continue;
      }
      const probe = await probeMarketSnapshot(match.currency_id);
      if (probe.ok) {
        covered++;
        console.log(
          `| ${s.index} | ${t.symbol} | ${resolvedFrom} | ${match.currency_id} | yes | ${probe.price} | - |`,
        );
      } else {
        console.log(
          `| ${s.index} | ${t.symbol} | ${resolvedFrom} | ${match.currency_id} | partial | - | snapshot HTTP ${probe.status} |`,
        );
        misses.push(`${s.index}/${t.symbol} (catalogued but snapshot ${probe.status})`);
      }
    }
  }

  console.log(`\nCovered ${covered} / ${total} tokens with a usable USD price.`);
  if (misses.length > 0) {
    console.log(`\nGaps:`);
    for (const m of misses) console.log(`  - ${m}`);
  }
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
