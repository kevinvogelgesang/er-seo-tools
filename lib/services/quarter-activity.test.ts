// lib/services/quarter-activity.test.ts — derived read-time activity (B5).
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { getQuarterActivity, activityWindowStart } from './quarter-activity'

const PREFIX = 'qact-b5-'
const DOMAIN = 'qact-b5.example'
const NOW = new Date()
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)
const SINCE = daysAgo(30)

async function clear() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.pillarAnalysis.deleteMany({ where: { sessionId: { startsWith: PREFIX } } })
  await prisma.keywordResearchSession.deleteMany({ where: { sessionId: { startsWith: PREFIX } } })
  await prisma.seoRoadmap.deleteMany({ where: { sessionId: { startsWith: PREFIX } } })
  await prisma.session.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}
beforeEach(clear)
afterAll(clear)

function makeClient(tag: string) {
  return prisma.client.create({ data: { name: `${PREFIX}${tag}-${randomUUID().slice(0, 8)}` } })
}

function makeSession(clientId: number, workflow = 'technical') {
  return prisma.session.create({
    data: { id: PREFIX + randomUUID(), status: 'complete', workflow, files: '[]', siteName: DOMAIN, clientId },
  })
}

function makeRun(clientId: number, opts: { tool?: string; sessionId?: string; completedAt?: Date; status?: string } = {}) {
  return prisma.crawlRun.create({
    data: {
      tool: opts.tool ?? 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId,
      sessionId: opts.sessionId, status: opts.status ?? 'complete', pagesTotal: 1,
      completedAt: opts.completedAt ?? daysAgo(2),
    },
  })
}

describe('getQuarterActivity', () => {
  it('maps seo-parser and ada-audit CrawlRuns to kinds', async () => {
    const c = await makeClient('runs')
    const s = await makeSession(c.id)
    await makeRun(c.id, { sessionId: s.id, completedAt: daysAgo(5) })
    await makeRun(c.id, { tool: 'ada-audit', completedAt: daysAgo(1) })
    const map = await getQuarterActivity([c.id], SINCE)
    const a = map.get(c.id)!
    expect(a.kinds['seo-parse']).toBeTruthy()
    expect(a.kinds['ada-audit']).toBeTruthy()
    expect(a.latest.kind).toBe('ada-audit')
  })

  it('excludes keyword-research-workflow parses from seo-parse', async () => {
    const c = await makeClient('kw')
    const s = await makeSession(c.id, 'keyword-research')
    await makeRun(c.id, { sessionId: s.id })
    const map = await getQuarterActivity([c.id], SINCE)
    expect(map.get(c.id)).toBeUndefined()
  })

  it('maps roadmap, keyword memo, and pillar completions', async () => {
    const c = await makeClient('memos')
    const s1 = await makeSession(c.id)
    const s2 = await makeSession(c.id, 'keyword-research')
    const s3 = await makeSession(c.id)
    await prisma.seoRoadmap.create({ data: { id: PREFIX + randomUUID(), sessionId: s1.id, status: 'complete', roadmapUpdatedAt: daysAgo(3) } })
    await prisma.keywordResearchSession.create({ data: { id: PREFIX + randomUUID(), sessionId: s2.id, clientId: c.id, status: 'complete', memoUpdatedAt: daysAgo(2) } })
    await prisma.pillarAnalysis.create({ data: { id: PREFIX + randomUUID(), sessionId: s3.id, status: 'complete', narrativeUpdatedAt: daysAgo(1) } })
    const map = await getQuarterActivity([c.id], SINCE)
    const a = map.get(c.id)!
    expect(a.kinds['seo-roadmap']).toBeTruthy()
    expect(a.kinds['keyword-memo']).toBeTruthy()
    expect(a.kinds['pillar-analysis']).toBeTruthy()
    expect(a.latest.kind).toBe('pillar-analysis')
  })

  it('latest derivation is insertion-order independent', async () => {
    const c = await makeClient('order')
    await makeRun(c.id, { tool: 'ada-audit', completedAt: daysAgo(10) })
    await makeRun(c.id, { completedAt: daysAgo(1) }) // seo-parse, newer, inserted later
    const map = await getQuarterActivity([c.id], SINCE)
    expect(map.get(c.id)!.latest.kind).toBe('seo-parse')
  })

  it('excludes out-of-window and incomplete rows, and unrelated clients', async () => {
    const c = await makeClient('window')
    const other = await makeClient('other')
    await makeRun(c.id, { completedAt: daysAgo(60) }) // before SINCE
    await makeRun(c.id, { status: 'error', completedAt: daysAgo(1) })
    await makeRun(other.id, { completedAt: daysAgo(1) })
    const map = await getQuarterActivity([c.id], SINCE)
    expect(map.get(c.id)).toBeUndefined()
    expect(map.has(other.id)).toBe(false) // not requested
  })

  it('returns empty map for empty input', async () => {
    expect((await getQuarterActivity([], SINCE)).size).toBe(0)
  })
})

describe('activityWindowStart', () => {
  it('prefers parsed startDate, falls back to createdAt', () => {
    const createdAt = new Date('2026-05-01T12:00:00Z')
    expect(activityWindowStart({ startDate: '2026-06-15', createdAt }).getFullYear()).toBe(2026)
    expect(activityWindowStart({ startDate: '2026-06-15', createdAt }).getMonth()).toBe(5)
    expect(activityWindowStart({ startDate: null, createdAt })).toBe(createdAt)
    expect(activityWindowStart({ startDate: 'garbage', createdAt })).toBe(createdAt)
  })
})
