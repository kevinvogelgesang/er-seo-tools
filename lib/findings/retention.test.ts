// lib/findings/retention.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { deleteAuditArtifacts } from '@/lib/ada-audit/screenshot-helpers'
import { pruneArchivedBlobs, ARCHIVE_WINDOW_MS, PRUNE_ACTIVATED } from './retention'

// Artifact deletion is mocked — retention tests must never touch the
// uploads/screenshots filesystem.
vi.mock('@/lib/ada-audit/screenshot-helpers', () => ({
  deleteAuditArtifacts: vi.fn().mockResolvedValue([]),
}))

const DOMAIN = 'retention-test.example'
const ID_PREFIX = 'test-findings-retention-'
const NOW = new Date('2026-06-11T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const OLD = new Date(NOW.getTime() - ARCHIVE_WINDOW_MS - DAY_MS) // 91 d before NOW
const RECENT = new Date(NOW.getTime() - DAY_MS) // 1 d before NOW

const SEO_ON = { 'seo-parser': true, 'ada-audit': false } as const
const ADA_ON = { 'seo-parser': false, 'ada-audit': true } as const

async function clearTestState() {
  // Delete runs by domain FIRST (SetNull origins make some unreachable via FK),
  // then origin rows by test-unique id prefix / domain / url.
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: { startsWith: ID_PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}

async function makeSeoRun(opts: {
  completedAt?: Date | null
  archivePrunedAt?: Date
  result?: string | null
} = {}) {
  const session = await prisma.session.create({
    data: {
      id: ID_PREFIX + randomUUID(),
      status: 'complete',
      files: '[]',
      siteName: DOMAIN,
      totalUrls: 42,
      result: opts.result !== undefined ? opts.result : '{"blob":true}',
    },
  })
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN,
      sessionId: session.id, status: 'complete', score: 81, pagesTotal: 3,
      completedAt: opts.completedAt !== undefined ? opts.completedAt : OLD,
      archivePrunedAt: opts.archivePrunedAt ?? null,
    },
  })
  return { session, run }
}

async function makeSiteAuditRun(opts: { completedAt?: Date | null; children?: number } = {}) {
  const siteAudit = await prisma.siteAudit.create({
    data: { domain: DOMAIN, status: 'complete', summary: '{"blob":true}', score: 90 },
  })
  const children = []
  for (let i = 0; i < (opts.children ?? 0); i++) {
    children.push(await prisma.adaAudit.create({
      data: {
        url: `https://${DOMAIN}/page-${randomUUID()}`,
        status: 'complete',
        result: '{"blob":true}',
        lighthouseSummary: '{"lh":true}',
        siteAuditId: siteAudit.id,
      },
    }))
  }
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'ada-audit', source: 'site-audit', domain: DOMAIN,
      siteAuditId: siteAudit.id, status: 'complete', score: 90, pagesTotal: 5,
      completedAt: opts.completedAt !== undefined ? opts.completedAt : OLD,
    },
  })
  return { siteAudit, run, children }
}

async function makeStandaloneAdaRun(opts: { completedAt?: Date | null } = {}) {
  const adaAudit = await prisma.adaAudit.create({
    data: { url: `https://${DOMAIN}/`, status: 'complete', result: '{"blob":true}', score: 95 },
  })
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'ada-audit', source: 'page-audit', domain: DOMAIN,
      adaAuditId: adaAudit.id, status: 'complete', score: 95, pagesTotal: 1,
      completedAt: opts.completedAt !== undefined ? opts.completedAt : OLD,
    },
  })
  return { adaAudit, run }
}

