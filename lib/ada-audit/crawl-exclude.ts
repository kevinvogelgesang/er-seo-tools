// Client-safe pure predicate for URL paths that are infrastructure artifacts,
// never real client pages (Cloudflare email-obfuscation etc). Applied at BOTH
// discovery (sitemap-crawler) and harvest (link-harvest) so such URLs never
// enter the audited set (and thus never become false dead_page findings).
// Match on the PATH segment only — a query/host containing "cdn-cgi" must not trip.
const EXCLUDED_PATH_RE = /(^|\/)cdn-cgi(\/|$)/i

export function isExcludedCrawlPath(url: string): boolean {
  try {
    return EXCLUDED_PATH_RE.test(new URL(url).pathname)
  } catch {
    return false
  }
}
