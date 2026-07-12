// X (Twitter) publisher: posts each cycle's thesis summary as
// aixbt-with-receipts (cited numbers, track-record link).
//
// Auth is hand-rolled OAuth 1.0a user context (HMAC-SHA1), the supported
// server-side scheme for POST /2/tweets: 4 static env secrets, no token
// storage, no refresh dance, zero dependencies. Signing rules that matter:
// the JSON body is NOT part of the signature base string (only oauth_* and
// query/form params are), percent-encoding is strict RFC 3986 (including
// !'()*), and nonce/timestamp are fresh per request.
//
// Air-gapped by construction: this module receives only the thesis object and
// the four X_* env vars. It never imports the executor, wallet keys, or
// CRON_SECRET. Posting is fire-and-forget for callers; failures log, never
// throw. Two gates: xEnabled() (keys present, unlocks the smoke script) and
// X_AUTOPOST (explicit go-live after the smoke passes on the real app).

import { createHmac, randomBytes } from "node:crypto";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import type { Thesis } from "@/lib/agent/thesis";

const TWEETS_URL = "https://api.x.com/2/tweets";
const TCO_LINK_LEN = 23; // any URL counts as 23 chars via t.co
const MAX_LEN = 280;

export function xEnabled(): boolean {
  const e = env();
  return Boolean(
    e.X_API_KEY && e.X_API_SECRET && e.X_ACCESS_TOKEN && e.X_ACCESS_SECRET,
  );
}

// RFC 3986 percent-encoding: encodeURIComponent plus the five characters it
// leaves bare.
export function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// Build the OAuth 1.0a Authorization header for a request. extraParams carries
// query/form parameters that must join the signature base string; a JSON body
// contributes nothing (per spec, only form-encoded bodies are signed).
export function oauth1Header(input: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessSecret: string;
  extraParams?: Record<string, string>;
  nonce?: string; // injectable for the known-vector check
  timestamp?: string;
}): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: input.consumerKey,
    oauth_nonce: input.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: input.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: input.accessToken,
    oauth_version: "1.0",
  };

  const allParams: Array<[string, string]> = Object.entries({
    ...oauthParams,
    ...(input.extraParams ?? {}),
  }).map(([k, v]) => [rfc3986(k), rfc3986(v)]);
  allParams.sort(([a, av], [b, bv]) =>
    a === b ? av.localeCompare(bv) : a.localeCompare(b),
  );
  const paramString = allParams.map(([k, v]) => `${k}=${v}`).join("&");

  const baseString = [
    input.method.toUpperCase(),
    rfc3986(input.url),
    rfc3986(paramString),
  ].join("&");

  const signingKey = `${rfc3986(input.consumerSecret)}&${rfc3986(input.accessSecret)}`;
  const signature = createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  const headerParams: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  };
  const header = Object.keys(headerParams)
    .sort()
    .map((k) => `${rfc3986(k)}="${rfc3986(headerParams[k]!)}"`)
    .join(", ");
  return `OAuth ${header}`;
}

export type PostResult =
  | { ok: true; id: string }
  | { ok: false; status: number; detail: string };

export async function postTweet(text: string): Promise<PostResult> {
  const e = env();
  if (!xEnabled()) {
    return { ok: false, status: 0, detail: "x_disabled" };
  }
  const authorization = oauth1Header({
    method: "POST",
    url: TWEETS_URL,
    consumerKey: e.X_API_KEY!,
    consumerSecret: e.X_API_SECRET!,
    accessToken: e.X_ACCESS_TOKEN!,
    accessSecret: e.X_ACCESS_SECRET!,
  });
  try {
    const res = await fetch(TWEETS_URL, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { id?: string };
      detail?: string;
      title?: string;
    };
    if (res.ok && body.data?.id) {
      return { ok: true, id: body.data.id };
    }
    return {
      ok: false,
      status: res.status,
      detail: (body.detail ?? body.title ?? `http_${res.status}`).slice(0, 200),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// First sentence of the reasoning containing a $ or % figure: the cited stat.
function citedStat(reasoning: string): string | null {
  const clean = reasoning
    .replace(/\[ref:[^\]]+\]/g, "")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/\s+/g, " ");
  for (const sentence of clean.split(/(?<=\.)\s+/)) {
    if (/[$%]\d|\d[%]|\$\d/.test(sentence)) {
      return sentence.trim();
    }
  }
  return null;
}

export function composeThesisPost(thesis: Thesis): string {
  const date = thesis.asOf.slice(0, 10);
  const mode = thesis.mode === "trade" ? "TRADE" : "NO-TRADE";
  const link = "https://sonar.my.id/signals";

  // Allocations sorted heaviest first so truncation drops the least important.
  const allocs = [...thesis.proposedAllocations].sort(
    (a, b) => b.targetWeight - a.targetWeight,
  );
  const allocText = (n: number) =>
    allocs
      .slice(0, n)
      .map((a) => `${a.index} ${Math.round(a.targetWeight * 100)}%`)
      .join(" / ");

  const stat = citedStat(thesis.reasoning);
  const budget = MAX_LEN - TCO_LINK_LEN - 1; // link + preceding newline

  // Truncation order: drop the stat sentence, then the lowest-weight
  // allocations. The date, mode, and link always survive.
  const candidates: string[] = [];
  for (const withStat of [true, false]) {
    for (let n = allocs.length; n >= 1; n--) {
      const lines = [
        `Sonar daily thesis (${date}): ${mode}`,
        `Allocations: ${allocText(n)}`,
      ];
      if (withStat && stat) lines.push(stat);
      candidates.push(lines.join("\n"));
    }
  }
  let body =
    candidates.find((c) => c.length <= budget) ??
    `Sonar daily thesis (${date}): ${mode}`.slice(0, budget);

  // Hard rule: never publish anything address-shaped.
  body = body.replace(/0x[0-9a-fA-F]{4,}/g, "[addr]");

  return `${body}\n${link}`;
}

// The cycle hook: composes and posts, gated on keys AND the explicit
// X_AUTOPOST switch (set only after scripts/x-post-smoke.ts has passed).
export async function publishThesis(thesis: Thesis): Promise<void> {
  const e = env();
  if (!xEnabled() || !e.X_AUTOPOST) return;
  const text = composeThesisPost(thesis);
  const result = await postTweet(text);
  if (result.ok) {
    logger.info("x.thesis_posted", { id: result.id });
  } else {
    logger.warn("x.post_failed", {
      status: result.status,
      detail: result.detail,
    });
  }
}
