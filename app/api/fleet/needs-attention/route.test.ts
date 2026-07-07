import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NeedsAttentionRow } from '@/lib/services/fleet-aggregates'

vi.mock('@/lib/services/fleet-aggregates', () => ({
  getNeedsAttention: vi.fn(),
}))
import { getNeedsAttention } from '@/lib/services/fleet-aggregates'
import { GET } from './route'

const mockGet = vi.mocked(getNeedsAttention)

function row(clientId: number): NeedsAttentionRow {
  return { clientId, name: `C${clientId}`, firstDomain: null, score: 50, delta: -5, metric: 'seo', openCritical: 0, topAlert: null }
}

beforeEach(() => { mockGet.mockReset() })

describe('GET /api/fleet/needs-attention', () => {
  it('200s with the ranked rows', async () => {
    mockGet.mockResolvedValue([row(1), row(2)])
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.map((r: NeedsAttentionRow) => r.clientId)).toEqual([1, 2])
  })

  it('caps the response at 12 rows', async () => {
    mockGet.mockResolvedValue(Array.from({ length: 30 }, (_, i) => row(i + 1)))
    const res = await GET()
    expect((await res.json())).toHaveLength(12)
  })

  it('surfaces a loader throw as the withRoute 500 envelope', async () => {
    mockGet.mockImplementation(async () => { throw new Error('boom') })
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal_error' })
  })
})
