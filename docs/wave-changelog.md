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

## Wave 2 (June 2026, planned)
- Live SoDEX execution on ValueChain (paper-to-live swap in `lib/sodex/`)
- Cross-chain bridging logic between Base and ValueChain via Mirror Protocol
- Production risk engine (VaR, drawdown caps, correlation limits)
- Custom SSI index proposals
- Mobile UX polish
- Full Langfuse tracing with thesis annotations and cost breakdown
