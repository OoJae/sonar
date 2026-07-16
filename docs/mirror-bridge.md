# Cross-chain funding and the Mirror Protocol bridge (Base ↔ ValueChain)

> Documents the cross-chain funding reality for Wave 2 and the Mirror Protocol mainnet bridge design. The original B4 discovery log is preserved below from §1.

---

## TL;DR (RESOLVED 2026-05-27, Discord)

**There is no testnet bridge between Base and ValueChain.** The SoSoValue team confirmed this on Discord. So Mirror Protocol bridging is a **mainnet-only design** in Wave 2, not a testnet feature. The original "blocked, awaiting Mirror contract addresses" framing is moot.

**The Wave 2 cross-chain funding path (testnet):** the ValueChain execution wallet is funded by **withdrawing test USDC from the SoDEX testnet to its on-chain ValueChain address**. The faucet feeds the SoDEX testnet account; a withdrawal moves funds on-chain when needed.

**What ships in Wave 2:**
- The three-balance cross-chain panel on /portfolio (real): Base USDC, on-chain ValueChain vUSDC, and the SoDEX venue ledger (spot + perps). See [components/balance-panel.tsx](../components/balance-panel.tsx) and [lib/chain/balances.ts](../lib/chain/balances.ts).
- A funding surface explaining the SoDEX-withdrawal path, with a link to the SoDEX testnet. The bearer-guarded [app/api/chain/fund-valuechain/route.ts](../app/api/chain/fund-valuechain/route.ts) attempts the programmatic withdrawal.
- [lib/sodex/client.ts](../lib/sodex/client.ts)'s `withdrawVusdcToOnchain` (the SoDEX `transferAsset` action with `type=EVM_WITHDRAW`). **Caveat (2026-05-29):** the programmatic on-chain withdrawal destination constant is not publicly documented. Probed against testnet: `toAccountID=0` gives a `required`-tag error; `toAccountID=<own aid>` gives `toAccountID is invalid`. The SoDEX SDK SKILL.md directs on-chain deposits and withdrawals "via the SoDEX web UI," and only the perps↔spot transfer (magic `999`) is documented as a programmatic transfer. So testnet ValueChain funding is a SoDEX-dashboard operation; the client method stays shape-correct and flips to working the moment the destination constant is confirmed (Discord) or for the mainnet flow.
- [lib/chain/bridge.ts](../lib/chain/bridge.ts): the Mirror Protocol **mainnet bridge design**, config-gated so it can never run on testnet.

**Update 2026-07-17:** this page previously said "Wave 3 wires the ABI." Wave 3 did not, and deliberately will not, because we still have no Mirror ABI, address, signature, or docs link to wire (see §7 and the standing decision in §8). The interface stays declared, dormant, and honest about its blocker rather than implemented against a guess.

**Submission framing (honest, per playbook §7):** Mirror testnet bridge unavailable, confirmed with the SoSoValue team; used the SoDEX testnet withdrawal path for ValueChain funding, with Mirror as the mainnet design. Adaptive honesty reads better than a faked bridge, and the extra SoDEX withdrawal integration strengthens the Solid API Usage pillar.

---

## 1. What was probed

### SoSoValueLabs GitHub organisation
- `gh api orgs/SoSoValueLabs/repos` returned 4 repos:
  - `ssi-protocol` (the Foundry contracts; the only one with bespoke code)
  - `DefiLlama-Adapters` (forked)
  - `ethereum-optimism.github.io` (forked, OP token list)
  - `dimension-adapters` (forked)
- **No standalone bridge repo. No "mirror" repo.**

### SSI Protocol source
- `gh api repos/SoSoValueLabs/ssi-protocol/contents/src` lists 14 Solidity files:
  `AssetController, AssetFactory, AssetFeeManager, AssetIssuer, AssetLocking, AssetRebalancer, AssetToken, Interface, RewardedVoting, StakeFactory, StakeToken, Swap, USSI, Utils`.
  None named `Bridge`, `Mirror`, or `CrossChain`.
- `gh api search/code` for `mirror` in this repo: **0 hits**.
- `gh api search/code` for `bridge` in this repo: 4 hits, **all in vendored OpenZeppelin libraries** (none in project code).
- `gh api search/code` for `valuechain` in this repo: **0 hits**.
- The README is the default Foundry boilerplate (no project-level documentation).

