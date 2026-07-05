// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { resolveUrl, resolveExternalHead, type ResolveDeps } from './url-resolver'
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

describe('resolveExternalHead (HEAD-only)', () => {
  const depsWith = (headStatus: number | Error) => {
    const calls: string[] = []
    const d: ResolveDeps = {
      fetchResolved: async (_url, method) => {
        calls.push(method)
        if (headStatus instanceof Error) throw headStatus
        return { status: headStatus, finalUrl: _url, redirects: [] }
      },
      now: () => 0,
      sleep: async () => {},
    }
    return { deps: d, calls }
  }

  it('classifies 404/410/5xx as broken', async () => {
    for (const s of [404, 410, 500, 503]) {
      const { deps: d } = depsWith(s)
      expect((await resolveExternalHead('https://x.example/a', d, 8000)).result).toBe('broken')
    }
  })

  it('classifies anti-bot 401/403/405/429 and other 4xx as unconfirmed', async () => {
    for (const s of [401, 403, 405, 429, 400, 402]) {
      const { deps: d } = depsWith(s)
      expect((await resolveExternalHead('https://x.example/a', d, 8000)).result).toBe('unconfirmed')
    }
  })

  it('classifies <400 as ok', async () => {
    for (const s of [200, 204, 301, 302]) {
      const { deps: d } = depsWith(s)
      expect((await resolveExternalHead('https://x.example/a', d, 8000)).result).toBe('ok')
    }
  })

  it('never issues a GET (HEAD-only), even on a 5xx', async () => {
    const { deps: d, calls } = depsWith(500)
    await resolveExternalHead('https://x.example/a', d, 8000)
    expect(calls).toEqual(['HEAD'])
  })

  it('treats a SafeUrlError as unconfirmed and does not GET', async () => {
    const { deps: d, calls } = depsWith(new SafeUrlError('blocked'))
    expect((await resolveExternalHead('https://x.example/a', d, 8000)).result).toBe('unconfirmed')
    expect(calls).toEqual(['HEAD'])
  })
})
