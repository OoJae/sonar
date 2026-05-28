# SoDEX Live API (Testnet) Reference

> Source of truth for the Wave 2 live executor. Confirmed against the docs at https://sodex.com/documentation/api/api and clarified via the buildathon Discord (see §1 testnet rules). Anything not curl-confirmed is marked `UNCONFIRMED`.

---

## 0. The single most important rule

The executor uses **testnet only**. Mainnet is gated behind `SONAR_EXECUTION_MODE=live-mainnet` plus `SONAR_ALLOW_MAINNET=true`, and the Wave 2 default keeps mainnet disabled. No real funds in any env. The testnet wallet is disposable; if its key leaks, the loss is zero.

---

## 1. Testnet authentication (DIFFERENT from mainnet, per Discord)

**Testnet does NOT use registered API keys.** The mainnet flow registers an API key (name + signing keypair) per master wallet; testnet skips that entirely and signs directly with the master wallet's EVM private key.

### Required headers on signed requests (testnet)
- `X-API-Sign`: the EIP-712 signature, 0x01-prefixed (see §3)
- `X-API-Nonce`: uint64 unix milliseconds (validity window in §3)
- `X-API-Chain`: `138565` (testnet chain id)
- `Content-Type: application/json`
- `Accept: application/json`

**Do NOT send `X-API-Key` on testnet.** The mainnet header is registered-key-name-based; including it on testnet either errors or is silently ignored. The executor must omit it when `SONAR_EXECUTION_MODE=live-testnet`.

### Signing key
The `SODEX_WALLET_PRIVATE_KEY` env var holds the master wallet's EVM private key. viem's `privateKeyToAccount(...)` produces the signer; no separate API secret is needed on testnet.

### Mainnet, for reference only (NOT Wave 2 scope)
- `X-API-Key`: the registered API key NAME (string)
- `X-API-Sign`: signed by the API key's separate private key (not the master wallet)
- `X-API-Nonce`: same uint64 unix milliseconds
- Registered API keys must be created via `addAPIKey` (signed by master wallet)

---

## 2. Base URLs

| Environment | Spot REST | Perps REST | Spot WS | Perps WS |
|---|---|---|---|---|
| **Testnet** | `https://testnet-gw.sodex.dev/api/v1/spot` | `https://testnet-gw.sodex.dev/api/v1/perps` | `wss://testnet-gw.sodex.dev/ws/spot` | `wss://testnet-gw.sodex.dev/ws/perps` |
| Mainnet | `https://mainnet-gw.sodex.dev/api/v1/spot` | `https://mainnet-gw.sodex.dev/api/v1/perps` | `wss://mainnet-gw.sodex.dev/ws/spot` | `wss://mainnet-gw.sodex.dev/ws/perps` |

Wave 2 sets `SODEX_TESTNET_BASE_URL=https://testnet-gw.sodex.dev/api/v1` and the client appends `/spot` or `/perps` per the request's `kind`.

---

## 3. EIP-712 signing

### Domain (testnet)
```ts
{
  name: "spot" | "futures",      // "spot" for spot endpoints, "futures" for perps
  version: "1",
  chainId: 138565,                // testnet (mainnet is 286623)
  verifyingContract: "0x0000000000000000000000000000000000000000"
}
```

The `name` field switches between `"spot"` and `"futures"` depending on which REST surface the request targets. The verifying contract is the zero address on both nets per the docs.

### Typed-data struct
```ts
{
  types: {
    ExchangeAction: [
      { name: "payloadHash", type: "bytes32" },
      { name: "nonce",       type: "uint64"  }
    ]
  },
  primaryType: "ExchangeAction",
  message: {
    payloadHash: "0x<keccak256-of-compact-JSON>",
    nonce: <uint64 unix ms>
  }
}
```

### Payload → payloadHash derivation
1. Serialize the action as compact JSON (no whitespace):
   `{"type":"<actionName>","params":{...}}`
