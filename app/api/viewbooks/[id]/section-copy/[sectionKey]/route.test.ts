import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/viewbook/operator', () => ({ requireOperatorEmail: vi.fn(async () => 'op@er.com') }))
vi.mock('@/lib/viewbook/section-copy-content', () => ({
  putSectionCopyOverride: vi.fn(async () => {}),
  deleteSectionCopyOverride: vi.fn(async () => {}),
}))
import { PUT, DELETE } from './route'
import { putSectionCopyOverride, deleteSectionCopyOverride } from '@/lib/viewbook/section-copy-content'

const ctx = { params: Promise.resolve({ id: '12', sectionKey: 'brand' }) }
function put(body: unknown) {
  return new Request('http://x', { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}
beforeEach(() => vi.clearAllMocks())

it('PUT writes the override', async () => {
  const res = await PUT(put({ purpose: 'p', whatThis: 't', whatWeNeed: 'n' }) as any, ctx as any)
  expect(res.status).toBe(200)
  expect(putSectionCopyOverride).toHaveBeenCalledWith(12, 'brand', { purpose: 'p', whatThis: 't', whatWeNeed: 'n' }, 'op@er.com')
})
it('DELETE removes the override', async () => {
  const res = await DELETE(new Request('http://x', { method: 'DELETE' }) as any, ctx as any)
  expect(res.status).toBe(200)
  expect(deleteSectionCopyOverride).toHaveBeenCalledWith(12, 'brand')
})
