// lib/ada-audit/seo/discovery-coverage.ts
//
// Hybrid-discovery Increment 1: pure sitemap miss-rate measurement.
// Diffs the coverage-normalized internal-link targets the ADA audit already
// harvested against the coverage-normalized discovery baseline. ZERO new
// fetches. NOT a Finding (would inflate priority.service) — the caller stores
// the result on CrawlRun.discoveryCoverageJson.
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'

export type DiscoveryMode = 'sitemap' | 'shallow-crawl' | 'pre-discovered' | 'hybrid'

export interface DiscoveryCoverageInput {
  discoveredUrls: string[]
  internalLinks: Array<{ sourcePageUrl: string; targetUrl: string }>
  discoveryMode: DiscoveryMode | null
  discoveryCapped: boolean
  sitemapBaseline?: string[] // sitemap-sourced subset of discoveredUrls; enables the intrinsic sitemapMissRate
  sitemapCapped?: boolean // the sitemap portion alone exceeded HARD_CAP (drives sitemapApplicable)
}

export interface DiscoveryCoverageSampleEntry {
  targetUrl: string
  sourcePageUrls: string[]
}

export interface DiscoveryCoverage {
  mode: DiscoveryMode | null
  capped: boolean
  applicable: boolean
  discoveredCount: number
  linkedInternalCount: number
  offBaselineCount: number
  missRate: number | null
  sample: DiscoveryCoverageSampleEntry[]
  sitemapMissRate: number | null
  sitemapApplicable: boolean
  residualMissRate: number | null
  residualApplicable: boolean
  hybridCapped: boolean
  // L1 additions — policy-filter transparency (numerator + baseline sides)
  residualMissRateRaw: number | null
  nonContentExcludedCount: number
  excludedByReason: Record<'param' | 'malformed' | 'pagination' | 'taxonomy' | 'thankyou' | 'account', number>
  excludedSampleByReason: Partial<Record<string, string[]>>
  baselineExcludedCount: number
  baselineExcludedByReason: Record<'pagination' | 'taxonomy' | 'thankyou' | 'account' | 'nonpage', number>
}

const SAMPLE_CAP = 50
const SOURCES_PER_TARGET = 5

// Tracking params `discoverPages` strips for dedup but does NOT remove from the
// URL it returns — so a sitemap URL with ?utm_* would fail to match a clean
// harvested link without stripping them here on BOTH sides.
const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']

// Obvious non-page targets an <a href> may point at. Excluded from L so assets
// never count as "missed pages". Extension checked on the pathname only.
export const NON_PAGE_EXT = /\.(pdf|zip|gz|jpe?g|png|gif|svg|webp|ico|docx?|xlsx?|pptx?|mp4|mp3|wav|css|js|mjs|json|xml|rss|txt|csv)$/i

/**
 * Coverage-specific normalizer applied identically to baseline + linked sets.
 * Builds on normalizeFindingUrl's intent (lowercase host, drop fragment) and
 * additionally strips tracking params + trailing slash on ANY path, strips a
 * leading www. host prefix, and pins the scheme to https — mirroring the
 * www-insensitive same-domain check in link-harvest.ts so a page harvested
 * as https://www.example.com/a matches a sitemap baseline entry for
 * https://example.com/a instead of being falsely counted as off-baseline.
 */
export function normalizeCoverageUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return normalizeFindingUrl(url) // non-URL passes through there too
  }
  u.hash = ''
  u.hostname = u.hostname.replace(/^www\./, '')
  u.protocol = 'https:'
  for (const p of TRACKING_PARAMS) u.searchParams.delete(p)
  if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '')
  let out = u.toString()
  if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '')
  return out
}

// Coverage-local content normalization layered ON TOP of the shared
// normalizeCoverageUrl (which stays the crawl's dedup KEY and must not change).
// Removes tracking params beyond utm_* and trims trailing whitespace so a
// tracking variant / broken-nbsp URL collapses onto its real page. L1.
const EXTRA_TRACKING_PARAMS = [
  'lead_src', 'gclid', 'gad', 'gbraid', 'wbraid', 'fbclid',
  'msclkid', 'yclid', 'mc_cid', 'mc_eid', '_ga',
]

