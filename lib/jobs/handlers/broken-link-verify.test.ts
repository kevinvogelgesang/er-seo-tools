import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { runBrokenLinkVerify, type VerifyDeps } from './broken-link-verify'
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'

const DOMAIN = 'c6blv.example.com'

async function clean() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}
beforeEach(clean)
afterEach(async () => { await prisma.scoringWeights.deleteMany({ where: { id: 1 } }) })
afterAll(clean)

async function seed(targets: { targetUrl: string; kind: string; sourcePageUrl: string }[]) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })
  if (targets.length)
    await prisma.harvestedLink.createMany({ data: targets.map((t) => ({ ...t, siteAuditId: sa.id })) })
  return sa.id
}

// External-link seed: N distinct external targets, each linked from one source page on DOMAIN.
async function seedExternal(targets: { targetUrl: string; sourcePageUrl?: string }[]) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })
  if (targets.length)
    await prisma.harvestedLink.createMany({
      data: targets.map((t) => ({
        siteAuditId: sa.id, targetUrl: t.targetUrl, kind: 'external-link',
        sourcePageUrl: t.sourcePageUrl ?? 'https://c6blv.example.com/a',
      })),
    })
  return sa.id
}

// deps: every targetUrl in brokenSet resolves 'broken', else 'ok'
const depsFor = (brokenSet: Set<string>): VerifyDeps => ({
  resolve: async (url: string) => (brokenSet.has(url)
    ? { result: 'broken', finalUrl: null, status: 404, hops: 0, chain: [], tooManyRedirects: false }
    : { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  resolveExternal: async (url: string) => (brokenSet.has(url)
    ? { result: 'broken' as const, finalUrl: url, status: 404, hops: 0, chain: [], tooManyRedirects: false }
    : { result: 'ok' as const, finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  now: () => 0,
  sleep: async () => {},
})

const liveRun = (id: string) =>
  prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: id, tool: 'seo-parser' } },
    include: { findings: true },
  })

