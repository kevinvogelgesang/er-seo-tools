import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyAda = vi.fn()
const findManySite = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    adaAudit: { findMany: (...a: unknown[]) => findManyAda(...a) },
    siteAudit: { findMany: (...a: unknown[]) => findManySite(...a) },
  },
}))

const { fetchAllRecents } = await import('./recents-query')

beforeEach(() => { findManyAda.mockReset(); findManySite.mockReset() })

describe('fetchAllRecents', () => {
  it('returns ISO strings and derives page score from result blob', async () => {
    findManyAda.mockResolvedValue([{
      id: 'a1', createdAt: new Date('2026-05-13T00:00:00Z'),
      url: 'https://x.com', status: 'complete', wcagLevel: 'wcag21aa',
      result: JSON.stringify({ violations: [] }),
      startedAt: new Date('2026-05-13T00:00:00Z'),
      completedAt: new Date('2026-05-13T00:01:00Z'),
      client: { name: 'Acme' }, requestedBy: 'Alice',
    }])
    findManySite.mockResolvedValue([])
    const items = await fetchAllRecents(10)
    expect(items).toHaveLength(1)
    expect(typeof items[0].createdAt).toBe('string')
    expect(items[0].createdAt).toBe('2026-05-13T00:00:00.000Z')
    expect(items[0].score).toBe(100)
    expect(items[0].requestedBy).toBe('Alice')
  })

  it('leaves score null for incomplete rows', async () => {
    findManyAda.mockResolvedValue([{
      id: 'a2', createdAt: new Date('2026-05-13T00:00:00Z'),
      url: 'https://y.com', status: 'running', wcagLevel: 'wcag21aa',
      result: null, startedAt: null, completedAt: null,
      client: null, requestedBy: null,
    }])
    findManySite.mockResolvedValue([])
    const items = await fetchAllRecents(10)
    expect(items[0].score).toBeNull()
    expect(items[0].startedAt).toBeNull()
  })
})
