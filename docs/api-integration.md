# API integration notes

## SoSoValue REST

Base URL: `https://openapi.sosovalue.com`
Auth header: `x-soso-api-key: <SOSOVALUE_API_KEY>`
Rate limit (High Frequency tier): 100 requests per minute.

Wave 1 uses four endpoints. All are wrapped by `lib/sosovalue/client.ts` and
flow through `lib/sosovalue/cache.ts` for TTL and token-bucket handling.

| Endpoint | Purpose | Cache TTL |
|---|---|---|
| `/openapi/v1/currencies` | Master currency table (snake_case items) | 24h |
| `/openapi/v1/news/featured` | Global structured news feed (camelCase items, title in `multilanguageContent[0]`) | 15m |
| `/openapi/v1/etfs/summary-history` | Historical ETF net flows per asset (`?symbol=BTC&country_code=US`) | 6h |
| `/openapi/v1/etfs` | Per-symbol ETF list (`?symbol=BTC&country_code=US`) | 1h |
| `/openapi/v1/currencies/{currency_id}/market-snapshot` | Per-currency USD spot price (Wave 2 NAV input) | 5m |

Responses are wrapped in a `{code, message, data: ...}` envelope. See
`lib/sosovalue/types.ts` for the helper schemas.

### Fixture mode
When `SONAR_DATA_SOURCE=fixture`, every call returns a seeded response from
`lib/sosovalue/fixtures.ts`. Shapes match the live API. Flip to `live` after
`SOSOVALUE_API_KEY` is set to swap back in one env var.

### Parse contract
Responses are validated by Zod schemas in `lib/sosovalue/types.ts`. We use
`.passthrough()` so new upstream fields do not break parsing. Consumers
should treat the validated object as the source of truth.

## SSI Protocol on Base

Contracts live at the addresses recorded in `lib/ssi/addresses.ts`. Wave 1 is
read-only. We multicall `name`, `symbol`, `decimals`, `totalSupply`, and
`getTokenset` against each index token. The `getTokenset()` call returns a
`Token[]` array (`{chain, symbol, addr, decimals, amount}`) representing
the on-chain composition. Full ABIs can be pulled from the
`SoSoValueLabs/ssi-protocol` repo; we commit only the fragment we call.

NAV per share is computed off-chain in `lib/ssi/nav.ts` by summing
`amount_i * priceUSD_i` across the tokenset. The protocol does not expose
`getNav()` directly; the reader returns `navUSD: null` and `nav.ts` is the
authoritative answer. Per-token USD prices flow from
`lib/prices/index.ts:getPriceUSD(symbol)` which wraps the SoSoValue
market-snapshot endpoint above. All 27 underlying tokens across MAG7,
DEFI, and MEME price cleanly via SoSoValue (pre-prep B3 coverage table
lives in `docs/price-coverage.md`); no fallback price source is wired.
NAV snapshots persist as one row per index per cycle in `nav_snapshots`
and render on `/portfolio` as a per-share NAV line chart with a dashed
inception reference.

## SoDEX (Wave 2 live testnet)

Wave 2 ships live SoDEX testnet execution. Full discovery notes,
non-obvious wire details, and resolved questions live in
`docs/sodex-live.md`. The summary below is what the code uses today.

Testnet base URL: `https://testnet-gw.sodex.dev/api/v1`. The client appends
`/spot` or `/perps` per the request kind. Testnet chainId is `138565` and
the EIP-712 domain names are `spot` and `futures` for the two engines.

Auth on testnet skips registered API keys (mainnet still uses them); signed
requests sign with the master wallet private key directly via viem's
`signTypedData`. Three required headers:

- `X-API-Sign`: 0x01-prefixed wire signature. The leading byte is the SoDEX
  `SignatureTypeEIP712` indicator; bytes 1-65 are the raw ECDSA `r||s||v`.
  Normalize `v` from viem's 27/28 to 0/1 before assembling, or the server
  fails with `Invalid recovery ID: bad recovery id`.
- `X-API-Nonce`: uint64 unix milliseconds, monotonic per address.
- (No `X-API-Key` on testnet; no `X-API-Chain` either, the EIP-712 domain
  already binds chainId at signing time.)

Endpoints exercised:

| Path | Method | Auth | Purpose |
|---|---|---|---|
| `/perps/markets/symbols` | GET | none | Tradeable perp listing (43 symbols at probe time; BTC-USD id=1, ETH-USD id=2, SOL-USD id=4) |
| `/perps/accounts/{addr}/state` | GET | none | Returns `aid` which must be embedded in every order payload |
| `/perps/accounts/{addr}/orders` | GET | none | Open orders (status polling) |
| `/perps/accounts/{addr}/orders/history` | GET | none | Terminal-state orders with fill price + quantity (used for IOC fills that leave the open list) |
| `/perps/accounts/{addr}/positions` | GET | none | Open positions |
| `/perps/accounts/{addr}/balances` | GET | none | Perps sub-account collateral |
| `/perps/trade/orders` | POST | EIP-712 signed | Place a new order (`newOrder` action) |
| `/spot/accounts/transfers` | POST | EIP-712 signed | Move vUSDC between spot and perps sub-accounts (`transferAsset` action, type=3, toAccountID=999) |

