import {
  assertSafeHttpUrl,
  readResponseBytesWithLimit,
  readResponseTextWithLimit,
  safeFetch,
} from '../security/safe-url'
import { fetchSitemapViaBrowser } from './sitemap-crawler-browser-fetch'

const HARD_CAP = 1000
const FETCH_TIMEOUT = 15_000
const MAX_HTML_BYTES = 1_000_000
const MAX_XML_BYTES = 5_000_000
const MAX_ROBOTS_BYTES = 500_000
// Browser-shaped UA. CDN/WAF heuristics frequently 403 transparently bot
// user-agents like "ER-SEO-Tools/1.0", which causes silent sitemap discovery
// failures. Pretending to be Chrome matches what a manual fetch of the same
// URL looks like to those filters.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// ─── XML helpers ─────────────────────────────────────────────────────────────

function extractLocs(xml: string, tagPattern: RegExp): string[] {
  const urls: string[] = []
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(xml)) !== null) {
    // Strip CDATA wrappers and whitespace
    const raw = match[1].replace(/<!\[CDATA\[([\s\S]*?)]]>/, '$1').trim()
    if (raw) urls.push(raw)
  }
  return urls
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml)
}

// ─── Fetch helpers ───────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const { response: res } = await safeFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('html')) return null
    const { text, truncated } = await readResponseTextWithLimit(res, MAX_HTML_BYTES)
    return truncated ? null : text
  } catch {
    return null
  }
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const { response: res, url: finalUrl } = await safeFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/xml,application/xml,*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    // Reject HTML responses (login redirects, 404 pages served as 200, etc.)
    if (ct.includes('html') && !ct.includes('xml')) return null

    // Handle gzip-compressed sitemaps
    if (finalUrl.endsWith('.gz') || ct.includes('gzip')) {
      const { bytes, truncated } = await readResponseBytesWithLimit(res, MAX_XML_BYTES)
      if (truncated) return null
      const { gunzipSync } = await import('node:zlib')
      const xml = gunzipSync(Buffer.from(bytes), { maxOutputLength: MAX_XML_BYTES }).toString('utf-8')
      return xml.length > MAX_XML_BYTES ? null : xml
    }

    const { text, truncated } = await readResponseTextWithLimit(res, MAX_XML_BYTES)
    return truncated ? null : text
  } catch {
    return null
  }
}

