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
import { mapDeadPageFindings } from '@/lib/findings/dead-page-mapper'
import { mapOnPageSeoFindings, type OnPageSeoRow } from '@/lib/findings/onpage-seo-mapper'
import type { CrawlPageInput, FindingInput, FindingsBundle } from '@/lib/findings/types'
import { randomUUID } from 'crypto'
import { HostThrottle } from '@/lib/ada-audit/broken-link-check'
import { resolveUrl, resolveExternalHead, realResolveDeps, type ResolveResult } from '@/lib/ada-audit/url-resolver'
import { mapValidationFindings, type ValidationSeoRow } from '@/lib/findings/validation-mapper'
import { normalizeLinkTarget, sameDomain } from '@/lib/ada-audit/link-harvest'
import { parsePositiveInt, parseNonNegativeInt } from '../config'
import { scoreLiveSeo } from '@/lib/findings/live-seo-score'
import { resolveScoringWeights } from '@/lib/scoring/resolve-weights'
import { serializeBreakdownV2, type LinkVerificationSnapshot } from '@/lib/scoring/seo-core'
import { hashWeights } from '@/lib/scoring/weights-hash'
import { computeLinkGraph } from '@/lib/ada-audit/seo/link-graph'
import { computeDiscoveryCoverage, type DiscoveryMode } from '@/lib/ada-audit/seo/discovery-coverage'
import { computeContentSimilarity, type SimilarityPageInput } from '@/lib/ada-audit/seo/content-similarity'
import { computeContentSignals } from '@/lib/ada-audit/seo/content-signals'
import { clusterByTopicOverlap } from '@/lib/ada-audit/seo/topic-overlap'
import { embedChunked } from '@/lib/ada-audit/seo/embed-chunked'
import { embedTexts } from '@/lib/services/pillarAnalysis/embeddings'
import { aggregateSchemaTypes } from '@/lib/ada-audit/seo/schema-types'
import { aggregateProgramEntities } from '@/lib/ada-audit/seo/program-entities'
import { deriveFaqEvidence } from '@/lib/ada-audit/seo/faq-evidence'
import { registerJobHandler } from '../registry'
import { enqueueJob } from '../queue'
import { enqueueNotifyEmail } from './notify-email'
import { ensureExhaustedPlaceholder } from '@/lib/findings/exhausted-placeholder'
import type { JobExhaustedContext, JobHandlerContext } from '../types'
import { publishInvalidation } from '@/lib/events/bus'
import { siteAuditTopic, prospectListTopic, clientSummaryTopic, recentsTopic } from '@/lib/events/topics'

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
// C12 D1: retention window for HarvestedPageSeo.contentText, stamped on
// SiteAudit.contentAuditRetainUntil at the end of a successful build. Safe
// parse — a negative/NaN/Infinity env value must NOT produce a bad window.
const CONTENT_AUDIT_BASE_TTL_MS = ((): number => {
  const raw = Number(process.env.CONTENT_AUDIT_BASE_TTL_MS)
  return Number.isInteger(raw) && raw > 0 ? raw : 2 * 3600 * 1000 // 2h default
})()
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
const CONTENT_SIGNALS_RESERVE_MS = 10_000 // skip content signals if under this + the similarity reserve
const TOPIC_OVERLAP_RESERVE_MS = 45_000 // skip topic-overlap if under this + the similarity reserve
const TOPIC_OVERLAP_EMBED_CHUNK = 32    // embed in bounded chunks; yield between them
const TOPIC_OVERLAP_BODY_CHARS = 2000   // body-intro prefix (MiniLM reads ~256 tokens anyway)
const TOPIC_OVERLAP_MAX_PAGES = 1000    // backstop candidate cap (crawl is page-capped upstream)
const EXTERNAL_MAX_CHECKS = () => parseNonNegativeInt(process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS, 300)
const EXTERNAL_TIMEOUT = () => parsePositiveInt(process.env.BROKEN_LINK_EXTERNAL_TIMEOUT_MS, 8_000)
const EXTERNAL_TIME_BUDGET = () => parsePositiveInt(process.env.BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS, 300_000)
const INTERNAL_TIME_BUDGET = () => parsePositiveInt(process.env.BROKEN_LINK_INTERNAL_TIME_BUDGET_MS, 600_000)

