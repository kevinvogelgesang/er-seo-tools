import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/keywords/gsc-snapshot', () => ({
  getCannibalizationReport: vi.fn(),
}))
import { getCannibalizationReport } from '@/lib/keywords/gsc-snapshot'
import { GET } from './route'

const makeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/clients/[id]/gsc-cannibalization', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['abc', '5junk', '1.2', '-1', '0'])('400s on a non-strict id (%s)', async (bad) => {
    const res = await GET({} as any, makeCtx(bad))
    expect(res.status).toBe(400)
  })

  it('404s when the client does not exist', async () => {
    ;(getCannibalizationReport as any).mockResolvedValue({ clientExists: false, gscMapped: false, report: null })
    const res = await GET({} as any, makeCtx('5'))
    expect(res.status).toBe(404)
  })

  it('200s with { gscMapped, report } for a mapped client', async () => {
    ;(getCannibalizationReport as any).mockResolvedValue({
      clientExists: true, gscMapped: true,
      report: { fetchedAt: 'x', windowStart: 'a', windowEnd: 'b', queryAtLimit: false, queryPageAtLimit: false, thresholds: {}, totalCannibalizedQueries: 0, capped: false, entries: [] },
    })
    const res = await GET({} as any, makeCtx('5'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.gscMapped).toBe(true)
    expect(body.report.entries).toEqual([])
  })

  it('200s with gscMapped:false, report:null for an unmapped client', async () => {
    ;(getCannibalizationReport as any).mockResolvedValue({ clientExists: true, gscMapped: false, report: null })
    const res = await GET({} as any, makeCtx('5'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ gscMapped: false, report: null })
  })
})
