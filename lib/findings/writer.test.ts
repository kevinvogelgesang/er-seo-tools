// lib/findings/writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from './writer'
import type { FindingsBundle } from './types'

const SESSION_ID = 'test-findings-writer-session'

function bundle(nPages: number, nFindings: number): FindingsBundle {
  const runId = randomUUID()
  const pages = Array.from({ length: nPages }, (_, i) => ({
    id: randomUUID(), runId, url: `https://w.test/p${i}`,
    status: null, error: null, finalUrl: null, statusCode: null,
    title: `t${i}`, h1: null, metaDescription: null,
    wordCount: null, crawlDepth: null, indexable: true, score: null, adaAuditId: null,
  }))
  const findings = Array.from({ length: nFindings }, (_, i) => ({
    id: randomUUID(), runId,
    pageId: pages.length ? pages[i % pages.length].id : null,
    scope: 'page' as const, type: 'test_issue', severity: 'warning' as const,
    url: `https://w.test/p${i % Math.max(pages.length, 1)}`,
    count: 1, affectedComplete: null, affectedSource: null, detail: null,
    dedupKey: `test-key-${i}`,
  }))
  return {
    run: {
      id: runId, tool: 'seo-parser', source: 'sf-upload', domain: 'w.test',
      clientId: null, sessionId: SESSION_ID, siteAuditId: null, adaAuditId: null,
      status: 'complete', score: 50, wcagLevel: null, pagesTotal: nPages,
      startedAt: null, completedAt: new Date(),
    },
    pages, findings, violations: [],
  }
}

async function clearTestState() {
  // Delete by BOTH origin and domain: SetNull origins mean a run whose
  // Session was deleted is unreachable via sessionId.
  await prisma.crawlRun.deleteMany({
    where: { OR: [{ sessionId: SESSION_ID }, { domain: 'w.test' }] },
  })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

describe('writeFindingsRun', () => {
  beforeEach(async () => {
    await clearTestState()
    await prisma.session.create({
      data: { id: SESSION_ID, status: 'complete', files: '[]' },
    })
  })
  afterEach(clearTestState)

  it('persists run + pages + findings', async () => {
    await writeFindingsRun(bundle(3, 5))
    const run = await prisma.crawlRun.findUnique({
      where: { sessionId: SESSION_ID },
      include: { pages: true, findings: true, violations: true },
    })
    expect(run).not.toBeNull()
    expect(run!.pages).toHaveLength(3)
    expect(run!.findings).toHaveLength(5)
    expect(run!.violations).toHaveLength(0)
  })

  it('is idempotent: rewriting the same origin replaces, never duplicates', async () => {
    await writeFindingsRun(bundle(3, 5))
    await writeFindingsRun(bundle(2, 2))
    const runs = await prisma.crawlRun.findMany({ where: { sessionId: SESSION_ID } })
    expect(runs).toHaveLength(1)
    expect(await prisma.crawlPage.count({ where: { runId: runs[0].id } })).toBe(2)
    expect(await prisma.finding.count({ where: { runId: runs[0].id } })).toBe(2)
    // old subtree fully gone
    expect(await prisma.crawlPage.count({ where: { run: { sessionId: SESSION_ID } } })).toBe(2)
  })

  it('rolls back atomically on a bad bundle, preserving the existing run', async () => {
    await writeFindingsRun(bundle(2, 3))
    const bad = bundle(1, 2)
    bad.findings[1].dedupKey = bad.findings[0].dedupKey // violates @@unique([runId, dedupKey])
    await expect(writeFindingsRun(bad)).rejects.toThrow()
    // the transaction rolled back: the ORIGINAL run + subtree are intact
    const run = await prisma.crawlRun.findUnique({
      where: { sessionId: SESSION_ID },
      include: { pages: true, findings: true },
    })
    expect(run).not.toBeNull()
    expect(run!.pages).toHaveLength(2)
    expect(run!.findings).toHaveLength(3)
  })

  it('handles bundles larger than one chunk (50 rows)', async () => {
    await writeFindingsRun(bundle(80, 160))
    const run = await prisma.crawlRun.findUnique({
      where: { sessionId: SESSION_ID }, include: { pages: true, findings: true },
    })
    expect(run!.pages).toHaveLength(80)
    expect(run!.findings).toHaveLength(160)
  })

  it('rejects a bundle without exactly one origin', async () => {
    const none = bundle(0, 0)
    none.run.sessionId = null
    await expect(writeFindingsRun(none)).rejects.toThrow(/exactly one origin/i)

    const two = bundle(0, 0)
    two.run.siteAuditId = 'also-set'
    await expect(writeFindingsRun(two)).rejects.toThrow(/exactly one origin/i)
  })

  it('run survives origin deletion with sessionId nulled', async () => {
    await writeFindingsRun(bundle(1, 1))
    await prisma.session.delete({ where: { id: SESSION_ID } })
    const runs = await prisma.crawlRun.findMany({ where: { domain: 'w.test' } })
    expect(runs).toHaveLength(1)
    expect(runs[0].sessionId).toBeNull() // clearTestState reaches it by domain
  })

  it('persists CrawlPage.faqEvidence verbatim — writer intentionally needs no change (KS-4)', async () => {
    const runId = randomUUID()
    const b: FindingsBundle = {
      run: {
        id: runId, tool: 'seo-parser', source: 'sf-upload', domain: 'w.test',
        clientId: null, sessionId: SESSION_ID, siteAuditId: null, adaAuditId: null,
        status: 'complete', score: 50, wcagLevel: null, pagesTotal: 2,
        startedAt: null, completedAt: new Date(),
      },
      pages: [
        {
          id: randomUUID(), runId, url: 'https://w.test/a',
          status: null, error: null, finalUrl: null, statusCode: null,
          title: 'a', h1: null, metaDescription: null,
          wordCount: null, crawlDepth: null, indexable: true, score: null,
          passCount: null, incompleteCount: null, faqEvidence: 'present:schema', adaAuditId: null,
        },
        {
          id: randomUUID(), runId, url: 'https://w.test/b',
          status: null, error: null, finalUrl: null, statusCode: null,
          title: 'b', h1: null, metaDescription: null,
          wordCount: null, crawlDepth: null, indexable: true, score: null,
          passCount: null, incompleteCount: null, faqEvidence: null, adaAuditId: null,
        },
      ],
      findings: [],
      violations: [],
    }
    await writeFindingsRun(b)
    const rows = await prisma.crawlPage.findMany({ where: { runId }, orderBy: { url: 'asc' } })
    expect(rows.map((r) => r.faqEvidence)).toEqual(['present:schema', null])
  })
})
