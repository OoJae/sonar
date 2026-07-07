// URL scheme allowlist for data-derived links (LLM-authored thesis citations and
// SoSoValue news URLs). Zod's z.string().url() accepts javascript:, data:, and
// vbscript: schemes, which would render as clickable stored XSS on /signals.
// Only http(s) URLs are safe to render as an href; anything else returns null so
// the caller renders plain text instead of a link.
export function safeHttpUrl(u: string | null | undefined): string | null {
  return u && /^https?:\/\//i.test(u) ? u : null;
}
