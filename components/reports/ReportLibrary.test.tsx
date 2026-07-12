// @vitest-environment jsdom
//
// A5 Task 18: SSE-aware ReportLibrary. The existing bounded-poll semantics
// (only polls at all while some report is transient) are preserved; SSE only
// changes the poll's cadence (5s fast → 60s safety once healthy) and adds an
// invalidate-triggered refetch on the shared `report-list` topic — the latter
// fires regardless of the current transient state, since a report can be
// created/deleted elsewhere on the same page (GenerateReportForm) with no
// transient row in THIS component's last-fetched list.
import { render, screen, cleanup, act } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

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

import { ReportLibrary } from './ReportLibrary'

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body }
}

async function flushAsync(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

let fetchMock: ReturnType<typeof vi.fn>

const TRANSIENT_REPORT = {
  id: 'r1', batchId: null, clientId: 1, status: 'rendering',
  ga4Status: 'pending', gscStatus: 'pending', prospectsStatus: 'pending',
  prospectsTotal: null, prospectsOrganic: null,
  periodStart: '2026-06-01T00:00:00.000Z', periodEnd: '2026-06-30T00:00:00.000Z',
  generatedAt: null, createdAt: '2026-07-01T00:00:00.000Z',
}

const READY_REPORT = { ...TRANSIENT_REPORT, status: 'ready', generatedAt: '2026-07-02T00:00:00.000Z' }

function routeFetch(reportsBody: unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/reports') return jsonResponse({ reports: reportsBody })
    if (url === '/api/clients') return jsonResponse([{ id: 1, name: 'Acme' }])
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

describe('ReportLibrary — SSE-aware poll (A5 Task 18)', () => {
  it('always subscribes to report-list (even with no transient rows)', async () => {
    routeFetch([READY_REPORT])
    render(<ReportLibrary />)
    await act(async () => { await flushAsync() })
    expect(__lastTopic()).toBe('report-list')
  })

  it('invalidate on report-list triggers an immediate refetch regardless of transient state', async () => {
    routeFetch([READY_REPORT])
    render(<ReportLibrary />)
    await act(async () => { await flushAsync() })
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports').length

    await act(async () => {
      __fire()
      await flushAsync()
    })

    const callsAfter = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports').length
    expect(callsAfter).toBe(callsBefore + 1)
  })

  it('does not run a periodic interval when nothing is transient (bounded-poll semantics preserved)', async () => {
    routeFetch([READY_REPORT])
    render(<ReportLibrary />)
    await act(async () => { await flushAsync() })
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports').length

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports').length).toBe(callsBefore)
  })

  it('while transient and unhealthy, polls at the original 5s cadence', async () => {
    routeFetch([TRANSIENT_REPORT])
    render(<ReportLibrary />)
    await act(async () => { await flushAsync() })
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports').length

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports').length).toBe(callsBefore + 1)
  })

  it('demotes to the 60s safety cadence once SSE is healthy, and re-arms fast on drop', async () => {
    routeFetch([TRANSIENT_REPORT])
    render(<ReportLibrary />)
    await act(async () => { await flushAsync() })
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports').length

    // Health flips true: an immediate refetch fires and cadence demotes.
    await act(async () => { __setHealth(true); await flushAsync() })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports').length).toBe(callsBefore + 1)

    // Well under the 60s safety cadence — no new fetch.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports').length).toBe(callsBefore + 1)

    // Health drops: re-arm fast (5s).
    await act(async () => { __setHealth(false) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports').length).toBe(callsBefore + 2)
  })
})
