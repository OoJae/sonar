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
- Host crontab daily trigger at 04:00 UTC Tue-Sat, protected by
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
  (Superseded in Wave 3: the unconditional live-mainnet refusal was
  removed when the gated mainnet path landed, a fourth layer of position
  caps was added, and the smoke grew to 26. See the Wave 3 section.)
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

---

## Wave 3 (June to July 2026)

### Shipped

**A live-mainnet path that a human has to approve.** `SONAR_EXECUTION_MODE`
gains a real third mode. On `live-mainnet` the daily cycle CANNOT submit an
order: it runs the full risk gate, records the risk-capped order as
`pending_approval`, and stops. Only the bearer-gated
`POST /api/orders/approve` places it, and that route's atomic claim is the only
writer that can move a row out of the queue. `POST /api/orders/reconcile` repairs
drift and never submits. Every caller inherits this for free (cron,
`/api/agent/run`, and the public demo trigger all funnel through the executor
facade), and the public trigger is additionally disabled on mainnet so a stranger
cannot stuff the operator's approval queue. 19/19 smoke
(`scripts/sodex-approval-smoke.ts`), which asserts, among other things, that a
$100,000 agent hedge is recorded as the $500 per-order cap.

**Status: implemented and smoke-tested, never exercised against the live venue.**
No mainnet key is registered and no mainnet order has been placed. Not live
capital.

**Mode-aware SoDEX auth.** `sodexChain()` is now the single place the venue is
decided: mainnet uses chainId 286623, the mainnet gateway, and the documented
`X-API-Key` + `X-API-Chain` header pair, signing writes with a SEPARATE
registered keypair while the master wallet stays the account owner and only
registers that key (`registerApiKey`, `scripts/sodex-mainnet-register.ts`). A
leaked write key is therefore master-revocable. The testnet path is byte-for-byte
unchanged and was proven so.

**Two real bugs found by running the thing, not by reading it.**

1. *The risk gate bounded the flow but not the book.* The per-order ($500) and
   per-cycle ($2,000) caps were doing their jobs, and that was the problem: the
   agent hedges the same direction most days, so 32 individually-legal sells
   compounded into a 0.234 BTC short, about $14.8k notional at 20x on a $1.5k
   account. Margin exhausted; every order failed for two days. Added risk.ts
   layer 4: per-market and gross position caps
   (`SONAR_MAX_POSITION_NOTIONAL_USD`, `SONAR_MAX_GROSS_EXPOSURE_USD`) that read
   the VENUE as authoritative, never gate a reducing order, and downsize to the
   remaining headroom rather than rejecting. Risk smoke 26/26.
2. *`reduceOnly` was hardcoded false, so the book could not be unwound.* With it
   false the engine margins a closing order as NEW exposure, so at the margin
   limit even a close is rejected and the position is inescapable. Found by
   trying to flatten and being refused. Threaded through `submitPerpOrder` and
   through the approve path, so an approved close is a real close.

**The venue does not deduplicate clOrdID.** `docs/sodex-live.md` had recorded, as
UNCONFIRMED since May, that the server "should return the existing order" on a
repeated key. It does not: the same key submitted twice created two distinct
orders and both filled (`scripts/sodex-clordid-dedupe-probe.ts`). Our DB
idempotency and the approval gate's atomic claim are therefore the only
protection against a double-place, which is why the approve route has no
"resume" path.

**The Mirror bridge stayed honest instead of getting faked.** The plan called for
implementing `buildBridgeTx` behind the address env vars. Reversed: no Mirror
address, ABI, signature or docs link exists, so it would have meant inventing
calldata for a fund-moving contract with nothing to probe. It also fixed a real
defect: `isBridgeAvailable()` returned true once the two addresses were set, so
configuring them would have reported the bridge available while `buildBridgeTx`
still threw. The ABI is the binding constraint; availability now says so, and
`scripts/bridge-dormant-smoke.ts` (8/8) proves setting the addresses does not
flip it.

**Claims corrected.** An audit of the published copy against the code found the
site both under-claiming and over-claiming. "Every number traces to a cited
thesis, a logged run, or an on-chain fill" was false: there is no on-chain write
path in Sonar at all (`txRef` is the SoDEX order id), so SSI legs are simulated
in every mode and the honest phrase is "a signed venue fill". Three surfaces
claimed the caps bound "everything"/"every cycle" while the gate only governs
orders that reach the venue. `/portfolio` claimed the mode badge was "the only
thing that changes between paper and live", which the approval gate falsified.
`/risk` listed VaR confidence as a limit though nothing gates on VaR. README
claimed positions were open that had been closed. All corrected; `/risk` now
lists the position caps and the approval gate.

