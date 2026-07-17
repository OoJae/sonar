// Wave 2 Phase 5.1: server-side chain balance reads for the agent hot wallet.
//
// Three numbers tell the agent wallet's two-chain story honestly:
//   1. Base USDC: raw ERC-20 balanceOf on Base mainnet (what the agent would
//      bridge from).
//   2. ValueChain testnet vUSDC (on-chain): raw ERC-20 balanceOf at the wallet
//      address. This is typically 0 because deposited funds are custodied
//      inside the SoDEX venue, not held raw in the wallet.
//   3. ValueChain SoDEX venue vUSDC (spot + perps): the execution capital that
//      actually backs orders, read from the SoDEX account-ledger API. This is
//      the meaningful number for "can the agent trade right now."
//
// User wallet balances are read CLIENT-side via wagmi inside
// components/balance-panel.tsx; this module is the agent hot wallet's view.

import { createPublicClient, http, formatUnits, getAddress, defineChain } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "@/lib/utils/env";
import {
  VALUECHAIN_MAINNET_CHAIN_ID,
  VALUECHAIN_TESTNET_CHAIN_ID,
} from "@/lib/chain/valuechain";
import { logger } from "@/lib/utils/logger";
import { getVenueVusdc } from "@/lib/sodex/client";

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

// ValueChain. Not in viem's bundled chain list, so it is defined here.
//
// Mode-aware, and it has to be: the chain id must track the RPC the transport is
// pointed at. This used to hardcode 138565 while reading VALUECHAIN_RPC_URL and
// VALUECHAIN_USDC_ADDRESS, both of which are mode-dependent, so on live-mainnet
// it would have described the testnet chain while querying mainnet. Probed
// 2026-07-17: each USDC address is dead code on the other chain, so a mismatch
// returns zero rather than an error. That is the "did my real funds land?" row
// reading a confident, wrong zero at exactly the wrong moment. lib/utils/env.ts
// now refuses to boot such a config, and this keeps the two consistent.
function valueChainFor(mode: string, rpcUrl: string) {
  const isMainnet = mode === "live-mainnet";
  return defineChain({
    id: isMainnet ? VALUECHAIN_MAINNET_CHAIN_ID : VALUECHAIN_TESTNET_CHAIN_ID,
    name: isMainnet ? "ValueChain" : "ValueChain Testnet",
    nativeCurrency: {
      name: "Soso",
      symbol: isMainnet ? "SOSO" : "tSOSO",
      decimals: 18,
    },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: !isMainnet,
  });
}

export type AgentBalances = {
  address: string | null;
  baseUsdc: string | null;            // decimal string, USD
  valuechainOnchainUsdc: string | null; // decimal string; raw ERC-20 at the wallet
  venueSpotVusdc: string | null;      // decimal string; SoDEX spot ledger
  venuePerpsVusdc: string | null;     // decimal string; SoDEX perps ledger
  notes: string[];
};

export async function getAgentBalances(): Promise<AgentBalances> {
  const e = env();
  const notes: string[] = [];

  if (!e.SODEX_WALLET_PRIVATE_KEY) {
    return {
      address: null,
      baseUsdc: null,
      valuechainOnchainUsdc: null,
      venueSpotVusdc: null,
      venuePerpsVusdc: null,
      notes: ["SODEX_WALLET_PRIVATE_KEY not set; agent wallet view unavailable."],
    };
  }
  const account = privateKeyToAccount(e.SODEX_WALLET_PRIVATE_KEY as `0x${string}`);
  const address = account.address;

  // 1. Base USDC (raw ERC-20).
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

  // 2. ValueChain vUSDC (raw ERC-20 at the wallet), on whichever ValueChain the
  // current mode points at. Usually 0: deposited funds are custodied by the
  // SoDEX venue, not held raw.
  const vcLabel = e.SONAR_EXECUTION_MODE === "live-mainnet" ? "mainnet" : "testnet";
  let valuechainOnchainUsdc: string | null = null;
  if (e.VALUECHAIN_USDC_ADDRESS) {
    try {
      const vcClient = createPublicClient({
        chain: valueChainFor(e.SONAR_EXECUTION_MODE, e.VALUECHAIN_RPC_URL),
        transport: http(e.VALUECHAIN_RPC_URL),
      });
      const raw = await vcClient.readContract({
        address: getAddress(e.VALUECHAIN_USDC_ADDRESS) as `0x${string}`,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [address],
      });
      valuechainOnchainUsdc = formatUnits(raw, USDC_DECIMALS);
    } catch (err) {
      logger.warn("balances.valuechain_read_failed", {
        address,
        error: err instanceof Error ? err.message : String(err),
      });
      notes.push(`ValueChain ${vcLabel} vUSDC read failed; check VALUECHAIN_RPC_URL.`);
    }
  } else {
    notes.push(
      "VALUECHAIN_USDC_ADDRESS not set; ValueChain on-chain vUSDC balance unavailable.",
    );
  }

  // 3. SoDEX venue ledger vUSDC (spot + perps). The execution capital.
  let venueSpotVusdc: string | null = null;
  let venuePerpsVusdc: string | null = null;
  try {
    const venue = await getVenueVusdc();
    venueSpotVusdc = String(venue.spot);
    venuePerpsVusdc = String(venue.perps);
  } catch (err) {
    logger.warn("balances.venue_read_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    notes.push("SoDEX venue balance read failed.");
  }

  if (valuechainOnchainUsdc === "0" || valuechainOnchainUsdc === "0.0") {
    notes.push(
      "On-chain ValueChain vUSDC is 0 by design: the agent's execution capital is held in the SoDEX venue ledger (see venue spot + perps), not as a raw wallet balance.",
    );
  }

  return {
    address,
    baseUsdc,
    valuechainOnchainUsdc,
    venueSpotVusdc,
    venuePerpsVusdc,
    notes,
  };
}
