// @vitest-environment jsdom
import { renderHook, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuditPoller } from './useAuditPoller'

import type { UseAuditPollerArgs } from './useAuditPoller'

const refresh = vi.fn()
const replace = vi.fn()
// One STABLE router object — a fresh object per useRouter() call would churn
// the hook's `router` effect dependency and restart the interval every render.
const router = { refresh, replace }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

// useAuditPoller imports @/lib/events/client at module scope — mock it the
// same way lib/widgets/queue-poll.test.ts does: controllable subscribeTopic/
// subscribeHealth fakes plus __fire()/__setHealth() test helpers.
vi.mock('@/lib/events/client', () => {
  let invalidate: () => void = () => {}
  let health: (h: boolean) => void = () => {}
  let lastTopic: string | undefined
  return {
    subscribeTopic: (topic: string, cb: () => void) => {
      lastTopic = topic
      invalidate = cb
      return () => {}
    },
    subscribeHealth: (cb: (h: boolean) => void) => {
      health = cb
      cb(false)
      return () => {}
    },
    __fire: () => invalidate(),
    __setHealth: (h: boolean) => health(h),
    __lastTopic: () => lastTopic,
  }
})
import * as eventsClient from '@/lib/events/client'
const { __fire, __setHealth } = eventsClient as unknown as {
  __fire: () => void
  __setHealth: (h: boolean) => void
}

type Poll = { status: string }

// Flush the two awaited microtasks (fetch() then res.json()) the hook performs.
async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

// A fetch mock whose responses you resolve/reject manually via the returned queue.
function makeFetch() {
  const pending: Array<{
    resolve: (v: { ok: boolean; body?: unknown }) => void
    reject: (e: unknown) => void
  }> = []
  const fn = vi.fn(
    () =>
      new Promise((resolve, reject) => {
        pending.push({
          resolve: (v) =>
            resolve({ ok: v.ok, json: async () => v.body } as Response),
          reject,
        })
      }),
  )
  return {
    fn,
    resolveNext(v: { ok: boolean; body?: unknown }) {
      const p = pending.shift()
      if (!p) throw new Error('no pending fetch')
      p.resolve(v)
    },
    rejectNext(e: unknown) {
      const p = pending.shift()
      if (!p) throw new Error('no pending fetch')
      p.reject(e)
    },
    pendingCount: () => pending.length,
  }
}

const args = (
  over: Partial<UseAuditPollerArgs<Poll>> = {},
): UseAuditPollerArgs<Poll> => ({
  url: '/api/x',
  intervalMs: 1000,
  initialStatus: 'running',
  getStatus: (d: Poll) => d.status,
  isTerminal: (s: string) => s === 'complete' || s === 'error',
  onData: vi.fn(),
  ...over,
})

