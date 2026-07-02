// lib/services/client-fleet.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { getClientFleet } from './client-fleet'
import { SCORE_DROP_THRESHOLD } from './scorecard-shared'

const PREFIX = 'test-fleet-'
const DOMAIN = 'client-fleet-test.example'
const NOW = new Date()
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

async function clearTestState() {
  // CrawlRuns by test domain FIRST (SetNull origins make some unreachable via FK).
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.pillarAnalysis.deleteMany({ where: { sessionId: { startsWith: PREFIX } } })
  await prisma.session.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}
beforeEach(clearTestState)
afterAll(clearTestState)

function makeClient(tag: string) {
  return prisma.client.create({
    data: { name: `${PREFIX}${tag}-${randomUUID().slice(0, 8)}`, domains: JSON.stringify([DOMAIN]) },
  })
}

function makeSession(clientId: number, opts: { status?: string; workflow?: string; createdAt?: Date } = {}) {
  return prisma.session.create({
    data: {
      id: PREFIX + randomUUID(),
      status: opts.status ?? 'complete',
      workflow: opts.workflow ?? 'technical',
      files: '[]',
      siteName: DOMAIN,
      clientId,
      createdAt: opts.createdAt ?? daysAgo(1),
    },
  })
}

function makeSeoRun(clientId: number, sessionId: string, score: number, completedAt: Date) {
  return prisma.crawlRun.create({
    data: {
      tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId, sessionId,
      status: 'complete', score, pagesTotal: 1, completedAt, createdAt: completedAt,
    },
  })
}

