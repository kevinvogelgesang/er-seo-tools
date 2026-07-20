// lib/ada-audit/seo/hybrid-crawl.ts
//
// Hybrid-discovery Increment 2: pure bounded same-domain BFS link crawler.
// Fetch + clock are injected (CrawlDeps) so the BFS logic is unit-testable with
// no network. Raw HTTP only — NO headless Chrome (memory fence). Results are
// assembled in frontier order so bounded concurrency never changes the output.
//
// TWO REPRESENTATIONS per node (do NOT conflate them — this was a real bug):
//   • KEY   = normalizeCoverageUrl(url) — dedup + precedence + `sources` map key
//             + frontier bookkeeping. Coverage-normalization strips the root
//             trailing slash, strips `www.`, and pins https, so it MUST NOT be
//             the URL we fetch (that would mutate the request target).
//   • FETCH = the resolved real URL (seed's original url, or normalizeLinkTarget
//             output for a link) — what deps.fetchPageLinks receives AND what
//             lands in `urls` (→ discoveredUrls → the audited AdaAudit.url set,
//             matching the existing sitemap path which stores real URLs).
// `sources` keys are coverage-normalized; each corresponds 1:1 to a `urls`
// entry via normalizeCoverageUrl (they are not always string-equal — e.g. a
// root seed's url `https://x.com/` has key `https://x.com`).
import { normalizeLinkTarget, sameDomain } from '../link-harvest'
import { normalizeCoverageUrl, NON_PAGE_EXT } from './discovery-coverage'
import { isAllowed, type RobotsRules } from '@/lib/seo-fetch/robots-match'

export type CrawlSource = 'sitemap' | 'seed' | 'shallow' | 'linked' | 'rendered' | 'rendered-linked'
export interface FetchedPage { links: string[]; finalUrl: string }
export interface CrawlDeps { fetchPageLinks(url: string): Promise<FetchedPage | null>; now(): number }
export interface CrawlBounds {
  maxDepth: number; maxAdded: number; maxFetches: number; timeBudgetMs: number; hardCap: number
  maxQueryVariantsPerPath: number; maxPathSegments: number; concurrency: number
}
export interface CrawlSeed { url: string; source: 'sitemap' | 'seed' | 'shallow' | 'rendered' }
export interface HybridCrawlOpts {
  knownKeys?: Set<string>             // coverage-normalized keys already known (raw pass) — dedup only, never fetched
  linkedSource?: CrawlSource          // source label for BFS-discovered links (default 'linked')
  prioritizeShallowFrontier?: boolean // order each depth's frontier by ascending path-segment count (novel-hub priority)
}
export interface CrawlResult {
  urls: string[]
  sources: Record<string, CrawlSource>
  sitemapCount: number
  addedByCrawl: number
  fetches: number
  stoppedBy: 'depth' | 'maxAdded' | 'maxFetches' | 'timeBudget' | 'hardCap' | 'exhausted'
}

const PRECEDENCE: Record<CrawlSource, number> = {
  sitemap: 5, seed: 4, shallow: 3, rendered: 2, linked: 1, 'rendered-linked': 0,
}

function isNonPage(normalized: string): boolean {
  try { return NON_PAGE_EXT.test(new URL(normalized).pathname) } catch { return false }
}
function pathKey(normalized: string): string {
  try { return new URL(normalized).pathname } catch { return normalized }
}
function segmentCount(normalized: string): number {
  try { return new URL(normalized).pathname.split('/').filter(Boolean).length } catch { return 0 }
}

/** The BFS link-admission filter, shared with the L2 probe so probe admission
 *  == crawl admission (Codex F3). `resolved` is the real (fetchable) URL. */
