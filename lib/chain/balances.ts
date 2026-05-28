// Wave 2 Phase 5.1: server-side chain balance reads.
//
// Reads the agent hot wallet's USDC balance on Base mainnet via viem
// readContract. ValueChain testnet USDC contract address is not yet
// confirmed (see docs/mirror-bridge.md §3); when VALUECHAIN_USDC_ADDRESS
// lands, the second read path is unblocked. For now the panel surfaces
// "ValueChain testnet USDC: address pending" honestly.
//
// User wallet balances are read CLIENT-side via wagmi's useBalance hook
// inside components/balance-panel.tsx; this module is for the agent
// hot wallet's view only.

import { createPublicClient, http, formatUnits, getAddress } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const USDC_DECIMALS = 6;

export type AgentBalances = {
  address: string | null;
  baseUsdc: string | null;   // decimal string, USD
  valuechainTestnetUsdc: string | null; // decimal string, USD; null when contract not configured
  notes: string[];
};

export async function getAgentBalances(): Promise<AgentBalances> {
  const e = env();
  const notes: string[] = [];

  if (!e.SODEX_WALLET_PRIVATE_KEY) {
    return {
      address: null,
      baseUsdc: null,
      valuechainTestnetUsdc: null,
      notes: ["SODEX_WALLET_PRIVATE_KEY not set; agent wallet view unavailable."],
    };
  }
  const account = privateKeyToAccount(e.SODEX_WALLET_PRIVATE_KEY as `0x${string}`);
  const address = account.address;

  const baseClient = createPublicClient({ chain: base, transport: http(e.BASE_RPC_URL) });
  let baseUsdc: string | null = null;
  try {
    const raw = await baseClient.readContract({
      address: getAddress(e.BASE_USDC_ADDRESS) as `0x${string}`,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [address],
    });
    baseUsdc = formatUnits(raw, USDC_DECIMALS);
  } catch (err) {
    logger.warn("balances.base_read_failed", {
      address,
      error: err instanceof Error ? err.message : String(err),
    });
    notes.push("Base USDC read failed; check BASE_RPC_URL.");
  }

  const valuechainTestnetUsdc: string | null = null;
  if (!e.VALUECHAIN_USDC_ADDRESS) {
    notes.push(
      "VALUECHAIN_USDC_ADDRESS not set; ValueChain testnet USDC balance unavailable. See docs/mirror-bridge.md §3 for the open Discord question.",
    );
  }
  // The ValueChain testnet USDC read path will activate as soon as the address
  // arrives via env. Kept stubbed rather than half-wired so a typo in the
  // address does not silently zero out the balance display.

  return {
    address,
    baseUsdc,
    valuechainTestnetUsdc,
    notes,
  };
}
