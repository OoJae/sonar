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

const BASE = "https://sonar.my.id/api/v1";

const ENDPOINTS: Array<{ path: string; desc: string }> = [
  {
    path: "/thesis/latest",
    desc: "Latest directional research thesis: cited reasoning, allocations, hedges, risk notes.",
  },
  {
    path: "/theses?limit=20",
    desc: "Thesis history (both strategies): metadata + headline allocations. limit 1..100.",
  },
  {
    path: "/track",
    desc: "The verifiable track record: book vs buy-and-hold curve, win rate, per-thesis attribution.",
  },
  {
    path: "/risk",
    desc: "Historical VaR, drawdowns, correlation matrix, exposure, concentration.",
  },
  {
    path: "/portfolio",
    desc: "Current book split by strategy with net/gross exposure and unrealized P&L.",
  },
  {
    path: "/delta-neutral",
    desc: "The delta-neutral strategy's mark-to-market track and current book.",
  },
  {
    path: "/proposals",
    desc: "AI-designed index proposals with pricing coverage and forward-test arena state.",
  },
  {
    path: "/status",
    desc: "Version, execution mode, last cycle outcome, data freshness.",
  },
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border/60 bg-card/40 p-4 mono text-xs leading-6 text-foreground/90">
      {children}
    </pre>
  );
}

export default function DocsPage() {
  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="mono text-[10px] uppercase tracking-[0.2em]"
          >
            developers
          </Badge>
          <Badge
            variant="secondary"
            className="mono text-[10px] uppercase tracking-[0.2em]"
          >
            public / read-only
          </Badge>
        </div>
        <h1 className="display text-4xl tracking-tight">API and MCP</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Everything Sonar publishes on this dashboard is consumable as JSON and
          as MCP tools: the cited theses, the verifiable track record, the risk
          metrics, the book, and the proposal arena. No key required. Responses
          follow one contract and are rate limited per IP.
        </p>
      </div>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">REST API v1</CardTitle>
          <CardDescription>
            Base URL <span className="mono">{BASE}</span>. Every response is{" "}
            <span className="mono">{"{ ok: true, data }"}</span> or{" "}
            <span className="mono">{'{ ok: false, error: "<code>" }'}</span>.
            CORS is open; cache is 60s (status 15s); default limit 120
            requests/min per IP (429 with Retry-After beyond it).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead>Returns</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ENDPOINTS.map((e) => (
                <TableRow key={e.path}>
                  <TableCell className="mono text-xs whitespace-nowrap">
                    GET {e.path}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.desc}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Try it
            </div>
            <CodeBlock>{`curl -s ${BASE}/track | jq .data.bookReturnPct
curl -s ${BASE}/thesis/latest | jq .data.thesis.reasoning`}</CodeBlock>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">MCP (for AI agents)</CardTitle>
          <CardDescription>
            Eight tools (get_latest_thesis, get_track_record, get_risk_metrics,
            get_portfolio, get_delta_neutral_track, list_theses, list_proposals,
            get_status) over both MCP transports. Your agent reads the same
            receipts this dashboard renders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Hosted (zero install): Claude Code
            </div>
            <CodeBlock>{`claude mcp add --transport http sonar https://sonar.my.id/api/mcp`}</CodeBlock>
          </div>
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Local stdio (from the repo)
            </div>
            <CodeBlock>{`git clone https://github.com/OoJae/sonar && cd sonar && pnpm install
claude mcp add --transport stdio sonar -- npx tsx mcp-servers/sonar/index.ts`}</CodeBlock>
          </div>
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Claude Desktop (claude_desktop_config.json)
            </div>
            <CodeBlock>{`{
  "mcpServers": {
    "sonar": {
      "command": "npx",
      "args": ["tsx", "/path/to/sonar/mcp-servers/sonar/index.ts"]
    }
  }
}`}</CodeBlock>
          </div>
          <p className="text-xs text-muted-foreground">
            Both transports call the public REST API under the hood; point
            <span className="mono"> SONAR_API_BASE</span> at another deployment
            to consume it instead.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
