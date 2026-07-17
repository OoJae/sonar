// POST /api/admin/mode - arm or disarm live-mainnet, authenticated by signature.
//
// This is the only browser-reachable path that can put real funds in scope, so
// the ORDER of the checks below is the safety property, not an implementation
// detail. In particular the preflight must precede the write, and the write must
// precede the restart, because an invalid drop-in that reaches disk would have
// taken the whole site down before instrumentation.ts existed to catch it.
//
// What this does NOT do is mutate the running process. env() is cached for the
// process lifetime and nothing invalidates it, which is load-bearing rather than
// incidental: the boot guard runs once, sodexChain()'s per-venue aidCache and
// symbolNameToInfo are only cleared by a fresh process, and submitApprovedOrder
// compares a stored orders.mode against env() precisely because env cannot move
// underneath it. So the flip writes a systemd env drop-in and restarts.
//
// Auth: EIP-712 signature recovered server-side and checked against
// SONAR_ADMIN_ADDRESSES. No secret ever reaches the browser (the bearer
// CRON_SECRET could not be used here without shipping it to the client).

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gt, inArray, or } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env, validateEnvCandidate } from "@/lib/utils/env";
import { allowRequest, parseRateLimit } from "@/lib/utils/ratelimit";
import { logger } from "@/lib/utils/logger";
import { isAdmin, adminToggleConfigured } from "@/lib/admin/allowlist";
import {
  verifyModeAction,
  MODE_ACTION_MAX_AGE_SEC,
  type ModeAction,
} from "@/lib/admin/mode-action";
import {
  writeDropinAtomic,
  removeDropin,
  dropinExists,
  dropinOverrides,
  DROPIN_PATH,
} from "@/lib/admin/dropin";
import { isCycleInFlight } from "@/lib/agent/runner";
import { VALUECHAIN_TESTNET_USDC, VALUECHAIN_TESTNET_RPC } from "@/lib/chain/valuechain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Give the response time to flush through nginx before the process dies.
// process.exit is immediate and unflushed, so exiting inline would drop the very
// 200 that tells the operator the flip was accepted.
const EXIT_DELAY_MS = 750;

const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Uint = z.string().regex(/^\d+$/);
const SigSchema = z.string().regex(/^0x[0-9a-fA-F]{130}$/);

const Body = z.object({
  mode: z.enum(["live-testnet", "live-mainnet"]),
  actor: AddressSchema,
  issuedAt: Uint,
  expiry: Uint,
  nonce: Uint,
  signature: SigSchema,
});

function clientIp(request: Request): string {
  return (
    request.headers.get("x-real-ip")?.trim() ??
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
    "unknown"
  );
}

