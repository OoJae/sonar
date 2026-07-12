import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/utils/env";
import {
  acquireRunLock,
  allowRequest,
  parseRateLimit,
  releaseRunLock,
} from "@/lib/utils/ratelimit";
import { logger } from "@/lib/utils/logger";
import { generateProposal } from "@/lib/proposals/generate";
import { persistProposal, listProposals } from "@/lib/proposals/store";
import { insertProposalSnapshot } from "@/lib/proposals/arena";
import { notifyProposalCreated } from "@/lib/notify/cycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROPOSAL_LOCK = "sonar:proposal:lock";

// Public on-demand index-proposal generator. Like /api/agent/demo-run it is not
// bearer-protected (any visitor can design an index) but is hard rate-limited and
// single-flighted. It never reads or returns CRON_SECRET or the private key, and
// never calls runAgentCycle. Generation is a design artifact, moves no funds.
const Body = z.object({ theme: z.string() });

function clientIp(request: Request): string {
  return (
    request.headers.get("x-real-ip")?.trim() ??
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
    "unknown"
  );
}

function sanitizeTheme(raw: string): string {
  return raw
    // strip control chars, then collapse whitespace (newlines included) so a
    // theme cannot inject prompt structure.
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function POST(request: Request) {
  const e = env();
  const { count, windowSec } = parseRateLimit(e.SONAR_PROPOSAL_RATELIMIT);
  const ip = clientIp(request);

  const globalOk = await allowRequest("proposal:global", count, windowSec);
  const ipOk = await allowRequest(`proposal:ip:${ip}`, count, windowSec * 2);
  if (!globalOk || !ipOk) {
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        message: `Index proposals are limited to ${count} per ${windowSec}s. Try again shortly.`,
      },
      { status: 429, headers: { "Retry-After": String(windowSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 },
    );
  }
  const theme = sanitizeTheme(parsed.data.theme);
  if (theme.length < 2) {
    return NextResponse.json(
      { ok: false, error: "theme_too_short" },
      { status: 400 },
    );
  }

  const locked = await acquireRunLock(60, PROPOSAL_LOCK);
  if (!locked) {
    return NextResponse.json(
      {
        ok: false,
        error: "busy",
        message: "A proposal is already generating. Try again in a moment.",
      },
      { status: 429, headers: { "Retry-After": "20" } },
    );
  }

  try {
    logger.info("proposal_run.triggered", { ip, theme });
    const result = await generateProposal(theme);
    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    await persistProposal(result.proposal);
    // Arena seed: the creation-time pricing is forward-test snapshot #1
    // (zero extra API calls; inception = creation).
    await insertProposalSnapshot(
      result.proposal.id,
      result.proposal.pricing,
    ).catch((err) =>
      logger.warn("proposal.seed_snapshot_failed", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    // Fire-and-forget Telegram announcement (never blocks the response).
    notifyProposalCreated({
      name: result.proposal.name,
      symbol: result.proposal.symbol,
      theme: result.proposal.theme,
      coverage: result.proposal.pricing.coverage,
      perUnitNavUsd: result.proposal.pricing.perUnitNavUsd,
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, proposal: result.proposal });
  } catch (err) {
    logger.error("proposal_run.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  } finally {
    await releaseRunLock(PROPOSAL_LOCK);
  }
}

export async function GET() {
  try {
    const proposals = await listProposals();
    return NextResponse.json({ ok: true, proposals });
  } catch (err) {
    logger.error("proposal_list.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
