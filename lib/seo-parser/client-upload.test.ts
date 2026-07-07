// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { uploadAndParse } from './client-upload'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('uploadAndParse', () => {
  it('uploads files then triggers parse and returns the sessionId', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      calls.push(url)
      if (url === '/api/upload') return Promise.resolve({ ok: true, json: async () => ({ sessionId: 'sess1', files: ['a.csv'] }) })
      if (url === '/api/parse/sess1') return Promise.resolve({ ok: true, json: async () => ({}) })
      return Promise.reject(new Error('unexpected'))
    }))
    const file = new File(['a,b'], 'a.csv', { type: 'text/csv' })
    const out = await uploadAndParse([file])
    expect(out.sessionId).toBe('sess1')
    expect(calls).toContain('/api/upload')
    expect(calls).toContain('/api/parse/sess1')
  })

  it('splits into batches over 40MB and carries the sessionId into the next upload (Codex fix 5)', async () => {
    const uploadBodies: FormData[] = []
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, opts?: { body?: FormData }) => {
      calls.push(url)
      if (url === '/api/upload') {
        if (opts?.body instanceof FormData) uploadBodies.push(opts.body)
        return Promise.resolve({ ok: true, json: async () => ({ sessionId: 's1', files: ['x.csv'] }) })
      }
      if (url === '/api/parse/s1') return Promise.resolve({ ok: true, json: async () => ({}) })
      return Promise.reject(new Error('unexpected'))
    }))
    // Two files whose sizes each exceed half the 40MB batch cap force a split.
    const big = () => {
      const f = new File(['a,b'], 'big.csv', { type: 'text/csv' })
      Object.defineProperty(f, 'size', { value: 30 * 1024 * 1024 })
      return f
    }
    const out = await uploadAndParse([big(), big()])
    expect(out.sessionId).toBe('s1')
    // Two upload requests (one per batch); the second carries the first session.
    expect(calls.filter((c) => c === '/api/upload')).toHaveLength(2)
    expect(uploadBodies[1].get('sessionId')).toBe('s1')
    // Parse fires exactly once, for the final session.
    expect(calls.filter((c) => c === '/api/parse/s1')).toHaveLength(1)
  })

  it('throws with the API error message on a failed upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'too big' }) }))
    const file = new File(['a,b'], 'a.csv', { type: 'text/csv' })
    await expect(uploadAndParse([file])).rejects.toThrow(/too big/)
  })
})
