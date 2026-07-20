import {
  assertSafeHttpUrl,
  readResponseTextWithLimit,
  safeFetch,
} from '../security/safe-url'
import { fetchSitemapViaBrowser } from './sitemap-crawler-browser-fetch'
import {
  hybridCrawl, mergeCrawlResults, admissibleLink,
  type CrawlBounds, type CrawlSource, type CrawlSeed, type FetchedPage,
} from './seo/hybrid-crawl'
import { fetchPageLinksViaBrowser, buildProbeTargets } from './seo/rendered-crawl'
import { normalizeCoverageUrl } from './seo/discovery-coverage'
import { parseRobots, type RobotsRules } from '@/lib/seo-fetch/robots-match'
import { extractSitemapUrls } from '@/lib/seo-fetch/robots-parse'
import { isExcludedCrawlPath } from './crawl-exclude'
import { sameDomain, normalizeLinkTarget } from './link-harvest'
import { parsePositiveInt } from '@/lib/jobs/config'
import {
  fetchRobotsTxt,
  fetchSitemapXml as fetchSitemapXmlDirect,
  collectSitemapPageUrls,
  SEO_FETCH_USER_AGENT,
} from '@/lib/seo-fetch/fetch'

export const HARD_CAP = 1000
const FETCH_TIMEOUT = 15_000
const MAX_HTML_BYTES = 1_000_000

// ─── Hybrid-crawl env tunables ───────────────────────────────────────────────

const HY_MAX_DEPTH = () => parsePositiveInt(process.env.HYBRID_CRAWL_MAX_DEPTH, 3)
const HY_MAX_ADDED = () => parsePositiveInt(process.env.HYBRID_CRAWL_MAX_ADDED, 300)
const HY_MAX_FETCHES = () => parsePositiveInt(process.env.HYBRID_CRAWL_MAX_FETCHES, 400)
const HY_TIME_BUDGET = () => parsePositiveInt(process.env.HYBRID_CRAWL_TIME_BUDGET_MS, 120_000)
const HY_CONCURRENCY = () => parsePositiveInt(process.env.HYBRID_CRAWL_CONCURRENCY, 6)
const HY_QUERY_VARIANTS = () => parsePositiveInt(process.env.HYBRID_CRAWL_MAX_QUERY_VARIANTS_PER_PATH, 5)
const HY_PATH_SEGMENTS = () => parsePositiveInt(process.env.HYBRID_CRAWL_MAX_PATH_SEGMENTS, 12)

// ─── L2 rendered-DOM discovery env tunables ──────────────────────────────────
const RENDER_MAX_DEPTH = () => parsePositiveInt(process.env.HYBRID_RENDER_MAX_DEPTH, 2)
const RENDER_MAX_ADDED = () => parsePositiveInt(process.env.HYBRID_RENDER_MAX_ADDED, 300)
const RENDER_MAX_FETCHES = () => parsePositiveInt(process.env.HYBRID_RENDER_MAX_FETCHES, 40)
const RENDER_CONCURRENCY = () => parsePositiveInt(process.env.HYBRID_RENDER_CONCURRENCY, 2)
const RENDER_PROBE_MIN_NOVEL = () => parsePositiveInt(process.env.HYBRID_RENDER_PROBE_MIN_NOVEL, 5)
const RENDER_PROBE_MAX_HUBS = () => parsePositiveInt(process.env.HYBRID_RENDER_PROBE_MAX_HUBS, 2)
const RENDER_FLOOR_MS = 15_000 // below this remaining budget, skip the rendered pass

// ─── Fetch helpers ───────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const { response: res } = await safeFetch(url, {
      headers: { 'User-Agent': SEO_FETCH_USER_AGENT, Accept: 'text/html,*/*' },
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

/** Single robots.txt fetch — returns the raw body, or '' on any failure. */
async function fetchRobotsRaw(base: string): Promise<string> {
  const r = await fetchRobotsTxt(base)
  return r.ok ? r.text : ''
}

