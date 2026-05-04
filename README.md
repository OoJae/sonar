# Sonar

**An ETF-flow-aware agentic hedge fund built on the SoSoValue stack.**

Sonar ingests SoSoValue's daily ETF flow data and structured news after every US
market close, has an AI agent (Xiaomi MiMo V2.5 Pro) write a dated research
thesis with inline citations, reads the SSI Protocol indices on Base for live
composition, and rebalances a paper book across MAG7.ssi, DEFI.ssi, and
MEME.ssi. Wave 1 is paper trading with a fully transparent decision log.
Wave 2 takes execution live through SoDEX on ValueChain.

> Submission for the **SoSoValue Buildathon 2026**, Wave 1
> (build window May 1 to May 12, 2026; evaluation May 13 to May 17).

---

## Why this project

The "AI hedge fund" category is famously broken. Headline launches with no
verifiable P&L, custodial flows that ask users to deposit funds with anonymous
operators, agents whose reasoning is never published. Sonar is the answer to
that, and it is the only Wave 1 entry that uses the full SoSoValue vertical
stack end to end:

- **SoSoValue Terminal** for the data signals (ETF flows, news)
- **SSI Protocol** indices on Base for composition and exposure
- **SoDEX** order shape for paper trades today, live execution in Wave 2
- **ValueChain** as the execution venue (Wave 2 bridge)

Every trade has a thesis. Every numeric claim in the thesis cites a signal id.
The agent is non-custodial by design (Wave 2 acts via scoped session approvals,
never custody). The decision log shows rejected theses next to accepted ones.

---

## What it does

| Capability | How |
|---|---|
| Pulls ETF flows + news on a daily cadence | SoSoValue REST client with Upstash Redis token-bucket (100 rpm, High Frequency tier) |
| Generates a dated, sourced research thesis | MiMo V2.5 Pro via the Anthropic-compatible relay, 8-step tool loop in [lib/agent/runner.ts](lib/agent/runner.ts) |
| Enforces citations on every numeric claim | Zod schema with `superRefine` in [lib/agent/thesis.ts](lib/agent/thesis.ts) |
| Reads SSI index composition on Base | viem multicall against the live `getTokenset()` ABI in [lib/ssi/reader.ts](lib/ssi/reader.ts) |
| Paper-trades into MAG7 / DEFI / MEME | Drizzle-backed engine in [lib/sodex/paper.ts](lib/sodex/paper.ts) shaped like a future SoDEX order |
| Refuses to act on stale data | 36-hour freshness rule baked into the system prompt |
| Surfaces every decision | Three-page dashboard: Signals, Portfolio, Log |

A live cycle on 2026-05-04 ingested 11 signals, produced a `mode = trade`
thesis, and persisted three paper trades (MAG7 +$35k, DEFI +$20k, MEME +$11.5k)
with mark-to-market positions in Postgres.

---

## Architecture

Two chains, one agent.

- **Base (chainId 8453)** holds the SSI indices. Sonar reads composition and
  total supply via viem multicall against the SSI Asset Token contracts.
- **ValueChain (chainId 286623)** hosts SoDEX execution. Wave 1 paper trades
  match the shape of live SoDEX orders so the Wave 2 swap is a one-file change.

```
                  21:30 UTC weekdays (post US ETF close)
                                  |
                                  v
                       Host crontab / Vercel Cron
                                  |
                                  v
                 GET /api/cron/daily   (CRON_SECRET gated)
                                  |
                                  v
                runAgentCycle  (lib/agent/runner.ts)
                  |             |              |
                  v             v              v
           SoSoValue       SSI reader     Paper engine
           REST client     (viem on        (Drizzle on
           (Redis cache    Base mainnet)   Postgres)
            + 100 rpm)
                  |             |              |
                  +------+------+--------+-----+
                         |               |
                         v               v
                  MiMo V2.5 Pro    Thesis validator
                  (8-step loop)    (Zod superRefine,
                                    citations enforced)
                         |
                         v
                   Persist thesis,
                   place paper orders,
                   mark to market
                         |
                         v
                   Dashboard
                   (Signals, Portfolio, Log)
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
| Observability | Langfuse-ready logger | wired, not yet connected |

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

**Wave 1 (this repo).**

- SoSoValue REST client with Redis cache + 100 rpm token bucket
- MiMo V2.5 Pro agent runner with citation-enforced theses
- SSI Protocol on-chain reader (composition only)
- Drizzle-backed paper trading engine with mark-to-market
- Three dashboards: Signals, Portfolio, Log
- MCP server stubs for SoSoValue, SSI, SoDEX
- Cron-driven daily cycle (21:30 UTC weekdays, post US ETF close)
- Apache 2.0 license

**Wave 2 (planned).**

- Live SoDEX execution (one-file swap from `paper.ts` to `client.ts`)
- ValueChain bridging from Base
- Risk engine: VaR, drawdown caps, correlation limits
- SSI NAV computation via oracle (sum of `amount * priceUSD` per share)
- Custom SSI index proposals
- Production observability and alerting (Langfuse + Discord)

See [docs/wave-changelog.md](docs/wave-changelog.md) for the explicit
deliverables ledger.

---

## Demo

- **Live URL:** http://43.153.109.3:8080 (VPS dev preview, Wave 1)
- **Vercel deployment:** TBD before final submission
- **Demo video:** TBD (3-minute walkthrough; see [docs/demo-script.md](docs/demo-script.md) for the storyboard)

Screenshots will land in [public/demo-assets/](public/demo-assets/) ahead of
submission.

---

## Documentation

| Doc | Purpose |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Two-chain split, stack rationale, runtime diagram |
| [docs/api-integration.md](docs/api-integration.md) | SoSoValue endpoints, casing quirks, MiMo relay setup |
| [docs/thesis-schema.md](docs/thesis-schema.md) | The structured object the agent emits, with validation rules |
| [docs/wave-changelog.md](docs/wave-changelog.md) | Explicit Wave 1 deliverables ledger |
| [docs/demo-script.md](docs/demo-script.md) | 3-minute walkthrough plan |

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
