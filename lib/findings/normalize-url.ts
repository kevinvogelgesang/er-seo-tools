// lib/findings/normalize-url.ts
//
// Client-safe URL normalization (no node imports) shared by the findings
// mappers/keys AND client components that must match CrawlPage.url values.

/**
 * Normalization shared by CrawlPage.url, Finding.url, and the page dedup
 * key: lowercase host, drop fragment, strip the trailing slash on a bare
 * root path. Non-URLs pass through unchanged.
 */
export function normalizeFindingUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  u.hash = ''
  let out = u.toString()
  if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '')
  return out
}
