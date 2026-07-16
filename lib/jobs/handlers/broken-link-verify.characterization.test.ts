// lib/jobs/handlers/broken-link-verify.characterization.test.ts
//
// Task 6 (verifier-memory-loop fix, pre-refactor gate): pins CURRENT
// runBrokenLinkVerify output byte-identically so Tasks 7-10 (streamed/interned
// data loading + content-similarity internals rewrite) must reproduce it. This
// is a FROZEN characterization test, not TDD-red — it is green against
// today's code, and the point IS that it stays green after the rewrite.
// Follows broken-link-verify.test.ts's seed/deps/mocking conventions (own
// DOMAIN, env save/restore, vi.spyOn for embeddings like its
// "C12 Tier-1 topic overlap" describe block).
//
// Expected values below were extracted by running this fixture against
// CURRENT code (console.log(JSON.stringify(...)) + manual transcription) —
// not hand-derived — per the task brief.
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { runBrokenLinkVerify, type VerifyDeps } from './broken-link-verify'
import * as embeddings from '@/lib/services/pillarAnalysis/embeddings'

const DOMAIN = 't6char.example.com'
const HUB = `https://${DOMAIN}/hub`

async function clean() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}

// Codex plan-fix #6: env vars this suite sets are saved/restored around each
// test — suites share a worker process and a leaked env poisons siblings.
const ORIG_MAX_CHECKS = process.env.BROKEN_LINK_MAX_CHECKS
let embedSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  await clean()
  process.env.BROKEN_LINK_MAX_CHECKS = '10'
  // Mock embeddings so C12 Tier-1 topic-overlap (runs whenever >=2 candidate
  // pages have both signature + body text — true for our 30-page fixture)
  // never loads the real ONNX model. Sibling convention (broken-link-verify.test.ts
  // "C12 Tier-1 topic overlap" describe block): identical unit vector for every
  // input. We don't assert on topicOverlapJson — this only keeps the run fast
  // and deterministic.
  embedSpy = vi.spyOn(embeddings, 'embedTexts').mockImplementation(async (texts: string[]) => texts.map(() => [1, 0]))
})
afterEach(async () => {
  if (ORIG_MAX_CHECKS === undefined) delete process.env.BROKEN_LINK_MAX_CHECKS
  else process.env.BROKEN_LINK_MAX_CHECKS = ORIG_MAX_CHECKS
  embedSpy.mockRestore()
  await prisma.scoringWeights.deleteMany({ where: { id: 1 } })
})
afterAll(clean)

const toks = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ')

// ---------------------------------------------------------------------------
// HarvestedPageSeo fixture: 30 pages, all indexable (200/html/no noindex/not
// login-like), wordCount 800 (never thin), distinct metaDescription per page
// (avoids an incidental duplicate_meta_description finding from a shared
// value — kept the fixture focused on title/h1).
//   p01,p02 — exact-duplicate contentText
//   p03,p04 — near-duplicate contentText (base + distinct tail — same pattern
//             as content-similarity.test.ts's "flags near duplicates" fixture,
//             crosses the 0.9 near-threshold)
//   p05     — missing title
//   p06     — missing h1
//   p07     — missing title AND h1
//   p08,p09 — duplicate title ("Shared Title")
//   p10..p30 — normal, unique title/h1/content, no issues
// ---------------------------------------------------------------------------
const dupText = toks('dupword', 80)
const nearBase = toks('nearbase', 120)

function page(n: string, overrides: Record<string, unknown> = {}) {
  return {
    url: `https://${DOMAIN}/p${n}`,
    statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false,
    title: `Title ${n}`, h1: `H1 ${n}`, metaDescription: `Meta ${n}`, wordCount: 800, schemaCount: 1,
    contentText: toks(`page${n}word`, 80), contentTruncated: false,
    ...overrides,
  }
}

function buildPages(siteAuditId: string) {
  const rows = [
    page('05', { title: null }),
    page('06', { h1: null }),
    page('07', { title: null, h1: null }),
    page('08', { title: 'Shared Title' }),
    page('09', { title: 'Shared Title' }),
    page('01', { contentText: dupText }),
    page('02', { contentText: dupText }),
    page('03', { contentText: nearBase + ' xtail' }),
    page('04', { contentText: nearBase + ' ytail' }),
  ]
  for (let i = 10; i <= 30; i++) rows.push(page(String(i).padStart(2, '0')))
  return rows.map((r) => ({ ...r, siteAuditId }))
}

