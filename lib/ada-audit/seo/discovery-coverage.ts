// lib/ada-audit/seo/discovery-coverage.ts
//
// Hybrid-discovery Increment 1: pure sitemap miss-rate measurement.
// Diffs the coverage-normalized internal-link targets the ADA audit already
// harvested against the coverage-normalized discovery baseline. ZERO new
// fetches. NOT a Finding (would inflate priority.service) — the caller stores
// the result on CrawlRun.discoveryCoverageJson.
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'

export type DiscoveryMode = 'sitemap' | 'shallow-crawl' | 'pre-discovered'

export interface DiscoveryCoverageInput {
  discoveredUrls: string[]
  internalLinks: Array<{ sourcePageUrl: string; targetUrl: string }>
  discoveryMode: DiscoveryMode | null
  discoveryCapped: boolean
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
  const { discoveredUrls, internalLinks, discoveryMode, discoveryCapped } = input

  const baseline = new Set(discoveredUrls.map(normalizeCoverageUrl))

  // Map normalized off-baseline target -> sorted unique source pages.
  const linked = new Set<string>()
  const offSources = new Map<string, Set<string>>()
  for (const link of internalLinks) {
    const target = normalizeCoverageUrl(link.targetUrl)
    if (isNonPage(target)) continue
    linked.add(target)
    if (!baseline.has(target)) {
      let sources = offSources.get(target)
      if (!sources) {
        sources = new Set<string>()
        offSources.set(target, sources)
      }
      sources.add(normalizeCoverageUrl(link.sourcePageUrl))
    }
  }

  const discoveredCount = baseline.size
  const linkedInternalCount = linked.size
  const offBaselineCount = offSources.size

  const applicable = discoveryMode === 'sitemap' && discoveryCapped === false
  const denom = discoveredCount + offBaselineCount
  const missRate = applicable ? (denom === 0 ? 0 : offBaselineCount / denom) : null

  const sample: DiscoveryCoverageSampleEntry[] = [...offSources.keys()]
    .sort()
    .slice(0, SAMPLE_CAP)
    .map((targetUrl) => ({
      targetUrl,
      sourcePageUrls: [...offSources.get(targetUrl)!].sort().slice(0, SOURCES_PER_TARGET),
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
  }
}
