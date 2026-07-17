"use client";

// The execution-mode badge in the dashboard header, and the control behind it.
//
// For everyone except an allowlisted admin this is exactly the badge it has
// always been: this is a public dashboard and the badge is part of the demo, so
// it must not degrade for visitors. It only becomes interactive once a wallet is
// connected, and the server is the thing that decides whether that wallet may
// act. The allowlist never reaches the browser, and there is no "am I an admin"
// endpoint, so a visitor can learn only whether THEY are one, and only by
// producing a signature from the address in question.
//
// No secret is involved anywhere in this file. The auth is an EIP-712 signature
// the wallet produces; the bearer CRON_SECRET could not be used from a browser
// without shipping it to the client, which the project forbids outright.
//
// Hydration: `initialMode` comes from the server layout and is the only thing
// rendered on first paint. Everything wallet-dependent waits for `mounted`,
// because wagmi's state is client-only and rendering it during SSR mismatches.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { Badge } from "@/components/ui/badge";
import {
  buildModeActionTypedData,
  MODE_ACTION_MAX_AGE_SEC,
  type ModeAction,
  type ToggleableMode,
} from "@/lib/admin/mode-action";

type Phase =
  | "idle"
  | "signing"
  | "posting"
  | "restarting"
  | "done"
  | "reverted"
  | "timeout"
  | "error";

type Status = { mode: string; bootId: string; armedByDropin: boolean };

// The restart takes RestartSec=5 plus Next's boot. Poll gently: fast polling
// buys nothing (the process is not listening) and only burns the rate limit.
const POLL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;

const CONFIRM_WORD = "ARM MAINNET";

