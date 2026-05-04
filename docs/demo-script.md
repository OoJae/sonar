# Demo script (3 minutes max)

Target length 2:45. Voice-over plus live capture. No slides.

## 00:00 to 00:30 - Problem
"AI hedge funds have been a disaster. Ai16z is in litigation, aixbt is down
97 percent, Virtuals is down 87 percent. None of them are non-custodial and
none publish a verified track record. Sonar fixes that."

Cut to Sonar landing page (`/`). Hover over the three feature cards.

## 00:30 to 01:00 - Architecture
Show `docs/architecture.md` diagram. Narrate: "SoSoValue data on top, SSI
indices on Base, SoDEX execution on ValueChain, one agent in the middle
running on Xiaomi MiMo V2.5 Pro via the Anthropic-compatible relay, with the
Model Context
Protocol. Every trade is paper in Wave 1 and live in Wave 2."

## 01:00 to 02:30 - Live walkthrough
1. Navigate to `/signals`. Show the latest thesis: headline, allocation
   table, ETF flow bar chart, reasoning with inline citations.
2. Click a citation to prove it resolves to a signal id.
3. Navigate to `/portfolio`. Point out the paper P&L, the thesis id column,
   and the "Wave 1 paper" badge.
4. Navigate to `/log`. Scroll the run history. Highlight a rejected run to
   prove the validator rejects unsourced numbers.
5. Open a terminal and `curl -X POST /api/agent/run`. While it runs, narrate:
   "The agent pulls data, reads Base, writes a thesis, validates, persists,
   rebalances." Refresh `/signals` to show the fresh thesis.

## 02:30 to 03:00 - Wave 2 roadmap
"Wave 2 brings live SoDEX execution, cross-chain bridging via Mirror
Protocol, a production risk engine, and custom SSI index proposals. One
agent, one integrated stack, one track record. Thank you."

## Recording tips
- Terminal font size 16pt, dashboard at 90 percent browser zoom
- Screen size 1440x900 fullscreen, 60fps
- Voice recorded separately (Zencastr or RX) and ducked under the demo
- Cut the cycle trigger segment to 8-10 seconds via time-lapse
