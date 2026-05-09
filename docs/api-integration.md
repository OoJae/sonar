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

NAV per share is computed off-chain in Wave 2 by summing
`amount_i * priceUSD_i` across the tokenset. The protocol does not expose
`getNav()` directly, so the reader returns `navUSD: null` in Wave 1.

## SoDEX

SoDEX REST is documented at `https://sodex.com/documentation/api/rest-v1`.
Wave 1 exercises:
- `/rest/v1/spot/pairs` to list trading venues on the dashboard
- `/rest/v1/time` as a health probe

Paper execution is in `lib/sodex/paper.ts`. The paper engine speaks the same
`OrderRequest` shape we expect for live execution, so Wave 2 swap is a single
file change.

## Xiaomi MiMo (LLM provider)

Model id (wire format): `mimo-v2.5-pro` (lowercase per the relay's
`/v1/models` listing; the brand display capitalization is `MiMo V2.5 Pro`).
Endpoint: `https://token-plan-sgp.xiaomimimo.com/anthropic/v1`
(Anthropic-compatible). The `/v1` segment is required because
`@ai-sdk/anthropic` appends `/messages`, so the resolved URL is
`<baseURL>/messages`. We instantiate via `createAnthropic({ apiKey, baseURL })`
so the Messages API plus tool calls work without provider-specific code.

Plan: Max Monthly, 1.6B credits valid through 2026-06-01. Off-peak window is
16:00-24:00 UTC at 0.8x credit consumption (useful when recording the demo).
Prompt caching support on the relay is unverified; do not rely on the 90%
savings number until measured. Tool loop is capped at 16 steps per cycle by
`stopWhen: stepCountIs(16)` in `lib/agent/runner.ts`.

Fallback: if MiMo's `/anthropic/v1` relay ever rejects tool blocks, swap to
`@ai-sdk/openai-compatible` against `https://token-plan-sgp.xiaomimimo.com/v1`
(the OpenAI-compatible URL, no `/anthropic` segment) in a single file.
