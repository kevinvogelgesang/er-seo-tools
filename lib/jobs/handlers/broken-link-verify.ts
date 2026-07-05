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
import { serializeBreakdown } from '@/lib/scoring/weights'
import { computeLinkGraph } from '@/lib/ada-audit/seo/link-graph'
import { computeDiscoveryCoverage, type DiscoveryMode } from '@/lib/ada-audit/seo/discovery-coverage'
import { registerJobHandler } from '../registry'
import { enqueueJob } from '../queue'
import type { JobExhaustedContext } from '../types'

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
 * Pick the homepage URL from the audited URL set.
 * Returns one of the ORIGINAL `urls` strings (so the byUrl lookup key matches).
 * Strategy: prefer the normalized https://<domain>/ if it's in the audited set,
 * else pick the shallowest-path URL, else null.
 */
function pickHomepage(urls: string[], domain: string | null): string | null {
  if (!urls.length) return null
  const normalizedHome = domain ? normalizeFindingUrl(`https://${domain}/`) : null
  if (normalizedHome) {
    for (const u of urls) {
      if (normalizeFindingUrl(u) === normalizedHome) return u
    }
  }
  // Fallback: pick the URL whose pathname has the fewest path segments (shallowest)
  let best: string | null = null
  let bestDepth = Infinity
  for (const u of urls) {
    try {
      const parsed = new URL(u)
      const segments = parsed.pathname.split('/').filter(Boolean).length
      if (segments < bestDepth) {
        bestDepth = segments
        best = u
      }
    } catch {
      // skip malformed
    }
  }
  return best
}

export const BROKEN_LINK_VERIFY_JOB_TYPE = 'broken-link-verify'
const MAX_CHECKS = () => parsePositiveInt(process.env.BROKEN_LINK_MAX_CHECKS, 2000)
const HOST_DELAY = () => parsePositiveInt(process.env.BROKEN_LINK_HOST_DELAY_MS, 250)
const CONCURRENCY = () => parsePositiveInt(process.env.BROKEN_LINK_CONCURRENCY, 4)
const URLS_PER_FINDING = 25
const JOB_TIMEOUT_MS = 900_000 // 15-min queue ceiling (single source; used at registration + external budget)
const SAFETY_RESERVE_MS = 60_000 // reserve to write the run before the ceiling
const EXTERNAL_MAX_CHECKS = () => parseNonNegativeInt(process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS, 300)
const EXTERNAL_TIMEOUT = () => parsePositiveInt(process.env.BROKEN_LINK_EXTERNAL_TIMEOUT_MS, 8_000)
const EXTERNAL_TIME_BUDGET = () => parsePositiveInt(process.env.BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS, 300_000)

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

