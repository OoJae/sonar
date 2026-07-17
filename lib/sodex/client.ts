// No `import "server-only"`: this module is imported from scripts/sodex-*.ts
// smoke tests under tsx. Same reasoning as lib/db/client.ts and
// lib/sodex/paper.ts. None of the exported functions are safe to bundle into
// a client component, but the boundary is enforced by route-level use
// rather than import attribute.
import { z } from "zod";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import {
  AccountStateSchema,
  SpotPairSchema,
  SymbolInfoSchema,
  SodexOrderSnapshotSchema,
  type AccountState,
  type SpotPair,
  type SymbolInfo,
  type SodexOrderSnapshot,
} from "./types";

// Thin Wave 1 SoDEX client. We hit the documented REST endpoints to prove
// integration (bonus credit) without committing to live execution. Paper
// trading in paper.ts is the Wave 1 execution path.
//
// The exact response envelope on https://sodex.com/documentation/api/rest-v1
// is still being verified by the SoDEX team. We parse defensively: unknown
// top-level fields are allowed.

const SpotPairsEnvelopeSchema = z.union([
  z.object({ data: z.array(SpotPairSchema) }).passthrough(),
  z.array(SpotPairSchema),
]);

export type SodexHealth = {
  ok: boolean;
  latencyMs: number;
  note: string;
};

const FALLBACK_PAIRS: SpotPair[] = [
  { symbol: "USSI-USDC", baseAsset: "USSI", quoteAsset: "USDC" },
  { symbol: "MAG7-USDC", baseAsset: "MAG7.ssi", quoteAsset: "USDC" },
  { symbol: "DEFI-USDC", baseAsset: "DEFI.ssi", quoteAsset: "USDC" },
  { symbol: "MEME-USDC", baseAsset: "MEME.ssi", quoteAsset: "USDC" },
];

export async function listSpotPairs(): Promise<SpotPair[]> {
  const e = env();
  if (!e.SODEX_API_KEY) {
    logger.info("sodex.fallback_pairs", { reason: "no_key" });
    return FALLBACK_PAIRS;
  }
  try {
    const res = await fetch(new URL("/rest/v1/spot/pairs", e.SODEX_BASE_URL), {
      headers: {
        "x-api-key": e.SODEX_API_KEY,
        accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      logger.warn("sodex.pairs_http_error", { status: res.status });
      return FALLBACK_PAIRS;
    }
    const json: unknown = await res.json();
    const parsed = SpotPairsEnvelopeSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn("sodex.pairs_parse_error", {
        issues: parsed.error.issues.slice(0, 3),
      });
      return FALLBACK_PAIRS;
    }
    return Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
  } catch (err) {
    logger.warn("sodex.pairs_exception", {
      error: err instanceof Error ? err.message : String(err),
    });
    return FALLBACK_PAIRS;
  }
}

export async function healthCheck(): Promise<SodexHealth> {
  const e = env();
  if (!e.SODEX_API_KEY) {
    return {
      ok: false,
      latencyMs: 0,
      note: "SODEX_API_KEY not set; using fallback spot pair list",
    };
  }
  const start = Date.now();
  try {
    const res = await fetch(new URL("/rest/v1/time", e.SODEX_BASE_URL), {
      cache: "no-store",
    });
    return {
      ok: res.ok,
      latencyMs: Date.now() - start,
      note: res.ok ? "live" : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      note: err instanceof Error ? err.message : "network error",
    };
  }
}

// ===========================================================================
// SoDEX signed-request layer (testnet + mainnet).
//
// BOTH venues sign identically: the master wallet private key, X-API-Sign +
// X-API-Nonce only, no X-API-Key. Mainnet differs from testnet in exactly two
// things, the gateway URL and the EIP-712 domain chainId (286623 vs 138565).
//
// docs/sodex-live.md §13 used to claim mainnet required an addAPIKey ceremony
// registering a separate keypair, sending X-API-Key + X-API-Chain. That is
// FALSE, and it was never probed until 2026-07-17. There is no addAPIKey
// endpoint (POST returns "404 page not found"), and a master-signed write with
// no X-API-Key is accepted by BOTH mainnet engines: the spot transfer answered
// "insufficient balance" and the perps order answered with body validation,
// i.e. both got past auth into business logic. A bad signature on this venue
// looks different and unmistakable ("Invalid recovery ID: bad recovery id").
//
// The consequence worth naming: there is no revocable sub-key on this venue.
// The master wallet that holds the funds is also the key that signs writes. We
// cannot invent a key model the venue does not implement, so the mitigation is
// the balance (symbolic) and the approval gate, not key hygiene.
//
// The mode is read from SONAR_EXECUTION_MODE and env() is cached, so a mode
// flip requires an app restart. That also clears aidCache / symbolNameToInfo,
// which is what we want: those ids are per-venue.
// ===========================================================================

const TESTNET_CHAIN_ID = 138565;
const MAINNET_CHAIN_ID = 286623;
const SIG_PREFIX = "0x01";

type Kind = "spot" | "perps";

type SodexChain = {
  chainId: number;
  baseUrl: string;
  isMainnet: boolean;
};

// The single place the venue is decided. Testnet returns exactly what the
// pre-mainnet code hardcoded, so that path is byte-for-byte unchanged.
function sodexChain(): SodexChain {
  const e = env();
  if (e.SONAR_EXECUTION_MODE === "live-mainnet") {
    return {
      chainId: MAINNET_CHAIN_ID,
      baseUrl: e.SODEX_MAINNET_BASE_URL,
      isMainnet: true,
    };
  }
  return {
    chainId: TESTNET_CHAIN_ID,
    baseUrl: e.SODEX_TESTNET_BASE_URL,
    isMainnet: false,
  };
}

// Cached signer so we do not re-derive the address per request.
let cachedAccount: ReturnType<typeof privateKeyToAccount> | null = null;
function getAccount() {
  if (cachedAccount) return cachedAccount;
  const key = env().SODEX_WALLET_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "SODEX_WALLET_PRIVATE_KEY is not set. Required for any signed testnet call.",
    );
  }
  cachedAccount = privateKeyToAccount(key as `0x${string}`);
  return cachedAccount;
}

