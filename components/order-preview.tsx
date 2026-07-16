// Wave 2 Phase 2.5: per-thesis order preview on /signals.
//
// Shows the live SoDEX orders that the thesis authorized, with wire-side
// state badges. SSI rebalance legs do not appear here because they route to
// the paper engine by design (SSI primitives are not SoDEX listings); they
// still show on /portfolio under paper_trades. The orders table is the
// dashboard's wire-side ledger.
//
// Pure server component reading from the DB. No client interactivity beyond
// links; the badges are deterministic per row.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
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

type OrderRow = typeof schema.orders.$inferSelect;

// State badge styling. Variants from the shadcn Badge: default, secondary,
// outline, destructive. Custom colour classes layer on top for the
// partially_filled (amber) and filled (gold/accent) cases that the base
// variants do not cover.
function statusBadge(status: OrderRow["status"]) {
  switch (status) {
    case "pending_approval":
      return (
        <Badge
          variant="outline"
          className="mono text-[10px] uppercase tracking-[0.18em] bg-[color:var(--gold)]/20 text-[color:var(--gold)] border border-[color:var(--gold)]/40"
        >
          awaiting approval
        </Badge>
      );
    case "pending":
      return (
        <Badge
          variant="outline"
          className="mono text-[10px] uppercase tracking-[0.18em]"
        >
          pending
        </Badge>
      );
    case "submitted":
      return (
        <Badge
          variant="secondary"
          className="mono text-[10px] uppercase tracking-[0.18em]"
        >
          submitted
        </Badge>
      );
    case "partially_filled":
      return (
        <Badge
          className="mono text-[10px] uppercase tracking-[0.18em] bg-[color:var(--gold)]/20 text-[color:var(--gold)] border border-[color:var(--gold)]/40"
          variant="outline"
        >
          partial
        </Badge>
      );
    case "filled":
      return (
        <Badge
          className="mono text-[10px] uppercase tracking-[0.18em] bg-[color:var(--positive)]/20 text-[color:var(--positive)] border border-[color:var(--positive)]/40"
          variant="outline"
        >
          filled
        </Badge>
      );
    case "failed":
      return (
        <Badge
          variant="destructive"
          className="mono text-[10px] uppercase tracking-[0.18em]"
        >
          failed
        </Badge>
      );
    case "rejected":
      return (
        <Badge
          variant="destructive"
          className="mono text-[10px] uppercase tracking-[0.18em]"
        >
          rejected
        </Badge>
      );
  }
}

function fmtUSD(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "-";
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtNumber(value: string | number | null | undefined, digits = 6): string {
  if (value === null || value === undefined) return "-";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export async function OrderPreview({ thesisId }: { thesisId: string }) {
  let orders: OrderRow[] = [];
  try {
    orders = await db()
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.thesisId, thesisId));
  } catch {
    return null;
  }

  if (orders.length === 0) {
    return (
      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">Wire orders</CardTitle>
          <CardDescription>
            Live SoDEX orders this thesis authorized. SSI rebalance legs route
            to the paper engine and appear on /portfolio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            No live wire orders for this thesis. The agent either ran in
            paper mode or had only SSI rebalance legs.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sort: anything awaiting a human first (it is the only row that needs an
  // action), then filled, then in-flight, then failures. Within a class, sort by
  // created_at ascending so the agent's logical order is preserved.
  // This Record is the exhaustiveness check for order_status: adding a status to
  // the enum without handling it here is a compile error. Keep it that way.
  const rank: Record<OrderRow["status"], number> = {
    pending_approval: 0,
    filled: 1,
    partially_filled: 2,
    submitted: 3,
    pending: 4,
    rejected: 5,
    failed: 6,
  };
  orders.sort((a, b) => {
    const r = rank[a.status] - rank[b.status];
    if (r !== 0) return r;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">Wire orders</CardTitle>
        <CardDescription>
          Live SoDEX orders this thesis authorized. SSI rebalance legs route
          to the paper engine and appear on /portfolio.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Market</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Notional</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Fill price</TableHead>
              <TableHead className="text-right">Fill qty</TableHead>
              <TableHead>SoDEX ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="mono">{o.market}</TableCell>
                <TableCell
                  className={`mono uppercase ${
                    o.side === "buy"
                      ? "text-[color:var(--positive)]"
                      : "text-[color:var(--negative)]"
                  }`}
                >
                  {o.side}
                </TableCell>
                <TableCell className="mono text-right">
                  {fmtUSD(o.notionalUsd)}
                </TableCell>
                <TableCell>
                  {statusBadge(o.status)}
                  {o.rejectionReason ? (
                    <div
                      className="mono mt-1 text-[10px] text-muted-foreground"
                      title={o.rejectionReason}
                    >
                      {o.rejectionReason.slice(0, 64)}
                      {o.rejectionReason.length > 64 ? "..." : ""}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="mono text-right">
                  {fmtUSD(o.fillPrice)}
                </TableCell>
                <TableCell className="mono text-right">
                  {fmtNumber(o.fillQuantity)}
                </TableCell>
                <TableCell className="mono text-[11px] text-muted-foreground">
                  {o.sodexOrderId ?? "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