export function contentNormalize(url: string): string {
  const base = normalizeCoverageUrl(url)
  let u: URL
  try {
    u = new URL(base)
  } catch {
    return base
  }
  for (const p of EXTRA_TRACKING_PARAMS) u.searchParams.delete(p)
  u.pathname = u.pathname.replace(/(?:%C2%A0|%20|\s)+$/i, '')
  if (u.pathname === '') u.pathname = '/'
  if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '')
  let out = u.toString()
  if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '')
  return out
}

export type ExclusionReason = 'pagination' | 'taxonomy' | 'thankyou' | 'account'

// Policy filter (L1): well-known non-content URL shapes. NOTE (honesty):
// taxonomy / pagination are NOT categorically non-content — they can be
// indexable landing pages. This is a policy choice (Kevin, 2026-07-20),
// surfaced per-reason and never claimed as "identifies indexable content".
// Precedence: pagination > taxonomy > account > thankyou.
export function classifyExclusion(normalizedUrl: string): ExclusionReason | null {
  let pathname: string
  try {
    pathname = new URL(normalizedUrl).pathname
  } catch {
    return null
  }
  if (/\/page\/\d+\/?$/.test(pathname)) return 'pagination'
  const segs = pathname.split('/').filter(Boolean)
  const first = segs[0]?.toLowerCase()
  if (first === 'category' || first === 'tag' || first === 'author') return 'taxonomy'
  if (first === 'my-account') return 'account'
  const last = (segs[segs.length - 1] ?? '').toLowerCase()
  if (/^(?:thank-you|thank_you)(?:-.*)?$/.test(last) || /-thank-you$/.test(last)) return 'thankyou'
  return null
}

function isNonPage(normalizedUrl: string): boolean {
  try {
    return NON_PAGE_EXT.test(new URL(normalizedUrl).pathname)
  } catch {
    return false
  }
}

