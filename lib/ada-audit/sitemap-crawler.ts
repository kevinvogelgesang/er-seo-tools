import { assertNotPrivate } from './runner'

const MAX_PAGES = 50
const MAX_CHILD_SITEMAPS = 5
const FETCH_TIMEOUT = 15_000
const USER_AGENT = 'ER-SEO-Tools/1.0 ada-audit'

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

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/xml,application/xml,*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    // Reject HTML responses (login redirects, 404 pages served as 200, etc.)
    if (ct.includes('html') && !ct.includes('xml')) return null
    return res.text()
  } catch {
    return null
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

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Discovers pages for a domain via sitemap.xml (or sitemap_index.xml).
 * Returns up to MAX_PAGES (50) URLs, all belonging to the domain.
 * Throws if the domain fails SSRF checks or no sitemap is found.
 */
export async function discoverPages(domain: string): Promise<string[]> {
  const normDomain = normaliseDomain(domain)

  // SSRF check on the domain itself before any fetch
  await assertNotPrivate(normDomain)

  const base = `https://${normDomain}`

  // Try sitemap.xml, then sitemap_index.xml
  let xml = await fetchXml(`${base}/sitemap.xml`)
  if (!xml) xml = await fetchXml(`${base}/sitemap_index.xml`)
  if (!xml) {
    throw new Error(
      `No sitemap found at ${base}/sitemap.xml or ${base}/sitemap_index.xml. ` +
      `Add a sitemap to the site or audit individual pages instead.`
    )
  }

  let pageUrls: string[] = []

  if (isSitemapIndex(xml)) {
    // Sitemap index — extract child sitemap URLs and fetch each
    const childSitemapUrls = extractLocs(xml, /<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)
      .slice(0, MAX_CHILD_SITEMAPS)

    for (const childUrl of childSitemapUrls) {
      const childXml = await fetchXml(childUrl)
      if (!childXml) continue
      const locs = extractLocs(childXml, /<url>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)
      pageUrls.push(...locs)
      if (pageUrls.length >= MAX_PAGES) break
    }
  } else {
    // Plain sitemap
    pageUrls = extractLocs(xml, /<url>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)
  }

  // Filter to same domain, deduplicate, cap
  const filtered = dedupeUrls(
    pageUrls.filter((u) => isSameDomain(u, normDomain))
  ).slice(0, MAX_PAGES)

  if (filtered.length === 0) {
    throw new Error(
      `Sitemap was found but contained no pages for ${normDomain}. ` +
      `It may only list pages from a different domain.`
    )
  }

  return filtered
}
