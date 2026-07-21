import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/viewbook/operator', () => ({ requireOperatorEmail: vi.fn(async () => 'op@er.com') }))
vi.mock('@/lib/viewbook/section-copy-content', () => ({
  putSectionCopyGlobal: vi.fn(async () => {}),
  deleteSectionCopyGlobal: vi.fn(async () => {}),
}))

import { PUT, DELETE } from './route'
import { putSectionCopyGlobal, deleteSectionCopyGlobal } from '@/lib/viewbook/section-copy-content'

function req(body?: unknown) {
  return new Request('http://x/api/viewbooks/section-copy/brand', {
    method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
const ctx = { params: Promise.resolve({ sectionKey: 'brand' }) }

beforeEach(() => vi.clearAllMocks())

describe('PUT /api/viewbooks/section-copy/[sectionKey]', () => {
  it('validates + writes and returns ok', async () => {
    const res = await PUT(req({ purpose: 'p', whatThis: 't', whatWeNeed: null }) as any, ctx as any)
    expect(res.status).toBe(200)
    expect(putSectionCopyGlobal).toHaveBeenCalledWith('brand', { purpose: 'p', whatThis: 't', whatWeNeed: null }, 'op@er.com')
  })
  it('rejects a non-object body with 400', async () => {
    const res = await PUT(req('nope') as any, ctx as any)
    expect(res.status).toBe(400)
  })
})

describe('DELETE', () => {
  it('reverts to default', async () => {
    const res = await DELETE(req() as any, ctx as any)
    expect(res.status).toBe(200)
    expect(deleteSectionCopyGlobal).toHaveBeenCalledWith('brand')
  })
})
