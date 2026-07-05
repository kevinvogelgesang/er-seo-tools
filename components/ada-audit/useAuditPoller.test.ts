// @vitest-environment jsdom
import { renderHook, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuditPoller } from './useAuditPoller'

import type { UseAuditPollerArgs } from './useAuditPoller'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

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
    renderHook(() => useAuditPoller(args({})))
    await vi.advanceTimersByTimeAsync(1000)   // fetch #1 in flight
    await vi.advanceTimersByTimeAsync(1000)   // fetch #2 in flight (no inFlight guard)
    expect(f.pendingCount()).toBe(2)
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    expect(refresh).toHaveBeenCalledTimes(1)
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
})
