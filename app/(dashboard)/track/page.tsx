import { computeTrackData } from "@/lib/track/compute";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrackChart } from "@/components/track-chart";

export const dynamic = "force-dynamic";

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function toneClass(n: number): string {
  return n >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]";
}

export default async function TrackPage() {
  let data;
  try {
    data = await computeTrackData();
  } catch {
    data = null;
  }

  if (!data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <Badge variant="outline" className="mono text-[10px] uppercase tracking-[0.18em]">
          track record
        </Badge>
        <p className="max-w-md text-sm text-muted-foreground">
          Database not reachable. The track record reads existing theses and NAV
          snapshots; no new data is required.
        </p>
      </div>
    );
  }

  const excess = data.bookReturnPct - data.baselineReturnPct;

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="mono text-[10px] uppercase tracking-[0.2em]">
            verifiable track record
          </Badge>
          <Badge variant="secondary" className="mono text-[10px] uppercase tracking-[0.2em]">
            paper + testnet
          </Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Performance</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cumulative return of Sonar&apos;s rebalanced book versus a buy-and-hold
          baseline of the same index universe, both indexed to 100 at inception.
          Computed from the dated theses, their target weights, and the on-chain
          NAV snapshots Sonar persists each cycle. This is paper plus testnet
          performance during the buildathon, not a live-money track record. The
          credibility is the verifiability: every number traces to a cited thesis.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <StatCard label="Sonar book" value={pct(data.bookReturnPct)} tone={data.bookReturnPct} />
        <StatCard label="Buy and hold" value={pct(data.baselineReturnPct)} tone={data.baselineReturnPct} />
        <StatCard label="Excess return" value={pct(excess)} tone={excess} />
        <StatCard
          label="Win rate"
          value={data.winRate === null ? "n/a" : `${(data.winRate * 100).toFixed(0)}%`}
          sub={`${data.tradeCount} trade / ${data.noTradeCount} no-trade`}
        />
      </div>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">Cumulative return vs buy-and-hold</CardTitle>
          <CardDescription>
            Gold is Sonar&apos;s rebalanced book; the dashed line is a static hold
            of the same indices from inception. Both start at 100.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TrackChart data={data.curve} />
        </CardContent>
      </Card>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">Per-thesis attribution</CardTitle>
          <CardDescription>
            Each thesis links to the run that produced it. Cycle return is the
            book move over the cycle the thesis governed; notional is the USD
            placed (live SoDEX orders plus recorded SSI rebalance legs).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Thesis</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Notional</TableHead>
                <TableHead className="text-right">Cycle return</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.attributions.slice(0, 20).map((a) => (
                <TableRow key={a.thesisId}>
                  <TableCell className="mono text-xs">
                    {a.runId ? (
                      <a
                        href={`/log#run-${a.runId}`}
                        className="text-accent hover:underline"
                        title={a.thesisId}
                      >
                        {a.generatedAt.replace("T", " ").slice(0, 16)}Z
                      </a>
                    ) : (
                      <span title={a.thesisId}>
                        {a.generatedAt.replace("T", " ").slice(0, 16)}Z
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`mono text-[10px] uppercase tracking-[0.16em] ${
                        a.mode === "trade" ? "text-accent" : "text-muted-foreground"
                      }`}
                    >
                      {a.mode}
                    </span>
                  </TableCell>
                  <TableCell className="mono text-right">
                    {a.notionalPlacedUsd > 0
                      ? `$${a.notionalPlacedUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                      : "-"}
                  </TableCell>
                  <TableCell className={`mono text-right ${a.periodReturnPct !== null ? toneClass(a.periodReturnPct) : ""}`}>
                    {a.periodReturnPct !== null ? pct(a.periodReturnPct) : "-"}
                  </TableCell>
                  <TableCell>
                    {a.win === null ? (
                      <span className="text-muted-foreground/50">-</span>
                    ) : a.win ? (
                      <Badge
                        variant="outline"
                        className="mono text-[10px] uppercase tracking-[0.18em] bg-[color:var(--positive)]/20 text-[color:var(--positive)] border border-[color:var(--positive)]/40"
                      >
                        win
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="mono text-[10px] uppercase tracking-[0.18em]">
                        loss
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: number;
}) {
  const toneCls = tone === undefined ? "" : tone >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]";
  return (
    <Card className="bg-card/70">
      <CardContent className="pt-6">
        <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </div>
        <div className={`mt-2 text-2xl font-semibold tabular-nums ${toneCls}`}>
          {value}
        </div>
        {sub ? (
          <div className="mono mt-1 text-[11px] text-muted-foreground">{sub}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