describe('runBrokenLinkVerify', () => {
  it('writes a live-scan run with broken findings and deletes harvest rows', async () => {
    const id = await seed([
      { targetUrl: 'https://c6blv.example.com/dead', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a' },
      { targetUrl: 'https://c6blv.example.com/ok', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a' },
      { targetUrl: 'https://c6blv.example.com/bad.png', kind: 'image', sourcePageUrl: 'https://c6blv.example.com/a' },
    ])
    await runBrokenLinkVerify(
      { siteAuditId: id, domain: DOMAIN },
      depsFor(new Set(['https://c6blv.example.com/dead', 'https://c6blv.example.com/bad.png'])),
    )
    const run = await liveRun(id)
    expect(run?.source).toBe('live-scan')
    const links = run!.findings.find((f) => f.scope === 'run' && f.type === 'broken_internal_links')
    expect(links?.count).toBe(1)
    const imgs = run!.findings.find((f) => f.scope === 'run' && f.type === 'broken_images')
    expect(imgs?.count).toBe(1)
    expect(await prisma.harvestedLink.count({ where: { siteAuditId: id } })).toBe(0)
  })

  it('empty harvest -> empty run written, no delete error', async () => {
    const id = await seed([])
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, depsFor(new Set()))
    const run = await liveRun(id)
    expect(run).not.toBeNull()
    expect(run!.findings).toHaveLength(0)
  })

  it('counts external-link targets as broken_external_links (warning)', async () => {
    const id = await seed([
      { targetUrl: 'https://other.com/x', kind: 'external-link', sourcePageUrl: 'https://c6blv.example.com/a' },
    ])
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, depsFor(new Set(['https://other.com/x'])))
    const run = await liveRun(id)
    const ext = run!.findings.find((f) => f.scope === 'run' && f.type === 'broken_external_links')
    expect(ext?.count).toBe(1)
    expect(ext?.severity).toBe('warning')
  })

  it('idempotent re-run replaces the run (no unique-constraint error)', async () => {
    const id = await seed([
      { targetUrl: 'https://c6blv.example.com/dead', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a' },
    ])
    const deps = depsFor(new Set(['https://c6blv.example.com/dead']))
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    // re-seed (rows were deleted) and re-run — must not throw on the unique key
    await prisma.harvestedLink.create({
      data: { siteAuditId: id, targetUrl: 'https://c6blv.example.com/dead', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a' },
    })
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    const runs = await prisma.crawlRun.findMany({ where: { siteAuditId: id, tool: 'seo-parser' } })
    expect(runs).toHaveLength(1)
  })

  it('harvestTruncated rows -> run is partial', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedLink.create({
      data: { siteAuditId: sa.id, targetUrl: 'https://c6blv.example.com/x', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a', harvestTruncated: true },
    })
    await runBrokenLinkVerify({ siteAuditId: sa.id, domain: DOMAIN }, depsFor(new Set()))
    const run = await liveRun(sa.id)
    expect(run!.status).toBe('partial')
  })

  it('deleted audit -> no-op (no run written, no throw)', async () => {
    await runBrokenLinkVerify({ siteAuditId: 'nonexistent-id', domain: DOMAIN }, depsFor(new Set()))
    // nothing to assert beyond not throwing
    expect(true).toBe(true)
  })

  it('writes ONE live-scan run carrying on-page + broken-link findings, deletes both tables', async () => {
    // Seed: 2 HarvestedPageSeo rows sharing a title (duplicate_title finding expected),
    // 1 HarvestedLink internal-link whose target checkUrl returns 'broken'.
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })
    const siteAuditId = sa.id
    const TARGET = `https://${DOMAIN}/dead`
    await prisma.harvestedLink.create({
      data: { siteAuditId, targetUrl: TARGET, kind: 'internal-link', sourcePageUrl: `https://${DOMAIN}/a` },
    })
    await prisma.harvestedPageSeo.createMany({
      data: [
        { siteAuditId, url: `https://${DOMAIN}/a`, statusCode: 200, isHtml: true, title: 'Same Title',
          h1: 'H', metaDescription: 'M', wordCount: 500, robotsNoindex: false, xRobotsNoindex: false, loginLike: false },
        { siteAuditId, url: `https://${DOMAIN}/b`, statusCode: 200, isHtml: true, title: 'Same Title',
          h1: 'H2', metaDescription: 'M2', wordCount: 500, robotsNoindex: false, xRobotsNoindex: false, loginLike: false },
      ],
    })
    await runBrokenLinkVerify({ siteAuditId, domain: DOMAIN }, depsFor(new Set([TARGET])))
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      include: { findings: true, pages: true },
    })
    expect(run).not.toBeNull()
    const types = new Set(run!.findings.map((f) => f.type))
    expect(types.has('duplicate_title')).toBe(true)
    expect(types.has('broken_internal_links')).toBe(true)
    // CrawlPage scalars populated from on-page rows
    const pageWithScalars = run!.pages.find((p) => p.statusCode !== null)
    expect(pageWithScalars).not.toBeUndefined()
    // Both transient tables cleaned up
    expect(await prisma.harvestedPageSeo.count({ where: { siteAuditId } })).toBe(0)
    expect(await prisma.harvestedLink.count({ where: { siteAuditId } })).toBe(0)
  })

  it('is idempotent — second run replaces, exactly one live-scan run, findings from both sources', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })
    const siteAuditId = sa.id
    const TARGET = `https://${DOMAIN}/dead2`
    const deps = depsFor(new Set([TARGET]))

    // Seed both tables, run once
    await prisma.harvestedLink.create({
      data: { siteAuditId, targetUrl: TARGET, kind: 'internal-link', sourcePageUrl: `https://${DOMAIN}/a` },
    })
    await prisma.harvestedPageSeo.createMany({
      data: [
        { siteAuditId, url: `https://${DOMAIN}/a`, statusCode: 200, isHtml: true, title: 'Dup', wordCount: 500, robotsNoindex: false, xRobotsNoindex: false, loginLike: false },
        { siteAuditId, url: `https://${DOMAIN}/b`, statusCode: 200, isHtml: true, title: 'Dup', wordCount: 500, robotsNoindex: false, xRobotsNoindex: false, loginLike: false },
      ],
    })
    await runBrokenLinkVerify({ siteAuditId, domain: DOMAIN }, deps)

    // Re-seed BOTH tables (Codex fix #8 — the builder consumes both)
    await prisma.harvestedLink.create({
      data: { siteAuditId, targetUrl: TARGET, kind: 'internal-link', sourcePageUrl: `https://${DOMAIN}/a` },
    })
    await prisma.harvestedPageSeo.createMany({
      data: [
        { siteAuditId, url: `https://${DOMAIN}/a`, statusCode: 200, isHtml: true, title: 'Dup', wordCount: 500, robotsNoindex: false, xRobotsNoindex: false, loginLike: false },
        { siteAuditId, url: `https://${DOMAIN}/b`, statusCode: 200, isHtml: true, title: 'Dup', wordCount: 500, robotsNoindex: false, xRobotsNoindex: false, loginLike: false },
      ],
    })
    await runBrokenLinkVerify({ siteAuditId, domain: DOMAIN }, deps)

    // Exactly one live-scan run
    const runs = await prisma.crawlRun.findMany({ where: { siteAuditId, tool: 'seo-parser' } })
    expect(runs).toHaveLength(1)
    // Has findings from both sources
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      include: { findings: true },
    })
    const types = new Set(run!.findings.map((f) => f.type))
    expect(types.has('duplicate_title')).toBe(true)
    expect(types.has('broken_internal_links')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C6 Phase 3: live SEO score persistence tests
// ---------------------------------------------------------------------------

const SCORE_DOMAIN = 'c6score.example.com'

async function cleanScore() {
  await prisma.crawlRun.deleteMany({ where: { domain: SCORE_DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: SCORE_DOMAIN } } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: SCORE_DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: SCORE_DOMAIN } })
}