// The MASTER wallet address: the SoDEX account owner, and the signer of every
// write, on both venues.
export function getSignerAddress(): `0x${string}` {
  return getAccount().address;
}

function gateway(kind: Kind): string {
  return `${sodexChain().baseUrl}/${kind}`;
}

// EIP-712 domain. The `name` field switches between "spot" and "futures"
// depending on which REST surface the request targets, per the schema page.
// chainId binds the signature to the venue, so it must track the mode.
function eipDomain(kind: Kind) {
  return {
    name: kind === "spot" ? "spot" : "futures",
    version: "1",
    chainId: sodexChain().chainId,
    verifyingContract: "0x0000000000000000000000000000000000000000" as const,
  };
}

const exchangeActionTypes = {
  ExchangeAction: [
    { name: "payloadHash", type: "bytes32" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

// Used for monotonically increasing nonces across rapid retries within a
// single process. Date.now() resolution is 1ms, which is enough for our
// cadence; this bump just guards against same-millisecond collisions.
let lastNonce = 0n;
function nextNonce(): bigint {
  const now = BigInt(Date.now());
  if (now <= lastNonce) {
    lastNonce = lastNonce + 1n;
  } else {
    lastNonce = now;
  }
  return lastNonce;
}

type SignedAction<T extends Record<string, unknown>> = {
  type: string;
  params: T;
};

// Build the canonical payload + signed headers for a single action. Returns
// both because the body of the HTTP request is `params` (not the whole
// payload), while the signature covers the whole `{type, params}` envelope.
async function signAction<T extends Record<string, unknown>>(
  kind: Kind,
  action: SignedAction<T>,
): Promise<{
  sign: `0x${string}`;
  nonce: string;
  payload: SignedAction<T>;
}> {
  const compactJson = JSON.stringify(action);
  const payloadHash = keccak256(toBytes(compactJson));
  const nonce = nextNonce();
  const sig = await getAccount().signTypedData({
    domain: eipDomain(kind),
    types: exchangeActionTypes,
    primaryType: "ExchangeAction",
    message: { payloadHash, nonce },
  });
  // Normalize the ECDSA recovery byte (v). viem returns v as 27 or 28
  // (Ethereum legacy convention). The SoDEX server uses go-ethereum's
  // crypto.SigToPub which expects v as 0 or 1 (raw recovery id). Without
  // this normalization the server errors `Invalid recovery ID: bad recovery
  // id` despite payload + nonce + domain all being correct, because the
  // last byte fails the recovery-id sanity check.
  const rsHex = sig.slice(2, 130); // 64-byte r||s
  const vByte = parseInt(sig.slice(130, 132), 16);
  const normalizedV = vByte >= 27 ? vByte - 27 : vByte;
  const normalizedHex = vByte === normalizedV ? sig.slice(130, 132) : normalizedV.toString(16).padStart(2, "0");
  const rawSig = `0x${rsHex}${normalizedHex}`;
  return {
    sign: (SIG_PREFIX + rawSig.slice(2)) as `0x${string}`,
    nonce: nonce.toString(),
    payload: action,
  };
}

// Stamp the signed-write headers onto a fetch request. Two headers on BOTH
// venues, by design: X-API-Sign + X-API-Nonce. X-API-Key is omitted (the Discord
// rule for testnet, and probed to be equally true on mainnet, 2026-07-17).
// X-API-Chain is not sent either; the Go SDK does not send it and the chain id
// is already bound into the EIP-712 domain at signing time (see signAction).
function signedHeaders(sign: `0x${string}`, nonce: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-API-Sign": sign,
    "X-API-Nonce": nonce,
  };
}

// Defensive logger for non-2xx responses; never logs the signature beyond a
// safe prefix and never logs the private key.
async function logHttpError(
  context: string,
  res: Response,
  sign: `0x${string}`,
  nonce: string,
): Promise<string> {
  const body = await res.text().catch(() => "");
  logger.warn("sodex.signed_http_error", {
    context,
    status: res.status,
    nonce,
    signPrefix: sign.slice(0, 10),
    bodyHead: body.slice(0, 500),
  });
  return body;
}

// ---------------------------------------------------------------------------
// Public API: getAccountState
//
// The mandatory pre-step before any signed trading action (per Discord
// clarification in docs/sodex-live.md §4). The returned `aid` is what the
// order payload's `accountID` field must equal exactly.
//
// Discovered against testnet 2026-05-28: this endpoint is an UNSIGNED public
// read. We tried sending the EIP-712 signed-read variant and got 404 due to
// a URL bug; an unsigned curl with just Accept: application/json returned 200
// with the real account data. Keeping it unsigned matches actual server
// behaviour and side-steps a class of signing bugs on a read that does not
// need them. Signed-write validation lives in the order submit path (Phase 2.2).
// ---------------------------------------------------------------------------
export async function getAccountState(opts?: {
  kind?: Kind;
  address?: `0x${string}`;
}): Promise<AccountState> {
  const kind: Kind = opts?.kind ?? "perps";
  const address = opts?.address ?? getSignerAddress();
  const url = `${gateway(kind)}/accounts/${address}/state`;
  let res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  // Mainnet may gate reads that testnet leaves public. Rather than assume,
  // stay unsigned-first (the testnet-proven path) and only escalate to a
  // signed read if the venue actually rejects the anonymous one. This is also
  // the runbook's proof that the registered key + header trio are accepted.
  if (!res.ok && sodexChain().isMainnet && (res.status === 401 || res.status === 403)) {
    logger.info("sodex.account_state_signed_retry", { kind, status: res.status });
    const { sign, nonce } = await signAction(kind, {
      type: "accountState",
      params: { accountAddress: address },
    });
    res = await fetch(url, {
      method: "GET",
      headers: signedHeaders(sign, nonce),
      cache: "no-store",
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn("sodex.account_state_http_error", {
      kind,
      status: res.status,
      bodyHead: body.slice(0, 200),
    });
    throw new Error(`SoDEX getAccountState ${kind} ${res.status}: ${body.slice(0, 200)}`);
  }
  const json: unknown = await res.json();
  // Some endpoints return a wrapped envelope; unwrap defensively before
  // schema validation.
  const candidate =
    typeof json === "object" && json !== null && "data" in (json as Record<string, unknown>)
      ? (json as { data: unknown }).data
      : json;
  const parsed = AccountStateSchema.safeParse(candidate);
  if (!parsed.success) {
    logger.warn("sodex.account_state_parse_error", {
      issues: parsed.error.issues.slice(0, 3),
    });
    throw new Error(
      `SoDEX getAccountState ${kind} response did not match schema: ${
        parsed.error.issues[0]?.message ?? "unknown"
      }`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Public API: getPerpPositionUsd
//
// Signed USD notional of the CURRENT open position in one perp market:
// positive is long, negative is short, 0 is flat. The venue is authoritative
// here (not our paper book), because the position cap has to bound what the
// exchange actually holds.
//
// Notional is |size| * mark, signed by the size. `cp` (mark) is preferred but
// is not always populated (observed "0" on an open SOL-USD position), so we
// fall back to `ep` (entry). A position we cannot price returns 0, which is
// the conservative direction for a REDUCING order (never block a de-risk) but
// would under-count an increasing one; the per-order and per-cycle caps still
// bound that case.
// ---------------------------------------------------------------------------
export async function getPerpPositionUsd(symbolName: string): Promise<number> {
  const state = await getAccountState({ kind: "perps" });
  const positions = state.P ?? [];
  const match = positions.find((p) => p.s === symbolName);
  if (!match) return 0;
  const size = Number(match.sz ?? 0);
  if (!Number.isFinite(size) || size === 0) return 0;
  const mark = Number(match.cp ?? 0);
  const entry = Number(match.ep ?? 0);
  const price = Number.isFinite(mark) && mark > 0 ? mark : entry;
  if (!Number.isFinite(price) || price <= 0) {
    logger.warn("sodex.position_unpriced", { symbolName, size });
    return 0;
  }
  return size * price;
}

// Gross USD notional across every open perp position (sum of absolute values).
// Used by the gross-exposure gate.
export async function getGrossPerpExposureUsd(): Promise<number> {
  const state = await getAccountState({ kind: "perps" });
  const positions = state.P ?? [];
  let gross = 0;
  for (const p of positions) {
    const size = Number(p.sz ?? 0);
    if (!Number.isFinite(size) || size === 0) continue;
    const mark = Number(p.cp ?? 0);
    const entry = Number(p.ep ?? 0);
    const price = Number.isFinite(mark) && mark > 0 ? mark : entry;
    if (!Number.isFinite(price) || price <= 0) continue;
    gross += Math.abs(size * price);
  }
  return gross;
}

// In-process cache of the per-kind account id. The aid is stable per process
// and only the first call hits the wire; the rest are O(1).
const aidCache = new Map<Kind, number>();
export async function getAccountId(kind: Kind = "perps"): Promise<number> {
  const hit = aidCache.get(kind);
  if (hit !== undefined) return hit;
  const state = await getAccountState({ kind });
  aidCache.set(kind, state.aid);
  return state.aid;
}

// ---------------------------------------------------------------------------
// Public API: getVenueVusdc
//
// Returns the SoDEX venue-ledger vUSDC balance for the agent wallet, split by
// engine (spot, perps). This is the execution capital: it is held inside the
// SoDEX exchange, not as a raw ERC-20 in the wallet (the on-chain balanceOf
// at the wallet address is 0 because deposits are custodied by the venue).
//
// Shapes confirmed by probe 2026-05-29:
//   spot /state  data.B  = [{i, a:"vUSDC", t:"800", l:"0"}]  (t = total)
//   perps /balances data.balances = [{id, coin:"vUSDC", total:"200", ...}]
// Both reads are unsigned public account reads.
// ---------------------------------------------------------------------------
export async function getVenueVusdc(): Promise<{
  spot: number | null;
  perps: number | null;
}> {
  const address = getSignerAddress();

  // null means the read FAILED (unknown), which must be distinguishable from a
  // genuine 0 balance: rendering an outage as "$0.00" tells an operator arming
  // mainnet that their deposit did not land. A value is set to 0 only once the
  // read itself succeeds, then overridden if a vUSDC row is present.
  let spot: number | null = null;
  try {
    const spotState = await getAccountState({ kind: "spot" });
    spot = 0; // read succeeded; 0 unless a vUSDC row says otherwise
    const balances = (spotState as Record<string, unknown>).B;
    if (Array.isArray(balances)) {
      const vusdc = balances.find(
        (b): b is Record<string, unknown> =>
          typeof b === "object" && b !== null && (b as Record<string, unknown>).a === "vUSDC",
      );
      if (vusdc && typeof vusdc.t !== "undefined") {
        const n = Number(vusdc.t);
        if (Number.isFinite(n)) spot = n;
      }
    }
  } catch (err) {
    logger.warn("sodex.venue_spot_read_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let perps: number | null = null;
  try {
    const res = await fetch(
      `${gateway("perps")}/accounts/${address}/balances`,
      { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" },
    );
    if (res.ok) {
      perps = 0; // read succeeded
      const json = (await res.json()) as {
        data?: { balances?: Array<{ coin?: string; total?: string | number }> };
      };
      const vusdc = json.data?.balances?.find((b) => b.coin === "vUSDC");
      if (vusdc && vusdc.total !== undefined) {
        const n = Number(vusdc.total);
        if (Number.isFinite(n)) perps = n;
      }
    }
    // A non-ok response is a failed read: perps stays null, not 0.
  } catch (err) {
    logger.warn("sodex.venue_perps_read_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { spot, perps };
}

// ---------------------------------------------------------------------------
// Public API: listPerpSymbols
//
// Public unauthenticated read returning all tradeable perpetual contracts on
// the testnet. Each symbol carries a numeric `id` (the symbolID required by
// order submission payloads) and a human-readable `name` like "BTC-USD".
// 43 symbols at probe time on 2026-05-28; BTC=1, ETH=2, SOL=4.
// ---------------------------------------------------------------------------
const PerpSymbolsEnvelopeSchema = z
  .object({ data: z.array(SymbolInfoSchema) })
  .passthrough();

export async function listPerpSymbols(): Promise<SymbolInfo[]> {
  const url = `${gateway("perps")}/markets/symbols`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SoDEX listPerpSymbols ${res.status}: ${body.slice(0, 200)}`);
  }
  const json: unknown = await res.json();
  const parsed = PerpSymbolsEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `SoDEX listPerpSymbols response did not match schema: ${
        parsed.error.issues[0]?.message ?? "unknown"
      }`,
    );
  }
  return parsed.data.data;
}

// In-process cache of the (name -> id) map. Symbols are static-ish; the cache
// stays warm for the process lifetime.
let symbolNameToInfo: Map<string, SymbolInfo> | null = null;
async function loadSymbolInfo(): Promise<Map<string, SymbolInfo>> {
  if (!symbolNameToInfo) {
    const list = await listPerpSymbols();
    symbolNameToInfo = new Map(list.map((s) => [s.name, s]));
  }
  return symbolNameToInfo;
}

export async function resolvePerpSymbolId(name: string): Promise<number> {
  const map = await loadSymbolInfo();
  const info = map.get(name);
  if (info === undefined) {
    throw new Error(
      `SoDEX perp symbol "${name}" not found in testnet listing. Available: ${
        Array.from(map.keys()).slice(0, 10).join(", ")
      }...`,
    );
  }
  return info.id;
}

// Venue trading rules for a perp symbol (quantity precision, step, min qty),
// used to size market sells to a step-aligned quantity.
export async function getPerpSymbolInfo(
  name: string,
): Promise<SymbolInfo | null> {
  return (await loadSymbolInfo()).get(name) ?? null;
}

// ---------------------------------------------------------------------------
// Order enums (mirroring the Go SDK in common/enums/*).
//
// Field order in the order payload matters: the SoDEX server re-marshals via
// json.Marshal to recompute payloadHash, and json.Marshal in Go preserves
// struct field order. JS object literals preserve insertion order in ES2015+,
// so constructing the order with keys in the documented order produces a
// canonical payload that matches what the server hashes.
// ---------------------------------------------------------------------------
const SodexOrderSide = { Buy: 1, Sell: 2 } as const;
const SodexOrderType = { Limit: 1, Market: 2 } as const;
const SodexTimeInForce = { GTC: 1, FOK: 2, IOC: 3, GTX: 4 } as const;
const SodexPositionSide = { Both: 1, Long: 2, Short: 3 } as const;
const SodexOrderModifier = { Normal: 1, Stop: 2, Bracket: 3, AttachedStop: 4 } as const;

// Submit-order payload shape (matches perps/types/new_order_request.go).
// quantity and funds are exclusive; specify exactly one. Market buys typically
// use funds (USD notional), market sells use quantity (asset units).
export type SubmitPerpOrderInput = {
  side: "buy" | "sell";
  symbolName: string;       // e.g. "BTC-USD"; resolved to symbolID via the cache.
  type: "market" | "limit";
  clOrdID: string;          // our client order id. NOT a venue idempotency key: probed 2026-07-17, the venue does NOT dedupe a repeated clOrdID (same key twice = two orders, both fill). Idempotency is enforced by our own UNIQUE orders.client_order_id.
  // Exactly one of quantity / funds. For market orders we typically pass funds.
  quantity?: string;
  funds?: string;
  // Required for limit orders only.
  price?: string;
  // Optional: defaults to Both (one-way mode). For explicit hedging on
  // hedge-mode accounts, set Long or Short.
  positionSide?: "both" | "long" | "short";
  // Marks the order as strictly position-reducing. This is not cosmetic: with
  // reduceOnly false the engine margins the order as NEW exposure, so once an
  // account is at its margin limit even a closing order is rejected with
  // "insufficient margin" and the position cannot be exited (observed on
  // testnet 2026-07-16 while trying to flatten an over-leveraged book). Any
  // close must set this true.
  reduceOnly?: boolean;
};

export type SubmitPerpOrderResult = {
  clOrdID: string;
  // The system order id ("i" in the wire response). May be returned synchronously
  // on submit, or surface only on the next status poll.
  sodexOrderId: string | null;
  status: SodexOrderSnapshot["X"]; // wire-side status enum
  // The raw response body, for logging and downstream debug.
  raw: unknown;
};

// ---------------------------------------------------------------------------
// Public API: submitPerpOrder
//
// Signs a NewOrderRequest with the master wallet private key (futures domain,
// chainId 138565 on testnet) and posts to /perps/trade/orders. This is the
// only call path that exercises signing on the testnet, so Phase 2.2's
// scripts/sodex-live-smoke.ts is also the de-facto signing-validation test.
//
// Idempotency is OURS, not the venue's. Probed 2026-07-17: the same clOrdID
// submitted twice creates two orders and both fill; the venue does not dedupe.
// So the lib/sodex/live.ts caller persists an `orders` row with a UNIQUE
// client_order_id BEFORE this call, and that DB constraint is the only thing
// that stops a double-place. Do not rely on any server-side dedupe here.
// ---------------------------------------------------------------------------
export async function submitPerpOrder(
  input: SubmitPerpOrderInput,
): Promise<SubmitPerpOrderResult> {
  const symbolID = await resolvePerpSymbolId(input.symbolName);
  const accountID = await getAccountId("perps");

  if ((input.quantity === undefined) === (input.funds === undefined)) {
    throw new Error(
      "submitPerpOrder requires exactly one of { quantity, funds }.",
    );
  }
  if (input.type === "limit" && !input.price) {
    throw new Error("submitPerpOrder type=limit requires a price.");
  }

  // Build the order with keys in the canonical field order (matches the Go
  // SDK struct order so the server's json.Marshal recomputes the same hash).
  // omitempty fields are simply not included when the value is undefined.
  type RawOrder = {
    clOrdID: string;
    modifier: number;
    side: number;
    type: number;
    timeInForce: number;
    price?: string;
    quantity?: string;
    funds?: string;
    reduceOnly: boolean;
    positionSide: number;
  };
  const rawOrder: RawOrder = {
    clOrdID: input.clOrdID,
    modifier: SodexOrderModifier.Normal,
    side: input.side === "buy" ? SodexOrderSide.Buy : SodexOrderSide.Sell,
    type: input.type === "market" ? SodexOrderType.Market : SodexOrderType.Limit,
    timeInForce:
      input.type === "market" ? SodexTimeInForce.IOC : SodexTimeInForce.GTC,
    ...(input.price !== undefined ? { price: input.price } : {}),
    ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    ...(input.funds !== undefined ? { funds: input.funds } : {}),
    reduceOnly: input.reduceOnly ?? false,
    positionSide:
      input.positionSide === "long"
        ? SodexPositionSide.Long
        : input.positionSide === "short"
          ? SodexPositionSide.Short
          : SodexPositionSide.Both,
  };

  // NewOrderRequest body (the HTTP body and the params slot of the signing
  // payload). Field order: accountID, symbolID, orders.
  const body = {
    accountID,
    symbolID,
    orders: [rawOrder],
  };

  // Sign the full action envelope: {type: "newOrder", params: <body>}.
  const { sign, nonce, payload } = await signAction("perps", {
    type: "newOrder",
    params: body,
  });
  void payload; // referenced for the closure-side completeness; not sent.

  const url = `${gateway("perps")}/trade/orders`;
  const res = await fetch(url, {
    method: "POST",
    headers: signedHeaders(sign, nonce),
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const errBody = await logHttpError(`submitPerpOrder ${input.symbolName}`, res, sign, nonce);
    throw new Error(
      `SoDEX submitPerpOrder ${input.symbolName} ${res.status}: ${errBody.slice(0, 200)}`,
    );
  }

  const json: unknown = await res.json();

  // Log the raw response shape on first observation; helps when iterating on
  // payload format. Drops to debug level once we trust the response.
  logger.info("sodex.submit_response", {
    symbol: input.symbolName,
    clOrdID: input.clOrdID,
    body: JSON.stringify(json).slice(0, 600),
  });

  // Two layers of error checking:
  //   1. Envelope-level: top-level {code, error} != 0 means the request was
  //      malformed (signing wrong, payload broken, etc.). Same for all orders.
  //   2. Per-order: the data array contains one record per order with its own
  //      {code, error}. The engine accepts the batch HTTP-wise but rejects
  //      individual orders for business reasons (insufficient margin, bad
  //      price, etc.). We must surface these or live.ts treats the rejected
  //      order as a phantom fill.
  if (typeof json === "object" && json !== null) {
    const env = json as Record<string, unknown>;
    const topCode = env.code;
    if (typeof topCode === "number" && topCode !== 0) {
      const message =
        typeof env.message === "string"
          ? env.message
          : typeof env.error === "string"
            ? env.error
            : JSON.stringify(env);
      logger.warn("sodex.submit_envelope_error", {
        symbol: input.symbolName,
        code: topCode,
        message: message.slice(0, 200),
      });
      throw new Error(
        `SoDEX submitPerpOrder ${input.symbolName} rejected: code=${topCode} message=${message.slice(0, 300)}`,
      );
    }
    const data = env.data;
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      if (typeof first === "object" && first !== null) {
        const perOrder = first as Record<string, unknown>;
        const perCode = perOrder.code;
        if (typeof perCode === "number" && perCode !== 0) {
          const perError =
            typeof perOrder.error === "string"
              ? perOrder.error
              : JSON.stringify(perOrder);
          logger.warn("sodex.submit_per_order_error", {
            symbol: input.symbolName,
            clOrdID: input.clOrdID,
            code: perCode,
            error: perError.slice(0, 200),
          });
          throw new Error(
            `SoDEX submitPerpOrder ${input.symbolName} rejected per-order: code=${perCode} ${perError.slice(0, 300)}`,
          );
        }
      }
    }
  }

  return {
    clOrdID: input.clOrdID,
    sodexOrderId: extractSodexOrderId(json),
    status: extractInitialStatus(json),
    raw: json,
  };
}

// Submit-response extractors. Live shape observed on 2026-05-28:
//   {"code":0,"data":[{"code":0,"clOrdID":"sonar-...","orderID":1947090381}]}
// Earlier docs analysis suggested single-letter codes (`i`, `X`); the live
// wire uses long names instead, so we check both.
function extractSodexOrderId(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const data = (json as Record<string, unknown>).data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown>;
    const live = first.orderID ?? first.i;
    if (typeof live === "string" || typeof live === "number") return String(live);
  }
  if (typeof data === "object" && data !== null) {
    const single = (data as Record<string, unknown>).orderID ?? (data as Record<string, unknown>).i;
    if (typeof single === "string" || typeof single === "number") return String(single);
  }
  return null;
}

function extractInitialStatus(json: unknown): SodexOrderSnapshot["X"] {
  if (typeof json !== "object" || json === null) return "NEW";
  const data = (json as Record<string, unknown>).data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown>;
    const status = first.status ?? first.X;
    const parsed = SodexOrderSnapshotSchema.shape.X.safeParse(status);
    if (parsed.success) return parsed.data;
  }
  return "NEW";
}

// ---------------------------------------------------------------------------
// Public API: getPerpOrderHistory + helpers
//
// IOC market orders (the Wave 2 default for both rebalance legs and hedges)
// fill within a few hundred milliseconds and the unfilled remainder is
// canceled, so the order never appears in the open-orders list. We have to
// reach into orders/history to recover the fill data after the fact. The
// response carries readable long-name fields (status, executedQty,
// executedValue) so we use those directly rather than the short codes.
// ---------------------------------------------------------------------------
const PerpHistoryOrderSchema = z
  .object({
    orderID: z.union([z.string(), z.number()]).optional(),
    clOrdID: z.string(),
    symbol: z.string(),
    side: z.string(),
    status: z.string(),
    origQty: z.string().optional(),
    executedQty: z.string().optional(),
    executedValue: z.string().optional(),
    price: z.string().optional(),
    createdAt: z.number().optional(),
  })
  .passthrough();
export type PerpHistoryOrder = z.infer<typeof PerpHistoryOrderSchema>;

const PerpHistoryEnvelopeSchema = z
  .object({
    data: z.array(PerpHistoryOrderSchema),
  })
  .passthrough();

export async function getPerpOrderHistory(
  opts: { symbol?: string; limit?: number } = {},
): Promise<PerpHistoryOrder[]> {
  const address = getSignerAddress();
  const url = new URL(
    `${gateway("perps")}/accounts/${address}/orders/history`,
  );
  if (opts.symbol) url.searchParams.set("symbol", opts.symbol);
  url.searchParams.set("limit", String(opts.limit ?? 50));
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SoDEX getPerpOrderHistory ${res.status}: ${body.slice(0, 200)}`);
  }
  const json: unknown = await res.json();
  const parsed = PerpHistoryEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `SoDEX getPerpOrderHistory response did not match schema: ${
        parsed.error.issues[0]?.message ?? "unknown"
      }`,
    );
  }
  return parsed.data.data;
}

// Find a specific order by clOrdID, scanning the most recent history page.
// Sufficient for Wave 2's cadence; if we ever need pagination we can extend.
export async function findOrderByClOrdID(
  clOrdID: string,
  symbol?: string,
): Promise<PerpHistoryOrder | null> {
  const history = await getPerpOrderHistory({
    symbol,
    limit: 50,
  });
  return history.find((o) => o.clOrdID === clOrdID) ?? null;
}

// ---------------------------------------------------------------------------
// Public API: transferSpotToPerps
//
// Signed action that moves an asset balance from the user's spot sub-account
// to the perps sub-account so perps orders have margin to back them. On
// testnet the faucet drops vUSDC on spot only; perps starts at zero. Without
// this step every perps order rejects with `code: -1, error: "insufficient
// margin"`.
//
// Four non-obvious details (confirmed from the SDK trading.md reference; an
// earlier guess at these values produced `code: -1, error: "toAccountID is
// invalid"`):
//   1. Endpoint is owned by the SPOT engine: POST /spot/accounts/transfers.
//      Not /perps/accounts/transfers, even though the destination is perps.
//   2. Signing domain is "spot" (SpotDomainName), not "futures". The
//      direction is encoded in the body's `type` field, not the domain.
//   3. toAccountID is the magic constant 999, not the user's aid. The 999
//      is the perps-engine destination address on the spot transfer endpoint.
//   4. type = 3 (TransferAssetTypePerpsWithdraw) for spot -> perps. The
//      enum names are from the engine's local frame: this is the spot
//      engine "withdrawing into perps", hence the seemingly inverted name.
//
// Transfer enum (from common/enums/transfer_asset_type.go) for reference:
//   EVM_DEPOSIT = 0, PERPS_DEPOSIT = 1, EVM_WITHDRAW = 2,
//   PERPS_WITHDRAW = 3, INTERNAL = 4, SPOT_WITHDRAW = 5, SPOT_DEPOSIT = 6.
// ---------------------------------------------------------------------------
const COIN_ID_VUSDC = 0;
const TRANSFER_TYPE_SPOT_TO_PERPS = 3;
const PERPS_DESTINATION_ACCOUNT_ID = 999;
// EVM_WITHDRAW per common/enums/transfer_asset_type.go. Moves vUSDC out of the
// SoDEX spot ledger to the on-chain ValueChain address that owns the account
// (the signer's own wallet; the TransferAssetRequest struct carries no explicit
// recipient field, so the destination is implicit). This is the Wave 2
// cross-chain funding path: there is no testnet bridge between Base and
// ValueChain (confirmed by the SoSoValue team), so an on-chain ValueChain
// balance comes from withdrawing the faucet-funded SoDEX testnet balance.
const TRANSFER_TYPE_EVM_WITHDRAW = 2;

export async function transferSpotToPerps(input: {
  amountUSD: string;       // DecimalString
}): Promise<{ ok: true; raw: unknown }> {
  // fromAccountID is the spot aid (which equals the perps aid for this
  // address per the testnet state probes; reading from the spot side here
  // for clarity).
  const fromAccountID = await getAccountId("spot");
  const toAccountID = PERPS_DESTINATION_ACCOUNT_ID;
  const transferId = Date.now();

  // Field order matches TransferAssetRequest struct: id, fromAccountID,
  // toAccountID, coinID, amount, type.
  const body = {
    id: transferId,
    fromAccountID,
    toAccountID,
    coinID: COIN_ID_VUSDC,
    amount: input.amountUSD,
    type: TRANSFER_TYPE_SPOT_TO_PERPS,
  };

  // Sign with the spot engine domain (the endpoint is /spot/accounts/transfers).
  const { sign, nonce, payload } = await signAction("spot", {
    type: "transferAsset",
    params: body,
  });
  void payload;

  const url = `${gateway("spot")}/accounts/transfers`;
  const res = await fetch(url, {
    method: "POST",
    headers: signedHeaders(sign, nonce),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const errBody = await logHttpError("transferSpotToPerps", res, sign, nonce);
    throw new Error(
      `SoDEX transferSpotToPerps ${res.status}: ${errBody.slice(0, 200)}`,
    );
  }
  const json: unknown = await res.json();
  logger.info("sodex.transfer_response", {
    amount: input.amountUSD,
    body: JSON.stringify(json).slice(0, 400),
  });
  if (typeof json === "object" && json !== null) {
    const env = json as Record<string, unknown>;
    if (typeof env.code === "number" && env.code !== 0) {
      const message =
        typeof env.message === "string"
          ? env.message
          : typeof env.error === "string"
            ? env.error
            : JSON.stringify(env);
      throw new Error(
        `SoDEX transferSpotToPerps rejected: code=${env.code} ${message.slice(0, 200)}`,
      );
    }
  }
  return { ok: true, raw: json };
}

// ---------------------------------------------------------------------------
// Public API: withdrawVusdcToOnchain
//
// Withdraws vUSDC from the SoDEX spot ledger to the agent wallet's on-chain
// ValueChain address. This is the Wave 2 cross-chain funding path: the SoDEX
// team confirmed there is no testnet bridge between Base and ValueChain, so an
// on-chain ValueChain vUSDC balance is produced by withdrawing the
// faucet-funded SoDEX testnet balance.
//
// Same `transferAsset` action, spot-engine endpoint, and spot signing domain
// as transferSpotToPerps, with type = EVM_WITHDRAW (2). The on-chain recipient
// is implicit (the signer's own address; the request struct has no recipient
// field).
//
// DISCOVERY (2026-05-29): the programmatic on-chain withdrawal destination is
// NOT publicly documented. Probed against testnet:
//   toAccountID=0          -> "Field validation for 'ToAccountID' failed on the
//                             'required' tag" (Go rejects the zero value)
//   toAccountID=<own aid>  -> "toAccountID is invalid"
// The SoDEX SDK SKILL.md states on-chain deposits/withdrawals are done "via the
// Sodex web UI"; only the perps<->spot transfer (magic 999) is documented as a
// programmatic transfer. So testnet ValueChain funding is a SoDEX-dashboard
// operation, and this method stays here shape-correct for when the destination
// constant is confirmed (Discord) or for the mainnet flow. The caller surfaces
// the engine error and points the user at the SoDEX testnet withdrawal UI as
// the honest fallback (see app/api/chain/fund-valuechain). The cross-chain
// story the demo shows is the three-balance panel (Base USDC + on-chain
// ValueChain vUSDC + SoDEX venue spot/perps), which is fully real.
// ---------------------------------------------------------------------------
export async function withdrawVusdcToOnchain(input: {
  amountUSD: string; // DecimalString
}): Promise<{ ok: true; raw: unknown }> {
  const fromAccountID = await getAccountId("spot");
  const transferId = Date.now();

  const body = {
    id: transferId,
    fromAccountID,
    toAccountID: fromAccountID,
    coinID: COIN_ID_VUSDC,
    amount: input.amountUSD,
    type: TRANSFER_TYPE_EVM_WITHDRAW,
  };

  const { sign, nonce, payload } = await signAction("spot", {
    type: "transferAsset",
    params: body,
  });
  void payload;

  const url = `${gateway("spot")}/accounts/transfers`;
  const res = await fetch(url, {
    method: "POST",
    headers: signedHeaders(sign, nonce),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const errBody = await logHttpError("withdrawVusdcToOnchain", res, sign, nonce);
    throw new Error(
      `SoDEX withdrawVusdcToOnchain ${res.status}: ${errBody.slice(0, 200)}`,
    );
  }
  const json: unknown = await res.json();
  logger.info("sodex.withdraw_response", {
    amount: input.amountUSD,
    body: JSON.stringify(json).slice(0, 400),
  });
  if (typeof json === "object" && json !== null) {
    const env = json as Record<string, unknown>;
    if (typeof env.code === "number" && env.code !== 0) {
      const message =
        typeof env.message === "string"
          ? env.message
          : typeof env.error === "string"
            ? env.error
            : JSON.stringify(env);
      throw new Error(
        `SoDEX withdrawVusdcToOnchain rejected: code=${env.code} ${message.slice(0, 200)}`,
      );
    }
  }
  return { ok: true, raw: json };
}

// ---------------------------------------------------------------------------
// Public API: listPerpOrders (status polling)
//
// Reads all open orders for the agent wallet, returning an array of order
// snapshots. The live executor in lib/sodex/live.ts polls this and matches by
// clOrdID to find a fill. Unsigned per the SDK pattern (matches /balances and
// /positions which are also unsigned account reads).
// ---------------------------------------------------------------------------
const OrdersEnvelopeSchema = z
  .object({
    data: z
      .object({
        orders: z.array(SodexOrderSnapshotSchema).nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export async function listPerpOrders(): Promise<SodexOrderSnapshot[]> {
  const address = getSignerAddress();
  const url = `${gateway("perps")}/accounts/${address}/orders`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SoDEX listPerpOrders ${res.status}: ${body.slice(0, 200)}`);
  }
  const json: unknown = await res.json();
  const parsed = OrdersEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `SoDEX listPerpOrders response did not match schema: ${
        parsed.error.issues[0]?.message ?? "unknown"
      }`,
    );
  }
  return parsed.data.data.orders ?? [];
}
