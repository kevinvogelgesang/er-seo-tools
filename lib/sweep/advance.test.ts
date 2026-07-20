// lib/sweep/advance.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { advanceManualSweeps, recoverManualSweeps } from './advance'
import type { MemberOutcome } from './types'

beforeEach(async () => {
  await prisma.job.deleteMany({ where: { type: 'manual-sweep' } })
  await prisma.crawlRun.deleteMany({})
  await prisma.siteAudit.deleteMany({})
  await prisma.weeklySweep.deleteMany({})
})

// --- fixtures --------------------------------------------------------------

async function makeAudit(opts: {
  status: string
  ada?: boolean
  seo?: boolean
  seoOnly?: boolean
  domain?: string
}): Promise<string> {
  const audit = await prisma.siteAudit.create({
    data: { domain: opts.domain ?? 'x.edu', status: opts.status, seoOnly: opts.seoOnly ?? false },
    select: { id: true },
  })
  if (opts.ada) {
    await prisma.crawlRun.create({ data: { tool: 'ada-audit', source: 'site-audit', status: 'complete', siteAuditId: audit.id } })
  }
  if (opts.seo) {
    await prisma.crawlRun.create({ data: { tool: 'seo-parser', source: 'live-scan', status: 'complete', siteAuditId: audit.id } })
  }
  return audit.id
}

interface MemberSpec { domain: string; siteAuditId: string | null; outcome: MemberOutcome; clientId?: number }

async function makeManualSweep(members: MemberSpec[], opts?: { fanoutCompletedAt?: Date; scheduledFor?: Date }) {
  const scheduledFor = opts?.scheduledFor ?? new Date('2031-03-05T15:00:00Z')
  const membership = {
    v: 1 as const,
    expectedCount: members.length,
    members: members.map((m, i) => ({
      clientId: m.clientId ?? i + 1,
      clientName: `C${i + 1}`,
      domain: m.domain,
      siteAuditId: m.siteAuditId,
      outcome: m.outcome,
    })),
  }
  return prisma.weeklySweep.create({
    data: {
      scheduledFor,
      origin: 'manual',
      startedAt: scheduledFor,
      fanoutCompletedAt: opts?.fanoutCompletedAt ?? scheduledFor,
      membershipJson: JSON.stringify(membership),
    },
    select: { id: true, scheduledFor: true },
  })
}

async function snapshotJsonOf(id: number): Promise<string | null> {
  const row = await prisma.weeklySweep.findUnique({ where: { id }, select: { snapshotJson: true } })
  return row?.snapshotJson ?? null
}

// --- advanceManualSweeps ---------------------------------------------------

