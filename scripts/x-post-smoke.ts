// X publisher smoke. Two modes:
//   pnpm tsx scripts/x-post-smoke.ts --check   offline: signer known-vector +
//                                              compose truncation checks
//   pnpm tsx scripts/x-post-smoke.ts           ONE real post via POST /2/tweets
//                                              (pay-per-use billing applies).
// THE GATE: X_AUTOPOST must stay false until the real-post mode succeeds on
// the actual developer app.
import "./_env";
import { oauth1Header, composeThesisPost, postTweet, xEnabled } from "@/lib/publish/x";
import type { Thesis } from "@/lib/agent/thesis";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean) {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
}

function signCheck() {
  // The documented X/Twitter known vector ("Creating a signature"): fixed
  // nonce/timestamp/keys must reproduce the published HMAC-SHA1 signature.
  const header = oauth1Header({
    method: "POST",
    url: "https://api.twitter.com/1.1/statuses/update.json",
    consumerKey: "xvz1evFS4wEEPTGEFPHBog",
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    timestamp: "1318622958",
    extraParams: {
      status: "Hello Ladies + Gentlemen, a signed OAuth request!",
      include_entities: "true",
    },
  });
  const m = header.match(/oauth_signature="([^"]+)"/);
  const got = m ? decodeURIComponent(m[1]!) : "(none)";
  check(
    `known-vector signature (${got.slice(0, 12)}...)`,
    got === "hCtSmYh+iHYCEqBWrE7C7hYmtUk=",
  );

  const base: Thesis = {
    id: "11111111-1111-4111-8111-111111111111",
    generatedAt: "2026-07-13T00:00:00.000Z",
    asOf: "2026-07-12T21:00:00.000Z",
    universe: ["MAG7", "DEFI", "MEME"],
    signals: {
      etfFlowSignal: [
        {
          id: "btc-flow",
          asset: "BTC",
          direction: "inflow",
          magnitudeUSD: 1_000_000,
          windowDays: 7,
          confidence: 0.8,
          sourceEndpoint: "/etfs",
        },
      ],
      newsSignals: [],
    },
    reasoning:
      "BTC ETFs took in $3.1B over seven days [ref:btc-flow] via 0xdeadbeefcafebabe, the strongest stretch since March. The rotation favors large caps over memes.",
    proposedAllocations: [
      { index: "MAG7", targetWeight: 0.45, deltaFromCurrent: 0.1 },
      { index: "DEFI", targetWeight: 0.15, deltaFromCurrent: 0 },
      { index: "MEME", targetWeight: 0.05, deltaFromCurrent: -0.02 },
    ],
    hedges: [],
    riskNotes: ["risk"],
    citations: [{ ref: "btc-flow", url: "https://openapi.sosovalue.com" }],
    mode: "trade",
  };
  const post = composeThesisPost(base);
  console.log("  --- composed post ---");
  console.log(post.split("\n").map((l) => `  | ${l}`).join("\n"));
  check("length within 280 (t.co adjusted)", post.length <= 280);
  check("contains mode + date", /TRADE/.test(post) && /2026-07-12/.test(post));
  check("contains the cited stat", post.includes("$3.1B"));
  check("address stripped", !post.includes("0xdeadbeef") && post.includes("[addr]"));
  check("link last", post.trimEnd().endsWith("https://sonar.my.id/signals"));

  // Truncation: a monster reasoning + long stat must still fit.
  const long: Thesis = {
    ...base,
    reasoning: `The flows were ${"very ".repeat(60)}strong at $1.23B on the day with breadth across all products and issuers, which continued for weeks.`,
  };
  const longPost = composeThesisPost(long);
  check("long thesis truncates within budget", longPost.length <= 280);
}

async function realPost() {
  if (!xEnabled()) {
    console.log("X keys not set (X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET). Offline checks only:");
    signCheck();
    process.exit(fail > 0 ? 1 : 0);
  }
  const text = `Sonar smoke test post (${new Date().toISOString()}). Cited theses, verifiable track record: https://sonar.my.id`;
  console.log("posting:", JSON.stringify(text));
  const r = await postTweet(text);
  if (r.ok) {
    console.log(`POSTED  id=${r.id}`);
    console.log("Gate passed: you may now set X_AUTOPOST=true and restart.");
  } else {
    console.log(`FAILED  status=${r.status} detail=${r.detail}`);
    console.log("Gate NOT passed: leave X_AUTOPOST=false.");
    process.exit(1);
  }
}

async function main() {
  if (process.argv.includes("--check")) {
    signCheck();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
  await realPost();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
