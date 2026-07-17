// Full arm -> verify -> disarm round trip against a running server.
//
// Separate from mode-toggle-smoke.ts because this one RESTARTS the process
// twice. Everything the smoke asserts returns before the write; this asserts the
// two paths that actually flip.
//
// Arming is real: the process comes back with live-mainnet and the mainnet
// balance in scope. It is still not autonomous (the executor RECORDS
// pending_approval and throws; only POST /api/orders/approve reaches the wire),
// but do not run this while a cycle is due.
//
// Usage:
//   SMOKE_ADMIN_PK=0x... pnpm tsx scripts/mode-flip-roundtrip.ts

import "./_env";
import { existsSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildModeActionTypedData,
  type ModeAction,
  type ToggleableMode,
} from "@/lib/admin/mode-action";
import { DROPIN_PATH } from "@/lib/admin/dropin";

const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3005";
let pass = 0;
let fail = 0;

function expect(name: string, cond: boolean, detail?: string) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond && detail) console.log(`          ${detail}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Status = { mode: string; bootId: string; armedByDropin: boolean };

async function status(): Promise<Status | null> {
  try {
    const res = await fetch(`${BASE}/api/admin/mode/status?t=${Date.now()}`, {
      cache: "no-store",
    });
    return (await res.json()) as Status;
  } catch {
    return null; // process is down mid-restart; expected
  }
}

async function flip(pk: `0x${string}`, mode: ToggleableMode) {
  const acct = privateKeyToAccount(pk);
  const now = Math.floor(Date.now() / 1000);
  const action: ModeAction = {
    mode,
    actor: acct.address,
    issuedAt: BigInt(now),
    expiry: BigInt(now + 90),
    // Nonce only has to be unique per signature; the DB enforces replay on the
    // signature itself. Seconds + a random tail avoids colliding within a run.
    nonce: BigInt(now) * 1000n + BigInt(Math.floor(Math.random() * 1000)),
  };
  const signature = await acct.signTypedData(buildModeActionTypedData(action));
  const res = await fetch(`${BASE}/api/admin/mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: action.mode,
      actor: action.actor,
      issuedAt: String(action.issuedAt),
      expiry: String(action.expiry),
      nonce: String(action.nonce),
      signature,
    }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Wait for a NEW process (bootId change) reporting the wanted mode. bootId is
 *  the only honest proof of a restart: mode alone cannot distinguish "the new
 *  process is up" from "I am reading the old one". */
async function awaitRestart(prevBootId: string, want: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1500);
    const s = await status();
    if (s && s.bootId !== prevBootId) return s;
  }
  return null;
}

async function main() {
  const pk = process.env.SMOKE_ADMIN_PK as `0x${string}` | undefined;
  if (!pk) {
    console.error("SMOKE_ADMIN_PK required (a key listed in SONAR_ADMIN_ADDRESSES).");
    process.exit(2);
  }

  const start = await status();
  if (!start) {
    console.error(`No server at ${BASE}.`);
    process.exit(2);
  }
  console.log(`\nStart: mode=${start.mode} bootId=${start.bootId.slice(0, 8)} dropin=${start.armedByDropin}`);
  if (start.mode !== "live-testnet") {
    console.error(`Expected to start on live-testnet, got ${start.mode}. Refusing.`);
    process.exit(2);
  }

  console.log("\n1. ARM: live-testnet -> live-mainnet");
  const armRes = await flip(pk, "live-mainnet");
  expect(
    "the flip is accepted and promises a restart",
    armRes.status === 200 && armRes.json.restartExpected === true,
    `got ${armRes.status} ${JSON.stringify(armRes.json)}`,
  );
  expect("the drop-in is on disk", existsSync(DROPIN_PATH));

  const armed = await awaitRestart(start.bootId, "live-mainnet");
  expect("the process actually restarted (new bootId)", armed !== null);
  expect(
    "and it came back ARMED on live-mainnet",
    armed?.mode === "live-mainnet",
    `got mode=${armed?.mode}`,
  );
  expect("status reports it is armed by the drop-in", armed?.armedByDropin === true);

  console.log("\n2. The armed process still refuses to place autonomously");
  // The mode gate is the point of arming safely: on mainnet the executor records
  // for approval instead of placing. If this ever returns a trade, the whole
  // human-approval design is bypassed.
  const approveProbe = await fetch(`${BASE}/api/orders/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId: "00000000-0000-0000-0000-000000000000" }),
  });
  expect(
    "the approve endpoint is still bearer-gated on mainnet (401, not open)",
    approveProbe.status === 401,
    `got ${approveProbe.status}`,
  );

  console.log("\n3. DISARM: live-mainnet -> live-testnet");
  const disRes = await flip(pk, "live-testnet");
  expect(
    "the disarm is accepted",
    disRes.status === 200 && disRes.json.restartExpected === true,
    `got ${disRes.status} ${JSON.stringify(disRes.json)}`,
  );
  expect("the drop-in is gone (disarm == delete)", !existsSync(DROPIN_PATH));

  const disarmed = await awaitRestart(armed?.bootId ?? "", "live-testnet");
  expect("the process restarted again", disarmed !== null);
  expect(
    "and it is back on live-testnet",
    disarmed?.mode === "live-testnet",
    `got mode=${disarmed?.mode}`,
  );
  expect("no drop-in remains", disarmed?.armedByDropin === false);

  console.log(`\n  ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("roundtrip failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
