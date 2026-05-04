import type { Address } from "viem";

// Base mainnet, chainId 8453. Source: CLAUDE.md section 3. Do not change
// without pulling a fresh set from the SoSoValue Labs ssi-protocol repo.
export const BASE_CHAIN_ID = 8453 as const;

export const SSI_INDEXES = {
  MAG7: "0x9E6A46f294bB67c20F1D1E7AfB0bBEf614403B55",
  DEFI: "0x164ffdaE2fe3891714bc2968f1875ca4fA1079D0",
  MEME: "0xdd3acDBDc7b358Df453a6CB6bCA56C92aA5743aA",
  USSI: "0x3a46ed8FCeb6eF1ADA2E4600A522AE7e24D2Ed18",
} as const satisfies Record<string, Address>;

export const SSI_PROTOCOL = {
  swap: "0xF909bfa750721501B4F8433588FaE5cE303Db08B",
  factory: "0xb04eB6b64137d1673D46731C8f84718092c50B0D",
  issuer: "0x0306acEb4c20FF33480d90038F8b375cC6A6b66e",
  rebalancer: "0x84663e30973D552ac357FD04F3Ac6ebbD495Ab15",
  feeManager: "0x2E469365030F068eCB1176a0D5600bA470Cf07A9",
  stakeFactory: "0x585834242BB31427B1dC7486DD4BDe7c724e35c1",
  assetLocking: "0x935A4B1F6F3E891a226b2522ac22d45Ce5839383",
} as const satisfies Record<string, Address>;

export type SsiIndexKey = keyof typeof SSI_INDEXES;
export const SSI_INDEX_KEYS = Object.keys(SSI_INDEXES) as SsiIndexKey[];

// ValueChain lives on a different chain, tracked here for reference.
// SoDEX execution lands on ValueChain in Wave 2.
export const VALUECHAIN_CHAIN_ID = 286623 as const;
