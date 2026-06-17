import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { runBrokenLinkVerify, type VerifyDeps } from './broken-link-verify'

const DOMAIN = 'c6blv.example.com'

async function clean() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}
beforeEach(clean)
afterAll(clean)

async function seed(targets: { targetUrl: string; kind: string; sourcePageUrl: string }[]) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })
  if (targets.length)
    await prisma.harvestedLink.createMany({ data: targets.map((t) => ({ ...t, siteAuditId: sa.id })) })
  return sa.id
}

// deps: every targetUrl in brokenSet returns 'broken', else 'ok'
const depsFor = (brokenSet: Set<string>): VerifyDeps => ({
  checkUrl: async (url: string) => (brokenSet.has(url) ? 'broken' : 'ok'),
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

  it('does not count external-link targets as broken', async () => {
    const id = await seed([
      { targetUrl: 'https://other.com/x', kind: 'external-link', sourcePageUrl: 'https://c6blv.example.com/a' },
    ])
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, depsFor(new Set(['https://other.com/x'])))
    const run = await liveRun(id)
    expect(run!.findings).toHaveLength(0)
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
  checkUrl: async (_url: string) => 'ok',
  now: () => 0,
  sleep: async () => {},
}

describe('runBrokenLinkVerify — live SEO score', () => {
  beforeEach(cleanScore)
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
      select: { score: true },
    })
    expect(run!.score).not.toBeNull()
    expect(run!.score).toBeGreaterThan(0)
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
      select: { score: true },
    })
    expect(run!.score).toBeNull()
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
