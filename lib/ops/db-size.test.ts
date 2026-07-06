import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import * as fsp from 'fs/promises'
import { resolveDbPath, getDbSizeBytes } from './db-size'

vi.mock('fs/promises', () => ({ stat: vi.fn() }))

describe('resolveDbPath', () => {
  it('handles an absolute file: URL (prod shape)', () => {
    expect(resolveDbPath('file:/home/seo/data/seo-tools/db.sqlite'))
      .toBe('/home/seo/data/seo-tools/db.sqlite')
  })

  it('resolves a relative file: URL against the prisma/ dir (local dev shape)', () => {
    const got = resolveDbPath('file:./local-dev.db')
    expect(got).toBe(path.join(process.cwd(), 'prisma', 'local-dev.db'))
  })

  it('handles ../ relative paths', () => {
    const got = resolveDbPath('file:../data/db.sqlite')
    expect(got).toBe(path.join(process.cwd(), 'data', 'db.sqlite'))
  })

  it('strips a ?query suffix', () => {
    expect(resolveDbPath('file:/x/db.sqlite?connection_limit=1')).toBe('/x/db.sqlite')
  })

  it('returns null for a non-file URL or undefined', () => {
    expect(resolveDbPath(undefined)).toBeNull()
    expect(resolveDbPath('postgresql://x')).toBeNull()
  })
})

describe('getDbSizeBytes', () => {
  const OLD = process.env.DATABASE_URL
  beforeEach(() => { vi.mocked(fsp.stat).mockReset(); process.env.DATABASE_URL = 'file:/x/db.sqlite' })
  afterEach(() => { process.env.DATABASE_URL = OLD })

  it('sums main + -wal + -shm', async () => {
    vi.mocked(fsp.stat).mockImplementation(async (f) => {
      const map: Record<string, number> = { '/x/db.sqlite': 100, '/x/db.sqlite-wal': 20, '/x/db.sqlite-shm': 3 }
      return { size: map[String(f)] ?? 0 } as never
    })
    expect(await getDbSizeBytes()).toBe(123)
  })

  it('counts a missing sidecar as 0', async () => {
    vi.mocked(fsp.stat).mockImplementation(async (f) => {
      if (String(f) === '/x/db.sqlite') return { size: 50 } as never
      throw new Error('ENOENT') // -wal / -shm absent
    })
    expect(await getDbSizeBytes()).toBe(50)
  })

  it('returns null when DATABASE_URL is not a file: URL', async () => {
    process.env.DATABASE_URL = 'postgresql://x'
    expect(await getDbSizeBytes()).toBeNull()
  })

  it('returns null when even the main file is absent (total 0)', async () => {
    vi.mocked(fsp.stat).mockRejectedValue(new Error('ENOENT'))
    expect(await getDbSizeBytes()).toBeNull()
  })
})
