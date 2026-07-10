// lib/jobs/handlers/broken-link-verify.ts
//
// Out-of-band broken-link/resource verifier (C6 Phase 1). Enqueued AFTER a
// SiteAudit reaches terminal 'complete' (see finalizeSiteAudit) — that
// post-terminal invariant is what makes reusing the site-audit:<id> group
// safe: finalizeSiteAudit early-returns on 'complete', so a pending verifier
// can never trip liveness recovery (which only resumes/fails NON-terminal
// parents). report-render avoids this group on purpose; the verifier wants the
// audit family for cancel-on-delete and is only allowed in because it runs
// post-terminal.
//
// Idempotent: re-reads HarvestedLink, the writer's delete-and-recreate on
// { siteAuditId, tool:'seo-parser' } replaces any prior run, and harvest rows
// are deleted only AFTER the run is written (crash-before-write -> rows linger
// -> retry redoes it; crash-after-write-before-delete -> rows linger -> the
// retention sweep cleans them and a retry's writeFindingsRun is a no-op replace).
import { prisma } from '@/lib/db'
import { writeFindingsRun } from '@/lib/findings/writer'
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'
import { mapBrokenLinkFindings, type BrokenTarget } from '@/lib/findings/broken-link-mapper'
import { mapOnPageSeoFindings, type OnPageSeoRow } from '@/lib/findings/onpage-seo-mapper'
import type { CrawlPageInput, FindingInput, FindingsBundle } from '@/lib/findings/types'
import { randomUUID } from 'crypto'
import { HostThrottle } from '@/lib/ada-audit/broken-link-check'
import { resolveUrl, resolveExternalHead, realResolveDeps, type ResolveResult } from '@/lib/ada-audit/url-resolver'
import { mapValidationFindings, type ValidationSeoRow, type ValidationLink } from '@/lib/findings/validation-mapper'
import { normalizeLinkTarget, sameDomain } from '@/lib/ada-audit/link-harvest'
import { parsePositiveInt, parseNonNegativeInt } from '../config'
import { scoreLiveSeo } from '@/lib/findings/live-seo-score'
import { resolveScoringWeights } from '@/lib/scoring/resolve-weights'
import { serializeBreakdownV2, type LinkVerificationSnapshot } from '@/lib/scoring/seo-core'
import { hashWeights } from '@/lib/scoring/weights-hash'
import { computeLinkGraph } from '@/lib/ada-audit/seo/link-graph'
import { computeDiscoveryCoverage, type DiscoveryMode } from '@/lib/ada-audit/seo/discovery-coverage'
import { computeContentSimilarity, type SimilarityPageInput } from '@/lib/ada-audit/seo/content-similarity'
import { aggregateSchemaTypes } from '@/lib/ada-audit/seo/schema-types'
import { registerJobHandler } from '../registry'
import { enqueueJob } from '../queue'
import { enqueueNotifyEmail } from './notify-email'
import type { JobExhaustedContext, JobHandlerContext } from '../types'

// parseUrlList is private to site-audit-discover.ts — define a local parser
// here instead of importing it.
function safeParseUrlList(json: string | null): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * Derive the sitemap-sourced baseline (+ its own capped flag) from
 * SiteAudit.discoverySourcesJson (C6 Increment 2's {v,sources,sitemapCount,
 * sitemapCapped,...} shape) for the dual miss-rate inputs to
 * computeDiscoveryCoverage. Pure and tolerant: null / malformed / missing
 * `sources` all degrade to {undefined,undefined} (legacy single-rate
 * behavior), never throwing into the builder.
 */
export function deriveSitemapBaseline(json: string | null): { baseline: string[] | undefined; sitemapCapped: boolean | undefined } {
  if (!json) return { baseline: undefined, sitemapCapped: undefined }
  try {
    const parsed = JSON.parse(json) as { sources?: Record<string, string>; sitemapCapped?: boolean }
    if (!parsed || typeof parsed.sources !== 'object' || !parsed.sources) return { baseline: undefined, sitemapCapped: undefined }
    const baseline = Object.entries(parsed.sources)
      .filter(([, src]) => src === 'sitemap' || src === 'seed' || src === 'shallow')
      .map(([url]) => url)
    return { baseline, sitemapCapped: parsed.sitemapCapped === true }
  } catch {
    return { baseline: undefined, sitemapCapped: undefined }
  }
}

