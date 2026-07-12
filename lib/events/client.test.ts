// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { subscribeTopic, __resetClientForTest, __setEventSourceFactory } from './client'

class FakeES {
  url: string; onopen: (() => void) | null = null; onerror: (() => void) | null = null
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {}
  closed = false
  constructor(url: string) { this.url = url; FakeES.last = this }
  addEventListener(t: string, cb: (e: MessageEvent) => void) { (this.listeners[t] ??= []).push(cb) }
  close() { this.closed = true }
  fire(t: string, data: unknown) { for (const cb of this.listeners[t] ?? []) cb({ data: JSON.stringify(data) } as MessageEvent) }
  static last: FakeES | null = null
}

describe('client', () => {
  beforeEach(() => { __resetClientForTest(); __setEventSourceFactory((u: string) => new FakeES(u) as unknown as EventSource) })

  it('invokes the callback when an invalidate frame for its topic arrives', () => {
    const cb = vi.fn()
    subscribeTopic('queue', cb)
    FakeES.last!.fire('connected', {})   // connected does its own refetchAll (reconnect catch-up)
    cb.mockClear()                        // isolate: measure only the invalidate below
    FakeES.last!.fire('invalidate', { topic: 'queue' })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('ignores invalidate frames for other topics', () => {
    const cb = vi.fn(); subscribeTopic('queue', cb)
    FakeES.last!.fire('invalidate', { topic: 'recents' })
    expect(cb).not.toHaveBeenCalled()
  })

  it('closes the EventSource when the last topic subscriber leaves; disposer is idempotent', () => {
    const d = subscribeTopic('queue', () => {})
    const es = FakeES.last!
    d(); d()
    expect(es.closed).toBe(true)
  })
})
