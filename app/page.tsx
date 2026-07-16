import Link from "next/link";
import Image from "next/image";
import { SonarScope } from "@/components/sonar-scope";
import { Reveal } from "@/components/reveal";
import { computeTrackData } from "@/lib/track/compute";
import { memo } from "@/lib/api/memo";
import { env } from "@/lib/utils/env";

export const dynamic = "force-dynamic";

type LiveStats = {
  bookReturnPct: number;
  baselineReturnPct: number;
  winRate: number | null;
  cycles: number;
} | null;

async function loadLiveStats(): Promise<LiveStats> {
  try {
    const t = await memo("landing:track", 60_000, () => computeTrackData());
    if (!t.hasEnoughData) return null;
    return {
      bookReturnPct: t.bookReturnPct,
      baselineReturnPct: t.baselineReturnPct,
      winRate: t.winRate,
      cycles: t.tradeCount + t.noTradeCount,
    };
  } catch {
    return null;
  }
}

function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

const STRATA: Array<{
  depth: string;
  name: string;
  heading: string;
  body: string;
}> = [
  {
    depth: "01",
    name: "ingest",
    heading: "Listen after the close.",
    body: "ETF net flows and categorized news arrive from SoSoValue once the US session settles; the on-chain composition of every index is multicalled from Base. The data is end-of-day, so the cadence is too. Latency is honest here.",
  },
  {
    depth: "02",
    name: "reason",
    heading: "Write it down, with receipts.",
    body: "The model writes a dated research note. Every numeric claim must carry an inline citation that resolves to a signal in the same thesis; the validator rejects unsourced numbers before anything can trade.",
  },
  {
    depth: "03",
    name: "gate",
    heading: "De-risk before it happens.",
    body: "A macro event inside the lookahead window (CPI, FOMC) or a drawdown past the cap scales the whole cycle down before a single order is sized. Four layers then bound what reaches the venue: a dust floor, a per-order cap, a per-cycle cap, and position caps that bound the book itself rather than the flow.",
  },
  {
    depth: "04",
    name: "execute",
    heading: "Sign, fill, record.",
    body: "Index rebalance legs are simulated against the book; perp hedges go to SoDEX as EIP-712 signed orders. On testnet they fire; on mainnet the cycle records them for a human to approve and submits nothing itself. A second, rules-based delta-neutral book runs beside the directional one. Every fill links back to the thesis that authorized it.",
  },
  {
    depth: "05",
    name: "publish",
    heading: "Everything surfaces.",
    body: "The thesis, the fills, the NAV marks, the risk state, and the forward test of every AI-designed index land on the dashboard, the public API, and MCP. The failed runs stay in the log next to the wins.",
  },
];