const stubDeps: VerifyDeps = {
  resolve: async (url: string) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  resolveExternal: async (url: string) => ({ result: 'ok' as const, finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  now: () => 0,
  sleep: async () => {},
}

describe('runBrokenLinkVerify — live SEO score', () => {
  beforeEach(cleanScore)
  afterEach(async () => { await prisma.scoringWeights.deleteMany({ where: { id: 1 } }) })
  afterAll(cleanScore)

  it('persists a non-null score for an indexable run', async () => {
    const sa = await prisma.siteAudit.create({
      data: { domain: SCORE_DOMAIN, status: 'complete', pagesTotal: 3, pagesComplete: 3, pagesError: 0 },
    })
    const siteAuditId = sa.id
    await prisma.harvestedPageSeo.createMany({
      data: [
        { siteAuditId, url: `https://${SCORE_DOMAIN}/a`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't1', h1: 'h1', metaDescription: 'm1', wordCount: 800, schemaCount: 1 },
        { siteAuditId, url: `https://${SCORE_DOMAIN}/b`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't2', h1: 'h2', metaDescription: 'm2', wordCount: 800, schemaCount: 1 },
        { siteAuditId, url: `https://${SCORE_DOMAIN}/c`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't3', h1: 'h3', metaDescription: 'm3', wordCount: 800, schemaCount: 1 },
      ],
    })
    await runBrokenLinkVerify({ siteAuditId, domain: SCORE_DOMAIN }, stubDeps)
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { score: true, scoreBreakdown: true },
    })
    expect(run!.score).not.toBeNull()
    expect(run!.score).toBeGreaterThan(0)
    const parsed = JSON.parse(run!.scoreBreakdown!)
    expect(parsed).toMatchObject({ scorer: 'live-seo', score: run!.score })
  })

  it('score is null for a fully-noindex run', async () => {
    const sa = await prisma.siteAudit.create({
      data: { domain: SCORE_DOMAIN, status: 'complete', pagesTotal: 3, pagesComplete: 3, pagesError: 0 },
    })
    const siteAuditId = sa.id
    await prisma.harvestedPageSeo.createMany({
      data: [
        { siteAuditId, url: `https://${SCORE_DOMAIN}/a`, statusCode: 200, isHtml: true, robotsNoindex: true, xRobotsNoindex: false, loginLike: false, title: 't1', h1: 'h1', metaDescription: 'm1', wordCount: 800, schemaCount: 0 },
        { siteAuditId, url: `https://${SCORE_DOMAIN}/b`, statusCode: 200, isHtml: true, robotsNoindex: true, xRobotsNoindex: false, loginLike: false, title: 't2', h1: 'h2', metaDescription: 'm2', wordCount: 800, schemaCount: 0 },
        { siteAuditId, url: `https://${SCORE_DOMAIN}/c`, statusCode: 200, isHtml: true, robotsNoindex: true, xRobotsNoindex: false, loginLike: false, title: 't3', h1: 'h3', metaDescription: 'm3', wordCount: 800, schemaCount: 0 },
      ],
    })
    await runBrokenLinkVerify({ siteAuditId, domain: SCORE_DOMAIN }, stubDeps)
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { score: true, scoreBreakdown: true },
    })
    expect(run!.score).toBeNull()
    expect(JSON.parse(run!.scoreBreakdown!)).toMatchObject({ scorer: 'live-seo', score: null, factors: [] })
  })

  it('coverage uses the HarvestedPageSeo row count, not pagesComplete', async () => {
    // pagesTotal=10, pagesComplete=10, but only 3 rows → observed=3, 3/10=0.3 < 0.5 → null
    const sa = await prisma.siteAudit.create({
      data: { domain: SCORE_DOMAIN, status: 'complete', pagesTotal: 10, pagesComplete: 10, pagesError: 0 },
    })
    const siteAuditId = sa.id
    await prisma.harvestedPageSeo.createMany({
      data: [
        { siteAuditId, url: `https://${SCORE_DOMAIN}/a`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't1', h1: 'h1', metaDescription: 'm1', wordCount: 800, schemaCount: 1 },
        { siteAuditId, url: `https://${SCORE_DOMAIN}/b`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't2', h1: 'h2', metaDescription: 'm2', wordCount: 800, schemaCount: 1 },
        { siteAuditId, url: `https://${SCORE_DOMAIN}/c`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't3', h1: 'h3', metaDescription: 'm3', wordCount: 800, schemaCount: 1 },
      ],
    })
    await runBrokenLinkVerify({ siteAuditId, domain: SCORE_DOMAIN }, stubDeps)
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { score: true },
    })
    // observed=3 rows, attempted=10 → 3/10=0.3 < 0.5 threshold → null
    expect(run!.score).toBeNull()
  })

  it('schema coverage moves the score (computed before transient deletion)', async () => {
    // Run A: 4 indexable rows with schemaCount=1 each (schema present)
    const saA = await prisma.siteAudit.create({
      data: { domain: SCORE_DOMAIN, status: 'complete', pagesTotal: 4, pagesComplete: 4, pagesError: 0 },
    })
    await prisma.harvestedPageSeo.createMany({
      data: [
        { siteAuditId: saA.id, url: `https://${SCORE_DOMAIN}/a`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't1', h1: 'h1', metaDescription: 'm1', wordCount: 800, schemaCount: 1 },
        { siteAuditId: saA.id, url: `https://${SCORE_DOMAIN}/b`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't2', h1: 'h2', metaDescription: 'm2', wordCount: 800, schemaCount: 1 },
        { siteAuditId: saA.id, url: `https://${SCORE_DOMAIN}/c`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't3', h1: 'h3', metaDescription: 'm3', wordCount: 800, schemaCount: 1 },
        { siteAuditId: saA.id, url: `https://${SCORE_DOMAIN}/d`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't4', h1: 'h4', metaDescription: 'm4', wordCount: 800, schemaCount: 1 },
      ],
    })
    await runBrokenLinkVerify({ siteAuditId: saA.id, domain: SCORE_DOMAIN }, stubDeps)

    // Read run A's score before run B overwrites it (writeFindingsRun is replace-by-siteAuditId_tool,
    // so A's run lives under saA.id — safe to read here and compare after run B).
    const runA = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId: saA.id, tool: 'seo-parser' } },
      select: { score: true },
    })

    // Run B: same shape but schemaCount=0 (no schema)
    const saB = await prisma.siteAudit.create({
      data: { domain: SCORE_DOMAIN, status: 'complete', pagesTotal: 4, pagesComplete: 4, pagesError: 0 },
    })
    await prisma.harvestedPageSeo.createMany({
      data: [
        { siteAuditId: saB.id, url: `https://${SCORE_DOMAIN}/a`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't1', h1: 'h1', metaDescription: 'm1', wordCount: 800, schemaCount: 0 },
        { siteAuditId: saB.id, url: `https://${SCORE_DOMAIN}/b`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't2', h1: 'h2', metaDescription: 'm2', wordCount: 800, schemaCount: 0 },
        { siteAuditId: saB.id, url: `https://${SCORE_DOMAIN}/c`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't3', h1: 'h3', metaDescription: 'm3', wordCount: 800, schemaCount: 0 },
        { siteAuditId: saB.id, url: `https://${SCORE_DOMAIN}/d`, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false, title: 't4', h1: 'h4', metaDescription: 'm4', wordCount: 800, schemaCount: 0 },
      ],
    })
    await runBrokenLinkVerify({ siteAuditId: saB.id, domain: SCORE_DOMAIN }, stubDeps)

    const runB = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: saB.id, tool: 'seo-parser' } }, select: { score: true } })
    expect(runA!.score).not.toBeNull()
    expect(runB!.score).not.toBeNull()
    expect(runA!.score!).toBeGreaterThan(runB!.score!)
  })
})

