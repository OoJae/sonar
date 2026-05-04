// No `import "server-only"`: the reader is invoked from API routes, the agent
// runner, and CLI smoke tests. Same reasoning as lib/db/client.ts and
// lib/sodex/paper.ts.
import { createPublicClient, http, formatUnits, type Address, type PublicClient } from "viem";
import { base } from "viem/chains";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import {
  SSI_INDEXES,
  SSI_INDEX_KEYS,
  type SsiIndexKey,
} from "./addresses";
import { ssiTokenAbi } from "./abi/ssiToken";
import { cacheGet, cacheSet } from "@/lib/sosovalue/cache";

let clientCache: PublicClient | undefined;

function client(): PublicClient {
  if (!clientCache) {
    const e = env();
    clientCache = createPublicClient({
      chain: base,
      transport: http(e.BASE_RPC_URL),
      batch: { multicall: true },
    }) as PublicClient;
  }
  return clientCache;
}

// Per-share composition entry as returned by IAssetToken.getTokenset().
// `amount` is per-unit-of-share, scaled by `decimals`. Wave 2 will multiply
// each amount by an oracle-priced USD value to compute NAV per share.
export type TokensetEntry = {
  chain: string;
  symbol: string;
  addr: string;
  decimals: number;
  amount: string;
};

export type IndexSnapshot = {
  index: SsiIndexKey;
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  // navUSD is null in Wave 1 because SSI Protocol does not expose NAV on-chain.
  // It is computed off-chain from `tokenset` x oracle prices in Wave 2.
  navUSD: number | null;
  tokenset: TokensetEntry[];
  readAt: string;
};

const SNAPSHOT_TTL_SEC = 5 * 60;

function snapshotKey(index: SsiIndexKey) {
  return `sonar:ssi:snapshot:${index}`;
}

type RawTokensetEntry = {
  chain: string;
  symbol: string;
  addr: string;
  decimals: number;
  amount: bigint;
};

export async function readIndexSnapshot(
  index: SsiIndexKey,
): Promise<IndexSnapshot> {
  const cached = await cacheGet<IndexSnapshot>(snapshotKey(index));
  if (cached) return cached;

  const address = SSI_INDEXES[index] as Address;
  const c = client();
  const contract = { address, abi: ssiTokenAbi } as const;

  const results = await c.multicall({
    contracts: [
      { ...contract, functionName: "name" },
      { ...contract, functionName: "symbol" },
      { ...contract, functionName: "decimals" },
      { ...contract, functionName: "totalSupply" },
      { ...contract, functionName: "getTokenset" },
    ],
    allowFailure: true,
  });

  const [name, symbol, decimalsRes, totalSupplyRes, tokensetRes] = results;

  const decimals =
    decimalsRes && decimalsRes.status === "success"
      ? Number(decimalsRes.result)
      : 8;

  const totalSupply =
    totalSupplyRes && totalSupplyRes.status === "success"
      ? formatUnits(totalSupplyRes.result, decimals)
      : "0";

  const tokenset: TokensetEntry[] =
    tokensetRes && tokensetRes.status === "success"
      ? (tokensetRes.result as readonly RawTokensetEntry[]).map((t) => ({
          chain: t.chain,
          symbol: t.symbol,
          addr: t.addr,
          decimals: Number(t.decimals),
          amount: formatUnits(t.amount, Number(t.decimals)),
        }))
      : [];

  const snapshot: IndexSnapshot = {
    index,
    address,
    name:
      name && name.status === "success" ? String(name.result) : index,
    symbol:
      symbol && symbol.status === "success"
        ? String(symbol.result)
        : `${index}.ssi`,
    decimals,
    totalSupply,
    navUSD: null,
    tokenset,
    readAt: new Date().toISOString(),
  };

  await cacheSet(snapshotKey(index), snapshot, SNAPSHOT_TTL_SEC);
  return snapshot;
}

export async function readAllIndexSnapshots(): Promise<IndexSnapshot[]> {
  const out: IndexSnapshot[] = [];
  for (const key of SSI_INDEX_KEYS) {
    try {
      out.push(await readIndexSnapshot(key));
    } catch (err) {
      logger.warn("ssi.read_failed", {
        index: key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
