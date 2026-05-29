"use client";

// Wave 2 Phase 5.1: per-chain USDC balance panel.
//
// Two columns:
//   - Agent hot wallet (server-rendered upstream; passed as props). Reads
//     USDC on Base via lib/chain/balances.ts. ValueChain testnet USDC
//     awaits the Mirror Protocol contract address answer (docs/mirror-bridge.md).
//   - Connected user wallet (client-side via wagmi useBalance). USDC on Base
//     + native gas on ValueChain testnet, shown only when connected.
//
// The Connect / Disconnect button is provided by ConnectKit and inlines
// directly here so the panel is the user's single entry point for both
// reading their own balance and (in Wave 3) signing a bridge transaction.

import { ConnectKitButton } from "connectkit";
import { useAccount, useReadContract, useBalance } from "wagmi";
import { erc20Abi, formatUnits, getAddress } from "viem";
import { base } from "wagmi/chains";

const USDC_DECIMALS = 6;
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const VALUECHAIN_TESTNET_ID = 138565;

export type AgentBalanceProps = {
  address: string | null;
  baseUsdc: string | null;
  valuechainOnchainUsdc: string | null;
  venueSpotVusdc: string | null;
  venuePerpsVusdc: string | null;
  notes: string[];
};

function formatUsdc(raw: bigint | string | null | undefined): string {
  if (raw === null || raw === undefined) return "-";
  try {
    if (typeof raw === "bigint") {
      return `$${Number(formatUnits(raw, USDC_DECIMALS)).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    const n = Number(raw);
    return Number.isFinite(n)
      ? `$${n.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "-";
  } catch {
    return "-";
  }
}

function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "-";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function BalancePanel({ agent }: { agent: AgentBalanceProps }) {
  const { address, isConnected } = useAccount();

  const userBaseUsdc = useReadContract({
    chainId: base.id,
    address: getAddress(BASE_USDC_ADDRESS) as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const userValuechainNative = useBalance({
    chainId: VALUECHAIN_TESTNET_ID,
    address,
    query: { enabled: Boolean(address) },
  });

  return (
    <div className="rounded-lg border border-border/60 bg-card/70 p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            cross-chain balances
          </div>
          <h2 className="text-lg font-semibold tracking-tight">
            Two-chain reality
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            SSI lives on Base. SoDEX settles on ValueChain. Sonar keeps both
            wallets honest. Connect to read your own Base USDC and native
            ValueChain gas; the agent hot wallet sits at the bottom.
          </p>
        </div>
        <ConnectKitButton />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-border/60 bg-card/40 p-4">
          <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            You (connected wallet)
          </div>
          <div className="mt-1 mono text-xs text-muted-foreground">
            {isConnected ? shortAddr(address) : "not connected"}
          </div>
          <div className="mt-4 space-y-2">
            <BalanceRow
              chain="Base"
              label="USDC"
              value={
                isConnected && userBaseUsdc.data !== undefined
                  ? formatUsdc(userBaseUsdc.data as bigint)
                  : isConnected
                    ? "..."
                    : "-"
              }
            />
            <BalanceRow
              chain="ValueChain testnet"
              label="native gas"
              value={
                isConnected && userValuechainNative.data
                  ? `${Number(formatUnits(userValuechainNative.data.value, userValuechainNative.data.decimals)).toFixed(4)} ${userValuechainNative.data.symbol}`
                  : isConnected
                    ? "..."
                    : "-"
              }
            />
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-card/40 p-4">
          <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Agent hot wallet (executor)
          </div>
          <div className="mt-1 mono text-xs text-muted-foreground">
            {agent.address ? shortAddr(agent.address) : "agent wallet not configured"}
          </div>
          <div className="mt-4 space-y-2">
            <BalanceRow
              chain="Base"
              label="USDC (on-chain)"
              value={agent.baseUsdc !== null ? formatUsdc(agent.baseUsdc) : "-"}
            />
            <BalanceRow
              chain="ValueChain testnet"
              label="vUSDC (on-chain wallet)"
              value={
                agent.valuechainOnchainUsdc !== null
                  ? formatUsdc(agent.valuechainOnchainUsdc)
                  : "pending"
              }
            />
            <BalanceRow
              chain="SoDEX venue"
              label="vUSDC (spot ledger)"
              value={
                agent.venueSpotVusdc !== null ? formatUsdc(agent.venueSpotVusdc) : "-"
              }
            />
            <BalanceRow
              chain="SoDEX venue"
              label="vUSDC (perps margin)"
              value={
                agent.venuePerpsVusdc !== null ? formatUsdc(agent.venuePerpsVusdc) : "-"
              }
            />
          </div>
        </div>
      </div>

      {agent.notes.length > 0 ? (
        <ul className="mono text-[11px] text-muted-foreground/80 space-y-1">
          {agent.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function BalanceRow({
  chain,
  label,
  value,
}: {
  chain: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="space-y-0.5">
        <div className="text-sm">{chain}</div>
        <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </div>
      </div>
      <div className="mono text-sm">{value}</div>
    </div>
  );
}
