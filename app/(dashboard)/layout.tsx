import Link from "next/link";
import Image from "next/image";
import { DashboardNav } from "@/components/dashboard-nav";
import { ModeToggle } from "@/components/mode-toggle";
import { executionModeLabel } from "@/lib/utils/mode";
import { env } from "@/lib/utils/env";

// This layout reads env() at render, so it must never be prerendered: a static
// badge would freeze at build-time mode and then lie after a flip. It was
// dynamic only because all nine dashboard pages happen to force-dynamic, which
// one new page could silently break. Now that the badge is the mode control,
// that implicit invariant is load-bearing, so state it here.
export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const mode = executionModeLabel();
  const telegramUrl = env().TELEGRAM_CHANNEL_URL;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-8 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/brand/sonar-mark.svg" alt="" width={22} height={22} aria-hidden />
            <span className="mono text-xs uppercase tracking-[0.22em]">
              Sonar
            </span>
          </Link>
          <DashboardNav />
          <ModeToggle initialMode={mode} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-10">
        {children}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-4 text-xs text-muted-foreground">
          <span className="mono uppercase tracking-[0.18em]">
            sonar {process.env.SONAR_GIT_SHA ?? "dev"} / buildathon 2026
          </span>
          <span className="mono flex items-center gap-4 uppercase tracking-[0.18em]">
            <Link href="/about" className="hover:text-foreground">
              about
            </Link>
            <Link href="/docs" className="hover:text-foreground">
              api
            </Link>
            <a
              href="/api/v1/status"
              className="hover:text-foreground"
              title="service status JSON"
            >
              status
            </a>
            {telegramUrl ? (
              <a
                href={telegramUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                telegram
              </a>
            ) : null}
            <span>data: sosovalue / ssi / sodex</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
