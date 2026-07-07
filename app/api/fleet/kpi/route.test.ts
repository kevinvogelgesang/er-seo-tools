import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/services/fleet-aggregates', () => ({
  getFleetKpi: vi.fn(),
}))
import { getFleetKpi } from '@/lib/services/fleet-aggregates'
import { GET } from './route'

const mockGet = vi.mocked(getFleetKpi)

beforeEach(() => { mockGet.mockReset() })

describe('GET /api/fleet/kpi', () => {
  it('200s with the loader payload', async () => {
    mockGet.mockResolvedValue({ activeScans: 2, avgAda: 81, avgSeo: 74, openCriticals: 9 })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ activeScans: 2, avgAda: 81, avgSeo: 74, openCriticals: 9 })
  })

  it('surfaces a loader throw as the withRoute 500 envelope (no leak)', async () => {
    mockGet.mockImplementation(async () => { throw new Error('db exploded') })
    const res = await GET()
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json).toEqual({ error: 'internal_error' })
    expect(JSON.stringify(json)).not.toContain('db exploded')
  })
})
