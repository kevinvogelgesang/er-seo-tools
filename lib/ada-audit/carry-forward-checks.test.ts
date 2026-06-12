// lib/ada-audit/carry-forward-checks.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { carryForwardSiteAuditChecks } from './carry-forward-checks'

const PREFIX = 'c2sched-cf-'

async function makeAudit(domain: string, completedAt: Date | null, status = 'complete') {
  return prisma.siteAudit.create({
    data: { domain, status, wcagLevel: 'wcag21aa', completedAt },
  })
}

function key(n: number): string {
  return n.toString(16).padStart(64, '0') // 64-char lowercase hex, like real keys
}

async function cleanPrefixRows() {
  const audits = await prisma.siteAudit.findMany({
    where: { domain: { startsWith: PREFIX } },
    select: { id: true },
  })
  await prisma.siteAuditCheck.deleteMany({ where: { siteAuditId: { in: audits.map((a) => a.id) } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

beforeAll(cleanPrefixRows) // survive a failed prior run
afterAll(cleanPrefixRows)

describe('carryForwardSiteAuditChecks', () => {
  it('copies checks by content key from the latest previous completed same-domain audit', async () => {
    const domain = `${PREFIX}a.example.edu`
    const oldest = await makeAudit(domain, new Date('2026-01-01T00:00:00Z'))
    const prev = await makeAudit(domain, new Date('2026-02-01T00:00:00Z'))
    const current = await makeAudit(domain, new Date('2026-03-01T00:00:00Z'))
    await prisma.siteAuditCheck.createMany({
      data: [
        { siteAuditId: oldest.id, scope: 'page', key: key(1), checkedBy: 'ancient' },
        { siteAuditId: prev.id, scope: 'page', key: key(2), checkedBy: 'kevin' },
        { siteAuditId: prev.id, scope: 'page-violation', key: key(3), checkedBy: null },
      ],
    })
    await carryForwardSiteAuditChecks(current.id)
    const copied = await prisma.siteAuditCheck.findMany({
      where: { siteAuditId: current.id },
      orderBy: { key: 'asc' },
    })
    expect(copied.map((c) => [c.scope, c.key, c.checkedBy])).toEqual([
      ['page', key(2), 'kevin'],
      ['page-violation', key(3), null],
    ]) // from prev only — NOT from oldest
  })

  it('skips keys already present on the new audit (never clobbers checkedBy)', async () => {
    const domain = `${PREFIX}b.example.edu`
    const prev = await makeAudit(domain, new Date('2026-02-01T00:00:00Z'))
    const current = await makeAudit(domain, new Date('2026-03-01T00:00:00Z'))
    await prisma.siteAuditCheck.createMany({
      data: [
        { siteAuditId: prev.id, scope: 'page', key: key(10), checkedBy: 'old' },
        { siteAuditId: current.id, scope: 'page', key: key(10), checkedBy: 'new' },
      ],
    })
    await carryForwardSiteAuditChecks(current.id)
    const rows = await prisma.siteAuditCheck.findMany({ where: { siteAuditId: current.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].checkedBy).toBe('new')
  })

  it('no previous completed audit → no-op', async () => {
    const current = await makeAudit(`${PREFIX}c.example.edu`, new Date('2026-03-01T00:00:00Z'))
    await expect(carryForwardSiteAuditChecks(current.id)).resolves.toBeUndefined()
    expect(await prisma.siteAuditCheck.count({ where: { siteAuditId: current.id } })).toBe(0)
  })

  it('ignores non-complete audits when picking the source', async () => {
    const domain = `${PREFIX}d.example.edu`
    const errored = await makeAudit(domain, new Date('2026-02-15T00:00:00Z'), 'error')
    await prisma.siteAuditCheck.create({
      data: { siteAuditId: errored.id, scope: 'page', key: key(20), checkedBy: 'x' },
    })
    const current = await makeAudit(domain, new Date('2026-03-01T00:00:00Z'))
    await carryForwardSiteAuditChecks(current.id)
    expect(await prisma.siteAuditCheck.count({ where: { siteAuditId: current.id } })).toBe(0)
  })

  it('audit without completedAt → no-op (never runs pre-completion)', async () => {
    const running = await makeAudit(`${PREFIX}e.example.edu`, null, 'running')
    await expect(carryForwardSiteAuditChecks(running.id)).resolves.toBeUndefined()
  })

  it('is re-entrant: second invocation adds nothing', async () => {
    const domain = `${PREFIX}f.example.edu`
    const prev = await makeAudit(domain, new Date('2026-02-01T00:00:00Z'))
    const current = await makeAudit(domain, new Date('2026-03-01T00:00:00Z'))
    await prisma.siteAuditCheck.create({
      data: { siteAuditId: prev.id, scope: 'page', key: key(30), checkedBy: 'k' },
    })
    await carryForwardSiteAuditChecks(current.id)
    await carryForwardSiteAuditChecks(current.id)
    expect(await prisma.siteAuditCheck.count({ where: { siteAuditId: current.id } })).toBe(1)
  })

  it('unknown audit id → no-op', async () => {
    await expect(carryForwardSiteAuditChecks('nope-no-such-id')).resolves.toBeUndefined()
  })
})
