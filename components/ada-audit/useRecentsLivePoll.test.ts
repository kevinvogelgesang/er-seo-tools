// @vitest-environment jsdom
import { renderHook, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRecentsLivePoll } from './useRecentsLivePoll'
import { RECENTS_STATUS_MAX_IDS } from '@/lib/ada-audit/recents-status-shared'
import type { RecentItem } from '@/lib/ada-audit/recents-query'

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
})
