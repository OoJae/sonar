"use client";

// Wave 2 Phase 5.1: wagmi + ConnectKit + React Query providers wired for
// the two-chain reality. Base mainnet for SSI reads + the user's primary
// USDC holding. ValueChain testnet for SoDEX-side balances.
//
// ValueChain testnet is not in viem's bundled chain list, so we define it
// inline. The testnet RPC URL was confirmed via probe on 2026-05-29:
// https://testnet-rpc.valuechain.xyz returns chainId 138565 (matches the
// SoDEX EIP-712 domain chainId documented in docs/sodex-live.md).
//
// WalletConnect Cloud project id is read from NEXT_PUBLIC_WALLETCONNECT_ID.
// If absent, the WalletConnect connector silently degrades but injected
// (MetaMask, Coinbase Wallet, etc.) still work.

import { ConnectKitProvider, getDefaultConfig } from "connectkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { base, type Chain } from "wagmi/chains";

const valueChainTestnet = {
  id: 138565,
  name: "ValueChain Testnet",
  nativeCurrency: { name: "Soso", symbol: "tSOSO", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.valuechain.xyz"] },
  },
  testnet: true,
} as const satisfies Chain;

const wcId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID ?? "";

const config = createConfig(
  getDefaultConfig({
    appName: "Sonar",
    appDescription: "ETF-flow-aware agentic hedge fund",
    appUrl: "https://sonar.my.id",
    walletConnectProjectId: wcId,
    chains: [base, valueChainTestnet],
    transports: {
      [base.id]: http(),
      [valueChainTestnet.id]: http("https://testnet-rpc.valuechain.xyz"),
    },
  }),
);

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider mode="dark">{children}</ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