// Stage-A memory fix (2026-07-16 OOM crash-loop): HarvestedLink is streamed in
// keyset-paged chunks and accumulated into compact interned structures in ONE
// pass, instead of two unbounded findMany loads + three derived full copies
// (1000 pages x 300 links measured ~2.7GB marginal RSS before this change).
const LINK_STREAM_CHUNK = 5000
// RSS ceiling checked at each link-stream chunk boundary; over it, pair
// retention is abandoned (graph/coverage/validation degrade, verification proper
// still runs). parsePositiveInt already imported from '../config'.
export const VERIFIER_RSS_GUARD_MB = () => parsePositiveInt(process.env.VERIFIER_RSS_GUARD_MB, 1600)

// Task 11b (Codex ruling): the MiniLM/ONNX embed pass inside the topic-overlap
// block measured 1.3-2.1GB marginal RSS with INTRA-CHUNK native overshoot that
// crosses even the 1600MB RSS guard (peaked 2409MB against PM2's 2400M kill
// threshold; prod baseline ~540MB) -- the RSS guard checks BETWEEN chunks, not
// during ONNX's synchronous native compute, so it cannot bound this. Ship with
// the pass OFF by default; ONNX-side bounding is a follow-up. Default OFF.
const TOPIC_OVERLAP_ENABLED = () => process.env.VERIFIER_TOPIC_OVERLAP_ENABLED === 'true'

/** Keyset-stream HarvestedLink rows in the builder's deterministic order.
 * Exported for tests. onRow must be synchronous (single pass, no retention).
 * onChunkEnd fires after each DB chunk (RSS checkpoint seam, Codex #5).
 * chunkSize is overridable for cross-boundary tests (Codex plan-fix #6). */