async function fetchStatus(): Promise<Status | null> {
  try {
    const res = await fetch(`/api/admin/mode/status?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Status;
  } catch {
    // The process is mid-restart. This is the expected path, not an error.
    return null;
  }
}

function errorCopy(error: unknown, issues?: unknown): string {
  switch (error) {
    case "not_admin":
      return "This wallet is not authorized to change the execution mode.";
    case "toggle_not_configured":
      return "No admin allowlist is configured on this deployment.";
    case "cycle_in_flight":
      return "An agent cycle is running. The flip would restart the process mid-cycle and leave the book unhedged. Retry in a minute.";
    case "pending_orders":
      return "Mainnet orders are awaiting approval. Approve them or wait out the approval TTL before disarming.";
    case "preflight_failed":
      return `Refused: the resulting config would not boot. ${
        Array.isArray(issues) ? String(issues[0] ?? "") : ""
      }`;
    case "replayed":
      return "That signature was already used. Try again.";
    case "expired":
      return "The signature expired before it arrived. Try again.";
    case "bad_signature":
      return "Signature did not verify.";
    case "rate_limited":
      return "Too many attempts. Wait a moment.";
    default:
      return `Refused: ${String(error)}`;
  }
}

// Hydration guard. useSyncExternalStore rather than the usual
// useEffect(() => setMounted(true)) because a server snapshot of `false` and a
// client snapshot of `true` is exactly what this hook is for, and it does not
// setState inside an effect (which triggers a cascading render and is linted).
const subscribeNoop = () => () => {};
const snapshotClient = () => true;
const snapshotServer = () => false;

export function ModeToggle({ initialMode }: { initialMode: string }) {
  const mounted = useSyncExternalStore(subscribeNoop, snapshotClient, snapshotServer);
  const [mode, setMode] = useState(initialMode);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const cancelled = useRef(false);

  // Stop the restart poll if the operator navigates away mid-flip.
  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  const isMainnet = mode === "live-mainnet";
  const target: ToggleableMode = isMainnet ? "live-testnet" : "live-mainnet";
  const arming = target === "live-mainnet";

  const flip = useCallback(async () => {
    if (!address) return;
    setMsg(null);
    setPhase("signing");
    try {
      const now = Math.floor(Date.now() / 1000);
      const action: ModeAction = {
        mode: target,
        actor: address,
        issuedAt: BigInt(now),
        // Deliberately shorter than the server's max age, so a slow signature
        // fails as "expired" client-side rather than looking like a server bug.
        expiry: BigInt(now + Math.min(90, MODE_ACTION_MAX_AGE_SEC)),
        nonce: BigInt(now) * 1000n + BigInt(Math.floor(Math.random() * 1000)),
      };

      const before = await fetchStatus();
      // Sign on Base so the wallet's active chain matches the EIP-712 domain
      // chainId (8453); some wallets warn or refuse on a mismatch. Same pattern
      // as delegation-panel. The signature is chain-agnostic, so a failed switch
      // is non-fatal.
      try {
        await switchChainAsync({ chainId: base.id });
      } catch {
        // wallet may not support programmatic switch; the signature is still valid
      }
      const signature = await signTypedDataAsync(buildModeActionTypedData(action));

      setPhase("posting");
      const res = await fetch("/api/admin/mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: action.mode,
          actor: action.actor,
          issuedAt: String(action.issuedAt),
          expiry: String(action.expiry),
          nonce: String(action.nonce),
          signature,
        }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setPhase("error");
        setMsg(errorCopy(json.error, json.issues));
        return;
      }
      if (json.noop) {
        setPhase("idle");
        setMsg("Already in that mode.");
        return;
      }

      // The process is exiting now. Confirm on a CHANGED bootId, not on mode:
      // mode alone cannot tell a real restart from a stale read.
      setPhase("restarting");
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline && !cancelled.current) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const s = await fetchStatus();
        if (!s || !before || s.bootId === before.bootId) continue;
        setMode(s.mode);
        if (s.mode === target) {
          setPhase("done");
          setMsg(null);
        } else {
          // A new process came back in a different mode than asked for: the boot
          // guard rejected the config and instrumentation.ts self-healed by
          // deleting the drop-in. Say so plainly; it is a refusal, not a crash.
          setPhase("reverted");
          setMsg(
            `The new config was refused at boot and the process self-healed back to ${s.mode}.`,
          );
        }
        return;
      }
      setPhase("timeout");
      setMsg("No response after 60s. Check `journalctl -u sonar`.");
    } catch (err) {
      setPhase("error");
      const m = err instanceof Error ? err.message : String(err);
      setMsg(m.toLowerCase().includes("rejected") ? "Signature rejected." : m);
    }
  }, [address, target, signTypedDataAsync, switchChainAsync]);

  const badge = (
    <Badge
      variant="outline"
      className={`mono text-[10px] uppercase tracking-[0.18em] ${
        isMainnet ? "border-[color:var(--gold)]/60 text-[color:var(--gold)]" : ""
      }`}
      title="SONAR_EXECUTION_MODE"
    >
      {phase === "restarting" ? "restarting" : mode}
    </Badge>
  );

  // First paint and every disconnected visitor: the badge exactly as before.
  if (!mounted || !isConnected) return badge;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setConfirmText("");
          if (phase !== "restarting") setMsg(null);
        }}
        className="cursor-pointer"
        aria-expanded={open}
        aria-label="Execution mode"
      >
        {badge}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-md border border-border bg-background p-4 shadow-lg">
          <div className="mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            execution mode
          </div>
          <p className="mt-2 text-sm text-foreground/90">
            {isMainnet
              ? "Live mainnet. Real funds are in scope. The agent records orders for approval and never places them itself."
              : "Live testnet. Perp hedges fire as signed orders against the testnet venue. No real funds are at risk."}
          </p>

          {arming ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Arming mainnet puts the signing wallet&apos;s balance in scope. The
              agent still cannot place an order on its own: mainnet orders are
              recorded for human approval. Type{" "}
              <span className="mono text-foreground">{CONFIRM_WORD}</span> to
              confirm.
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Disarming takes real funds out of scope on the next start.
            </p>
          )}

          {arming ? (
            <input
              value={confirmText}
              onChange={(ev) => setConfirmText(ev.target.value)}
              placeholder={CONFIRM_WORD}
              className="mono mt-3 w-full rounded border border-border bg-card px-2 py-1 text-xs uppercase tracking-[0.12em]"
              aria-label={`Type ${CONFIRM_WORD} to confirm`}
            />
          ) : null}

          <button
            type="button"
            onClick={flip}
            disabled={
              (arming && confirmText.trim().toUpperCase() !== CONFIRM_WORD) ||
              phase === "signing" ||
              phase === "posting" ||
              phase === "restarting"
            }
            className={`mono mt-3 w-full rounded px-3 py-2 text-[10px] uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-40 ${
              arming
                ? "bg-[color:var(--gold)]/15 text-[color:var(--gold)] hover:bg-[color:var(--gold)]/25"
                : "bg-accent/15 text-accent hover:bg-accent/25"
            }`}
          >
            {phase === "signing"
              ? "sign in wallet"
              : phase === "posting"
                ? "submitting"
                : phase === "restarting"
                  ? "restarting"
                  : arming
                    ? "arm mainnet"
                    : "switch to testnet"}
          </button>

          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {phase === "restarting"
              ? "The process is restarting so the change is validated at boot. This takes a few seconds."
              : phase === "done"
                ? `Now running ${mode}.`
                : (msg ??
                  "The mode is a boot-time property, so this restarts the service. Admin wallets only.")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