/**
 * Try direct fetch first, fall back to a Puppeteer-driven fetch when direct
 * fails (CDN/WAF blocking). The browser path is expensive (~1 s warmup, up
 * to 20 s navigation) but only fires when needed. A successful-but-EMPTY
 * direct body also falls back — historical `if (direct)` was falsy on ''
 * (Codex plan #1, blocker).
 */
async function fetchSitemapXml(url: string, deadlineMs?: number): Promise<string | null> {
  const direct = await fetchSitemapXmlDirect(url)
  if (direct.ok && direct.text.length > 0) return direct.text
  return await fetchSitemapViaBrowser(url, deadlineMs) // deadline-aware browser fallback (Codex fix 1)
}

/** Raw-HTTP fetch of a page's same-doc <a href>s + the post-redirect final URL.
 *  Returns null on any fetch failure or if the final URL left the audited host. */
export async function fetchPageLinks(url: string, auditedHost: string): Promise<FetchedPage | null> {
  try {
    const { response: res, url: finalUrl } = await safeFetch(url, {
      headers: { 'User-Agent': SEO_FETCH_USER_AGENT, Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('html')) return null
    let finalHost: string
    try {
      finalHost = new URL(finalUrl).hostname.toLowerCase()
    } catch {
      return null
    }
    if (!sameDomain(finalHost, auditedHost.toLowerCase())) return null
    const { text, truncated } = await readResponseTextWithLimit(res, MAX_HTML_BYTES)
    if (truncated) return null
    const hrefs: string[] = []
    const re = /<a[^>]+href=["']([^"']+)["']/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) hrefs.push(m[1])
    return { links: hrefs, finalUrl }
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
      if (isExcludedCrawlPath(absolute)) continue
      if (isSameDomain(absolute, normDomain)) {
        resolved.push(absolute)
      }
    } catch {
      // malformed — skip
    }
  }

  return dedupeUrls(resolved)
}

// ─── Seed resolution (sitemap → shallow-crawl fallback) ─────────────────────

/**
 * Discovers pages for a domain via sitemap.xml (checking robots.txt, common paths).
 * Falls back to a shallow homepage link crawl if no sitemap is found.
 * Returns all discovered URLs belonging to the domain, up to HARD_CAP (1000),
 * plus provenance: `mode` ('sitemap' | 'shallow-crawl') and `capped` (true when
 * the sitemap yielded more than HARD_CAP unique pages, computed before slicing).
 * Throws if no pages are discovered. The SSRF check on the domain itself runs
 * in the caller (`discoverPages`), before robots.txt is even fetched — do not
 * re-check here, that would fetch-then-check instead of check-then-fetch.
 */
async function resolveSeedsReal(
  domain: string,
  robotsText: string,
  deadlineMs?: number,
): Promise<{ urls: string[]; mode: 'sitemap' | 'shallow-crawl'; capped: boolean }> {
  const normDomain = normaliseDomain(domain)
  const base = `https://${normDomain}`

  // 1. Sitemap: directives already extracted from the (already-fetched) robots.txt
  const robotsSitemapUrls = extractSitemapUrls(robotsText)

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

  // 3. Try each candidate until we get pages (direct fetch, then browser fallback)
  let allPageUrls: string[] = []

  for (const sitemapUrl of uniqueCandidates) {
    const xml = await fetchSitemapXml(sitemapUrl, deadlineMs)
    if (!xml) continue

    const collected = await collectSitemapPageUrls(
      xml,
      (u) => isSameDomain(u, normDomain),
      (u) => fetchSitemapXml(u, deadlineMs),
    )
    if (collected.urls.length > 0) {
      allPageUrls = collected.urls
      break
    }
  }

  // 4. If no sitemap yielded pages, fall back to shallow crawl
  if (allPageUrls.length === 0) {
    const crawledPages = await shallowCrawl(base, normDomain)
    if (crawledPages.length === 0) {
      throw new Error(
        `No sitemap found on ${normDomain} (tried direct + browser fetch on all candidates) and shallow crawl found 0 pages`
      )
    }
    return { urls: crawledPages, mode: 'shallow-crawl', capped: false }
  }

  // 5. Filter to same domain, deduplicate, apply hard cap
  const deduped = dedupeUrls(allPageUrls.filter((u) => isSameDomain(u, normDomain) && !isExcludedCrawlPath(u)))
  const filtered = deduped.slice(0, HARD_CAP)

  if (filtered.length === 0) {
    throw new Error(
      `Sitemap was found but contained no pages for ${normDomain}. ` +
      `It may only list pages from a different domain.`
    )
  }

  return { urls: filtered, mode: 'sitemap', capped: deduped.length > HARD_CAP }
}