export async function streamHarvestedLinks(
  siteAuditId: string,
  kinds: string[],
  onRow: (r: { targetUrl: string; kind: string; sourcePageUrl: string; harvestTruncated: boolean }) => void,
  opts?: { onChunkEnd?: () => void; chunkSize?: number },
): Promise<void> {
  const size = opts?.chunkSize ?? LINK_STREAM_CHUNK
  let cursor: string | null = null
  for (;;) {
    const chunk: { id: string; targetUrl: string; kind: string; sourcePageUrl: string; harvestTruncated: boolean }[] =
      await prisma.harvestedLink.findMany({
        where: { siteAuditId, kind: { in: kinds } },
        orderBy: [{ targetUrl: 'asc' }, { kind: 'asc' }, { sourcePageUrl: 'asc' }, { id: 'asc' }],
        select: { id: true, targetUrl: true, kind: true, sourcePageUrl: true, harvestTruncated: true },
        take: size,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
    for (const r of chunk) onRow(r)
    opts?.onChunkEnd?.()
    if (chunk.length < size) return
    cursor = chunk[chunk.length - 1].id
  }
}

// Stage-B memory fix part 2 (2026-07-16): contentText is no longer selected on
// the main seoRows load — it is loaded SEPARATELY, chunked, under a total byte
// budget, so a huge site's aggregate main-content text can never balloon the
// resident seoRows array. Codex plan-fix #4: STRICT PREFIX admission in url
// order (see loadContentTextBudgeted) — never a first-fit scavenge, which
// would make the admitted set depend on page sizes instead of purely on url
// order (byte-identical reasoning to the link-stream RSS guard's honesty rule).
const CONTENT_TEXT_BUDGET = () => parsePositiveInt(process.env.CONTENT_TEXT_TOTAL_BYTE_BUDGET, 25_165_824)

/** Keyset-stream HarvestedPageSeo.contentText in url order, admitting a STRICT
 * PREFIX under CONTENT_TEXT_BUDGET(): once the running total would exceed the
 * budget, that page AND every later page (in url order) is skipped — never a
 * later small page slipping in past an earlier skip. Exported for tests. */
export async function loadContentTextBudgeted(
  siteAuditId: string,
): Promise<{ textByUrl: Map<string, string>; budgetSkippedPages: number }> {
  const textByUrl = new Map<string, string>()
  let used = 0
  let skipped = 0
  let overflowed = false
  let cursor: string | null = null
  for (;;) {
    const chunk: { id: string; url: string; contentText: string | null }[] = await prisma.harvestedPageSeo.findMany({
      where: { siteAuditId },
      orderBy: [{ url: 'asc' }, { id: 'asc' }],
      select: { id: true, url: true, contentText: true },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    for (const r of chunk) {
      if (!r.contentText) continue
      if (overflowed) { skipped++; continue }
      const bytes = Buffer.byteLength(r.contentText, 'utf8') // Codex #4: bytes, never .length
      if (used + bytes > CONTENT_TEXT_BUDGET()) { overflowed = true; skipped++; continue }
      used += bytes
      textByUrl.set(r.url, r.contentText)
    }
    if (chunk.length < 200) return { textByUrl, budgetSkippedPages: skipped }
    cursor = chunk[chunk.length - 1].id
  }
}

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
  // Stage-A memory fix (2026-07-16 OOM): live RSS reading, sampled at each
  // link-stream chunk boundary to decide whether to abandon pair retention.
  // Optional so the frozen characterization deps + existing test helpers keep
  // compiling untouched; absent → the guard is inert (never trips). Task 10
  // reuses it. productionDeps always provides the real reading.
  rssBytes?: () => number
}

const productionDeps: VerifyDeps = {
  resolve: (url) => resolveUrl(url, realResolveDeps),
  resolveExternal: (url, timeoutMs) => resolveExternalHead(url, realResolveDeps, timeoutMs),
  now: realResolveDeps.now,
  sleep: realResolveDeps.sleep,
  rssBytes: () => process.memoryUsage().rss,
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
      id: true, domain: true, clientId: true, prospectId: true, pagesTotal: true, pagesError: true, seoIntent: true,
      discoveredUrls: true, discoveryMode: true, discoveryCapped: true, discoverySourcesJson: true,
      notifyEmail: true, notifyCompleteSentAt: true,
    },
  })
  if (!site) return // deleted audit -> no-op

  // Stage-A memory fix: ONE streamed pass over internal-link + image rows,
  // accumulating compact interned structures — never the old full findMany +
  // derived copies. `cap` is read first because target admission stops at it.
  const cap = MAX_CHECKS()
  const intern = new Map<string, string>()
  const asIntern = (s: string): string => { const v = intern.get(s); if (v !== undefined) return v; intern.set(s, s); return s }
  // (1) capped dedup list — identical first-seen order to the old byTarget map.
  const byTarget = new Map<string, { kind: 'internal-link' | 'image'; sources: Set<string> }>()
  // Codex plan-fix #2: rows are (targetUrl, kind)-contiguous, so distinct groups
  // are counted by group-key TRANSITION — a `!byTarget.has(key)` probe would
  // over-count unadmitted (post-cap) targets once per ROW instead of per group.
  let prevGroupKey: string | null = null
  let uniqueCount = 0
  // (2) ONE deduped internal-pair list with occurrence counts (Codex #3). The
  // constant `kind` string ref lets the SAME array feed computeLinkGraph +
  // computeDiscoveryCoverage + mapValidationFindings directly, no per-consumer
  // map/flatMap copies (Codex plan-fix #1).
  const pairKeyToIdx = new Map<string, number>()
  const internalPairs: { sourcePageUrl: string; targetUrl: string; kind: 'internal-link'; occurrences: number }[] = []
  let harvestTruncated = false
  let linkStreamRssTripped = false

  await streamHarvestedLinks(job.siteAuditId, ['internal-link', 'image'], (r) => {
    if (r.harvestTruncated) harvestTruncated = true
    const key = `${r.kind} ${r.targetUrl}`
    if (key !== prevGroupKey) { uniqueCount++; prevGroupKey = key }
    let e = byTarget.get(key)
    if (!e && byTarget.size < cap) {
      e = { kind: r.kind as 'internal-link' | 'image', sources: new Set() }
      byTarget.set(key, e)
    }
    if (e && e.sources.size < URLS_PER_FINDING) e.sources.add(normalizeFindingUrl(r.sourcePageUrl))
    if (r.kind === 'internal-link' && !linkStreamRssTripped) {
      const pk = `${r.sourcePageUrl}\n${r.targetUrl}`
      const idx = pairKeyToIdx.get(pk)
      if (idx !== undefined) internalPairs[idx].occurrences++
      else { pairKeyToIdx.set(pk, internalPairs.length); internalPairs.push({ sourcePageUrl: asIntern(r.sourcePageUrl), targetUrl: asIntern(r.targetUrl), kind: 'internal-link', occurrences: 1 }) }
    }
  }, { onChunkEnd: () => {
    if (!linkStreamRssTripped && deps.rssBytes && deps.rssBytes() > VERIFIER_RSS_GUARD_MB() * 1048576) {
      linkStreamRssTripped = true
      internalPairs.length = 0; pairKeyToIdx.clear()
      console.warn('[live-seo] rss guard tripped during link stream — graph/coverage/validation degrade')
    }
  } })
  pairKeyToIdx.clear(); intern.clear()

  const startedAt = new Date(deps.now())
  const capped = uniqueCount > cap
  if (capped) console.warn(`[broken-link-verify] ${job.siteAuditId}: capping ${uniqueCount} -> ${cap} checks`)
  const toCheck = [...byTarget.entries()].map(([key, v]) => ({
    targetUrl: key.slice(key.indexOf(' ') + 1),
    ...v,
  }))

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
      canonicalUrl: true, detailsJson: true, contentTruncated: true,
    },
  })
  const deadPageRows = await prisma.harvestedPageError.findMany({
    where: { siteAuditId: job.siteAuditId },
    select: { url: true, statusCode: true },
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
  // internalPairs (built in the streamed pass above) IS the validation-mapper's
  // link input now — occurrence-counted, so multiplicity stays byte-identical to
  // the old per-row `links` array (Codex plan-fix #1, no re-expansion here).

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
    // Streamed like the internal pass (stage-A memory fix): dedup by targetUrl
    // with a bounded source sample, admit up to EXTERNAL_MAX distinct targets.
    // Codex plan-fix #2: count distinct targets by group-key TRANSITION (rows are
    // targetUrl-contiguous under the stream's orderBy), never by an admission probe.
    const extByTarget = new Map<string, Set<string>>()
    let extPrevGroupKey: string | null = null
    let extUniqueCount = 0
    await streamHarvestedLinks(job.siteAuditId, ['external-link'], (r) => {
      if (r.harvestTruncated) externalHarvestTruncated = true
      if (r.targetUrl !== extPrevGroupKey) { extUniqueCount++; extPrevGroupKey = r.targetUrl }
      let s = extByTarget.get(r.targetUrl)
      if (!s && extByTarget.size < EXTERNAL_MAX) { s = new Set<string>(); extByTarget.set(r.targetUrl, s) }
      if (s && s.size < URLS_PER_FINDING) s.add(normalizeFindingUrl(r.sourcePageUrl))
    })
    externalCapped = extUniqueCount > EXTERNAL_MAX
    const extToCheck = [...extByTarget.entries()].map(([targetUrl, sources]) => ({ targetUrl, sources }))

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
  // internalPairs feeds the graph directly (Codex plan-fix #1). It carries only
  // internal-link edges — identical to the old all-rows input because
  // computeLinkGraph already skips non-'internal-link' edges and dedupes into
  // sets, so occurrence counts and dropped image rows never affected the result.
  // Task 10 (memory fix stage B3-4): the RSS ceiling isn't only a link-stream
  // concern (Task 7) — every optional POST-verification analytics pass (link
  // graph, content signals, topic-overlap, similarity) reads a fresh RSS
  // sample at its own gate and bails fail-to-null rather than growing memory
  // further; the three content-text passes persist a capped stub instead of a
  // bare null (see each block below). Optional on VerifyDeps (see rssBytes
  // doc above) -> absent means never over.
  const rssOverGuard = (): boolean => deps.rssBytes != null && deps.rssBytes() > VERIFIER_RSS_GUARD_MB() * 1048576

  // On an RSS trip the pairs were abandoned, so the graph degrades to null (its
  // existing fail-path) rather than being computed over an empty/partial set.
  // graphRssOver is independent of linkStreamRssTripped (a separate live read,
  // not a reuse of the link-stream's earlier sample) but only warns when IT is
  // the reason for the skip -- linkStreamRssTripped already logged its own
  // warning upstream.
  let graph: ReturnType<typeof computeLinkGraph> | null = null
  const graphRssOver = rssOverGuard()
  if (!linkStreamRssTripped && !graphRssOver) {
    try {
      graph = computeLinkGraph(internalPairs, graphNodes, homepageUrl, indexableUrls)
    } catch (e) {
      console.error('[live-seo] graph compute failed', e)
    }
  } else if (!linkStreamRssTripped && graphRssOver) {
    console.warn('[live-seo] rss guard: skipping link graph')
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
        indexable: null, score: null, passCount: null, incompleteCount: null, faqEvidence: null, adaAuditId: null }
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
      faqEvidence: deriveFaqEvidence(r.detailsJson),
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
  // RSS-trip: skip validation entirely (no findings — never fabricated-clean
  // ones from an empty link set, Codex plan-fix #2). Otherwise internalPairs
  // carries occurrence counts so redirect_chain/redirect_loop multiplicity is
  // byte-identical to the old per-row `links` input.
  const validationFindings = linkStreamRssTripped
    ? []
    : mapValidationFindings(validationRows, internalPairs, cache, {
      runId, ensurePage, auditedHost, affectedComplete: !capped && !cappedValidation && !internalBudgetHit,
    })
  const deadPageFindings = mapDeadPageFindings(deadPageRows, {
    runId,
    ensurePage,
    affectedComplete: true,
  })
  const findings: FindingInput[] = [
    ...onPageFindings,
    ...brokenFindings,
    ...externalFindings,
    ...validationFindings,
    ...deadPageFindings,
  ]

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
  // RSS-trip: do NOT call computeDiscoveryCoverage — empty-input coverage would
  // render clean-looking sitemap numbers (Codex plan-fix #2). Store null instead
  // (column is nullable; DiscoveryCoverageSection returns null on a null payload).
  // Otherwise internalPairs (deduped) yields identical output — coverage dedupes
  // targets + sources into sets, so occurrence counts never mattered.
  const coverage = linkStreamRssTripped
    ? null
    : computeDiscoveryCoverage({
      discoveredUrls,
      internalLinks: internalPairs,
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

  // KS-3: durable JSON-LD program entities. Caller-side eligibility filter
  // (indexable ∧ ¬login-like — content-similarity precedent). Fail-to-null.
  let programEntitiesJson: string | null = null
  try {
    const agg = aggregateProgramEntities(
      seoRows.filter((r) => indexableOf(r) && !r.loginLike).map((r) => ({ url: r.url, detailsJson: r.detailsJson })),
    )
    if (agg) programEntitiesJson = JSON.stringify(agg)
  } catch (e) {
    console.error('[live-seo] program-entity aggregation failed', e)
  }

  // Stage-B memory fix part 2: contentText is loaded ONCE here, separately from
  // seoRows, under a total byte budget (see loadContentTextBudgeted above). All
  // three content-text passes below read textByUrl.get(r.url) ?? null instead
  // of a per-row scalar — budgetSkippedPages is threaded into each wrapper's
  // honesty flags (Codex plan-fix #4).
  const { textByUrl, budgetSkippedPages } = await loadContentTextBudgeted(job.siteAuditId)

  // C12: stale-date + readability signals over the SAME indexable ∧ ¬login-like
  // aggregation set. Best-effort + time-budget-guarded (runs before similarity, so
  // its reserve accounts for both). Never fails the live-scan write (fail-to-null).
  let contentSignalsJson: string | null = null
  const sigRemaining = JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS
  const sigRssOver = rssOverGuard()
  if (sigRemaining >= CONTENT_SIGNALS_RESERVE_MS + TOPIC_OVERLAP_RESERVE_MS + CONTENT_SIM_RESERVE_MS && !sigRssOver) {
    try {
      const sigInputs = seoRows
        .filter((r) => indexableOf(r) && !r.loginLike)
        .map((r) => ({ url: r.url, contentText: textByUrl.get(r.url) ?? null, contentTruncated: r.contentTruncated }))
      const signals = computeContentSignals(sigInputs, { currentYear: new Date().getUTCFullYear() })
      if (signals) {
        contentSignalsJson = JSON.stringify({
          v: 1, ...signals, ...(budgetSkippedPages > 0 ? { inputCapped: true, budgetSkippedPages } : {}),
        })
      } else if (budgetSkippedPages > 0) {
        // Codex plan-fix #4: a budget-capped null must not read as "not analyzed" —
        // persist a capped stub instead of a bare null.
        contentSignalsJson = JSON.stringify({ v: 1, unavailable: true, inputCapped: true, budgetSkippedPages })
      }
    } catch (e) {
      console.error('[live-seo] content signals failed', e)
    }
  } else if (sigRssOver) {
    // Task 10: RSS-skipped passes persist the SAME capped stub as a
    // budget-skipped one (budgetSkippedPages > 0 || rssSkippedThisPass) —
    // "unavailable", never a bare null that would read as "clean".
    console.warn('[live-seo] rss guard: skipping content signals')
    contentSignalsJson = JSON.stringify({ v: 1, unavailable: true, inputCapped: true, budgetSkippedPages })
  }

  // C12 Tier-1: semantic topic-overlap networks over MiniLM embeddings, over the
  // SAME indexable ∧ ¬login-like set. Runs BEFORE similarity, so its reserve
  // accounts for both remaining blocks. Cooperative chunked embedding keeps the
  // synchronous ONNX pass off the event-loop critical path. Fail-to-null: a throw,
  // model failure, or deadline-abandon must NEVER fail the live-scan write.
  let topicOverlapJson: string | null = null
  if (!TOPIC_OVERLAP_ENABLED()) {
    // Task 11b kill switch: disabled by default. Plain null, matching the
    // existing time-skip semantics ("not analyzed" render) -- NOT the
    // inputCapped stub, which would falsely claim input capping. The embedder
    // is never touched: this branch returns before any embedChunked/embedTexts
    // reference, before the RSS/time gates below, and before the eligible-page
    // text assembly.
    console.log('[live-seo] topic-overlap pass disabled (VERIFIER_TOPIC_OVERLAP_ENABLED not set)')
  } else {
  const topicRemaining = JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS
  const topicRssOver = rssOverGuard()
  if (topicRemaining >= TOPIC_OVERLAP_RESERVE_MS + CONTENT_SIM_RESERVE_MS && !topicRssOver) {
    try {
      const eligible = seoRows.filter((r) => indexableOf(r) && !r.loginLike)
      // Task 10 slice-before-retain: the retained object holds only the
      // TOPIC_OVERLAP_BODY_CHARS slice + a precomputed truncation flag — the
      // full .trim()ed string is transient inside this map callback and is
      // never held on the array (the old `bodyFull` field kept the WHOLE
      // contentText resident for every eligible page for the rest of this
      // block, on top of the copy already held in textByUrl).
      const withText = eligible.map((r) => {
        const full = (textByUrl.get(r.url) ?? '').trim()
        return {
          url: r.url,
          sigText: [r.title, r.h1, r.metaDescription].map((s) => (s ?? '').trim()).filter(Boolean).join('\n'),
          // Buffer round-trip forces a FLAT copy: when .trim() above allocated a
          // new parent string, a bare .slice() would be a V8 SlicedString pinning
          // the whole ~30KB parent for as long as this object is retained.
          body: Buffer.from(full.slice(0, TOPIC_OVERLAP_BODY_CHARS), 'utf8').toString('utf8'),
          bodyPrefixTruncated: full.length > TOPIC_OVERLAP_BODY_CHARS,
        }
      })
      const candidates = withText.filter((c) => c.sigText.length > 0 && c.body.length > 0)
      const inputCapped = candidates.length > TOPIC_OVERLAP_MAX_PAGES
      const kept = inputCapped
        ? [...candidates].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)).slice(0, TOPIC_OVERLAP_MAX_PAGES)
        : candidates
      if (kept.length >= 2) {
        const sigTexts = kept.map((c) => c.sigText)
        const bodyTexts = kept.map((c) => c.body)
        const vecs = await embedChunked([...sigTexts, ...bodyTexts], {
          embed: embedTexts,
          chunkSize: TOPIC_OVERLAP_EMBED_CHUNK,
          // Abort when embedding would eat into the DOWNSTREAM similarity reserve
          // (Codex plan-fix #1): topic-overlap may consume its own budget down to
          // CONTENT_SIM_RESERVE_MS remaining, but no further. A single final chunk
          // that overruns is backstopped by the similarity block's own entry guard
          // (`simRemaining >= CONTENT_SIM_RESERVE_MS`), which simply skips similarity
          // to null rather than corrupting anything. Task 10: ALSO abort on a live
          // RSS-over reading mid-embed (not just the frozen topicRssOver sampled
          // at the gate above) — the embed pass runs across several chunks and
          // memory can tip over during it.
          shouldAbort: () =>
            JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS < CONTENT_SIM_RESERVE_MS || rssOverGuard(),
        })
        if (vecs) {
          const m = kept.length
          const vecByUrl = new Map(
            kept.map((c, i) => [
              c.url,
              { sigVec: vecs[i], bodyVec: vecs[m + i], bodyPrefixTruncated: c.bodyPrefixTruncated },
            ]),
          )
          const pageVecs = eligible.map((r) => {
            const v = vecByUrl.get(r.url)
            return v
              ? { url: r.url, sigVec: v.sigVec, bodyVec: v.bodyVec, bodyPrefixTruncated: v.bodyPrefixTruncated }
              : { url: r.url, sigVec: null, bodyVec: null, bodyPrefixTruncated: false }
          })
          // Codex plan-fix #4: OR the byte-budget cap into the existing page-count
          // cap flag — both are honest "input was capped" signals on one field.
          const result = clusterByTopicOverlap(pageVecs, { inputCapped: inputCapped || budgetSkippedPages > 0 })
          if (result) {
            topicOverlapJson = JSON.stringify({
              v: 1, ...result, ...(budgetSkippedPages > 0 ? { budgetSkippedPages } : {}),
            })
          }
        }
      }
      if (topicOverlapJson === null && budgetSkippedPages > 0) {
        // Budget-capped null (e.g. every candidate lost its body text to the
        // budget, leaving < 2 clusterable pages) must not read as "not analyzed".
        topicOverlapJson = JSON.stringify({ v: 1, unavailable: true, inputCapped: true, budgetSkippedPages })
      }
    } catch (e) {
      console.error('[live-seo] topic overlap failed', e)
    }
  } else if (topicRssOver) {
    console.warn('[live-seo] rss guard: skipping topic overlap')
    topicOverlapJson = JSON.stringify({ v: 1, unavailable: true, inputCapped: true, budgetSkippedPages })
  }
  }

  // C6 Phase 5: content similarity. Best-effort + time-budget-guarded — a similarity
  // failure or overrun must NEVER fail the live-scan write (mirrors the graph fail-to-null).
  let contentSimilarityJson: string | null = null
  const simRemaining = JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS
  const simRssOver = rssOverGuard()
  if (simRemaining >= CONTENT_SIM_RESERVE_MS && !simRssOver) {
    try {
      const simInputs: SimilarityPageInput[] = seoRows
        .filter((r) => indexableOf(r) && !r.loginLike)
        .map((r) => ({ url: r.url, contentText: textByUrl.get(r.url) ?? null, contentTruncated: r.contentTruncated }))
      const sim = computeContentSimilarity(simInputs)
      if (sim) {
        contentSimilarityJson = JSON.stringify({
          v: 1, ...sim, ...(budgetSkippedPages > 0 ? { inputCapped: true, budgetSkippedPages } : {}),
        })
      } else if (budgetSkippedPages > 0) {
        // Codex plan-fix #4: budget-capped null (e.g. fewer than 2 pages kept
        // any text) must not read as "not analyzed".
        contentSimilarityJson = JSON.stringify({ v: 1, unavailable: true, inputCapped: true, budgetSkippedPages })
      }
    } catch (e) {
      console.error('[live-seo] content similarity failed', e)
    }
  } else if (simRssOver) {
    console.warn('[live-seo] rss guard: skipping content similarity')
    contentSimilarityJson = JSON.stringify({ v: 1, unavailable: true, inputCapped: true, budgetSkippedPages })
  }

  const bundle: FindingsBundle = {
    run: {
      id: runId, tool: 'seo-parser', source: 'live-scan', domain: site.domain ?? job.domain,
      clientId: site.clientId, sessionId: null, siteAuditId: site.id, adaAuditId: null,
      status: capped || harvestTruncated || cappedValidation || externalCapped || externalHarvestTruncated || internalBudgetHit || linkStreamRssTripped ? 'partial' : 'complete',
      score: scoreResult.score,
      scoreBreakdown: serializeBreakdownV2(
        'live-seo', scoreResult, hashWeights(weights), scoreResult.inputsSnapshot,
      ),
      wcagLevel: null,
      pagesTotal: pages.length, startedAt, completedAt: new Date(deps.now()),
      seoIntent: site.seoIntent,
      discoveryCoverageJson: coverage ? JSON.stringify(coverage) : null,
      reachabilityJson: graph ? JSON.stringify({ v: 1, ...graph.summary }) : null,
      contentSimilarityJson,
      contentSignalsJson,
      topicOverlapJson,
      schemaTypesJson,
      programEntitiesJson,
    },
    pages, findings, violations: [],
  }
  // C12 D1: stamp the content-audit retention window BEFORE writing the run.
  // If we crash between here and writeFindingsRun, there is a stamp but no
  // live-scan run -> recoverBrokenLinkVerifies re-enqueues (its liveRun guard
  // is false) and the builder rebuilds idempotently. Stamp-after could leave a
  // run with retained rows but retainUntil=null (recovery skips it; export
  // can't reach the text) -- so stamp-first is the invariant.
  await prisma.siteAudit.update({
    where: { id: job.siteAuditId },
    data: { contentAuditRetainUntil: new Date(deps.now() + CONTENT_AUDIT_BASE_TTL_MS) },
  })
  await writeFindingsRun(bundle)
  // A5 Task 14: the live-scan CrawlRun just committed — this is the moment a
  // seoOnly audit's results page actually becomes ready (the parent flipped
  // 'complete' earlier, before this run existed). Post-commit, outside any
  // tx, and unreachable if the await above threw.
  publishInvalidation(siteAuditTopic(job.siteAuditId))
  if (site.prospectId != null) publishInvalidation(prospectListTopic())
  publishInvalidation(clientSummaryTopic())
  publishInvalidation(recentsTopic())
  // HarvestedLink stays transient (a populated row still means "builder didn't
  // finish", which recovery relies on). HarvestedPageSeo is NO LONGER deleted
  // here -- it carries contentText for the retention window and is DELETEd at
  // expiry by sweepExpiredContentAudit (retention.ts).
  await prisma.harvestedLink.deleteMany({ where: { siteAuditId: job.siteAuditId } })
  await prisma.harvestedPageError.deleteMany({ where: { siteAuditId: job.siteAuditId } })
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
  const p = payload as { siteAuditId?: string } | null
  if (!p?.siteAuditId) return
  // Spec §3.1 (Codex): terminality FIRST, notify second, independent catches —
  // a notify failure must never prevent the placeholder (and vice versa).
  // ensureExhaustedPlaceholder never throws by contract.
  await ensureExhaustedPlaceholder(p.siteAuditId)
  // D7: the parent SiteAudit is already terminal 'complete' at this point (verify
  // is enqueued post-terminal), so still send the completion email. The content
  // builder treats a placeholder run as a missing SEO run. Never throw from onExhausted.
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