function bad(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export async function POST(request: Request) {
  const e = env();

  // 1. Rate limit per IP. Reuses the delegation budget: same shape of endpoint
  //    (unauthenticated until a signature is verified), same abuse profile.
  const { count, windowSec } = parseRateLimit(e.SONAR_DELEGATION_RATELIMIT);
  if (!(await allowRequest(`admin-mode:ip:${clientIp(request)}`, count, windowSec))) {
    return bad("rate_limited", 429, undefined);
  }

  // 2. Closed by default: no allowlist configured means nobody can flip.
  if (!adminToggleConfigured()) {
    return bad("toggle_not_configured", 403);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return bad("bad_json", 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return bad("invalid_body", 400, { issues: parsed.error.issues.slice(0, 4) });
  }
  const b = parsed.data;

  // 3. Reconstruct the signed message server-side from the individual fields.
  //    Never trust a client typed-data blob: the signature must provably cover
  //    exactly what we are about to act on.
  const action: ModeAction = {
    mode: b.mode,
    actor: b.actor as `0x${string}`,
    issuedAt: BigInt(b.issuedAt),
    expiry: BigInt(b.expiry),
    nonce: BigInt(b.nonce),
  };

  // 4. Freshness, before any crypto. Bounds the replay window even if the
  //    uniqueness check below were somehow bypassed.
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (action.expiry <= nowSec) return bad("expired", 400);
  if (action.expiry - action.issuedAt > BigInt(MODE_ACTION_MAX_AGE_SEC)) {
    return bad("expiry_window_too_long", 400, { maxSec: MODE_ACTION_MAX_AGE_SEC });
  }
  if (action.issuedAt > nowSec + 60n) return bad("issued_in_future", 400);

  // 5. Recover. Returns null unless the signature is valid AND recovers to the
  //    signed actor, so nobody can sign as themselves and claim another address.
  const recovered = await verifyModeAction(action, b.signature as `0x${string}`);
  if (!recovered) return bad("bad_signature", 401);

  // 6. Allowlist. The recovered address is the identity; b.actor is only a claim.
  if (!isAdmin(recovered)) {
    logger.warn("admin.mode.not_admin", { actor: recovered, mode: b.mode });
    return bad("not_admin", 403);
  }

  const current = e.SONAR_EXECUTION_MODE;

  // 7. Replay: the UNIQUE signature makes a resubmitted payload a no-op insert
  //    rather than a second flip. Insert BEFORE acting, so a replay can never
  //    reach the write even under concurrent requests.
  const inserted = await db()
    .insert(schema.adminActions)
    .values({
      action: "set_mode",
      fromMode: current,
      toMode: b.mode,
      actor: recovered.toLowerCase(),
      signature: b.signature,
      nonce: b.nonce,
      issuedAt: new Date(Number(action.issuedAt) * 1000),
      expiry: new Date(Number(action.expiry) * 1000),
    })
    .onConflictDoNothing({ target: schema.adminActions.signature })
    .returning({ id: schema.adminActions.id });
  const rowId = inserted[0]?.id;
  if (!rowId) return bad("replayed", 409);

  // 8. No-op. Report success: the requested state is the actual state.
  if (current === b.mode) {
    return NextResponse.json({
      ok: true,
      noop: true,
      mode: current,
      restartExpected: false,
    });
  }

  // 9. INTERLOCK: never exit mid-cycle. runAgentCycle takes no lock (the run
  //    lock only covers the demo/proposal/approve paths), so its module mutex is
  //    the only reliable signal. A process exit between the delta-neutral SSI
  //    long (paper, fills instantly) and its BTC hedge would leave a book that is
  //    100% net long, and on restart runDeltaNeutral skips mainnet entirely and
  //    never repairs it.
  if (isCycleInFlight()) {
    return bad("cycle_in_flight", 409, { hint: "an agent cycle is running; retry shortly" });
  }

  // 10. INTERLOCK: disarming strands queued mainnet orders. They are SAFE while
  //     stranded (submitApprovedOrder refuses on row.mode mismatch), but they sit
  //     in the UI as "awaiting approval" with no cancel path, and re-arming
  //     inside the TTL would make them approvable again at sizing computed before
  //     the disarm. Refuse while any are live.
  if (b.mode !== "live-mainnet") {
    const ttlMin = e.SONAR_APPROVAL_TTL_MINUTES;
    const cutoff = new Date(Date.now() - ttlMin * 60_000);
    // Any NON-TERMINAL mainnet order blocks a disarm, not just pending_approval.
    // A row leaves pending_approval the instant approval begins: the claim moves
    // it to `pending`, submitAndFinalize sets `submitted`, then polls up to 30s.
    // process.exit(0) here would truncate that poll and strand a live wire-side
    // position off-book. `submitted`/`pending` rows carry real exposure and must
    // block the disarm too. (TTL still bounds pending_approval; submitted/pending
    // are in-flight regardless of age, so they are not TTL-scoped.)
    const blocking = await db()
      .select({ id: schema.orders.id, status: schema.orders.status })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.mode, "live-mainnet"),
          or(
            inArray(schema.orders.status, ["pending", "submitted"]),
            and(
              eq(schema.orders.status, "pending_approval"),
              gt(schema.orders.createdAt, cutoff),
            ),
          ),
        ),
      );
    if (blocking.length > 0) {
      return bad("pending_orders", 409, {
        count: blocking.length,
        hint: `mainnet orders are in flight or awaiting approval; resolve them before disarming`,
      });
    }
  }

  // 11. PREFLIGHT. The crux. Build the env exactly as it would be after this
  //     change and run the real schema over it. An invalid drop-in on disk is not
  //     a boot failure that systemd can retry: without instrumentation.ts the
  //     process would bind the port, look healthy, and 500 forever. Never write a
  //     config that cannot boot; do not rely on finding out afterwards.
  const candidate: Record<string, string | undefined> = { ...process.env };
  if (b.mode === "live-mainnet") {
    Object.assign(candidate, dropinOverrides());
  } else {
    // Disarming removes the drop-in, so the env reverts to the .env.local
    // baseline. Model that rather than the current process env, which still
    // carries the drop-in's values.
    candidate.SONAR_EXECUTION_MODE = "live-testnet";
    candidate.VALUECHAIN_USDC_ADDRESS = VALUECHAIN_TESTNET_USDC;
    candidate.VALUECHAIN_RPC_URL = VALUECHAIN_TESTNET_RPC;
  }
  const check = validateEnvCandidate(candidate);
  if (!check.ok) {
    logger.error("admin.mode.preflight_failed", { to: b.mode, issues: check.issues });
    return bad("preflight_failed", 422, { issues: check.issues.slice(0, 6) });
  }

  // 12. Write. Atomic rename, so systemd can never read a torn file.
  try {
    if (b.mode === "live-mainnet") writeDropinAtomic();
    else removeDropin();
  } catch (err) {
    logger.error("admin.mode.write_failed", {
      to: b.mode,
      error: err instanceof Error ? err.message : String(err),
    });
    return bad("write_failed", 500);
  }

  // 13. Verify the disk agrees with the intent before promising a restart.
  const armed = dropinExists();
  if ((b.mode === "live-mainnet") !== armed) {
    return bad("dropin_state_mismatch", 500, { expectedArmed: b.mode === "live-mainnet", armed });
  }

  await db()
    .update(schema.adminActions)
    .set({ appliedAt: new Date() })
    .where(eq(schema.adminActions.id, rowId));

  logger.warn("admin.mode.flip", {
    from: current,
    to: b.mode,
    actor: recovered,
    dropin: armed ? DROPIN_PATH : "removed",
  });

  // 14. Respond, THEN exit. systemd (Restart=always, RestartSec=5) brings the
  //     process back, which is what re-runs the boot guard and rebuilds the
  //     per-venue caches clean.
  const res = NextResponse.json({
    ok: true,
    from: current,
    to: b.mode,
    actor: recovered,
    restartExpected: true,
  });
  // On a disarm, re-check for in-flight mainnet orders immediately before the
  // exit, not only at step 10. An approve could have started in the ~750ms
  // window; exiting then would truncate its submit poll and strand a live
  // position off-book.
  scheduleExit(b.mode !== "live-mainnet");
  return res;
}

