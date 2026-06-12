// app/api/site-audit/[id]/vpat/route.test.ts — DB-backed (real prisma).
// Run: DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/site-audit/[id]/vpat/route.test.ts"
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET } from './route'

const PREFIX = 'c4vpat-'

const siteAuditIds: string[] = []
const crawlRunIds: string[] = []

beforeAll(async () => {
  // Pre-clean leftovers from crashed runs — by unique prefix only.
  // CrawlRuns FIRST (SetNull origins make some unreachable via FK).
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
})

afterAll(async () => {
  // Cleanup ONLY what this run created. CrawlRun before origin SiteAudit;
  // CrawlPage/Finding/Violation cascade from CrawlRun.
  await prisma.crawlRun.deleteMany({ where: { id: { in: crawlRunIds } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: siteAuditIds } } })
})

async function seedSiteAudit(opts: { domain: string; status: string; wcagLevel?: string }) {
  const sa = await prisma.siteAudit.create({
    data: {
      domain: opts.domain,
      status: opts.status,
      wcagLevel: opts.wcagLevel ?? 'wcag21aa',
      pagesTotal: 2,
      completedAt: opts.status === 'complete' ? new Date() : null,
    },
  })
  siteAuditIds.push(sa.id)
  return sa
}

async function seedRunWithViolation(siteAuditId: string, domain: string) {
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'ada-audit', source: 'site-audit', domain, siteAuditId,
      status: 'complete', score: 85, pagesTotal: 2, wcagLevel: 'wcag21aa', completedAt: new Date(),
    },
  })
  crawlRunIds.push(run.id)
  const page = await prisma.crawlPage.create({
    data: { runId: run.id, url: `https://${domain}/`, status: 'complete' },
  })
  const finding = await prisma.finding.create({
    data: {
      runId: run.id, pageId: page.id, scope: 'page', type: 'image-alt',
      severity: 'critical', url: `https://${domain}/`, dedupKey: randomUUID(),
    },
  })
  await prisma.violation.create({
    data: {
      findingId: finding.id, runId: run.id, pageId: page.id,
      ruleId: 'image-alt', impact: 'critical',
      wcagTags: JSON.stringify(['wcag2a', 'wcag111']),
      help: 'Images must have alternative text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/image-alt',
      nodeCount: 1,
    },
  })
  return run
}

async function callGET(id: string) {
  return GET(new NextRequest(`http://localhost/api/site-audit/${id}/vpat`), {
    params: Promise.resolve({ id }),
  })
}

describe('GET /api/site-audit/[id]/vpat', () => {
  it('returns 200 markdown with Does Not Support for the seeded violation', async () => {
    const domain = `${PREFIX}a.example.com`
    const sa = await seedSiteAudit({ domain, status: 'complete' })
    await seedRunWithViolation(sa.id, domain)

    const res = await callGET(sa.id)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(res.headers.get('content-disposition')).toContain(`vpat-scaffold-${domain}-`)
    const md = await res.text()
    expect(md).toContain('**This is a scaffold, not a legal VPAT/ACR.**')
    const r111 = md.split('\n').find((l) => l.startsWith('| 1.1.1 '))!
    expect(r111).toContain('Does Not Support')
    expect(r111).toContain('image-alt')
    expect(r111).toContain('critical')
    // wcag21aa audit → 2.2 criteria omitted, scope note rendered
    expect(md).toContain('not in scan scope')
    expect(md).not.toContain('| 2.5.8 ')
  })

  it('returns 404 for an unknown id', async () => {
    const res = await callGET('c4vpat-does-not-exist')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Site audit not found' })
  })

  it('returns 409 not_complete for a non-complete audit', async () => {
    const sa = await seedSiteAudit({ domain: `${PREFIX}b.example.com`, status: 'running' })
    const res = await callGET(sa.id)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not_complete' })
  })

  it('returns 409 no_findings_run for a complete audit without a CrawlRun', async () => {
    const sa = await seedSiteAudit({ domain: `${PREFIX}c.example.com`, status: 'complete' })
    const res = await callGET(sa.id)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'no_findings_run' })
  })
})
