# Sonar - Updates in this Wave (AKINDO field, Wave 3)

Paste-ready for the "Updates in this Wave" field (under the 3,000-char cap). Same
verified claims as the About, condensed, with the deliverable URLs. No em dashes.

---

Wave 3 completed the product: a gated mainnet path, a production risk engine,
non-custodial delegation, custom indices, a second strategy, a full interface
redesign, and an adversarial-audit hardening pass. Live and public, no wallet
needed, at https://sonar.my.id.

Gated mainnet path, proven. On mainnet the agent records a risk-capped order and
stops; only a bearer-authenticated human approval reaches the wire. We ran one real
human-approved fill to prove it end to end: a BTC-PERP long filled at $62,802 and
closed at $62,790, a round trip of about one cent on symbolic capital. Mainnet
stays disarmed by default; the demo runs on testnet.

Admin-signed mode toggle. An allowlisted wallet flips the fund between testnet and
mainnet from the dashboard by signing an EIP-712 action (no secret reaches the
browser); a boot guard self-heals to the testnet baseline if a bad config lands.

Production risk engine. Drawdown (25%), one-cycle VaR, and average index
correlation are now enforced portfolio guards: breach any cap and the cycle
de-risks (notional to a third, allocations tilted to USSI). Per-order, per-cycle,
position, and gross caps bound every venue order. https://sonar.my.id/risk

Session-key delegation. A user signs a scoped, expiring, revocable EIP-712 grant
(allowed markets plus a per-order max). When enforcement is on, the executor checks
it before every order; it is opt-in, off for the autonomous cron by default.
App-level and honestly labeled. https://sonar.my.id/delegation

Custom SSI index proposals. The agent designs themed index baskets with cited
constituents and forward-tests them in public. https://sonar.my.id/proposals

Delta-neutral second book. A rules-based delta-neutral carry runs beside the
directional rotation as its own book, sharing the reasoning engine and venue
account. https://sonar.my.id/portfolio

Brand and interface. A full visual identity (mark, favicon, generated social card)
and a dark-navy-and-gold terminal system across every page, with an immersive
landing built around a live animated sonar scope. https://sonar.my.id

Adversarial audit and remediation. A multi-agent review found and fixed 34 real
defects, including a cross-strategy sizing bug and a track page that overstated
performance during a data outage. The published numbers now match the code.

Verifiable and honest throughout: every thesis cites its signals or is rejected,
failed runs stay in the decision log, and the track record shows wins and misses
(it does not claim to beat buy-and-hold). Track record: https://sonar.my.id/track
Code: https://github.com/OoJae/sonar
