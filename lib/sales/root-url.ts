// lib/sales/root-url.ts — C14 hero: pure root-URL matching + the prospect-only
// discovery injection. Client-safe (no fs/prisma). Spec Codex fix 1: discovery
// does NOT guarantee the site root is in the audited set; for prospect-owned
// audits ONLY, the discover job guarantees it via injectProspectRoot — a
// documented, at-most-one-page measurement adjustment (Kevin sign-off).

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

/** Canonical root for a stored SiteAudit.domain ("example.edu" — no scheme). */
export function canonicalRootUrl(domain: string): string {
  return `https://${bareHost(domain.trim())}/`
}

/**
 * True when `url` is the site root: http(s) scheme (either), host equal to
 * `domain` up to a `www.` prefix on either side, path '/' or empty, no query.
 */
export function isRootUrl(url: string, domain: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (bareHost(u.hostname) !== bareHost(domain.trim())) return false
  if (u.search !== '') return false
  return u.pathname === '/' || u.pathname === ''
}

/**
 * Prospect-only discovery adjustment: guarantee a root variant in the set.
 * Returns the INPUT ARRAY (same reference) with `displaced: false` when a
 * variant is present — callers may rely on that for a cheap no-op check.
 * At `cap`, the root displaces the LAST url so the 1000-page hard cap is
 * respected — and `displaced: true` tells the caller to persist
 * `discoveryCapped: true` (plan Codex fix 3: deliberate truncation must not
 * read as complete coverage in the miss-rate measurement).
 * Pure + deterministic: every discover attempt over the same stored set
 * produces the same output.
 */
export function injectProspectRoot(
  urls: string[],
  domain: string,
  cap: number,
): { urls: string[]; displaced: boolean } {
  if (urls.some((u) => isRootUrl(u, domain))) return { urls, displaced: false }
  const withRoot = [canonicalRootUrl(domain), ...urls]
  if (withRoot.length > cap) return { urls: withRoot.slice(0, cap), displaced: true }
  return { urls: withRoot, displaced: false }
}