describe('advanceManualSweeps', () => {
  it('does NOT publish while a complete member has only the seo-parser run (missing ADA run)', async () => {
    const sa = await makeAudit({ status: 'complete', seo: true, ada: false })
    const sweep = await makeManualSweep([{ domain: 'a.edu', siteAuditId: sa, outcome: 'enqueued' }])
    await advanceManualSweeps(new Date('2031-03-05T15:05:00Z'))
    expect(await snapshotJsonOf(sweep.id)).toBeNull()
  })

  it('publishes once BOTH ada-audit AND seo-parser runs exist (digestSentAt stays null)', async () => {
    const sa = await makeAudit({ status: 'complete', ada: true, seo: true })
    const sweep = await makeManualSweep([{ domain: 'a.edu', siteAuditId: sa, outcome: 'enqueued' }])
    await advanceManualSweeps(new Date('2031-03-05T15:05:00Z'))
    expect(await snapshotJsonOf(sweep.id)).not.toBeNull()
    const row = await prisma.weeklySweep.findUnique({ where: { id: sweep.id } })
    expect(row?.digestSentAt).toBeNull()
  })

  it('a running member blocks drain', async () => {
    const sa = await makeAudit({ status: 'running' })
    const sweep = await makeManualSweep([{ domain: 'a.edu', siteAuditId: sa, outcome: 'enqueued' }])
    await advanceManualSweeps(new Date('2031-03-05T15:05:00Z'))
    expect(await snapshotJsonOf(sweep.id)).toBeNull()
  })

  it('skipped-archived/delisted members do not block drain', async () => {
    const sa = await makeAudit({ status: 'complete', ada: true, seo: true })
    const sweep = await makeManualSweep([
      { domain: 'a.edu', siteAuditId: sa, outcome: 'enqueued' },
      { domain: 'gone.edu', siteAuditId: null, outcome: 'skipped-archived' },
    ])
    await advanceManualSweeps(new Date('2031-03-05T15:05:00Z'))
    expect(await snapshotJsonOf(sweep.id)).not.toBeNull()
  })

  it('invalid-domain / error null-id members settle failed (do not block)', async () => {
    const sa = await makeAudit({ status: 'complete', ada: true, seo: true })
    const sweep = await makeManualSweep([
      { domain: 'a.edu', siteAuditId: sa, outcome: 'enqueued' },
      { domain: 'bad.edu', siteAuditId: null, outcome: 'invalid-domain' },
      { domain: 'err.edu', siteAuditId: null, outcome: 'error' },
    ])
    await advanceManualSweeps(new Date('2031-03-05T15:05:00Z'))
    expect(await snapshotJsonOf(sweep.id)).not.toBeNull()
  })

  it('a residual pending null-id member blocks until max-wait', async () => {
    const sweep = await makeManualSweep([{ domain: 'p.edu', siteAuditId: null, outcome: 'pending' }])
    await advanceManualSweeps(new Date('2031-03-05T15:05:00Z'))
    expect(await snapshotJsonOf(sweep.id)).toBeNull()
  })

  it('a set siteAuditId whose audit row is GONE settles failed (does not block)', async () => {
    const sweep = await makeManualSweep([{ domain: 'ghost.edu', siteAuditId: 'nonexistent-id', outcome: 'enqueued' }])
    await advanceManualSweeps(new Date('2031-03-05T15:05:00Z'))
    expect(await snapshotJsonOf(sweep.id)).not.toBeNull()
  })

  it('max-wait exceeded publishes anyway (fanoutCompletedAt-anchored)', async () => {
    const sa = await makeAudit({ status: 'running' })
    const fanoutAt = new Date('2031-03-05T00:00:00Z')
    const sweep = await makeManualSweep([{ domain: 'a.edu', siteAuditId: sa, outcome: 'enqueued' }], { fanoutCompletedAt: fanoutAt })
    // 14h after fanout > 13h max-wait
    await advanceManualSweeps(new Date('2031-03-05T14:30:00Z'))
    expect(await snapshotJsonOf(sweep.id)).not.toBeNull()
  })

  it('an already-snapshotted row is not a candidate (untouched)', async () => {
    const sweep = await prisma.weeklySweep.create({
      data: { scheduledFor: new Date('2031-03-06T15:00:00Z'), origin: 'manual', fanoutCompletedAt: new Date(), snapshotJson: '{"v":1,"x":1}' },
      select: { id: true },
    })
    await advanceManualSweeps(new Date())
    expect(await snapshotJsonOf(sweep.id)).toBe('{"v":1,"x":1}')
  })

  it('a corrupt (non-null unparseable) membership on a fanout-completed row is abandoned (deleted)', async () => {
    await prisma.weeklySweep.create({
      data: { scheduledFor: new Date('2031-03-07T15:00:00Z'), origin: 'manual', membershipJson: '{bad', fanoutCompletedAt: new Date() },
    })
    await advanceManualSweeps(new Date())
    expect(await prisma.weeklySweep.count({ where: { origin: 'manual' } })).toBe(0)
  })
})

// --- recoverManualSweeps ---------------------------------------------------

describe('recoverManualSweeps', () => {
  it('re-enqueues a manual-sweep job for an AGED membership-null row with NO job ever landed', async () => {
    const created = new Date('2031-04-01T10:00:00Z')
    await prisma.weeklySweep.create({ data: { scheduledFor: created, origin: 'manual', createdAt: created } })
    await recoverManualSweeps(new Date(created.getTime() + 10 * 60_000)) // past grace
    expect(await prisma.job.count({ where: { type: 'manual-sweep' } })).toBe(1)
  })

  it('does NOT re-enqueue a FRESH membership-null row (inside the grace window)', async () => {
    const created = new Date('2031-04-02T10:00:00Z')
    await prisma.weeklySweep.create({ data: { scheduledFor: created, origin: 'manual', createdAt: created } })
    await recoverManualSweeps(new Date(created.getTime() + 30_000)) // 30s < 2min grace
    expect(await prisma.job.count({ where: { type: 'manual-sweep' } })).toBe(0)
  })

  it('abandons the membership-null row when a TERMINAL job exists (no infinite re-enqueue)', async () => {
    const created = new Date('2031-04-03T10:00:00Z')
    const iso = created.toISOString()
    await prisma.weeklySweep.create({ data: { scheduledFor: created, origin: 'manual', createdAt: created } })
    await prisma.job.create({ data: { type: 'manual-sweep', groupKey: `manual-sweep:${iso}`, status: 'error', payload: '{}' } })
    await recoverManualSweeps(new Date(created.getTime() + 10 * 60_000))
    expect(await prisma.weeklySweep.count({ where: { origin: 'manual' } })).toBe(0)
    expect(await prisma.job.count({ where: { type: 'manual-sweep', status: { in: ['queued', 'running'] } } })).toBe(0)
  })

  it('leaves a row alone while an ACTIVE job exists', async () => {
    const created = new Date('2031-04-04T10:00:00Z')
    const iso = created.toISOString()
    await prisma.weeklySweep.create({ data: { scheduledFor: created, origin: 'manual', createdAt: created } })
    await prisma.job.create({ data: { type: 'manual-sweep', groupKey: `manual-sweep:${iso}`, status: 'running', payload: '{}' } })
    await recoverManualSweeps(new Date(created.getTime() + 10 * 60_000))
    expect(await prisma.weeklySweep.count({ where: { origin: 'manual' } })).toBe(1)
  })
})
