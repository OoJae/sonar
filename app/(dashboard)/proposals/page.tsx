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
import { ProposalForm } from "@/components/proposal-form";
import { ProposalCitations } from "@/components/proposal-citations";
import { NavChart } from "@/components/nav-chart";
import { listProposals } from "@/lib/proposals/store";
import { computeArena, type ArenaEntry } from "@/lib/proposals/arena";
import type { StoredProposal } from "@/lib/proposals/schema";
import { SSI_PROTOCOL } from "@/lib/ssi/addresses";

export const dynamic = "force-dynamic";

function formatPrice(n: number): string {
  if (n >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toPrecision(3)}`;
}

export default async function ProposalsPage() {
  const proposals = await listProposals();
  const arena = await computeArena(proposals.map((p) => p.id));
  const ranked = proposals
    .map((p) => ({ p, entry: arena.get(p.id) }))
    .filter(
      (x): x is { p: StoredProposal; entry: ArenaEntry } =>
        x.entry !== undefined && x.entry.returnSincePct !== null,
    )
    .sort((a, b) => b.entry.returnSincePct! - a.entry.returnSincePct!);

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="mono text-[10px] uppercase tracking-[0.2em]"
          >
            custom indices
          </Badge>
          <Badge
            variant="secondary"
            className="mono text-[10px] uppercase tracking-[0.2em]"
          >
            design artifact
          </Badge>
        </div>
        <h1 className="display text-4xl tracking-tight">Proposals</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The agent designs new themed indices on demand. Give it a theme and it
          proposes a basket of constituents with target weights, prices the basket
          against live SoSoValue data, and writes a cited rationale. Each proposal
          is a design that maps onto SSI Protocol on-chain index creation; nothing
          is created on-chain and no funds move.
        </p>
      </div>

      <ProposalForm />

      {ranked.length > 0 ? (
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Forward-test leaderboard</CardTitle>
            <CardDescription>
              Every proposal accrues a daily paper-priced forward test from the
              moment it is designed (indexed to 100 at creation). A design that
              cannot survive its own forward test does not deserve a tokenset.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {ranked.map(({ p, entry }, i) => (
                <span
                  key={p.id}
                  className="inline-flex items-baseline gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-1.5"
                >
                  <span className="mono text-[10px] text-muted-foreground">
                    #{i + 1}
                  </span>
                  <span className="mono text-xs text-accent">{p.symbol}</span>
                  <span
                    className={`mono text-xs ${
                      entry.returnSincePct! >= 0
                        ? "text-[color:var(--positive)]"
                        : "text-[color:var(--negative)]"
                    }`}
                  >
                    {entry.returnSincePct! >= 0 ? "+" : ""}
                    {entry.returnSincePct!.toFixed(2)}%
                  </span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {proposals.length === 0 ? (
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">No proposals yet</CardTitle>
            <CardDescription>
              Enter a theme above to have the agent design the first custom index.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-6">
          {proposals.map((p) => (
            <ProposalCard key={p.id} p={p} entry={arena.get(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  p,
  entry,
}: {
  p: StoredProposal;
  entry?: ArenaEntry;
}) {
  const priceBySymbol = new Map(p.pricing.marks.map((m) => [m.symbol, m.priceUsd]));
  const nav = p.pricing.perUnitNavUsd;
  return (
    <Card className="bg-card/70">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="mono text-[10px] uppercase tracking-[0.16em] text-accent"
          >
            {p.symbol}
          </Badge>
          <CardTitle className="text-base">{p.name}</CardTitle>
          <span className="mono text-[11px] text-muted-foreground">
            theme: {p.theme}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatChip label="Coverage" value={p.pricing.coverage} />
          <StatChip
            label="Priced weight"
            value={`${(p.pricing.pricedWeight * 100).toFixed(0)}%`}
          />
          <StatChip
            label="NAV per unit"
            value={nav === null ? "unavailable" : formatPrice(nav)}
            tone={nav === null ? undefined : "accent"}
          />
          <StatChip label="Constituents" value={String(p.constituents.length)} />
          {entry && entry.returnSincePct !== null ? (
            <StatChip
              label="Forward test"
              value={`${entry.returnSincePct >= 0 ? "+" : ""}${entry.returnSincePct.toFixed(2)}%`}
              tone="accent"
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead className="text-right">Target weight</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Mark</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.constituents.map((c) => {
              const price = priceBySymbol.get(c.symbol) ?? null;
              return (
                <TableRow key={c.symbol}>
                  <TableCell className="mono">{c.symbol}</TableCell>
                  <TableCell className="mono text-right">
                    {(c.targetWeight * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell className="mono text-right">
                    {price === null ? "-" : formatPrice(price)}
                  </TableCell>
                  <TableCell className="mono text-right text-[11px] uppercase tracking-[0.14em]">
                    {price === null ? (
                      <span className="text-muted-foreground">no price</span>
                    ) : (
                      <span className="text-[color:var(--positive)]">priced</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {entry && entry.points.length >= 2 ? (
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Forward test since creation (indexed to 100; paper-priced, not
              investable)
            </div>
            <NavChart
              data={entry.points.map((pt) => ({ asOf: pt.asOf, nav: pt.value }))}
              label={`${p.symbol} forward test`}
              format="index"
            />
          </div>
        ) : null}

        <div>
          <ProposalCitations
            rationale={p.rationale}
            evidence={p.evidence}
            citations={p.citations}
          />
        </div>

        <div>
          <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Risk notes
          </div>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {p.riskNotes.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent">-</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-border/60 bg-card/40 p-4">
          <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
            On-chain mapping (design only)
          </div>
          <p className="text-xs text-muted-foreground">
            Sonar does not create this index on-chain in this build. On SSI
            Protocol (Base, chainId 8453), an index like this maps onto
            AssetFactory (<span className="mono">{SSI_PROTOCOL.factory}</span>),
            which deploys the AssetToken, and AssetIssuer (
            <span className="mono">{SSI_PROTOCOL.issuer}</span>), which issues
            shares against a deposited tokenset. This proposal is a priced design
            artifact; it is not a transaction and moves no funds.
          </p>
        </div>
      </CardContent>
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
  tone?: "accent";
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-md border border-border/60 bg-card/40 px-2.5 py-1">
      <span className="mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <span
        className={`mono text-xs ${tone === "accent" ? "text-accent" : "text-foreground"}`}
      >
        {value}
      </span>
    </span>
  );
}
