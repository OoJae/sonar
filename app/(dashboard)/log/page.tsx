import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { traceUrl } from "@/lib/utils/logger";
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

// Real cycles finish in ~1 to 7 minutes (max observed ~418s). A run with no
// finishedAt that started within this window is genuinely in progress; older
// than this it is treated as stalled/crashed so a row never sits on "running".
const RUNNING_GRACE_MS = 15 * 60 * 1000;

type RunStatus = {
  label: string;
  variant: "default" | "destructive" | "secondary";
  pulse: boolean;
};

function runStatus(run: {
  ok: boolean;
  startedAt: Date;
  finishedAt: Date | null;
}): RunStatus {
  if (run.finishedAt) {
    return run.ok
      ? { label: "ok", variant: "default", pulse: false }
      : { label: "failed", variant: "destructive", pulse: false };
  }
  // No finishedAt yet: in progress, unless it has been too long (stalled).
  const ageMs = Date.now() - run.startedAt.getTime();
  if (ageMs > RUNNING_GRACE_MS) {
    return { label: "failed", variant: "destructive", pulse: false };
  }
  return { label: "running", variant: "secondary", pulse: true };
}

async function load() {
  try {
    const runs = await db()
      .select()
      .from(schema.agentRuns)
      // Smoke tests must seed a run (orders.runId is a notNull FK) and land in
      // this table. They are not agent decisions, so they do not belong in the
      // decision log.
      .where(eq(schema.agentRuns.synthetic, false))
      .orderBy(desc(schema.agentRuns.startedAt))
      .limit(30);
    return { runs, error: null as string | null };
  } catch (err) {
    return {
      runs: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function LogPage() {
  const { runs, error } = await load();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <Badge
          variant="outline"
          className="mono w-fit text-[10px] uppercase tracking-[0.18em]"
        >
          transparent decision log
        </Badge>
        <h1 className="display text-4xl tracking-tight">Runs</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every agent cycle, accepted or rejected, is recorded here with its
          model, data source, and outcome. Drill into a run to read the thesis
          on the Signals page.
        </p>
      </div>

      {error ? (
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Database not reachable</CardTitle>
            <CardDescription>
              Set <span className="mono">DATABASE_URL</span> and run{" "}
              <span className="mono">pnpm db:push</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="mono text-[11px] text-muted-foreground">
            {error}
          </CardContent>
        </Card>
      ) : runs.length === 0 ? (
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">No runs yet</CardTitle>
            <CardDescription>
              Trigger a cycle by POSTing to{" "}
              <span className="mono">/api/agent/run</span>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="bg-card/70">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Breaker</TableHead>
                  <TableHead>Trace</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const start = run.startedAt;
                  const end = run.finishedAt ?? new Date();
                  const durMs = end.getTime() - start.getTime();
                  return (
                    <TableRow
                      key={run.id}
                      id={`run-${run.id}`}
                      className="target:bg-accent/5"
                    >
                      <TableCell className="mono text-[11px] text-muted-foreground">
                        {start.toISOString().replace("T", " ").slice(0, 16)}Z
                      </TableCell>
                      <TableCell className="mono">
                        {(durMs / 1000).toFixed(1)}s
                      </TableCell>
                      <TableCell className="mono text-xs">
                        {run.model}
                      </TableCell>
                      <TableCell className="mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        {run.dataSource}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const status = runStatus(run);
                          return (
                            <Badge
                              variant={status.variant}
                              className={`mono text-[10px] uppercase tracking-[0.18em]${
                                status.pulse ? " animate-pulse" : ""
                              }`}
                            >
                              {status.label}
                            </Badge>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="mono text-xs">
                        {run.haltReason ? (
                          <span
                            className="text-[color:var(--gold)]"
                            title={run.haltReason}
                          >
                            de-risk
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                      </TableCell>
                      <TableCell className="mono text-xs">
                        {run.traceId ? (
                          (() => {
                            const url = traceUrl(run.traceId);
                            return url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent hover:underline"
                                title={run.traceId}
                              >
                                view
                              </a>
                            ) : (
                              <span className="text-muted-foreground" title={run.traceId}>
                                {run.traceId.slice(0, 8)}
                              </span>
                            );
                          })()
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
