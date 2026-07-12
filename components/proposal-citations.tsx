import { Fragment } from "react";
import { safeHttpUrl } from "@/lib/utils/url";
import type { Evidence } from "@/lib/proposals/schema";

// The [ref:id] renderer for a proposal rationale. Same superscript + Sources UX
// as reasoning-with-citations, resolving ids against the proposal's evidence and
// citations instead of the thesis signal shape.

type Resolved = { id: string; n: number; url: string | null; label: string };

function resolveRefs(
  rationale: string,
  evidence: Evidence[],
  citations: { ref: string; url: string }[],
): Resolved[] {
  const out = new Map<string, Resolved>();
  for (const m of rationale.matchAll(/\[ref:([^\]]+)\]/g)) {
    const id = m[1];
    if (!id || out.has(id)) continue;
    const ev = evidence.find((e) => e.id === id);
    const cite = citations.find((c) => c.ref === id);
    let url: string | null = null;
    let label = id;
    if (ev) {
      url = ev.url ? safeHttpUrl(ev.url) : null;
      label = ev.label;
    } else if (cite) {
      url = safeHttpUrl(cite.url);
      label = cite.ref;
    }
    out.set(id, { id, n: out.size + 1, url, label });
  }
  return [...out.values()];
}

export function ProposalCitations({
  rationale,
  evidence,
  citations,
}: {
  rationale: string;
  evidence: Evidence[];
  citations: { ref: string; url: string }[];
}) {
  const refs = resolveRefs(rationale, evidence, citations);
  const refMap = new Map(refs.map((r) => [r.id, r]));
  const parts = rationale.split(/(\[ref:[^\]]+\])/g);

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
                  <span className="truncate text-foreground/80">{ref.label}</span>
                )}
                <span className="truncate text-muted-foreground/60">{ref.id}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
