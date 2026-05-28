// Wave 2 NAV computation.
//
// Reads the on-chain tokenset for an SSI index, prices each token via
// lib/prices, and returns the per-share NAV in USD. The tokenset amounts
// from lib/ssi/reader.ts are already decimal-normalized via viem's
// formatUnits, so the math is:
//
//   navPerShareUSD = sum(amount_i * priceUSD_i) for each tokenset entry
//
// Tokens with no SoSoValue price are skipped (logged); the running NAV is
// computed from the priced tokens. In Wave 2 all 27 underlying tokens
// across MAG7, DEFI, and MEME price cleanly via SoSoValue (per
// docs/price-coverage.md), so the skip path is a defensive backstop rather
// than the common case.

import { logger } from "@/lib/utils/logger";
import { getPriceUSD } from "@/lib/prices";
import { readIndexSnapshot, readAllIndexSnapshots } from "./reader";
import type { SsiIndexKey } from "./addresses";

export type NavComputation = {
  index: SsiIndexKey;
  navPerShareUSD: number;
  asOf: string;
  priced: number;        // count of tokens that produced a USD price
  skipped: number;       // count of tokens with no USD price
  totalSupply: string;
};

export async function computeNav(index: SsiIndexKey): Promise<NavComputation> {
  const snapshot = await readIndexSnapshot(index);
  if (snapshot.tokenset.length === 0) {
    // USSI is the stable reference and has no tokenset; NAV is $1 by definition.
    return {
      index,
      navPerShareUSD: 1,
      asOf: snapshot.readAt,
      priced: 0,
      skipped: 0,
      totalSupply: snapshot.totalSupply,
    };
  }

  let nav = 0;
  let priced = 0;
  let skipped = 0;
  for (const token of snapshot.tokenset) {
    const price = await getPriceUSD(token.symbol);
    if (price === null) {
      skipped++;
      continue;
    }
    const amount = Number(token.amount);
    if (!Number.isFinite(amount)) {
      logger.warn("nav.bad_amount", { index, symbol: token.symbol, amount: token.amount });
      skipped++;
      continue;
    }
    nav += amount * price;
    priced++;
  }

  return {
    index,
    navPerShareUSD: nav,
    asOf: snapshot.readAt,
    priced,
    skipped,
    totalSupply: snapshot.totalSupply,
  };
}

export async function computeAllNavs(): Promise<NavComputation[]> {
  // Read tokensets in parallel; the price calls themselves are sequential per
  // index because getPriceUSD shares the symbol map cache.
  const snapshots = await readAllIndexSnapshots();
  const out: NavComputation[] = [];
  for (const s of snapshots) {
    try {
      out.push(await computeNav(s.index));
    } catch (err) {
      logger.warn("nav.compute_failed", {
        index: s.index,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
