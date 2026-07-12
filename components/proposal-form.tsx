"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Public interactive control: the agent designs a custom index for a theme via
// the rate-limited /api/proposals endpoint (no secret in the client). Generation
// takes up to a minute (the MiMo model reasons over the theme), so the running
// state is explicit. On success it refreshes to surface the new proposal card.
export function ProposalForm() {
  const router = useRouter();
  const [theme, setTheme] = useState("");
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  const examples = ["AI agents", "Solana ecosystem", "RWA", "Bitcoin L2s"];

  async function run() {
    const t = theme.trim();
    if (t.length < 2) {
      setState("error");
      setMessage("Enter a theme (at least 2 characters).");
      return;
    }
    setState("running");
    setMessage("Designing the index. This can take up to a minute...");
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: t }),
      });
      const body = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (res.status === 429) {
        setState("error");
        setMessage(body.message ?? "Rate limited. Try again shortly.");
        return;
      }
      if (!res.ok || !body.ok) {
        setState("error");
        setMessage(body.message ?? `Generation failed (${body.error ?? "error"}).`);
        return;
      }
      setState("idle");
      setMessage("");
      setTheme("");
      router.refresh();
    } catch {
      setState("error");
      setMessage("Network error generating the proposal.");
    }
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card/70 p-6 space-y-4">
      <div className="space-y-1">
        <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          design an index
        </div>
        <p className="max-w-xl text-sm text-muted-foreground">
          Enter a theme and the agent proposes a custom index: constituents,
          target weights, a priced NAV, and a cited rationale. It is a design
          artifact, not an on-chain action.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={theme}
          maxLength={80}
          placeholder="e.g. AI agents, Solana ecosystem, RWA"
          onChange={(e) => setTheme(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && state !== "running") run();
          }}
          disabled={state === "running"}
          className="mono w-full rounded-md border border-border/60 bg-transparent px-3 py-2 text-sm outline-none focus:border-[color:var(--gold)]/50 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={run}
          disabled={state === "running"}
          className="mono shrink-0 rounded-md border border-[color:var(--gold)]/50 bg-[color:var(--gold)]/10 px-4 py-2 text-xs uppercase tracking-[0.16em] text-[color:var(--gold)] transition-colors hover:bg-[color:var(--gold)]/20 disabled:opacity-50"
        >
          {state === "running" ? "Designing..." : "Propose index"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setTheme(ex)}
            disabled={state === "running"}
            className="mono rounded-md border border-border/60 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>
      {message ? (
        <div
          className={`mono text-[11px] ${
            state === "error"
              ? "text-[color:var(--negative)]"
              : "text-muted-foreground"
          }`}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