### SoSoValue API documentation
- `sosovalue-1.gitbook.io/sosovalue-api-doc` covers market data, news, ETF, indices, treasury, fundraising, macroeconomic events. **No mention of bridging, ValueChain, or Mirror Protocol.**

### Main site + explorer
- `sosovalue.com` returns 403 to WebFetch (Cloudflare; not accessible without a browser).
- `main-scan.valuechain.xyz` returns 403 to WebFetch.

### Web search
- A broad web search hits the unrelated Terra-based "Mirror Protocol" (mAssets, synthetic stocks; defunct since the Terra collapse). That is **not** the same project.

### Wave 1 internal notes (the only references to "Mirror Protocol" anywhere we have)
- `CLAUDE.md` §3: *"Mirror Protocol handles cross-chain custody at the protocol level, but our user wallet still needs to land funds on the right chain for each action."*
- `docs/architecture.md` (Wave 1): describes the two-chain reality (Base + ValueChain) and references Mirror as the assumed bridge layer without contract addresses or details.

Both references are aspirational, not citations of a known public bridge.

---

## 2. What this means

Three possibilities, in descending order of likelihood:

1. **Mirror Protocol is the SoSoValue-internal name for an off-the-shelf bridge.** It could be a deployment of LayerZero, Wormhole, Hyperlane, Across, or similar that SoSoValue rebrands inside their stack. The actual contract addresses would then be the third-party bridge's, configured for the Base ↔ ValueChain corridor.
2. **Mirror Protocol is a SoSoValue-developed bridge that has not yet been open-sourced or documented publicly.** Its contracts may exist on testnet but the API surface is gated to a Discord/partner channel.
3. **Mirror Protocol does not yet exist on testnet.** The architecture intent is there but the deployment is pending.

In all three cases, the path forward is the same: ask in the buildathon Discord and document the answer here.

---

## 3. ValueChain testnet basics (confirmed at the network layer)

