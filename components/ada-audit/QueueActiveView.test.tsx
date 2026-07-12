// components/ada-audit/QueueActiveView.test.tsx
// @vitest-environment jsdom
//
// A5 Task 21: SSE-aware batch detail poll. "Which batch is open" no longer
// runs an inline poll of /api/site-audit/queue — it reads the shared queue
// store (lib/widgets/queue-poll.ts), which is already SSE-aware (queue topic
// + health). The batch-DETAIL fetch (/api/audit-batches/<id>) keeps its
// original 5s cadence whenever SSE is absent/unhealthy, demotes to a 60s
// safety cadence once healthy, re-arms fast on a health drop, and refetches
// immediately on an `audit-batch:<id>` invalidate. Bounded-poll semantics
// (detail only polls while a batch is open) are preserved.
import { render, screen, cleanup, act } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

const queueMock = vi.hoisted(() => ({ value: { data: null as any, error: false, loading: false } }))
vi.mock('@/lib/widgets/queue-poll', () => ({ useQueueStatus: () => queueMock.value }))

vi.mock('@/lib/events/client', () => {
  const topicHandlers = new Map<string, () => void>()
  let health: (h: boolean) => void = () => {}
  return {
    subscribeTopic: (topic: string, cb: () => void) => {
      topicHandlers.set(topic, cb)
      return () => { topicHandlers.delete(topic) }
    },
    subscribeHealth: (cb: (h: boolean) => void) => {
      health = cb
      cb(false)
      return () => {}
    },
    __fireTopic: (topic: string) => topicHandlers.get(topic)?.(),
    __setHealth: (h: boolean) => health(h),
    __hasTopic: (topic: string) => topicHandlers.has(topic),
  }
})
import * as eventsClient from '@/lib/events/client'
const { __fireTopic, __setHealth, __hasTopic } = eventsClient as unknown as {
  __fireTopic: (topic: string) => void
  __setHealth: (h: boolean) => void
  __hasTopic: (topic: string) => boolean
}

import QueueActiveView from './QueueActiveView'

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body }
}

async function flushAsync(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

let fetchMock: ReturnType<typeof vi.fn>

const DETAIL = {
  id: 'b1',
  startedAt: '2026-07-01T00:00:00.000Z',
  closedAt: null,
  label: null,
  members: [
    {
      id: 'm1', domain: 'example.com', clientId: null, clientName: null,
      status: 'running', pagesTotal: 5, pagesComplete: 2, pagesError: 0,
      score: null, createdAt: '2026-07-01T00:00:00.000Z',
      startedAt: '2026-07-01T00:00:00.000Z', completedAt: null,
      requestedBy: 'manual', seoOnly: false,
    },
  ],
}

function openBatchQueueData() {
  return { active: null, queued: [], batch: { id: 'b1', startedAt: '2026-07-01T00:00:00.000Z', label: null } }
}

function routeFetch(detailBody: unknown = DETAIL) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/audit-batches/b1') return jsonResponse(detailBody)
    throw new Error(`unexpected fetch: ${url}`)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('QueueActiveView — SSE-aware batch detail poll (A5 Task 21)', () => {
  it('subscribes to audit-batch:<id> once a batch is open (from the shared queue store)', async () => {
    routeFetch()
    queueMock.value = { data: openBatchQueueData(), error: false, loading: false }
    render(<QueueActiveView />)
    await act(async () => { await flushAsync() })
    expect(__hasTopic('audit-batch:b1')).toBe(true)
  })

  it('invalidate on audit-batch:<id> triggers an immediate detail refetch', async () => {
    routeFetch()
    queueMock.value = { data: openBatchQueueData(), error: false, loading: false }
    render(<QueueActiveView />)
    await act(async () => { await flushAsync() })
    const before = fetchMock.mock.calls.length

    await act(async () => {
      __fireTopic('audit-batch:b1')
      await flushAsync()
    })

    expect(fetchMock.mock.calls.length).toBe(before + 1)
  })

  it('polls detail at the original 5s cadence while unhealthy', async () => {
    routeFetch()
    queueMock.value = { data: openBatchQueueData(), error: false, loading: false }
    render(<QueueActiveView />)
    await act(async () => { await flushAsync() })
    const before = fetchMock.mock.calls.length

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })

    expect(fetchMock.mock.calls.length).toBe(before + 1)
  })

  it('demotes to the 60s safety cadence once healthy, and re-arms fast on drop', async () => {
    routeFetch()
    queueMock.value = { data: openBatchQueueData(), error: false, loading: false }
    render(<QueueActiveView />)
    await act(async () => { await flushAsync() })
    const before = fetchMock.mock.calls.length

    // Health flips true: an immediate refetch fires and cadence demotes.
    await act(async () => { __setHealth(true); await flushAsync() })
    expect(fetchMock.mock.calls.length).toBe(before + 1)

    // Well under the 60s safety cadence — no new fetch.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock.mock.calls.length).toBe(before + 1)

    // Health drops: re-arm fast (5s).
    await act(async () => { __setHealth(false) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchMock.mock.calls.length).toBe(before + 2)
  })

  it('does not poll detail when no batch is open (bounded-poll semantics preserved)', async () => {
    queueMock.value = { data: { active: null, queued: [], batch: null }, error: false, loading: false }
    render(<QueueActiveView />)
    await act(async () => { await flushAsync() })

    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText(/no audits in flight/i)).toBeTruthy()
  })

  it('freeze-frame detail survives a store re-tick (new snapshot ref, still-null batch) until the 5s timer expires', async () => {
    routeFetch()
    queueMock.value = { data: openBatchQueueData(), error: false, loading: false }
    const { rerender } = render(<QueueActiveView />)
    await act(async () => { await flushAsync() })
    expect(screen.getByText('example.com')).toBeTruthy()

    // Batch closes → freeze frame armed (toast + final detail held for 5s).
    queueMock.value = { data: { active: null, queued: [], batch: null }, error: false, loading: false }
    rerender(<QueueActiveView />)
    await act(async () => { await flushAsync() })
    expect(screen.getByText(/batch complete/i)).toBeTruthy()
    expect(screen.getByText('example.com')).toBeTruthy()

    // The shared queue store produces a NEW snapshot object on every tick /
    // queue invalidate even when content is unchanged. A re-run of the
    // "which batch is open" effect INSIDE the freeze window (incomingId
    // still null) must NOT wipe the frozen detail early.
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    queueMock.value = { data: { active: null, queued: [], batch: null }, error: false, loading: false }
    rerender(<QueueActiveView />)
    await act(async () => { await flushAsync() })
    expect(screen.getByText(/batch complete/i)).toBeTruthy()
    expect(screen.getByText('example.com')).toBeTruthy()

    // Once the 5s freeze expires, the timer callback clears to the empty state.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(screen.queryByText(/batch complete/i)).toBeNull()
    expect(screen.getByText(/no audits in flight/i)).toBeTruthy()
  })

  it('shows a freeze-frame toast with final detail when the store batch closes', async () => {
    routeFetch()
    queueMock.value = { data: openBatchQueueData(), error: false, loading: false }
    const { rerender } = render(<QueueActiveView />)
    await act(async () => { await flushAsync() })
    expect(screen.getByText('example.com')).toBeTruthy()

    queueMock.value = { data: { active: null, queued: [], batch: null }, error: false, loading: false }
    rerender(<QueueActiveView />)
    await act(async () => { await flushAsync() })

    expect(screen.getByText(/batch complete/i)).toBeTruthy()
    // Freeze-frame still shows the last known member row.
    expect(screen.getByText('example.com')).toBeTruthy()
  })
})
