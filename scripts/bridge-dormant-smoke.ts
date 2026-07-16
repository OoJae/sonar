#!/usr/bin/env tsx
//
// Proves the Mirror bridge is dormant, rather than taking the comments' word.
//
// The claim under test: lib/chain/bridge.ts cannot build a bridge transaction in
// any configuration reachable today, and it does not report itself available.
// The case that matters is the last one: setting BOTH MIRROR_BRIDGE_* addresses
// must NOT flip isBridgeAvailable(), because the ABI is the real blocker and no
// env var can satisfy it. The previous version of that function gated on the
// addresses alone, so it would have claimed "available" while buildBridgeTx
// still threw.
//
// Each case runs in its OWN process. That is not a workaround for env() being
// cached; it is faithful to the real contract, where env is read once per
// process and changing the mode requires a restart. A single-process test that
// mutated env would prove something the app never does.
//
// No network, no chain, no DB.
//
// Usage: pnpm tsx scripts/bridge-dormant-smoke.ts

import "./_env";
import { spawnSync } from "node:child_process";

const CASE_VAR = "__BRIDGE_SMOKE_CASE";

const MAINNET_ENV: Record<string, string> = {
  SONAR_EXECUTION_MODE: "live-mainnet",
  SONAR_ALLOW_MAINNET: "true",
  SONAR_REQUIRE_MANUAL_APPROVAL: "true",
  SODEX_API_KEY: "smoke-key-name",
  SODEX_MAINNET_SIGNING_KEY: `0x${"1".repeat(64)}`,
  VALUECHAIN_USDC_ADDRESS: `0x${"2".repeat(40)}`,
  SODEX_WALLET_PRIVATE_KEY: `0x${"3".repeat(64)}`,
};

const CASES: Record<string, { label: string; env: Record<string, string> }> = {
  testnet: {
    label: "Off mainnet: the module refuses outright",
    env: { SONAR_EXECUTION_MODE: "live-testnet", MIRROR_BRIDGE_BASE_ADDRESS: "", MIRROR_BRIDGE_VALUECHAIN_ADDRESS: "" },
  },
  "mainnet-no-addrs": {
    label: "On mainnet, addresses absent: still refuses",
    env: { ...MAINNET_ENV, MIRROR_BRIDGE_BASE_ADDRESS: "", MIRROR_BRIDGE_VALUECHAIN_ADDRESS: "" },
  },
  "mainnet-with-addrs": {
    label: "THE ONE THAT MATTERS: on mainnet WITH both addresses set",
    env: {
      ...MAINNET_ENV,
      MIRROR_BRIDGE_BASE_ADDRESS: `0x${"a".repeat(40)}`,
      MIRROR_BRIDGE_VALUECHAIN_ADDRESS: `0x${"b".repeat(40)}`,
    },
  },
};

const TX_INPUT = {
  direction: "base->valuechain" as const,
  amountUsdc: 1_000_000n,
  recipient: `0x${"4".repeat(40)}` as `0x${string}`,
};

// ---------------------------------------------------------------------------
// Child: run one case in a process whose env was set by the parent.
// ---------------------------------------------------------------------------
async function runCase(name: string): Promise<number> {
  const { buildBridgeTx, isBridgeAvailable, bridgeBlockers } = await import(
    "@/lib/chain/bridge"
  );
  let pass = 0;
  let fail = 0;
  const check = (label: string, cond: boolean, detail = "") => {
    if (cond) {
      pass++;
      console.log(`  PASS  ${label}`);
    } else {
      fail++;
      console.log(`  FAIL  ${label} ${detail}`);
    }
  };

  const threw = (fn: () => unknown): string | null => {
    try {
      fn();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  if (name === "testnet") {
    const msg = threw(() => buildBridgeTx(TX_INPUT));
    check("buildBridgeTx throws off mainnet (assertMainnet)", (msg ?? "").includes("mainnet design only"), msg ?? "did not throw");
    check("isBridgeAvailable() is false off mainnet", isBridgeAvailable() === false);
  }

  if (name === "mainnet-no-addrs") {
    const msg = threw(() => buildBridgeTx(TX_INPUT));
    check("buildBridgeTx throws on mainnet", (msg ?? "").includes("not implemented"), msg ?? "did not throw");
    check("isBridgeAvailable() is false", isBridgeAvailable() === false);
    const b = bridgeBlockers();
    check("blockers name both addresses AND the ABI", b.length === 3, JSON.stringify(b));
  }

  if (name === "mainnet-with-addrs") {
    // Addresses alone must not imply a usable bridge: we could name the contract
    // and still be unable to call it.
    check(
      "isBridgeAvailable() is STILL false with both addresses set",
      isBridgeAvailable() === false,
      "addresses alone must not flip availability; the ABI is the blocker",
    );
    const b = bridgeBlockers();
    check("the ABI is the ONLY remaining blocker", b.length === 1 && b[0]!.includes("ABI"), JSON.stringify(b));
    const msg = threw(() => buildBridgeTx(TX_INPUT));
    check("buildBridgeTx still throws, naming the ABI", (msg ?? "").includes("ABI"), msg ?? "did not throw");
  }

  console.log(`__RESULT__ ${pass} ${fail}`);
  return fail === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Parent: spawn one process per case.
// ---------------------------------------------------------------------------
async function main() {
  const childCase = process.env[CASE_VAR];
  if (childCase) {
    process.exit(await runCase(childCase));
  }

  let totalPass = 0;
  let totalFail = 0;
  let i = 0;
  for (const [name, spec] of Object.entries(CASES)) {
    i++;
    console.log(`${i}. ${spec.label}`);
    // Re-enter through tsx: the child is a TypeScript file, so plain node cannot
    // resolve it.
    const res = spawnSync(
      "pnpm",
      ["exec", "tsx", process.argv[1]!],
      {
        env: {
          ...process.env,
          ...spec.env,
          [CASE_VAR]: name,
        },
        encoding: "utf8",
      },
    );
    const out = `${res.stdout ?? ""}`;
    for (const line of out.split("\n")) {
      if (line.startsWith("__RESULT__")) {
        const [, p, f] = line.split(" ");
        totalPass += Number(p);
        totalFail += Number(f);
      } else if (line.trim().startsWith("PASS") || line.trim().startsWith("FAIL")) {
        console.log(line);
      }
    }
    if (res.status !== 0 && !out.includes("__RESULT__")) {
      console.log(`  FAIL  case "${name}" crashed: ${(res.stderr ?? "").slice(0, 300)}`);
      totalFail++;
    }
    console.log("");
  }

  console.log(`Results: ${totalPass} pass, ${totalFail} fail`);
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Bridge dormancy smoke FAILED:", err);
  process.exit(1);
});