- **Mainnet chain id:** 286623 (per [CLAUDE.md §3](../CLAUDE.md))
- **Mainnet explorer:** https://main-scan.valuechain.xyz (gated to WebFetch; works in a browser)
- **Mainnet native gas token:** $SOSO
- **Testnet chain id:** 138565 (confirmed via SoDEX docs in [docs/sodex-live.md §3](./sodex-live.md))
- **Testnet RPC URL:** `https://testnet.valuechain.xyz`. CONFIRMED by probe 2026-05-29 (returns chainId 138565). Wired in [lib/chain/balances.ts](../lib/chain/balances.ts) as the `VALUECHAIN_RPC_URL` default and in `app/providers.tsx`. (This entry read UNCONFIRMED until 2026-07-17; the probe had happened but was never written back here.)
- **Testnet explorer:** still UNCONFIRMED. Likely `https://testnet-scan.valuechain.xyz` mirroring the mainnet pattern. Nothing depends on it.
- **Testnet USDC contract:** `0x3fFe1743c2Cb5C9c9ED23d8CF62dD7aFABD4eE05` (symbol `vUSDC`). Set in `.env.local` as `VALUECHAIN_USDC_ADDRESS`; the three-balance panel reads it. Note this was only ever needed for the balance read: the bridge widget it was also blocking does not exist and is not planned (see §2).
- **Mainnet RPC URL:** `https://rpc.valuechain.xyz`. CONFIRMED by probe 2026-07-17 (returns chainId `0x45f9f` = 286623). `https://mainnet-rpc.valuechain.xyz` also answers with the same chain id; `main-rpc.valuechain.xyz` does not resolve.
- **Mainnet USDC contract:** `0xcb7F80Dff2727c791fA491722c428e6657f7e2c6`. CONFIRMED by probe 2026-07-17 against ValueChain mainnet: `name()` = "SoDexToken: USDC", `symbol()` = `vUSDC`, `decimals()` = 6, `totalSupply()` = 32,968,046.51. It is a distinct contract from the testnet deployment above (same symbol, per-chain deployment), and it has no code on the testnet chain.

  **Both of these must be swapped together when flipping to `live-mainnet`**, because `VALUECHAIN_RPC_URL` and `VALUECHAIN_USDC_ADDRESS` are single vars shared across modes. Swapping one without the other reads a token address on the chain that does not host it, which returns no code and renders a balance of 0: wrong, and silently so, since "0" is also the legitimate by-design value (the agent's capital lives in the SoDEX venue ledger, not the wallet).

---

## 4. Fallback strategy for Phase 5

If Discord clarification does not return a usable testnet bridge contract before Phase 5 begins (Jun 4 afternoon per the plan), execute this fallback:

### Phase 5.1 (unchanged; no bridge dep)
- Install `wagmi connectkit @tanstack/react-query`.
- Build `app/providers.tsx` with Base mainnet + ValueChain testnet as the two configured chains.
- Build `lib/chain/balances.ts` to read USDC + native gas on both chains for both the connected user wallet and the agent hot wallet (`privateKeyToAccount(SODEX_WALLET_PRIVATE_KEY).address`).
- Build `components/balance-panel.tsx` for the Portfolio page.
- **Verifiable in isolation:** the two-chain balance display works whether or not a bridge exists.

### Phase 5.2 (degraded; bridge surface as a documented stub)
- Build `components/bridge-widget.tsx` with all the UI (amount input, direction toggle, status badge) but stub the actual bridge call.
- The stub shows an inline notice: *"Bridge integration awaiting Mirror Protocol testnet contract confirmation. Track in docs/mirror-bridge.md."*
- The "bridge needed" hint still fires (a useful product signal even without execution).
- The Wave 2 demo video acknowledges this honestly in the cross-chain segment: *"The bridge surface is wired and waiting for the live Mirror contract; here's what the user flow looks like."* That fits the Wave 2 brief better than fabricating a bridge that doesn't work.

### Phase 5.2 (real, once contracts are confirmed)
- `lib/chain/bridge.ts`: `buildBridgeTx(direction, amount, recipient)` returns a viem `{ to, data, value }` from the confirmed Mirror Protocol ABI.
- `pollBridgeStatus(srcTxHash, direction)` watches for the destination-chain mint/release event.
- Widget swaps the stub call for the real `useWriteContract` invocation. Zero structural rework because the UI is already built.

The split protects the timeline: 5.1 ships even on a complete bridge dead-end; 5.2 ships either as a stub or as a working bridge depending on what Discord returns.

---

## 5. The Discord ask

Send this to the SoSoValue buildathon Discord (compact, specific, easy to answer):

> Question for the SoSoValue / SSI Protocol team:
>
> Wave 2 of our buildathon project (Sonar, ETF-flow-aware agent that executes via SoDEX) commits to a non-custodial cross-chain bridging UI between Base (where SSI lives) and ValueChain (where SoDEX executes). The plan references "Mirror Protocol" as the bridge layer, but I cannot locate public docs or contracts for it. Could you confirm:
>
> 1. The name and project URL of the canonical bridge between Base and ValueChain (Mirror, or something else).
> 2. The testnet contract addresses on Base and on ValueChain testnet (chainId 138565).
> 3. The bridge function signatures (deposit/lock on source, mint/release on destination) or a link to the ABI / SDK.
> 4. The ValueChain testnet RPC URL and testnet explorer.
> 5. The testnet USDC contract address on ValueChain (the SoDEX faucet appears to dispense it, but I need the address for ERC-20 balance reads).
>
> Happy to take a Discord channel pointer or a GitHub repo if these aren't already documented publicly.

When the answer lands, edit this doc with the confirmed values and remove the §4 fallback notes accordingly.

---

## 6. Env additions blocked on this doc

The Phase 1.1 env additions include three values that depend on B4:

- `VALUECHAIN_USDC_ADDRESS` (blocked: needs ValueChain testnet USDC address from §3)
- `MIRROR_BRIDGE_BASE_ADDRESS` (blocked: needs the §5 confirmation)
- `MIRROR_BRIDGE_VALUECHAIN_ADDRESS` (blocked: needs the §5 confirmation)

`BASE_USDC_ADDRESS` is well-known and can be hardcoded as the default in `lib/utils/env.ts`:

| Chain | USDC address |
|---|---|
| Base mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (USDC native, per Circle) |
| Base Sepolia (testnet) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

Phase 5.1 reads Base mainnet USDC for the user's primary holding (per the wagmi config in the plan); Base Sepolia is only needed if Mirror Protocol turns out to use Sepolia rather than Base mainnet as one side of the bridge.

The three blocked env vars get added to `lib/utils/env.ts` as `.optional()` so Phase 1 still ships; the prod boot guard does **not** require them. Phase 5.2 surfaces a clear runtime error if the user tries to bridge before they are populated.

---

## 7. Resolution log

| Date | Update |
|---|---|
| 2026-05-26 | Initial discovery. No public Mirror Protocol artefacts found. Discord ask drafted (§5). Phase 5 split into 5.1 (unblocked) + 5.2 (blocked pending bridge confirmation). |
| 2026-05-27 | **Discord answer: there is no testnet bridge between Base and ValueChain.** That resolved the testnet question and nothing else: no contract address, no ABI, no function signature, and no docs link were provided, for testnet or mainnet. Funding pivoted to the SoDEX withdrawal path. (Recorded in the TL;DR at the time but never appended here; backfilled 2026-07-17.) |
| 2026-05-29 | ValueChain testnet RPC confirmed by probe: `https://testnet.valuechain.xyz` returns chainId 138565. §3 corrected 2026-07-17; it had still read UNCONFIRMED for seven weeks after the fact. |
| 2026-07-17 | **Status unchanged since May: no Mirror artifact of any kind exists.** Reviewed during the Wave 3 mainnet work and decided NOT to implement `buildBridgeTx` behind a guessed ABI (see §8). `lib/chain/bridge.ts` corrected instead: it had claimed the dashboard consumed `isBridgeAvailable()` (nothing imports the module) and that function returned true once the two addresses were set, which would have reported the bridge "available" while `buildBridgeTx` still threw. Availability now tracks the real blocker. `scripts/bridge-dormant-smoke.ts` proves the dormancy, including that setting both addresses does not flip it. |

---

## 8. Standing decision: not guessed (2026-07-17)

The Wave 3 plan originally called for un-stubbing `buildBridgeTx` behind the two
`MIRROR_BRIDGE_*` env vars, encoding the deposit call against an ABI fragment
marked UNCONFIRMED. That was reversed after reading the code. The reasoning is
recorded here so it does not get re-litigated from scratch.

**Why not implement it:**

1. **There is nothing to be shape-correct against.** We have no address, no ABI,
   no function signature, and no docs link for Mirror Protocol, on any chain (§1,
   §2). This is unlike `lib/sodex/client.ts:withdrawVusdcToOnchain`, which is
   often cited as the precedent: that method is shape-correct against a real,
   documented, signed endpoint where exactly one field value is unknown, and the
   venue replies with an error naming the bad field. Mirror has no endpoint, so
   there is no error to learn from. The project rule it would break is
   [CLAUDE.md §11](../CLAUDE.md): "We will not invent endpoint paths or response
   shapes. If a SoDEX endpoint is uncertain, we hit the docs URL with curl and
   write down what we see." There is no URL to curl.
2. **It would buy zero function and add real risk.** Nothing imports
   `lib/chain/bridge.ts`; there is no bridge widget and no bridge route. So
   un-stubbing would not make anything work. It would only make dead code look
   finished, and leave a guessed function selector primed for whoever eventually
   sets the addresses. A wrong selector against a real bridge either reverts
   (useless) or hits some other function with real funds (bad).
3. **The bridge is not on the funding path.** The SoDEX account is funded by
   depositing the margin asset directly on ValueChain. Neither testnet nor the
   gated mainnet path needs a bridge, so there is no pressure to fake one.

**What we ship instead:** the declared interface (`BridgeDirection`, `BridgeTx`),
config-gated so it cannot run, with `bridgeBlockers()` naming exactly what is
missing, and a smoke that proves it stays dormant. The honest claim is "the
two-chain split is real and this is the interface for crossing it; the protocol
is undocumented to us, we asked, and we are not going to pretend otherwise."

**What would unblock it:** the §5 answers. Addresses alone are NOT enough; the
ABI is the binding constraint. If Mirror turns out to be a rebrand of an existing
bridge (§2 possibility 1), its ABI is public and this becomes a small, real
implementation rather than a guess.
