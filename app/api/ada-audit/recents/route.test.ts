import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchAllRecents = vi.fn()
vi.mock('@/lib/ada-audit/recents-query', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/ada-audit/recents-query')>()
  return { ...mod, fetchAllRecents: (...a: unknown[]) => fetchAllRecents(...a) }
})
const cookieGet = vi.fn()
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }))
vi.mock('@/lib/auth', () => ({
  AUTH_COOKIE_NAME: 'er_auth',
  OPERATOR_NAME_COOKIE_NAME: 'er-operator-name',
  // No valid session in this test → label falls back to the (sanitized) operator cookie.
  getOperatorLabel: async (_auth: unknown, op?: string) => (op ? String(op).trim() || null : null),
}))

const { GET } = await import('./route')
beforeEach(() => {
  fetchAllRecents.mockReset().mockResolvedValue({ items: [], nextCursor: null })
  cookieGet.mockReset()
})

function req(qs: string) { return new Request(`http://t/api/ada-audit/recents${qs}`) }

describe('GET /api/ada-audit/recents', () => {
  it('clamps limit to 1..100', async () => {
    await GET(req('?limit=9999'))
    expect(fetchAllRecents).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, operator: undefined }))
    await GET(req('?limit=0'))
    expect(fetchAllRecents).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }))
  })

  it('scope=mine uses cookie operator, ignores any operator param', async () => {
    cookieGet.mockReturnValue({ value: 'Alice' })
    await GET(req('?scope=mine&operator=Bob&limit=10'))
    expect(fetchAllRecents).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, operator: 'Alice' }))
  })

  it('scope=mine with no cookie returns empty without querying', async () => {
    cookieGet.mockReturnValue(undefined)
    const res = await GET(req('?scope=mine'))
    expect(await res.json()).toEqual({ items: [], nextCursor: null })
    expect(fetchAllRecents).not.toHaveBeenCalled()
  })

  it('C16: forwards cursor/q/clientId and returns the nextCursor envelope', async () => {
    fetchAllRecents.mockResolvedValue({ items: [], nextCursor: '456~page~zzz' })
    const res = await GET(req('?limit=3&cursor=123~site-ada~abc&q=foo&clientId=7'))
    expect(fetchAllRecents).toHaveBeenCalledWith(expect.objectContaining({
      limit: 3, q: 'foo', clientId: 7,
      cursor: { createdAt: 123, type: 'site-ada', id: 'abc' },
    }))
    expect(await res.json()).toEqual({ items: [], nextCursor: '456~page~zzz' })
  })

  it('C16: malformed cursor is ignored (first page); clientId=unassigned passes through', async () => {
    await GET(req('?cursor=garbage&clientId=unassigned'))
    expect(fetchAllRecents).toHaveBeenCalledWith(expect.objectContaining({ cursor: null, clientId: 'unassigned' }))
  })
})
