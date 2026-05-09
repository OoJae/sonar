# Thesis schema

Source of truth: `lib/agent/thesis.ts` (`ThesisSchema`).

```ts
{
  id: uuid,
  generatedAt: ISOString,
  asOf: ISOString,                   // data cutoff
  universe: ("MAG7" | "DEFI" | "MEME")[],
  mode: "trade" | "no-trade",
  signals: {
    etfFlowSignal: EtfFlowSignal[],  // id, asset, direction, magnitudeUSD,
                                     // windowDays, confidence, sourceEndpoint
    newsSignals: NewsSignal[],       // id, currency, category, headline, url,
                                     // stance, confidence, publishedAt
  },
  reasoning: string,                 // markdown, inline [ref:signalId] cites
  proposedAllocations: {
    index: "MAG7" | "DEFI" | "MEME",
    targetWeight: 0..1,              // sum of all targets <= 1; runner sizes
                                     // paper trades from this field
    deltaFromCurrent: number         // informational only, in fractional
                                     // weight points (0.10 = +10pp). Runner
                                     // ignores this for execution.
  }[],
  hedges: {
    market: string,                  // e.g. "BTC-PERP"
    side: "long" | "short",
    notionalUSD: number,
    reason: string
  }[],
  riskNotes: string[],               // non-empty
  citations: { ref, url }[],         // non-empty
}
```

## Hard validator rules
1. `riskNotes` must not be empty.
2. `citations` must not be empty.
3. Sum of `proposedAllocations.targetWeight` must be <= 1.0.
4. Every `[ref:<id>]` tag in `reasoning` must reference an id that exists in
   either `signals.etfFlowSignal` or `signals.newsSignals`.
5. If `reasoning` contains numeric tokens (`$`, `%`, `12`, `1.5`), it must
   contain at least one `[ref:<id>]` citation. Unsourced numbers are
   rejected.

## Agent output protocol
The agent submits the thesis by calling the `submitThesis` tool, which
validates against this schema. If validation fails, the tool returns
`{ ok: false, errors }` and the runner marks the run as failed.
