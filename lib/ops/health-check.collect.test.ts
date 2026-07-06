// lib/ops/health-check.collect.test.ts
// Run: DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/health-check.collect.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { prisma } from '@/lib/db'
import { collectHealthSignals } from './health-check'

const PFX = 'd0health.test.'
let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-'))
  vi.stubEnv('BACKUP_DIR', tmpDir)
  vi.stubEnv('QUEUE_STALL_MINUTES', '60')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PFX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: PFX } } })
  await prisma.job.deleteMany({ where: { type: { startsWith: PFX } } })
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('collectHealthSignals', () => {
  it('counts recent errored site audits and detects a stalled one', async () => {
    const now = new Date()
    const since = now.getTime() - 15 * 60_000
    // Recent errored audit (updatedAt auto-set to now on create).
    await prisma.siteAudit.create({
      data: { domain: `${PFX}err`, wcagLevel: 'wcag21aa', status: 'error', requestedBy: 'manual' },
    })
    // Stalled running audit. collectHealthSignals is GLOBAL (not prefix-scoped),
    // and findFirst(orderBy updatedAt asc) returns the OLDEST transient audit in
    // the shared local-dev.db — so force this row's updatedAt to epoch ms 1 to
    // guarantee it is the global oldest, making the id assertion non-flaky
    // (Codex fix #3). Raw integer-ms is how updatedAt is stored.
    const stalled = await prisma.siteAudit.create({
      data: { domain: `${PFX}stall`, wcagLevel: 'wcag21aa', status: 'running', requestedBy: 'manual' },
    })
    await prisma.$executeRawUnsafe(`UPDATE SiteAudit SET updatedAt = 1 WHERE id = '${stalled.id}'`)
    const sig = await collectHealthSignals(now, since)
    expect(sig.newErroredSiteAudits).toBeGreaterThanOrEqual(1)
    expect(sig.stalledAudit?.id).toBe(stalled.id)
    expect(sig.stalledAudit!.minutesStuck).toBeGreaterThan(60)
    expect(sig.newestBackupAgeHours).toBeNull() // empty BACKUP_DIR
  })

  it('detail arrays respect the since window, cap at 5, and carry error fields', async () => {
    // Use a synthetic FUTURE window so the shared local-dev.db can never
    // interfere — every pre-existing row's updatedAt/completedAt is <= real
    // now < since, so exact length/order assertions are deterministic.
    const now = new Date(Date.now() + 60 * 60_000)
    const since = now.getTime() - 15 * 60_000

    // Errored site audit — @updatedAt auto-sets to REAL now on create (outside
    // the future window), so push it into the window via raw SQL. updatedAt is
    // stored as integer ms; raw statements must set it manually (house rule).
    const sa = await prisma.siteAudit.create({
      data: { domain: `${PFX}detail`, wcagLevel: 'wcag21aa', status: 'error', error: 'discover blew up', requestedBy: 'manual' },
    })
    await prisma.$executeRaw`UPDATE "SiteAudit" SET "updatedAt" = ${now.getTime() - 1000} WHERE "id" = ${sa.id}`

    // Six errored ADA audits in the window (completedAt is settable directly —
    // no raw SQL needed; windowing uses completedAt because AdaAudit has no
    // updatedAt) + one OUTSIDE the window.
    for (let i = 0; i < 6; i++) {
      await prisma.adaAudit.create({
        data: {
          url: `${PFX}in-${i}`, status: 'error', error: `boom ${i}`, wcagLevel: 'wcag21aa',
          completedAt: new Date(now.getTime() - i * 1000),
        },
      })
    }
    const old = await prisma.adaAudit.create({
      data: {
        url: `${PFX}old`, status: 'error', error: 'ancient', wcagLevel: 'wcag21aa',
        completedAt: new Date(since - 60_000),
      },
    })

    // Exhausted job with a scan-shaped groupKey; same raw updatedAt bump.
    const job = await prisma.job.create({
      data: { type: `${PFX}job`, status: 'error', lastError: 'exhausted', groupKey: `site-audit:${sa.id}` },
    })
    await prisma.$executeRaw`UPDATE "Job" SET "updatedAt" = ${now.getTime() - 1000} WHERE "id" = ${job.id}`

    const sig = await collectHealthSignals(now, since)

    // Only our rows can be inside the future window → exact assertions.
    expect(sig.erroredSiteAuditDetails).toEqual([
      { id: sa.id, domain: `${PFX}detail`, error: 'discover blew up' },
    ])

    // Cap at 5, newest-first by completedAt, out-of-window row excluded.
    expect(sig.erroredAdaAuditDetails).toHaveLength(5)
    expect(sig.erroredAdaAuditDetails.map((d) => d.url)).toEqual(
      [0, 1, 2, 3, 4].map((i) => `${PFX}in-${i}`),
    )
    expect(sig.erroredAdaAuditDetails.some((d) => d.id === old.id)).toBe(false)

    // Job detail carries lastError + groupKey for link routing.
    expect(sig.exhaustedJobDetails).toEqual([
      { id: job.id, type: `${PFX}job`, lastError: 'exhausted', groupKey: `site-audit:${sa.id}` },
    ])
  })
})