2. Field order in `params` must match the Go SDK struct order (https://github.com/sodex-tech/sodex-go-sdk-public). Hand-port the struct field order per action.
3. `DecimalString` fields (quantity, price, funds, stopPrice) serialize as quoted strings (`"0.001"`, never `0.001`).
4. Optional fields are omitted when unset; non-optional fields (modifier, reduceOnly, positionSide) are always present.
5. `payloadHash = keccak256(utf8Bytes(compactJson))`. viem: `keccak256(toBytes(JSON.stringify(payload)))`.

### Signature shape
1. Sign the ExchangeAction with viem: `account.signTypedData({ domain, types, primaryType, message })`. Returns 65 bytes hex.
2. Prepend `0x01` → final `X-API-Sign` is `"0x01" + signature.slice(2)`.

### Nonce window
- `X-API-Nonce` is a uint64 unix millisecond timestamp.
- Validity window: `(T - 2 days, T + 1 day)` where T is the gateway's current time.
- The server keeps the 100 highest nonces per signing address. New nonce must exceed the smallest stored nonce, so always use a monotonically increasing value (`Date.now()` is sufficient; bump by 1ms on rapid retries).
- A retried request with the **same** payloadHash and nonce is idempotent; a retried request with a **new** nonce is a new request; use the same nonce on retries to dedupe at the signing layer (the deeper idempotency layer is `clOrdID`, see §5).

---

## 4. Account state (the obligatory pre-step before any order)

**MANDATORY before signing any trading action**, per Discord clarification.

### Endpoint
- **Spot:** `GET https://testnet-gw.sodex.dev/api/v1/spot/accounts/{userAddress}/state`
- **Perps:** `GET https://testnet-gw.sodex.dev/api/v1/perps/accounts/{userAddress}/state`
- Optional query param: `?accountID=<id>` to target a sub-account (defaults to primary).

`{userAddress}` is the EVM address derived from `SODEX_WALLET_PRIVATE_KEY`.

### Why it's mandatory
The response returns the user's primary `aid` (account id). The `aid` must be passed as `accountID` in every subsequent order payload (§5), and the `accountID` in the EIP-712 signed payload **must match exactly** the `accountID` in the HTTP request body. Caching the `aid` once per process is fine; do not hardcode it.

### Response shape (key field)
- `aid` (number): the account id. Per `WsPerpsState` schema in `/api/rest-v1/schema.md`. Other fields exist (positions, balances) and should be passed through with Zod `.passthrough()`.

### Auth requirement
Account state on testnet is a signed read. Send `X-API-Sign`, `X-API-Nonce`, `X-API-Chain` over the canonical `getAccountState` payload. **UNCONFIRMED** whether the GET requires a request body for signing or just the path; validate by curl during executor implementation. If signing the GET fails, retry with the same path as the payload JSON to canonicalize.

---

## 5. Order submission

### Endpoint
- **Perps:** `POST https://testnet-gw.sodex.dev/api/v1/perps/trade/orders`
- **Spot:** `POST https://testnet-gw.sodex.dev/api/v1/spot/trade/orders` (UNCONFIRMED; docs show the perps example; spot endpoint follows the same shape but verify by 200 vs 404 on first call)

### Request body shape
```ts
{
  accountID: number,        // from §4; MUST match the signed payload accountID
  symbolID: number,         // numeric symbol id (NOT a string like "BTC-USDC")
  orders: [
    {
      clOrdID: string,      // client-side idempotency key (see §5.2)
      modifier: number,     // 1 (UNCONFIRMED meaning; always present)
      side: number,         // 1 = buy (UNCONFIRMED: sell value)
      type: number,         // 2 = market (UNCONFIRMED: limit value)
      timeInForce: number,  // 3 = IOC in the docs example (UNCONFIRMED full enum)
      quantity?: string,    // DecimalString; omit when using funds for market buy
      price?: string,       // DecimalString; required for limit orders
      funds?: string,       // DecimalString; market-buy notional (UNCONFIRMED; verify)
      stopPrice?: string,   // DecimalString; for stop orders
      stopType?: number,    // UNCONFIRMED
      triggerType?: number, // UNCONFIRMED
      reduceOnly: boolean,  // always present
      positionSide: number, // 1 = long-side (UNCONFIRMED; always present)
    }
  ]
}
```

### Field encoding rules
- **DecimalString** fields are always quoted strings. `"0.001"` not `0.001`.
- **Non-optional** fields (`modifier`, `reduceOnly`, `positionSide`) appear in every order even if their value is the default.
- **Optional** fields with no value are **omitted** (not sent as `null` or empty string).
- Field order in the signed payload must match the Go SDK struct order.

### 5.1 Resolving symbolID
**UNCONFIRMED** how to list available symbols. The `symbolID` is numeric, not a string. Probable paths to try:
- `GET /spot/symbols` or `/spot/markets`
- `GET /perps/symbols` or `/perps/markets`

Confirm via curl during executor implementation. The discovered list goes into `lib/sodex/markets.ts` as the Sonar-market → SoDEX-symbolID mapping.

### 5.2 clOrdID (idempotency)
The `clOrdID` is a client-side idempotency key. The Wave 2 plan computes it as `keccak256(thesisId + market + cycleSeq)` so a retried cycle never double-places. Server-side: if a `clOrdID` collides with an existing order for the same account, the server should return the existing order rather than creating a new one. **UNCONFIRMED** the exact collision response shape; verify with the mandatory double-run smoke test (`scripts/sodex-live-smoke.ts`).

### 5.3 Buy vs sell encoding
The docs example shows `side: 1` for a buy. The sell value is **UNCONFIRMED**; try `side: 2` first (common convention), fall back to `side: 0` if rejected. Document the working value in the changelog once verified.

### 5.4 Market vs limit encoding
The docs example shows `type: 2` for market. Limit is **UNCONFIRMED**; try `type: 1`. If `type: 1` fails, check the Go SDK enum.

### Signed payload type field
The action type for an order submission is `"newOrder"` per the docs example:
```json
{"type":"newOrder","params":{"accountID":<aid>,"symbolID":<id>,"orders":[...]}}
```

---

## 6. Order status / polling

### Possible status values (CONFIRMED from schema page)
The SoDEX REST v1 schema page confirms the order status enum:
`NEW`, `PARTIALLY_FILLED`, `FILLED`, `CANCELED`, `REJECTED`, `EXPIRED`.

Mapping onto our internal `orderStatusEnum` in `lib/db/schema.ts`:

| SoDEX wire status | Our internal status |
|---|---|
| `NEW` | `submitted` |
| `PARTIALLY_FILLED` | `partially_filled` |
| `FILLED` | `filled` |
| `CANCELED` | `failed` (cancellation is a non-success terminal state for us) |
| `REJECTED` | `rejected` |
| `EXPIRED` | `failed` |

Our additional `pending` state is pre-wire (persisted before submission); our `rejected` state may come from the risk gate before any submission, distinct from the wire-level `REJECTED`.

### Order response field codes (CONFIRMED from schema)
Order status responses use short single-character field codes:
- `c` = client order id (matches our `clOrdID` / `clientOrderId`)
- `X` = order status (the enum above)
- `i` = system order id (matches our `sodexOrderId`)
- `ps` = position side (for perps)
- `sp` = stop price
- `st` = stop type
- `tt` = trigger type

Be defensive when parsing: use Zod `.passthrough()` and explicit per-key handling rather than camelCase auto-conversion.

### Polling endpoint
**UNCONFIRMED path.** Two candidates to try:

#### Option A. REST polling
- `GET /trade/orders?accountID=<aid>&clOrdID=<id>` (UNCONFIRMED path)
- `GET /trade/orders/{orderId}` (UNCONFIRMED path)

#### Option B. WebSocket subscription
Subscribe to order updates over `wss://testnet-gw.sodex.dev/ws/perps` (or `/ws/spot`). This is the more reliable path and matches modern exchange patterns, but adds a WS dep to the executor. Defer WS unless polling is unavailable.

### Polling strategy (when REST polling path is confirmed)
- 500ms initial delay, multiplier 1.5, cap 5s.
- Total timeout 30s (configurable).
- On `failed` / `rejected`: surface immediately, no further polling.
- On `partially_filled`: keep polling until terminal, but accept partial fill as the final state if timeout expires.

---

## 7. Symbol listing

### Naming convention (CONFIRMED from schema page)
- **PerpsSymbol.name**: hyphen-separated quote pair like `"BTC-USD"`, `"ETH-USD"`, `"SOL-USD"`. No `v` prefix.
- **SpotSymbol.name**: underscore-separated with `v` prefix on both legs like `"vBTC_vUSDC"`, `"vETH_vUSDC"`. The `v` prefix denotes the SoDEX-wrapped vToken representation of the underlying.

### Symbol structure (CONFIRMED)
Each symbol record carries:
- `id` (uint64): the numeric `symbolID` used in order payloads
- `name` (string): the human-readable symbol
- Precision fields (tick size, lot size, min/max quantity, min/max price)
- Fee fields
- (Perps only) leverage, margin tiers, funding parameters

### Listing endpoint
**UNCONFIRMED path.** All probed candidates 404'd against testnet:
`/perps/markets`, `/perps/symbols`, `/perps/instruments`, `/perps/info`, `/perps/exchangeInfo`, `/spot/markets`, `/spot/symbols`, `/spot/instruments`, `/spot/info`, and variants without the spot/perps prefix.

Two paths forward:
1. **Source from the Go SDK** at https://github.com/sodex-tech/sodex-go-sdk-public. The SDK's market-listing call reveals the path.
2. **Discover via signed read**. The `GET /accounts/{userAddress}/state` response is documented to carry positions and balances; if it surfaces symbolIDs, we can build the markets map from observed data during executor implementation.

### Sonar tradeable scope (per the playbook §1.3 gotcha)
- **Perps:** `BTC-USD`, `ETH-USD`, `SOL-USD` are very likely live on testnet (BTC/ETH/SOL are the universally-supported perp pairs). The agent's `hedges[]` array produces orders for these.
- **Spot SSI tokens** (`MAG7.ssi`, `DEFI.ssi`, `MEME.ssi`, `USSI`) are NOT SoDEX listings; they are SSI primitives that mint/burn via the Base-side SSI Protocol contracts. The agent's `proposedAllocations` for these markets cannot execute as a single SoDEX trade. Wave 2 scope decision: in live mode, SSI-allocation legs route to the paper engine (recorded but not wire-executed), while `hedges[]` legs execute live on SoDEX perps. The order preview UI on Signals (Task 2.5) makes this split explicit per leg.
- Basket execution (decomposing `MAG7 +0.10` into per-underlying SoDEX spot orders on `vBTC_vUSDC`, `vETH_vUSDC`, etc.) is a Wave 3 question.

### markets.ts contract
`lib/sodex/markets.ts` exports `resolveMarket(sonarMarket)` returning either a tradeable record (with kind + symbolName) or a non-tradeable record (with a reason string explaining why). The numeric `symbolID` is resolved lazily by `lib/sodex/live.ts` via a signed listing call, cached per process. Splitting name-mapping (static, known) from id-resolution (runtime, requires signing) keeps Phase 1 unblocked.

---

## 8. Testnet faucet

**UNCONFIRMED**; not documented in the REST API pages. Likely paths:
- A faucet page on https://sodex.com (check the testnet dashboard after wallet connect)
- A faucet bot in the buildathon Discord
- The Discord channel itself for manual disbursement

Action: confirm the faucet path during B2. Daily limit is reportedly 1000 test USDC per the playbook.

---

## 9. Rate limits

- **Weight budget:** 1200 per IP per minute.
- **Default unmatched-endpoint weight:** 20.
- **Per-endpoint weights:** UNCONFIRMED; reference `/documentation/api/api-rate-limits.md` (not yet fetched).

For Wave 2's cadence (one cron per weekday plus on-demand smoke runs), 1200/min is far above expected load. No client-side throttling needed beyond the existing SoSoValue token bucket pattern.

---

## 10. Fill / trade history

**UNCONFIRMED** path. Likely `GET /trade/fills` or `GET /accounts/{userAddress}/trades`. Not on the Wave 2 critical path (the live executor records its own fills into the `orders` and `paper_trades` tables); deprioritize unless the order-status endpoint is missing and we need fills as a fallback.

---

## 11. Open questions to resolve before executor implementation

Each of these must be curl-confirmed (or Discord-clarified) before the matching code is written:

| # | Question | Blocks |
|---|---|---|
| 1 | Account-state signed-read canonical payload shape | §4 implementation |
| 2 | Symbol listing endpoint path + symbol format | Task 1.3 |
| 3 | Exact `side` value for sell | Task 2.2 |
| 4 | Exact `type` value for limit | Task 2.2 |
| 5 | Order status endpoint path (or WS-only) | Task 2.2 polling |
| 6 | `funds` semantics for market-buy notional | Task 2.2 |
| 7 | `positionSide` values for short positions on perps | Task 2.2 (hedges) |
| 8 | Testnet faucet URL | B2 |
| 9 | Spot vs perps order endpoint path symmetry | Task 2.2 |

Action: resolve 1, 2, 8 in B1 / B2. Resolve 3, 4, 5, 6, 7, 9 during Task 2.2 implementation via the signed-read first, then progressively narrow with the smoke script.

---

## 12. Implementation cheat sheet for `lib/sodex/client.ts`

```ts
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes } from "viem";
import { env } from "@/lib/utils/env";

const TESTNET_CHAIN_ID = 138565;
const TESTNET_GATEWAY = "https://testnet-gw.sodex.dev/api/v1";

function gateway(kind: "spot" | "perps") {
  return `${TESTNET_GATEWAY}/${kind}`;
}

function eipDomain(kind: "spot" | "perps") {
  return {
    name: kind === "spot" ? "spot" : "futures",
    version: "1",
    chainId: TESTNET_CHAIN_ID,
    verifyingContract: "0x0000000000000000000000000000000000000000" as const,
  };
}

async function signAction(kind: "spot" | "perps", payload: object) {
  const account = privateKeyToAccount(
    env().SODEX_WALLET_PRIVATE_KEY as `0x${string}`,
  );
  const compactJson = JSON.stringify(payload);
  const payloadHash = keccak256(toBytes(compactJson));
  const nonce = BigInt(Date.now());

  const signature = await account.signTypedData({
    domain: eipDomain(kind),
    types: {
      ExchangeAction: [
        { name: "payloadHash", type: "bytes32" },
        { name: "nonce", type: "uint64" },
      ],
    },
    primaryType: "ExchangeAction",
    message: { payloadHash, nonce },
  });

  return {
    sign: ("0x01" + signature.slice(2)) as `0x${string}`,
    nonce: nonce.toString(),
  };
}

async function signedRequest<T>(
  kind: "spot" | "perps",
  path: string,
  method: "GET" | "POST",
  payload: object,
): Promise<T> {
  const { sign, nonce } = await signAction(kind, payload);
  const res = await fetch(`${gateway(kind)}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-API-Sign": sign,
      "X-API-Nonce": nonce,
      "X-API-Chain": String(TESTNET_CHAIN_ID),
      // NO X-API-Key on testnet.
    },
    body: method === "POST" ? JSON.stringify(payload.params ?? payload) : undefined,
  });
  if (!res.ok) {
    // Log the request shape but NEVER the private key or full signature beyond first 8 chars.
    throw new Error(`SoDEX ${path} ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// Helpers:
//   getAccountState(addr) -> { type: "getAccountState", params: { address } }
//   submitOrder({...})    -> { type: "newOrder",        params: { accountID, symbolID, orders } }
//   getOrderStatus(clOrdID, accountID) -> path TBD
```

The shape above is the reference for §5 implementation; field-order and exact action-type strings get pinned down during the §11 question resolution.

---

## 13. What changes for mainnet (NOT Wave 2 scope, documented for completeness)

When `SONAR_EXECUTION_MODE=live-mainnet` (gated behind `SONAR_ALLOW_MAINNET=true` plus a single-digit-USD cap and forced manual approval), the executor switches to the mainnet auth flow:

1. Master wallet calls `addAPIKey` to register a separate API key (name + EVM keypair).
2. All subsequent signed requests use:
   - `X-API-Key`: the registered key name
   - `X-API-Sign`: signed by the registered key's private key (not the master wallet)
   - `X-API-Nonce`: per-API-key nonce
   - `X-API-Chain`: `286623`
3. The verifying contract and domain `chainId` switch to mainnet values.
4. `mainnet-gw.sodex.dev` replaces `testnet-gw.sodex.dev`.

Wave 2 stubs this with `throw new Error("mainnet execution disabled in Wave 2")` in the executor; the implementation lives behind that throw for a future wave.
