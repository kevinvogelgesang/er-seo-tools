// Matches an http(s) URL token terminated by whitespace, common HTML quotes,
// or the start of a Markdown/HTML link tail. Does NOT match the URL inside
// `<a href="...">` content — handle that separately if it ever shows up.
const HTTP_URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/i

/**
 * Parse a textarea blob into a list of URLs.
 *
 * Lenient by design: operators paste from Screaming Frog exports, Yoast
 * sitemap views, JSON dumps, Markdown lists, etc. Each line is scanned for
 * the FIRST http(s) URL token and that's what we extract. Lines with no URL
 * (headers, comments, blank lines, separators) are dropped silently.
 *
 * Dedupe is NOT done here — the backend's normaliseDiscoveredSiteAuditUrls
 * already dedupes (and SSRF-validates, same-domain-filters).
 */
export function parseManualUrls(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(HTTP_URL_RE)
    if (m) out.push(m[0])
  }
  return out
}