async function fetchRobotsTxt(base: string): Promise<string[]> {
  try {
    const { response: res } = await safeFetch(`${base}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return []
    const { text, truncated } = await readResponseTextWithLimit(res, MAX_ROBOTS_BYTES)
    if (truncated) return []
    const urls: string[] = []
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*Sitemap:\s*(.+)/i)
      if (match) urls.push(match[1].trim())
    }
    return urls
  } catch {
    return []
  }
}

// ─── URL normalisation ───────────────────────────────────────────────────────

function normaliseDomain(domain: string): string {
  // Strip scheme and path if the user passed a full URL accidentally
  return domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
}

function isSameDomain(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    // Allow exact match and www. prefix
    return host === domain || host === `www.${domain}` || domain === `www.${host}`
  } catch {
    return false
  }
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const url of urls) {
    // Normalise: remove fragment and common tracking params for dedup key
    try {
      const u = new URL(url)
      u.hash = ''
      ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(
        (p) => u.searchParams.delete(p)
      )
      const key = u.toString()
      if (!seen.has(key)) {
        seen.add(key)
        result.push(url) // push original, not normalised, for audit
      }
    } catch {
      // malformed URL — skip
    }
  }
  return result
}

// ─── Shallow link crawl ──────────────────────────────────────────────────────

/**
 * Fetches the homepage and extracts all same-domain <a href> links.
 * Uses a simple regex — acceptable for a shallow one-page crawl.
 */
async function shallowCrawl(base: string, normDomain: string): Promise<string[]> {
  const html = await fetchHtml(base)
  if (!html) return []

  const hrefPattern = /<a[^>]+href=["']([^"']+)["']/gi
  const hrefs: string[] = []
  let match: RegExpExecArray | null
  while ((match = hrefPattern.exec(html)) !== null) {
    hrefs.push(match[1])
  }

  const resolved: string[] = []
  for (const href of hrefs) {
    const trimmed = href.trim()
    // Skip fragments, mailto, javascript, etc.
    if (!trimmed || trimmed.startsWith('#') || /^[a-z][a-z\d+\-.]*:/i.test(trimmed) && !trimmed.startsWith('http')) {
      continue
    }
    try {
      const absolute = trimmed.startsWith('/')
        ? `${base}${trimmed}`
        : trimmed
      // Validate it's a proper URL and belongs to the same domain
      const parsed = new URL(absolute)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue
      if (isSameDomain(absolute, normDomain)) {
        resolved.push(absolute)
      }
    } catch {
      // malformed — skip
    }
  }

  return dedupeUrls(resolved)
}

// ─── Sitemap URL collection ─────────────────────────────────────────────────

/**
 * Given a sitemap XML (plain or index), collect all page URLs.
 * Follows child sitemaps in sitemap indexes (no artificial cap).
 */
async function collectFromSitemap(xml: string, normDomain: string): Promise<string[]> {
  if (!isSitemapIndex(xml)) {
    return extractLocs(xml, /<url>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)
  }

  // Sitemap index — fetch all child sitemaps
  const childUrls = extractLocs(xml, /<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)
    .filter((url) => isSameDomain(url, normDomain))
  const pageUrls: string[] = []

  // Fetch child sitemaps in batches of 5 to be polite
  const BATCH = 5
  for (let i = 0; i < childUrls.length; i += BATCH) {
    const batch = childUrls.slice(i, i + BATCH)
    const childXmls = await Promise.all(batch.map((u) => fetchXml(u)))
    for (const childXml of childXmls) {
      if (!childXml) continue
      const locs = extractLocs(childXml, /<url>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)
      pageUrls.push(...locs)
    }
  }

  return pageUrls
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Discovers pages for a domain via sitemap.xml (checking robots.txt, common paths).
 * Falls back to a shallow homepage link crawl if no sitemap is found.
 * Returns all discovered URLs belonging to the domain, up to HARD_CAP (1000).
 * Throws if the domain fails SSRF checks or no pages are discovered.
 */
export async function discoverPages(domain: string): Promise<string[]> {
  const normDomain = normaliseDomain(domain)

  // SSRF check on the domain itself before any fetch
  const base = `https://${normDomain}`
  await assertSafeHttpUrl(base)

  // 1. Check robots.txt for Sitemap: directives
  const robotsSitemapUrls = await fetchRobotsTxt(base)

  // 2. Build ordered list of sitemap URLs to try
  const sitemapCandidates = [
    ...robotsSitemapUrls,
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/wp-sitemap.xml`,
    `${base}/sitemap.xml.gz`,
  ]

  // Dedupe candidates (robots.txt may list the same as our defaults)
  const seen = new Set<string>()
  const uniqueCandidates: string[] = []
  for (const url of sitemapCandidates) {
    if (!isSameDomain(url, normDomain)) continue
    if (!seen.has(url)) {
      seen.add(url)
      uniqueCandidates.push(url)
    }
  }

  // 3. Try each candidate until we get pages
  let allPageUrls: string[] = []

  for (const sitemapUrl of uniqueCandidates) {
    const xml = await fetchXml(sitemapUrl)
    if (!xml) continue

    const urls = await collectFromSitemap(xml, normDomain)
    if (urls.length > 0) {
      allPageUrls = urls
      break
    }
  }

  // 4. If no sitemap yielded pages, try shallow crawl
  if (allPageUrls.length === 0) {
    const crawledPages = await shallowCrawl(base, normDomain)
    if (crawledPages.length > 0) return crawledPages

    // 4b. Browser fallback — safeFetch was likely 403'd by a CDN/WAF.
    // Retry the same candidates via Puppeteer (real Chrome TLS handshake
    // bypasses most fingerprint-based bot blocks). The browser-fetch helper
    // owns its own SSRF interception.
    for (const sitemapUrl of uniqueCandidates) {
      const xml = await fetchSitemapViaBrowser(sitemapUrl)
      if (!xml) continue
      const urls = await collectFromSitemap(xml, normDomain)
      if (urls.length > 0) {
        allPageUrls = urls
        break
      }
    }

    if (allPageUrls.length === 0) {
      throw new Error(
        `No sitemap found on ${normDomain} (tried direct fetch and browser fallback) and shallow crawl found 0 pages`
      )
    }
  }

  // 5. Filter to same domain, deduplicate, apply hard cap
  const filtered = dedupeUrls(
    allPageUrls.filter((u) => isSameDomain(u, normDomain))
  ).slice(0, HARD_CAP)

  if (filtered.length === 0) {
    throw new Error(
      `Sitemap was found but contained no pages for ${normDomain}. ` +
      `It may only list pages from a different domain.`
    )
  }

  return filtered
}
