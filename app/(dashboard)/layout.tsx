import Link from "next/link";
import { Radar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DashboardNav } from "@/components/dashboard-nav";
import { executionModeLabel } from "@/lib/utils/mode";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const mode = executionModeLabel();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-8 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Radar className="size-5 text-[color:var(--gold)]" aria-hidden />
            <span className="mono text-xs uppercase tracking-[0.22em]">
              Sonar
            </span>
          </Link>
          <DashboardNav />
          <Badge
            variant="outline"
            className="mono text-[10px] uppercase tracking-[0.18em]"
            title="SONAR_EXECUTION_MODE"
          >
            {mode}
          </Badge>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-10">
        {children}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-4 text-xs text-muted-foreground">
          <span className="mono uppercase tracking-[0.18em]">
            sonar / buildathon 2026
          </span>
          <span className="mono uppercase tracking-[0.18em]">
            data: sosovalue / ssi / sodex
          </span>
        </div>
      </footer>
    </div>
  );
}
