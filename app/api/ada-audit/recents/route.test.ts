import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchAllRecents = vi.fn()
vi.mock('@/lib/ada-audit/recents-query', () => ({ fetchAllRecents: (...a: unknown[]) => fetchAllRecents(...a) }))
const cookieGet = vi.fn()
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }))
vi.mock('@/lib/auth', () => ({
  AUTH_COOKIE_NAME: 'er_auth',
  OPERATOR_NAME_COOKIE_NAME: 'er-operator-name',
  // No valid session in this test → label falls back to the (sanitized) operator cookie.
  getOperatorLabel: async (_auth: unknown, op?: string) => (op ? String(op).trim() || null : null),
}))

const { GET } = await import('./route')
beforeEach(() => { fetchAllRecents.mockReset().mockResolvedValue([]); cookieGet.mockReset() })

function req(qs: string) { return new Request(`http://t/api/ada-audit/recents${qs}`) }

describe('GET /api/ada-audit/recents', () => {
  it('clamps limit to 1..100', async () => {
    await GET(req('?limit=9999'))
    expect(fetchAllRecents).toHaveBeenCalledWith(100, undefined)
    await GET(req('?limit=0'))
    expect(fetchAllRecents).toHaveBeenCalledWith(1, undefined)
  })
  it('scope=mine uses cookie operator, ignores any operator param', async () => {
    cookieGet.mockReturnValue({ value: 'Alice' })
    await GET(req('?scope=mine&operator=Bob&limit=10'))
    expect(fetchAllRecents).toHaveBeenCalledWith(10, 'Alice')
  })
  it('scope=mine with no cookie returns empty without querying', async () => {
    cookieGet.mockReturnValue(undefined)
    const res = await GET(req('?scope=mine'))
    expect(await res.json()).toEqual({ items: [] })
    expect(fetchAllRecents).not.toHaveBeenCalled()
  })
})
