import { asc } from "drizzle-orm";
import { getPositions, recentTrades } from "@/lib/sodex/paper";
import { db, schema } from "@/lib/db/client";
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
import { NavChart, type NavPoint } from "@/components/nav-chart";
import { BalancePanel } from "@/components/balance-panel";
import { getAgentBalances } from "@/lib/chain/balances";
import { executionModeLabel } from "@/lib/utils/mode";

export const dynamic = "force-dynamic";

type NavSeries = Record<string, NavPoint[]>;

type Position = Awaited<ReturnType<typeof getPositions>>[number];

type StrategyStats = {
  longUsd: number;
  shortUsd: number;
  netUsd: number; // long - short (net market exposure)
  grossUsd: number; // long + short (capital deployed across both legs)
  unrealized: number;
  count: number;
};

// quantity is stored as a magnitude (the sign lives in `side`), so
// markPrice * quantity is non-negative and summing by side yields long/short
// dollars; unrealizedPnlUSD already carries its own sign.
function strategyStats(ps: Position[]): StrategyStats {
  let longUsd = 0;
  let shortUsd = 0;
  let unrealized = 0;
  for (const p of ps) {
    const mv = p.markPrice * p.quantity;
    if (p.side === "long") longUsd += mv;
    else shortUsd += mv;
    unrealized += p.unrealizedPnlUSD;
  }
  return {
    longUsd,
    shortUsd,
    netUsd: longUsd - shortUsd,
    grossUsd: longUsd + shortUsd,
    unrealized,
    count: ps.length,
  };
}

async function loadNavSeries(): Promise<NavSeries> {
  try {
    const rows = await db()
      .select({
        index: schema.navSnapshots.index,
        navPerShareUsd: schema.navSnapshots.navPerShareUsd,
        asOf: schema.navSnapshots.asOf,
      })
      .from(schema.navSnapshots)
      .orderBy(asc(schema.navSnapshots.asOf));
    const byIndex: NavSeries = {};
    for (const r of rows) {
      const arr = (byIndex[r.index] ??= []);
      arr.push({
        asOf: r.asOf.toISOString(),
        nav: Number(r.navPerShareUsd),
      });
    }
    return byIndex;
  } catch {
    return {};
  }
}

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
  const navSeries = await loadNavSeries();
  const agentBalances = await getAgentBalances();
  const directional = positions.filter((p) => p.strategy === "directional");
  const deltaNeutral = positions.filter((p) => p.strategy === "delta-neutral");
  const dirStats = strategyStats(directional);
  const dnStats = strategyStats(deltaNeutral);
  const netExposure = dirStats.netUsd + dnStats.netUsd;
  const unrealized = dirStats.unrealized + dnStats.unrealized;
  const openCount = directional.length + deltaNeutral.length;

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="mono text-[10px] uppercase tracking-[0.18em]"
          >
            portfolio
          </Badge>
          <Badge
            variant="secondary"
            className="mono text-[10px] uppercase tracking-[0.18em]"
            title="SONAR_EXECUTION_MODE"
          >
            {executionModeLabel()}
          </Badge>
        </div>
        <h1 className="display text-4xl tracking-tight">Book</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every trade is stamped with the thesis that authorized it. Perp hedges
          fire as EIP-712 signed orders on SoDEX testnet; SSI rebalance legs are
          recorded against the book. The executor speaks one contract, so the
          mode badge above is the only thing that changes between paper and live.
          Two strategies now run side by side, each keeping its own isolated book:
          a directional SSI rotation and a rules-based delta-neutral carry.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <StatCard label="Net exposure" value={formatUSD(netExposure)} />
        <StatCard
          label="Unrealized P&L"
          value={`${unrealized >= 0 ? "+" : ""}${formatUSD(unrealized)}`}
          tone={unrealized >= 0 ? "positive" : "negative"}
        />
        <StatCard label="Open positions" value={String(openCount)} />
      </div>

      <BalancePanel agent={agentBalances} />

      <NavSection navSeries={navSeries} />

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
          <div className="space-y-6">
            <StrategySection
              title="Directional"
              tag="SSI rotation"
              description="ETF-flow-driven rotation across the SSI baskets; long only, weights follow the daily thesis."
              stats={dirStats}
              positions={directional}
              emptyCopy="No directional positions yet. Run a cycle to generate a thesis and rebalance."
            />
            <StrategySection
              title="Delta-neutral"
              tag="rules-based carry"
              accent
              showNeutrality
              description="Long the basket, short a sized BTC perp, so net crypto beta is about zero."
              stats={dnStats}
              positions={deltaNeutral}
              emptyCopy="Establishes its book on the next priced cycle: long the MAG7 basket, short a BTC-USD perp sized to the basket BTC weight, net crypto beta about zero."
            />
          </div>
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

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "accent";
}) {
  const toneClass =
    tone === "positive"
      ? "text-[color:var(--positive)]"
      : tone === "negative"
      ? "text-[color:var(--negative)]"
      : tone === "accent"
      ? "text-accent"
      : "text-foreground";
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-md border border-border/60 bg-card/40 px-2.5 py-1">
      <span className="mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <span className={`mono text-xs ${toneClass}`}>{value}</span>
    </span>
  );
}

