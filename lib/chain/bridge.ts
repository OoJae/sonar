// Mirror Protocol cross-chain bridge: DECLARED DESIGN, NOT AVAILABLE.
//
// Read this before assuming the bridge is close to working. It is not, and the
// blocker is not the one the env vars imply.
//
// What we know, as of 2026-07-17 (see docs/mirror-bridge.md):
//   - There is NO testnet bridge between Base and ValueChain. The SoSoValue team
//     confirmed that on Discord 2026-05-27. That answer resolved only that one
//     question.
//   - We have NO Mirror Protocol contract address, NO ABI, NO function
//     signature, and NO docs link, on any chain. Not one artifact. The ask is
//     drafted in docs/mirror-bridge.md section 5 and nothing has come back since
//     2026-05-26.
//   - Nothing in this repo imports this module. It has no callers by design:
//     there is nothing to call.
//
// Why this module still exists: the two-chain split is real and central to the
// product (SSI indices live on Base, SoDEX executes on ValueChain), so the
// interface for crossing it is worth declaring and keeping honest. It is the
// typed shape a real implementation would fill, config-gated so it can never
// run by accident.
//
// Why it is NOT implemented behind a guessed ABI: we would be inventing calldata
// for a fund-moving contract we have never seen, which is exactly what CLAUDE.md
// section 11 forbids ("We will not invent endpoint paths or response shapes").
// The lib/sodex/client.ts:withdrawVusdcToOnchain precedent does not apply: that
// is shape-correct against a real, documented, signed endpoint with one unknown
// field value, and the venue answers with a real error naming the bad field.
// Mirror has no endpoint to be wrong against. A guessed selector would either
// revert (useless) or hit some other function (dangerous), and since nothing
// calls this, guessing would buy zero function while arming a trap for whoever
// sets the addresses later.
//
// Funding does not need this. The SoDEX account is funded by a direct deposit of
// the margin asset on ValueChain; the bridge is not on the critical path for
// either testnet or the gated mainnet path.

import { env } from "@/lib/utils/env";

export type BridgeDirection = "base->valuechain" | "valuechain->base";

export type BridgeTx = {
  to: `0x${string}`;
  // The bridge calldata. Cannot be assembled today: encoding it requires the
  // Mirror ABI, which we do not have. Typed so a real implementation slots in
  // without changing callers.
  data: `0x${string}`;
  value: bigint;
  chainId: number;
};

function assertMainnet(): void {
  if (env().SONAR_EXECUTION_MODE !== "live-mainnet") {
    throw new Error(
      "lib/chain/bridge.ts is mainnet design only and must never run on testnet. " +
        "There is no testnet bridge; testnet ValueChain funding uses the SoDEX " +
        "withdrawal path. Set SONAR_EXECUTION_MODE=live-mainnet to enable bridging.",
    );
  }
}

// What is still missing before a bridge tx could be built at all. Returned as a
// list rather than a boolean so the blocker is legible instead of folklore.
export function bridgeBlockers(): string[] {
  const e = env();
  const blockers: string[] = [];
  if (!e.MIRROR_BRIDGE_BASE_ADDRESS) {
    blockers.push("MIRROR_BRIDGE_BASE_ADDRESS is unset (no known Base-side contract)");
  }
  if (!e.MIRROR_BRIDGE_VALUECHAIN_ADDRESS) {
    blockers.push(
      "MIRROR_BRIDGE_VALUECHAIN_ADDRESS is unset (no known ValueChain-side contract)",
    );
  }
  // The real blocker, and the one no env var can satisfy. Addresses alone would
  // let us name a contract we still could not call.
  blockers.push(
    "the Mirror Protocol ABI / function signatures are unknown, so the deposit call cannot be encoded (docs/mirror-bridge.md section 5)",
  );
  return blockers;
}

// Build a Mirror Protocol bridge transaction for the user to sign.
//
// Always throws. Setting the two address env vars does NOT unblock it: without
// the ABI there is no call to encode. The throw names every blocker so nobody
// has to read this file to find out why.
export function buildBridgeTx(input: {
  direction: BridgeDirection;
  amountUsdc: bigint;
  recipient: `0x${string}`;
}): BridgeTx {
  void input;
  assertMainnet();
  throw new Error(
    "Mirror Protocol bridge tx assembly is not implemented because the protocol " +
      "is undocumented to us. Blockers: " +
      bridgeBlockers().join("; ") +
      ". This is deliberately not guessed: encoding calldata for an unknown " +
      "fund-moving contract would be worse than refusing. Funding does not " +
      "require the bridge (deposit the margin asset directly into SoDEX).",
  );
}

// True only if a bridge tx could actually be built. That is never today.
//
// This used to return true once both addresses were set, which was wrong: the
// ABI is the blocker, so setting the env vars would have reported the bridge as
// "available" while buildBridgeTx still threw. Any caller trusting it would have
// shown a bridge UI that cannot bridge. It now tracks the same blocker list the
// build path uses, so the two can never disagree.
//
// No caller today. A previous version of this comment claimed the dashboard used
// it to choose between a bridge widget and the funding panel; no such widget
// exists and nothing imports this module. Kept as the honest predicate for
// whenever the protocol is published.
export function isBridgeAvailable(): boolean {
  return (
    env().SONAR_EXECUTION_MODE === "live-mainnet" && bridgeBlockers().length === 0
  );
}
