# Sonar

**An ETF-flow-aware agentic hedge fund built on the SoSoValue stack.**

Live at **[https://sonar.my.id](https://sonar.my.id)**. Demo walkthrough: **[youtu.be/0vPra6lpzkQ](https://youtu.be/0vPra6lpzkQ)**.

Sonar ingests SoSoValue's daily ETF flow data and structured news after every US
market close, has an AI agent (Xiaomi MiMo V2.5 Pro) write a dated research
thesis with inline citations, reads the SSI Protocol indices on Base for live
composition, and rebalances a paper book across MAG7.ssi, DEFI.ssi, and
MEME.ssi. **Wave 2 turns perp hedges live on SoDEX testnet** with EIP-712
signed orders, deterministic-clOrdID idempotency, a risk gate that downsizes
and blocks per cap, a per-share NAV chart computed from live on-chain
tokensets and SoSoValue prices, and Langfuse traces linked from the
decision log.


---

## Why this project

The "AI hedge fund" category is famously broken. Headline launches with no
verifiable P&L, custodial flows that ask users to deposit funds with anonymous
operators, agents whose reasoning is never published. Sonar is the answer to
that, and it is the only Wave 1 entry that uses the full SoSoValue vertical
stack end to end:

- **SoSoValue Terminal** for the data signals (ETF flows, news, per-currency prices for NAV)
- **SSI Protocol** indices on Base for composition and per-share NAV
- **SoDEX** testnet perps for the agent's hedges (Wave 2 live; EIP-712 signed)
- **ValueChain** testnet as the execution venue and second balance surface

Every trade has a thesis. Every numeric claim in the thesis cites a signal id.
The agent is non-custodial by design (Wave 2 acts via scoped session approvals,
never custody). The decision log shows rejected theses next to accepted ones.

---

## What it does

| Capability | How |
|---|---|
| Pulls ETF flows + news on a daily cadence | SoSoValue REST client with Upstash Redis token-bucket (100 rpm, High Frequency tier) |
| Generates a dated, sourced research thesis | MiMo V2.5 Pro via the Anthropic-compatible relay, 16-step tool loop in [lib/agent/runner.ts](lib/agent/runner.ts) |
| Enforces citations on every numeric claim | Zod schema with `superRefine` in [lib/agent/thesis.ts](lib/agent/thesis.ts) |
| Reads SSI index composition on Base | viem multicall against the live `getTokenset()` ABI in [lib/ssi/reader.ts](lib/ssi/reader.ts) |
| Computes per-share NAV from on-chain composition | [lib/ssi/nav.ts](lib/ssi/nav.ts) prices each token via [lib/prices/](lib/prices/) against SoSoValue's market-snapshot endpoint |
| Charts NAV vs inception on /portfolio | Pure-SVG line chart in [components/nav-chart.tsx](components/nav-chart.tsx); snapshots persist per index per cycle |
| Places signed perp orders on SoDEX testnet | EIP-712 typed-data signing via viem in [lib/sodex/client.ts](lib/sodex/client.ts); idempotent client-order-id and risk-gate caps in [lib/sodex/live.ts](lib/sodex/live.ts) and [lib/sodex/risk.ts](lib/sodex/risk.ts) |
| Surfaces every wire-side order | Per-thesis order preview block on /signals with status badges (pending, submitted, filled, rejected) and the SoDEX system order id |
| Shows a verifiable track record | [/track](app/(dashboard)/track/page.tsx) charts Sonar's NAV-weighted rebalanced book versus a buy-and-hold baseline, with per-thesis attribution and win rate; every number links to the cited thesis. Computed from existing data in [lib/track/compute.ts](lib/track/compute.ts) |
| De-risks around macro events | Macro circuit breaker reads SoSoValue [/openapi/v1/macro/events](docs/sosovalue-macro.md); a high-impact window (CPI, FOMC, NFP) caps notional and tilts to USSI ([lib/agent/circuit-breaker.ts](lib/agent/circuit-breaker.ts)), cited in the thesis and persisted to `agent_runs.halt_reason` |
| Lets a judge run a live cycle | Rate-limited public [Run a cycle now](app/api/agent/demo-run/route.ts) control on /signals; no secret reaches the client |
| Funds the ValueChain wallet | SoDEX testnet withdrawal path (no testnet bridge exists); three-balance cross-chain panel in [components/balance-panel.tsx](components/balance-panel.tsx). Mirror Protocol is the mainnet bridge design ([lib/chain/bridge.ts](lib/chain/bridge.ts)) |
| Publishes per-cycle traces | Real Langfuse trace per run, linked from /log |
| Refuses to act on stale data | Runner pre-fetches a `dataFreshness` value before the cycle and injects it into the prompt; rule #2 grades against the injected field |
| Surfaces every decision | Four-page dashboard: Signals, Portfolio, Track, Log |

A live cycle in Wave 2 (runId `b9e5ed8f`) produced three paper SSI trades
and one signed SOL-PERP fill on SoDEX testnet, with the agent's $50k hedge
notional downsized to $500 by the risk gate. SOL-USD position 2533914 is
open at the testnet at $82.65 entry. BTC-USD position from the
idempotency smoke is open at $73,700.

---

## Architecture

Two chains, one agent.

- **Base (chainId 8453)** holds the SSI indices. Sonar reads composition and
  total supply via viem multicall against the SSI Asset Token contracts.
- **ValueChain (chainId 286623 mainnet, 138565 testnet)** hosts SoDEX
  execution. Wave 2 places EIP-712 signed perp orders on testnet through
  the executor facade; the kill switch is one env var
  (`SONAR_EXECUTION_MODE=paper`).

```
                  04:00 UTC, post US ETF close
                                  |
                                  v
                            Host crontab
                                  |
                                  v
                 GET /api/cron/daily   (CRON_SECRET gated)
                                  |
                                  v
                runAgentCycle  (lib/agent/runner.ts)
                  |             |              |             |
                  v             v              v             v
           SoSoValue       SSI reader     Executor       Langfuse
           REST client     + nav.ts       facade         trace
           (Redis cache    (viem on       (paper or
            + 100 rpm)     Base mainnet)   live testnet)
                  |             |              |             |
                  +------+------+--------+-----+             |
                         |               |                   |
                         v               v                   |
                  MiMo V2.5 Pro    Thesis validator           |
                  (16-step loop)   (Zod superRefine,          |
                                    citations enforced)      |
                         |                                    |
                         v                                    |
                   Persist thesis,                            |
                   compute NAV snapshot,                      |
                   place orders (paper or                     |
                   EIP-712 signed via SoDEX                   |
                   testnet through risk gate),               |
                   mark to market                            |
                         |                                    |
                         +---------------> trace.update() ----+
                         |                                    |
                         v                                    v
                   Dashboard                            Langfuse
                   (Signals + order preview,            cloud
                    Portfolio + NAV chart +             (trace links
                    cross-chain balances,                from /log)
                    Log + Trace column)
```

For the longer write-up see [docs/architecture.md](docs/architecture.md).

---

## Tech stack

| Layer | Choice | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.4 |
| Runtime | React | 19.2.4 |
| Agent SDK | Vercel AI SDK | 6.0.168 |
| LLM | Xiaomi MiMo V2.5 Pro (`mimo-v2.5-pro`) | via `@ai-sdk/anthropic` 3.0.71 against the MiMo Anthropic-compatible relay |
| Tool protocol | Model Context Protocol | `@modelcontextprotocol/sdk` 1.29.0 |
| ORM | Drizzle | 0.45.2 |
| DB | Postgres (local Docker in dev, Supabase-ready) | postgres-js 3.4.9 |
| Cache + rate limit | Upstash Redis | 1.37.0 |
| Chain reads | viem on Base | 2.48.4 |
| Validation | Zod | 4.3.6 |
| Styling | Tailwind v4 + shadcn/ui (base-nova preset) | 4.x |
| Charts | Custom SVG (Recharts retained as a dep) | n/a |
| Observability | Langfuse cycle traces | `langfuse` 3.x |
| Wallet stack (Wave 2) | wagmi + ConnectKit + React Query | wagmi 2.x, connectkit 1.x |
| Process supervisor | systemd (`ops/systemd/sonar.service`) | n/a |

---

## Quick start

```bash
git clone https://github.com/OoJae/sonar.git
cd sonar

pnpm install
cp .env.example .env.local            # fill in the keys you have
pnpm verify:env                       # confirms which vars are populated

pnpm db:push                          # apply Drizzle schema (needs DATABASE_URL)
pnpm seed                             # optional: insert a demo thesis + trades
pnpm dev                              # http://localhost:3000
```

Trigger a manual agent cycle:

```bash
# without CRON_SECRET set (local dev)
curl -X POST http://localhost:3000/api/agent/run

# with CRON_SECRET set (production)
curl -X POST http://localhost:3000/api/agent/run \
  -H "Authorization: Bearer $CRON_SECRET"
```

Dev tips:

- The agent runs on fixtures when `SONAR_DATA_SOURCE=fixture`, so the dashboard
  works without a SoSoValue key. Flip to `live` once the key is provisioned.
- For a one-shot SSI reader test against Base mainnet:
  `pnpm tsx scripts/ssi-smoke.ts`.

### Running Postgres locally

The repo expects Postgres on `DATABASE_URL`. The fastest path is Docker:

```bash
docker run -d --name sonar-pg --restart unless-stopped \
  -e POSTGRES_USER=sonar -e POSTGRES_PASSWORD=sonar_dev -e POSTGRES_DB=sonar \
  -p 5433:5432 -v sonar-pg-data:/var/lib/postgresql/data postgres:16-alpine

# then add to .env.local
DATABASE_URL=postgres://sonar:sonar_dev@localhost:5433/sonar
```

Supabase or Neon also work, no code changes needed.

---

## Project structure

```
sonar/
├── app/                              # Next.js App Router
│   ├── page.tsx                      # landing
│   ├── (dashboard)/
│   │   ├── signals/page.tsx          # live thesis + ETF flow charts
│   │   ├── portfolio/page.tsx        # paper book + P&L
│   │   └── log/page.tsx              # transparent decision log
│   └── api/
│       ├── agent/run/route.ts        # POST: trigger an agent cycle
│       ├── signals/route.ts          # GET: latest thesis
│       ├── portfolio/route.ts        # GET: paper book state
│       └── cron/daily/route.ts       # GET: cron entry, CRON_SECRET gated
├── lib/
│   ├── agent/                        # thesis schema, prompts, tools, runner
│   ├── sosovalue/                    # REST client, cache, fixtures, normalize
│   ├── ssi/                          # Base reader, addresses, ABI fragment
│   ├── sodex/                        # paper engine, types, thin live stub
│   ├── db/                           # Drizzle schema and client
│   └── utils/                        # Zod-validated env, logger
├── components/                       # UI: nav, cards, custom SVG flow chart
├── mcp-servers/                      # MCP servers wrapping SoSoValue, SSI, SoDEX
├── docs/                             # architecture, API integration, schema, demo
├── scripts/                          # verify-env, seed, ssi-smoke
├── public/demo-assets/               # screenshots and video thumbnails
├── .env.example                      # documented env contract
└── drizzle.config.ts
```

Annotated key files:

| Path | Role |
|---|---|
| [lib/agent/thesis.ts](lib/agent/thesis.ts) | Zod thesis schema and validator (citations, weight sums, signal-id resolution) |
| [lib/agent/prompts.ts](lib/agent/prompts.ts) | System prompt, freshness rule, allocation sizing convention |
| [lib/agent/tools.ts](lib/agent/tools.ts) | The 7 tools the agent can call (SoSoValue, SSI, paper book, submitThesis) |
| [lib/agent/runner.ts](lib/agent/runner.ts) | 8-step agent loop, MiMo invocation, persistence |
| [lib/sosovalue/client.ts](lib/sosovalue/client.ts) | REST client over `/openapi/v1/*` |
| [lib/sosovalue/cache.ts](lib/sosovalue/cache.ts) | Redis cache + 100 rpm token bucket |
| [lib/ssi/reader.ts](lib/ssi/reader.ts) | viem multicall reader for MAG7/DEFI/MEME/USSI |
| [lib/sodex/paper.ts](lib/sodex/paper.ts) | Paper trading engine, mark-to-market |
| [app/(dashboard)/signals/page.tsx](app/(dashboard)/signals/page.tsx) | Live thesis view |
| [app/(dashboard)/portfolio/page.tsx](app/(dashboard)/portfolio/page.tsx) | Paper book and P&L |
| [app/(dashboard)/log/page.tsx](app/(dashboard)/log/page.tsx) | Transparent decision log |

---

## Environment variables

All env vars are loaded and validated by [lib/utils/env.ts](lib/utils/env.ts).
See [.env.example](.env.example) for the full contract; the minimum set for a
live run is:

| Variable | Required | Source |
|---|---|---|
| `MIMO_API_KEY` | yes | https://platform.xiaomimimo.com (Console > API Keys) |
| `MIMO_BASE_URL` | yes (defaulted) | `https://token-plan-sgp.xiaomimimo.com/anthropic/v1` |
| `SOSOVALUE_API_KEY` | only if `SONAR_DATA_SOURCE=live` | SoSoValue Buildathon team |
| `SONAR_DATA_SOURCE` | yes | `fixture` (default) or `live` |
| `DATABASE_URL` | yes | Supabase, Neon, or local Docker Postgres |
| `DIRECT_URL` | yes for migrations | same Postgres direct URL |
| `UPSTASH_REDIS_REST_URL` | recommended | Upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | recommended | Upstash console |
| `BASE_RPC_URL` | yes (defaulted) | `https://mainnet.base.org` |
| `VALUECHAIN_RPC_URL` | yes (defaulted) | `https://rpc.valuechain.xyz` |
| `CRON_SECRET` | required in prod | `openssl rand -hex 24` |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | optional | https://cloud.langfuse.com |

`.env.local` is gitignored. **Never commit real keys.**

---

## How the agent works

A single cycle of [runAgentCycle](lib/agent/runner.ts) runs eight steps:

1. Cron triggers `GET /api/cron/daily` (or a manual `POST /api/agent/run`).
2. Pull fresh ETF flows and news through the SoSoValue MCP-shaped tools.
3. Read current SSI composition (MAG7 / DEFI / MEME / USSI) from Base.
4. Read current paper positions from Postgres.
5. Invoke MiMo V2.5 Pro with the system prompt and tool set; the model is told
   to produce one thesis object.
6. Validate the thesis against the Zod schema. If validation fails, retry
   once. The validator enforces:
   - Every numeric token in `reasoning` has at least one `[ref:<id>]` citation
   - Every `[ref:<id>]` resolves to a signal in the same thesis
   - `proposedAllocations[].targetWeight` sums to at most 1
   - `riskNotes` is non-empty
7. Persist the thesis, override the LLM-generated UUID with a fresh one, and
   compute paper orders by `bookSize * targetWeight - currentMarketUSD` with a
   $10 dust threshold.
8. Mark positions to market, log the cycle, optionally trace to Langfuse.

Full schema in [docs/thesis-schema.md](docs/thesis-schema.md).

The agent is held to one hard rule: if the latest ETF flow datum is older than
36 hours, output a `no-trade` thesis with a reason. Verified live on
2026-05-02; the rule fires automatically over the weekend, when the most
recent US ETF close is more than 36 hours stale.

---

## Wave 1 vs Wave 2

**Wave 1.**

- SoSoValue REST client with Redis cache + 100 rpm token bucket
- MiMo V2.5 Pro agent runner with citation-enforced theses
- SSI Protocol on-chain reader (composition)
- Drizzle-backed paper trading engine with mark-to-market
- Three dashboards: Signals, Portfolio, Log
- MCP server stubs for SoSoValue, SSI, SoDEX
- Cron-driven daily cycle (04:00 UTC, ~8h after each weekday US close)
- Apache 2.0 license

**Wave 2 (shipped).**

- **Live SoDEX testnet execution.** EIP-712 signed orders via viem; the
  executor facade routes paper/live-testnet/live-mainnet by env. SSI
  primitives route to paper even in live mode (they are not SoDEX
  listings); perp hedges fire live with deterministic clOrdID for
  idempotency. Five non-obvious protocol details discovered and
  documented in `docs/sodex-live.md`.
- **Risk gate.** Per-order downsize, per-cycle cap, dust floor, mode
  gate. 16/16 standalone smoke (`scripts/sodex-risk-smoke.ts`). Surfaces
  rejection reasons on /signals next to the order status badge.
- **NAV computation.** Off-chain sum of `amount * priceUSD` per share.
  Per-currency prices via SoSoValue's market-snapshot endpoint.
  `nav_snapshots` persist per cycle. Pure-SVG line chart on /portfolio
  with a dashed inception reference. 27/27 underlying tokens covered.
- **Freshness rollup fix.** Runner pre-fetches the most recent ETF
  history date across BTC/ETH/SOL and injects it as a `dataFreshness`
  line into the prompt; rule #2 grades against it.
- **Langfuse cycle traces.** Real trace per run keyed by runId; /log
  links to `${LANGFUSE_BASE_URL}/trace/{trace_id}`.
- **Cross-chain funding.** No testnet bridge exists (confirmed with the
  SoSoValue team), so the ValueChain wallet is funded by a SoDEX testnet
  withdrawal. Three-balance panel on /portfolio (Base USDC, on-chain
  ValueChain vUSDC, SoDEX venue spot/perps). Mirror Protocol is the
  config-gated mainnet bridge design. wagmi v2 + ConnectKit lets the user
  read their own balances.
- **Verifiable track record (`/track`).** Cumulative NAV-weighted return
  versus a buy-and-hold baseline, per-thesis attribution, win rate, every
  number linking to its cited thesis. The artifact no other AI fund shows.
- **Macro circuit breaker.** SoSoValue macro events drive an auto-de-risk
  (cap + USSI tilt) when a high-impact window (CPI, FOMC) is near. Cited
  and persisted to `agent_runs.halt_reason`; banner on /signals.
- **Interactive run-a-cycle demo.** A rate-limited public control triggers
  a real live-testnet cycle from the dashboard; no secret on the client.
- **Langfuse cycle traces.** Real trace per run keyed by runId; /log
  links to `${LANGFUSE_BASE_URL}/trace/{trace_id}`.
- **systemd hardening.** Production build under `sonar.service` with
  Restart=always and 60s graceful stop. nginx vhost committed to repo.
  https://sonar.my.id survives `systemctl restart`.

**Wave 3, shipped.**

- **Production risk engine (`/risk`).** Historical VaR, max/current drawdown
  with an automatic de-risk cap, index correlation matrix, exposure and
  concentration; composed with the macro breaker.
- **Multi-strategy book.** A rules-based delta-neutral carry (long MAG7
  basket, short a BTC perp sized to the basket's BTC weight) runs beside the
  directional strategy with its own isolated book and its own `/track` curve.
- **Session-key delegation (`/delegation`).** A user signs a scoped,
  expiring, revocable EIP-712 grant (markets + max notional) enforced by the
  executor before every order. App-level enforcement, honestly labeled.
- **Custom SSI index proposals (`/proposals`).** Anyone gives the agent a
  theme; it designs a priced, cited index basket, and every proposal accrues
  a daily forward test from creation (the arena leaderboard).

**Product surface (post-Wave-3).**

- **Public API v1 + hosted MCP.** Every receipt on the dashboard is
  consumable as JSON and as MCP tools; see the [/docs](https://sonar.my.id/docs)
  page. `claude mcp add --transport http sonar https://sonar.my.id/api/mcp`
- **Telegram notifications.** A channel + subscribe bot deliver the daily
  cycle summary and new proposals (ships dark until credentials are set).

**Mainnet carry-over.** Live Mirror Protocol bridge + mainnet execution stay
demonstrable designs (`lib/chain/bridge.ts`), not live capital.

See [docs/wave-changelog.md](docs/wave-changelog.md) for the full
deliverables ledger.


## Use Sonar (API, MCP, Telegram)

The dashboard is one consumer of Sonar's data; everything it renders is public:

```bash
# REST API v1 (public, read-only, rate limited, CORS open)
curl -s https://sonar.my.id/api/v1/thesis/latest | jq .data.thesis.reasoning
curl -s https://sonar.my.id/api/v1/track | jq .data.bookReturnPct
curl -s https://sonar.my.id/api/v1/status | jq .data
```

```bash
# MCP for AI agents (hosted, zero install)
claude mcp add --transport http sonar https://sonar.my.id/api/mcp
# or local stdio from this repo
claude mcp add --transport stdio sonar -- npx tsx mcp-servers/sonar/index.ts
```

Telegram: the bot posts each cycle's summary (mode, allocations, fills, risk
state) to the public channel, and users can DM /start for direct pushes. See
[/docs](https://sonar.my.id/docs) for the full endpoint table.

## Documentation

| Doc | Purpose |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Two-chain split, stack rationale, runtime diagram, Wave 2 execution path |
| [docs/api-integration.md](docs/api-integration.md) | SoSoValue endpoints + SoDEX live signing + Langfuse + viem chain config |
| [docs/sodex-live.md](docs/sodex-live.md) | SoDEX testnet wire reference (auth, EIP-712, order shape, polling, all five non-obvious gotchas with reproducers) |
| [docs/price-coverage.md](docs/price-coverage.md) | 27/27 coverage table from pre-prep B3 |
| [docs/mirror-bridge.md](docs/mirror-bridge.md) | Mirror Protocol bridge discovery; open Discord question and fallback strategy |
| [docs/thesis-schema.md](docs/thesis-schema.md) | The structured object the agent emits, with validation rules |
| [docs/wave-changelog.md](docs/wave-changelog.md) | Wave 1 + Wave 2 deliverables ledger |
| [docs/demo-script.md](docs/demo-script.md) | 3-minute walkthrough plan |
| [ops/systemd/sonar.service](ops/systemd/sonar.service) | Production systemd unit |
| [ops/nginx/sonar.conf](ops/nginx/sonar.conf) | nginx vhost (TLS via certbot) |

---

## Conventions

- Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`); no
  `any` without a comment justifying it.
- Zod at every data boundary (env, external API, agent output, form input).
- All third-party calls go through `app/api/*` route handlers; no client-side
  API keys, ever.
- ISO 8601 UTC timestamps in storage; localize only at render.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).

---

## License

[Apache 2.0](LICENSE).

---

## Acknowledgments

Built on the SoSoValue Terminal, SSI Protocol, SoDEX, and ValueChain stack.
Powered by Xiaomi MiMo V2.5 Pro via the Vercel AI SDK.
