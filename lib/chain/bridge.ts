// Mirror Protocol cross-chain bridge: MAINNET DESIGN ONLY.
//
// There is no testnet bridge between Base and ValueChain (confirmed by the
// SoSoValue team). On testnet, the ValueChain execution wallet is funded by
// withdrawing from the SoDEX testnet to its on-chain address (see
// lib/sodex/client.ts:withdrawVusdcToOnchain and app/api/chain/fund-valuechain).
//
// This module is the forward-looking mainnet bridge design. It is config-gated:
// every entry point refuses to run unless SONAR_EXECUTION_MODE is live-mainnet,
// so it can never be invoked on testnet. It exists to show the cross-chain
// architecture is real and to make the Wave 3 mainnet path an additive change,
// not a rewrite. The MIRROR_BRIDGE_BASE_ADDRESS / MIRROR_BRIDGE_VALUECHAIN_ADDRESS
// env vars carry the contract addresses when they are provisioned for mainnet.

import { env } from "@/lib/utils/env";

export type BridgeDirection = "base->valuechain" | "valuechain->base";

export type BridgeTx = {
  to: `0x${string}`;
  // The bridge calldata; assembled from the Mirror Protocol ABI once the
  // mainnet contracts and interface are provisioned. Left as a typed
  // placeholder so the Wave 3 implementation slots in without changing callers.
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

// Build a Mirror Protocol bridge transaction for the user to sign. Wave 3
// implements the contract ABI; the shape is fixed now so the funding panel and
// runner can target it without rework.
export function buildBridgeTx(input: {
  direction: BridgeDirection;
  amountUsdc: bigint;
  recipient: `0x${string}`;
}): BridgeTx {
  void input;
  assertMainnet();
  // Mainnet implementation (Wave 3): resolve the source-chain Mirror contract
  // from env, encode the deposit/lock call, return the tx for user signing.
  throw new Error(
    "Mirror Protocol bridge tx assembly is a Wave 3 mainnet deliverable; " +
      "the interface is fixed but the ABI is not yet wired.",
  );
}

// Returns true when the mainnet bridge is both enabled and configured. The
// dashboard uses this to decide whether to show a live bridge widget (Wave 3)
// versus the testnet SoDEX-withdrawal funding panel (Wave 2).
export function isBridgeAvailable(): boolean {
  const e = env();
  return (
    e.SONAR_EXECUTION_MODE === "live-mainnet" &&
    Boolean(e.MIRROR_BRIDGE_BASE_ADDRESS) &&
    Boolean(e.MIRROR_BRIDGE_VALUECHAIN_ADDRESS)
  );
}
