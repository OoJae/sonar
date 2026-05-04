# Wave changelog

## Wave 1 (May 1 to May 12, 2026)

### Shipped
- SoSoValue REST client with per-endpoint cache TTLs and 20/min token bucket
- Fixture mode (`SONAR_DATA_SOURCE=fixture`) so the agent runs without a key
- SSI Protocol reader on Base via viem multicall for MAG7, DEFI, MEME, USSI
- Paper trading engine with mark-to-market, persisted via Drizzle
- Thin SoDEX live client (spot pair listing, health probe) for bonus credit
- Thesis Zod schema with citation enforcement and validator rejection path
- Agent runner wiring Vercel AI SDK + `MiMo-V2.5-Pro` (Xiaomi MiMo, via the
  Anthropic-compatible endpoint at `https://token-plan-sgp.xiaomimimo.com/anthropic`)
- Three MCP servers (sosovalue, sodex, ssi) over stdio
- Dashboard: Signals, Portfolio, Log. Dark navy + gold financial-terminal
  aesthetic. Recharts ETF flow bars.
- Vercel Cron daily trigger, protected by `CRON_SECRET`
- Structured logger with Langfuse-ready hook

### Outstanding for Wave 1
- Provision Supabase project and run `pnpm db:push`
- Populate `SOSOVALUE_API_KEY` and flip `SONAR_DATA_SOURCE=live`
- Record demo video (max 3 minutes)
- Deploy to Vercel and publish live URL

## Wave 2 (June 2026, planned)
- Live SoDEX execution on ValueChain (paper-to-live swap in `lib/sodex/`)
- Cross-chain bridging logic between Base and ValueChain via Mirror Protocol
- Production risk engine (VaR, drawdown caps, correlation limits)
- Custom SSI index proposals
- Mobile UX polish
- Full Langfuse tracing with thesis annotations and cost breakdown
