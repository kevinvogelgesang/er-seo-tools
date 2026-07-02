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
})