// ---------------------------------------------------------------------------
// HarvestedLink fixture: all sourced from HUB.
//   aaa-redirect   x3 duplicate (sourcePageUrl,targetUrl,'internal-link') rows
//                  — resolves as a redirect (hops:1). Pins Codex #3: the
//                  page-scope redirect_chain finding's count === occurrences
//                  (3), NOT distinct pairs (1) — validation-mapper's
//                  `links` array is built from the RAW harvested rows (never
//                  deduped), so addPageHit fires once per physical row.
//   aab-broken     x1 internal-link -> resolves broken
//   aac-broken.png x1 image -> resolves broken
//   fill-01..07    x1 each internal-link -> resolves ok
//   zzz-01,02      x1 each internal-link -> resolves ok
// 12 unique (kind,targetUrl) pairs > BROKEN_LINK_MAX_CHECKS=10 -> capped=true.
// The builder's DB query orders by targetUrl asc, so the first-10 subset
// retained by the cap is deterministic: [aaa-redirect, aab-broken,
// aac-broken.png, fill-01..fill-07]; zzz-01/02 are the dropped-by-cap
// subset — pinned by name below (Codex #3's cap-subset sibling), not just count.
// ---------------------------------------------------------------------------
function buildLinks(siteAuditId: string) {
  const mk = (targetUrl: string, kind: string) => ({ siteAuditId, sourcePageUrl: HUB, targetUrl, kind })
  const rows = [
    mk(`https://${DOMAIN}/aaa-redirect`, 'internal-link'),
    mk(`https://${DOMAIN}/aaa-redirect`, 'internal-link'),
    mk(`https://${DOMAIN}/aaa-redirect`, 'internal-link'),
    mk(`https://${DOMAIN}/aab-broken`, 'internal-link'),
    mk(`https://${DOMAIN}/aac-broken.png`, 'image'),
  ]
  for (let i = 1; i <= 7; i++) rows.push(mk(`https://${DOMAIN}/fill-${String(i).padStart(2, '0')}`, 'internal-link'))
  rows.push(mk(`https://${DOMAIN}/zzz-01`, 'internal-link'))
  rows.push(mk(`https://${DOMAIN}/zzz-02`, 'internal-link'))
  return rows
}

const deps: VerifyDeps = {
  resolve: async (url: string) => {
    if (url === `https://${DOMAIN}/aaa-redirect`) {
      return { result: 'ok', finalUrl: `https://${DOMAIN}/aaa-redirect-final`, status: 200, hops: 1, chain: [`https://${DOMAIN}/aaa-redirect-final`], tooManyRedirects: false }
    }
    if (url === `https://${DOMAIN}/aab-broken` || url === `https://${DOMAIN}/aac-broken.png`) {
      return { result: 'broken', finalUrl: null, status: 404, hops: 0, chain: [], tooManyRedirects: false }
    }
    return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }
  },
  resolveExternal: async (url: string) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  now: () => 0,
  sleep: async () => {},
}

// discoveryCoverageJson reads from the RAW harvested rows (not the resolution
// cap), so its `sample` lists all 11 unique internal-link targets regardless
// of BROKEN_LINK_MAX_CHECKS — including the two that never got resolved.
// This is NOT the cap subset (see EXPECTED_RESOLVED_CAP_SUBSET below for that).
const EXPECTED_ALL_UNIQUE_INTERNAL_TARGETS = [
  `https://${DOMAIN}/aaa-redirect`,
  `https://${DOMAIN}/aab-broken`,
  `https://${DOMAIN}/fill-01`,
  `https://${DOMAIN}/fill-02`,
  `https://${DOMAIN}/fill-03`,
  `https://${DOMAIN}/fill-04`,
  `https://${DOMAIN}/fill-05`,
  `https://${DOMAIN}/fill-06`,
  `https://${DOMAIN}/fill-07`,
  `https://${DOMAIN}/zzz-01`,
  `https://${DOMAIN}/zzz-02`,
].sort()

// The ACTUAL cap subset: sorted by targetUrl asc (the builder's dedup/DB
// orderBy order), the first 10 of the 12 unique (kind,targetUrl) pairs are
// retained — [aaa-redirect, aab-broken, aac-broken.png, fill-01..fill-07].
// zzz-01/zzz-02 (sorted last) are the dropped-by-cap pair and must NEVER be
// passed to deps.resolve. Verified below via a call-tracking wrapper around
// deps.resolve — pins the exact target LIST, not just the count.
const EXPECTED_RESOLVED_CAP_SUBSET = [
  `https://${DOMAIN}/aaa-redirect`,
  `https://${DOMAIN}/aab-broken`,
  `https://${DOMAIN}/aac-broken.png`,
  `https://${DOMAIN}/fill-01`,
  `https://${DOMAIN}/fill-02`,
  `https://${DOMAIN}/fill-03`,
  `https://${DOMAIN}/fill-04`,
  `https://${DOMAIN}/fill-05`,
  `https://${DOMAIN}/fill-06`,
  `https://${DOMAIN}/fill-07`,
].sort()

