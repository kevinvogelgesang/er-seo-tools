// lib/findings/ada-write.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { writeAdaSiteFindings, writeAdaSingleFindings } from './ada-write'

const DOMAIN = 'ada-write.test'

const AXE_BLOB = JSON.stringify({
  violations: [{
    id: 'image-alt', impact: 'critical', help: 'Images must have alt text',
    description: 'alt', helpUrl: 'https://example.org', tags: ['wcag2a'],
    nodes: [{ html: '<img src="x.png">', target: ['img'] }],
  }],
  passes: [], incomplete: [], inapplicable: [],
  timestamp: '2026-06-10T00:00:00Z', url: `https://${DOMAIN}/`,
  testEngine: { name: 'axe-core', version: '4.10' },
  testRunner: { name: 'er-seo-tools' },
})

async function clearTestState() {
  // Delete by BOTH origin and domain: SetNull origins mean a run whose
  // audit row was deleted is unreachable via siteAuditId/adaAuditId.
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}

describe('writeAdaSiteFindings', () => {
  beforeEach(clearTestState)
  afterEach(clearTestState)

  async function makeCompleteSiteAudit() {
    const site = await prisma.siteAudit.create({
      data: {
        domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa',
        pagesTotal: 2, pagesComplete: 1, pagesError: 1,
        startedAt: new Date(), completedAt: new Date(),
      },
    })
    await prisma.adaAudit.createMany({
      data: [
        { url: `https://${DOMAIN}/a`, status: 'complete', result: AXE_BLOB, siteAuditId: site.id, wcagLevel: 'wcag21aa' },
        { url: `https://${DOMAIN}/b`, status: 'error', error: 'timeout', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
      ],
    })
    return site
  }

  it('maps + persists a run for a complete site audit', async () => {
    const site = await makeCompleteSiteAudit()
    await writeAdaSiteFindings(site.id)
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId: site.id, tool: 'ada-audit' } },
      include: { pages: true, findings: true, violations: true },
    })
    expect(run).not.toBeNull()
    expect(run!.tool).toBe('ada-audit')
    expect(run!.source).toBe('site-audit')
    expect(run!.status).toBe('partial') // pagesError = 1
    expect(run!.pages).toHaveLength(2)
    expect(run!.findings).toHaveLength(1)
    expect(run!.violations).toHaveLength(1)
    expect(run!.violations[0].ruleId).toBe('image-alt')
  })

  it('is idempotent: rewriting the same site audit replaces, never duplicates', async () => {
    const site = await makeCompleteSiteAudit()
    await writeAdaSiteFindings(site.id)
    await writeAdaSiteFindings(site.id)
    const runs = await prisma.crawlRun.findMany({ where: { siteAuditId: site.id } })
    expect(runs).toHaveLength(1)
    expect(await prisma.crawlPage.count({ where: { runId: runs[0].id } })).toBe(2)
    expect(await prisma.violation.count({ where: { runId: runs[0].id } })).toBe(1)
  })

  it('rejects a non-complete site audit', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'running', wcagLevel: 'wcag21aa' },
    })
    await expect(writeAdaSiteFindings(site.id)).rejects.toThrow(/not complete/i)
  })

  it('rejects an unknown id', async () => {
    await expect(writeAdaSiteFindings('nope')).rejects.toThrow(/not found/i)
  })
})

describe('writeAdaSingleFindings', () => {
  beforeEach(clearTestState)
  afterEach(clearTestState)

  it('maps + persists a run for a complete standalone audit', async () => {
    const audit = await prisma.adaAudit.create({
      data: {
        url: `https://${DOMAIN}/solo`, status: 'complete', result: AXE_BLOB,
        wcagLevel: 'wcag21aa', startedAt: new Date(), completedAt: new Date(),
      },
    })
    await writeAdaSingleFindings(audit.id)
    const run = await prisma.crawlRun.findUnique({
      where: { adaAuditId: audit.id },
      include: { pages: true, findings: true, violations: true },
    })
    expect(run).not.toBeNull()
    expect(run!.source).toBe('page-audit')
    expect(run!.pagesTotal).toBe(1)
    expect(run!.pages[0].adaAuditId).toBe(audit.id)
    expect(run!.findings).toHaveLength(1)
    expect(run!.violations).toHaveLength(1)
  })

  it('writes a redirected standalone as a run + one redirected page, no findings', async () => {
    const audit = await prisma.adaAudit.create({
      data: {
        url: `https://${DOMAIN}/old`, status: 'redirected', redirected: true,
        finalUrl: `https://${DOMAIN}/new`, wcagLevel: 'wcag21aa', completedAt: new Date(),
      },
    })
    await writeAdaSingleFindings(audit.id)
    const run = await prisma.crawlRun.findUnique({
      where: { adaAuditId: audit.id },
      include: { pages: true, findings: true },
    })
    expect(run).not.toBeNull()
    expect(run!.score).toBeNull()
    expect(run!.pages).toHaveLength(1)
    expect(run!.pages[0].status).toBe('redirected')
    expect(run!.pages[0].finalUrl).toBe(`https://${DOMAIN}/new`)
    expect(run!.findings).toHaveLength(0)
  })

  it('rejects a site-audit child', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa' },
    })
    const childAudit = await prisma.adaAudit.create({
      data: { url: `https://${DOMAIN}/child`, status: 'complete', result: AXE_BLOB, siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await expect(writeAdaSingleFindings(childAudit.id)).rejects.toThrow(/child/i)
  })

  it('rejects a non-terminal standalone audit', async () => {
    const audit = await prisma.adaAudit.create({
      data: { url: `https://${DOMAIN}/run`, status: 'running', wcagLevel: 'wcag21aa' },
    })
    await expect(writeAdaSingleFindings(audit.id)).rejects.toThrow(/complete|redirected/i)
  })
})
