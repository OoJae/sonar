"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Public interactive control: triggers a real live-testnet cycle via the
// rate-limited /api/agent/demo-run endpoint (no secret in the client). Shows
// progress and reloads the page to surface the new thesis + order preview.
export function DemoRunButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function run() {
    setState("running");
    setMessage("Reasoning over ETF flows, news, SSI state, and the macro calendar...");
    try {
      const res = await fetch("/api/agent/demo-run", { method: "POST" });
      const body = (await res.json()) as {
        ok?: boolean;
        mode?: string;
        message?: string;
      };
      if (res.status === 429) {
        setState("error");
        setMessage(body.message ?? "Rate limited. Try again shortly.");
        return;
      }
      if (!res.ok || !body.ok) {
        setState("error");
        setMessage(body.message ?? "The cycle did not complete. See the Log.");
        return;
      }
      setState("done");
      setMessage(`Cycle complete (${body.mode ?? "live-testnet"}). Loading the thesis...`);
      router.refresh();
      setTimeout(() => setState("idle"), 4000);
    } catch {
      setState("error");
      setMessage("Network error triggering the cycle.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={state === "running"}
        className="mono rounded-md border border-[color:var(--gold)]/50 bg-[color:var(--gold)]/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[color:var(--gold)] transition-colors hover:bg-[color:var(--gold)]/20 disabled:opacity-50"
      >
        {state === "running" ? "Running cycle..." : "Run a cycle now (demo)"}
      </button>
      {message ? (
        <span
          className={`mono max-w-xs text-right text-[10px] ${
            state === "error" ? "text-[color:var(--negative)]" : "text-muted-foreground"
          }`}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
