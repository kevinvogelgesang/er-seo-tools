// scripts/retire-client-schedules.test.ts
//
// DB-backed test for the C2 retirement ops script (against the exported
// function, NOT the CLI wrapper). Mirrors the DELETE-route semantics:
// cancel queued jobs by group, delete the Schedule row, historical audits
// SetNull to manual-class. pruneScheduledSiteAudits runs first (keeps the
// latest 2 completed per (schedule,domain), so seeded audits survive).
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'
import { retireClientSchedules } from './retire-client-schedules'

const PREFIX = 'retire-c2-test-'
const createdJobIds: string[] = []

async function cleanup() {
  await prisma.job.deleteMany({ where: { id: { in: createdJobIds } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } }) // cascades schedules
}

beforeEach(cleanup)
afterAll(cleanup)

describe('retireClientSchedules', () => {
  it('deletes client schedules, cancels their queued jobs, SetNulls historical audits, prunes, and is idempotent', async () => {
    const client = await prisma.client.create({
      data: { name: `${PREFIX}client`, domains: JSON.stringify([`${PREFIX}a.example.edu`]) },
    })
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE,
        clientId: client.id,
        cadence: 'weekly:1@06:00',
        payload: JSON.stringify({ clientId: client.id, domain: `${PREFIX}a.example.edu`, wcagLevel: 'wcag21aa' }),
        nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    const job = await prisma.job.create({
      data: {
        type: SCHEDULED_SITE_AUDIT_JOB_TYPE,
        status: 'queued',
        payload: '{}',
        groupKey: `schedule:${sched.id}`,
        scheduleId: sched.id,
        scheduledFor: new Date(),
      },
    })
    createdJobIds.push(job.id)
    // Two old completed audits — within KEEP_LATEST_COMPLETED=2 so prune keeps them.
    const auditA = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}a.example.edu`, status: 'complete', wcagLevel: 'wcag21aa', scheduleId: sched.id, completedAt: new Date('2020-01-01T00:00:00Z') },
    })
    const auditB = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}a.example.edu`, status: 'complete', wcagLevel: 'wcag21aa', scheduleId: sched.id, completedAt: new Date('2020-02-01T00:00:00Z') },
    })
    // Third audit: OLDER than the 90-day weekly retention window AND beyond the
    // keep-latest-2 floor. The prune predicate keys on createdAt (not just
    // completedAt), so both are backdated — it must be DELETED by the prune
    // before the schedule link is severed.
    const auditC = await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}a.example.edu`,
        status: 'complete',
        wcagLevel: 'wcag21aa',
        scheduleId: sched.id,
        completedAt: new Date('2019-01-01T00:00:00Z'),
        createdAt: new Date('2019-01-01T00:00:00Z'),
      },
    })

    const { retired } = await retireClientSchedules()
    expect(retired).toBeGreaterThanOrEqual(1)

    // The out-of-window third audit was PRUNED (deleted), not merely SetNull'd.
    expect(await prisma.siteAudit.findUnique({ where: { id: auditC.id } })).toBeNull()

    // Schedule row gone.
    expect(await prisma.schedule.findUnique({ where: { id: sched.id } })).toBeNull()
    // Queued job cancelled.
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('cancelled')
    // Historical audits survive with scheduleId SetNull'd.
    const freshA = await prisma.siteAudit.findUnique({ where: { id: auditA.id } })
    const freshB = await prisma.siteAudit.findUnique({ where: { id: auditB.id } })
    expect(freshA).not.toBeNull()
    expect(freshA?.scheduleId).toBeNull()
    expect(freshB).not.toBeNull()
    expect(freshB?.scheduleId).toBeNull()

    // Idempotent: a second run does not resurrect or re-retire our schedule.
    await retireClientSchedules()
    expect(await prisma.schedule.count({ where: { clientId: client.id } })).toBe(0)
    expect((await prisma.siteAudit.findUnique({ where: { id: auditA.id } }))?.scheduleId).toBeNull()
  })
})
