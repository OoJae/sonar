import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const RAILS: Array<{ title: string; body: string }> = [
  {
    title: "Citation validator",
    body: "Every numeric claim in a thesis must carry an inline [ref:id] citation resolving to a signal in the same thesis. Unsourced numbers are rejected before anything trades.",
  },
  {
    title: "Risk gate",
    body: "Per-order and per-cycle notional caps, a dust floor, and a mode kill switch sit between every decision and the venue. The gate downsizes or blocks; it never trusts the model's sizing.",
  },
  {
    title: "Macro circuit breaker",
    body: "A high-impact macro event (CPI, FOMC) inside the lookahead window de-risks the cycle before it happens: caps scale down and weights tilt toward the stable reference.",
  },
  {
    title: "Drawdown guard",
    body: "When the book's drawdown crosses the configured cap, sizing is automatically scaled down until the curve recovers. Loss-triggered, on top of the calendar-triggered breaker.",
  },
  {
    title: "Session-key delegation",
    body: "A user signs a scoped, expiring, revocable EIP-712 grant (markets + max notional) that the executor enforces before every order. App-level enforcement, honestly labeled.",
  },
  {
    title: "Transparent failure",
    body: "Failed runs stay in the log next to successful ones. The track record includes the no-trade days. Honesty is the moat, not a disclaimer.",
  },
];

export default function AboutPage() {
  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="mono text-[10px] uppercase tracking-[0.2em]"
          >
            about
          </Badge>
          <Badge
            variant="secondary"
            className="mono text-[10px] uppercase tracking-[0.2em]"
          >
            honest scope
          </Badge>
        </div>
        <h1 className="display text-4xl tracking-tight">
          What Sonar is (and is not)
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Sonar is an ETF-flow-aware agentic hedge fund built for the SoSoValue
          Buildathon. An AI agent reads crypto ETF flows and structured news
          once per day, writes a research thesis where every number is cited,
          and rebalances an on-chain index book with live perp hedges, behind a
          production risk engine. Everything it does is published: the
          reasoning, the trades, the failures, and the P&L.
        </p>
      </div>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">The daily loop</CardTitle>
          <CardDescription>
            One cycle per day, after the US ETF close posts. Latency is honest:
            ETF flow data is end-of-day, so the cadence is too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm text-muted-foreground">
            <li>
              <span className="mono text-foreground">1. Ingest.</span> ETF net
              flows and categorized news from SoSoValue; on-chain index
              composition from Base via multicall.
            </li>
            <li>
              <span className="mono text-foreground">2. Reason.</span> The model
              writes a dated thesis with inline citations. The validator rejects
              any numeric claim without a source.
            </li>
            <li>
              <span className="mono text-foreground">3. Gate.</span> Macro
              calendar and drawdown state can de-risk the cycle before a single
              order is sized. The risk gate caps everything that follows.
            </li>
            <li>
              <span className="mono text-foreground">4. Execute.</span> SSI
              rebalance legs are recorded against the book; perp hedges fire as
              EIP-712 signed orders on SoDEX testnet. A second, rules-based
              delta-neutral strategy runs its own hedged book beside the
              directional one.
            </li>
            <li>
              <span className="mono text-foreground">5. Publish.</span> Thesis,
              fills, NAV snapshots, risk state, and the forward tests of every
              AI-designed index proposal land on this dashboard, the{" "}
              <Link href="/docs" className="text-accent hover:underline">
                public API and MCP tools
              </Link>
              , and Telegram.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">Safety rails</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {RAILS.map((r) => (
              <div
                key={r.title}
                className="rounded-md border border-border/60 bg-card/40 p-4"
              >
                <div className="mono text-[11px] uppercase tracking-[0.16em] text-accent mb-1">
                  {r.title}
                </div>
                <p className="text-sm text-muted-foreground">{r.body}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">Honest scope</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            This is paper plus SoDEX testnet execution during the buildathon,
            not a live-money track record. No deposits are accepted; nothing
            here is investment advice. Delegation is enforced at the application
            layer (the venue does not verify grants); index proposals are priced
            design artifacts, not on-chain products. Mainnet execution, on-chain
            grant enforcement, and SSI index creation are the demonstrated
            designs this maps onto.
          </p>
          <p>
            The credibility claim is narrower and stronger: every number on this
            site traces to a cited thesis, a logged run, or an on-chain fill,
            and the failures are published next to the wins.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