// ─── Hybrid-crawl-aware discovery (deps-injected core + public wrapper) ─────

interface DiscoverDeps {
  resolveSeeds: (domain: string, deadlineMs: number) => Promise<{ urls: string[]; mode: 'sitemap' | 'shallow-crawl'; capped: boolean }>
  fetchPageLinks: (url: string) => Promise<FetchedPage | null>
  fetchPageLinksRendered?: (url: string, deadlineMs: number) => Promise<FetchedPage | null>
  now: () => number
  robots?: RobotsRules
}

export interface DiscoverResult {
  urls: string[]
  mode: 'sitemap' | 'shallow-crawl' | 'hybrid'
  capped: boolean
  coverage?: {
    sources: Record<string, CrawlSource>; sitemapCount: number; sitemapCapped: boolean; stoppedBy: string; fetches: number
    renderProbe: 'skipped' | 'no-delta' | 'triggered' | 'failed'
    renderedFetches: number; renderedAdded: number; renderStoppedBy?: string
  }
}

/**
 * Deps-injected discovery core (exported test-only). Resolves seeds (sitemap
 * or shallow-crawl, unless `opts.seeds` is provided), then — when
 * `opts.hybrid` is set — expands the seed set via `hybridCrawl`. When
 * `opts.hybrid` is falsy, returns exactly the pre-existing shape (no
 * `coverage`, mode never `'hybrid'`) — this is the regression contract for
 * `discoverPages(domain)` / `discoverPages(domain, { hybrid: false })`.
 */
