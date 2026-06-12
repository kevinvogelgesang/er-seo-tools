// lib/ada-audit/scheduled-retention.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { pruneScheduledSiteAudits, RETENTION_DAYS } from './scheduled-retention'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'

const PREFIX = 'c2sched-r-'
const NOW = new Date('2026-06-12T00:00:00Z')
const DAY_MS = 86_400_000

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS)
}

const createdScheduleIds: string[] = []

async function makeSchedule(cadence: string) {
  const sched = await prisma.schedule.create({
    data: { jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, cadence, payload: '{}', nextRunAt: new Date('2099-01-01T00:00:00Z') },
  })
  createdScheduleIds.push(sched.id)
  return sched
}

async function makeAudit(opts: {
  scheduleId: string | null
  status: string
  createdAt: Date
  domain?: string
  withChildren?: boolean
}) {
  const audit = await prisma.siteAudit.create({
    data: {
      domain: opts.domain ?? `${PREFIX}site.example.edu`,
      status: opts.status,
      wcagLevel: 'wcag21aa',
      scheduleId: opts.scheduleId,
      createdAt: opts.createdAt,
      completedAt: opts.status === 'complete' ? opts.createdAt : null,
    },
  })
  if (opts.withChildren) {
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}site.example.edu/p`, status: 'complete', siteAuditId: audit.id, wcagLevel: 'wcag21aa' },
    })
    await prisma.siteAuditCheck.create({
      data: { siteAuditId: audit.id, scope: 'page', key: 'f'.repeat(64) },
    })
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', status: 'complete', domain: `${PREFIX}site.example.edu`, siteAuditId: audit.id, score: 90 },
    })
    return { audit, childId: child.id }
  }
  return { audit, childId: null }
}

async function cleanPrefixRows() {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

beforeAll(cleanPrefixRows) // survive a failed prior run

afterAll(async () => {
  await cleanPrefixRows()
  await prisma.schedule.deleteMany({ where: { id: { in: createdScheduleIds } } })
})

describe('pruneScheduledSiteAudits', () => {
  it('prunes past-window terminal scheduled audits; children cascade, CrawlRun survives via SetNull', async () => {
    const sched = await makeSchedule('weekly:1@06:00')
    const { audit, childId } = await makeAudit({
      scheduleId: sched.id, status: 'complete', createdAt: daysAgo(RETENTION_DAYS.weekly + 10), withChildren: true,
    })
    // two newer completed audits so the keep-latest guard doesn't save it
    await makeAudit({ scheduleId: sched.id, status: 'complete', createdAt: daysAgo(2) })
    await makeAudit({ scheduleId: sched.id, status: 'complete', createdAt: daysAgo(1) })

    await pruneScheduledSiteAudits(NOW)

    expect(await prisma.siteAudit.findUnique({ where: { id: audit.id } })).toBeNull()
    expect(await prisma.adaAudit.findUnique({ where: { id: childId! } })).toBeNull() // cascaded
    expect(await prisma.siteAuditCheck.count({ where: { siteAuditId: audit.id } })).toBe(0) // checks cascaded too
    const run = await prisma.crawlRun.findFirst({ where: { domain: `${PREFIX}site.example.edu` } })
    expect(run).not.toBeNull()
    expect(run!.siteAuditId).toBeNull() // SetNull — findings/trends survive
    expect(run!.score).toBe(90)
  })

  it('keeps the 2 most recent completed audits regardless of age', async () => {
    const sched = await makeSchedule('weekly:1@06:00')
    const old1 = await makeAudit({ scheduleId: sched.id, status: 'complete', createdAt: daysAgo(400), domain: `${PREFIX}keep.example.edu` })
    const old2 = await makeAudit({ scheduleId: sched.id, status: 'complete', createdAt: daysAgo(300), domain: `${PREFIX}keep.example.edu` })
    await pruneScheduledSiteAudits(NOW)
    expect(await prisma.siteAudit.findUnique({ where: { id: old1.audit.id } })).not.toBeNull()
    expect(await prisma.siteAudit.findUnique({ where: { id: old2.audit.id } })).not.toBeNull()
  })

  it('never prunes non-terminal scheduled audits', async () => {
    const sched = await makeSchedule('weekly:1@06:00')
    const running = await makeAudit({ scheduleId: sched.id, status: 'running', createdAt: daysAgo(400), domain: `${PREFIX}run.example.edu` })
    await pruneScheduledSiteAudits(NOW)
    expect(await prisma.siteAudit.findUnique({ where: { id: running.audit.id } })).not.toBeNull()
  })

  it('never touches manual audits (scheduleId null)', async () => {
    await makeSchedule('weekly:1@06:00') // a schedule exists, but these rows aren't its
    const manual = await makeAudit({ scheduleId: null, status: 'complete', createdAt: daysAgo(800), domain: `${PREFIX}manual.example.edu` })
    await pruneScheduledSiteAudits(NOW)
    expect(await prisma.siteAudit.findUnique({ where: { id: manual.audit.id } })).not.toBeNull()
  })

  it('window is cadence-aware: a 100-day-old audit dies under weekly but survives under monthly', async () => {
    const weekly = await makeSchedule('weekly:1@06:00')
    const monthly = await makeSchedule('monthly:1@06:00')
    const underWeekly = await makeAudit({ scheduleId: weekly.id, status: 'error', createdAt: daysAgo(100), domain: `${PREFIX}w.example.edu` })
    const underMonthly = await makeAudit({ scheduleId: monthly.id, status: 'error', createdAt: daysAgo(100), domain: `${PREFIX}m.example.edu` })
    await pruneScheduledSiteAudits(NOW)
    expect(await prisma.siteAudit.findUnique({ where: { id: underWeekly.audit.id } })).toBeNull()
    expect(await prisma.siteAudit.findUnique({ where: { id: underMonthly.audit.id } })).not.toBeNull()
  })

  it('error/cancelled audits are pruned by the window without the completed-keep guard', async () => {
    const sched = await makeSchedule('weekly:1@06:00')
    const errored = await makeAudit({ scheduleId: sched.id, status: 'error', createdAt: daysAgo(120), domain: `${PREFIX}err.example.edu` })
    const cancelled = await makeAudit({ scheduleId: sched.id, status: 'cancelled', createdAt: daysAgo(120), domain: `${PREFIX}err.example.edu` })
    await pruneScheduledSiteAudits(NOW)
    expect(await prisma.siteAudit.findUnique({ where: { id: errored.audit.id } })).toBeNull()
    expect(await prisma.siteAudit.findUnique({ where: { id: cancelled.audit.id } })).toBeNull()
  })

  it('unparseable cadence falls back to the most conservative (monthly) window', async () => {
    const sched = await makeSchedule('weekly:1@06:00')
    // corrupt the cadence after creation (bypasses any validation)
    await prisma.schedule.update({ where: { id: sched.id }, data: { cadence: 'garbage' } })
    const audit = await makeAudit({ scheduleId: sched.id, status: 'error', createdAt: daysAgo(100), domain: `${PREFIX}g.example.edu` })
    await pruneScheduledSiteAudits(NOW)
    expect(await prisma.siteAudit.findUnique({ where: { id: audit.audit.id } })).not.toBeNull() // 100d < 365d
  })
})
