// @vitest-environment jsdom
import { renderHook, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRecentsLivePoll } from './useRecentsLivePoll'
import { RECENTS_STATUS_MAX_IDS } from '@/lib/ada-audit/recents-status-shared'
import type { RecentItem } from '@/lib/ada-audit/recents-query'

// useRecentsLivePoll imports @/lib/events/client at module scope — mock it
// the same way useAuditPoller.test.ts / lib/widgets/queue-poll.test.ts do:
// controllable subscribeTopic/subscribeHealth fakes plus __fire()/__setHealth()
// test helpers.
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
const { __fire, __setHealth, __lastTopic } = eventsClient as unknown as {
  __fire: () => void
  __setHealth: (h: boolean) => void
  __lastTopic: () => string | undefined
}

const item = (over: Partial<RecentItem> = {}): RecentItem => ({
  type: 'site-ada', id: 's1', createdAt: '2026-07-08T10:00:00.000Z', label: 'a.com',
  href: '/ada-audit/site/s1', status: 'running', score: null, startedAt: null, completedAt: null,
  clientName: null, requestedBy: null, deletable: false, inFlight: true, ...over,
})

const statusItem = (over: Record<string, unknown> = {}) => ({
  type: 'site-ada', id: 's1', status: 'running', score: null, href: '/ada-audit/site/s1',
  startedAt: null, completedAt: null, inFlight: true,
  pagesDone: 3, pagesTotal: 40, progressPct: null, phaseLabel: null, ...over,
})

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useRecentsLivePoll', () => {
  it('does not fetch when nothing is in flight', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    renderHook(() =>
      useRecentsLivePoll({ items: [item({ inFlight: false, status: 'complete' })], onUpdate: vi.fn(), onSettled: vi.fn() }),
    )
    await vi.advanceTimersByTimeAsync(20000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('polls only the in-flight ids and merges updates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [statusItem()] })))
    global.fetch = fetchMock as unknown as typeof fetch
    const onUpdate = vi.fn()
    const onSettled = vi.fn()
    renderHook(() =>
      useRecentsLivePoll({
        items: [item(), item({ id: 's2', inFlight: false, status: 'complete' })],
        onUpdate, onSettled,
      }),
    )
    await vi.advanceTimersByTimeAsync(8000)
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('ids=site-ada%3As1')
    expect(url).not.toContain('s2')
    expect(onUpdate).toHaveBeenCalledWith([statusItem()])
    expect(onSettled).not.toHaveBeenCalled()
  })

  it('caps the polled key set at RECENTS_STATUS_MAX_IDS without misreading the overflow as settled', async () => {
    const many = Array.from({ length: 60 }, (_, i) => item({ id: `s${String(i).padStart(2, '0')}` }))
    const returnedKeys = Array.from(
      new Set(many.map((i) => `${i.type}:${i.id}`)),
    ).sort().slice(0, RECENTS_STATUS_MAX_IDS)
    const returned = returnedKeys.map((k) => statusItem({ id: k.split(':')[1] }))
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: returned })))
    global.fetch = fetchMock as unknown as typeof fetch
    const onSettled = vi.fn()
    renderHook(() => useRecentsLivePoll({ items: many, onUpdate: vi.fn(), onSettled }))
    await vi.advanceTimersByTimeAsync(8000)
    await flushAsync()
    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]))
    expect(url.split(',').length).toBe(RECENTS_STATUS_MAX_IDS)
    expect(onSettled).not.toHaveBeenCalled()  // uncapped ids are NOT treated as deleted
  })

  it('fires onSettled once when a polled row leaves in-flight state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [statusItem({ status: 'complete', score: 90, inFlight: false })] })),
    )
    global.fetch = fetchMock as unknown as typeof fetch
    const onSettled = vi.fn()
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate: vi.fn(), onSettled }))
    await vi.advanceTimersByTimeAsync(8000)
    await flushAsync()
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('does not re-notify for the same settled key on subsequent ticks (unchanged items prop)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [statusItem({ status: 'complete', inFlight: false })] })),
    )
    global.fetch = fetchMock as unknown as typeof fetch
    const onSettled = vi.fn()
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate: vi.fn(), onSettled }))
    await vi.advanceTimersByTimeAsync(8000)
    await flushAsync()
    await vi.advanceTimersByTimeAsync(8000)
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onSettled).toHaveBeenCalledTimes(1)  // plan Codex fix #4
  })

  it('fires onSettled when a polled row is missing from the response (deleted)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] })))
    global.fetch = fetchMock as unknown as typeof fetch
    const onSettled = vi.fn()
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate: vi.fn(), onSettled }))
    await vi.advanceTimersByTimeAsync(8000)
    await flushAsync()
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('stops polling when the items prop no longer has in-flight rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] })))
    global.fetch = fetchMock as unknown as typeof fetch
    const { rerender } = renderHook(
      ({ items }: { items: RecentItem[] }) => useRecentsLivePoll({ items, onUpdate: vi.fn(), onSettled: vi.fn() }),
      { initialProps: { items: [item()] } },
    )
    rerender({ items: [item({ inFlight: false, status: 'complete' })] })
    await vi.advanceTimersByTimeAsync(20000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('network errors keep polling silently', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'))
    global.fetch = fetchMock as unknown as typeof fetch
    const onSettled = vi.fn()
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate: vi.fn(), onSettled }))
    await vi.advanceTimersByTimeAsync(16000)
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onSettled).not.toHaveBeenCalled()
  })

  it('subscribes to the recents topic', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [statusItem()] })))
    global.fetch = fetchMock as unknown as typeof fetch
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate: vi.fn(), onSettled: vi.fn() }))
    expect(__lastTopic()).toBe('recents')
  })

  it('SSE invalidate triggers an immediate status refetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [statusItem()] })))
    global.fetch = fetchMock as unknown as typeof fetch
    const onUpdate = vi.fn()
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate, onSettled: vi.fn() }))
    // Mount fires no fetch by itself (only the interval/invalidate do).
    expect(fetchMock).not.toHaveBeenCalled()

    __fire()
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith([statusItem()])
  })

  it('demotes to the 60s safety cadence once SSE is healthy, and re-arms the 8s fast cadence when it drops', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [statusItem()] })))
    global.fetch = fetchMock as unknown as typeof fetch
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate: vi.fn(), onSettled: vi.fn() }))

    // Health flips true: an immediate refetch fires, and the cadence demotes.
    __setHealth(true)
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Well under the 60s safety cadence — no new fetch.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30_000)
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Health drops: re-arm fast (8s).
    __setHealth(false)
    await flushAsync()
    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(8000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a settled key notified via an SSE-triggered refetch is still notified exactly once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [statusItem({ status: 'complete', inFlight: false })] })),
    )
    global.fetch = fetchMock as unknown as typeof fetch
    const onSettled = vi.fn()
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate: vi.fn(), onSettled }))

    __fire()
    await flushAsync()
    expect(onSettled).toHaveBeenCalledTimes(1)

    // A second invalidate for the same still-settled key must not re-notify.
    __fire()
    await flushAsync()
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('SSE-absent keeps the original 8s cadence unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [statusItem()] })))
    global.fetch = fetchMock as unknown as typeof fetch
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate: vi.fn(), onSettled: vi.fn() }))
    // subscribeHealth's fake calls back with false synchronously on subscribe.
    await vi.advanceTimersByTimeAsync(8000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(8000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