export async function discoverPagesWithDeps(
  domain: string,
  opts: { hybrid?: boolean; seeds?: string[]; timeBudgetMs?: number },
  deps: DiscoverDeps,
): Promise<DiscoverResult> {
  const normDomain = normaliseDomain(domain)
  const host = normDomain

  // ONE global deadline (Codex fix 1) — computed BEFORE seed resolution. The
  // job budget is the OVERALL ceiling; HY_TIME_BUDGET is only the raw pass's
  // sub-budget. Threaded into resolveSeeds so its browser-sitemap fallback can
  // neither wait for a pool slot nor navigate past it.
  const deadlineMs = deps.now() + (opts.timeBudgetMs ?? HY_TIME_BUDGET())

  // Resolve seeds: provided (pre-discovered) or via sitemap/shallow.
  let seedMode: 'sitemap' | 'shallow-crawl'
  let seedUrls: string[]
  let seedCapped: boolean
  let seedSource: 'sitemap' | 'seed' | 'shallow'
  if (opts.seeds) {
    seedUrls = [...new Set(opts.seeds)]
    seedMode = 'sitemap'
    seedCapped = false
    seedSource = 'seed'
  } else {
    const resolved = await deps.resolveSeeds(domain, deadlineMs)
    seedUrls = resolved.urls
    seedMode = resolved.mode
    seedCapped = resolved.capped
    seedSource = resolved.mode === 'shallow-crawl' ? 'shallow' : 'sitemap'
  }

  if (!opts.hybrid) {
    return { urls: seedUrls, mode: seedMode, capped: seedCapped }
  }

  const robots = deps.robots ?? { disallow: [], allow: [] }
  // Codex #4: resolveSeedsReal already sliced to HARD_CAP, so `seedUrls.length >
  // HARD_CAP` is always false. The sitemap portion's cap comes from the
  // resolver's `capped` flag (sitemap mode) or, for provided seeds, whether the
  // raw seed count exceeded the cap before slicing.
  const sitemapCappedBefore = opts.seeds ? opts.seeds.length > HARD_CAP : (seedSource === 'sitemap' && seedCapped)
  const bounds: CrawlBounds = {
    maxDepth: HY_MAX_DEPTH(),
    maxAdded: HY_MAX_ADDED(),
    maxFetches: HY_MAX_FETCHES(),
    timeBudgetMs: Math.min(HY_TIME_BUDGET(), Math.max(0, deadlineMs - deps.now())), // raw sub-budget ≤ overall deadline
    hardCap: HARD_CAP,
    maxQueryVariantsPerPath: HY_QUERY_VARIANTS(),
    maxPathSegments: HY_PATH_SEGMENTS(),
    concurrency: HY_CONCURRENCY(),
  }
  const crawl = await hybridCrawl(
    seedUrls.map((u) => ({ url: u, source: seedSource })),
    host,
    bounds,
    { fetchPageLinks: deps.fetchPageLinks, now: deps.now },
    robots,
  )

  // ── L2 rendered-DOM adaptive pass ──
  let renderProbe: 'skipped' | 'no-delta' | 'triggered' | 'failed' = 'skipped'
  let renderedFetches = 0
  let renderedAdded = 0
  let renderStoppedBy: string | undefined
  let merged: { urls: string[]; sources: Record<string, CrawlSource> } = { urls: crawl.urls, sources: crawl.sources }

  if (deps.fetchPageLinksRendered) {
    const renderedDep = deps.fetchPageLinksRendered
    let renderCalls = 0 // Codex fix 4: count ACTUAL browser renders, not memo hits
    const doRender = async (u: string): Promise<FetchedPage | null> => { renderCalls++; return renderedDep(u, deadlineMs) }
    if (crawl.urls.length >= HARD_CAP) {
      renderStoppedBy = 'hardCapPrefull' // >1000 pages already — rendered URLs would silently vanish; skip + flag capped
    } else if (deadlineMs - deps.now() < RENDER_FLOOR_MS) {
      renderStoppedBy = 'timeBudget'
    } else {
      const maxSegments = HY_PATH_SEGMENTS()
      const variantCap = HY_QUERY_VARIANTS()
      const knownKeys = new Set(crawl.urls.map(normalizeCoverageUrl))
      // Codex fix 5: home (index 0) is the unconditional publisher seed; every
      // extra hub must pass the same robots/trap/segment filter as a BFS link
      // before it becomes a trusted (robots-bypassing) rendered seed.
      const rawProbe = buildProbeTargets(host, crawl.urls, RENDER_PROBE_MAX_HUBS())
      const probeTargets = rawProbe.filter((u, i) => i === 0 || admissibleLink(u, host, robots, maxSegments))
      // Codex fix 4: memoize probe RESULTS incl. failures (null) — keyed by .has,
      // not truthiness — so a failed probe target is not re-rendered as a seed.
      const prefetch = new Map<string, FetchedPage | null>()
      let anyProbeOk = false
      const novel = new Set<string>()
      const probeVariants = new Map<string, number>() // mirror BFS maxQueryVariantsPerPath (Codex fix 4)
      for (const t of probeTargets) {
        if (deps.now() >= deadlineMs) break
        const page = await doRender(t)
        prefetch.set(t, page ?? null)
        if (!page) continue
        anyProbeOk = true
        for (const rawHref of page.links) {
          const resolved = normalizeLinkTarget(rawHref, page.finalUrl)
          if (!resolved) continue
          if (!admissibleLink(resolved, host, robots, maxSegments)) continue
          const key = normalizeCoverageUrl(resolved)
          if (knownKeys.has(key)) continue
          let pk: string
          try { pk = new URL(key).pathname } catch { pk = key }
          const seen = probeVariants.get(pk) ?? 0
          if (seen >= variantCap) continue // same per-path query-variant cap BFS enforces
          probeVariants.set(pk, seen + 1)
          novel.add(key)
        }
      }
      if (!anyProbeOk) {
        renderProbe = 'failed' // every probe render failed (nav error / WAF / consent) — distinct from no-delta
      } else if (novel.size < RENDER_PROBE_MIN_NOVEL()) {
        renderProbe = 'no-delta'
      } else {
        renderProbe = 'triggered'
        const memoFetch = async (u: string): Promise<FetchedPage | null> => {
          if (prefetch.has(u)) return prefetch.get(u) ?? null // reuse probe result (incl. memoized failure)
          const p = await doRender(u)
          prefetch.set(u, p ?? null)
          return p
        }
        const renderBounds: CrawlBounds = {
          maxDepth: RENDER_MAX_DEPTH(),
          maxAdded: RENDER_MAX_ADDED(),
          maxFetches: RENDER_MAX_FETCHES(),
          timeBudgetMs: Math.max(0, deadlineMs - deps.now()),
          hardCap: HARD_CAP,
          maxQueryVariantsPerPath: variantCap,
          maxPathSegments: maxSegments,
          concurrency: RENDER_CONCURRENCY(),
        }
        const seeds: CrawlSeed[] = probeTargets.map((u) => ({ url: u, source: 'rendered' }))
        const renderedCrawl = await hybridCrawl(
          seeds, host, renderBounds, { fetchPageLinks: memoFetch, now: deps.now }, robots,
          { knownKeys, linkedSource: 'rendered-linked', prioritizeShallowFrontier: true },
        )
        renderedAdded = renderedCrawl.addedByCrawl
        renderStoppedBy = renderedCrawl.stoppedBy
        merged = mergeCrawlResults(crawl, renderedCrawl, HARD_CAP)
      }
    }
    renderedFetches = renderCalls // actual browser renders (probes + BFS misses), not memo hits
  }

  const expanded = crawl.addedByCrawl > 0 || renderedAdded > 0
  // Codex #5: a set of exactly HARD_CAP is NOT capped (only a source overflow is).
  const capped = seedCapped || crawl.stoppedBy === 'hardCap' || renderStoppedBy === 'hardCapPrefull'
  return {
    urls: merged.urls,
    // 'hybrid' when either pass expanded the seed set, or when seeds were
    // provided explicitly (a hybrid-flow signal that skips seed resolution).
    mode: opts.seeds || expanded ? 'hybrid' : seedMode,
    capped,
    coverage: {
      sources: merged.sources,
      sitemapCount: crawl.sitemapCount,
      sitemapCapped: sitemapCappedBefore,
      stoppedBy: crawl.stoppedBy,
      fetches: crawl.fetches,
      renderProbe, renderedFetches, renderedAdded, renderStoppedBy,
    },
  }
}

