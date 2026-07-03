// lib/jobs/handlers/db-backup.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const backupMock = vi.hoisted(() => ({ runDbBackup: vi.fn() }))
vi.mock('@/lib/ops/backup', () => backupMock)

const { registerDbBackupHandler, DB_BACKUP_JOB_TYPE } = await import('./db-backup')
const { getJobHandler, clearJobRegistryForTests } = await import('../registry')

beforeEach(() => {
  clearJobRegistryForTests()
  backupMock.runDbBackup.mockReset()
})

describe('db-backup handler', () => {
  it('registers with concurrency 1', () => {
    registerDbBackupHandler()
    const cfg = getJobHandler(DB_BACKUP_JOB_TYPE)
    expect(cfg?.concurrency).toBe(1)
  })

  it('calls runDbBackup and rethrows on failure', async () => {
    registerDbBackupHandler()
    const cfg = getJobHandler(DB_BACKUP_JOB_TYPE)!
    const ctx = { jobId: 'j', attempt: 1, signal: new AbortController().signal }
    backupMock.runDbBackup.mockResolvedValueOnce({ file: '/x/db.sqlite', bytes: 10, prunedCount: 0 })
    await expect(cfg.handler({}, ctx)).resolves.toBeUndefined()
    expect(backupMock.runDbBackup).toHaveBeenCalledOnce()
    backupMock.runDbBackup.mockRejectedValueOnce(new Error('disk full'))
    await expect(cfg.handler({}, ctx)).rejects.toThrow('disk full')
  })
})