export default async function Landing() {
  const stats = await loadLiveStats();
  const telegramUrl = env().TELEGRAM_CHANNEL_URL;

  return (
    <div className="grain relative">
      <SonarScope />

      <header className="relative z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 md:px-10">
          <Link
            href="/"
            className="flex items-center gap-3 focus-visible:outline-2"
          >
            <Image
              src="/brand/sonar-mark.svg"
              alt=""
              width={30}
              height={30}
              priority
            />
            <span className="mono text-xs uppercase tracking-[0.3em] text-foreground">
              Sonar
            </span>
          </Link>
          <nav
            aria-label="Primary"
            className="mono flex items-center gap-5 text-[11px] uppercase tracking-[0.18em]"
          >
            <Link
              href="/signals"
              className="hidden text-muted-foreground hover:text-foreground sm:block"
            >
              Thesis
            </Link>
            <Link
              href="/track"
              className="hidden text-muted-foreground hover:text-foreground sm:block"
            >
              Track
            </Link>
            <Link
              href="/docs"
              className="hidden text-muted-foreground hover:text-foreground sm:block"
            >
              API
            </Link>
            <Link
              href="/signals"
              className="rounded-md border border-[color:var(--ping)]/50 bg-[color:var(--ping)]/10 px-3 py-1.5 text-[color:var(--ping)] transition-colors hover:bg-[color:var(--ping)]/20"
            >
              Open the fund
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        {/* HERO: the scope is the page; the note is written on it. */}
        <section className="relative flex min-h-[100svh] flex-col justify-end">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-background via-background/70 to-transparent"
          />
          <Reveal className="relative mx-auto w-full max-w-6xl px-6 pb-20 md:px-10 md:pb-24">
            <h1 className="display text-[clamp(3rem,8vw,7.5rem)] leading-[0.95] tracking-[-0.02em]">
              <span className="rv-mask">
                <span className="rv">An instrument</span>
              </span>
              <span className="rv-mask">
                <span className="rv" style={{ transitionDelay: "0.08s" }}>
                  for finding <em className="text-[color:var(--ping)] glow-ping">signal</em>
                </span>
              </span>
              <span className="rv-mask">
                <span className="rv italic" style={{ transitionDelay: "0.16s" }}>
                  in deep water.
                </span>
              </span>
            </h1>

            <p
              className="rv-fade mono mt-8 max-w-2xl text-[11px] uppercase tracking-[0.22em] text-muted-foreground"
              style={{ transitionDelay: "0.3s" }}
            >
              An autonomous fund that pings the market daily. Cited theses,
              verifiable track record, non-custodial by design.
            </p>

            <div
              className="rv-fade mt-8 flex flex-wrap items-center gap-3"
              style={{ transitionDelay: "0.4s" }}
            >
              <Link
                href="/signals"
                className="mono rounded-md border border-[color:var(--ping)]/60 bg-[color:var(--ping)]/10 px-5 py-3 text-xs uppercase tracking-[0.18em] text-[color:var(--ping)] transition-colors hover:bg-[color:var(--ping)]/20"
              >
                Read today{"'"}s thesis
              </Link>
              <Link
                href="/track"
                className="mono rounded-md border border-border px-5 py-3 text-xs uppercase tracking-[0.18em] text-foreground transition-colors hover:border-foreground/40"
              >
                Verify the track record
              </Link>
            </div>

            {stats ? (
              <div
                className="rv-fade mono mt-10 flex flex-wrap gap-x-8 gap-y-2 text-[11px] uppercase tracking-[0.18em]"
                style={{ transitionDelay: "0.5s" }}
              >
                <Readout label="book" value={signedPct(stats.bookReturnPct)} />
                <Readout
                  label="buy and hold"
                  value={signedPct(stats.baselineReturnPct)}
                />
                <Readout
                  label="excess"
                  value={signedPct(
                    stats.bookReturnPct - stats.baselineReturnPct,
                  )}
                />
                {stats.winRate !== null ? (
                  <Readout
                    label="win rate"
                    value={`${Math.round(stats.winRate * 100)}%`}
                  />
                ) : null}
                <Readout label="cycles" value={String(stats.cycles)} />
              </div>
            ) : null}
          </Reveal>
        </section>

        {/* THE DIVE: the loop as depth strata; the cone recedes behind. */}
        <section aria-label="How the fund works">
          {STRATA.map((s) => (
            <Reveal
              key={s.depth}
              className="mx-auto grid max-w-6xl gap-6 px-6 py-[18vh] md:grid-cols-[220px_1fr] md:px-10"
            >
              <div className="mono text-[11px] uppercase tracking-[0.24em] text-[color:var(--ping)]/80">
                <span className="rv-mask">
                  <span className="rv">
                    depth {s.depth} / {s.name}
                  </span>
                </span>
              </div>
              <div>
                <h2 className="display scrim-text text-[clamp(2rem,4vw,3.5rem)] leading-[1.02] tracking-[-0.015em]">
                  <span className="rv-mask">
                    <span className="rv" style={{ transitionDelay: "0.08s" }}>
                      {s.heading}
                    </span>
                  </span>
                </h2>
                <p
                  className="rv-fade scrim-text mt-5 max-w-xl text-[clamp(1rem,1.05vw,1.2rem)] leading-relaxed text-foreground/80"
                  style={{ transitionDelay: "0.2s" }}
                >
                  {s.body}
                </p>
              </div>
            </Reveal>
          ))}
        </section>

        {/* RECEIPTS: the honest strip. */}
        <section className="relative border-y border-border/60 bg-background/80 backdrop-blur">
          <Reveal className="mx-auto max-w-6xl px-6 py-16 md:px-10">
            <div className="mono text-[11px] uppercase tracking-[0.24em] text-[color:var(--ping)]/80">
              <span className="rv-mask">
                <span className="rv">surface reading</span>
              </span>
            </div>
            <h2 className="display mt-4 text-[clamp(2rem,4vw,3.5rem)] leading-[1.02]">
              <span className="rv-mask">
                <span className="rv" style={{ transitionDelay: "0.08s" }}>
                  The record is the <em className="text-[color:var(--ping)]">product.</em>
                </span>
              </span>
            </h2>
            <p
              className="rv-fade mt-5 max-w-2xl text-[clamp(1rem,1.05vw,1.2rem)] leading-relaxed text-muted-foreground"
              style={{ transitionDelay: "0.2s" }}
            >
              Paper plus testnet during the buildathon; every number traces to a
              cited thesis, a logged run, or a signed venue fill. The failures
              are published next to the wins, on purpose.
            </p>
            <div
              className="rv-fade mt-8 flex flex-wrap gap-3"
              style={{ transitionDelay: "0.3s" }}
            >
              <Link
                href="/track"
                className="mono rounded-md border border-border px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-foreground transition-colors hover:border-foreground/40"
              >
                Track record
              </Link>
              <Link
                href="/log"
                className="mono rounded-md border border-border px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-foreground transition-colors hover:border-foreground/40"
              >
                Decision log, failures included
              </Link>
              <Link
                href="/about"
                className="mono rounded-md border border-border px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
              >
                What Sonar is (and is not)
              </Link>
            </div>
          </Reveal>
        </section>

        {/* CONSUME: three quiet doors. */}
        <section className="mx-auto max-w-6xl px-6 py-24 md:px-10">
          <Reveal className="grid gap-6 md:grid-cols-3">
            <ConsumeCard
              delay="0s"
              eyebrow="watch"
              title="The dashboard"
              body="Today's cited thesis, the book split by strategy, risk metrics, and the transparent log."
              href="/signals"
              cta="Open the fund"
            />
            <ConsumeCard
              delay="0.1s"
              eyebrow="query"
              title="API and MCP"
              body="Everything on the dashboard as JSON and as MCP tools for your own agent. No key required."
              href="/docs"
              cta="Read the docs"
              code="claude mcp add --transport http sonar https://sonar.my.id/api/mcp"
            />
            <ConsumeCard
              delay="0.2s"
              eyebrow="race"
              title="The proposal arena"
              body="Give the agent a theme; it designs an index and the design accrues a daily forward test from birth."
              href="/proposals"
              cta="Enter the arena"
            />
          </Reveal>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border">
        <div className="mono mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground md:px-10">
          <span>
            sonar {process.env.SONAR_GIT_SHA ?? "dev"} / buildathon 2026
          </span>
          <span className="flex items-center gap-4">
            <Link href="/about" className="hover:text-foreground">
              about
            </Link>
            <Link href="/docs" className="hover:text-foreground">
              api
            </Link>
            <a href="/api/v1/status" className="hover:text-foreground">
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
          </span>
        </div>
      </footer>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="text-[color:var(--ping)]">{value}</span>
    </span>
  );
}

function ConsumeCard({
  eyebrow,
  title,
  body,
  href,
  cta,
  code,
  delay,
}: {
  eyebrow: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  code?: string;
  delay: string;
}) {
  return (
    <div
      className="rv-fade flex flex-col rounded-lg border border-border/60 bg-[color:var(--depth)]/70 p-6 backdrop-blur"
      style={{ transitionDelay: delay }}
    >
      <div className="mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--ping)]/80">
        {eyebrow}
      </div>
      <h3 className="display mt-2 text-2xl">{title}</h3>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
      {code ? (
        <pre className="mono mt-4 overflow-x-auto rounded-md border border-border/60 bg-background/60 p-3 text-[10px] leading-5 text-foreground/80">
          {code}
        </pre>
      ) : null}
      <Link
        href={href}
        className="mono mt-5 inline-block text-[11px] uppercase tracking-[0.18em] text-[color:var(--ping)] hover:underline"
      >
        {cta}
      </Link>
    </div>
  );
}