export const BROKEN_LINK_VERIFY_JOB_TYPE = 'broken-link-verify'
const MAX_CHECKS = () => parsePositiveInt(process.env.BROKEN_LINK_MAX_CHECKS, 2000)
const HOST_DELAY = () => parsePositiveInt(process.env.BROKEN_LINK_HOST_DELAY_MS, 250)
const CONCURRENCY = () => parsePositiveInt(process.env.BROKEN_LINK_CONCURRENCY, 4)
const URLS_PER_FINDING = 25
const JOB_TIMEOUT_MS = 900_000 // 15-min queue ceiling (single source; used at registration + external budget)
// Reserve subtracted from BOTH the internal and external deadlines: it must cover
// in-flight-request overshoot on both passes (each stops STARTING work at its
// deadline but awaits up to CONCURRENCY in-flight resolves) PLUS all post-verify
// work (graph compute, page materialization, scoring, writeFindingsRun, deletes).
// 60s proved razor-thin in prod (2026-07-06): slow client sites (manhattanschool.edu,
// cambriacollege.ca) whose fetches hang near the 10s request timeout ran BOTH passes
// to their full budgets, and internal(9m)+external(5m)+overshoot+post-verify tipped
// just past the 15-min ceiling -> the job was killed before the write. 180s gives
// the two capped passes ~11-12m combined and a comfortable margin for the rest.
const SAFETY_RESERVE_MS = 180_000
const CONTENT_SIM_RESERVE_MS = 30_000 // skip similarity if less than this remains before the job ceiling
const EXTERNAL_MAX_CHECKS = () => parseNonNegativeInt(process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS, 300)
const EXTERNAL_TIMEOUT = () => parsePositiveInt(process.env.BROKEN_LINK_EXTERNAL_TIMEOUT_MS, 8_000)
const EXTERNAL_TIME_BUDGET = () => parsePositiveInt(process.env.BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS, 300_000)
const INTERNAL_TIME_BUDGET = () => parsePositiveInt(process.env.BROKEN_LINK_INTERNAL_TIME_BUDGET_MS, 600_000)

const unconfirmedResult = (): ResolveResult => ({
  result: 'unconfirmed', finalUrl: null, status: null, hops: 0, chain: [], tooManyRedirects: false,
})

export interface BrokenLinkVerifyJob {
  siteAuditId: string
  domain: string | null
}

