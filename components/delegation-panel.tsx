"use client";

// Wave 3 session-key delegation surface.
//
// The connected user signs a scoped, expiring, revocable EIP-712 SessionGrant
// authorizing the agent's session key (the executor signer) to trade a bounded
// set of markets up to a per-order notional. Enforcement is app-level: Sonar
// verifies the signature server-side and blocks any out-of-scope order at the
// executor. The venue never sees the grant. This maps onto an on-chain
// session-key module for mainnet.

import { useCallback, useEffect, useState } from "react";
import { ConnectKitButton } from "connectkit";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import {
  CANONICAL_MARKETS,
  buildGrantTypedData,
  buildRevokeTypedData,
  usdToMicro,
  type SessionGrant,
  type RevokeGrant,
} from "@/lib/delegation/grant";

type GrantView = {
  id: string;
  grantor: string;
  sessionKey: string;
  allowedMarkets: string[];
  maxNotionalPerOrderUsd: number;
  chainId: number;
  signedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  supersededAt: string | null;
  status: "active" | "revoked" | "superseded" | "expired";
};

const EXPIRY_OPTIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
  { label: "30 days", seconds: 2_592_000 },
];

function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "-";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function usd(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function untilLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h left`;
  return `${Math.floor(hrs / 24)}d left`;
}

export function DelegationPanel({
  sessionKey,
  enforcementOn,
  systemPerCycleUsd,
}: {
  sessionKey: string | null;
  enforcementOn: boolean;
  systemPerCycleUsd: number;
}) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();

  const [markets, setMarkets] = useState<string[]>(["MAG7.ssi", "BTC-PERP"]);
  const [maxUsd, setMaxUsd] = useState("500");
  const [ttl, setTtl] = useState(86_400);
  const [grants, setGrants] = useState<GrantView[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadGrants = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/delegation?grantor=${address}`);
      const json = await res.json();
      setGrants(json.grants ?? []);
    } catch {
      // best-effort; leave the list as-is
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/delegation?grantor=${address}`);
        const json = await res.json();
        if (!cancelled) setGrants(json.grants ?? []);
      } catch {
        // best-effort; leave the list as-is
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  function toggleMarket(m: string) {
    setMarkets((cur) =>
      cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m],
    );
  }

  async function onSign() {
    if (!address || !sessionKey) return;
    setBusy(true);
    setMsg(null);
    try {
      if (markets.length === 0) {
        setMsg("Select at least one market.");
        return;
      }
      const maxN = Number(maxUsd);
      if (!Number.isFinite(maxN) || maxN <= 0) {
        setMsg("Enter a positive per-order cap.");
        return;
      }
      // Sign on Base so the domain chainId matches; some wallets warn otherwise.
      try {
        await switchChainAsync({ chainId: base.id });
      } catch {
        // wallet may not support the switch; the signature is still valid
      }
      const now = Math.floor(Date.now() / 1000);
      const grant: SessionGrant = {
        grantor: address as `0x${string}`,
        sessionKey: sessionKey as `0x${string}`,
        allowedMarkets: markets,
        maxNotionalPerOrder: usdToMicro(maxN),
        issuedAt: BigInt(now),
        expiry: BigInt(now + ttl),
        nonce: BigInt(now),
      };
      const signature = await signTypedDataAsync(buildGrantTypedData(grant));
      const res = await fetch("/api/delegation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grantor: grant.grantor,
          sessionKey: grant.sessionKey,
          allowedMarkets: grant.allowedMarkets,
          maxNotionalPerOrder: grant.maxNotionalPerOrder.toString(),
          issuedAt: grant.issuedAt.toString(),
          expiry: grant.expiry.toString(),
          nonce: grant.nonce.toString(),
          signature,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setMsg("Grant signed and active.");
        await loadGrants();
      } else {
        setMsg(`Grant rejected: ${json.error}`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message.slice(0, 120) : "Signing cancelled.");
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(g: GrantView) {
    if (!address) return;
    setBusy(true);
    setMsg(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const revoke: RevokeGrant = {
        grantId: g.id,
        grantor: address as `0x${string}`,
        issuedAt: BigInt(now),
      };
      const signature = await signTypedDataAsync(buildRevokeTypedData(revoke));
      const res = await fetch("/api/delegation/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grantId: g.id,
          grantor: address,
          issuedAt: revoke.issuedAt.toString(),
          signature,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setMsg("Grant revoked.");
        await loadGrants();
      } else {
        setMsg(`Revoke rejected: ${json.error}`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message.slice(0, 120) : "Signing cancelled.");
    } finally {
      setBusy(false);
    }
  }

  const active = grants.filter((g) => g.status === "active");
  const history = grants.filter((g) => g.status !== "active");

  return (
    <div className="rounded-lg border border-border/60 bg-card/70 p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            session-key delegation
          </div>
          <h2 className="text-lg font-semibold tracking-tight">
            Non-custodial delegation
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            Sign a scoped, expiring, revocable authorization for the agent to
            trade on your behalf. You keep your keys; the agent can only act
            inside the markets and per-order size you approve, until it expires
            or you revoke it.
          </p>
        </div>
        <ConnectKitButton />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`mono rounded-md border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${
            enforcementOn
              ? "border-[color:var(--gold)]/40 text-[color:var(--gold)]"
              : "border-border/60 text-muted-foreground"
          }`}
        >
          enforcement {enforcementOn ? "on" : "off"}
        </span>
        <span className="mono rounded-md border border-border/60 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          app-level, verified server-side
        </span>
      </div>

      <div className="rounded-md border border-border/60 bg-card/40 p-4 space-y-1">
        <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Agent session key (authority you are delegating to)
        </div>
        <div className="mono text-sm">
          {sessionKey ?? "agent wallet not configured"}
        </div>
        <p className="text-xs text-muted-foreground pt-1">
          Enforcement is at the application layer: Sonar verifies your signed
          grant and blocks any out-of-scope order at the executor. The SoDEX
          venue does not see the grant. This is a verifiable authorization
          design that maps onto an on-chain session-key module for mainnet.
        </p>
      </div>

      {!isConnected ? (
        <div className="rounded-md border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
          Connect a wallet to sign a delegation. The dashboard is public and
          read-only; signing a grant is the only action that touches your wallet.
        </div>
      ) : (
        <div className="rounded-md border border-border/60 bg-card/40 p-4 space-y-4">
          <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            New grant (as {shortAddr(address)})
          </div>

          <div>
            <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Allowed markets
            </div>
            <div className="flex flex-wrap gap-2">
              {CANONICAL_MARKETS.map((m) => {
                const on = markets.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMarket(m)}
                    className={`mono rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      on
                        ? "border-[color:var(--gold)]/50 bg-[color:var(--gold)]/10 text-[color:var(--gold)]"
                        : "border-border/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 block">
              <span className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Max notional per order (USD)
              </span>
              <input
                type="number"
                min="1"
                value={maxUsd}
                onChange={(e) => setMaxUsd(e.target.value)}
                className="mono w-full rounded-md border border-border/60 bg-transparent px-3 py-2 text-sm outline-none focus:border-[color:var(--gold)]/50"
              />
            </label>
            <label className="space-y-1 block">
              <span className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Expires in
              </span>
              <select
                value={ttl}
                onChange={(e) => setTtl(Number(e.target.value))}
                className="mono w-full rounded-md border border-border/60 bg-transparent px-3 py-2 text-sm outline-none focus:border-[color:var(--gold)]/50"
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.seconds} value={o.seconds}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-[11px] text-muted-foreground">
            The risk gate still applies: effective per-order spend is the smaller
            of your grant and the system cap. System per-cycle cap:{" "}
            <span className="mono">{usd(systemPerCycleUsd)}</span>.
          </p>

          <button
            type="button"
            onClick={onSign}
            disabled={busy || !sessionKey}
            className="mono rounded-md border border-[color:var(--gold)]/50 bg-[color:var(--gold)]/10 px-4 py-2 text-xs uppercase tracking-[0.16em] text-[color:var(--gold)] transition-colors hover:bg-[color:var(--gold)]/20 disabled:opacity-50"
          >
            {busy ? "signing..." : "Sign delegation"}
          </button>
          {msg ? (
            <div className="mono text-[11px] text-muted-foreground">{msg}</div>
          ) : null}
        </div>
      )}

      {isConnected ? (
        <div className="space-y-3">
          <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Your grants
          </div>
          {grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No grants yet. Sign one above to authorize the agent.
            </p>
          ) : (
            <div className="space-y-2">
              {active.map((g) => (
                <GrantCard key={g.id} g={g} onRevoke={onRevoke} busy={busy} />
              ))}
              {history.map((g) => (
                <GrantCard key={g.id} g={g} onRevoke={onRevoke} busy={busy} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function GrantCard({
  g,
  onRevoke,
  busy,
}: {
  g: GrantView;
  onRevoke: (g: GrantView) => void;
  busy: boolean;
}) {
  const isActive = g.status === "active";
  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`mono rounded px-1.5 py-0.5 text-[9px] uppercase tracking-[0.16em] ${
                isActive
                  ? "text-[color:var(--gold)]"
                  : "text-muted-foreground"
              }`}
            >
              {g.status}
            </span>
            <span className="mono text-[11px] text-muted-foreground">
              {isActive ? untilLabel(g.expiresAt) : g.expiresAt.slice(0, 16).replace("T", " ")}
            </span>
          </div>
          <div className="mono text-xs">
            {g.allowedMarkets.join(", ")}
          </div>
          <div className="mono text-[11px] text-muted-foreground">
            {usd(g.maxNotionalPerOrderUsd)} max per order
          </div>
        </div>
        {isActive ? (
          <button
            type="button"
            onClick={() => onRevoke(g)}
            disabled={busy}
            className="mono rounded-md border border-[color:var(--negative)]/40 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-[color:var(--negative)] transition-colors hover:bg-[color:var(--negative)]/10 disabled:opacity-50"
          >
            Revoke
          </button>
        ) : null}
      </div>
    </div>
  );
}
