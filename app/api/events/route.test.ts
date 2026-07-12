// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { GET } from './route'
import { getBusStats, __resetBusForTest } from '@/lib/events/bus'

const req = () => new Request('http://localhost/api/events', { headers: {} })

describe('GET /api/events', () => {
  beforeEach(() => __resetBusForTest())

  it('returns an event-stream with no-transform caching and X-Accel-Buffering off', async () => {
    const res = await GET(req())
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('cache-control')).toContain('no-transform')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
  })

  it('registers a subscriber and sends connected + retry first', async () => {
    const res = await GET(req())
    const reader = res.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('retry: 5000')
    expect(first).toContain('event: connected')
    expect(getBusStats().subscribers).toBe(1)
    await reader.cancel()
  })

  it('returns 503 Retry-After with no subscriber when over MAX_CONNECTIONS', async () => {
    // Fill the bus to cap via the bus API directly (100 dummy subscribers).
    const { subscribeBus } = await import('@/lib/events/bus')
    for (let i = 0; i < 100; i++) subscribeBus({ write: () => {}, close: () => {} })
    const res = await GET(req())
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('5')
    expect(getBusStats().subscribers).toBe(100) // the rejected connect added none
  })
})