export async function runBrokenLinkVerify(payload: unknown, deps: VerifyDeps = productionDeps): Promise<void> {
  const job = assertPayload(payload)
  const jobStartedAt = deps.now()
  const site = await prisma.siteAudit.findUnique({
    where: { id: job.siteAuditId },
    select: {
      id: true, domain: true, clientId: true, pagesTotal: true, pagesError: true, seoIntent: true,
      discoveredUrls: true, discoveryMode: true, discoveryCapped: true,
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
      canonicalUrl: true, detailsJson: true,
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
  let cursor2 = 0
  const cacheWorker = async (): Promise<void> => {
    while (cursor2 < allToResolve.length) {
      const url = allToResolve[cursor2++]
      let host = ''
      try {
        host = new URL(url).hostname
      } catch {
        cache.set(normalizeFindingUrl(url), { result: 'unconfirmed', finalUrl: null, status: null, hops: 0, chain: [], tooManyRedirects: false })
        continue
      }
      await throttle.wait(host)
      cache.set(normalizeFindingUrl(url), await deps.resolve(url))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY(), allToResolve.length || 1) }, () => cacheWorker()))

  // Derive broken targets from the cache for mapBrokenLinkFindings (mapper unchanged).
  let checked = 0
  let unconfirmed = 0
  const broken: BrokenTarget[] = []
  for (const t of toCheck) {
    const r = cache.get(normalizeFindingUrl(t.targetUrl))
    if (!r) continue
    checked++
    if (r.result === 'broken') broken.push({ targetUrl: t.targetUrl, kind: t.kind, sourcePageUrls: [...t.sources] })
    else if (r.result === 'unconfirmed') unconfirmed++
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
        let extCursor = 0
        const unconfirmedResult = (): ResolveResult => ({ result: 'unconfirmed', finalUrl: null, status: null, hops: 0, chain: [], tooManyRedirects: false })
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

  // Task 3: Compute link graph INDEPENDENTLY of the `toCheck` verification cap
  // (which caps at 25 sources per target — wrong for page-level counts).
  // Best-effort: a failure logs and falls back to null aggregates so it never
  // blocks the live-scan run write.
  const auditedUrls = [...new Set(seoRows.map((r) => r.url))]
  const homepageUrl = pickHomepage(auditedUrls, site.domain ?? job.domain)
  let graph: ReturnType<typeof computeLinkGraph> | null = null
  try {
    graph = computeLinkGraph(
      rows.map((r) => ({ sourcePageUrl: r.sourcePageUrl, targetUrl: r.targetUrl, kind: r.kind })),
      auditedUrls,
      homepageUrl,
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
  const indexableOf = (r: typeof seoRows[number]) =>
    r.statusCode != null && r.statusCode >= 200 && r.statusCode < 300 &&
    r.isHtml && !r.robotsNoindex && !r.xRobotsNoindex
  for (const r of seoRows) {
    // Look up graph results with the RAW r.url string (byUrl is keyed by the
    // original auditedUrls strings, which are the seoRow urls).
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
  const onPageFindings = mapOnPageSeoFindings(seoRows as OnPageSeoRow[], { runId, ensurePage, harvestTruncated: false })
  const brokenFindings = mapBrokenLinkFindings(broken, {
    runId, ensurePage, affectedComplete: !capped && !harvestTruncated,
    confidence: { checked, broken: broken.length, unconfirmed, capped, harvestTruncated },
  })
  const externalFindings = mapBrokenLinkFindings(externalBroken, {
    runId, ensurePage, affectedComplete: !externalCapped && !externalHarvestTruncated,
    confidence: { checked: externalChecked, broken: externalBroken.length, unconfirmed: externalUnconfirmed, capped: externalCapped, harvestTruncated: externalHarvestTruncated },
    severity: 'warning',
  })
  const validationFindings = mapValidationFindings(validationRows, internalLinks, cache, {
    runId, ensurePage, auditedHost, affectedComplete: !capped && !cappedValidation,
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
  }, weights)

  // C6 hybrid-discovery Increment 1: sitemap miss-rate from already-harvested
  // internal links vs the discovery baseline. ZERO new fetches. NOT a Finding.
  const discoveredUrls = safeParseUrlList(site.discoveredUrls)
  const coverage = computeDiscoveryCoverage({
    discoveredUrls,
    internalLinks: rows
      .filter((r) => r.kind === 'internal-link')
      .map((r) => ({ sourcePageUrl: r.sourcePageUrl, targetUrl: r.targetUrl })),
    discoveryMode: (site.discoveryMode as DiscoveryMode | null) ?? null,
    discoveryCapped: site.discoveryCapped ?? false,
  })

  const bundle: FindingsBundle = {
    run: {
      id: runId, tool: 'seo-parser', source: 'live-scan', domain: site.domain ?? job.domain,
      clientId: site.clientId, sessionId: null, siteAuditId: site.id, adaAuditId: null,
      status: capped || harvestTruncated || cappedValidation || externalCapped || externalHarvestTruncated ? 'partial' : 'complete',
      score: scoreResult.score, scoreBreakdown: serializeBreakdown('live-seo', scoreResult), wcagLevel: null,
      pagesTotal: pages.length, startedAt, completedAt: new Date(deps.now()),
      seoIntent: site.seoIntent,
      discoveryCoverageJson: JSON.stringify(coverage),
    },
    pages, findings, violations: [],
  }
  await writeFindingsRun(bundle)
  await prisma.harvestedLink.deleteMany({ where: { siteAuditId: job.siteAuditId } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAuditId: job.siteAuditId } })
  console.log(
    `[broken-link-verify] ${job.siteAuditId}: checked ${checked}, broken ${broken.length}, unconfirmed ${unconfirmed}, external checked ${externalChecked}, external broken ${externalBroken.length}, external unconfirmed ${externalUnconfirmed}, on-page rows ${seoRows.length}`,
  )
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

export async function onBrokenLinkVerifyExhausted(_p: unknown, ctx: JobExhaustedContext): Promise<void> {
  console.warn(`[broken-link-verify] exhausted after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerBrokenLinkVerifyHandler(): void {
  registerJobHandler({
    type: BROKEN_LINK_VERIFY_JOB_TYPE,
    concurrency: 1, // one verifier across the box; per-URL parallelism is internal (CONCURRENCY workers)
    maxAttempts: 2,
    backoffBaseMs: 60_000,
    timeoutMs: JOB_TIMEOUT_MS, // 15 min ceiling; bounded concurrency keeps real runs well under this
    handler: (payload) => runBrokenLinkVerify(payload),
    onExhausted: onBrokenLinkVerifyExhausted,
  })
}
