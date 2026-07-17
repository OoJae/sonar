// EIP-712 scheme for the signed execution-mode flip.
//
// Modelled on lib/delegation/grant.ts, which already proves this pattern in this
// codebase: build typed data on the client, recover + verify on the server, and
// never trust a client-supplied typed-data blob. The server reconstructs the
// message from the individual fields so the signature provably covers exactly
// what gets acted on.
//
// This is the ONLY browser-reachable authentication in the app that authorizes
// anything privileged. The bearer CRON_SECRET cannot be used from a browser
// without shipping the secret to the client, which is a hard project constraint,
// and the existing wallet signing authenticates any visitor as themselves with no
// admin notion. So: a signature, checked against a server-side allowlist.
//
// Pure crypto, no DB, no "server-only", so scripts can exercise it. Same
// convention as grant.ts.

import {
  recoverTypedDataAddress,
  getAddress,
  type TypedDataDomain,
} from "viem";

// Same rationale as SESSION_GRANT_DOMAIN: verified server-side, never submitted
// to any chain, so chainId is purely a domain separator. Base (8453) keeps the
// wallet from showing a "wrong network" warning at signing time.
export const MODE_ACTION_DOMAIN: TypedDataDomain = {
  name: "Sonar Execution Mode",
  version: "1",
  chainId: 8453,
};

// Every field is enforced. `actor` is signed so the payload is bound to one
// identity and cannot be lifted onto another. `expiry` bounds the replay window
// even before the DB uniqueness check.
export const MODE_ACTION_TYPES = {
  ModeAction: [
    { name: "mode", type: "string" },
    { name: "actor", type: "address" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

// Only the two live modes are flippable from the browser. "paper" is excluded on
// purpose: it is a developer mode, and offering three states in a control whose
// job is "is real money armed" invites the wrong click. SSH remains the way to
// reach paper.
export type ToggleableMode = "live-testnet" | "live-mainnet";

export type ModeAction = {
  mode: ToggleableMode;
  actor: `0x${string}`;
  issuedAt: bigint;
  expiry: bigint;
  nonce: bigint;
};

// A signed request older than this is refused regardless of the nonce. Short,
// because the only legitimate gap between signing in a wallet and the POST
// landing is a few seconds.
export const MODE_ACTION_MAX_AGE_SEC = 120;

export function buildModeActionTypedData(a: ModeAction) {
  return {
    domain: MODE_ACTION_DOMAIN,
    types: MODE_ACTION_TYPES,
    primaryType: "ModeAction" as const,
    message: {
      mode: a.mode,
      actor: a.actor,
      issuedAt: a.issuedAt,
      expiry: a.expiry,
      nonce: a.nonce,
    },
  };
}

/** Case-insensitive address equality via checksum normalization (grant.ts idiom). */
export function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

export async function recoverModeActionSigner(
  a: ModeAction,
  signature: `0x${string}`,
): Promise<`0x${string}`> {
  return recoverTypedDataAddress({
    ...buildModeActionTypedData(a),
    signature,
  });
}

/**
 * Recover and verify in one step. Returns the recovered address only when it
 * matches the signed `actor`, so a caller cannot claim one identity and sign as
 * another.
 */
export async function verifyModeAction(
  a: ModeAction,
  signature: `0x${string}`,
): Promise<`0x${string}` | null> {
  try {
    const recovered = await recoverModeActionSigner(a, signature);
    return sameAddress(recovered, a.actor) ? recovered : null;
  } catch {
    return null;
  }
}
