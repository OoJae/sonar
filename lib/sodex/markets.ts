// Sonar market -> SoDEX symbol name mapping.
//
// Two layers of resolution intentionally split:
//   1. NAME mapping (this file): static, derivable from the SoDEX naming
//      convention documented in docs/sodex-live.md §7. No network call.
//   2. ID mapping (lib/sodex/live.ts): runtime, requires a signed read
//      against the SoDEX testnet to resolve symbolName -> numeric symbolID
//      that the order payload actually carries. Cached per process.
//
// Splitting these keeps Phase 1 unblocked even though the public symbol
// listing endpoint path is still UNCONFIRMED (see docs/sodex-live.md §7).
//
// The Sonar runner produces orders for two distinct flavours of market:
//
//   - SSI index tokens (MAG7.ssi, DEFI.ssi, MEME.ssi, USSI). These are NOT
//     SoDEX listings. They are SSI primitives that mint and burn via the
//     Base-side SSI Protocol. The Wave 2 scope decision is: in live mode,
//     these legs route to the paper engine (recorded but not wire-executed)
//     while perp hedges execute live. The order preview UI surfaces this
//     split per leg so the user sees what fills vs what is paper-recorded.
//
//   - Perp markets (BTC-PERP, ETH-PERP, SOL-PERP). These map directly onto
//     SoDEX perp symbols using the confirmed naming convention BTC-USD,
//     ETH-USD, SOL-USD.
//
// Adding new markets: extend STATIC_MAP. Adding a new SSI token: add it as
// non-tradeable with a reason that the order preview can show to the user.

import type { OrderKindSchema } from "./types";
import type { z } from "zod";

type SodexKind = z.infer<typeof OrderKindSchema>;

type Tradeable = {
  tradeable: true;
  kind: SodexKind;
  symbolName: string;
};

type NonTradeable = {
  tradeable: false;
  reason: string;
};

export type MarketResolution = Tradeable | NonTradeable;

// SSI primitives. Not SoDEX listings; allocation legs for these route to
// paper. Stored explicitly so the executor and the order preview UI can
// surface a specific reason string rather than a generic "unmapped" error.
const SSI_REASON =
  "SSI index token; rebalances mint or burn via the SSI Protocol on Base, not as a single SoDEX trade. Allocation legs for this market route to the paper engine; perp hedges execute live.";

const STATIC_MAP: Record<string, MarketResolution> = {
  // SSI primitives (paper-only on live mode by design)
  "MAG7.ssi": { tradeable: false, reason: SSI_REASON },
  "DEFI.ssi": { tradeable: false, reason: SSI_REASON },
  "MEME.ssi": { tradeable: false, reason: SSI_REASON },
  USSI: {
    tradeable: false,
    reason: "Stable reference; held as residual, never traded directly.",
  },
  // Perp markets (live on SoDEX testnet). Symbol names follow the confirmed
  // SoDEX PerpsSymbol convention "<base>-USD". Numeric symbolID is resolved
  // at runtime via live.ts.
  "BTC-PERP": { tradeable: true, kind: "perp", symbolName: "BTC-USD" },
  "ETH-PERP": { tradeable: true, kind: "perp", symbolName: "ETH-USD" },
  "SOL-PERP": { tradeable: true, kind: "perp", symbolName: "SOL-USD" },
};

// The venue-symbol spelling ("<base>-USD") collapses onto the canonical perp
// key. The LLM directional hedges and the delta-neutral short both emit the
// venue spelling; without this they would throw here in live-testnet. This
// mirrors the canonical/venue split in lib/delegation/grant.ts canonicalMarket.
const VENUE_ALIASES: Record<string, string> = {
  "BTC-USD": "BTC-PERP",
  "ETH-USD": "ETH-PERP",
  "SOL-USD": "SOL-PERP",
};

export function resolveMarket(sonarMarket: string): MarketResolution {
  const key = VENUE_ALIASES[sonarMarket] ?? sonarMarket;
  const hit = STATIC_MAP[key];
  if (hit) return hit;
  // Anything not in the map is a hard configuration error, not a silent
  // skip; the runner shouldn't be producing orders for markets we haven't
  // registered. Fail loud so it surfaces in /log and the cron output.
  throw new Error(
    `Unmapped Sonar market "${sonarMarket}". Register it in lib/sodex/markets.ts before placing orders against it.`,
  );
}

// Helper used by lib/sodex/live.ts when matching a symbol name returned by
// the SoDEX listing endpoint against the entries we expect to trade. Keeps
// the consumer code simple.
export function tradeableSymbolNames(): string[] {
  return Object.values(STATIC_MAP)
    .filter((m): m is Tradeable => m.tradeable)
    .map((m) => m.symbolName);
}