export interface VerifyDeps {
  resolve: (url: string) => Promise<ResolveResult>
  resolveExternal: (url: string, timeoutMs: number) => Promise<ResolveResult>
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const productionDeps: VerifyDeps = {
  resolve: (url) => resolveUrl(url, realResolveDeps),
  resolveExternal: (url, timeoutMs) => resolveExternalHead(url, realResolveDeps, timeoutMs),
  now: realResolveDeps.now,
  sleep: realResolveDeps.sleep,
}

function assertPayload(p: unknown): BrokenLinkVerifyJob {
  const j = p as Partial<BrokenLinkVerifyJob> | null
  if (!j || typeof j.siteAuditId !== 'string') throw new Error('Invalid broken-link-verify payload')
  return { siteAuditId: j.siteAuditId, domain: typeof j.domain === 'string' ? j.domain : null }
}

export async function runBrokenLinkVerify(
  payload: unknown,
  deps: VerifyDeps = productionDeps,
  ctx?: JobHandlerContext,
): Promise<void> {
  const job = assertPayload(payload)
  const jobStartedAt = deps.now()
  const site = await prisma.siteAudit.findUnique({
    where: { id: job.siteAuditId },
    select: {
      id: true, domain: true, clientId: true, pagesTotal: true, pagesError: true, seoIntent: true,
      discoveredUrls: true, discoveryMode: true, discoveryCapped: true, discoverySourcesJson: true,
      notifyEmail: true, notifyCompleteSentAt: true,
    },
  })
  if (!site) return // deleted audit -> no-op

  const rows = await prisma.harvestedLink.findMany({
    where: { siteAuditId: job.siteAuditId, kind: { in: ['internal-link', 'image'] } },
    // Deterministic order so the cap below selects a STABLE subset across retries.
    orderBy: [{ targetUrl: 'asc' }, { kind: 'asc' }, { sourcePageUrl: 'asc' }],
    select: { targetUrl: true, kind: true, sourcePageUrl: true, harvestTruncated: true },
  })
  const harvestTruncated = rows.some((r) => r.harvestTruncated)

  // Dedupe to unique (targetUrl, kind); collect a source-page sample per target.
  const startedAt = new Date(deps.now())
  const byTarget = new Map<string, { kind: 'internal-link' | 'image'; sources: Set<string> }>()
  for (const r of rows) {
    const key = `${r.kind} ${r.targetUrl}`
    let e = byTarget.get(key)
    if (!e) {
      e = { kind: r.kind as 'internal-link' | 'image', sources: new Set() }
      byTarget.set(key, e)
    }
    if (e.sources.size < URLS_PER_FINDING) e.sources.add(normalizeFindingUrl(r.sourcePageUrl))
  }
  const unique = [...byTarget.entries()].map(([key, v]) => ({
    targetUrl: key.slice(key.indexOf(' ') + 1),
    ...v,
  }))

  const cap = MAX_CHECKS()
  const capped = unique.length > cap
  if (capped) console.warn(`[broken-link-verify] ${job.siteAuditId}: capping ${unique.length} -> ${cap} checks`)
  const toCheck = capped ? unique.slice(0, cap) : unique

  // Bounded concurrency: CONCURRENCY workers pull unique targets from a shared
  // cursor and resolve each ONCE into the shared `cache` map, respecting the
  // shared per-host throttle. Single-threaded JS makes the shared
  // cursor/cache mutations safe between awaits. broken/checked/unconfirmed
  // are derived from `cache` afterward, not mutated by the workers directly.
  const throttle = new HostThrottle(HOST_DELAY(), deps)

  // Load on-page SEO rows for the same audit. MOVED ABOVE the resolution-set
  // construction — validationRows (canonical/hreflang) derives from these.
  const seoRows = await prisma.harvestedPageSeo.findMany({
    where: { siteAuditId: job.siteAuditId },
    select: {
      url: true, statusCode: true, isHtml: true, robotsNoindex: true, xRobotsNoindex: true,
      loginLike: true, title: true, h1: true, metaDescription: true, wordCount: true, schemaCount: true,
      canonicalUrl: true, detailsJson: true, contentText: true, contentTruncated: true,
    },
  })

  const auditedHost = (site.domain ?? job.domain ?? '').toLowerCase()
  const isSameHost = (url: string): boolean => {
    try { return sameDomain(new URL(url).hostname.toLowerCase(), auditedHost) } catch { return false }
  }

  // Parse hreflang pairs (tolerate legacy string[] shape) + collect validation inputs.
  const parseHreflang = (json: string | null): { lang: string; href: string }[] => {
    if (!json) return []
    try {
      const d = JSON.parse(json) as { hreflang?: unknown }
      const h = d.hreflang
      if (!Array.isArray(h)) return []
      return h.map((e) => (e && typeof e === 'object' && 'href' in (e as object))
        ? { lang: String((e as { lang?: unknown }).lang ?? ''), href: String((e as { href?: unknown }).href ?? '') }
        : { lang: String(e), href: '' }) // legacy code-only: no href → no target/reciprocity finding
        .filter((e) => e.lang)
    } catch { return [] }
  }
  const validationRows: ValidationSeoRow[] = seoRows.map((r) => ({
    url: r.url, canonicalUrl: r.canonicalUrl ?? null, hreflang: parseHreflang(r.detailsJson),
  }))
  const internalLinks: ValidationLink[] = rows
    .filter((r) => r.kind === 'internal-link')
    .map((r) => ({ sourcePageUrl: r.sourcePageUrl, targetUrl: r.targetUrl }))

  // Resolution set: legacy link/image targets FIRST (existing deterministic order
  // preserved + already capped), then canonical/hreflang-only same-domain targets
  // not already present. The cap applies AFTER ordering (legacy consumes it first).
  const legacyTargets = toCheck.map((t) => t.targetUrl)
  const legacySet = new Set(legacyTargets.map((u) => normalizeFindingUrl(u)))
  const validationTargets: string[] = []
  const validationSeen = new Set<string>()
  const addValidationTarget = (raw: string, base: string) => {
    const abs = normalizeLinkTarget(raw, base); if (!abs || !isSameHost(abs)) return
    const norm = normalizeFindingUrl(abs)
    if (legacySet.has(norm) || validationSeen.has(norm)) return
    validationSeen.add(norm); validationTargets.push(abs)
  }
  for (const r of validationRows) {
    if (r.canonicalUrl) addValidationTarget(r.canonicalUrl, r.url)
    for (const h of r.hreflang) if (h.href) addValidationTarget(h.href, r.url)
  }
  validationTargets.sort()
  const remaining = Math.max(0, cap - legacyTargets.length)
  const cappedValidation = validationTargets.length > remaining
  const validationToResolve = cappedValidation ? validationTargets.slice(0, remaining) : validationTargets

  // Resolve legacy + validation targets ONCE into a shared cache (reuses throttle).
  const cache = new Map<string, ResolveResult>()
  const allToResolve = [...legacyTargets, ...validationToResolve]
  // Internal time budget (mirrors the external pass): clamp to reserve the external
  // budget (only when external is enabled) + the post-verification reserve, so the
  // run is written instead of the job dying at JOB_TIMEOUT_MS before writeFindingsRun.
  const externalReserveMs = EXTERNAL_MAX_CHECKS() > 0 ? EXTERNAL_TIME_BUDGET() : 0
  const internalDeadlineMs = Math.max(
    0,
    Math.min(INTERNAL_TIME_BUDGET(), JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - externalReserveMs - SAFETY_RESERVE_MS),
  )
  let internalBudgetHit = false
  const internalStartedAt = deps.now()
  let cursor2 = 0
  // Best-effort; never throws into the resolution loop.
  const report = (progress: number | null, message: string | null) => {
    try { ctx?.reportProgress(progress, message) } catch { /* ignore */ }
  }
  const totalToResolve = allToResolve.length
  let resolvedCount = 0
  const reportResolveProgress = () => {
    const pct = totalToResolve ? Math.floor((resolvedCount / totalToResolve) * 90) : 0
    report(pct, `Checked ${resolvedCount}/${totalToResolve} links`)
  }
  const cacheWorker = async (): Promise<void> => {
    while (cursor2 < allToResolve.length) {
      if (deps.now() - internalStartedAt >= internalDeadlineMs) { internalBudgetHit = true; return }
      const url = allToResolve[cursor2++]
      let host = ''
      try {
        host = new URL(url).hostname
      } catch {
        cache.set(normalizeFindingUrl(url), unconfirmedResult())
        resolvedCount++; reportResolveProgress()
        continue
      }
      // Failure isolation (mirrors the external worker): a throw in throttle.wait or
      // deps.resolve degrades THIS target to unconfirmed, never rejecting the pool.
      try {
        await throttle.wait(host)
        cache.set(normalizeFindingUrl(url), await deps.resolve(url))
      } catch {
        cache.set(normalizeFindingUrl(url), unconfirmedResult())
      }
      resolvedCount++; reportResolveProgress()
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY(), allToResolve.length || 1) }, () => cacheWorker()))

  // Derive broken targets from the cache for mapBrokenLinkFindings (mapper unchanged).
  // C19 PR2 Task 4: ALSO derive the broken-links score factor's snapshot here, by
  // target kind. Unlike `checked`/`unconfirmed` above (which count any cache hit,
  // including unconfirmed, for confidence reporting), the score snapshot's
  // <kind>Checked/<kind>Broken counters EXCLUDE unconfirmed outcomes entirely —
  // they must never appear in either the numerator or the denominator.
  let checked = 0
  let unconfirmed = 0
  const broken: BrokenTarget[] = []
  let internalChecked = 0
  let internalBroken = 0
  let imagesChecked = 0
  let imagesBroken = 0
  for (const t of toCheck) {
    const r = cache.get(normalizeFindingUrl(t.targetUrl))
    if (!r) continue // budget-stranded target -> neither counter, either pass
    checked++
    if (r.result === 'broken') {
      broken.push({ targetUrl: t.targetUrl, kind: t.kind, sourcePageUrls: [...t.sources] })
      if (t.kind === 'internal-link') { internalChecked++; internalBroken++ }
      else { imagesChecked++; imagesBroken++ }
    } else if (r.result === 'unconfirmed') {
      unconfirmed++ // excluded from the score snapshot entirely
    } else {
      if (t.kind === 'internal-link') internalChecked++
      else imagesChecked++
    }
  }
  // passComplete is factor-specific (Codex plan-fix #2): cappedValidation is
  // EXCLUDED (canonical/hreflang validation is unrelated to broken-links scoring),
  // and internalBudgetHit matters only insofar as it left a toCheck target
  // unresolved — checked directly rather than inferred from the flag, since a
  // budget trip while draining validation-only targets (which come after all
  // legacy targets in resolution order) can still leave every toCheck target resolved.
  const linkVerificationPassComplete =
    !capped && !harvestTruncated && toCheck.every((t) => cache.has(normalizeFindingUrl(t.targetUrl)))
  const linkVerification: LinkVerificationSnapshot = {
    internalChecked, internalBroken, imagesChecked, imagesBroken,
    passComplete: linkVerificationPassComplete,
  }

  // ---- External-link verification (HEAD-only; separate cap + remaining-time soft budget) ----
  const EXTERNAL_MAX = EXTERNAL_MAX_CHECKS()
  const externalBroken: BrokenTarget[] = []
  let externalChecked = 0
  let externalUnconfirmed = 0
  let externalCapped = false
  let externalHarvestTruncated = false
  if (EXTERNAL_MAX > 0) {
    const extRows = await prisma.harvestedLink.findMany({
      where: { siteAuditId: job.siteAuditId, kind: 'external-link' },
      orderBy: [{ targetUrl: 'asc' }, { sourcePageUrl: 'asc' }],
      select: { targetUrl: true, sourcePageUrl: true, harvestTruncated: true },
    })
    externalHarvestTruncated = extRows.some((r) => r.harvestTruncated)
    const extByTarget = new Map<string, Set<string>>()
    for (const r of extRows) {
      let s = extByTarget.get(r.targetUrl)
      if (!s) { s = new Set<string>(); extByTarget.set(r.targetUrl, s) }
      if (s.size < URLS_PER_FINDING) s.add(normalizeFindingUrl(r.sourcePageUrl))
    }
    const extUnique = [...extByTarget.entries()].map(([targetUrl, sources]) => ({ targetUrl, sources }))
    externalCapped = extUnique.length > EXTERNAL_MAX
    const extToCheck = externalCapped ? extUnique.slice(0, EXTERNAL_MAX) : extUnique

    if (extToCheck.length > 0) {
      const remaining = JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS
      const externalDeadlineMs = Math.max(0, Math.min(EXTERNAL_TIME_BUDGET(), remaining))
      if (externalDeadlineMs <= 0) {
        externalCapped = true // no time left; skip the pass, run stays partial
      } else {
        const timeout = EXTERNAL_TIMEOUT()
        const externalStartedAt = deps.now()
        const extCache = new Map<string, ResolveResult>()
        // Spec §3.3: hold the bar at ~90 and relabel while the external pass runs
        // (it has no per-target counter; can run up to the external time budget).
        report(90, 'Checking external links…')
        let extCursor = 0
        const extWorker = async (): Promise<void> => {
          while (extCursor < extToCheck.length) {
            if (deps.now() - externalStartedAt >= externalDeadlineMs) { externalCapped = true; return }
            const t = extToCheck[extCursor++]
            const norm = normalizeFindingUrl(t.targetUrl)
            let host = ''
            try { host = new URL(t.targetUrl).hostname } catch {
              extCache.set(norm, unconfirmedResult()); continue
            }
            // Failure isolation (Codex plan-#5): wrap BOTH throttle.wait and resolveExternal
            // so a throw anywhere degrades this one target to unconfirmed, never rejecting the pool.
            try {
              await throttle.wait(host)
              extCache.set(norm, await deps.resolveExternal(t.targetUrl, timeout))
            } catch {
              extCache.set(norm, unconfirmedResult())
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY(), extToCheck.length) }, () => extWorker()))
        for (const t of extToCheck) {
          const r = extCache.get(normalizeFindingUrl(t.targetUrl))
          if (!r) continue // never launched (budget tripped) -> uncounted; externalCapped already set
          externalChecked++
          if (r.result === 'broken') externalBroken.push({ targetUrl: t.targetUrl, kind: 'external-link', sourcePageUrls: [...t.sources] })
          else if (r.result === 'unconfirmed') externalUnconfirmed++
        }
      }
    }
  }

  // Hoisted above the graph block: also feeds indexableUrls below, and
  // ensurePage()'s per-row `indexable` scalar further down.
  const indexableOf = (r: typeof seoRows[number]) =>
    r.statusCode != null && r.statusCode >= 200 && r.statusCode < 300 &&
    r.isHtml && !r.robotsNoindex && !r.xRobotsNoindex

  // roadmap 3b: reachability over the FULL discovered graph (not just audited).
  // Best-effort: a failure logs and falls back to null aggregates + null summary.
  const discoveredNodes = safeParseUrlList(site.discoveredUrls)
  // Seed audited seoRow urls FIRST so first-seen-original keying prefers r.url,
  // keeping graph.byUrl.get(r.url) reliable, and so an audited page with no
  // discovered-URL match and no edges still gets a graph row (Codex #6/#7).
  const graphNodes = [...seoRows.map((r) => r.url), ...discoveredNodes]
  const indexableUrls = new Set(
    seoRows.filter((r) => indexableOf(r) && !r.loginLike).map((r) => r.url),
  )
  const domain = site.domain ?? job.domain
  const homepageUrl = domain ? normalizeFindingUrl(`https://${domain}/`) : null // null-domain guard (Codex #5)
  let graph: ReturnType<typeof computeLinkGraph> | null = null
  try {
    graph = computeLinkGraph(
      rows.map((r) => ({ sourcePageUrl: r.sourcePageUrl, targetUrl: r.targetUrl, kind: r.kind })),
      graphNodes,
      homepageUrl,
      indexableUrls,
    )
  } catch (e) {
    console.error('[live-seo] graph compute failed', e)
  }

  // Builder owns the single runId + the shared normalized-URL -> CrawlPage map.
  const runId = randomUUID()
  const pages: CrawlPageInput[] = []
  const pageByUrl = new Map<string, CrawlPageInput>()
  const ensurePage = (url: string, scalars?: Partial<CrawlPageInput>): CrawlPageInput => {
    const u = normalizeFindingUrl(url)
    let p = pageByUrl.get(u)
    if (!p) {
      p = { id: randomUUID(), runId, url: u, status: null, error: null, finalUrl: null,
        statusCode: null, title: null, h1: null, metaDescription: null, wordCount: null,
        crawlDepth: null, inlinks: null, outlinks: null,
        indexable: null, score: null, passCount: null, incompleteCount: null, adaAuditId: null }
      pages.push(p); pageByUrl.set(u, p)
    }
    if (scalars) for (const [k, v] of Object.entries(scalars)) if (v != null) (p as unknown as Record<string, unknown>)[k] = v
    return p
  }

  // Materialize a CrawlPage for EVERY harvested on-page row, scalars populated.
  for (const r of seoRows) {
    // Look up graph results with the RAW r.url string (byUrl is keyed by the
    // original graphNodes strings, and seoRow urls are seeded first).
    const g = graph?.byUrl.get(r.url)
    ensurePage(r.url, {
      statusCode: r.statusCode, title: r.title, h1: r.h1, metaDescription: r.metaDescription,
      wordCount: r.wordCount, indexable: indexableOf(r) && !r.loginLike,
      inlinks: g?.inlinks ?? null,
      outlinks: g?.outlinks ?? null,
      crawlDepth: g?.crawlDepth ?? null,
    })
  }

  // On-page has no per-page cap in MVP, so its completeness is independent of the
  // LINK truncation flag (Codex fix #2) — always pass false here.
  report(95, 'Building SEO report…')
  const onPageFindings = mapOnPageSeoFindings(seoRows as OnPageSeoRow[], { runId, ensurePage, harvestTruncated: false })
  const brokenFindings = mapBrokenLinkFindings(broken, {
    runId, ensurePage, affectedComplete: !capped && !harvestTruncated && !internalBudgetHit,
    confidence: { checked, broken: broken.length, unconfirmed, capped: capped || internalBudgetHit, harvestTruncated },
  })
  const externalFindings = mapBrokenLinkFindings(externalBroken, {
    runId, ensurePage, affectedComplete: !externalCapped && !externalHarvestTruncated,
    confidence: { checked: externalChecked, broken: externalBroken.length, unconfirmed: externalUnconfirmed, capped: externalCapped, harvestTruncated: externalHarvestTruncated },
    severity: 'warning',
  })
  const validationFindings = mapValidationFindings(validationRows, internalLinks, cache, {
    runId, ensurePage, auditedHost, affectedComplete: !capped && !cappedValidation && !internalBudgetHit,
  })
  const findings: FindingInput[] = [...onPageFindings, ...brokenFindings, ...externalFindings, ...validationFindings]

  // C6 Phase 3: live SEO score from the on-page signals (pure scorer).
  const runCounts = new Map(
    onPageFindings.filter((f) => f.scope === 'run').map((f) => [f.type, f.count] as const),
  )
  const weights = await resolveScoringWeights()
  const scoreResult = scoreLiveSeo({
    attempted: site.pagesTotal,
    observed: seoRows.length,
    indexableScored: seoRows.filter((r) => indexableOf(r) && !r.loginLike).length,
    pagesError: site.pagesError,
    missingTitle: runCounts.get('missing_title') ?? 0,
    missingMeta: runCounts.get('missing_meta_description') ?? 0,
    missingH1: runCounts.get('missing_h1') ?? 0,
    thin: runCounts.get('thin_content') ?? 0,
    pagesWithSchema: seoRows.filter((r) => (r.schemaCount ?? 0) > 0).length,
    linkVerification,
  }, weights)

  // C6 hybrid-discovery Increment 1: sitemap miss-rate from already-harvested
  // internal links vs the discovery baseline. ZERO new fetches. NOT a Finding.
  const discoveredUrls = safeParseUrlList(site.discoveredUrls)
  const { baseline: sitemapBaseline, sitemapCapped } = deriveSitemapBaseline(site.discoverySourcesJson)
  const coverage = computeDiscoveryCoverage({
    discoveredUrls,
    internalLinks: rows
      .filter((r) => r.kind === 'internal-link')
      .map((r) => ({ sourcePageUrl: r.sourcePageUrl, targetUrl: r.targetUrl })),
    discoveryMode: (site.discoveryMode as DiscoveryMode | null) ?? null,
    discoveryCapped: site.discoveryCapped ?? false,
    sitemapBaseline,
    sitemapCapped,
  })

  // C14: JSON-LD @type histogram across harvested pages. Fail-to-null — never
  // fails the live-scan write.
  let schemaTypesJson: string | null = null
  try {
    schemaTypesJson = JSON.stringify(aggregateSchemaTypes(seoRows))
  } catch (e) {
    console.error('[live-seo] schema-type aggregation failed', e)
  }

  // C6 Phase 5: content similarity. Best-effort + time-budget-guarded — a similarity
  // failure or overrun must NEVER fail the live-scan write (mirrors the graph fail-to-null).
  let contentSimilarityJson: string | null = null
  const simRemaining = JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS
  if (simRemaining >= CONTENT_SIM_RESERVE_MS) {
    try {
      const simInputs: SimilarityPageInput[] = seoRows
        .filter((r) => indexableOf(r) && !r.loginLike)
        .map((r) => ({ url: r.url, contentText: r.contentText, contentTruncated: r.contentTruncated }))
      const sim = computeContentSimilarity(simInputs)
      if (sim) contentSimilarityJson = JSON.stringify({ v: 1, ...sim })
    } catch (e) {
      console.error('[live-seo] content similarity failed', e)
    }
  }

  const bundle: FindingsBundle = {
    run: {
      id: runId, tool: 'seo-parser', source: 'live-scan', domain: site.domain ?? job.domain,
      clientId: site.clientId, sessionId: null, siteAuditId: site.id, adaAuditId: null,
      status: capped || harvestTruncated || cappedValidation || externalCapped || externalHarvestTruncated || internalBudgetHit ? 'partial' : 'complete',
      score: scoreResult.score,
      scoreBreakdown: serializeBreakdownV2(
        'live-seo', scoreResult, hashWeights(weights), scoreResult.inputsSnapshot,
      ),
      wcagLevel: null,
      pagesTotal: pages.length, startedAt, completedAt: new Date(deps.now()),
      seoIntent: site.seoIntent,
      discoveryCoverageJson: JSON.stringify(coverage),
      reachabilityJson: graph ? JSON.stringify({ v: 1, ...graph.summary }) : null,
      contentSimilarityJson,
      schemaTypesJson,
    },
    pages, findings, violations: [],
  }
  await writeFindingsRun(bundle)
  await prisma.harvestedLink.deleteMany({ where: { siteAuditId: job.siteAuditId } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAuditId: job.siteAuditId } })
  console.log(
    `[broken-link-verify] ${job.siteAuditId}: checked ${checked}, broken ${broken.length}, unconfirmed ${unconfirmed}, external checked ${externalChecked}, external broken ${externalBroken.length}, external unconfirmed ${externalUnconfirmed}, on-page rows ${seoRows.length}, internalBudgetHit ${internalBudgetHit} (${cache.size}/${allToResolve.length} resolved)`,
  )

  // D7: notify the requester that the scan (incl. this SEO pass) finished. Awaited
  // in try/catch, NOT bare fire-and-forget: don't let the verify job settle before
  // the notify insert is attempted; the catch guarantees a notify failure never
  // fails the builder (findings-hook rule). Gate on the marker too so a retry
  // after a successful send doesn't re-enqueue a redundant notify job.
  if (site.notifyEmail && !site.notifyCompleteSentAt) {
    try { await enqueueNotifyEmail(site.id, 'complete') }
    catch (e) { console.error('[notify-email] complete enqueue failed', site.id, e) }
  }
}

