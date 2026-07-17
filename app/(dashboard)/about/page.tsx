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
    body: "Four layers sit between a decision and the venue: a dust floor, a per-order cap, a per-cycle cap, and position caps bounding the book itself. The gate downsizes or blocks; it never trusts the model's sizing. It governs orders that reach the exchange, so the simulated SSI index legs, which move no money, are sized against the book instead.",
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
    body: "A user signs a scoped, expiring, revocable EIP-712 grant (markets + max notional). When enforcement is enabled, the executor checks it before every order. It is opt-in and off for the autonomous cron by default, so the demo runs without it. App-level enforcement, honestly labeled.",
  },
  {
    title: "Human approval on mainnet",
    body: "On mainnet the daily cycle cannot submit an order. It records the risk-capped order and stops; only an authenticated approval places it. The operator approves the number that reaches the wire, not the model's request.",
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
          and rebalances an index book priced off on-chain composition, with
          live perp hedges behind a risk engine. Everything it does is
          published: the reasoning, the trades, the failures, and the P&L.
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
              order is sized. The risk gate then caps every order that reaches
              the venue: dust floor, per-order, per-cycle, and position caps.
            </li>
            <li>
              <span className="mono text-foreground">4. Execute.</span> SSI
              rebalance legs are simulated against the book; perp hedges go to
              SoDEX as EIP-712 signed orders. On testnet they fire; on mainnet
              the cycle records them for human approval and submits nothing.
              A second, rules-based delta-neutral strategy runs its own book
              beside the directional one (on testnet and paper; it needs both
              legs to execute together, so it stands down on mainnet).
            </li>
            <li>
              <span className="mono text-foreground">5. Publish.</span> Thesis,
              fills, NAV snapshots, risk state, and the forward tests of every
              AI-designed index proposal land on this dashboard and the{" "}
              <Link href="/docs" className="text-accent hover:underline">
                public API and MCP tools
              </Link>
              .
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
            here is investment advice. Delegation is an app-layer control (the
            venue does not verify grants) and is opt-in, off by default for the
            autonomous cron; index proposals are priced design artifacts, not
            on-chain products. The SSI legs are simulated
            in every mode: Sonar reads each index composition on-chain and prices
            it live, but it does not mint or burn, so the index book is an
            accounting of what those weights would do.
          </p>
          <p>
            The gated mainnet path has been exercised once against the live SoDEX
            venue: a human-approved BTC-PERP long filled at $62,802 and was closed
            reduce-only minutes later, a round trip costing about a cent on a $12
            balance. The order could not reach the venue until a person approved
            it. That is one verification fill with symbolic capital, not a
            live-money track record; the fund runs on testnet. On-chain grant
            enforcement, SSI index creation, and the Mirror Protocol bridge remain
            designs with no implementation behind them.
          </p>
          <p>
            The credibility claim is narrower and stronger: every number on this
            site traces to a cited thesis, a logged run, or a signed venue fill,
            and the failures are published next to the wins.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
