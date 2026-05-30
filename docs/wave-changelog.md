# Wave changelog

## Wave 1 (May 1 to May 12, 2026)

### Shipped
- SoSoValue REST client with per-endpoint cache TTLs and a 100/min token
  bucket on the High Frequency tier
- Fixture mode (`SONAR_DATA_SOURCE=fixture`) so the agent runs without a key
- SSI Protocol reader on Base via viem multicall for MAG7, DEFI, MEME, USSI,
  using the live `getTokenset()` interface for on-chain composition
- Paper trading engine with mark-to-market, persisted via Drizzle
- Thin SoDEX live client (spot pair listing, health probe) for bonus credit
- Thesis Zod schema with citation enforcement and validator rejection path
- Agent runner wiring Vercel AI SDK + `mimo-v2.5-pro` (Xiaomi MiMo, via the
  Anthropic-compatible endpoint at `https://token-plan-sgp.xiaomimimo.com/anthropic/v1`)
- Three MCP servers (sosovalue, sodex, ssi) over stdio
- Dashboard: Signals, Portfolio, Log. Dark navy + gold financial-terminal
  aesthetic. Custom SVG ETF flow bars (Recharts replaced for SSR/hydration
  reasons on Next 16 + React 19).
- Inline numbered citations on /signals that link to article URLs (news) or
  show tooltips (ETF flows), with a Sources block below the prose
- /portfolio Thesis chips show date + mode and deep-link to `/log#run-<id>`
- Host crontab daily trigger at 21:30 UTC weekdays, protected by
  `CRON_SECRET` (vercel.json retained for a future Vercel deploy)
- Production env-boot guard: refuses to start in `NODE_ENV=production`
  without `CRON_SECRET` set
- Structured logger with Langfuse-ready hook (publish is a no-op until
  Wave 2)

### Outstanding for Wave 1
- Record demo video (max 3 minutes)
- Optional: deploy to Vercel and publish live URL

## Wave 2 (May 26 to June 7, 2026)

### Shipped

**Live SoDEX testnet execution (the headline).**
- EIP-712 signed orders via viem `signTypedData`. Three SoDEX-specific
  protocol details discovered and documented in `docs/sodex-live.md`: the
  v-byte recovery normalization (viem returns 27/28, the engine expects
  0/1); the clOrdID format constraint (raw keccak hex is rejected, must
  match a `sonar-<16 hex>` alphanumeric pattern); the two-layer error
  envelope (top-level `code` AND per-order `data[*].code`).
- `lib/sodex/executor.ts` routes `placeOrder` by `SONAR_EXECUTION_MODE`.
  Paper mode unchanged. Live-testnet places real signed orders. SSI
  primitives (MAG7.ssi etc.) route to paper even in live mode because
  they are not SoDEX listings; perp hedges fire live.
- `lib/sodex/live.ts` implements the full flow: deterministic clOrdID,
  pending row insert, risk gate, signed submit, poll open orders, fall
  back to orders-history for IOC fills, reuse the Wave 1 position
  tracking. Real BTC-PERP and SOL-PERP fills recorded on testnet
  (sodexOrderId surfaces on /signals via the order preview UI).
- `lib/sodex/risk.ts`: dust floor, per-order cap (downsizes), per-cycle
  cap (blocks). Mode gate refuses live-mainnet defence-in-depth even past
  the env boot guard. 16/16 risk smoke (`scripts/sodex-risk-smoke.ts`).
- `lib/sodex/client.ts` also exposes the spot-to-perps transferAsset
  signed action (`transferSpotToPerps`) because testnet faucets fund spot
  only; `scripts/sodex-fund-perps.ts` is the one-shot helper.

**NAV computation.**
- `lib/prices/`: SoSoValue per-currency market snapshot wrapper with the
  symbol-to-currency-id resolver. Pre-prep B3 verified 27/27 underlying
  token coverage; no fallback price source needed.
- `lib/ssi/nav.ts`: per-share NAV from on-chain tokenset times USD prices.
  Wave 1 reference prices in `lib/sodex/paper.ts` were placeholders; real
  per-share NAVs are sub-dollar (each share holds a tiny fractional
  position in each underlying). Hand-verified via the BTC backing math
  in `scripts/nav-smoke.ts`.
- `nav_snapshots` rows persist per index per cycle. `components/nav-chart.tsx`
  is a pure-SVG line chart per index (reuses the Recharts-replacement
  pattern from Wave 1) with a dashed inception reference line. Latest
  NAV and percentage-from-inception render in the per-index header.

**Freshness rollup fix.**
- `lib/agent/runner.ts:fetchDataFreshness` pre-fetches the most recent ETF
  history date across BTC, ETH, SOL before invoking the model and injects
  a "Data freshness (UTC)" line into the user prompt.
- Prompt rule #2 rewritten in `lib/agent/prompts.ts` to grade against the
  injected field rather than per-signal dates, closing the round 7 gap
  where 7-day rollup signals could not be freshness-checked.

