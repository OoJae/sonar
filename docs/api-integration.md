# API integration notes

## SoSoValue REST

Base URL: `https://openapi.sosovalue.com`
Auth header: `x-soso-api-key: <SOSOVALUE_API_KEY>`
Rate limit (High Frequency tier): 100 requests per minute.

Wave 1 uses five endpoints. All are wrapped by `lib/sosovalue/client.ts` and
flow through `lib/sosovalue/cache.ts` for TTL and token-bucket handling.

| Endpoint | Purpose | Cache TTL |
|---|---|---|
| `/api/v1/currency/list` | Master currency table | 24h |
| `/api/v1/news/featured` | Global structured news feed | 15m |
| `/api/v1/news/featured/currency` | Per-currency news across 10 categories | 15m |
| `/api/v1/etf/historicalInflowChart` | Historical ETF net flows per asset | 6h |
| `/api/v1/etf/currentEtfDataMetrics` | Real-time per-fund metrics | 1h |

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
read-only. We multicall `name`, `symbol`, `decimals`, `totalSupply`, `getNav`,
`getAssets` against each index token. Full ABIs can be pulled from the
`SoSoValueLabs/ssi-protocol` repo; we commit only the fragments we call.

## SoDEX

SoDEX REST is documented at `https://sodex.com/documentation/api/rest-v1`.
Wave 1 exercises:
- `/rest/v1/spot/pairs` to list trading venues on the dashboard
- `/rest/v1/time` as a health probe

Paper execution is in `lib/sodex/paper.ts`. The paper engine speaks the same
`OrderRequest` shape we expect for live execution, so Wave 2 swap is a single
file change.

## Xiaomi MiMo (LLM provider)

Model: `MiMo-V2.5-Pro`.
Endpoint: `https://token-plan-sgp.xiaomimimo.com/anthropic` (Anthropic-compatible).
We instantiate `@ai-sdk/anthropic` via `createAnthropic({ apiKey, baseURL })` so
the Messages API plus tool calls work without provider-specific code.

Plan: Max Monthly, 1.6B credits valid through 2026-06-01. Off-peak window is
16:00-24:00 UTC at 0.8x credit consumption (useful when recording the demo).
Prompt caching support on the relay is unverified; do not rely on the 90%
savings number until measured. Tool loop is capped at 16 steps per cycle by
`stopWhen: stepCountIs(16)` in `lib/agent/runner.ts`.

Fallback: if MiMo's `/anthropic` relay ever rejects tool blocks, swap to
`@ai-sdk/openai-compatible` against `https://token-plan-sgp.xiaomimimo.com/v1`
in a single file.