const EXPECTED_FINDINGS = [
  { type: 'broken_images', scope: 'page', count: 1, url: `https://${DOMAIN}/hub`,
    detail: { brokenTargetUrls: [`https://${DOMAIN}/aac-broken.png`] } },
  { type: 'broken_images', scope: 'run', count: 1, url: null,
    detail: { description: 'Image resources that resolve to a 4xx/5xx response.', checked: 10, broken: 2, unconfirmed: 0, capped: true, harvestTruncated: false } },
  { type: 'broken_internal_links', scope: 'page', count: 1, url: `https://${DOMAIN}/hub`,
    detail: { brokenTargetUrls: [`https://${DOMAIN}/aab-broken`] } },
  { type: 'broken_internal_links', scope: 'run', count: 1, url: null,
    detail: { description: 'Internal links that resolve to a 4xx/5xx response.', checked: 10, broken: 2, unconfirmed: 0, capped: true, harvestTruncated: false } },
  { type: 'duplicate_title', scope: 'page', count: 1, url: `https://${DOMAIN}/p08`, detail: null },
  { type: 'duplicate_title', scope: 'page', count: 1, url: `https://${DOMAIN}/p09`, detail: null },
  { type: 'duplicate_title', scope: 'run', count: 1, url: null,
    detail: { description: 'Indexable pages sharing an identical <title>.' } },
  { type: 'missing_h1', scope: 'page', count: 1, url: `https://${DOMAIN}/p06`, detail: null },
  { type: 'missing_h1', scope: 'page', count: 1, url: `https://${DOMAIN}/p07`, detail: null },
  { type: 'missing_h1', scope: 'run', count: 2, url: null,
    detail: { description: 'Indexable pages with no H1.' } },
  { type: 'missing_title', scope: 'page', count: 1, url: `https://${DOMAIN}/p05`, detail: null },
  { type: 'missing_title', scope: 'page', count: 1, url: `https://${DOMAIN}/p07`, detail: null },
  { type: 'missing_title', scope: 'run', count: 2, url: null,
    detail: { description: 'Indexable pages with no <title>.' } },
  // Pins the multiplicity contract: page-scope count === 3 occurrences of the
  // duplicated (sourcePageUrl,targetUrl) pair, not 1 distinct pair.
  { type: 'redirect_chain', scope: 'page', count: 3, url: HUB,
    detail: { targets: [`https://${DOMAIN}/aaa-redirect`, `https://${DOMAIN}/aaa-redirect`, `https://${DOMAIN}/aaa-redirect`] } },
  { type: 'redirect_chain', scope: 'run', count: 1, url: null,
    detail: { description: 'Internal link resolves through one or more redirects.' } },
].sort((a, b) => (a.type + a.scope + (a.url ?? '')).localeCompare(b.type + b.scope + (b.url ?? '')))

const EXPECTED_DISCOVERY_COVERAGE = {
  mode: null, capped: false, applicable: false,
  discoveredCount: 0, linkedInternalCount: 11, offBaselineCount: 11, missRate: null,
  sample: EXPECTED_ALL_UNIQUE_INTERNAL_TARGETS.map((targetUrl) => ({ targetUrl, sourcePageUrls: [HUB] })),
  sitemapMissRate: null, sitemapApplicable: false, residualMissRate: null, residualApplicable: false,
  hybridCapped: false,
}

const EXPECTED_CONTENT_SIMILARITY = {
  v: 1, algorithm: 'minhash+exact-jaccard', shingleSize: 5, nearThreshold: 0.9, minTokens: 50,
  boilerplateDfRatio: 0.5, boilerplateDfMin: 3, pagesEligible: 30, pagesSkipped: { noText: 0, thin: 0 },
  boilerplateShinglesDropped: 0,
  exactDuplicateGroups: [{ urls: [`https://${DOMAIN}/p01`, `https://${DOMAIN}/p02`], count: 2 }],
  nearDuplicateGroups: [{ urls: [`https://${DOMAIN}/p03`, `https://${DOMAIN}/p04`], similarity: 0.98 }],
  truncatedPages: 0, capped: false,
}

