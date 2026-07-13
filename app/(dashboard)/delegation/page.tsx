import { Badge } from "@/components/ui/badge";
import { DelegationPanel } from "@/components/delegation-panel";
import { getSignerAddress } from "@/lib/sodex/client";
import { env } from "@/lib/utils/env";

export const dynamic = "force-dynamic";

export default function DelegationPage() {
  let sessionKey: string | null = null;
  try {
    sessionKey = getSignerAddress();
  } catch {
    sessionKey = null;
  }
  const e = env();

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="mono text-[10px] uppercase tracking-[0.2em]"
          >
            non-custodial
          </Badge>
          <Badge
            variant="secondary"
            className="mono text-[10px] uppercase tracking-[0.2em]"
          >
            EIP-712 session grant
          </Badge>
        </div>
        <h1 className="display text-4xl tracking-tight">Delegation</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Sonar is non-custodial by design: the agent acts under a scoped session
          approval, not custody of your funds. You connect your wallet and sign an
          EIP-712 grant that authorizes the agent&apos;s session key to trade a
          bounded set of markets up to a per-order size, until an expiry you set,
          revocable at any time. Sonar verifies the signature and blocks anything
          outside that scope at the executor.
        </p>
      </div>

      <DelegationPanel
        sessionKey={sessionKey}
        enforcementOn={e.SONAR_REQUIRE_DELEGATION}
        systemPerCycleUsd={e.SONAR_MAX_NOTIONAL_PER_CYCLE}
      />

      <section className="rounded-lg border border-border/60 bg-card/70 p-6 space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">How it works</h2>
        <ol className="space-y-3 text-sm text-muted-foreground">
          <li>
            <span className="mono text-foreground">1. Sign.</span> You sign an
            EIP-712 SessionGrant (grantor, agent session key, allowed markets,
            max notional per order, expiry, nonce) with your own wallet. Nothing
            leaves your wallet except the signature.
          </li>
          <li>
            <span className="mono text-foreground">2. Verify + store.</span> Sonar
            recovers the signer, confirms it matches you, sanity-checks the scope,
            and stores the grant. Re-signing replaces your prior grant; a signed
            revoke ends it.
          </li>
          <li>
            <span className="mono text-foreground">3. Enforce.</span> On every
            order, the executor checks for an active grant to the agent session
            key that covers the market and size. Out-of-scope orders are blocked
            before anything is placed. The risk gate (per-order and per-cycle
            caps) still applies on top, so effective spend is the smaller of your
            grant and the system caps.
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Honest scope: enforcement is at the application layer. The SoDEX venue
          does not see or verify the grant; the signed grant is the verifiable
          authorization artifact. The same design maps onto an on-chain
          session-key module (ERC-4337 / ERC-7715 style) for mainnet, where the
          venue itself would enforce the scope. Enforcement is currently{" "}
          <span className="mono">{e.SONAR_REQUIRE_DELEGATION ? "on" : "off"}</span>
          {e.SONAR_REQUIRE_DELEGATION
            ? " (every order requires a covering grant)."
            : " (the agent trades under operator authority; flip SONAR_REQUIRE_DELEGATION to require grants)."}
        </p>
      </section>
    </div>
  );
}
