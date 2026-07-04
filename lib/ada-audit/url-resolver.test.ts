// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { resolveUrl, type ResolveDeps } from './url-resolver'
import { SafeUrlError } from '@/lib/security/safe-url'

function deps(fetchResolved: ResolveDeps['fetchResolved']): ResolveDeps {
  return { fetchResolved, now: () => 0, sleep: async () => {} }
}

describe('resolveUrl', () => {
  it('ok when HEAD < 400, chain verbatim, hops from redirects', async () => {
    const d = deps(async (_u, _m) => ({ status: 200, finalUrl: 'https://x.com/c', redirects: ['https://x.com/b', 'https://x.com/c'] }))
    const r = await resolveUrl('https://x.com/a', d)
    expect(r.result).toBe('ok')
    expect(r.finalUrl).toBe('https://x.com/c')
    expect(r.hops).toBe(2)
    expect(r.chain).toEqual(['https://x.com/b', 'https://x.com/c']) // NOT duplicated
    expect(r.tooManyRedirects).toBe(false)
  })

  it('broken: HEAD 404 confirmed by GET 404', async () => {
    const calls: string[] = []
    const d = deps(async (_u, m) => { calls.push(m); return { status: 404, finalUrl: 'https://x.com/a', redirects: [] } })
    const r = await resolveUrl('https://x.com/a', d)
    expect(r.result).toBe('broken')
    expect(calls).toEqual(['HEAD', 'GET'])
  })

  it('ok: HEAD 405 but GET 200 (server mishandles HEAD)', async () => {
    const d = deps(async (_u, m) => m === 'HEAD'
      ? { status: 405, finalUrl: 'https://x.com/a', redirects: [] }
      : { status: 200, finalUrl: 'https://x.com/a', redirects: [] })
    expect((await resolveUrl('https://x.com/a', d)).result).toBe('ok')
  })

  it('SafeUrlError on HEAD → unconfirmed with NO GET call', async () => {
    const calls: string[] = []
    const d = deps(async (_u, m) => { calls.push(m); throw new SafeUrlError('blocked') })
    const r = await resolveUrl('https://x.com/a', d)
    expect(r.result).toBe('unconfirmed')
    expect(calls).toEqual(['HEAD']) // no GET
  })

  it("SafeUrlError('Too many redirects') on HEAD → unconfirmed + tooManyRedirects, no GET", async () => {
    const calls: string[] = []
    const d = deps(async (_u, m) => { calls.push(m); throw new SafeUrlError('Too many redirects') })
    const r = await resolveUrl('https://x.com/a', d)
    expect(r.result).toBe('unconfirmed')
    expect(r.tooManyRedirects).toBe(true)
    expect(calls).toEqual(['HEAD'])
  })

  it('network error (non-SafeUrlError) on HEAD → falls through to GET', async () => {
    const calls: string[] = []
    const d = deps(async (_u, m) => { calls.push(m); if (m === 'HEAD') throw new Error('ECONNRESET'); return { status: 200, finalUrl: 'https://x.com/a', redirects: [] } })
    expect((await resolveUrl('https://x.com/a', d)).result).toBe('ok')
    expect(calls).toEqual(['HEAD', 'GET'])
  })
})