Order envelope check: SoDEX returns HTTP 200 with `{code, data}`. `code != 0`
at the top level signals a malformed request; `data[i].code != 0` signals a
per-order business rejection (insufficient margin, dust, etc.). Both layers
must be inspected, or the executor treats engine-rejected orders as phantom
fills with zero fill price.

clOrdID format: a bare `0x` + 64 hex string is rejected with
`clOrdID is invalid`. `lib/sodex/live.ts` uses `sonar-<16 hex>` derived
from `keccak256(thesisId + ":" + market)`, which is deterministic per leg
and idempotent across retries.

Spot pair listing for the Wave 1 dashboard still hits
`https://api.sodex.com/rest/v1/spot/pairs` via `lib/sodex/client.ts:listSpotPairs`
for backwards compatibility; this path is mainnet-only and is unrelated to
the testnet executor.

### Executor abstraction

`lib/sodex/executor.ts` dispatches `placeOrder(req: OrderRequest)` by
`SONAR_EXECUTION_MODE`:

- `paper` (default): `lib/sodex/paper.ts` (Wave 1 paper engine unchanged).
- `live-testnet`: tradeable markets (BTC/ETH/SOL perp) route to
  `lib/sodex/live.ts`; SSI primitives (MAG7.ssi etc.) route to paper because
  they are not SoDEX listings (the dashboard order preview surfaces this).
- `live-mainnet`: hard-throws (the env boot guard makes the state
  unreachable without an explicit opt-in).

The kill switch is flipping `SONAR_EXECUTION_MODE=paper` in `.env.local`
and `systemctl restart sonar`. The risk gate (`lib/sodex/risk.ts`) applies
dust floor, per-order cap (downsizes), and per-cycle cap (blocks) before
any signed call hits the wire.

## Xiaomi MiMo (LLM provider)

Model id (wire format): `mimo-v2.5-pro` (lowercase per the relay's
`/v1/models` listing; the brand display capitalization is `MiMo V2.5 Pro`).
Endpoint: `https://token-plan-sgp.xiaomimimo.com/anthropic/v1`
(Anthropic-compatible). The `/v1` segment is required because
`@ai-sdk/anthropic` appends `/messages`, so the resolved URL is
`<baseURL>/messages`. We instantiate via `createAnthropic({ apiKey, baseURL })`
so the Messages API plus tool calls work without provider-specific code.

Plan: Max Monthly (1.6B credits). Off-peak window is 16:00-24:00 UTC at 0.8x
credit consumption (useful when recording the demo).
Prompt caching support on the relay is unverified; do not rely on the 90%
savings number until measured. Tool loop is capped at 16 steps per cycle by
`stopWhen: stepCountIs(16)` in `lib/agent/runner.ts`.

Fallback: if MiMo's `/anthropic/v1` relay ever rejects tool blocks, swap to
`@ai-sdk/openai-compatible` against `https://token-plan-sgp.xiaomimimo.com/v1`
(the OpenAI-compatible URL, no `/anthropic` segment) in a single file.

## Langfuse (Wave 2 tracing)

`lib/utils/logger.ts:startCycleTrace` opens a per-cycle Langfuse trace keyed
by the runId so the `/log` row anchor matches the trace URL. Inputs are the
universe, current time, and the pre-fetched `dataFreshness` value the
agent will reason against. Output is the final thesis id, mode, headline
snippet, and signal counts (or the error message on failure). The client
flushes asynchronously in a `finally` block so events reach Langfuse cloud
even on crashes.

The trace URL on the `/log` page resolves via `lib/utils/logger.ts:traceUrl`
to `${LANGFUSE_BASE_URL}/trace/{trace_id}`. Both `LANGFUSE_PUBLIC_KEY` and
`LANGFUSE_SECRET_KEY` must be set; absent keys silently leave the cycle
untraced and the column shows a dash.

## viem chain configuration (Wave 2 wallet stack)

The user-facing wallet stack (`app/providers.tsx`, wagmi v2 + ConnectKit +
React Query) configures two chains:

- Base mainnet (chainId 8453), bundled by viem under `wagmi/chains#base`.
- ValueChain testnet (chainId 138565), defined inline because viem does not
  bundle it. RPC `https://testnet-rpc.valuechain.xyz` confirmed by probe.
  Native gas token symbol `tSOSO` per the wagmi chain definition. The
  testnet explorer URL is not yet confirmed (see `docs/mirror-bridge.md`).
