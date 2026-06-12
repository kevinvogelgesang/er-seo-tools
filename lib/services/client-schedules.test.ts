// lib/services/client-schedules.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { getClientSchedules } from './client-schedules'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'

const PREFIX = 'c2sched-svc-'
let clientId: number

beforeAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } }) // cascades stale schedules
  const client = await prisma.client.create({
    data: { name: `${PREFIX}client`, domains: JSON.stringify([`${PREFIX}a.example.edu`]) },
  })
  clientId = client.id
})

afterAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } }) // cascades schedules
})

async function makeScheduledAudit(scheduleId: string, createdAt: Date, status: string, score: number | null) {
  const audit = await prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}a.example.edu`, status, wcagLevel: 'wcag21aa',
      scheduleId, createdAt, completedAt: status === 'complete' ? createdAt : null,
    },
  })
  if (score !== null) {
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', status: 'complete', domain: `${PREFIX}a.example.edu`, siteAuditId: audit.id, score },
    })
  }
  return audit
}

describe('getClientSchedules', () => {
  it('returns [] for a client with no schedules', async () => {
    expect(await getClientSchedules(clientId)).toEqual([])
  })

  it('joins last run + CrawlRun score + delta vs previous completed scheduled run', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'weekly:1@06:00',
        payload: JSON.stringify({ clientId, domain: `${PREFIX}a.example.edu`, wcagLevel: 'wcag22aa' }),
        nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    await makeScheduledAudit(sched.id, new Date('2026-04-01T00:00:00Z'), 'complete', 70)
    await makeScheduledAudit(sched.id, new Date('2026-05-01T00:00:00Z'), 'complete', 82)

    const rows = await getClientSchedules(clientId)
    expect(rows).toHaveLength(1)
    expect(rows[0].domain).toBe(`${PREFIX}a.example.edu`)
    expect(rows[0].wcagLevel).toBe('wcag22aa')
    expect(rows[0].cadence).toBe('weekly:1@06:00')
    expect(rows[0].enabled).toBe(true)
    expect(rows[0].lastRun?.score).toBe(82)
    expect(rows[0].lastDelta).toBe(12)
  })

  it('lastDelta is null when the latest run is not complete or only one scored run exists', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'monthly:1@06:00',
        payload: JSON.stringify({ clientId, domain: `${PREFIX}a.example.edu`, wcagLevel: 'wcag21aa' }),
        nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    await makeScheduledAudit(sched.id, new Date('2026-05-20T00:00:00Z'), 'complete', 75)
    const oneRun = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)!
    expect(oneRun.lastRun?.score).toBe(75)
    expect(oneRun.lastDelta).toBeNull()

    await makeScheduledAudit(sched.id, new Date('2026-06-01T00:00:00Z'), 'error', null)
    const afterError = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)!
    expect(afterError.lastRun?.status).toBe('error')
    expect(afterError.lastDelta).toBeNull()
  })

  it('does not surface non-scan schedules attached to the client', async () => {
    await prisma.schedule.create({
      data: { jobType: 'cleanup', clientId, cadence: 'daily@09:00', payload: '{}', nextRunAt: new Date('2099-01-01T00:00:00Z') },
    })
    const rows = await getClientSchedules(clientId)
    expect(rows.every((r) => r.cadence !== 'daily@09:00')).toBe(true)
  })

  it('renders a row with empty domain on malformed payload instead of throwing', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'weekly:2@07:00',
        payload: '{nope', nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    const row = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)
    expect(row).toBeDefined()
    expect(row!.domain).toBe('')
    expect(row!.wcagLevel).toBe('wcag21aa')
  })
})
