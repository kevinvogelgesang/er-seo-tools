// lib/findings/validation-mapper.ts
//
// C6 Phase 4 (pure): canonical/redirect/hreflang validation findings for the
// live-scan run, derived from a pre-resolved URL cache. Broken-link findings are
// NOT produced here (see broken-link-mapper). Page-scope findings keyed by the
// declaring/source page and AGGREGATED (one per (type, page), targets in detail)
// to avoid @@unique([runId, dedupKey]) collisions.
import { randomUUID } from 'crypto'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import { normalizeLinkTarget, sameDomain } from '@/lib/ada-audit/link-harvest'
import type { ResolveResult } from '@/lib/ada-audit/url-resolver'
import type { CrawlPageInput, FindingInput } from './types'

export interface HreflangEntry { lang: string; href: string }
export interface ValidationSeoRow { url: string; canonicalUrl: string | null; hreflang: HreflangEntry[] }
// occurrences?: multiplicity when the caller passes a DEDUPED pair list (stage-A
// memory fix). Absent → 1 (a per-row list). The redirect push sites below apply
// it so page-scope counts + detail target lists stay byte-identical to feeding
// one link object per physical harvested row.
export interface ValidationLink { sourcePageUrl: string; targetUrl: string; occurrences?: number }
export interface ResolveLookup { get(normUrl: string): ResolveResult | undefined }
export interface ValidationMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
  auditedHost: string
  affectedComplete: boolean   // false when the builder capped the validation resolution set
}

const SEVERITY: Record<string, FindingInput['severity']> = {
  canonical_broken: 'warning', canonical_redirect: 'warning',
  redirect_chain: 'notice', redirect_loop: 'warning',
  hreflang_broken: 'warning', hreflang_no_return: 'warning',
  hreflang_missing_self: 'notice', hreflang_missing_x_default: 'notice', hreflang_invalid_code: 'notice',
  canonical_external_unverified: 'notice', hreflang_external_unverified: 'notice',
}
const DESC: Record<string, string> = {
  canonical_broken: 'Canonical URL resolves to a 4xx/5xx response.',
  canonical_redirect: 'Canonical URL is itself a redirect (should point at the final URL).',
  redirect_chain: 'Internal link resolves through one or more redirects.',
  redirect_loop: 'Internal link exceeds the redirect limit (loop/too many redirects).',
  hreflang_broken: 'Hreflang alternate resolves to a 4xx/5xx response.',
  hreflang_no_return: 'Hreflang alternate does not declare a return link (in audited set).',
  hreflang_missing_self: 'Hreflang cluster has no self-referencing entry.',
  hreflang_missing_x_default: 'Hreflang cluster has no x-default entry.',
  hreflang_invalid_code: 'Hreflang language/region code is malformed.',
  canonical_external_unverified: 'Cross-domain canonical targets recorded but not fetched.',
  hreflang_external_unverified: 'Cross-domain hreflang targets recorded but not fetched.',
}
const LANG_RE = /^([a-z]{2,3}(-[A-Za-z0-9]{2,8})*|x-default)$/i
const URLS_PER_FINDING = 25

