// Mode-toggle safety smoke. Grows as the feature lands: today it proves the
// mode-bound env guard accepts the live config and rejects every half-flipped
// config that would otherwise boot into mainnet reading testnet contracts.
//
// Usage: pnpm tsx scripts/mode-toggle-smoke.ts

import "./_env";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { validateEnvCandidate } from "@/lib/utils/env";
import {
  buildModeActionTypedData,
  type ModeAction,
  type ToggleableMode,
} from "@/lib/admin/mode-action";
import {
  VALUECHAIN_MAINNET_USDC, VALUECHAIN_TESTNET_USDC,
  VALUECHAIN_MAINNET_RPC, VALUECHAIN_TESTNET_RPC,
} from "@/lib/chain/valuechain";

const base = { ...process.env } as Record<string, string | undefined>;
let pass = 0, fail = 0;
function check(name: string, over: Record<string, string | undefined>, wantOk: boolean) {
  const r = validateEnvCandidate({ ...base, ...over });
  const ok = r.ok === wantOk;
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!r.ok && !wantOk) console.log(`          rejected with: ${r.issues[0]}`);
  if (!r.ok && wantOk) console.log(`          UNEXPECTED reject: ${r.issues.join(" | ")}`);
}

console.log("\n1. The current LIVE config must still boot (no false positive)");
check("live-testnet + testnet USDC + testnet RPC", {}, true);

console.log("\n2. The trap the guard exists for: mode flipped, margin asset NOT");
check("live-mainnet + TESTNET USDC (silent zero balance)", {
  SONAR_EXECUTION_MODE: "live-mainnet", SONAR_ALLOW_MAINNET: "true",
  SONAR_REQUIRE_MANUAL_APPROVAL: "true",
}, false);

console.log("\n3. mode + USDC flipped but RPC left on testnet");
check("live-mainnet + mainnet USDC + TESTNET RPC", {
  SONAR_EXECUTION_MODE: "live-mainnet", SONAR_ALLOW_MAINNET: "true",
  SONAR_REQUIRE_MANUAL_APPROVAL: "true", VALUECHAIN_USDC_ADDRESS: VALUECHAIN_MAINNET_USDC,
  VALUECHAIN_RPC_URL: VALUECHAIN_TESTNET_RPC,
}, false);

console.log("\n4. A complete, correct mainnet profile must be accepted");
check("live-mainnet + mainnet USDC + mainnet RPC + both flags", {
  SONAR_EXECUTION_MODE: "live-mainnet", SONAR_ALLOW_MAINNET: "true",
  SONAR_REQUIRE_MANUAL_APPROVAL: "true", VALUECHAIN_USDC_ADDRESS: VALUECHAIN_MAINNET_USDC,
  VALUECHAIN_RPC_URL: VALUECHAIN_MAINNET_RPC,
}, true);

console.log("\n5. The pre-existing opt-ins still bite on mainnet");
check("live-mainnet without SONAR_ALLOW_MAINNET", {
  SONAR_EXECUTION_MODE: "live-mainnet", SONAR_ALLOW_MAINNET: "false",
  SONAR_REQUIRE_MANUAL_APPROVAL: "true", VALUECHAIN_USDC_ADDRESS: VALUECHAIN_MAINNET_USDC,
  VALUECHAIN_RPC_URL: VALUECHAIN_MAINNET_RPC,
}, false);

console.log("\n6. Symmetric: half-removed mainnet config must not boot as 'testnet'");
check("live-testnet but MAINNET USDC left behind", {
  VALUECHAIN_USDC_ADDRESS: VALUECHAIN_MAINNET_USDC,
}, false);
check("live-testnet but MAINNET RPC left behind", {
  VALUECHAIN_RPC_URL: VALUECHAIN_MAINNET_RPC,
}, false);

// ---------------------------------------------------------------------------
// Part 2: the route. Exercises every rejection path against the running server.
//
// None of these reach the write or the exit: each returns before it. The two
// paths that DO flip the process are exercised by hand (see the round entry in
// CLAUDE.md), because asserting on them means restarting the server mid-suite.
// ---------------------------------------------------------------------------

const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3005";

async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/admin/mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON body: leave {} and let the status assertion speak */
  }
  return { status: res.status, json };
}

