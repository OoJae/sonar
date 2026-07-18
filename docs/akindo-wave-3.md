# Sonar - About (AKINDO project description, Wave 3 current)

Paste-ready "About" (under the 6,000-char form cap). Updated for Wave 3: a gated
mainnet path proven by one real human-approved fill, an admin-signed mode toggle,
session-key delegation, custom index proposals, a delta-neutral second book, and a
full adversarial-audit hardening pass. Every claim below was fact-checked against
the code. Genuinely-future work is in "Beyond Wave 3".

---

## Overview

Sonar is an ETF-flow-aware agentic hedge fund built end to end on the SoSoValue
stack. After each US market close, an AI agent ingests SoSoValue ETF flows and
structured news, reads SSI index composition on Base, and publishes a dated, fully
sourced thesis where every numeric claim links to the signal behind it. The thesis
rebalances a book across MAG7.ssi, DEFI.ssi, and MEME.ssi and hedges with signed
SoDEX perps.

Wave 3 makes it mainnet-ready and capital-gated: the fund can execute on mainnet,
but only through a human-approval gate, and we proved the path with one real signed
fill. Sonar holds
no user funds, is transparent (every trade carries a thesis id, every failed run
stays in the log), and is accountable (a thesis that states numbers without citing
a signal is rejected). Honesty is the moat, not a disclaimer.

## Target Users

* **Retail crypto holders:** SSI index exposure with active, transparent
  rebalancing and a plain reason for every trade.
* **Solo quants and small funds:** builders without the legal, custody, and infra
  overhead to run a fund, who want research turned into action.
* **SoSoValue power users:** analysts citing the platform's ETF flow data who want
  it operationalized into decisions, not dashboards.

## Core Logic and Architecture

The cycle runs at 04:00 UTC, Tuesday through Saturday, one run per US trading-day
close:

1. **Ingest** ETF flows and structured news from SoSoValue.
2. **On-chain context:** SSI composition (MAG7, DEFI, MEME, USSI) on Base via viem
   multicall.
3. **Agent loop:** MiMo V2.5 Pro with the context and typed tools.
4. **Thesis:** signals, cited reasoning, target allocations, optional hedges, and
   mandatory risk notes.
5. **Validation** rejects any thesis that states numbers without citing a signal,
   omits risk notes, or whose weights sum above 1.0.
6. **Execution** routes by mode. On paper and live-testnet the book fills inline
   (perp hedges as EIP-712 signed SoDEX orders through the risk gate; SSI legs
   recorded against the book). On live-mainnet the cycle cannot submit: it records
   the risk-capped order and stops, and only an authenticated human approval places
   it. Flipping to paper is the kill switch.

## Wave 1 (Shipped)

Live SoSoValue integration (100 rpm, cached); the agent loop on `mimo-v2.5-pro`
with seven typed tools; a citation renderer turning each `[ref:id]` into a numbered
source chip; the 36-hour freshness rule; the SSI reader on Base; a paper engine
shaped like the SoDEX order; three stdio MCP servers.

## Wave 2 (Shipped)

Live SoDEX testnet execution: real EIP-712 signed perp orders, idempotent
(deterministic clOrdID + unique DB constraint), fill-polled, risk-gated. The
verifiable track record at `/track` (book vs a buy-and-hold baseline, per-thesis
attribution, win rate, no-trade days, every number tracing to a dated thesis).
Off-chain NAV per index priced against SoSoValue feeds. A macro
circuit breaker that de-risks around CPI/FOMC/NFP windows. An interactive
rate-limited run-a-cycle control, Langfuse-traced. Hardening under systemd + nginx
+ TLS at https://sonar.my.id.

## Wave 3 (Shipped)

* **Gated mainnet path, proven.** On mainnet the agent records a risk-capped order
  and stops; only a bearer-authenticated human approval reaches the wire. We ran
  one real human-approved fill to prove it: a BTC-PERP long filled at $62,802 and
  closed at $62,790, a round trip of about one cent on symbolic capital. While it
  sat pending approval the venue reported zero position.
* **Admin-signed mode toggle.** An allowlisted wallet flips the fund between
  testnet and mainnet from the dashboard by signing an EIP-712 action; no secret
  reaches the browser. A boot guard self-heals to the testnet baseline if a bad
  config ever lands. Mainnet is disarmed by default.
* **Session-key delegation.** A user signs a scoped, expiring, revocable EIP-712
  grant (allowed markets + per-order max); when enforcement is on, the executor
  checks it before every order. Opt-in and off for the autonomous cron by default;
  app-level and honestly labeled.
* **Custom SSI index proposals.** The agent designs themed index baskets with cited
  constituents and forward-tests them in public.
* **Delta-neutral second book.** A rules-based delta-neutral carry runs beside the
  directional rotation as its own book; accounting is separate, but both share one
  venue account and margin pool.
* **Production risk engine.** Per-market position and gross-exposure caps bound the
  book on the venue, on top of per-order ($500), per-cycle ($2,000), and dust
  gates. Drawdown (25%), one-cycle VaR, and average index correlation are enforced
  portfolio guards: breach any and the cycle de-risks (notional to a third, tilt to
  USSI). Concentration stays measured.
* **Brand and interface.** A full visual identity (mark, favicon, a generated
  1200x630 social card) and a dark-navy-and-gold terminal system across every page,
  with an immersive landing built around a live animated sonar scope.
* **Adversarial audit and remediation.** A multi-agent review found and fixed real
  defects (a cross-strategy sizing bug, a track page that overstated performance on
  a data outage); the published numbers now match the code.
* **MCP surface.** An MCP server exposes theses, track record, risk, portfolio, and
  index proposals as tools.

## Security Posture

Sonar holds no user funds. On mainnet the agent's own signing wallet, a
server-held key, holds a symbolic balance and signs every write, so that balance is
the blast radius; there is no revocable sub-key on this venue. Non-custodial user
delegation, where users keep their own keys, is Wave 3 design, not yet enforced
live. The demo runs on testnet.

## Beyond Wave 3

* Autonomous mainnet execution behind the same gate, after a longer testnet record.
* A live Mirror Protocol mainnet bridge (config-gated today).
* An on-chain session-key module enforcing delegation at the protocol layer.