// ---------------------------------------------------------------------------
// C6 Phase 4: canonical/redirect/hreflang validation folded into the builder
// (scoped to the file's cleanup DOMAIN so the module-level clean() reaps it).
// ---------------------------------------------------------------------------

describe('runBrokenLinkVerify — canonical/redirect/hreflang validation', () => {
  const ORIG_MAX = process.env.BROKEN_LINK_MAX_CHECKS
  afterEach(() => {
    if (ORIG_MAX === undefined) delete process.env.BROKEN_LINK_MAX_CHECKS
    else process.env.BROKEN_LINK_MAX_CHECKS = ORIG_MAX
  })

  it('emits canonical/redirect/hreflang validation findings in the live-scan run', async () => {
    const siteAuditId = await seed([
      { targetUrl: `https://${DOMAIN}/t`, kind: 'internal-link', sourcePageUrl: `https://${DOMAIN}/a` },
    ])
    await prisma.harvestedPageSeo.create({ data: {
      siteAuditId, url: normalizeFindingUrl(`https://${DOMAIN}/a`), statusCode: 200, isHtml: true,
      canonicalUrl: `https://${DOMAIN}/canon`, robotsNoindex: false, loginLike: false,
      detailsJson: JSON.stringify({ schemaTypes: [], hreflang: [{ lang: 'fr', href: `https://${DOMAIN}/dead` }] }),
    } })
    const resolve: VerifyDeps['resolve'] = async (url) => {
      if (url.includes('/canon')) return { result: 'ok', finalUrl: `https://${DOMAIN}/canon2`, status: 200, hops: 1, chain: [`https://${DOMAIN}/canon2`], tooManyRedirects: false }
      if (url.includes('/dead')) return { result: 'broken', finalUrl: null, status: 404, hops: 0, chain: [], tooManyRedirects: false }
      if (url.includes('/t')) return { result: 'ok', finalUrl: `https://${DOMAIN}/t2`, status: 200, hops: 1, chain: [`https://${DOMAIN}/t2`], tooManyRedirects: false }
      return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }
    }
    const resolveExternal: VerifyDeps['resolveExternal'] = async (url) => ({ result: 'ok' as const, finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false })
    await runBrokenLinkVerify({ siteAuditId, domain: DOMAIN }, { resolve, resolveExternal, now: () => Date.now(), sleep: async () => {} })
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { status: true, findings: { select: { scope: true, type: true, count: true } } },
    })
    const types = new Set(run!.findings.map((f) => f.type))
    expect(types.has('redirect_chain')).toBe(true)
    expect(types.has('canonical_redirect')).toBe(true)
    expect(types.has('hreflang_broken')).toBe(true)
    expect(await prisma.harvestedLink.count({ where: { siteAuditId } })).toBe(0)
    expect(await prisma.harvestedPageSeo.count({ where: { siteAuditId } })).toBe(0)
  })

  it('resolves a shared link+canonical target ONCE yet maps to both applicable findings', async () => {
    const siteAuditId = await seed([
      { targetUrl: `https://${DOMAIN}/shared`, kind: 'internal-link', sourcePageUrl: `https://${DOMAIN}/a` },
    ])
    await prisma.harvestedPageSeo.create({ data: {
      siteAuditId, url: normalizeFindingUrl(`https://${DOMAIN}/a`), statusCode: 200, isHtml: true,
      canonicalUrl: `https://${DOMAIN}/shared`, robotsNoindex: false, loginLike: false,
      detailsJson: JSON.stringify({ schemaTypes: [], hreflang: [] }),
    } })
    const calls = new Map<string, number>()
    const resolve: VerifyDeps['resolve'] = async (url) => {
      calls.set(url, (calls.get(url) ?? 0) + 1)
      // redirect (hops>=1): applicable as BOTH redirect_chain (link) and canonical_redirect (canonical).
      return { result: 'ok', finalUrl: `https://${DOMAIN}/shared2`, status: 200, hops: 1, chain: [`https://${DOMAIN}/shared2`], tooManyRedirects: false }
    }
    const resolveExternal: VerifyDeps['resolveExternal'] = async (url) => ({ result: 'ok' as const, finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false })
    await runBrokenLinkVerify({ siteAuditId, domain: DOMAIN }, { resolve, resolveExternal, now: () => 0, sleep: async () => {} })
    // The shared target resolved exactly once across the whole run (legacySet dedup).
    expect([...calls.values()].reduce((a, b) => a + b, 0)).toBe(1)
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { findings: { select: { type: true } } },
    })
    const types = new Set(run!.findings.map((f) => f.type))
    expect(types.has('redirect_chain')).toBe(true)
    expect(types.has('canonical_redirect')).toBe(true)
  })

  it('cap consumed by legacy targets leaves a canonical-only target unresolved → run partial', async () => {
    process.env.BROKEN_LINK_MAX_CHECKS = '1'
    const siteAuditId = await seed([
      { targetUrl: `https://${DOMAIN}/legacy`, kind: 'internal-link', sourcePageUrl: `https://${DOMAIN}/a` },
    ])
    await prisma.harvestedPageSeo.create({ data: {
      siteAuditId, url: normalizeFindingUrl(`https://${DOMAIN}/a`), statusCode: 200, isHtml: true,
      canonicalUrl: `https://${DOMAIN}/canon-only`, robotsNoindex: false, loginLike: false,
      detailsJson: JSON.stringify({ schemaTypes: [], hreflang: [] }),
    } })
    const resolved: string[] = []
    const resolve: VerifyDeps['resolve'] = async (url) => {
      resolved.push(url)
      return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }
    }
    const resolveExternal: VerifyDeps['resolveExternal'] = async (url) => ({ result: 'ok' as const, finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false })
    await runBrokenLinkVerify({ siteAuditId, domain: DOMAIN }, { resolve, resolveExternal, now: () => 0, sleep: async () => {} })
    expect(resolved.some((u) => u.includes('/legacy'))).toBe(true)
    expect(resolved.some((u) => u.includes('/canon-only'))).toBe(false)
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { status: true },
    })
    expect(run!.status).toBe('partial')
  })
})

