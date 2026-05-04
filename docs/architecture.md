# Architecture

## Two chains, one agent
SSI indices (MAG7.ssi, DEFI.ssi, MEME.ssi, USSI) live on Base (chainId 8453).
SoDEX execution lands on ValueChain (chainId 286623, native gas $SOSO,
explorer https://main-scan.valuechain.xyz). Mirror Protocol mediates
cross-chain custody at the protocol level, but the user wallet still needs to
land funds on the correct chain for each action. The dashboard never hides
this split; every UI surface that discusses execution labels the chain.

## Runtime topology
```
User (browser)
  |
  v
Next.js App Router (Vercel)
  |-- app/(dashboard)/*      server components, read DB
  |-- app/api/agent/run      POST, triggers one cycle
  |-- app/api/cron/daily     Vercel Cron at 21:30 UTC, weekdays
  |-- app/api/signals        GET, latest theses
  `-- app/api/portfolio      GET, positions + trades

lib/agent/runner.ts
  |-- Vercel AI SDK (tool loop, stopWhen=stepCountIs(16))
  |-- @ai-sdk/anthropic (re-pointed) -> MiMo-V2.5-Pro on Xiaomi's
  |   Anthropic-compat relay (https://token-plan-sgp.xiaomimimo.com/anthropic)
  |-- Tools: listCurrencies, getHistoricalFlows, getCurrentEtfMetrics,
  |           getFeaturedNews, getCurrencyNews, readSsiIndex,
  |           readAllSsiIndexes, submitThesis
  `-- On success: validate thesis -> persist -> execute paper trades

lib/sosovalue     REST client, Upstash token bucket (20/min),
                  stale cache fallback, fixture mode for dev
lib/ssi           viem multicall against Base
lib/sodex         paper engine (Drizzle) + thin live client for spot pairs
lib/db            Drizzle schema + postgres-js client
```

## Data model
- `agent_runs` one row per agent cycle, model id, trace id, data source,
  ok/error.
- `theses` validated thesis payload, mode (trade vs no-trade), status.
- `signals` unpacked signals linked to a thesis, makes joins and audit easy.
- `paper_trades` executed paper orders with thesis id, fill, slippage, fee.
- `paper_positions` current book, mark-to-market on read.

## Caching
SoSoValue responses cache in Upstash Redis with per-endpoint TTLs:
currency/list 24h, news 15m, currentEtfDataMetrics 1h,
historicalInflowChart 6h. A rolling 20/min token bucket enforces the beta
tier rate limit. Each response is also duplicated under a `:stale` key with a
longer TTL, so a rate limit miss can fall back to stale data without
breaking the agent.

## Observability
Every cycle writes structured logs via `lib/utils/logger.ts`. When Langfuse
keys are present, the same events publish as a trace. Without them the
logger no-ops the publish and still prints locally.