export function computeDiscoveryCoverage(input: DiscoveryCoverageInput): DiscoveryCoverage {
  const { discoveredUrls, internalLinks, discoveryMode, discoveryCapped, sitemapBaseline, sitemapCapped } = input

  const isContent = (normalized: string) => !isNonPage(normalized) && classifyExclusion(normalized) === null
  const missAgainst = (baseSet: Set<string>, linkedSet: Set<string>): number => {
    let off = 0
    for (const t of linkedSet) if (!baseSet.has(t)) off++
    const denom = baseSet.size + off
    return denom === 0 ? 0 : off / denom
  }
  const collapseReason = (rawUrl: string): 'param' | 'malformed' => {
    try {
      const u = new URL(rawUrl)
      if (/(?:%C2%A0|%20)$/i.test(u.pathname) || /\s$/.test(decodeURIComponent(u.pathname))) return 'malformed'
    } catch { /* fall through */ }
    return 'param'
  }

  // ── RAW sets (pre-L1: shared normalizer, isNonPage only) → residualMissRateRaw ──
  const rawBaseline = new Set(discoveredUrls.map(normalizeCoverageUrl))
  const rawLinked = new Set<string>()
  for (const link of internalLinks) {
    const target = normalizeCoverageUrl(link.targetUrl)
    if (isNonPage(target)) continue
    rawLinked.add(target)
  }

  // ── FILTERED sets (contentNormalize + content-only) → the gate ──
  const fullBaseline = new Set<string>()
  for (const u of discoveredUrls) {
    const n = contentNormalize(u)
    if (isContent(n)) fullBaseline.add(n)
  }
  const linked = new Set<string>()
  const offSourcesFull = new Map<string, Set<string>>()
  for (const link of internalLinks) {
    const target = contentNormalize(link.targetUrl)
    if (!isContent(target)) continue
    linked.add(target)
    if (!fullBaseline.has(target)) {
      let s = offSourcesFull.get(target)
      if (!s) { s = new Set<string>(); offSourcesFull.set(target, s) }
      s.add(contentNormalize(link.sourcePageUrl))
    }
  }
  const sitemapSet = Array.isArray(sitemapBaseline)
    ? new Set(sitemapBaseline!.map(contentNormalize).filter(isContent)) : null

  // ── Numerator attribution: raw off-baseline URLs no longer counted as filtered misses ──
  const excludedByReason = { param: 0, malformed: 0, pagination: 0, taxonomy: 0, thankyou: 0, account: 0 }
  const excludedSampleByReason: Record<string, string[]> = {}
  const noteNum = (reason: keyof typeof excludedByReason, url: string) => {
    excludedByReason[reason]++
    const arr = excludedSampleByReason[reason] ?? (excludedSampleByReason[reason] = [])
    if (arr.length < 3) arr.push(url)
  }
  const survivors = new Set<string>()
  const rawOff = [...rawLinked].filter((t) => !rawBaseline.has(t)).sort()
  for (const t of rawOff) {
    const cn = contentNormalize(t)
    const pat = classifyExclusion(cn)
    if (pat) { noteNum(pat, t); continue }
    if (isNonPage(cn)) { noteNum('malformed', t); continue }
    if (fullBaseline.has(cn)) { noteNum(collapseReason(t), t); continue }
    if (survivors.has(cn)) { noteNum(collapseReason(t), t); continue }
    survivors.add(cn)
  }
  const nonContentExcludedCount = Object.values(excludedByReason).reduce((a, b) => a + b, 0)

  // ── Baseline attribution: distinct raw baseline URLs removed from the denominator ──
  const baselineExcludedByReason = { pagination: 0, taxonomy: 0, thankyou: 0, account: 0, nonpage: 0 }
  const baselineExcludedUrls = new Set<string>()
  for (const rb of rawBaseline) {
    const cn = contentNormalize(rb)
    const pat = classifyExclusion(cn)
    if (pat) { baselineExcludedByReason[pat]++; baselineExcludedUrls.add(rb); continue }
    if (isNonPage(cn)) { baselineExcludedByReason.nonpage++; baselineExcludedUrls.add(rb) }
  }
  const baselineExcludedCount = baselineExcludedUrls.size

  const discoveredCount = fullBaseline.size
  const linkedInternalCount = linked.size
  const offBaselineCount = offSourcesFull.size

  // Legacy fields (now filtered): diff vs the FULL filtered baseline, gated on the old rule.
  const applicable = discoveryMode === 'sitemap' && discoveryCapped === false
  const missRate = applicable ? missAgainst(fullBaseline, linked) : null

  // Hybrid dual rates (filtered) + raw residual companion.
  const hybridCapped = discoveryCapped === true
  const hasSitemapBaseline = Array.isArray(sitemapBaseline)
  const sitemapApplicable = hasSitemapBaseline && sitemapCapped !== true
  const sitemapMissRate = sitemapApplicable ? missAgainst(sitemapSet!, linked) : (hasSitemapBaseline ? null : missRate)
  const residualApplicable = hasSitemapBaseline && !hybridCapped
  const residualMissRate = residualApplicable ? missAgainst(fullBaseline, linked) : null
  const residualMissRateRaw = residualApplicable ? missAgainst(rawBaseline, rawLinked) : null

  const sample: DiscoveryCoverageSampleEntry[] = [...offSourcesFull.keys()]
    .sort()
    .slice(0, SAMPLE_CAP)
    .map((targetUrl) => ({
      targetUrl,
      sourcePageUrls: [...offSourcesFull.get(targetUrl)!].sort().slice(0, SOURCES_PER_TARGET),
    }))

  return {
    mode: discoveryMode,
    capped: discoveryCapped,
    applicable,
    discoveredCount,
    linkedInternalCount,
    offBaselineCount,
    missRate,
    sample,
    sitemapMissRate,
    sitemapApplicable,
    residualMissRate,
    residualApplicable,
    hybridCapped,
    residualMissRateRaw,
    nonContentExcludedCount,
    excludedByReason,
    excludedSampleByReason,
    baselineExcludedCount,
    baselineExcludedByReason,
  }
}
