// Mode-toggle safety smoke. Grows as the feature lands: today it proves the
// mode-bound env guard accepts the live config and rejects every half-flipped
// config that would otherwise boot into mainnet reading testnet contracts.
//
// Usage: pnpm tsx scripts/mode-toggle-smoke.ts

import "./_env";
import { validateEnvCandidate } from "@/lib/utils/env";
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

console.log(`\n  ${pass} pass, ${fail} fail`);
console.log(`  (testnet USDC pinned as ${VALUECHAIN_TESTNET_USDC})`);
process.exit(fail === 0 ? 0 : 1);
