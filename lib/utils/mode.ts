// Execution-mode display helpers. The dashboard shows the live
// SONAR_EXECUTION_MODE rather than a hardcoded "Wave 1 paper" label, so the
// UI tells the truth as the mode changes (paper | live-testnet | live-mainnet).
// Server-side only (reads env); call from server components.
//
// This is the single source of truth for mode-dependent claims. Behaviour really
// does differ per mode (the risk gate only exists on the live paths; mainnet
// records orders for human approval instead of submitting them; delta-neutral
// skips mainnet; the public demo trigger is disabled there), so a page saying
// what Sonar does right now should render executionModeDescription() rather than
// hardcode a sentence that goes stale the moment the mode flips. /portfolio used
// to claim "the mode badge is the only thing that changes between paper and
// live", which the approval gate made false.

import { env } from "./env";

export type ExecutionMode = "paper" | "live-testnet" | "live-mainnet";

export function executionMode(): ExecutionMode {
  return env().SONAR_EXECUTION_MODE;
}

// Short badge label, e.g. "live-testnet".
export function executionModeLabel(): string {
  return env().SONAR_EXECUTION_MODE;
}

// One-line description for headers and disclosures. Each string says what
// actually happens to an order in that mode, since that is what a reader is
// trying to work out.
export function executionModeDescription(): string {
  switch (env().SONAR_EXECUTION_MODE) {
    case "live-testnet":
      return "Live SoDEX testnet execution. Perp hedges fire as EIP-712 signed orders through the risk gate; SSI rebalance legs are simulated against the book.";
    case "live-mainnet":
      // The approval gate is the headline property of this mode, so lead with it.
      return "Live SoDEX mainnet execution, human-approval-gated: the daily cycle records perp hedges for approval and never submits one itself, and only an authenticated approval places an order. SSI rebalance legs are simulated against the book.";
    default:
      // Do not nudge the reader toward live execution from inside the copy that
      // documents the kill switch.
      return "Paper execution. Nothing reaches a venue and no funds are at risk; every order is simulated against the book.";
  }
}