**Langfuse cycle traces.**
- `lib/utils/logger.ts:startCycleTrace` opens a real Langfuse trace keyed
  by runId so /log row anchors and trace URLs match. Per-cycle output
  (thesis id, mode, headline snippet, signal counts) flushed on success;
  errors flushed on failure.
- /log restored the Trace column dropped in round 9, linking each row to
  `${LANGFUSE_BASE_URL}/trace/{trace_id}`.

**Cross-chain awareness.**
- `lib/chain/balances.ts` reads the agent hot wallet's Base USDC balance
  server-side. ValueChain testnet USDC awaits the Mirror Protocol
  contract address answer (see `docs/mirror-bridge.md` open question).
- `app/providers.tsx` ships wagmi v2 + ConnectKit + React Query with Base
  + ValueChain testnet (chainId 138565, RPC https://testnet-rpc.valuechain.xyz
  discovered by probe) so the user can connect to read their own USDC on
  Base and native gas on ValueChain testnet.
- `components/balance-panel.tsx` mounts on /portfolio with both wallets
  side by side and the ConnectKit button inline.

**Operational hardening.**
- `ops/systemd/sonar.service` runs the production build under systemd
  (Restart=always, 5s backoff, 60s graceful stop, journal logging,
  EnvironmentFile=.env.local, PATH includes nvm bin so pnpm finds node).
- `ops/nginx/sonar.conf` commits the nginx vhost (TLS via certbot, 300s
  read/send timeouts for in-flight agent cycles). Install + transition
  verified end to end; https://sonar.my.id survives `systemctl restart`.

**Cross-chain funding pivot (no testnet bridge).** The SoSoValue team confirmed
on Discord there is no testnet bridge between Base and ValueChain. The Wave 2
funding path is a SoDEX testnet withdrawal of vUSDC to the on-chain ValueChain
address (`lib/sodex/client.ts:withdrawVusdcToOnchain`, the transferAsset action
with type=EVM_WITHDRAW). The three-balance panel on /portfolio (Base USDC,
on-chain ValueChain vUSDC, SoDEX venue spot/perps) is real. Mirror Protocol is
demoted to a config-gated mainnet design (`lib/chain/bridge.ts`), never run on
testnet. Honest caveat: the programmatic withdrawal destination constant is not
publicly documented (the SoDEX SDK directs on-chain withdrawals through the web
UI), so the testnet withdrawal is a dashboard operation; the client method flips
to working when the constant is confirmed. See `docs/mirror-bridge.md`.

**Verifiable track-record page (`/track`).** The centerpiece, and the artifact
no other AI-fund project can show. Computed entirely from existing data
(`lib/track/compute.ts`): cumulative NAV-weighted return of Sonar's rebalanced
book versus a buy-and-hold baseline of the same index universe, per-thesis P&L
attribution, and win rate, all since inception. Pure-SVG two-line chart
(`components/track-chart.tsx`). Every row links to the dated, cited thesis that
produced it. Honest "paper plus testnet during the buildathon" framing; the
credibility is the verifiability.

**Macro circuit breaker.** Using SoSoValue's `/openapi/v1/macro/events`
(`lib/sosovalue/macro.ts`, documented in `docs/sosovalue-macro.md`), the agent
auto-de-risks when a high-impact event (CPI, FOMC, NFP, PCE, GDP, PPI by name
allowlist) falls within `SONAR_MACRO_HALT_HORIZON_HOURS`
(`lib/agent/circuit-breaker.ts`). Two enforcement points: the prompt (the agent
cites the event and tilts to USSI) and a server backstop (the risk gate scales
notional caps, the runner tilts target weights toward USSI). The cited reason
persists to `agent_runs.halt_reason`; /signals shows a breaker banner and /log a
de-risk chip. Verified end to end on a real upcoming CPI print.

**Interactive run-a-cycle demo.** A rate-limited public endpoint
(`app/api/agent/demo-run`, `lib/utils/ratelimit.ts`) lets a judge trigger a
real live-testnet cycle from the dashboard ("Run a cycle now" on /signals) and
watch the agent reason and execute. Hard global plus per-IP budget from
`SONAR_PUBLIC_RUN_RATELIMIT`, a single-flight lock, and no secret ever reaches
the client. The existing risk caps bound what a stranger can trigger.

### Carried forward to Wave 3

- Live Mirror Protocol mainnet bridge (the ABI wiring; `lib/chain/bridge.ts`
  carries the config-gated design). Live mainnet execution behind the gated
  flag.
- Production risk engine (VaR, drawdown caps, correlation limits). Wave 2
  ships flat notional caps plus the macro circuit breaker.
- Custom SSI index proposals and the delta-neutral USSI multi-strategy module.
- Scoped session-key delegation (Wave 2 uses a server-side hot wallet for
  the executor; the user-facing wallet connect is read-only on Wave 2).
- Public read-only landing for non-wallet visitors. Mobile UX polish.