/** Fire-and-forget enqueue, mirrors enqueuePsiJob. Returns the enqueue promise
 * so the recovery sweep can await it; the finalizer calls it as `void`. */
export function enqueueBrokenLinkVerify(siteAuditId: string, domain: string | null): Promise<unknown> {
  return enqueueJob({
    type: BROKEN_LINK_VERIFY_JOB_TYPE,
    payload: { siteAuditId, domain },
    dedupKey: `${BROKEN_LINK_VERIFY_JOB_TYPE}:${siteAuditId}`,
    groupKey: `site-audit:${siteAuditId}`,
  }).catch((err) => {
    console.error('[broken-link-verify] enqueue failed for', siteAuditId, ':', (err as Error).message)
  })
}

export async function onBrokenLinkVerifyExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  console.warn(`[broken-link-verify] exhausted after ${ctx.attempts} attempts: ${ctx.lastError}`)
  // D7: the parent SiteAudit is already terminal 'complete' at this point (verify
  // is enqueued post-terminal), so still send the completion email. The content
  // builder tolerates a missing SEO run. Never throw from onExhausted.
  const p = payload as { siteAuditId?: string } | null
  if (!p?.siteAuditId) return
  const row = await prisma.siteAudit
    .findUnique({ where: { id: p.siteAuditId }, select: { notifyEmail: true, notifyCompleteSentAt: true } })
    .catch(() => null)
  if (row?.notifyEmail && !row.notifyCompleteSentAt) {
    try { await enqueueNotifyEmail(p.siteAuditId, 'complete') } catch { /* never throw from onExhausted */ }
  }
}

export function registerBrokenLinkVerifyHandler(): void {
  registerJobHandler({
    type: BROKEN_LINK_VERIFY_JOB_TYPE,
    concurrency: 1, // one verifier across the box; per-URL parallelism is internal (CONCURRENCY workers)
    maxAttempts: 2,
    backoffBaseMs: 60_000,
    timeoutMs: JOB_TIMEOUT_MS, // 15 min ceiling; bounded concurrency keeps real runs well under this
    handler: (payload, ctx) => runBrokenLinkVerify(payload, undefined, ctx),
    onExhausted: onBrokenLinkVerifyExhausted,
  })
}
