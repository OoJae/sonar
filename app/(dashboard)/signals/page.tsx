import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { ThesisSchema, type Thesis } from "@/lib/agent/thesis";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FlowChart } from "@/components/flow-chart";
import { getEtfSummaryHistory } from "@/lib/sosovalue/client";
import type { EtfAsset } from "@/lib/agent/thesis";

export const dynamic = "force-dynamic";

async function loadLatestThesis(): Promise<Thesis | null> {
  try {
    const rows = await db()
      .select()
      .from(schema.theses)
      .orderBy(desc(schema.theses.generatedAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const parsed = ThesisSchema.safeParse(row.payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function loadFlowSeries(asset: EtfAsset) {
  const res = await getEtfSummaryHistory(asset);
  // Live API is reverse-chronological; flip then take the last 21 sessions.
  const chronological = [...(res.data.data ?? [])].reverse();
  return chronological.slice(-21).map((p) => ({
    date: p.date.slice(5),
    value: p.total_net_inflow ?? 0,
  }));
}

export default async function SignalsPage() {
  const thesis = await loadLatestThesis();

  if (!thesis) {
    return <EmptyState />;
  }

  const citedAssets = new Set(
    thesis.signals.etfFlowSignal.map((s) => s.asset),
  );
  const assets = [...citedAssets].slice(0, 3);
  const flowData = await Promise.all(assets.map(loadFlowSeries));

  return (
    <div className="space-y-10">
      <Header thesis={thesis} />
      <Allocations thesis={thesis} />
      <div className="grid gap-6 lg:grid-cols-2">
        {assets.map((asset, i) => (
          <Card key={asset} className="bg-card/70">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {asset} ETF net flows
                </CardTitle>
                <span className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  last 21 sessions
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <FlowChart data={flowData[i] ?? []} />
            </CardContent>
          </Card>
        ))}
      </div>
      <Reasoning thesis={thesis} />
      <NewsBlock thesis={thesis} />
    </div>
  );
}

function Header({ thesis }: { thesis: Thesis }) {
  const modeLabel = thesis.mode === "trade" ? "Trade" : "No trade";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="mono text-[10px] uppercase tracking-[0.2em]"
        >
          thesis / {thesis.id.slice(0, 8)}
        </Badge>
        <Badge
          className="mono text-[10px] uppercase tracking-[0.2em]"
          variant={thesis.mode === "trade" ? "default" : "secondary"}
        >
          {modeLabel}
        </Badge>
        <span className="mono text-[11px] text-muted-foreground">
          as of {new Date(thesis.asOf).toISOString().replace("T", " ").slice(0, 16)}Z
        </span>
      </div>
      <h1 className="max-w-3xl text-3xl font-semibold tracking-tight">
        {headline(thesis)}
      </h1>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mono uppercase tracking-[0.16em]">
        <span>universe: {thesis.universe.join(", ")}</span>
        <span>signals: {thesis.signals.etfFlowSignal.length + thesis.signals.newsSignals.length}</span>
        <span>hedges: {thesis.hedges.length}</span>
      </div>
    </div>
  );
}

function headline(thesis: Thesis) {
  const primary = thesis.proposedAllocations
    .slice()
    .sort((a, b) => Math.abs(b.deltaFromCurrent) - Math.abs(a.deltaFromCurrent))[0];
  if (!primary) return "No change to index allocations.";
  const direction = primary.deltaFromCurrent > 0 ? "Lean into" : "Trim";
  return `${direction} ${primary.index} at ${(primary.targetWeight * 100).toFixed(0)}% of book.`;
}

function Allocations({ thesis }: { thesis: Thesis }) {
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">Proposed allocations</CardTitle>
        <CardDescription>Weights sum ≤ 1; residual held in USSI. Delta is informational (fractional weight points).</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Index</TableHead>
              <TableHead className="text-right">Target weight</TableHead>
              <TableHead className="text-right">Delta (pp)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {thesis.proposedAllocations.map((a) => (
              <TableRow key={a.index}>
                <TableCell className="mono">{a.index}.ssi</TableCell>
                <TableCell className="mono text-right">
                  {(a.targetWeight * 100).toFixed(1)}%
                </TableCell>
                <TableCell
                  className={`mono text-right ${
                    a.deltaFromCurrent >= 0
                      ? "text-[color:var(--positive)]"
                      : "text-[color:var(--negative)]"
                  }`}
                >
                  {a.deltaFromCurrent >= 0 ? "+" : ""}
                  {(a.deltaFromCurrent * 100).toFixed(1)}pp
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Reasoning({ thesis }: { thesis: Thesis }) {
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">Reasoning</CardTitle>
        <CardDescription>
          Inline [ref:id] tags link back to signal ids in this thesis.
        </CardDescription>
      </CardHeader>
      <CardContent className="prose prose-invert max-w-none text-sm leading-7 text-foreground/90 whitespace-pre-wrap">
        {thesis.reasoning}
      </CardContent>
      <Separator />
      <CardContent>
        <div className="mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Risk notes
        </div>
        <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground space-y-1">
          {thesis.riskNotes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function NewsBlock({ thesis }: { thesis: Thesis }) {
  if (thesis.signals.newsSignals.length === 0) return null;
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">News signals</CardTitle>
        <CardDescription>
          Every item carries a stance and confidence.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {thesis.signals.newsSignals.slice(0, 8).map((n) => (
            <li
              key={n.id}
              className="flex items-start justify-between gap-4 border-b border-border/60 pb-3 last:border-b-0"
            >
              <div className="flex-1">
                <a
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-foreground hover:text-[color:var(--gold)]"
                >
                  {n.headline}
                </a>
                <div className="mono mt-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {n.currency} · {n.category}
                </div>
              </div>
              <Badge
                variant={n.stance === "bearish" ? "destructive" : "secondary"}
                className="mono text-[10px] uppercase tracking-[0.18em]"
              >
                {n.stance} · {n.confidence.toFixed(2)}
              </Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <Badge
        variant="outline"
        className="mono text-[10px] uppercase tracking-[0.18em]"
      >
        no theses yet
      </Badge>
      <h2 className="max-w-xl text-2xl font-semibold tracking-tight">
        The agent has not run yet.
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Populate <span className="mono">MIMO_API_KEY</span> and{" "}
        <span className="mono">DATABASE_URL</span> in{" "}
        <span className="mono">.env.local</span>, then POST to{" "}
        <span className="mono">/api/agent/run</span> or wait for the daily cron.
      </p>
    </div>
  );
}

function formatUSD(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
