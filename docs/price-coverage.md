# SoSoValue Price Coverage for NAV Computation

> Pre-prep B3 deliverable. Maps every underlying token in the live MAG7, DEFI, and MEME tokensets (read from Base mainnet) to its SoSoValue `currency_id`, and confirms `/openapi/v1/currencies/{currency_id}/market-snapshot` returns a usable USD price for each.

---

## Headline result

**27 / 27 underlying tokens are covered by SoSoValue.** The MEME tokenset, which the playbook flagged as the likely gap (WIF, BONK, PEPE), is fully priced. **No CoinGecko or other fallback source is needed for Wave 2.** Phase 3.1 simplifies: `lib/prices/index.ts` is a single-source-of-truth wrapper over SoSoValue's market-snapshot endpoint, no `try { SoSoValue } catch { fallback }` branching.

Coverage was probed by `scripts/prices-coverage-smoke.ts` on 2026-05-26 against the live SoSoValue High Frequency tier (100 rpm).

---

## Endpoint shape (Phase 3.1 contract)

```
GET https://openapi.sosovalue.com/openapi/v1/currencies/{currency_id}/market-snapshot
Headers: x-soso-api-key: <key>
```

### Response envelope
```json
{
  "code": 0,
  "data": {
    "price": "76795.48",
    "change_pct_24h": "...",
    "high_24h": "...",
    "low_24h": "...",
    "marketcap": "...",
    "circulating_supply": "..."
  }
}
```

All numeric fields are returned as decimal strings, not JSON numbers. Coerce with `Number(...)` at the boundary (the coverage script already does this; the Phase 3.1 client will Zod-validate the shape with `z.string().transform(Number)`).

### `currency_id` resolution
The `currency_id` is **not the lowercase symbol**; it is a numeric string like `1673723677362319866` (BTC). Resolve `symbol -> currency_id` via the existing `GET /openapi/v1/currencies` endpoint (already wrapped as `getCurrencyList()` in [lib/sosovalue/client.ts](../lib/sosovalue/client.ts)). Cache the symbol → id map once per process; `lib/prices/` keeps it warm via the existing Redis TTL helper.

---

## Coverage table (live, 2026-05-26)

The `(on-chain symbol)` column is the prefixed string returned by `getTokenset()`; the `Canonical` column is the lowercase ticker that resolves in the SoSoValue catalogue. Prices are illustrative (spot at probe time); volatility is expected.

### MAG7 (7 / 7)

| Token (on-chain symbol) | Canonical | currency_id | Price USD |
|---|---|---|---|
| BTC | btc | 1673723677362319866 | 76795.48 |
| ETH | eth | 1673723677362319867 | 2099.61 |
| BSC_BNB | bnb | 1673723677362319869 | 657.91 |
| SOL | sol | 1673723677362319875 | 84.61 |
| XRP | xrp | 1673723677362319871 | 1.3428 |
| DOGE | doge | 1827505059183415300 | 0.001733 |
| ADA | ada | 1673723677362319873 | 0.2426 |

### DEFI (10 / 10)

| Token (on-chain symbol) | Canonical | currency_id | Price USD |
|---|---|---|---|
| ETH_LINK | link | 1673723677362319887 | 9.534 |
| ETH_UNISWAP | uni | 1673723677362319884 | 3.305 |
| ETH_AAVE | aave | 1673723677362319915 | 86.62 |
| SOL_JUP | jup | 1751808228544634882 | 0.2019 |
| ETH_ENA | ena | 1775072922459398146 | 0.1002 |
| ETH_ONDO | ondo | 1747877485162422273 | 0.4228 |
| BSC_CAKE | cake | 1673723677362319971 | 1.444 |
| HYPEREVM_HYPE | hype | 1862702593582522369 | 59.779 |
| ETH_SKY | sky | 1863926334227173378 | 0.0699 |
| ETH_CRV | crv | 1673723677362319937 | 0.2217 |

### MEME (10 / 10)

