# Demo script (3 minutes max)

Target length 2:45. Voice-over plus live capture. No slides.

## 00:00 to 00:20 - Problem and headline

"AI hedge funds have been a disaster. ai16z is in litigation, aixbt is down
97 percent, Virtuals down 87 percent. None of them are non-custodial and
none publish a verified track record. Sonar is the answer, built on the
full SoSoValue stack end to end. Wave 2 just lit up live SoDEX execution
on testnet."

Cut to https://sonar.my.id landing page.

## 00:20 to 00:50 - Architecture

Cut to `docs/architecture.md` diagram (or the README runtime diagram).
Narrate: "SoSoValue data on top, SSI indices on Base, SoDEX execution
on ValueChain, one agent in the middle running on Xiaomi MiMo V2.5 Pro
via the Anthropic-compatible relay, with the Model Context Protocol.
The executor is a single facade in `lib/sodex/executor.ts`; switching
between paper and live testnet is one env var."

## 00:50 to 02:30 - Live walkthrough

This is the headline. Open https://sonar.my.id with `SONAR_EXECUTION_MODE=live-testnet`
already set.

1. **Trigger a fresh cycle.** Pull up a terminal pane next to the browser,
   run `curl -X POST -H "Authorization: Bearer $CRON_SECRET"
   http://localhost:3005/api/agent/run`. Narrate: "The agent pulls fresh
   SoSoValue data, reads SSI composition on Base, writes a thesis,
   validates the citations, persists, and rebalances."
2. **Refresh /signals.** Walk through the new thesis: headline, allocation
   table, ETF flow bar charts, reasoning with numbered superscript
   citations. Scroll to the Sources block.
3. **Stop on the Wire orders block.** This is the new Wave 2 panel.
   Highlight the perp hedge row that filled: market `SOL-USD`, side `buy`,
   notional $500 (downsized from $50,000 by the risk gate), status
   `filled` in green, the real SoDEX system order id (e.g. 1947156729),
   and the fill price.
4. **Tab to /portfolio.** Show the "Two-chain reality" Balance Panel at
   the top: the agent hot wallet's USDC on Base on the right, the
   connected user's balances on the left. Click Connect, sign with
   MetaMask, watch the user's USDC populate. Narrate: "Two wallets, two
   chains, both honest."
5. **Scroll to the NAV chart.** Point at the per-share NAV line per
   index with the dashed inception reference and the percent-from-inception
   delta in the header. Mention that the NAV is computed off-chain from
   the on-chain tokenset times live SoSoValue prices.
6. **Open /log.** Click the Trace link on the run that just fired. The
   Langfuse trace opens in a new tab, showing the cycle's input, output,
   and the full tool call sequence. Close it and return.

## 02:30 to 02:50 - Kill switch and non-custodial framing

"Live mode is the default in this demo. The kill switch is one env var:
`SONAR_EXECUTION_MODE=paper` and `systemctl restart sonar` instantly
reverts to safe paper execution. The agent never custodies user funds.
The hot wallet is testnet only, server-side, never logged."

## 02:50 to 03:00 - Wave 3 roadmap

"Wave 3 turns the Mirror Protocol bridge widget live, adds scoped
session-key delegation so the agent can act on user wallets without
holding their keys, and ships a production risk engine. One agent, one
integrated stack, one track record. Thank you."

## Recording tips

- Terminal font size 16pt, dashboard at 90 percent browser zoom
- Screen size 1440x900 fullscreen, 60fps
- Voice recorded separately (Zencastr or RX) and ducked under the demo
- Tue-Fri after 21:00 UTC so the agent emits a `mode: trade` thesis on
  fresh data
- Have `SONAR_EXECUTION_MODE=paper` ready in a second terminal in case
  any live order misbehaves on camera; flipping it mid-recording and
  saying "and the kill switch reverts to paper instantly" is the honest
  recovery
- Pre-fund the perps sub-account before recording (run
  `pnpm tsx scripts/sodex-fund-perps.ts 200` once); insufficient margin
  rejections are not the demo we want to ship
