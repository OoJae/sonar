// Minimal SSI Asset Token ABI fragment. Source:
// https://github.com/SoSoValueLabs/ssi-protocol/blob/main/src/Interface.sol
// (interface IAssetToken). We commit only the view methods we actually call.
//
// NAV per share is NOT exposed on-chain by the protocol; it must be computed
// off-chain by aggregating oracle prices for each Token in the tokenset.
// Wave 1 reads composition only and leaves NAV null. Wave 2 wires pricing.

export const ssiTokenAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getTokenset",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "chain", type: "string" },
          { name: "symbol", type: "string" },
          { name: "addr", type: "string" },
          { name: "decimals", type: "uint8" },
          { name: "amount", type: "uint256" },
        ],
      },
    ],
  },
] as const;