// All 30 pages are unlinked orphans/unreachable in this fixture (HUB only
// links to the non-page harvested targets, never to a /pNN page, and no page
// is the bare domain root, so homepageResolved is false and every page's
// crawlDepth is null). Order within orphanSample/unreachableSample follows
// HarvestedPageSeo.findMany's (unordered-by-query) row return order, which is
// NOT a contract of the builder — sorted before comparison per the brief's
// "fix the assertion, never the code" rule.
const EXPECTED_REACHABILITY = {
  v: 1, nodeCount: 42, indexableNodeCount: 30, edgeCount: 11, homepageResolved: false,
  orphanCount: 30,
  orphanSample: Array.from({ length: 30 }, (_, i) => `https://${DOMAIN}/p${String(i + 1).padStart(2, '0')}`).sort(),
  unreachableCount: 30,
  unreachableSample: Array.from({ length: 30 }, (_, i) => `https://${DOMAIN}/p${String(i + 1).padStart(2, '0')}`).sort(),
  depthHistogram: { '0': 0, '1': 0, '2': 0, '3': 0, '4plus': 0, null: 30 },
  maxDepth: null, deepSample: [],
}

describe('runBrokenLinkVerify — characterization (pre-refactor gate, Task 6)', () => {
  it('pins findings/run/discoveryCoverage/reachability/contentSimilarity/log-counters for the current builder', async () => {
    const sa = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', clientId: null, pagesTotal: 30, pagesComplete: 30, pagesError: 0 },
    })
    const siteAuditId = sa.id
    await prisma.harvestedPageSeo.createMany({ data: buildPages(siteAuditId) })
    await prisma.harvestedLink.createMany({ data: buildLinks(siteAuditId) })

    // Wrap deps.resolve to record every URL it's actually invoked with — the
    // direct proof of the cap SUBSET (not just the count in the log line).
    const resolvedUrls: string[] = []
    const trackedDeps: VerifyDeps = { ...deps, resolve: async (url) => { resolvedUrls.push(url); return deps.resolve(url) } }

    const logSpy = vi.spyOn(console, 'log')
    await runBrokenLinkVerify({ siteAuditId, domain: DOMAIN }, trackedDeps)

    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      include: { findings: true },
    })
    expect(run).not.toBeNull()

    // ---- run row: status/score/pagesTotal ----
    expect(run!.status).toBe('partial') // capped (12 unique targets > cap 10)
    expect(run!.score).toBe(97)
    expect(run!.pagesTotal).toBe(31) // 30 seoRows + HUB (ensured by the broken/redirect page-scope findings)

    // ---- discoveryCoverageJson (full deep-equal) ----
    expect(JSON.parse(run!.discoveryCoverageJson!)).toEqual(EXPECTED_DISCOVERY_COVERAGE)

    // ---- cap SUBSET: the exact 10 targets resolve() was called with (deduped,
    // each queried exactly once) — zzz-01/zzz-02 must NEVER be resolved.
    expect([...new Set(resolvedUrls)].sort()).toEqual(EXPECTED_RESOLVED_CAP_SUBSET)
    expect(resolvedUrls).toHaveLength(10) // no re-resolution of a duplicate target
    expect(resolvedUrls).not.toContain(`https://${DOMAIN}/zzz-01`)
    expect(resolvedUrls).not.toContain(`https://${DOMAIN}/zzz-02`)

    // ---- reachabilityJson (order-independent on the two sample arrays) ----
    const reach = JSON.parse(run!.reachabilityJson!)
    expect({
      ...reach,
      orphanSample: [...reach.orphanSample].sort(),
      unreachableSample: [...reach.unreachableSample].sort(),
    }).toEqual(EXPECTED_REACHABILITY)

    // ---- contentSimilarityJson (full deep-equal) ----
    expect(JSON.parse(run!.contentSimilarityJson!)).toEqual(EXPECTED_CONTENT_SIMILARITY)

    // ---- findings: full sorted (type, scope, count, url, detail) list ----
    const findings = run!.findings
      .map((f) => ({ type: f.type, scope: f.scope, count: f.count, url: f.url, detail: f.detail ? JSON.parse(f.detail) : null }))
      .sort((a, b) => (a.type + a.scope + (a.url ?? '')).localeCompare(b.type + b.scope + (b.url ?? '')))
    expect(findings).toEqual(EXPECTED_FINDINGS)

    // ---- console-log counters (D6-era summary line) ----
    const logLine = logSpy.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('[broken-link-verify]'))
    expect(logLine).toBe(
      `[broken-link-verify] ${siteAuditId}: checked 10, broken 2, unconfirmed 0, external checked 0, external broken 0, external unconfirmed 0, on-page rows 30, internalBudgetHit false (10/10 resolved)`,
    )

    // HarvestedLink is always cleaned up post-write (independent of this
    // characterization's other assertions, but worth pinning: the cap subset
    // still deletes ALL harvested rows, including the zzz-01/02 that were
    // never resolved).
    expect(await prisma.harvestedLink.count({ where: { siteAuditId } })).toBe(0)
  })
})