| Token (on-chain symbol) | Canonical | currency_id | Price USD |
|---|---|---|---|
| DOGE | doge | 1827505059183415300 | 0.001733 |
| ETH_SHIB | shib | 1673723677362319881 | 0.00000555 |
| ETH_PEPE | pepe | 1673723677362319959 | 0.00000357 |
| SOL_WIF | wif | 1738976569143476226 | 0.196 |
| SOL_BONK | bonk | 1685599799167254829 | 0.00000602 |
| BSC_FLOKI | floki | 1673723677362320006 | 0.00002943 |
| SOL_TRUMP1 | trump | 1880476955350953985 | 2.057 |
| SOL_PENGU1 | pengu | 1869009874973466625 | 0.00869 |
| ETH_SPX | spx | 1794351716256927746 | 0.3587 |
| SOL_PUMP1 | pump | 1944907752733888514 | 0.001782 |

### USSI (0 / 0)
USSI has no on-chain tokenset (it is the stable reference). NAV per share for USSI is `1.00` by definition; the runner does not compute it.

---

## Symbol resolution rules (for `lib/prices/`)

The on-chain SSI symbol field uses a chain-prefixed identifier. Canonical SoSoValue tickers follow this resolution:

1. If the on-chain symbol has no underscore, lookup case-insensitively (BTC, DOGE, ADA).
2. If it has an underscore, take the part after the last underscore (`ETH_LINK -> link`, `SOL_WIF -> wif`).
3. Apply a small alias map for project-name vs ticker mismatches:
   - `uniswap -> uni`
4. Strip trailing digits as a heuristic for SSI-versioned suffixes (`trump1 -> trump`, `pengu1 -> pengu`, `pump1 -> pump`). The trailing-digit pattern appears to be an SSI-internal versioning convention (perhaps to distinguish a relisted token from a deprecated v1 entry). The aliases above pin the mapping explicitly so the resolver doesn't depend on the heuristic.

The full resolver lives in [scripts/prices-coverage-smoke.ts](../scripts/prices-coverage-smoke.ts)'s `tickerCandidates()` and gets ported into `lib/prices/` during Phase 3.1.

---

## Caching plan for Phase 3.1

- `getCurrencyList()` is already cached for 24h in Wave 1; the symbol → currency_id map is built once per process from that cached response. No new cache layer needed.
- Per-token `market-snapshot` calls are cached in Redis with a 5-minute TTL via the existing `cached()` helper in [lib/sosovalue/cache.ts](../lib/sosovalue/cache.ts). Cache key: `marketSnapshot:${currency_id}`. The Wave 1 rate-limit token bucket (100 rpm) applies automatically because the call goes through the same `callLive()` path.
- One NAV cycle prices 27 tokens (~3 cycles per snapshot if computing all three indices). At 5-min TTL with one cron per weekday, cache hit rate should be near-zero on first cycle of the day and 100% on intra-day re-renders. Well under the 100 rpm budget either way.

---

## Open follow-ups (Phase 3.1)

1. Extend [lib/sosovalue/types.ts](../lib/sosovalue/types.ts) with a `MarketSnapshotResponseSchema` using `.passthrough()` (the response carries fields beyond `price` and `marketcap` that we don't use today but may want later).
2. Extend [lib/sosovalue/client.ts](../lib/sosovalue/client.ts) with `getCurrencyMarketSnapshot(currency_id)` matching the `cached()` pattern of the other methods.
3. Build `lib/prices/index.ts` exposing `getPriceUSD(symbol: string): Promise<number | null>` that does symbol → currency_id resolution + caching + Zod validation.
4. Replace [lib/sodex/paper.ts:18-26 REFERENCE_PRICES_USD](../lib/sodex/paper.ts#L18-L26) static map with calls into `lib/prices/` so paper mode marks positions against real prices for the NAV chart.
5. Refactor [scripts/prices-coverage-smoke.ts](../scripts/prices-coverage-smoke.ts) to call `lib/prices/` instead of fetching directly, so it stays an integration smoke after the abstraction lands.

No work item is blocked. The path is clean.