function scheduleExit(recheckInFlight: boolean): void {
  setTimeout(() => {
    void (async () => {
      if (recheckInFlight) {
        try {
          const inFlight = await db()
            .select({ id: schema.orders.id })
            .from(schema.orders)
            .where(
              and(
                eq(schema.orders.mode, "live-mainnet"),
                inArray(schema.orders.status, ["pending", "submitted"]),
              ),
            );
          if (inFlight.length > 0) {
            // Abort the exit. The drop-in is already removed, so the NEXT restart
            // disarms to testnet; meanwhile the process stays on mainnet, which
            // MATCHES the in-flight order's venue, so it can finalize normally.
            // The operator retries the disarm once it settles.
            console.warn(
              `[admin.mode] aborting exit: ${inFlight.length} mainnet order(s) in flight. ` +
                `Process stays on mainnet to finalize them; retry the disarm after.`,
            );
            return;
          }
        } catch (err) {
          // If the re-check itself fails, do NOT exit blindly during a disarm.
          console.warn(
            `[admin.mode] in-flight re-check failed (${err instanceof Error ? err.message : String(err)}); not exiting`,
          );
          return;
        }
      }
      console.warn("[admin.mode] exiting so systemd restarts with the new mode");
      process.exit(0);
    })();
  }, EXIT_DELAY_MS).unref();
}