describe('getClientFleet', () => {
  it('excludes archived clients', async () => {
    const live = await makeClient('live')
    const archived = await prisma.client.create({
      data: { name: `${PREFIX}archived-${randomUUID().slice(0, 8)}`, domains: JSON.stringify([DOMAIN]), archivedAt: new Date() },
    })
    const rows = await getClientFleet(NOW)
    expect(rows.some((r) => r.id === live.id)).toBe(true)
    expect(rows.some((r) => r.id === archived.id)).toBe(false)
  })

  it('groups interleaved runs by client and computes deltas', async () => {
    const a = await makeClient('a')
    const b = await makeClient('b')
    const sa1 = await makeSession(a.id, { createdAt: daysAgo(10) })
    const sb1 = await makeSession(b.id, { createdAt: daysAgo(9) })
    const sa2 = await makeSession(a.id, { createdAt: daysAgo(2) })
    await makeSeoRun(a.id, sa1.id, 80, daysAgo(10))
    await makeSeoRun(b.id, sb1.id, 70, daysAgo(9))
    await makeSeoRun(a.id, sa2.id, 90, daysAgo(2))

    const rows = await getClientFleet(NOW)
    const rowA = rows.find((r) => r.id === a.id)!
    const rowB = rows.find((r) => r.id === b.id)!
    expect(rowA.seo.latest).toBe(90)
    expect(rowA.seo.delta).toBe(10)
    expect(rowB.seo.latest).toBe(70)
    expect(rowB.seo.delta).toBeNull()
    expect(rowA.firstDomain).toBe(DOMAIN)
  })

  it('excludes keyword-research sessions from the SEO series', async () => {
    const c = await makeClient('kw')
    const tech = await makeSession(c.id, { createdAt: daysAgo(5) })
    const kw = await makeSession(c.id, { workflow: 'keyword-research', createdAt: daysAgo(1) })
    await makeSeoRun(c.id, tech.id, 80, daysAgo(5))
    await makeSeoRun(c.id, kw.id, 99, daysAgo(1)) // keyword runs DO get CrawlRuns — must not pollute
    const row = (await getClientFleet(NOW)).find((r) => r.id === c.id)!
    expect(row.seo.latest).toBe(80)
    expect(row.seo.points).toHaveLength(1)
  })

  it('ADA: site-audit runs win; page fallback merges legacy non-null scores deduped by origin id', async () => {
    const siteClient = await makeClient('site')
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: siteClient.id, completedAt: daysAgo(1) } })
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', domain: DOMAIN, clientId: siteClient.id, siteAuditId: sa.id, status: 'complete', score: 88, pagesTotal: 5, completedAt: daysAgo(1) },
    })

    const pageClient = await makeClient('page')
    const ada1 = await prisma.adaAudit.create({ data: { url: `https://${DOMAIN}/a`, status: 'complete', clientId: pageClient.id, score: 75, completedAt: daysAgo(2) } })
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'page-audit', domain: DOMAIN, clientId: pageClient.id, adaAuditId: ada1.id, status: 'complete', score: 75, pagesTotal: 1, completedAt: daysAgo(2) },
    })
    // legacy-only audit (no CrawlRun) with a persisted score
    await prisma.adaAudit.create({ data: { url: `https://${DOMAIN}/b`, status: 'complete', clientId: pageClient.id, score: 60, completedAt: daysAgo(8) } })

    const rows = await getClientFleet(NOW)
    const siteRow = rows.find((r) => r.id === siteClient.id)!
    expect(siteRow.adaSource).toBe('site')
    expect(siteRow.ada.latest).toBe(88)
    const pageRow = rows.find((r) => r.id === pageClient.id)!
    expect(pageRow.adaSource).toBe('page')
    expect(pageRow.ada.points.map((p) => p.score)).toEqual([60, 75]) // ada1 NOT double-counted
    expect(pageRow.ada.delta).toBe(15)
  })

  it('missing scores are null (not 0) and pillar comes from latest complete analysis', async () => {
    const c = await makeClient('empty')
    const row = (await getClientFleet(NOW)).find((r) => r.id === c.id)!
    expect(row.seo.latest).toBeNull()
    expect(row.ada.latest).toBeNull()
    expect(row.pillarScore).toBeNull()

    const p = await makeClient('pillar')
    const s1 = await makeSession(p.id, { createdAt: daysAgo(10) })
    const s2 = await makeSession(p.id, { createdAt: daysAgo(2) })
    await prisma.pillarAnalysis.create({ data: { sessionId: s1.id, status: 'complete', score: 4, createdAt: daysAgo(10) } })
    await prisma.pillarAnalysis.create({ data: { sessionId: s2.id, status: 'complete', score: 7, createdAt: daysAgo(2) } })
    const pRow = (await getClientFleet(NOW)).find((r) => r.id === p.id)!
    expect(pRow.pillarScore).toBe(7)
  })

  it('error alert comes from origin-row status; stale alert from inactivity', async () => {
    const err = await makeClient('err')
    await makeSession(err.id, { status: 'complete', createdAt: daysAgo(10) })
    await makeSession(err.id, { status: 'error', createdAt: daysAgo(1) }) // latest technical parse errored
    const errRow = (await getClientFleet(NOW)).find((r) => r.id === err.id)!
    expect(errRow.alerts.some((a) => a.kind === 'error')).toBe(true)

    const stale = await makeClient('stale')
    await makeSession(stale.id, { createdAt: daysAgo(45) })
    const staleRow = (await getClientFleet(NOW)).find((r) => r.id === stale.id)!
    expect(staleRow.alerts.some((a) => a.kind === 'stale')).toBe(true)

    const fresh = await makeClient('fresh')
    const fs = await makeSession(fresh.id, { createdAt: daysAgo(1) })
    await makeSeoRun(fresh.id, fs.id, 90, daysAgo(1))
    const freshRow = (await getClientFleet(NOW)).find((r) => r.id === fresh.id)!
    expect(freshRow.alerts).toEqual([])
  })

  it('keyword-research errors surface as their own errored tool', async () => {
    const c = await makeClient('kwerr')
    await makeSession(c.id, { createdAt: daysAgo(2) }) // healthy technical parse
    await makeSession(c.id, { workflow: 'keyword-research', status: 'error', createdAt: daysAgo(1) })
    const row = (await getClientFleet(NOW)).find((r) => r.id === c.id)!
    expect(row.alerts.some((a) => a.kind === 'error' && a.detail.startsWith('keyword research'))).toBe(true)
  })

  it('score-drop alert fires on the SEO delta threshold', async () => {
    const c = await makeClient('drop')
    const s1 = await makeSession(c.id, { createdAt: daysAgo(10) })
    const s2 = await makeSession(c.id, { createdAt: daysAgo(1) })
    await makeSeoRun(c.id, s1.id, 90, daysAgo(10))
    await makeSeoRun(c.id, s2.id, 90 - SCORE_DROP_THRESHOLD, daysAgo(1))
    const row = (await getClientFleet(NOW)).find((r) => r.id === c.id)!
    expect(row.alerts.some((a) => a.kind === 'score-drop')).toBe(true)
  })

  it('Issues counts: distinct types by severity across both tools; null without runs', async () => {
    const c = await makeClient('issues')
    const s = await makeSession(c.id, { createdAt: daysAgo(1) })
    const seoRun = await makeSeoRun(c.id, s.id, 80, daysAgo(1))
    await prisma.finding.create({
      data: { runId: seoRun.id, scope: 'run', type: 'broken_pages', severity: 'critical', count: 9, dedupKey: randomUUID() },
    })
    await prisma.finding.create({
      data: { runId: seoRun.id, scope: 'run', type: 'thin_content', severity: 'warning', count: 30, dedupKey: randomUUID() },
    })
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: c.id, completedAt: daysAgo(1) } })
    const adaRun = await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', domain: DOMAIN, clientId: c.id, siteAuditId: sa.id, status: 'complete', score: 85, pagesTotal: 2, completedAt: daysAgo(1) },
    })
    // mixed severities on ONE rule — must collapse to a single critical type (Codex fix #3)
    await prisma.finding.create({
      data: { runId: adaRun.id, scope: 'page', type: 'color-contrast', severity: 'warning', url: `https://${DOMAIN}/a`, dedupKey: randomUUID() },
    })
    await prisma.finding.create({
      data: { runId: adaRun.id, scope: 'page', type: 'color-contrast', severity: 'critical', url: `https://${DOMAIN}/b`, dedupKey: randomUUID() },
    })
    // Hypothetical run-scope ADA row must be ignored by the scope guard (Codex plan-fix #4)
    await prisma.finding.create({
      data: { runId: adaRun.id, scope: 'run', type: 'phantom-rule', severity: 'critical', count: 1, dedupKey: randomUUID() },
    })

    const row = (await getClientFleet(NOW)).find((r) => r.id === c.id)!
    expect(row.openCritical).toBe(2)  // broken_pages + color-contrast (collapsed); phantom-rule ignored
    expect(row.openWarning).toBe(1)   // thin_content

    const empty = await makeClient('noissues')
    const emptyRow = (await getClientFleet(NOW)).find((r) => r.id === empty.id)!
    expect(emptyRow.openCritical).toBeNull()
    expect(emptyRow.openWarning).toBeNull()
  })

  // ── Task 9: canonical SEO selector tests ─────────────────────────────────

  it('Task 9: seoIntent live-scan is the canonical score in the fleet when no sf-upload exists', async () => {
    const c = await makeClient('canon-live')
    const sa = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', clientId: c.id, completedAt: daysAgo(1) },
    })
    await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'live-scan', seoIntent: true, domain: DOMAIN,
        clientId: c.id, siteAuditId: sa.id,
        status: 'complete', score: 67, pagesTotal: 15, completedAt: daysAgo(1),
      },
    })
    const row = (await getClientFleet(NOW)).find((r) => r.id === c.id)!
    expect(row.seo.latest).toBe(67)
  })

  it('Task 9: fresh sf-upload wins over seoIntent live-scan in the fleet', async () => {
    const c = await makeClient('canon-sf')
    const s = await makeSession(c.id, { createdAt: daysAgo(2) })
    await makeSeoRun(c.id, s.id, 92, daysAgo(2))  // sf-upload, 2 days old → fresh
    const sa = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', clientId: c.id, completedAt: daysAgo(1) },
    })
    await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'live-scan', seoIntent: true, domain: DOMAIN,
        clientId: c.id, siteAuditId: sa.id,
        status: 'complete', score: 50, pagesTotal: 15, completedAt: daysAgo(1),
      },
    })
    const row = (await getClientFleet(NOW)).find((r) => r.id === c.id)!
    expect(row.seo.latest).toBe(92)   // SF wins; live-scan score (50) not surfaced in canonical
  })

  it('regression alert: new critical type vs previous run fires; no previous → never fires', async () => {
    const reg = await makeClient('reg')
    const s1 = await makeSession(reg.id, { createdAt: daysAgo(10) })
    const r1 = await makeSeoRun(reg.id, s1.id, 85, daysAgo(10))
    await prisma.finding.create({
      data: { runId: r1.id, scope: 'run', type: 'thin_content', severity: 'warning', count: 5, dedupKey: randomUUID() },
    })
    const s2 = await makeSession(reg.id, { createdAt: daysAgo(1) })
    const r2 = await makeSeoRun(reg.id, s2.id, 84, daysAgo(1))
    await prisma.finding.create({
      data: { runId: r2.id, scope: 'run', type: 'broken_pages', severity: 'critical', count: 3, dedupKey: randomUUID() },
    })
    const regRow = (await getClientFleet(NOW)).find((r) => r.id === reg.id)!
    expect(regRow.alerts.some((a) => a.kind === 'regression')).toBe(true)

    const first = await makeClient('first')
    const fs = await makeSession(first.id, { createdAt: daysAgo(1) })
    const fr = await makeSeoRun(first.id, fs.id, 84, daysAgo(1))
    await prisma.finding.create({
      data: { runId: fr.id, scope: 'run', type: 'broken_pages', severity: 'critical', count: 3, dedupKey: randomUUID() },
    })
    const firstRow = (await getClientFleet(NOW)).find((r) => r.id === first.id)!
    expect(firstRow.alerts.some((a) => a.kind === 'regression')).toBe(false)
  })
})