export function admissibleLink(resolved: string, host: string, robots: RobotsRules, maxPathSegments: number): boolean {
  const key = normalizeCoverageUrl(resolved)
  let h: string
  try { h = new URL(key).hostname.toLowerCase() } catch { return false }
  if (!sameDomain(h, host)) return false
  if (isNonPage(key)) return false
  if (segmentCount(key) > maxPathSegments) return false
  let pn: string
  try { pn = new URL(resolved).pathname } catch { return false } // robots matches the REAL path
  return isAllowed(pn, robots)
}

export async function hybridCrawl(
  seeds: CrawlSeed[], auditedHost: string, bounds: CrawlBounds, deps: CrawlDeps, robots: RobotsRules,
  opts: HybridCrawlOpts = {},
): Promise<CrawlResult> {
  const start = deps.now()
  const host = auditedHost.toLowerCase()
  const linkedSource: CrawlSource = opts.linkedSource ?? 'linked'
  const known = opts.knownKeys
  const sources: Record<string, CrawlSource> = {}
  const order: string[] = []            // coverage-normalized KEYS in frontier order
  const fetchUrlOf = new Map<string, string>()  // key → resolved FETCH url (real url to request / emit)
  const depthOf = new Map<string, number>()
  const queryVariants = new Map<string, number>()
  let addedByCrawl = 0
  let fetches = 0
  let sitemapCount = 0
  let stoppedBy: CrawlResult['stoppedBy'] = 'exhausted'

  // `key` is coverage-normalized (dedup/sources); `fetchUrl` is the resolved
  // real URL to fetch and to emit in `urls`.
  const accept = (key: string, fetchUrl: string, source: CrawlSource, depth: number): boolean => {
    const existing = sources[key]
    if (existing !== undefined) {
      if (PRECEDENCE[source] > PRECEDENCE[existing]) sources[key] = source // upgrade only
      return false
    }
    sources[key] = source
    order.push(key)
    fetchUrlOf.set(key, fetchUrl)
    depthOf.set(key, depth)
    if (source === 'linked' || source === 'rendered-linked') addedByCrawl++
    else sitemapCount++
    return true
  }

  // Seed the frontier (seeds bypass robots + traps — publisher intent).
  // Codex #3: stop accepting seeds at hardCap so `urls`, `sources`, and the
  // sitemap baseline all stay aligned (never more sources than sliced urls).
  for (const s of seeds) {
    if (order.length >= bounds.hardCap) { stoppedBy = 'hardCap'; break }
    const key = normalizeCoverageUrl(s.url)
    let ok = false
    try { ok = sameDomain(new URL(key).hostname.toLowerCase(), host) } catch { ok = false }
    if (ok) accept(key, s.url, s.source, 0)  // fetchUrl = the seed's ORIGINAL url (not coverage-normalized)
  }

  // Frontier = accepted URLs at the current depth not yet fetched.
  let depth = 0
  outer: while (depth < bounds.maxDepth) {
    let frontier = order.filter((u) => depthOf.get(u) === depth)
    if (frontier.length === 0) break
    if (opts.prioritizeShallowFrontier) {
      // Novel-hub priority (Codex F2): under a fetch cap, fetch shallower hubs
      // first. Stable — ties break on insertion order.
      const idx = new Map(order.map((u, i) => [u, i] as const))
      frontier = [...frontier].sort((a, b) => (segmentCount(a) - segmentCount(b)) || (idx.get(a)! - idx.get(b)!))
    }
    for (let i = 0; i < frontier.length; i += bounds.concurrency) {
      if (deps.now() - start >= bounds.timeBudgetMs) { stoppedBy = 'timeBudget'; break outer }
      if (fetches >= bounds.maxFetches) { stoppedBy = 'maxFetches'; break outer }
      // Codex #2: slice the wave so fetches never exceeds maxFetches.
      const room = Math.min(bounds.concurrency, bounds.maxFetches - fetches)
      const wave = frontier.slice(i, i + room)
      fetches += wave.length
      if (fetches >= bounds.maxFetches && i + room < frontier.length) stoppedBy = 'maxFetches'
      const pages = await Promise.all(wave.map((k) => deps.fetchPageLinks(fetchUrlOf.get(k)!)))  // fetch the REAL url, not the key
      for (const page of pages) {                       // assemble in wave (=frontier) order
        if (!page) continue
        let finalOk = false
        try { finalOk = sameDomain(new URL(page.finalUrl).hostname.toLowerCase(), host) } catch { finalOk = false }
        if (!finalOk) continue                          // Codex #7: off-host final URL contributes nothing
        for (const raw of page.links) {
          const resolved = normalizeLinkTarget(raw, page.finalUrl)  // Codex #8: resolve vs final URL (the FETCH url)
          if (!resolved) continue
          const key = normalizeCoverageUrl(resolved)                // dedup/sources KEY
          if (known?.has(key)) continue                             // L2: dedup-not-fetched (raw pass already has it)
          // admissibleLink centralizes same-domain + non-page + segment + robots
          // (robots matches the REAL resolved path, which normalizeCoverageUrl's
          // trailing-slash stripping would otherwise mask — see admissibleLink).
          if (!admissibleLink(resolved, host, robots, bounds.maxPathSegments)) continue
          const pk = pathKey(key)
          const seenVariants = queryVariants.get(pk) ?? 0
          if (seenVariants >= bounds.maxQueryVariantsPerPath) continue
          if (sources[key] !== undefined) continue      // already known
          if (addedByCrawl >= bounds.maxAdded) { stoppedBy = 'maxAdded'; break outer }
          if (order.length >= bounds.hardCap) { stoppedBy = 'hardCap'; break outer }
          queryVariants.set(pk, seenVariants + 1)
          accept(key, resolved, linkedSource, depth + 1) // fetchUrl = the resolved real url
        }
      }
    }
    depth++
  }
  if (depth >= bounds.maxDepth && stoppedBy === 'exhausted') {
    // reached the depth ceiling with frontier possibly remaining
    const deeper = order.some((u) => (depthOf.get(u) ?? 0) === bounds.maxDepth)
    if (deeper) stoppedBy = 'depth'
  }

  // Emit the REAL fetch urls (keys map 1:1 to fetchUrls), sliced to hardCap.
  const urls = order.slice(0, bounds.hardCap).map((k) => fetchUrlOf.get(k)!)
  return { urls, sources, sitemapCount, addedByCrawl, fetches, stoppedBy }
}

