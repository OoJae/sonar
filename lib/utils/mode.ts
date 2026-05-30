// Execution-mode display helpers. The dashboard shows the live
// SONAR_EXECUTION_MODE rather than a hardcoded "Wave 1 paper" label, so the
// UI tells the truth as the mode changes (paper | live-testnet | live-mainnet).
// Server-side only (reads env); call from server components.

import { env } from "./env";

export type ExecutionMode = "paper" | "live-testnet" | "live-mainnet";

export function executionMode(): ExecutionMode {
  return env().SONAR_EXECUTION_MODE;
}

// Short badge label, e.g. "live-testnet".
export function executionModeLabel(): string {
  return env().SONAR_EXECUTION_MODE;
}

// One-line description for headers and disclosures.
export function executionModeDescription(): string {
  switch (env().SONAR_EXECUTION_MODE) {
    case "live-testnet":
      return "Live SoDEX testnet execution. Perp hedges fire as EIP-712 signed orders; SSI rebalance legs are recorded against the book.";
    case "live-mainnet":
      return "Live mainnet execution behind the hard-gated opt-in.";
    default:
      return "Paper execution. Flip SONAR_EXECUTION_MODE to live-testnet to place real signed orders on SoDEX.";
  }
}
