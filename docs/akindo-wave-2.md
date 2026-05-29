# AKINDO Wave 2 submission contents

Draft text for the Wave 2 submission form fields. The form's "Updates in
this Wave" field is capped at 3,000 characters (the Wave 1 trap from round
8). The version below sits inside that limit; the long-form ledger is in
`docs/wave-changelog.md`.

## Form fields

### Product category

Same as Wave 1.

### Demo URL

https://sonar.my.id

### Repo

https://github.com/OoJae/sonar

### Demo video

(Recorded per `docs/demo-script.md`; URL inserted at submission time.)

### Updates in this Wave (3,000 char cap)

Wave 2 lit up the live execution loop on SoDEX testnet. The agent now
places real EIP-712 signed perp orders through a single executor facade
(`lib/sodex/executor.ts`) that switches between paper and live by env
var, with a kill switch one `systemctl restart sonar` away.

Headline outcomes:

1. Live BTC-PERP and SOL-PERP fills on SoDEX testnet, recorded with real
   sodexOrderIds. The idempotency double-run test passes (DB unique
   constraint on `client_order_id` plus a deterministic clOrdID derived
   from thesisId + market). The risk gate (`lib/sodex/risk.ts`)
   downsizes per-order over-cap requests, blocks once the per-cycle
   notional is breached, enforces a $10 dust floor, and refuses
   live-mainnet defence-in-depth. On a live cycle the agent's $50,000
   hedge notional was downsized to $500 and the order filled at $82.65
   on SOL-USD; the downsizing is logged on /signals next to the status
   badge.

2. Five non-obvious SoDEX protocol details discovered and documented in
   `docs/sodex-live.md` with reproducers: the ECDSA recovery-byte
   normalization (viem returns v=27/28, the engine expects 0/1); the
   `sonar-<16 hex>` clOrdID format constraint; the two-layer error
   envelope (top-level `code` plus per-order `data[*].code`); the
   unsigned `getAccountState` read; the `/api/v1` URL prefix gotcha.
   Plus a transferSpotToPerps signed action (`scripts/sodex-fund-perps.ts`)
   because the testnet faucet only funds spot.

3. NAV per share computed off-chain in `lib/ssi/nav.ts` from each SSI
   tokenset times live SoSoValue prices (27/27 underlying tokens covered
   per `docs/price-coverage.md`; no fallback source needed). Snapshots
   persist per index per cycle and render on /portfolio as a pure-SVG
   line chart with a dashed inception reference and a percent-from-
   inception delta in the per-index header. The Wave 1 placeholder
   reference prices in `paper.ts` were just placeholders; real per-share
   NAVs are sub-dollar.

4. Freshness rollup fix. The runner pre-fetches the freshest ETF history
   date across BTC, ETH, SOL before invoking the model and injects it as
   `dataFreshness` into the user prompt. Prompt rule 2 was rewritten to
   grade against the injected value rather than per-signal dates, closing
   the round 7 gap where 7-day rollup signals could not be freshness-
   checked.

5. Langfuse cycle traces. `lib/utils/logger.ts:startCycleTrace` opens a
   trace keyed by runId on every cycle, attaches the thesis (or error) as
   output, and flushes in a finally block. /log restored the Trace column
   linking each run to `${LANGFUSE_BASE_URL}/trace/{trace_id}`.

6. Cross-chain wallet stack. wagmi v2 + ConnectKit + React Query with
   Base mainnet + ValueChain testnet (chainId 138565 confirmed by probe).
   The Portfolio Balance Panel reads the connected user's USDC on Base
   and native gas on ValueChain testnet via wagmi, and the agent hot
   wallet's USDC on Base server-side via viem. Bridge widget foundations
   are in place; the Mirror Protocol contract addresses are still
   pending a Discord answer (`docs/mirror-bridge.md`).

7. Operational hardening. The production build runs under systemd
   (`ops/systemd/sonar.service`) with Restart=always and 60s graceful
   stop; nginx vhost is committed to repo (`ops/nginx/sonar.conf`); TLS
   via Let's Encrypt. https://sonar.my.id survives `systemctl restart`.

Every wire-side fact is traceable to either a commit on
https://github.com/OoJae/sonar or a row in the Postgres database the
dashboard reads from.

### Wave 3 milestones

Mirror Protocol bridge widget (foundations shipped; needs the public
contract addresses to light up). Scoped session-key delegation so the
agent can act on user wallets without holding keys. Production risk
engine (VaR, drawdown caps, correlation limits). Custom SSI index
proposals. Public read-only landing for non-wallet visitors.

### Team

(Same as Wave 1.)
