// @vitest-environment jsdom
//
// A5 Task 18: SSE-aware pollers. GenerateReportForm.tsx runs two independent
// pollers at once (single-report status @ 2s → reportTopic(reportId); batch
// rollup @ 3s → reportListTopic()) — the POST /api/reports response always
// carries a batchId AND (when exactly one report was created) a reportId, so
// both effects are live simultaneously. This mock therefore tracks per-topic
// subscriber sets (unlike useAuditPoller.test.ts's single "lastTopic", which
// only ever has one active subscription at a time).
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

vi.mock('@/lib/events/client', () => {
  const topicHandlers = new Map<string, Set<() => void>>()
  const healthListeners = new Set<(h: boolean) => void>()
  return {
    subscribeTopic: (topic: string, cb: () => void) => {
      if (!topicHandlers.has(topic)) topicHandlers.set(topic, new Set())
      topicHandlers.get(topic)!.add(cb)
      return () => { topicHandlers.get(topic)?.delete(cb) }
    },
    subscribeHealth: (cb: (h: boolean) => void) => {
      healthListeners.add(cb)
      cb(false)
      return () => { healthListeners.delete(cb) }
    },
    __fireTopic: (topic: string) => { topicHandlers.get(topic)?.forEach((cb) => cb()) },
    __setHealth: (h: boolean) => { healthListeners.forEach((cb) => cb(h)) },
    __subscriberCount: (topic: string) => topicHandlers.get(topic)?.size ?? 0,
  }
})
import * as eventsClient from '@/lib/events/client'
const { __fireTopic, __setHealth, __subscriberCount } = eventsClient as unknown as {
  __fireTopic: (topic: string) => void
  __setHealth: (h: boolean) => void
  __subscriberCount: (topic: string) => number
}

import { GenerateReportForm } from './GenerateReportForm'

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body }
}

let fetchMock: ReturnType<typeof vi.fn>

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

const CLIENTS = [{ id: 1, name: 'Acme' }]

function routeFetch(reportStatusBody: unknown, batchStatusBody: unknown) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/clients') return jsonResponse(CLIENTS)
    if (url === '/api/reports' && init?.method === 'POST') {
      return jsonResponse({ batchId: 'batch-1', reportIds: ['report-1'] }, true)
    }
    if (url === '/api/reports/batch/batch-1') return jsonResponse(batchStatusBody)
    if (url === '/api/reports/report-1') return jsonResponse(reportStatusBody)
    throw new Error(`unexpected fetch: ${url}`)
  })
}

// Fake timers don't affect native Promise microtasks, but the POST /api/reports
// flow chains several awaits (POST → json → batch-status GET → json → two
// setState calls), so a single `await Promise.resolve()` isn't enough to drain
// it — flush a handful of ticks, same spirit as useAuditPoller.test.ts's
// flushAsync().
async function flushAsync(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

async function generateOneReport() {
  render(<GenerateReportForm />)
  // Let the /api/clients list load.
  await act(async () => { await flushAsync() })
  await act(async () => {
    fireEvent.click(screen.getByText('All active'))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Generate Report' }))
    await flushAsync()
  })
}

describe('GenerateReportForm — SSE-aware pollers (A5 Task 18)', () => {
  it('subscribes the single-report poll to report:<reportId> and the batch poll to report-list', async () => {
    routeFetch(
      { status: 'rendering', ga4Status: 'pending', gscStatus: 'pending', prospectsStatus: 'pending', generatedAt: null },
      { status: 'running', counts: { queued: 0, rendering: 1, ready: 0, error: 0 } },
    )
    await generateOneReport()
    expect(__subscriberCount('report:report-1')).toBe(1)
    expect(__subscriberCount('report-list')).toBe(1)
  })

  it('invalidate on report:<reportId> triggers an immediate single-report refetch', async () => {
    routeFetch(
      { status: 'rendering', ga4Status: 'pending', gscStatus: 'pending', prospectsStatus: 'pending', generatedAt: null },
      { status: 'running', counts: { queued: 0, rendering: 1, ready: 0, error: 0 } },
    )
    await generateOneReport()
    expect(__subscriberCount('report:report-1')).toBe(1)
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/report-1').length

    await act(async () => { __fireTopic('report:report-1') })

    const callsAfter = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/report-1').length
    expect(callsAfter).toBe(callsBefore + 1)
  })

  it('invalidate on report-list triggers an immediate batch refetch', async () => {
    routeFetch(
      { status: 'rendering', ga4Status: 'pending', gscStatus: 'pending', prospectsStatus: 'pending', generatedAt: null },
      { status: 'running', counts: { queued: 0, rendering: 1, ready: 0, error: 0 } },
    )
    await generateOneReport()
    expect(__subscriberCount('report-list')).toBe(1)
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/batch/batch-1').length

    await act(async () => { __fireTopic('report-list') })

    const callsAfter = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/batch/batch-1').length
    expect(callsAfter).toBe(callsBefore + 1)
  })

  it('while unhealthy, both pollers stay at their original fast cadence (2s / 3s)', async () => {
    routeFetch(
      { status: 'rendering', ga4Status: 'pending', gscStatus: 'pending', prospectsStatus: 'pending', generatedAt: null },
      { status: 'running', counts: { queued: 0, rendering: 1, ready: 0, error: 0 } },
    )
    await generateOneReport()
    expect(__subscriberCount('report:report-1')).toBe(1)

    const reportCallsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/report-1').length
    const batchCallsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/batch/batch-1').length

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/report-1').length).toBe(reportCallsBefore + 1)

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/batch/batch-1').length).toBe(batchCallsBefore + 1)
  })

  it('demotes both pollers to the 60s safety cadence once SSE is healthy, and re-arms fast on drop', async () => {
    routeFetch(
      { status: 'rendering', ga4Status: 'pending', gscStatus: 'pending', prospectsStatus: 'pending', generatedAt: null },
      { status: 'running', counts: { queued: 0, rendering: 1, ready: 0, error: 0 } },
    )
    await generateOneReport()
    expect(__subscriberCount('report:report-1')).toBe(1)

    const reportCallsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/report-1').length
    const batchCallsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/batch/batch-1').length

    // Health flips true: an immediate refetch fires on both pollers.
    await act(async () => { __setHealth(true) })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/report-1').length).toBe(reportCallsBefore + 1)
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/batch/batch-1').length).toBe(batchCallsBefore + 1)

    // Well under the 60s safety cadence — no new fetch.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/report-1').length).toBe(reportCallsBefore + 1)
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/batch/batch-1').length).toBe(batchCallsBefore + 1)

    // Health drops: re-arm fast (2s / 3s).
    await act(async () => { __setHealth(false) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/report-1').length).toBe(reportCallsBefore + 2)
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/batch/batch-1').length).toBe(batchCallsBefore + 2)
  })

  it('stops polling once the single-report status reaches ready (existing bounded-poll semantics preserved)', async () => {
    routeFetch(
      { status: 'ready', ga4Status: 'ok', gscStatus: 'ok', prospectsStatus: 'manual', generatedAt: '2026-07-12T00:00:00.000Z' },
      { status: 'complete', counts: { queued: 0, rendering: 0, ready: 1, error: 0 } },
    )
    await generateOneReport()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

    const callsAtReady = fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/report-1').length
    expect(callsAtReady).toBeGreaterThan(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/reports/report-1').length).toBe(callsAtReady)
  })
})