describe('pruneArchivedBlobs', () => {
  beforeEach(async () => {
    vi.mocked(deleteAuditArtifacts).mockClear()
    vi.mocked(deleteAuditArtifacts).mockResolvedValue([])
    await clearTestState()
  })
  afterEach(clearTestState)

  // C3: ada-audit flipped (all readers fall back to findings tables);
  // seo-parser stays inert until C5 flips its last blob reader.
  it('default activation: seo-parser false, ada-audit true', () => {
    expect(PRUNE_ACTIVATED['seo-parser']).toBe(false)
    expect(PRUNE_ACTIVATED['ada-audit']).toBe(true)
  })

  it('default (seo-parser gated-off) prunes no seo-parser runs, even eligible ones', async () => {
    const { session, run } = await makeSeoRun()
    await pruneArchivedBlobs(NOW)
    const s = await prisma.session.findUniqueOrThrow({ where: { id: session.id } })
    const r = await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(s.result).toBe('{"blob":true}')
    expect(r.archivePrunedAt).toBeNull()
  })

  it('activated seo-parser prunes a >90d run: blob nulled, scalars kept, archivePrunedAt = now', async () => {
    const { session, run } = await makeSeoRun()
    await pruneArchivedBlobs(NOW, SEO_ON)
    const s = await prisma.session.findUniqueOrThrow({ where: { id: session.id } })
    const r = await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(s.result).toBeNull()
    expect(s.siteName).toBe(DOMAIN) // scalars untouched
    expect(s.totalUrls).toBe(42)
    expect(s.status).toBe('complete')
    expect(r.archivePrunedAt?.getTime()).toBe(NOW.getTime())
    expect(r.score).toBe(81) // run scalars untouched
    expect(r.pagesTotal).toBe(3)
  })

  it('leaves runs younger than the window untouched', async () => {
    const { session, run } = await makeSeoRun({ completedAt: RECENT })
    await pruneArchivedBlobs(NOW, SEO_ON)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).result).toBe('{"blob":true}')
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } })).archivePrunedAt).toBeNull()
  })

  it('never prunes a run with null completedAt', async () => {
    const { run } = await makeSeoRun({ completedAt: null })
    await pruneArchivedBlobs(NOW, SEO_ON)
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } })).archivePrunedAt).toBeNull()
  })

  it('skips already-pruned runs (archivePrunedAt and blob left alone)', async () => {
    const stamped = new Date(NOW.getTime() - 10 * DAY_MS)
    // Sentinel blob proves the origin update is not re-applied.
    const { session, run } = await makeSeoRun({ archivePrunedAt: stamped, result: 'sentinel' })
    await pruneArchivedBlobs(NOW, SEO_ON)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).result).toBe('sentinel')
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } })).archivePrunedAt?.getTime()).toBe(stamped.getTime())
  })

  it('skips runs whose origin row was deleted (SetNull FK)', async () => {
    const { session, run } = await makeSeoRun()
    await prisma.session.delete({ where: { id: session.id } }) // FK SetNull
    await pruneArchivedBlobs(NOW, SEO_ON)
    const r = await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(r.sessionId).toBeNull()
    expect(r.archivePrunedAt).toBeNull()
  })

  it('activated ada-audit prunes SiteAudit.summary (site runs) and AdaAudit.result (standalone)', async () => {
    const site = await makeSiteAuditRun()
    const standalone = await makeStandaloneAdaRun()
    await pruneArchivedBlobs(NOW, ADA_ON)
    const sa = await prisma.siteAudit.findUniqueOrThrow({ where: { id: site.siteAudit.id } })
    const aa = await prisma.adaAudit.findUniqueOrThrow({ where: { id: standalone.adaAudit.id } })
    expect(sa.summary).toBeNull()
    expect(sa.score).toBe(90) // scalars untouched
    expect(sa.status).toBe('complete')
    expect(aa.result).toBeNull()
    expect(aa.score).toBe(95)
    for (const id of [site.run.id, standalone.run.id]) {
      expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id } })).archivePrunedAt?.getTime()).toBe(NOW.getTime())
    }
  })

  it('activated ada-audit prunes child AdaAudit.result blobs but KEEPS lighthouseSummary', async () => {
    const site = await makeSiteAuditRun({ children: 3 })
    const standalone = await makeStandaloneAdaRun()
    await pruneArchivedBlobs(NOW, ADA_ON)
    const sa = await prisma.siteAudit.findUniqueOrThrow({ where: { id: site.siteAudit.id } })
    expect(sa.summary).toBeNull()
    for (const child of site.children) {
      const c = await prisma.adaAudit.findUniqueOrThrow({ where: { id: child.id } })
      expect(c.result).toBeNull()
      expect(c.lighthouseSummary).toBe('{"lh":true}') // diff baselines survive pruning
      expect(c.status).toBe('complete')
    }
    const aa = await prisma.adaAudit.findUniqueOrThrow({ where: { id: standalone.adaAudit.id } })
    expect(aa.result).toBeNull()
    for (const id of [site.run.id, standalone.run.id]) {
      expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id } })).archivePrunedAt?.getTime()).toBe(NOW.getTime())
    }
  })

  it('deletes screenshot artifacts once per pruned child + standalone origin, never for recent audits', async () => {
    const oldSite = await makeSiteAuditRun({ children: 3 })
    const standalone = await makeStandaloneAdaRun()
    const recentSite = await makeSiteAuditRun({ completedAt: RECENT, children: 2 })
    await pruneArchivedBlobs(NOW, ADA_ON)
    const calledIds = vi.mocked(deleteAuditArtifacts).mock.calls.map(([id]) => id)
    const expectedIds = [standalone.adaAudit.id, ...oldSite.children.map((c) => c.id)]
    expect(calledIds.sort()).toEqual(expectedIds.sort())
    for (const recentChild of recentSite.children) {
      expect(calledIds).not.toContain(recentChild.id)
    }
  })

  it('an artifact-deletion rejection does not throw (warn-and-continue)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      vi.mocked(deleteAuditArtifacts).mockRejectedValue(new Error('disk gone'))
      const site = await makeSiteAuditRun({ children: 2 })
      await expect(pruneArchivedBlobs(NOW, ADA_ON)).resolves.toBeUndefined()
      // DB pruning still committed despite artifact failures.
      const sa = await prisma.siteAudit.findUniqueOrThrow({ where: { id: site.siteAudit.id } })
      expect(sa.summary).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to delete screenshot artifacts'))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('activated ada-audit leaves recent (<90d) site audits and their children untouched', async () => {
    const site = await makeSiteAuditRun({ completedAt: RECENT, children: 2 })
    await pruneArchivedBlobs(NOW, ADA_ON)
    expect((await prisma.siteAudit.findUniqueOrThrow({ where: { id: site.siteAudit.id } })).summary).toBe('{"blob":true}')
    for (const child of site.children) {
      expect((await prisma.adaAudit.findUniqueOrThrow({ where: { id: child.id } })).result).toBe('{"blob":true}')
    }
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: site.run.id } })).archivePrunedAt).toBeNull()
  })

  it('activation is per-tool: seo-parser on leaves ada runs untouched (and vice versa)', async () => {
    const seo = await makeSeoRun()
    const site = await makeSiteAuditRun()
    await pruneArchivedBlobs(NOW, SEO_ON)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: seo.session.id } })).result).toBeNull()
    expect((await prisma.siteAudit.findUniqueOrThrow({ where: { id: site.siteAudit.id } })).summary).toBe('{"blob":true}')
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: site.run.id } })).archivePrunedAt).toBeNull()
  })

  it('prunes more rows than one chunk (chunking does not drop or duplicate work)', async () => {
    const made = await Promise.all(Array.from({ length: 120 }, () => makeSeoRun()))
    await pruneArchivedBlobs(NOW, SEO_ON)
    const pruned = await prisma.crawlRun.count({
      where: { domain: DOMAIN, archivePrunedAt: { not: null } },
    })
    expect(pruned).toBe(120)
    const blobsLeft = await prisma.session.count({
      where: { id: { startsWith: ID_PREFIX }, result: { not: null } },
    })
    expect(blobsLeft).toBe(0)
    expect(made).toHaveLength(120)
  })
})