describe('useAuditPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    refresh.mockClear()
    replace.mockClear()
  })
  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('terminal-on-mount does nothing (no fetch, no refresh)', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onData = vi.fn()
    renderHook(() => useAuditPoller(args({ initialStatus: 'complete', onData })))
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.fn).not.toHaveBeenCalled()
    expect(onData).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('enabled:false does nothing', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    renderHook(() => useAuditPoller(args({ enabled: false })))
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.fn).not.toHaveBeenCalled()
  })

  it('polls on interval and calls onData; no refresh while non-terminal', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onData = vi.fn()
    renderHook(() => useAuditPoller(args({ onData })))
    await vi.advanceTimersByTimeAsync(1000)
    f.resolveNext({ ok: true, body: { status: 'running' } })
    await flushAsync()
    expect(onData).toHaveBeenCalledWith({ status: 'running' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('terminal response calls onData then onTerminal then one refresh', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onData = vi.fn()
    const onTerminal = vi.fn()
    renderHook(() => useAuditPoller(args({ onData, onTerminal })))
    await vi.advanceTimersByTimeAsync(1000)
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    expect(onData).toHaveBeenCalledWith({ status: 'complete' })
    expect(onTerminal).toHaveBeenCalledWith({ status: 'complete' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('two overlapping terminal responses refresh once', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onTerminal = vi.fn()
    renderHook(() => useAuditPoller(args({ onTerminal })))
    await vi.advanceTimersByTimeAsync(1000)   // fetch #1 in flight
    await vi.advanceTimersByTimeAsync(1000)   // fetch #2 in flight (no inFlight guard)
    expect(f.pendingCount()).toBe(2)
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(onTerminal).toHaveBeenCalledTimes(1)
  })

  it('unmount before fetch resolves calls neither onData nor refresh', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onData = vi.fn()
    const { unmount } = renderHook(() => useAuditPoller(args({ onData })))
    await vi.advanceTimersByTimeAsync(1000)
    unmount()
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    expect(onData).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('non-OK response keeps polling (no refresh)', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    renderHook(() => useAuditPoller(args({})))
    await vi.advanceTimersByTimeAsync(1000)
    f.resolveNext({ ok: false })
    await flushAsync()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.fn).toHaveBeenCalledTimes(2)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('onTerminal returning {redirect} calls router.replace once and suppresses refresh', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onTerminal = vi.fn(() => ({ redirect: '/seo-audits/results/run/r1' }))
    renderHook(() => useAuditPoller(args({ onTerminal })))
    await vi.advanceTimersByTimeAsync(1000)
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/seo-audits/results/run/r1')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('overlapping terminal responses with redirect navigate once', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onTerminal = vi.fn(() => ({ redirect: '/seo-audits/results/run/r1' }))
    renderHook(() => useAuditPoller(args({ onTerminal })))
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('thrown fetch keeps polling (no refresh)', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onData = vi.fn()
    renderHook(() => useAuditPoller(args({ onData })))
    await vi.advanceTimersByTimeAsync(1000)
    f.rejectNext(new Error('network down'))
    await flushAsync()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.fn).toHaveBeenCalledTimes(2)
    expect(onData).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('SSE invalidate triggers an immediate fetch', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onData = vi.fn()
    renderHook(() =>
      useAuditPoller(args({ topic: 'ada-audit:1', safetyIntervalMs: 30_000, onData })),
    )
    // Mount fires no fetch by itself (only the interval/invalidate do).
    expect(f.fn).not.toHaveBeenCalled()

    __fire()
    await flushAsync()
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.resolveNext({ ok: true, body: { status: 'running' } })
    await flushAsync()
    expect(onData).toHaveBeenCalledWith({ status: 'running' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('terminal via an SSE-triggered fetch still fires exactly one router.refresh()', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onTerminal = vi.fn()
    renderHook(() =>
      useAuditPoller(args({ topic: 'ada-audit:1', safetyIntervalMs: 30_000, onTerminal })),
    )
    __fire()
    await flushAsync()
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    expect(onTerminal).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)

    // A second invalidate after terminal must not fire another fetch/refresh.
    __fire()
    await flushAsync()
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('SSE-absent (no topic) still polls at the fast interval and converges on terminal', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onTerminal = vi.fn()
    renderHook(() => useAuditPoller(args({ onTerminal }))) // no topic, no safetyIntervalMs
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    expect(onTerminal).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('while unhealthy, cadence stays at the fast interval even with a topic + safetyIntervalMs', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    renderHook(() =>
      useAuditPoller(args({ topic: 'ada-audit:1', safetyIntervalMs: 30_000 })),
    )
    // subscribeHealth's fake calls back with false synchronously on subscribe.
    await vi.advanceTimersByTimeAsync(1000) // fast (1000ms) cadence from `args()`
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.resolveNext({ ok: true, body: { status: 'running' } })
    await flushAsync()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.fn).toHaveBeenCalledTimes(2)
  })

  it('demotes to the safety cadence once SSE is healthy, and re-arms fast when it drops', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    renderHook(() =>
      useAuditPoller(args({ topic: 'ada-audit:1', safetyIntervalMs: 30_000 })),
    )
    // Health flips true: an immediate refetch fires, and the cadence demotes.
    __setHealth(true)
    await flushAsync()
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.resolveNext({ ok: true, body: { status: 'running' } })
    await flushAsync()

    // Well under the 30s safety cadence — no new fetch.
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.fn).toHaveBeenCalledTimes(1)

    // Health drops: re-arm fast (1000ms from `args()`).
    __setHealth(false)
    await flushAsync()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.fn).toHaveBeenCalledTimes(2)
  })
})
