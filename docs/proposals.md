# Custom SSI index proposals (Wave 3)

The agent designs new themed indices on demand. A user enters a theme on
`/proposals`; the agent proposes a basket of constituent tokens with target
weights, prices it against live SoSoValue data, and writes a cited rationale.
This document states plainly what the feature is and, importantly, what it is not.

## What a proposal is

- A themed basket: 3 to 15 constituents, each with a `targetWeight` (the set is
  normalized to sum exactly 1 server-side).
- A priced NAV: each constituent is priced via `getPriceUSD` (the same SoSoValue
  path `lib/ssi/nav.ts` uses for the real MAG7/DEFI/MEME indices), and the
  per-unit NAV is `sum(weight_i * price_i)` over the priceable constituents.
- Honest coverage: constituents that do not resolve in the SoSoValue catalogue are
  skipped and reported (for example "6 of 8 priceable" plus the priced weight), not
  silently renormalized. When the data key is down, coverage is 0 and the basket,
  weights, and rationale still render.
- A cited rationale: every numeric claim carries an inline `[ref:<evidenceId>]`
  tag resolved against the proposal's evidence and citations, validated by the same
  citation rules as the trading thesis.

## Generation and safety

Generation runs the MiMo model through a single `submitProposal` tool with a
capture + validate step (`lib/proposals/generate.ts`), mirroring the thesis path.
The server stamps the id and clock, forces the sanitized theme, normalizes the
weights, and prices the basket. The public route `POST /api/proposals` is not
bearer-protected (any visitor can design an index) but is rate-limited per IP
(`SONAR_PROPOSAL_RATELIMIT`, default 5 per 600s) and single-flighted, never reads
`CRON_SECRET` or the private key, and never calls the trading cycle. Generation
takes up to a minute; the form shows an explicit running state.

## What it is not (honest scope)

A proposal is a priced design artifact. Sonar does not create the index on-chain in
this build, and no funds move. On SSI Protocol (Base, chainId 8453), an index like
this maps onto AssetFactory (`SSI_PROTOCOL.factory`), which deploys the AssetToken,
and AssetIssuer (`SSI_PROTOCOL.issuer`), which issues shares against a deposited
tokenset. Sonar holds these addresses (`lib/ssi/addresses.ts`) but calls neither.
Basket execution (decomposing a basket into per-underlying SoDEX orders) is a
separate question and is not part of this feature.

## Verification

- `pnpm tsx scripts/proposal-smoke.ts` (schema + citation rules + basket pricing).
- `POST /api/proposals -d '{"theme":"AI agents"}'` returns a valid priced proposal;
  `GET /api/proposals` lists it; two concurrent POSTs return one 200 and one
  busy-429; the daily cycle and thesis pipeline are untouched.
