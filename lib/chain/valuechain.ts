// ValueChain venue constants, pinned by probe rather than by documentation.
//
// These exist because the execution mode is not one variable. Flipping to
// live-mainnet changes the SoDEX gateway (lib/sodex/client.ts sodexChain), AND
// the ValueChain RPC, AND the USDC margin contract. Miss one and the process
// boots cleanly into mainnet reading a testnet contract over a testnet RPC: the
// "am I funded?" readout returns zero at exactly the moment real money is armed.
//
// Every value below was probed on 2026-07-17, not taken from a doc. Two docs
// disagreed on the testnet RPC host (docs/mirror-bridge.md said
// testnet.valuechain.xyz, docs/api-integration.md said testnet-rpc...); both
// answer with chainId 138565, so the disagreement was harmless and .env.local's
// host is correct.
//
//   testnet.valuechain.xyz         -> 0x21d45 (138565)
//   testnet-rpc.valuechain.xyz     -> 0x21d45 (138565)
//   rpc.valuechain.xyz             -> 0x45f9f (286623)
//   mainnet-rpc.valuechain.xyz     -> 0x45f9f (286623)
//
// And the USDC pair, probed the same day. Note the cross rows: each address is
// dead code on the other chain, which is why a mode/address mismatch fails
// silently as a zero balance rather than loudly as an error, and therefore why
// lib/utils/env.ts binds these values to the mode at boot.
//
//   testnet RPC x testnet USDC -> SoDexToken: USDC / vUSDC / 6dp (4411 bytes)
//   mainnet RPC x mainnet USDC -> SoDexToken: USDC / vUSDC / 6dp (237 bytes)
//   testnet RPC x MAINNET USDC -> NO CODE
//   mainnet RPC x TESTNET USDC -> NO CODE
//
// Pure constants: no imports, so instrumentation.ts and scripts can read them
// without dragging in env() or the db.

export const VALUECHAIN_MAINNET_CHAIN_ID = 286623;
export const VALUECHAIN_TESTNET_CHAIN_ID = 138565;

export const VALUECHAIN_MAINNET_RPC = "https://rpc.valuechain.xyz";
export const VALUECHAIN_TESTNET_RPC = "https://testnet.valuechain.xyz";

export const VALUECHAIN_MAINNET_USDC = "0xcb7F80Dff2727c791fA491722c428e6657f7e2c6";
export const VALUECHAIN_TESTNET_USDC = "0x3fFe1743c2Cb5C9c9ED23d8CF62dD7aFABD4eE05";

/** Case-insensitive address compare. Avoids pulling viem's getAddress in here. */
export function sameAddressLoose(a: string | undefined, b: string): boolean {
  return (a ?? "").trim().toLowerCase() === b.toLowerCase();
}

/** Does this RPC host point at the given chain? Compared on host, not on the
 *  full URL, because both a bare and a trailing-slash form are in use and both
 *  testnet hosts are valid. */
export function rpcHostMatches(url: string | undefined, expected: string): boolean {
  if (!url) return false;
  try {
    return new URL(url).host === new URL(expected).host;
  } catch {
    return false;
  }
}

/** Every valid ValueChain mainnet RPC host (both probed as 286623). */
export const VALUECHAIN_MAINNET_RPC_HOSTS = [
  "rpc.valuechain.xyz",
  "mainnet-rpc.valuechain.xyz",
];

export function isMainnetRpc(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return VALUECHAIN_MAINNET_RPC_HOSTS.includes(new URL(url).host);
  } catch {
    return false;
  }
}
