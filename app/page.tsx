import Link from "next/link";
import { ArrowRight, Radar, ShieldCheck, GaugeCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export default function Landing() {
  return (
    <main className="flex-1">
      <section className="relative overflow-hidden border-b border-border">
        <div className="grid-hairline pointer-events-none absolute inset-0 opacity-[0.08]" />
        <div className="relative mx-auto max-w-6xl px-8 py-24 lg:py-32">
          <div className="flex items-center gap-3">
            <Radar className="size-5 text-[color:var(--gold)]" aria-hidden />
            <span className="mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
              Sonar / Wave 1 preview
            </span>
          </div>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight text-foreground lg:text-6xl">
            An ETF-flow-aware{" "}
            <span className="text-[color:var(--gold)]">agentic hedge fund</span>,
            non-custodial and fully sourced.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            Sonar ingests SoSoValue ETF flows and structured news after every US
            market close, publishes a dated thesis with inline citations, and
            rebalances positions across MAG7, DEFI, and MEME indices on Base.
            You keep the keys. The agent keeps the receipts.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/signals"
              className={cn(buttonVariants({ size: "lg" }), "gap-2")}
            >
              Read today{"'"}s thesis
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/portfolio"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              View paper portfolio
            </Link>
            <Badge
              variant="secondary"
              className="mono text-[10px] uppercase tracking-[0.18em]"
            >
              Wave 1 is paper trading. Wave 2 goes live.
            </Badge>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-3">
            <Feature
              icon={<GaugeCircle className="size-4" />}
              title="Daily cadence"
              body="Cron fires after the US ETF close. Latency is honest: ETF flow data is end-of-day, not intraday."
            />
            <Feature
              icon={<ShieldCheck className="size-4" />}
              title="Transparent reasoning"
              body="Every numeric claim cites a signal id. Rejected theses stay in the log next to the accepted ones."
            />
            <Feature
              icon={<Radar className="size-4" />}
              title="Two-chain reality"
              body="SSI indices read on Base. SoDEX hedges settle on ValueChain. We never paper over the split."
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-8 py-20">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              The Sonar loop
            </h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              One cycle per day. Every step is logged and clickable.
            </p>
          </div>
          <Badge className="mono text-[10px] uppercase tracking-[0.2em]">
            mimo-v2.5-pro
          </Badge>
        </div>
        <Separator className="my-8" />
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {LOOP_STEPS.map((step, i) => (
            <li key={step.title}>
              <Card className="h-full border-border bg-card/70">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <span className="mono text-xs text-[color:var(--gold)]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <CardTitle className="text-base">{step.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {step.body}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-[color:var(--gold)]">
          {icon}
          <CardTitle className="text-sm uppercase tracking-[0.14em] text-foreground/90">
            {title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="text-sm leading-6 text-muted-foreground">
        {body}
      </CardContent>
    </Card>
  );
}

const LOOP_STEPS = [
  {
    title: "Ingest",
    body: "Pull ETF net flows and categorized news from SoSoValue. Stay within the 100-request-per-minute budget on the High Frequency tier.",
  },
  {
    title: "Read on-chain",
    body: "Multicall MAG7, DEFI, MEME, and USSI on Base for NAV, supply, and composition.",
  },
  {
    title: "Write thesis",
    body: "MiMo V2.5 Pro writes a dated research note with numbered citations linking each claim to a signal. Unsourced numbers are rejected.",
  },
  {
    title: "Execute",
    body: "Paper trades mirror the proposed allocation. Hedges flow through SoDEX in Wave 2. Every trade links to its thesis.",
  },
];