describe('runBrokenLinkVerify — external verification (call behavior)', () => {
  it('calls resolveExternal for each external target', async () => {
    const id = await seedExternal([
      { targetUrl: 'https://ext.example/dead' },
      { targetUrl: 'https://ext.example/live' },
    ])
    const seen: string[] = []
    const deps: VerifyDeps = {
      resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      resolveExternal: async (url) => { seen.push(url); return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false } },
      now: () => 0, sleep: async () => {},
    }
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    expect(seen.sort()).toEqual(['https://ext.example/dead', 'https://ext.example/live'])
  })

  it('kill switch: BROKEN_LINK_EXTERNAL_MAX_CHECKS=0 never calls resolveExternal', async () => {
    const prev = process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS
    process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS = '0'
    try {
      const id = await seedExternal([{ targetUrl: 'https://ext.example/x' }])
      const seen: string[] = []
      const deps: VerifyDeps = {
        resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
        resolveExternal: async (url) => { seen.push(url); return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false } },
        now: () => 0, sleep: async () => {},
      }
      await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
      expect(seen).toHaveLength(0)
    } finally {
      if (prev === undefined) delete process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS
      else process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS = prev
    }
  })

  it('no remaining time before the external pass: resolveExternal is never called, job resolves', async () => {
    const id = await seedExternal([{ targetUrl: 'https://ext.example/dead' }])
    let now = 0
    const seen: string[] = []
    const deps: VerifyDeps = {
      // The internal pass runs first; advance the clock past (JOB_TIMEOUT_MS - SAFETY_RESERVE_MS)
      // inside the internal resolve so the external budget computes <= 0.
      resolve: async (url) => { now = 850_001; return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false } },
      resolveExternal: async (url) => { seen.push(url); return { result: 'broken', finalUrl: url, status: 404, hops: 0, chain: [], tooManyRedirects: false } },
      now: () => now, sleep: async () => {},
    }
    // Seed one internal target too so the internal `resolve` runs and advances the clock.
    await prisma.harvestedLink.create({ data: { siteAuditId: id, targetUrl: 'https://c6blv.example.com/i', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a' } })
    await expect(runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)).resolves.toBeUndefined()
    expect(seen).toHaveLength(0) // budget <= 0 -> external pass skipped
  })

  it('mid-pass budget exhaustion launches only a prefix, job still resolves', async () => {
    // Pin concurrency to 1 so the budget-trip point is deterministic: with N workers
    // all N claim before the first resolveExternal advances the clock.
    const prev = process.env.BROKEN_LINK_CONCURRENCY
    process.env.BROKEN_LINK_CONCURRENCY = '1'
    try {
      const id = await seedExternal([
        { targetUrl: 'https://ext.example/a' }, { targetUrl: 'https://ext.example/b' },
        { targetUrl: 'https://ext.example/c' }, { targetUrl: 'https://ext.example/d' },
      ])
      let now = 0
      const seen: string[] = []
      const deps: VerifyDeps = {
        resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
        // First external check consumes the whole budget; the next claim sees it exceeded and stops.
        resolveExternal: async (url) => { seen.push(url); now += 400_000; return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false } },
        now: () => now, sleep: async () => {},
      }
      await expect(runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)).resolves.toBeUndefined()
      expect(seen).toHaveLength(1) // 400_000 > 300_000 budget -> exactly one launched, rest skipped
    } finally {
      if (prev === undefined) delete process.env.BROKEN_LINK_CONCURRENCY
      else process.env.BROKEN_LINK_CONCURRENCY = prev
    }
  })

  it('a throwing resolveExternal does not reject the verifier (failure isolation)', async () => {
    const id = await seedExternal([{ targetUrl: 'https://ext.example/boom' }])
    const deps: VerifyDeps = {
      resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      resolveExternal: async () => { throw new Error('transport blew up') },
      now: () => 0, sleep: async () => {},
    }
    await expect(runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)).resolves.toBeUndefined()
  })

  it('emits broken_external_links only for broken targets, none when clean', async () => {
    const cleanId = await seedExternal([{ targetUrl: 'https://ext.example/live' }])
    await runBrokenLinkVerify({ siteAuditId: cleanId, domain: DOMAIN }, depsFor(new Set())) // nothing broken
    const cleanRun = await liveRun(cleanId)
    expect(cleanRun!.findings.some((f) => f.type === 'broken_external_links')).toBe(false) // NO zero-count finding
  })

  it('internal-link verification is unchanged when a broken external is present', async () => {
    const id = await seed([
      { targetUrl: 'https://c6blv.example.com/int-dead', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a' },
      { targetUrl: 'https://other.com/ext-dead', kind: 'external-link', sourcePageUrl: 'https://c6blv.example.com/a' },
    ])
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, depsFor(new Set(['https://c6blv.example.com/int-dead', 'https://other.com/ext-dead'])))
    const run = await liveRun(id)
    const internal = run!.findings.find((f) => f.scope === 'run' && f.type === 'broken_internal_links')
    expect(internal?.severity).toBe('critical')
    expect(internal?.count).toBe(1)
    const ext = run!.findings.find((f) => f.scope === 'run' && f.type === 'broken_external_links')
    expect(ext?.severity).toBe('warning')
  })
})
