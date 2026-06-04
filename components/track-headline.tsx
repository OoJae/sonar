import Link from "next/link";
import { computeTrackData } from "@/lib/track/compute";

// Compact "proven performance" strip for the top of /signals: Sonar's book
// return versus a buy-and-hold baseline since inception, linking to the full
// /track page. Answers the Wave 1 "more design than validated strategy" note by
// surfacing the verifiable record instead of burying it in a nav tab. Renders
// nothing until there are at least two NAV snapshot batches to compare.
export async function TrackHeadline() {
  let book: number;
  let baseline: number;
  let winRate: number | null;
  try {
    const data = await computeTrackData();
    if (data.curve.length < 2) return null;
    book = data.bookReturnPct;
    baseline = data.baselineReturnPct;
    winRate = data.winRate;
  } catch {
    return null;
  }

  const excess = book - baseline;
  const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  const tone = (n: number) =>
    n >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]";

  return (
    <Link
      href="/track"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-border bg-card/70 px-4 py-3 transition-colors hover:border-[color:var(--gold)]/50"
    >
      <span className="mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        track record
      </span>
      <Stat label="Sonar book" value={fmt(book)} cls={tone(book)} />
      <Stat label="Buy and hold" value={fmt(baseline)} cls={tone(baseline)} />
      <Stat label="Excess" value={fmt(excess)} cls={tone(excess)} />
      {winRate !== null ? (
        <Stat
          label="Win rate"
          value={`${(winRate * 100).toFixed(0)}%`}
          cls="text-foreground"
        />
      ) : null}
      <span className="mono ml-auto text-[10px] uppercase tracking-[0.18em] text-[color:var(--gold)]">
        view track record
      </span>
    </Link>
  );
}

function Stat({
  label,
  value,
  cls,
}: {
  label: string;
  value: string;
  cls: string;
}) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <span className={`mono text-sm ${cls}`}>{value}</span>
    </span>
  );
}
