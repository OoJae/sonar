# AKINDO Wave 2 submission contents

Draft text for the Wave 2 submission form fields. The form's "Updates in
this Wave" field is capped at 3,000 characters (the Wave 1 trap from round
8). The body below sits inside that limit and mirrors the paste-ready copy
in `docs/akindo-wave2-submission.md`; the long-form ledger is in
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

Wave 2 turns Sonar from a paper prototype into a live, verifiable agentic
hedge fund on the SoSoValue stack.

Live SoDEX testnet execution. The agent's thesis places real EIP-712 signed
perp orders on SoDEX testnet through a live executor behind the same
OrderRequest contract the Wave 1 paper engine used. Orders are idempotent
(deterministic clOrdID, unique DB constraint), fill-polled, and recorded with
the real SoDEX order id. A live cycle placed a downsized SOL-PERP hedge that
filled at $82.65. Five non-obvious SoDEX protocol details (v-byte
normalization, clOrdID format, two-layer error envelope, unsigned account
read, base-URL path) are documented in docs/sodex-live.md.

Risk gate and confirmation. Per-order downsize, per-cycle cap, dust floor,
mode gate, kill switch. The order preview block on Signals shows each order's
status badge before and as it fills; rejection reasons surface inline. A $50k
agent hedge was downsized to $500 on camera.

Verifiable track record (/track). The artifact no AI fund shows: cumulative
NAV-weighted return of Sonar's rebalanced book versus a buy-and-hold baseline
of the same SSI indices, per-thesis P&L attribution, and win rate, every number
linking to the dated, cited thesis that produced it. Honest paper-plus-testnet
framing; the credibility is the verifiability.

Macro circuit breaker. Using SoSoValue's /macro/events, the agent auto-de-risks
(caps notional and tilts to USSI) when a high-impact event (CPI, FOMC, NFP) is
within the lookahead horizon, citing the event and persisting the reason.
Verified end to end on a real upcoming CPI print.

Interactive demo. A rate-limited public control lets a judge trigger a real
live-testnet cycle from the dashboard and watch it; no secret reaches the
client.

NAV computation, off-chain from the on-chain tokenset times SoSoValue prices
(27/27 tokens covered), charted vs a buy-and-hold baseline. The data-freshness
clock is anchored to the ETF close and the daily cron runs after it, so the
agent trades the just-closed session rather than stale data. Real Langfuse
traces linked from Log.

Cross-chain funding. The SoSoValue team confirmed there is no testnet bridge,
so the ValueChain wallet is funded by a SoDEX testnet withdrawal; the
three-balance panel is real. Mirror Protocol is the config-gated mainnet bridge
design. Adaptive honesty over a faked bridge.

Operational hardening: the app runs under systemd; https://sonar.my.id survives
reboots and the cron fires on the production process.

### Wave 3 milestones

Live Mirror Protocol mainnet bridge and gated mainnet execution; a production
risk engine (VaR, drawdown caps, correlation limits) on top of the Wave 2
notional caps and macro breaker; scoped session-key delegation so a connected
user authorizes the agent without a server-side hot wallet; the delta-neutral
USSI multi-strategy module.

### Team

(Same as Wave 1.)