/** Union raw + rendered discovery by coverage-normalized key. Raw runs first and
 *  keeps its fetch URL on a key collision; the source LABEL upgrades to the
 *  higher-precedence value. Sliced to hardCap by the same normalized-key op used
 *  for discoveredUrls, so `sources` and `urls` stay 1:1 (Codex F2/F5). */
export function mergeCrawlResults(
  raw: CrawlResult, rendered: CrawlResult, hardCap: number,
): { urls: string[]; sources: Record<string, CrawlSource> } {
  const sources: Record<string, CrawlSource> = { ...raw.sources }
  const fetchUrlByKey = new Map<string, string>()
  const order: string[] = []
  for (const u of raw.urls) {
    const k = normalizeCoverageUrl(u)
    if (!fetchUrlByKey.has(k)) { fetchUrlByKey.set(k, u); order.push(k) }
  }
  for (const u of rendered.urls) {
    const key = normalizeCoverageUrl(u)
    const cand = rendered.sources[key] ?? 'rendered-linked'
    if (!fetchUrlByKey.has(key)) {
      sources[key] = cand; fetchUrlByKey.set(key, u); order.push(key)
    } else if (PRECEDENCE[cand] > PRECEDENCE[sources[key]]) {
      sources[key] = cand // upgrade label only; keep raw's fetch URL
    }
  }
  const slicedKeys = order.slice(0, hardCap)
  const keep = new Set(slicedKeys)
  for (const k of Object.keys(sources)) if (!keep.has(k)) delete sources[k]
  return { urls: slicedKeys.map((k) => fetchUrlByKey.get(k)!), sources }
}
