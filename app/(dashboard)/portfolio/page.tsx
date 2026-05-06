import { getPositions, recentTrades } from "@/lib/sodex/paper";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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

export const dynamic = "force-dynamic";

async function load() {
  try {
    const [positions, trades] = await Promise.all([
      getPositions(),
      recentTrades(15),
    ]);
    return { positions, trades, error: null as string | null };
  } catch (err) {
    return {
      positions: [],
      trades: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function PortfolioPage() {
  const { positions, trades, error } = await load();
  const equity = positions.reduce(
    (acc, p) => acc + p.markPrice * p.quantity,
    0,
  );
  const unrealized = positions.reduce((acc, p) => acc + p.unrealizedPnlUSD, 0);

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="mono text-[10px] uppercase tracking-[0.18em]"
          >
            paper portfolio
          </Badge>
          <Badge
            variant="secondary"
            className="mono text-[10px] uppercase tracking-[0.18em]"
          >
            wave 1 / simulated execution
          </Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Book</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every trade is stamped with the thesis that authorized it. Wave 2
          swaps the engine for live SoDEX execution without changing the shape.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <StatCard label="Book equity" value={formatUSD(equity)} />
        <StatCard
          label="Unrealized P&L"
          value={`${unrealized >= 0 ? "+" : ""}${formatUSD(unrealized)}`}
          tone={unrealized >= 0 ? "positive" : "negative"}
        />
        <StatCard label="Open positions" value={String(positions.length)} />
      </div>

      {error ? (
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Database not reachable</CardTitle>
            <CardDescription>
              Point <span className="mono">DATABASE_URL</span> at a Supabase or
              Neon instance, run <span className="mono">pnpm db:push</span>,
              then reload.
            </CardDescription>
          </CardHeader>
          <CardContent className="mono text-[11px] text-muted-foreground">
            {error}
          </CardContent>
        </Card>
      ) : (
        <>
          <PositionsTable positions={positions} />
          <TradesTable trades={trades} />
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-[color:var(--positive)]"
      : tone === "negative"
      ? "text-[color:var(--negative)]"
      : "text-foreground";
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-1">
        <CardTitle className="mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className={`mono text-3xl ${toneClass}`}>{value}</CardContent>
    </Card>
  );
}

function PositionsTable({
  positions,
}: {
  positions: Awaited<ReturnType<typeof getPositions>>;
}) {
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">Positions</CardTitle>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open positions. Run the agent to generate a thesis and rebalance.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Market</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Avg entry</TableHead>
                <TableHead className="text-right">Mark</TableHead>
                <TableHead className="text-right">Unrealized</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((p) => (
                <TableRow key={p.market}>
                  <TableCell className="mono">{p.market}</TableCell>
                  <TableCell className="mono uppercase text-xs tracking-[0.16em] text-muted-foreground">
                    {p.side}
                  </TableCell>
                  <TableCell className="mono text-right">
                    {p.quantity.toFixed(4)}
                  </TableCell>
                  <TableCell className="mono text-right">
                    {formatUSD(p.avgEntryPrice)}
                  </TableCell>
                  <TableCell className="mono text-right">
                    {formatUSD(p.markPrice)}
                  </TableCell>
                  <TableCell
                    className={`mono text-right ${
                      p.unrealizedPnlUSD >= 0
                        ? "text-[color:var(--positive)]"
                        : "text-[color:var(--negative)]"
                    }`}
                  >
                    {p.unrealizedPnlUSD >= 0 ? "+" : ""}
                    {formatUSD(p.unrealizedPnlUSD)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TradesTable({
  trades,
}: {
  trades: Awaited<ReturnType<typeof recentTrades>>;
}) {
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">Recent trades</CardTitle>
        <CardDescription>
          Each row links back to the thesis that authorized it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <p className="text-sm text-muted-foreground">No paper trades yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Market</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Notional</TableHead>
                <TableHead className="text-right">Fill</TableHead>
                <TableHead>Thesis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((row) => {
                const t = row.trade;
                const thesisDate = row.thesisGeneratedAt
                  ? row.thesisGeneratedAt
                      .toISOString()
                      .replace("T", " ")
                      .slice(5, 16)
                  : null;
                const chipText = thesisDate ?? t.thesisId.slice(0, 8);
                return (
                  <TableRow key={t.id}>
                    <TableCell className="mono text-[11px] text-muted-foreground">
                      {t.executedAt
                        .toISOString()
                        .replace("T", " ")
                        .slice(5, 16)}
                    </TableCell>
                    <TableCell className="mono">{t.market}</TableCell>
                    <TableCell className="mono uppercase text-xs tracking-[0.16em] text-muted-foreground">
                      {t.side}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatUSD(Number(t.notionalUsd))}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatUSD(Number(t.fillPrice))}
                    </TableCell>
                    <TableCell className="text-[11px]">
                      {row.thesisRunId ? (
                        <a
                          href={`/log#run-${row.thesisRunId}`}
                          className="mono text-muted-foreground hover:text-accent hover:underline"
                          title={t.thesisId}
                        >
                          {chipText}
                          {row.thesisMode ? (
                            <span className="ml-2 uppercase tracking-[0.14em] text-accent">
                              {row.thesisMode}
                            </span>
                          ) : null}
                        </a>
                      ) : (
                        <span
                          className="mono text-muted-foreground"
                          title={t.thesisId}
                        >
                          {chipText}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function formatUSD(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  if (abs >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}