function expect(name: string, cond: boolean, detail?: string) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond && detail) console.log(`          ${detail}`);
}

async function signed(
  pk: `0x${string}`,
  over: Partial<{ mode: ToggleableMode; issuedAt: number; expiry: number; nonce: number; actor: string }> = {},
) {
  const acct = privateKeyToAccount(pk);
  const now = Math.floor(Date.now() / 1000);
  const action: ModeAction = {
    mode: over.mode ?? "live-mainnet",
    actor: (over.actor ?? acct.address) as `0x${string}`,
    issuedAt: BigInt(over.issuedAt ?? now),
    expiry: BigInt(over.expiry ?? now + 90),
    nonce: BigInt(over.nonce ?? now),
  };
  const signature = await acct.signTypedData(buildModeActionTypedData(action));
  return {
    body: {
      mode: action.mode,
      actor: action.actor,
      issuedAt: String(action.issuedAt),
      expiry: String(action.expiry),
      nonce: String(action.nonce),
      signature,
    },
    signature,
  };
}

async function routeChecks() {
  const adminPk = process.env.SMOKE_ADMIN_PK as `0x${string}` | undefined;
  if (!adminPk) {
    console.log("\n  (set SMOKE_ADMIN_PK to a key in SONAR_ADMIN_ADDRESSES to run the route checks)");
    return;
  }
  const strangerPk = generatePrivateKey();

  const up = await fetch(`${BASE}/api/admin/mode/status`).then((r) => r.json()).catch(() => null);
  if (!up) {
    console.log(`\n  (server not reachable at ${BASE}; skipping route checks)`);
    return;
  }
  console.log(`\n7. Route auth (server says mode=${up.mode}, bootId=${String(up.bootId).slice(0, 8)})`);

  const stranger = await signed(strangerPk);
  expect(
    "a valid signature from a NON-allowlisted wallet is refused (403)",
    (await post(stranger.body)).status === 403,
  );

  const tampered = await signed(adminPk);
  tampered.body.signature = `0x${"1".repeat(130)}`;
  expect("a garbage signature is refused (401)", (await post(tampered.body)).status === 401);

  // Sign as the stranger but CLAIM the admin address: recovery must not match.
  const impersonation = await signed(strangerPk, { actor: privateKeyToAccount(adminPk).address });
  expect(
    "signing as one wallet while claiming another is refused (401)",
    (await post(impersonation.body)).status === 401,
  );

  const nowSec = Math.floor(Date.now() / 1000);
  expect(
    "an expired payload is refused (400)",
    (await post((await signed(adminPk, { issuedAt: nowSec - 600, expiry: nowSec - 300 })).body)).status === 400,
  );
  expect(
    "an over-long expiry window is refused (400)",
    (await post((await signed(adminPk, { expiry: nowSec + 86_400 })).body)).status === 400,
  );

  console.log("\n8. No-op and replay");
  // Requesting the mode we are already in: succeeds, changes nothing, no restart.
  const noop = await post((await signed(adminPk, { mode: "live-testnet" })).body);
  expect(
    "asking for the current mode is a no-op success with restartExpected=false",
    noop.status === 200 && noop.json.noop === true && noop.json.restartExpected === false,
    `got ${noop.status} ${JSON.stringify(noop.json)}`,
  );
  // Same signature again: the UNIQUE constraint must make it a replay, not a
  // second action. This is the check that stops a captured payload re-arming.
  const replaySigned = await signed(adminPk, { mode: "live-testnet" });
  await post(replaySigned.body);
  const replayed = await post(replaySigned.body);
  expect(
    "the same signature submitted twice is refused as replayed (409)",
    replayed.status === 409 && replayed.json.error === "replayed",
    `got ${replayed.status} ${JSON.stringify(replayed.json)}`,
  );

  console.log("\n9. Status endpoint");
  const s = await fetch(`${BASE}/api/admin/mode/status`);
  expect(
    "status is uncacheable (a cached mode would misreport a restart)",
    (s.headers.get("cache-control") ?? "").includes("no-store"),
    `cache-control: ${s.headers.get("cache-control")}`,
  );
}

routeChecks()
  .then(() => {
    console.log(`\n  ${pass} pass, ${fail} fail`);
    console.log(`  (testnet USDC pinned as ${VALUECHAIN_TESTNET_USDC})`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("smoke failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
