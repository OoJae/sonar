# SoSoValue Macro Events (circuit-breaker source)

> Pre-prep B4 (updated playbook). Documents the SoSoValue macro endpoint the Wave 2 circuit breaker reads. Confirmed by curl against the live High Frequency tier on 2026-05-29.

---

## Endpoint

```
GET https://openapi.sosovalue.com/openapi/v1/macro/events
Headers: x-soso-api-key: <key>
Optional query: startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

There is also `GET /openapi/v1/macro/events/{event}/history` for per-event historical prints; the circuit breaker does not need it.

## Response shape (CONFIRMED)

```json
{
  "code": 0,
  "message": "success",
  "data": [
    { "date": "2026-05-31", "events": ["S&P Global US Manufacturing PMI", "ISM Manufacturing PMI"] },
    { "date": "2026-06-02", "events": ["S&P Global Services PMI", "ISM Non-Manufacturing PMI"] },
    { "date": "2026-06-08", "events": ["Existing Home Sales"] },
    { "date": "2026-06-09", "events": ["CPI (MoM)", "Core CPI (MoM)", "CPI (YoY)"] },
    { "date": "2026-06-10", "events": ["PPI (MoM)"] }
  ],
  "details": null
}
```

- Standard SoSoValue `{code, message, data, details}` envelope.
- Each `data[]` entry is one calendar **date** (`YYYY-MM-DD`) plus an array of event **names** (strings).
- The default (no params) response returns the upcoming calendar window. Date params narrow it.

## Two gaps and how the circuit breaker handles them

1. **No per-event timestamp, only a date.** US macro releases have conventional times: CPI / PPI / NFP at 08:30 ET (12:30 or 13:30 UTC depending on DST), FOMC rate decisions at 14:00 ET. The breaker approximates the event time as **13:30 UTC** on the event date (08:30 ET, the modal release time), which is good enough for a horizon check measured in hours. This is documented in `lib/agent/circuit-breaker.ts`.

2. **No impact/importance field.** SoSoValue does not flag high vs low volatility. The breaker uses a **name allowlist** of historically market-moving releases:
   - `CPI`, `Core CPI`, `PCE`, `Core PCE` (inflation)
   - `FOMC`, `Fed Interest Rate Decision`, `Interest Rate Decision`, `FOMC Economic Projections` (policy)
   - `Non-Farm Payrolls`, `NFP`, `Unemployment Rate` (labor)
   - `GDP` (growth)
   - `PPI` (producer inflation, secondary)
   The match is case-insensitive substring (so `"CPI (MoM)"` and `"Core CPI (MoM)"` both match `cpi`). PMI and home-sales releases are intentionally NOT high-impact, so the breaker does not fire on every PMI print.

## Circuit-breaker contract (consumed by Part 5)

`lib/sosovalue/macro.ts:getMacroEvents()` returns a flattened, typed list:
```ts
{ name: string; at: string /* ISO, date + 13:30 UTC */; impact: "high" | "normal" }[]
```
`lib/agent/circuit-breaker.ts:evaluateMacroWindow(nowIso, horizonHours)` returns `{ active, event?, action: "de-risk" }`. Active when a high-impact event's `at` is within `[now, now + SONAR_MACRO_HALT_HORIZON_HOURS]`.

Fixture mode (`SONAR_DATA_SOURCE=fixture`) returns a small static list so the agent and smokes run without a live key. The `scripts/macro-breaker-smoke.ts` injects a synthetic in-horizon high-impact event to exercise the de-risk path deterministically.
