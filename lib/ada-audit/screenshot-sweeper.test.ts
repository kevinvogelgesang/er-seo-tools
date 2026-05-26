import { describe, it, expect, vi, beforeEach } from 'vitest'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'

const findUnique = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { adaAudit: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))

let tmpRoot: string
vi.mock('./screenshot-helpers', async () => {
  const realPath = await import('path'); const realFs = (await import('fs')).promises
  return {
    get SCREENSHOTS_DIR() { return tmpRoot },
    SCREENSHOT_RETENTION_MS: 24 * 60 * 60 * 1000,
    deleteScreenshots: async (id: string) => { await realFs.rm(realPath.join(tmpRoot, id), { recursive: true, force: true }) },
  }
})

const { sweepExpiredScreenshots } = await import('./screenshot-sweeper')

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-'))
  findUnique.mockReset()
})

async function makeDir(id: string) { await fs.mkdir(path.join(tmpRoot, id)); await fs.writeFile(path.join(tmpRoot, id, 'a.png'), 'x') }
const old = new Date(Date.now() - 48 * 3600_000)
const recent = new Date(Date.now() - 1 * 3600_000)

describe('sweepExpiredScreenshots', () => {
  it('keeps recent completed, deletes old completed, deletes orphan, keeps in-flight', async () => {
    await makeDir('recent'); await makeDir('oldc'); await makeDir('orphan'); await makeDir('running')
    findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) => {
      if (id === 'recent') return Promise.resolve({ completedAt: recent, status: 'complete', createdAt: recent })
      if (id === 'oldc') return Promise.resolve({ completedAt: old, status: 'complete', createdAt: old })
      if (id === 'orphan') return Promise.resolve(null)
      if (id === 'running') return Promise.resolve({ completedAt: null, status: 'running', createdAt: recent })
      return Promise.resolve(null)
    })
    const res = await sweepExpiredScreenshots()
    const left = (await fs.readdir(tmpRoot)).sort()
    expect(left).toEqual(['recent', 'running'])
    expect(res.deleted).toBe(2)
  })

  it('deletes terminal row with null completedAt older than cutoff (fallback)', async () => {
    await makeDir('zombie')
    findUnique.mockResolvedValue({ completedAt: null, status: 'error', createdAt: old })
    await sweepExpiredScreenshots()
    expect(await fs.readdir(tmpRoot)).toEqual([])
  })
})