### Not shipped, and why

- **The Mirror Protocol bridge.** Undocumented to us; see above and
  `docs/mirror-bridge.md` section 8.
- **On-chain SSI index creation and on-chain grant enforcement.** Still designs.
  Delegation is enforced at the application layer and labeled as such.
- **VaR / correlation as enforced limits.** Measured and published on `/risk`,
  but only drawdown actually gates a cycle. The drawdown guard has fired once,
  in a forced test at a temporarily lowered 2% cap; at the shipped 25% it never
  has (max drawdown since inception 13.3%).

### One-fill mainnet verification (DONE 2026-07-17)

The gated mainnet path was exercised once against the live SoDEX venue, with a
human approving each order. Symbolic capital, minutes of exposure, then straight
back to testnet.

**The receipt.**

| | open | close |
|---|---|---|
| order id | `37e9b9a5-2d45-450b-b084-1deba4fee09a` | `40be51ef-5e55-4027-b98d-f7bfb71b8793` |
| side | BTC-PERP buy | BTC-PERP sell (reduce-only) |
| fill | **$62,802** x **0.00017 BTC** | **$62,790** x **0.00017 BTC** |
| sodexOrderId | `12038402194` | filled, position closed |
| approvedBy | `OoJae via Claude` | `OoJae via Claude` |
| thesis | `3ef25438` | `450697ba` |

Account: `0x2b61FbdefEf22aBCc39645732a19842885f37F1c`, mainnet aid `223065`.
Balance $11.988314 before, $11.977733 after: a **1.06 cent** round trip. The venue
independently confirmed the position while open (entry $62,802, unrealized
-$0.00119) and zero open positions after. Mode returned to `live-testnet`
immediately; the caps were lowered to $15/$30 for the window and restored after.

**What the gate actually did.** The cycle recorded `pending_approval` with
`sodexOrderId=null` and the venue reporting zero positions and zero open orders:
the order provably did not reach the wire until a human called
`POST /api/orders/approve` with a bearer token. The row then walked
`pending_approval -> pending -> submitted -> filled`, and `finalizeOrder` wrote
the `paper_trades` and `paper_positions` rows, so /portfolio and /track saw it
through the same path every testnet fill uses.

**Two things this run proved that reading could not.**

1. **`docs/sodex-live.md` section 13 was false.** It claimed mainnet needed an
   `addAPIKey` ceremony with a separate registered keypair and `X-API-Key`. There
   is no such endpoint (404), and a master-signed write with no `X-API-Key` is
   accepted by both mainnet engines. Mainnet differs from testnet in exactly two
   things: the gateway host and the EIP-712 chainId. The registered-key code was
   removed rather than kept for a model the venue does not implement. The honest
   consequence: there is no revocable sub-key here, so the wallet that signs also
   holds the funds, and the mitigations are the symbolic balance and the approval
   gate, not key hygiene.
2. **The `reduceOnly` fix earned its place.** Without it (as the code stood before
   this wave) the engine margins a close as new exposure and can refuse it. The
   close above is a reduce-only order and it went through cleanly.

Also observed: deposits land in the SPOT sub-account and the venue sweeps them to
PERPS by itself, so no `transferSpotToPerps` was needed. Mainnet BTC-USD carries
**maxLeverage 40**, which is why the window ran with lowered caps: against a
symbolic balance the normal $500 per-order cap is not protective.

### Carried forward from Wave 2 (recorded at the time)

- Live Mirror Protocol mainnet bridge (the ABI wiring; `lib/chain/bridge.ts`
  carries the config-gated design). Live mainnet execution behind the gated
  flag.
- Production risk engine (VaR, drawdown caps, correlation limits). Wave 2
  ships flat notional caps plus the macro circuit breaker.
- Custom SSI index proposals and the delta-neutral USSI multi-strategy module.
- Scoped session-key delegation (Wave 2 uses a server-side hot wallet for
  the executor; the user-facing wallet connect is read-only on Wave 2).
- Public read-only landing for non-wallet visitors. Mobile UX polish.
