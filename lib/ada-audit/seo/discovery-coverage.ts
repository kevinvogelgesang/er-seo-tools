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
}

const SAMPLE_CAP = 50
const SOURCES_PER_TARGET = 5

// Tracking params `discoverPages` strips for dedup but does NOT remove from the
// URL it returns — so a sitemap URL with ?utm_* would fail to match a clean
// harvested link without stripping them here on BOTH sides.
const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']

// Obvious non-page targets an <a href> may point at. Excluded from L so assets
// never count as "missed pages". Extension checked on the pathname only.
const NON_PAGE_EXT = /\.(pdf|zip|gz|jpe?g|png|gif|svg|webp|ico|docx?|xlsx?|pptx?|mp4|mp3|wav|css|js|mjs|json|xml|rss|txt|csv)$/i

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

function isNonPage(normalizedUrl: string): boolean {
  try {
    return NON_PAGE_EXT.test(new URL(normalizedUrl).pathname)
  } catch {
    return false
  }
}

export function computeDiscoveryCoverage(input: DiscoveryCoverageInput): DiscoveryCoverage {
  const { discoveredUrls, internalLinks, discoveryMode, discoveryCapped, sitemapBaseline, sitemapCapped } = input

  const fullBaseline = new Set(discoveredUrls.map(normalizeCoverageUrl))

  // linked set (normalized page targets, non-pages excluded) built once
  const linked = new Set<string>()
  const offSourcesFull = new Map<string, Set<string>>()
  for (const link of internalLinks) {
    const target = normalizeCoverageUrl(link.targetUrl)
    if (isNonPage(target)) continue
    linked.add(target)
    if (!fullBaseline.has(target)) {
      let s = offSourcesFull.get(target)
      if (!s) { s = new Set<string>(); offSourcesFull.set(target, s) }
      s.add(normalizeCoverageUrl(link.sourcePageUrl))
    }
  }

  const missAgainst = (base: Set<string>): number => {
    const off = new Set<string>()
    for (const t of linked) if (!base.has(t)) off.add(t)
    const denom = base.size + off.size
    return denom === 0 ? 0 : off.size / denom
  }

  const discoveredCount = fullBaseline.size
  const linkedInternalCount = linked.size
  const offBaselineCount = offSourcesFull.size

  // Legacy fields: unchanged semantics (diff vs the FULL baseline, gated on the old rule).
  const applicable = discoveryMode === 'sitemap' && discoveryCapped === false
  const missRate = applicable ? missAgainst(fullBaseline) : null

  // Hybrid dual rates.
  const hybridCapped = discoveryCapped === true
  const hasSitemapBaseline = Array.isArray(sitemapBaseline)
  const sitemapSet = hasSitemapBaseline ? new Set(sitemapBaseline!.map(normalizeCoverageUrl)) : null
  const sitemapApplicable = hasSitemapBaseline && sitemapCapped !== true
  const sitemapMissRate = sitemapApplicable ? missAgainst(sitemapSet!) : (hasSitemapBaseline ? null : missRate)
  const residualApplicable = hasSitemapBaseline && !hybridCapped
  const residualMissRate = residualApplicable ? missAgainst(fullBaseline) : null

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
  }
}
