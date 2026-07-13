import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { computeRiskMetrics, type RiskMetrics } from "@/lib/risk/metrics";
import { env } from "@/lib/utils/env";

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  const e = env();
  let metrics: RiskMetrics | null = null;
  let error: string | null = null;
  try {
    metrics = await computeRiskMetrics(e.SONAR_VAR_CONFIDENCE);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const cap = e.SONAR_MAX_DRAWDOWN_PCT;
  const breached =
    metrics?.hasEnoughData != null &&
    metrics.hasEnoughData &&
    metrics.currentDrawdownPct >= cap;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <Badge
          variant="outline"
          className="mono w-fit text-[10px] uppercase tracking-[0.18em]"
        >
          risk control
        </Badge>
        <h1 className="display text-4xl tracking-tight">Risk</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Portfolio-level risk measured off the reconstructed book: historical
          Value-at-Risk, drawdown against an enforced cap, index correlation, and
          concentration. When drawdown breaches the cap the cycle de-risks, the
          same server-side control as the macro circuit breaker.
        </p>
      </div>

      {error || !metrics || !metrics.hasEnoughData ? (
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Not enough history yet</CardTitle>
            <CardDescription>
              Risk metrics need at least a few agent cycles of NAV snapshots.
              Trigger cycles (POST /api/agent/run) or wait for the daily cron.
            </CardDescription>
          </CardHeader>
          {error ? (
            <CardContent className="mono text-[11px] text-muted-foreground">
              {error}
            </CardContent>
          ) : null}
        </Card>
      ) : (
        <>
          {breached ? (
            <div className="rounded-md border border-[color:var(--gold)]/40 bg-[color:var(--gold)]/10 px-4 py-3">
              <div className="mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--gold)]">
                drawdown control active
              </div>
              <p className="mt-1 text-sm text-foreground/90">
                Book drawdown {metrics.currentDrawdownPct.toFixed(1)}% is at or
                above the {cap}% cap. New cycles de-risk: notional capped and
                allocations tilted toward USSI until the book recovers.
              </p>
            </div>
          ) : null}

          <div className="grid gap-6 md:grid-cols-4">
            <StatCard
              label={`VaR (${Math.round(metrics.varConfidence * 100)}%)`}
              value={`${metrics.varPct.toFixed(2)}%`}
              sub="one-cycle loss"
            />
            <StatCard
              label="Current drawdown"
              value={`${metrics.currentDrawdownPct.toFixed(2)}%`}
              sub={`cap ${cap}%`}
              tone={breached ? "negative" : undefined}
            />
            <StatCard
              label="Max drawdown"
              value={`${metrics.maxDrawdownPct.toFixed(2)}%`}
              sub="since inception"
            />
            <StatCard
              label="Concentration"
              value={metrics.concentrationHHI.toFixed(2)}
              sub={`HHI · ${metrics.sampleSize} cycles`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <CorrelationCard metrics={metrics} />
            <ExposureCard metrics={metrics} />
          </div>

          <Card className="bg-card/70">
            <CardHeader>
              <CardTitle className="text-base">Active controls</CardTitle>
              <CardDescription>
                The limits governing every cycle. Flip{" "}
                <span className="mono">SONAR_EXECUTION_MODE=paper</span> to stop
                live placement entirely.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Limit label="Max drawdown cap" value={`${cap}%`} />
              <Limit
                label="VaR confidence"
                value={`${Math.round(e.SONAR_VAR_CONFIDENCE * 100)}%`}
              />
              <Limit
                label="Per-order cap"
                value={`$${e.SONAR_MAX_NOTIONAL_PER_ORDER.toLocaleString()}`}
              />
              <Limit
                label="Per-cycle cap"
                value={`$${e.SONAR_MAX_NOTIONAL_PER_CYCLE.toLocaleString()}`}
              />
              <Limit
                label="Macro breaker horizon"
                value={`${e.SONAR_MACRO_HALT_HORIZON_HOURS}h`}
              />
              <Limit label="Dust floor" value="$10" />
            </CardContent>
          </Card>
        </>
      )}
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
  tone?: "negative";
}) {
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-1">
        <CardTitle className="mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`mono text-3xl ${
            tone === "negative" ? "text-[color:var(--negative)]" : "text-foreground"
          }`}
        >
          {value}
        </div>
        {sub ? (
          <div className="mono mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {sub}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CorrelationCard({ metrics }: { metrics: RiskMetrics }) {
  const { indices, matrix } = metrics.correlation;
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">Index correlation</CardTitle>
        <CardDescription>
          Pairwise correlation of per-cycle NAV returns. High positive values
          mean the risk legs move together, so diversification is weaker.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `3rem repeat(${indices.length}, 1fr)` }}
        >
          <div />
          {indices.map((i) => (
            <div
              key={`h-${i}`}
              className="mono text-center text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
            >
              {i}
            </div>
          ))}
          {indices.map((ri, r) => (
            <RowFragment
              key={ri}
              label={ri}
              cells={matrix[r] ?? []}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RowFragment({
  label,
  cells,
}: {
  label: string;
  cells: (number | null)[];
}) {
  return (
    <>
      <div className="mono flex items-center text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      {cells.map((c, i) => {
        const v = c ?? 0;
        // Positive correlation tints gold (concentrated risk), negative tints
        // accent (diversifying). Opacity scales with magnitude.
        const tint = v >= 0 ? "var(--gold)" : "var(--accent)";
        const bg = `color-mix(in srgb, ${tint} ${Math.round(Math.abs(v) * 55)}%, transparent)`;
        return (
          <div
            key={i}
            className="mono flex h-10 items-center justify-center rounded text-xs"
            style={{ backgroundColor: bg }}
          >
            {c === null ? "n/a" : v.toFixed(2)}
          </div>
        );
      })}
    </>
  );
}

function ExposureCard({ metrics }: { metrics: RiskMetrics }) {
  const max = Math.max(0.0001, ...metrics.exposure.map((x) => x.weight));
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">Exposure by index</CardTitle>
        <CardDescription>
          Current book weight per index. USSI is the stable anchor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {metrics.exposure.map((x) => (
          <div key={x.index} className="flex items-center gap-3">
            <div className="mono w-14 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {x.index}
            </div>
            <div className="h-3 flex-1 overflow-hidden rounded bg-border/40">
              <div
                className="h-full rounded bg-[color:var(--gold)]/70"
                style={{ width: `${(x.weight / max) * 100}%` }}
              />
            </div>
            <div className="mono w-28 text-right text-xs">
              {(x.weight * 100).toFixed(1)}%
              <span className="ml-2 text-muted-foreground">
                ${x.marketValueUsd.toFixed(0)}
              </span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-card/40 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="mono text-sm">{value}</span>
    </div>
  );
}
