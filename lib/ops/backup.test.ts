// lib/ops/backup.test.ts
// Run: DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/backup.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { PrismaClient } from '@prisma/client'
import { runDbBackup, newestBackupMtimeMs } from './backup'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-'))
  vi.stubEnv('BACKUP_DIR', tmpDir)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('runDbBackup', () => {
  it('writes a valid SQLite snapshot and leaves no .tmp', async () => {
    const res = await runDbBackup()
    expect(res.bytes).toBeGreaterThan(0)
    const entries = await fs.readdir(tmpDir)
    expect(entries.some((e) => /^db-.*\.sqlite$/.test(e))).toBe(true)
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false)
    // The snapshot opens as a real DB.
    const c = new PrismaClient({ datasources: { db: { url: `file:${res.file}` } } })
    try {
      const rows = await c.$queryRawUnsafe<Array<{ n: number }>>(
        "SELECT count(*) as n FROM sqlite_master WHERE type='table'",
      )
      expect(Number(rows[0].n)).toBeGreaterThan(0)
    } finally {
      await c.$disconnect()
    }
  })

  it('prunes to the newest `retention` snapshots', async () => {
    // Seed 5 fake older snapshots.
    for (let i = 1; i <= 5; i++) {
      await fs.writeFile(path.join(tmpDir, `db-2026010${i}-000000000-aaaa.sqlite`), 'x')
    }
    const res = await runDbBackup({ retention: 3 })
    expect(res.prunedCount).toBeGreaterThanOrEqual(3) // 6 files (5 seeded + new) → keep 3
    const remaining = (await fs.readdir(tmpDir)).filter((e) => /^db-.*\.sqlite$/.test(e))
    expect(remaining.length).toBe(3)
    expect(remaining).toContain(path.basename(res.file)) // the newest is kept
  })

  it('newestBackupMtimeMs returns null when the dir is empty', async () => {
    expect(await newestBackupMtimeMs()).toBeNull()
  })
})
