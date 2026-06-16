import { describe, it, expect } from 'vitest'
import { checkUrl, HostThrottle, type CheckDeps } from './broken-link-check'

function depsWith(map: Record<string, number[]>): CheckDeps {
  // map: url -> [headStatus, getStatus?]
  return {
    fetchStatus: async (url, method) => {
      const seq = map[url] ?? [200]
      return method === 'HEAD' ? seq[0] : seq[1] ?? seq[0]
    },
    now: () => 0,
    sleep: async () => {},
  }
}

describe('checkUrl', () => {
  it('200 -> ok (no GET needed)', async () => {
    expect(await checkUrl('https://x.com/a', depsWith({ 'https://x.com/a': [200] }))).toBe('ok')
  })
  it('HEAD 404 confirmed by GET 404 -> broken', async () => {
    expect(await checkUrl('https://x.com/a', depsWith({ 'https://x.com/a': [404, 404] }))).toBe('broken')
  })
  it('HEAD 405 but GET 200 -> ok (HEAD false positive avoided)', async () => {
    expect(await checkUrl('https://x.com/a', depsWith({ 'https://x.com/a': [405, 200] }))).toBe('ok')
  })
  it('HEAD throws but GET 404 -> broken (HEAD-specific failure recovered)', async () => {
    const deps: CheckDeps = {
      fetchStatus: async (_u, method) => {
        if (method === 'HEAD') throw new Error('HEAD not allowed')
        return 404
      },
      now: () => 0,
      sleep: async () => {},
    }
    expect(await checkUrl('https://x.com/a', deps)).toBe('broken')
  })
  it('network error on both -> unconfirmed (not broken)', async () => {
    const deps: CheckDeps = {
      fetchStatus: async () => {
        throw new Error('ECONNRESET')
      },
      now: () => 0,
      sleep: async () => {},
    }
    expect(await checkUrl('https://x.com/a', deps)).toBe('unconfirmed')
  })
})

describe('HostThrottle', () => {
  it('does not sleep on the first request to a host', async () => {
    let slept = 0
    const tt = new HostThrottle(250, { now: () => 0, sleep: async (ms) => { slept += ms } })
    await tt.wait('a.com')
    expect(slept).toBe(0)
  })
  it('spaces subsequent requests to the same host', async () => {
    let t = 0
    const slept: number[] = []
    const tt = new HostThrottle(250, { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms } })
    await tt.wait('a.com') // first, no wait, records t=0
    await tt.wait('a.com') // now=0, needs to wait 250
    expect(slept).toEqual([250])
  })
})
