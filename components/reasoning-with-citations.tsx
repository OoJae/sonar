import { Fragment } from "react";
import type { Thesis } from "@/lib/agent/thesis";
import { safeHttpUrl } from "@/lib/utils/url";

type Resolved = {
  id: string;
  n: number;
  url: string | null;
  label: string;
};

function resolveRefs(reasoning: string, thesis: Thesis): Resolved[] {
  const out = new Map<string, Resolved>();
  for (const m of reasoning.matchAll(/\[ref:([^\]]+)\]/g)) {
    const id = m[1];
    if (!id || out.has(id)) continue;
    const news = thesis.signals.newsSignals.find((s) => s.id === id);
    const etf = thesis.signals.etfFlowSignal.find((s) => s.id === id);
    const cite = thesis.citations.find((c) => c.ref === id);
    let url: string | null = null;
    let label = id;
    if (news) {
      url = safeHttpUrl(news.url);
      label = news.headline;
    } else if (etf) {
      label = `${etf.asset} ETF flow (${etf.direction}, ${etf.windowDays}d)`;
    } else if (cite) {
      url = safeHttpUrl(cite.url);
      label = cite.ref;
    }
    out.set(id, { id, n: out.size + 1, url, label });
  }
  return [...out.values()];
}

export function ReasoningWithCitations({
  reasoning,
  thesis,
}: {
  reasoning: string;
  thesis: Thesis;
}) {
  const refs = resolveRefs(reasoning, thesis);
  const refMap = new Map(refs.map((r) => [r.id, r]));
  const parts = reasoning.split(/(\[ref:[^\]]+\])/g);

  return (
    <>
      <div className="text-sm leading-7 text-foreground/90 whitespace-pre-wrap">
        {parts.map((part, i) => {
          const m = part.match(/^\[ref:([^\]]+)\]$/);
          if (!m) return <Fragment key={i}>{part}</Fragment>;
          const id = m[1];
          const ref = id ? refMap.get(id) : undefined;
          if (!ref) return <Fragment key={i}>{part}</Fragment>;
          const chip = (
            <sup className="ml-0.5 font-mono text-[0.7rem] text-accent">
              [{ref.n}]
            </sup>
          );
          return ref.url ? (
            <a
              key={i}
              href={ref.url}
              target="_blank"
              rel="noopener noreferrer"
              title={ref.label}
              className="no-underline hover:text-accent"
            >
              {chip}
            </a>
          ) : (
            <span key={i} title={ref.label} className="cursor-help">
              {chip}
            </span>
          );
        })}
      </div>
      {refs.length > 0 && (
        <div className="mt-6 border-t border-border/50 pt-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Sources
          </div>
          <ol className="space-y-1.5 text-xs font-mono text-muted-foreground">
            {refs.map((ref) => (
              <li key={ref.id} className="flex gap-2">
                <span className="shrink-0 text-accent">[{ref.n}]</span>
                {ref.url ? (
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-foreground/80 hover:text-accent hover:underline"
                  >
                    {ref.label}
                  </a>
                ) : (
                  <span className="truncate text-foreground/80">
                    {ref.label}
                  </span>
                )}
                <span className="truncate text-muted-foreground/60">
                  {ref.id}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
