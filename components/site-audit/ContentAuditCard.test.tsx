// @vitest-environment jsdom
//
// A5 Task 20: SSE-aware ContentAuditCard. The existing bounded mint→poll
// semantics (only polls at all while `polling` is true AND findings haven't
// landed yet) are preserved as the safety backstop; SSE only changes the
// poll's cadence (8s fast → 60s safety once healthy) and adds an
// invalidate-triggered refetch on the shared `content-audit:<id>` topic —
// the latter fires unconditionally (mount-scoped), since the skill's PATCH
// can land from a different tab/session before this tab has minted a token,
// or after findings already loaded (last-writer-wins allows a later PATCH to
// replace them).
import '../../test/setup-jsdom-observers'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

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

import { ContentAuditCard } from './ContentAuditCard'

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body }
}

async function flushAsync(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

let fetchMock: ReturnType<typeof vi.fn>
const NOT_YET = { minted: false, contentAuditJson: null }
const FINDINGS_JSON = JSON.stringify({
  v: 1, generatedAt: new Date().toISOString(),
  findings: [{ type: 'data_inconsistency', severity: 'warning', title: 'Tuition differs', detail: 'd', evidence: [{ url: 'https://x/a', snippet: 's' }], recommendation: 'r' }],
})
const ARRIVED = { minted: true, contentAuditJson: FINDINGS_JSON }

function routeFetch(pollBody: unknown) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/site-audit/a1/content-audit/mint-token' && init?.method === 'POST') {
      return jsonResponse({ token: 'tok', textAvailable: true })
    }
    if (url === '/api/site-audit/a1/content-audit') return jsonResponse(pollBody)
    throw new Error(`unexpected fetch: ${url}`)
  })
}

async function mint() {
  fireEvent.click(screen.getByRole('button', { name: /start content audit/i }))
  await act(async () => { await flushAsync() })
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

describe('ContentAuditCard', () => {
  it('renders a mint control when a live-scan run exists', () => {
    routeFetch(NOT_YET)
    render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={true} initialContentAuditJson={null} />)
    expect(screen.getByRole('button', { name: /content audit/i })).toBeTruthy()
  })
  it('renders nothing actionable when there is no live-scan run', () => {
    const { container } = render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={false} initialContentAuditJson={null} />)
    expect(container.querySelector('button')).toBeNull()
  })
  it('renders ingested findings grouped by type', () => {
    render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={true} initialContentAuditJson={FINDINGS_JSON} />)
    expect(screen.getAllByText(/Tuition differs/).length).toBeGreaterThan(0)
  })
})

describe('ContentAuditCard — SSE-aware poll (A5 Task 20)', () => {
  it('subscribes to content-audit:<siteAuditId>', async () => {
    routeFetch(NOT_YET)
    render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={true} initialContentAuditJson={null} />)
    await act(async () => { await flushAsync() })
    expect(__lastTopic()).toBe('content-audit:a1')
  })

  it('invalidate triggers an immediate refetch even before a mint has happened', async () => {
    routeFetch(ARRIVED)
    render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={true} initialContentAuditJson={null} />)
    await act(async () => { await flushAsync() })
    expect(screen.queryByText(/Tuition differs/)).toBeNull()

    await act(async () => { __fire(); await flushAsync() })

    expect(screen.getAllByText(/Tuition differs/).length).toBeGreaterThan(0)
  })

  it('does not run a periodic interval before mint (bounded-poll semantics preserved)', async () => {
    routeFetch(NOT_YET)
    render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={true} initialContentAuditJson={null} />)
    await act(async () => { await flushAsync() })
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/a1/content-audit').length

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/a1/content-audit').length).toBe(callsBefore)
  })

  it('after mint, while unhealthy, polls at the original 8s cadence', async () => {
    routeFetch(NOT_YET)
    render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={true} initialContentAuditJson={null} />)
    await mint()
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/a1/content-audit').length

    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/a1/content-audit').length).toBe(callsBefore + 1)
  })

  it('demotes to the 60s safety cadence once SSE is healthy, and re-arms fast on drop', async () => {
    routeFetch(NOT_YET)
    render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={true} initialContentAuditJson={null} />)
    await mint()
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/a1/content-audit').length

    // Health flips true: an immediate refetch fires and cadence demotes.
    await act(async () => { __setHealth(true); await flushAsync() })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/a1/content-audit').length).toBe(callsBefore + 1)

    // Well under the 60s safety cadence — no new fetch.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/a1/content-audit').length).toBe(callsBefore + 1)

    // Health drops: re-arm fast (8s).
    await act(async () => { __setHealth(false) })
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/a1/content-audit').length).toBe(callsBefore + 2)
  })

  it('stops polling once findings arrive (bounded stop condition preserved)', async () => {
    routeFetch(ARRIVED)
    render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={true} initialContentAuditJson={null} />)
    await mint()
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(screen.getAllByText(/Tuition differs/).length).toBeGreaterThan(0)
    const callsAfterArrival = fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/a1/content-audit').length

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/a1/content-audit').length).toBe(callsAfterArrival)
  })
})