/**
 * Public discovery entrypoint. Fetches robots.txt exactly once (feeding both
 * the sitemap-candidate resolution AND the hybrid crawl's Disallow rules),
 * then delegates to `discoverPagesWithDeps` with real deps.
 *
 * `discoverPages(domain)` and `discoverPages(domain, { hybrid: false })` are
 * the pre-existing regression contract: identical shape/behavior to the
 * original sitemap→shallow-crawl-only implementation.
 */
export async function discoverPages(
  domain: string,
  opts: { hybrid?: boolean; seeds?: string[]; timeBudgetMs?: number } = {},
): Promise<DiscoverResult> {
  const normDomain = normaliseDomain(domain)
  const base = `https://${normDomain}`

  // SSRF check on the domain itself before any fetch — must precede the
  // robots.txt fetch, not just the sitemap-candidate fetches, so a request
  // to a private/internal domain never reaches the network at all.
  await assertSafeHttpUrl(base)

  const robotsText = await fetchRobotsRaw(base) // single robots fetch
  return discoverPagesWithDeps(domain, opts, {
    resolveSeeds: (d, deadlineMs) => resolveSeedsReal(d, robotsText, deadlineMs),
    fetchPageLinks: (u) => fetchPageLinks(u, normDomain),
    fetchPageLinksRendered: (u, deadlineMs) => fetchPageLinksViaBrowser(u, normDomain, deadlineMs),
    now: () => Date.now(),
    robots: parseRobots(robotsText),
  })
}
