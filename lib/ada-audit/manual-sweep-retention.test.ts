// lib/ada-audit/manual-sweep-retention.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { pruneManualSweepAudits, MANUAL_SWEEP_AUDIT_TTL_MS } from './manual-sweep-retention'

const NOW = new Date('2031-06-01T00:00:00Z')
const OLD = new Date(NOW.getTime() - MANUAL_SWEEP_AUDIT_TTL_MS - 86_400_000) // past TTL

beforeEach(async () => {
  await prisma.crawlRun.deleteMany({})
  await prisma.siteAudit.deleteMany({})
  await prisma.weeklySweep.deleteMany({})
})

async function mkAudit(domain: string, clientId: number, createdAt: Date, completedAt: Date) {
  return prisma.siteAudit.create({
    data: { domain, clientId, status: 'complete', requestedBy: 'manual-sweep', createdAt, completedAt },
    select: { id: true },
  })
}

describe('pruneManualSweepAudits', () => {
  it('keeps latest 2 completed per (client,domain), deletes older past TTL', async () => {
    const c = await prisma.client.create({ data: { name: 'C', domains: '[]' } })
    const a1 = await mkAudit('a.edu', c.id, OLD, new Date(OLD.getTime() + 1000))
    const a2 = await mkAudit('a.edu', c.id, OLD, new Date(OLD.getTime() + 2000))
    const a3 = await mkAudit('a.edu', c.id, OLD, new Date(OLD.getTime() + 3000)) // oldest completed of the 3
    await pruneManualSweepAudits(NOW)
    const remaining = await prisma.siteAudit.findMany({ where: { requestedBy: 'manual-sweep' }, select: { id: true } })
    const ids = remaining.map((r) => r.id).sort()
    // keeps the 2 newest by completedAt (a2, a3); a1 deleted
    expect(ids).toEqual([a2.id, a3.id].sort())
  })

  it('does not delete recent (within-TTL) audits', async () => {
    const c = await prisma.client.create({ data: { name: 'C2', domains: '[]' } })
    await mkAudit('b.edu', c.id, NOW, NOW)
    await mkAudit('b.edu', c.id, NOW, NOW)
    await mkAudit('b.edu', c.id, NOW, NOW)
    await pruneManualSweepAudits(NOW)
    expect(await prisma.siteAudit.count({ where: { requestedBy: 'manual-sweep' } })).toBe(3)
  })

  it('never deletes an audit referenced by an unsnapshotted manual WeeklySweep', async () => {
    const c = await prisma.client.create({ data: { name: 'C3', domains: '[]' } })
    // 3 old audits (would normally keep 2, delete 1); the deletion candidate is referenced.
    const a1 = await mkAudit('d.edu', c.id, OLD, new Date(OLD.getTime() + 1000)) // would be deleted (oldest)
    await mkAudit('d.edu', c.id, OLD, new Date(OLD.getTime() + 2000))
    await mkAudit('d.edu', c.id, OLD, new Date(OLD.getTime() + 3000))
    await prisma.weeklySweep.create({
      data: {
        scheduledFor: NOW,
        origin: 'manual',
        snapshotJson: null, // in-flight
        membershipJson: JSON.stringify({
          v: 1,
          expectedCount: 1,
          members: [{ clientId: c.id, clientName: 'C3', domain: 'd.edu', siteAuditId: a1.id, outcome: 'enqueued' }],
        }),
      },
    })
    await pruneManualSweepAudits(NOW)
    expect(await prisma.siteAudit.findUnique({ where: { id: a1.id } })).not.toBeNull()
  })

  it('aborts the pass (deletes nothing) when an in-flight manual membership is corrupt', async () => {
    const c = await prisma.client.create({ data: { name: 'C4', domains: '[]' } })
    await mkAudit('e.edu', c.id, OLD, new Date(OLD.getTime() + 1000))
    await mkAudit('e.edu', c.id, OLD, new Date(OLD.getTime() + 2000))
    await mkAudit('e.edu', c.id, OLD, new Date(OLD.getTime() + 3000))
    await prisma.weeklySweep.create({ data: { scheduledFor: NOW, origin: 'manual', snapshotJson: null, membershipJson: '{bad' } })
    await pruneManualSweepAudits(NOW)
    expect(await prisma.siteAudit.count({ where: { requestedBy: 'manual-sweep' } })).toBe(3) // nothing deleted
  })
})