function StrategySection({
  title,
  tag,
  description,
  stats,
  positions,
  emptyCopy,
  accent = false,
  showNeutrality = false,
}: {
  title: string;
  tag: string;
  description: string;
  stats: StrategyStats;
  positions: Position[];
  emptyCopy: string;
  accent?: boolean;
  showNeutrality?: boolean;
}) {
  return (
    <Card className="bg-card/70">
      <CardHeader className="gap-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge
            variant="outline"
            className={`mono text-[10px] uppercase tracking-[0.16em] ${
              accent ? "text-accent" : "text-muted-foreground"
            }`}
          >
            {tag}
          </Badge>
        </div>
        <CardDescription>{description}</CardDescription>
        <div className="flex flex-wrap gap-2">
          {showNeutrality ? (
            <>
              <StatChip label="Long" value={formatUSD(stats.longUsd)} />
              <StatChip label="Short" value={formatUSD(stats.shortUsd)} />
              <StatChip
                label="Net"
                value={formatUSD(stats.netUsd)}
                tone="accent"
              />
            </>
          ) : (
            <StatChip label="Net exposure" value={formatUSD(stats.netUsd)} />
          )}
          <StatChip
            label="Unrealized"
            value={`${stats.unrealized >= 0 ? "+" : ""}${formatUSD(
              stats.unrealized,
            )}`}
            tone={stats.unrealized >= 0 ? "positive" : "negative"}
          />
          <StatChip label="Positions" value={String(stats.count)} />
        </div>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyCopy}</p>
        ) : (
          <PositionsTable positions={positions} />
        )}
      </CardContent>
    </Card>
  );
}

function PositionsTable({ positions }: { positions: Position[] }) {
  return (
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
                    <TableCell className="mono">
                      <div className="flex flex-col leading-tight">
                        <span>{t.market}</span>
                        <span
                          className={`mono text-[9px] uppercase tracking-[0.14em] ${
                            t.strategy === "delta-neutral"
                              ? "text-accent"
                              : "text-muted-foreground"
                          }`}
                        >
                          {t.strategy}
                        </span>
                      </div>
                    </TableCell>
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

const INDEX_ORDER = ["MAG7", "DEFI", "MEME", "USSI"] as const;

function NavSection({ navSeries }: { navSeries: NavSeries }) {
  const haveAny = INDEX_ORDER.some((idx) => (navSeries[idx]?.length ?? 0) > 0);
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">NAV per share</CardTitle>
        <CardDescription>
          Computed off-chain from each SSI index tokenset and live SoSoValue
          prices. USSI is the stable reference, held at $1 by definition. Dotted
          line marks inception. Each agent cycle adds a snapshot.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!haveAny ? (
          <div className="mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            No NAV snapshots yet. Trigger an agent cycle (POST /api/agent/run)
            or wait for the daily cron.
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {INDEX_ORDER.map((idx) => {
              const points = navSeries[idx] ?? [];
              if (points.length === 0) return null;
              const latest = points[points.length - 1]?.nav ?? 0;
              const inception = points[0]?.nav ?? 0;
              const deltaPct =
                inception !== 0 ? ((latest - inception) / inception) * 100 : 0;
              return (
                <div
                  key={idx}
                  className="rounded-md border border-border/60 bg-card/40 p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      {idx}.ssi
                      {idx === "USSI" ? (
                        <span className="ml-2 normal-case tracking-normal opacity-70">
                          stable reference
                        </span>
                      ) : null}
                    </span>
                    <span className="mono text-xs">
                      ${latest.toFixed(latest >= 1 ? 2 : 4)}
                      <span
                        className={`ml-2 ${
                          deltaPct >= 0
                            ? "text-[color:var(--positive)]"
                            : "text-[color:var(--negative)]"
                        }`}
                      >
                        {deltaPct >= 0 ? "+" : ""}
                        {deltaPct.toFixed(2)}%
                      </span>
                    </span>
                  </div>
                  <NavChart data={points} label={idx} />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
