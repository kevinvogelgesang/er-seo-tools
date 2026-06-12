// lib/services/client-dashboard.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { getClientDashboard, TIMELINE_CAP } from './client-dashboard'

const PREFIX = 'test-dash-'
const DOMAIN = 'client-dash-test.example'
const NOW = new Date()
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

async function clearTestState() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.seoRoadmap.deleteMany({ where: { sessionId: { startsWith: PREFIX } } })
  await prisma.keywordResearchSession.deleteMany({ where: { sessionId: { startsWith: PREFIX } } })
  await prisma.pillarAnalysis.deleteMany({ where: { sessionId: { startsWith: PREFIX } } })
  await prisma.session.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  await prisma.schedule.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}
beforeEach(clearTestState)
afterAll(clearTestState)

function makeClient() {
  return prisma.client.create({
    data: {
      name: `${PREFIX}${randomUUID().slice(0, 8)}`,
      domains: JSON.stringify([DOMAIN, 'alt.example']),
      seedUrls: JSON.stringify([`https://${DOMAIN}/`]),
      teamworkTasklistId: 'tw-123',
    },
  })
}

describe('getClientDashboard', () => {
  it('returns null client for unknown id', async () => {
    const d = await getClientDashboard(99999999, NOW)
    expect(d.client).toBeNull()
  })

  it('empty client yields a valid empty shape', async () => {
    const c = await makeClient()
    const d = await getClientDashboard(c.id, NOW)
    expect(d.client!.name).toBe(c.name)
    expect(d.client!.domains).toEqual([DOMAIN, 'alt.example'])
    expect(d.client!.teamworkTasklistId).toBe('tw-123')
    expect(d.seo.series.latest).toBeNull()
    expect(d.ada.series.latest).toBeNull()
    expect(d.pillar.series.latest).toBeNull()
    expect(d.seoCounts).toBeNull()
    expect(d.timeline).toEqual([])
    expect(d.schedules).toEqual([])
  })

  it('builds all six timeline item types with correct hrefs, newest first', async () => {
    const c = await makeClient()
    const tech = await prisma.session.create({
      data: {
        id: PREFIX + randomUUID(), status: 'complete', workflow: 'technical', files: '[]',
        siteName: DOMAIN, clientId: c.id, createdAt: daysAgo(6),
        totalUrls: 100, criticalCount: 5, warningCount: 10, noticeCount: 20,
      },
    })
    const kw = await prisma.session.create({
      data: {
        id: PREFIX + randomUUID(), status: 'complete', workflow: 'keyword-research', files: '[]',
        siteName: DOMAIN, clientId: c.id, createdAt: daysAgo(5),
      },
    })
    await prisma.pillarAnalysis.create({ data: { sessionId: tech.id, status: 'complete', score: 7, createdAt: daysAgo(4) } })
    await prisma.seoRoadmap.create({ data: { sessionId: tech.id, status: 'complete', createdAt: daysAgo(3) } })
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: c.id, pagesTotal: 23, createdAt: daysAgo(2), completedAt: daysAgo(2) } })
    const ada = await prisma.adaAudit.create({ data: { url: `https://${DOMAIN}/x`, status: 'complete', clientId: c.id, score: 91, createdAt: daysAgo(1), completedAt: daysAgo(1) } })

    const d = await getClientDashboard(c.id, NOW)
    const types = d.timeline.map((t) => t.type)
    expect(types).toEqual(['ada-audit', 'site-audit', 'seo-roadmap', 'pillar-analysis', 'keyword-research', 'seo-parse'])
    const byType = Object.fromEntries(d.timeline.map((t) => [t.type, t]))
    expect(byType['seo-parse'].href).toBe(`/seo-parser/results/${tech.id}`)
    expect(byType['keyword-research'].href).toBe(`/keyword-research/${kw.id}`)
    expect(byType['site-audit'].href).toBe(`/ada-audit/site/${sa.id}`)
    expect(byType['ada-audit'].href).toBe(`/ada-audit/${ada.id}`)
    expect(byType['seo-roadmap'].href).toBe(`/seo-parser/results/${tech.id}`)
    expect(byType['pillar-analysis'].href).toMatch(/^\/pillar-analysis\//)
    expect(byType['site-audit'].stat).toBe('23 pages')
  })

  it(`caps the timeline at ${TIMELINE_CAP}`, async () => {
    const c = await makeClient()
    for (let i = 0; i < TIMELINE_CAP + 5; i++) {
      await prisma.adaAudit.create({
        data: { url: `https://${DOMAIN}/p${i}`, status: 'complete', clientId: c.id, createdAt: daysAgo(i) },
      })
    }
    const d = await getClientDashboard(c.id, NOW)
    expect(d.timeline).toHaveLength(TIMELINE_CAP)
  })

  it('orphaned CrawlRun contributes a score point but no timeline row; latestHref null', async () => {
    const c = await makeClient()
    const s = await prisma.session.create({
      data: { id: PREFIX + randomUUID(), status: 'complete', workflow: 'technical', files: '[]', siteName: DOMAIN, clientId: c.id, createdAt: daysAgo(2) },
    })
    await prisma.crawlRun.create({
      data: { tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId: c.id, sessionId: s.id, status: 'complete', score: 85, pagesTotal: 1, completedAt: daysAgo(2) },
    })
    await prisma.session.delete({ where: { id: s.id } }) // SetNull → orphan run keeps clientId

    const d = await getClientDashboard(c.id, NOW)
    expect(d.seo.series.latest).toBe(85)
    expect(d.seo.latestHref).toBeNull()
    expect(d.timeline.filter((t) => t.type === 'seo-parse')).toHaveLength(0)
  })

  it('standalone ADA timeline stat prefers the CrawlRun score over the (usually null) legacy column', async () => {
    const c = await makeClient()
    const ada = await prisma.adaAudit.create({
      data: { url: `https://${DOMAIN}/scored`, status: 'complete', clientId: c.id, score: null, createdAt: daysAgo(1), completedAt: daysAgo(1) },
    })
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'page-audit', domain: DOMAIN, clientId: c.id, adaAuditId: ada.id, status: 'complete', score: 77, pagesTotal: 1, completedAt: daysAgo(1) },
    })
    const d = await getClientDashboard(c.id, NOW)
    expect(d.timeline.find((t) => t.type === 'ada-audit')!.stat).toBe('Score 77')
  })

  it('seoCounts from the latest complete technical session with counts; schedules listed', async () => {
    const c = await makeClient()
    await prisma.session.create({
      data: {
        id: PREFIX + randomUUID(), status: 'complete', workflow: 'technical', files: '[]',
        siteName: DOMAIN, clientId: c.id, createdAt: daysAgo(1),
        totalUrls: 200, criticalCount: 3, warningCount: 7, noticeCount: 9,
      },
    })
    await prisma.schedule.create({
      data: { jobType: 'site-audit-discover', cadence: 'weekly:1@09:00', nextRunAt: daysAgo(-7), clientId: c.id },
    })
    const d = await getClientDashboard(c.id, NOW)
    expect(d.seoCounts).toEqual({ totalUrls: 200, criticalCount: 3, warningCount: 7, noticeCount: 9, at: expect.any(String) })
    expect(d.schedules).toHaveLength(1)
    expect(d.schedules[0].cadence).toBe('weekly:1@09:00')
  })

  it('tags schedule-originated site audits in the timeline title; manual audits stay bare (C2)', async () => {
    const c = await makeClient()
    const sched = await prisma.schedule.create({
      data: { jobType: 'scheduled-site-audit', cadence: 'weekly:1@06:00', payload: '{}', nextRunAt: daysAgo(-7), clientId: c.id },
    })
    await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa', clientId: c.id, scheduleId: sched.id, createdAt: daysAgo(2), completedAt: daysAgo(2) },
    })
    await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa', clientId: c.id, createdAt: daysAgo(1), completedAt: daysAgo(1) },
    })
    const d = await getClientDashboard(c.id, NOW)
    const titles = d.timeline.filter((t) => t.type === 'site-audit').map((t) => t.title)
    expect(titles).toEqual([DOMAIN, `${DOMAIN} · scheduled`]) // newest (manual) first
  })
})