export function mapValidationFindings(seoRows: ValidationSeoRow[], links: ValidationLink[], resolve: ResolveLookup, deps: ValidationMapDeps): FindingInput[] {
  const { runId, ensurePage, auditedHost, affectedComplete } = deps
  const findings: FindingInput[] = []

  // page -> type -> affected target url list (aggregation buffer). Run-scope count
  // per page-derived type = number of distinct affected pages (computed at the end).
  const pageHits = new Map<string, Map<string, string[]>>()
  const addPageHit = (page: string, type: string, targetUrl: string) => {
    const p = normalizeFindingUrl(page)
    let byType = pageHits.get(p); if (!byType) { byType = new Map(); pageHits.set(p, byType) }
    const arr = byType.get(type) ?? byType.set(type, []).get(type)!
    arr.push(targetUrl)
  }

  const isSameDomain = (host: string) => sameDomain(host, auditedHost.toLowerCase())
  const hostOf = (url: string): string | null => { try { return new URL(url).hostname.toLowerCase() } catch { return null } }

  const externalCanonical = new Set<string>()
  const externalHreflang = new Set<string>()

  // harvested set for reciprocity: normalized page urls we have hreflang for
  const harvested = new Map<string, Set<string>>() // normPageUrl -> set of normalized same-domain hreflang targets
  for (const row of seoRows) {
    const base = row.url
    const set = new Set<string>()
    for (const h of row.hreflang) {
      const abs = normalizeLinkTarget(h.href, base); if (!abs) continue
      const host = hostOf(abs); if (!host || !isSameDomain(host)) continue
      set.add(normalizeFindingUrl(abs))
    }
    harvested.set(normalizeFindingUrl(base), set)
  }

  // ---- Canonical ----
  for (const row of seoRows) {
    if (!row.canonicalUrl) continue
    const abs = normalizeLinkTarget(row.canonicalUrl, row.url); if (!abs) continue
    const host = hostOf(abs); if (!host) continue
    if (!isSameDomain(host)) { externalCanonical.add(normalizeFindingUrl(abs)); continue }
    const r = resolve.get(normalizeFindingUrl(abs)); if (!r) continue
    if (r.result === 'broken') addPageHit(row.url, 'canonical_broken', abs)
    else if (r.result === 'ok' && r.hops >= 1) addPageHit(row.url, 'canonical_redirect', abs)
  }

  // ---- Internal-link redirects ----
  for (const link of links) {
    const host = hostOf(link.targetUrl); if (!host || !isSameDomain(host)) continue
    const r = resolve.get(normalizeFindingUrl(link.targetUrl)); if (!r) continue
    // Apply occurrence multiplicity at each per-link push (stage-A memory fix):
    // a deduped pair with occurrences=N pushes N hits, exactly as N raw rows did.
    const reps = link.occurrences ?? 1
    if (r.result === 'ok' && r.hops >= 1) { for (let i = 0; i < reps; i++) addPageHit(link.sourcePageUrl, 'redirect_chain', link.targetUrl) }
    else if (r.tooManyRedirects) { for (let i = 0; i < reps; i++) addPageHit(link.sourcePageUrl, 'redirect_loop', link.targetUrl) }
    // broken (final >= 400) is handled by broken-link-mapper — NOT here (no double-count).
  }

  // ---- Hreflang ----
  for (const row of seoRows) {
    const cluster = row.hreflang
    const clusterSize = cluster.length
    let referencesSelf = false
    const selfNorm = normalizeFindingUrl(row.url)
    for (const h of cluster) {
      if (!LANG_RE.test(h.lang)) addPageHit(row.url, 'hreflang_invalid_code', h.lang)
      const abs = normalizeLinkTarget(h.href, row.url)
      if (abs && normalizeFindingUrl(abs) === selfNorm) referencesSelf = true
      if (!abs) continue
      const host = hostOf(abs); if (!host) continue
      if (!isSameDomain(host)) { externalHreflang.add(normalizeFindingUrl(abs)); continue }
      const norm = normalizeFindingUrl(abs)
      const r = resolve.get(norm)
      if (r && r.result === 'broken') addPageHit(row.url, 'hreflang_broken', abs)
      // reciprocity: only if B is in the harvested set and B has no return href to row.url
      const bSet = harvested.get(norm)
      if (bSet && !bSet.has(selfNorm)) addPageHit(row.url, 'hreflang_no_return', abs)
    }
    if (clusterSize >= 2) {
      if (!referencesSelf) addPageHit(row.url, 'hreflang_missing_self', row.url)
      if (!cluster.some((h) => h.lang.toLowerCase() === 'x-default')) addPageHit(row.url, 'hreflang_missing_x_default', row.url)
    }
  }

  // Recount run-scope for page-derived types = number of distinct affected pages.
  const pageTypeCounts = new Map<string, number>()
  for (const [, byType] of pageHits) for (const [type] of byType) pageTypeCounts.set(type, (pageTypeCounts.get(type) ?? 0) + 1)

  // Emit run-scope + page-scope findings. (affectedComplete threaded from deps.)
  for (const [type, pageCount] of pageTypeCounts) {
    findings.push({ id: randomUUID(), runId, pageId: null, scope: 'run', type, severity: SEVERITY[type] ?? 'notice',
      url: null, count: pageCount, affectedComplete, affectedSource: sourceOf(type),
      detail: JSON.stringify({ description: DESC[type] ?? type }), dedupKey: runFindingKey(type) })
  }
  for (const [page, byType] of pageHits) {
    for (const [type, targets] of byType) {
      const p = ensurePage(page)
      findings.push({ id: randomUUID(), runId, pageId: p.id, scope: 'page', type, severity: SEVERITY[type] ?? 'notice',
        url: page, count: targets.length, affectedComplete, affectedSource: sourceOf(type),
        detail: JSON.stringify({ targets: targets.slice(0, URLS_PER_FINDING) }), dedupKey: pageFindingKey(type, page) })
    }
  }
  // External-unverified run-only notices (only when >0).
  if (externalCanonical.size > 0) findings.push(runNotice(runId, 'canonical_external_unverified', externalCanonical.size))
  if (externalHreflang.size > 0) findings.push(runNotice(runId, 'hreflang_external_unverified', externalHreflang.size))
  return findings
}

function sourceOf(type: string): string {
  if (type.startsWith('canonical_')) return 'live-scan-canonical'
  if (type.startsWith('redirect_')) return 'live-scan-redirect'
  return 'live-scan-hreflang'
}
function runNotice(runId: string, type: string, count: number): FindingInput {
  return { id: randomUUID(), runId, pageId: null, scope: 'run', type, severity: SEVERITY[type] ?? 'notice',
    url: null, count, affectedComplete: true, affectedSource: sourceOf(type),
    detail: JSON.stringify({ description: DESC[type] ?? type }), dedupKey: runFindingKey(type) }
}
