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
Next.js App Router (Vercel-ready, deployed on VPS for Wave 1)
  |-- app/(dashboard)/*      server components, read DB
  |-- app/api/agent/run      POST, triggers one cycle
  |-- app/api/cron/daily     Host crontab at 04:00 UTC Tue-Sat (~8h after each US close)
  |-- app/api/signals        GET, latest theses
  `-- app/api/portfolio      GET, positions + trades

lib/agent/runner.ts
  |-- Vercel AI SDK (tool loop, stopWhen=stepCountIs(16))
  |-- @ai-sdk/anthropic (re-pointed) -> mimo-v2.5-pro on Xiaomi's
  |   Anthropic-compat relay (https://token-plan-sgp.xiaomimimo.com/anthropic/v1)
  |-- Tools: listCurrencies, getHistoricalFlows, getEtfList,
  |           getFeaturedNews, readSsiIndex, readAllSsiIndexes,
  |           submitThesis
  `-- On success: validate thesis -> persist -> execute paper trades

lib/sosovalue     REST client (currencies, ETF history, news, currency
                  market-snapshot for NAV), Upstash token bucket (100/min,
                  High Frequency), stale cache fallback, fixture mode
lib/ssi           viem multicall reader + lib/ssi/nav.ts (per-share NAV
                  from tokenset times USD prices)
lib/prices        SoSoValue per-currency price wrapper with symbol resolver
lib/sodex         executor facade routes placeOrder by SONAR_EXECUTION_MODE:
                    paper.ts     Wave 1 paper engine (still the default)
                    live.ts      EIP-712 signed orders on SoDEX testnet
                    risk.ts      per-order + per-cycle caps, mode gate
                    markets.ts   Sonar market -> SoDEX symbol name
                    client.ts    signed client (submitPerpOrder,
                                 getAccountState, transferSpotToPerps, etc.)
lib/chain         agent hot wallet balance reads (server-side viem) +
                    bridge.ts (Mirror Protocol mainnet design, config-gated)
lib/sosovalue/macro.ts   macro events reader (/openapi/v1/macro/events)
lib/agent/circuit-breaker.ts   high-impact macro window evaluator (de-risk)
lib/track/compute.ts     NAV-weighted track record vs buy-and-hold baseline
lib/utils/ratelimit.ts   Redis-or-in-process limiter + single-flight lock
lib/db            Drizzle schema + postgres-js client
```

## Cross-chain funding (no testnet bridge)

The SoSoValue team confirmed there is no testnet bridge between Base and
ValueChain. The ValueChain execution wallet is funded by a SoDEX testnet
withdrawal of vUSDC to its on-chain address (`lib/sodex/client.ts:
withdrawVusdcToOnchain`, the transferAsset action with type=EVM_WITHDRAW).
Mirror Protocol is the mainnet bridge design in `lib/chain/bridge.ts`,
config-gated by `assertMainnet()` so it can never run on testnet; Wave 3 wires
the ABI. The /portfolio panel shows three real balances (Base USDC, on-chain
ValueChain vUSDC, SoDEX venue spot/perps).

## Macro circuit breaker

Pre-cycle, the runner evaluates the macro window. If a high-impact event
(CPI/FOMC/NFP/PCE/GDP/PPI by name allowlist) falls within
`SONAR_MACRO_HALT_HORIZON_HOURS`, the cycle de-risks: the prompt tells the
agent to tilt to USSI and cite the event, and a server backstop scales the
risk-gate notional caps and tilts the runner's target weights toward USSI. The
cited reason persists to `agent_runs.halt_reason` and surfaces on /signals and
/log.

## Track record and interactive demo

`/track` reads existing theses, nav_snapshots, and orders to chart Sonar's
rebalanced book versus a buy-and-hold baseline of the same indices, with
per-thesis attribution and win rate; every number links to its cited thesis.
`/api/agent/demo-run` is a rate-limited public endpoint that lets a judge
trigger a real live-testnet cycle from the dashboard without any secret on the
client.

## Wave 2 execution path

```
Agent thesis -> runner.executeAllocations + runner.executeHedges
   -> lib/sodex/executor.placeOrder(req)
       |
       +-- SONAR_EXECUTION_MODE=paper        -> lib/sodex/paper.placeOrder
       +-- live-testnet, SSI primitive      -> lib/sodex/paper.placeOrder
       +-- live-testnet, tradeable perp     -> lib/sodex/live.placeOrder
       |                                        risk.assertModeAllowed
       |                                        risk.isDust + per-order cap
       |                                        risk.enforcePerCycleCap
       |                                        deterministic clientOrderId
       |                                        DB insert as pending
       |                                        client.submitPerpOrder (EIP-712)
       |                                        poll open orders then history
       |                                        DB update fill + sodexOrderId
       |                                        paper_trades insert (re-uses
       |                                          Wave 1 position-tracking)
       +-- live-mainnet                      -> throw (disabled in Wave 2)
```

The order preview block on /signals shows each row as it transitions through
the state machine (pending -> submitted -> filled / partially_filled /
rejected / failed). The risk gate's downsize and rejection reasons surface
inline beneath the status badge.

## Data model
- `agent_runs` one row per agent cycle, model id, trace id (Langfuse, Wave 2),
  data source, ok/error.
- `theses` validated thesis payload, mode (trade vs no-trade), status.
- `signals` unpacked signals linked to a thesis, makes joins and audit easy.
  Composite PK on (thesis_id, id) because the agent reuses semantic ids
  across cycles (round 10 fix).
- `paper_trades` executed paper orders with thesis id, fill, slippage, fee.
  Live SoDEX fills also persist here so the existing position-tracking
  code path (paper_positions) keeps working unchanged across modes.
- `paper_positions` current book, mark-to-market on read.
- `orders` (Wave 2) live SoDEX orders with unique `client_order_id` for
  idempotency, `sodex_order_id` once known, status enum (pending,
  submitted, partially_filled, filled, failed, rejected), rejection_reason
  for risk-gate blocks.
- `nav_snapshots` (Wave 2) per-share NAV time series, one row per index per
  cycle, drives the Portfolio chart.

## Caching
SoSoValue responses cache in Upstash Redis with per-endpoint TTLs:
currencies 24h, news 15m, etf list 1h, etf summary history 6h. A rolling
100/min token bucket matches the High Frequency tier rate limit. Each
response is also duplicated under a `:stale` key with a longer TTL, so a
rate limit miss can fall back to stale data without breaking the agent.

## Observability
Every cycle writes structured logs via `lib/utils/logger.ts`. Wave 2 added
`startCycleTrace` which opens a real Langfuse trace per cycle, attaches the
final thesis (or error) as output, and flushes on completion. The trace id
is the agent runId itself so the /log row anchor and the Langfuse URL line
up. When the Langfuse keys are absent the tracer is a no-op and the cycle
runs untouched.

## Cross-chain (Wave 2)
The dashboard surfaces the two-chain reality on /portfolio via
`components/balance-panel.tsx`. The user side reads through wagmi
(`useReadContract` for Base USDC, `useBalance` for ValueChain testnet gas)
behind a ConnectKit modal. The agent hot wallet side reads via
`lib/chain/balances.ts` (server-side viem) so the panel still tells a
useful story for visitors who do not connect a wallet.

ValueChain testnet is configured inline because viem does not bundle it
(chainId 138565, RPC https://testnet-rpc.valuechain.xyz). The Mirror
Protocol bridge widget (Phase 5.2 in the build plan) is foundations-only
in Wave 2 because the public bridge contract addresses are not yet
documented (see `docs/mirror-bridge.md`). When that lands the widget
plugs into the same BalancePanel without rework.

## Runtime hosting
Production runs under systemd as `sonar.service` (`ops/systemd/sonar.service`),
`pnpm start` on PORT=3005, Restart=always with a 5s backoff so a single
crash does not take the URL down. nginx (`ops/nginx/sonar.conf`) terminates
TLS at https://sonar.my.id via Let's Encrypt and proxies to the local app;
the 300s read/send timeouts give an in-flight agent cycle room to complete.
The host crontab fires `/api/cron/daily` at 04:00 UTC Tue-Sat, ~8h after the US close so same-day flows have posted (the
`0 12 * * 2-6` Beijing-local line accounts for the host timezone). Postgres
runs in Docker (`sonar-pg`, restart=unless-stopped) so it also survives
VPS reboots.
