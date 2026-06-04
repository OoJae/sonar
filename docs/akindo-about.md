# Sonar - About (AKINDO project description, Wave 2 current)

Paste-ready project "About" (under the 6,000-char form cap). Updated for the
Wave 2 submission: the cycle now fires at 04:00 UTC, execution is live, and the
former "Wave 2 Roadmap" is now "Wave 2 (Shipped)" with the genuinely-future work
moved to Wave 3.

---

## Overview

Sonar is an ETF-flow-aware agentic hedge fund built end-to-end on the SoSoValue
stack. After every US market close, an AI agent ingests SoSoValue ETF flows and
structured news, reads SSI index composition on Base, and publishes a dated,
fully sourced thesis with numbered citations linking each numeric claim to its
source.

The thesis drives rebalances across MAG7.ssi, DEFI.ssi, and MEME.ssi and stages
directional hedges on SoDEX perps. Wave 1 shipped paper execution; Wave 2 wires
it live on SoDEX testnet, with a verifiable track record. Sonar is non-custodial
(users keep their keys), transparent (every trade carries a thesis id, every
failed run stays in the log), and accountable (every numeric claim cites a
signal).

## Target Users

* **Retail crypto holders:** Those who want exposure to the SSI indices but
  prefer active rebalancing over static buy-and-hold, with full transparency
  over why each trade was made.
* **Solo quants and small funds:** Builders who lack the legal, custody, and
  infrastructure overhead to run a real fund, and who want a non-custodial
  vehicle that turns research into action.
* **SoSoValue power users:** Analysts already citing the platform's ETF flow
  data in their workflows, who want that data operationalized into decisions
  instead of just dashboards.

## Core Logic & Architecture

The daily cycle runs automatically every weekday at 04:00 UTC, after the US ETF
close once that session's flow data has published:

1. **Ingest:** Pull fresh ETF flows and structured news from SoSoValue.
2. **On-Chain Context:** Read current SSI index composition (MAG7, DEFI, MEME,
   USSI) on Base via viem multicall (`getTokenset()` + ERC-20 metadata).
3. **Agent Loop:** Invoke the agent (MiMo V2.5 Pro) with the context and seven
   typed tools.
4. **Thesis Generation:** The agent produces a thesis: signals, prose reasoning
   with inline citations, target allocations, optional hedges, and mandatory risk
   notes.
5. **Validation:** A strict validator rejects any thesis with unsourced numbers,
   missing risk notes, or weights summing above 1.0.
6. **Execution:** Valid theses are persisted and the book is rebalanced through
   an executor facade that routes by mode. In live-testnet mode, perp hedges fire
   as real EIP-712 signed orders on SoDEX through a risk gate, while SSI index
   rebalance legs are recorded against the book (SoDEX testnet has no spot pairs
   for the index tokens). Every trade is stamped with its thesis id; flipping to
   paper is an instant kill switch.

## Wave 1 Deliverables (Shipped)

* **Live Data Integration:** SoSoValue Open API on the High Frequency tier
  (100 rpm), with a 100/min token bucket and per-endpoint TTL caching.
* **The Agent:** Single-agent loop on `mimo-v2.5-pro` via the Vercel AI SDK;
  seven typed tools, a 16-step tool loop.
* **Citation Renderer:** `/signals` replaces each `[ref:id]` token with a
  numbered superscript chip linking to the exact news source or flow chart.
* **Freshness Rule:** An ETF flow point older than 36 hours yields an autonomous
  no-trade thesis with explicit reasoning.
* **SSI Protocol Reader:** viem multicall against MAG7.ssi, DEFI.ssi, MEME.ssi,
  and USSI on Base.
* **Paper Trading Engine:** Drizzle-backed, mirroring the SoDEX `OrderRequest`
  shape so the Wave 2 swap is one file.
* **Three MCP Servers:** Stdio servers wrapping SoSoValue, SSI, and the SoDEX
  paper engine.

## Wave 2 Deliverables (Shipped)

* **Live SoDEX Execution:** Real EIP-712 signed perp orders on SoDEX testnet
  (settling on ValueChain): idempotent (deterministic clOrdID + unique DB
  constraint), fill-polled, behind a risk gate (per-order downsize, per-cycle
  cap, dust floor, kill switch). Perp hedges settle live; SSI index legs are
  recorded against the book.
* **Verifiable Track Record (`/track`):** Cumulative NAV-weighted return of the
  rebalanced book versus a buy-and-hold baseline, per-thesis attribution, and win
  rate, every number linking to the dated, cited thesis behind it. Honest
  paper-plus-testnet framing.
* **Off-Chain NAV Computation:** Each index's on-chain tokenset priced against
  SoSoValue feeds (27 of 27 tokens), charted versus a buy-and-hold baseline.
* **Macro Circuit Breaker:** Reading SoSoValue's macro events, the agent
  auto-de-risks (caps notional, tilts to USSI) when a high-impact window (CPI,
  FOMC, NFP) is near, citing the event and persisting it.
* **Interactive Run-a-Cycle Demo:** A rate-limited public control lets a visitor
  trigger a real live-testnet cycle from the dashboard; no secret reaches the
  client.
* **Data Freshness Fix:** 7-day rollup signals are graded against a
  runner-injected freshness clock anchored to the ETF close, so the agent reasons
  on the just-closed session, not stale data.
* **Langfuse Trace Publishing:** A real trace per cycle; every Log row links to
  its trace id.
* **Cross-Chain Funding (we declared Mirror bridging):** We declared a Mirror
  Protocol bridge to move USDC between Base and ValueChain in-dashboard.
  Mid-build, the SoSoValue team confirmed there is no testnet bridge, so we
  adapted in the open: the ValueChain wallet is funded by a SoDEX testnet
  withdrawal, the three-balance panel (Base, ValueChain, SoDEX venue) is real,
  and Mirror ships as the config-gated mainnet design.
* **Operational Hardening:** The production build runs under systemd with
  auto-restart; nginx vhost in the repo; TLS via Let's Encrypt.
  https://sonar.my.id survives restarts and reboots.

## Wave 3 Roadmap

* Live Mirror Protocol mainnet bridge and gated mainnet execution.
* A production risk engine (VaR, drawdown caps, correlation limits) on top of the
  Wave 2 notional caps and macro breaker.
* Scoped session-key delegation so a connected user authorizes the agent without
  a server-side hot wallet.
* Custom SSI index proposals and a delta-neutral USSI multi-strategy module.
