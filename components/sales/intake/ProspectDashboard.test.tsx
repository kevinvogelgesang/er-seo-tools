// components/sales/intake/ProspectDashboard.test.tsx
// @vitest-environment jsdom
//
// A5 Task 19: SSE-aware ProspectDashboard. The existing bounded-poll
// semantics (only polls at all while some prospect is transient/not-yet-
// reportable) are preserved; SSE only changes the poll's cadence (8s fast →
// 60s safety once healthy) and adds an invalidate-triggered refetch on the
// shared `prospect-list` topic — the latter fires regardless of the current
// transient state, since a prospect can be created/deleted/settled
// elsewhere (another tab, or the scan settling server-side) with no
// transient row in THIS component's last-fetched list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import type { ProspectRow } from '@/lib/services/prospects'

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

import { ProspectDashboard } from './ProspectDashboard'

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body }
}

async function flushAsync(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

let fetchMock: ReturnType<typeof vi.fn>

const REPORTABLE_ROW: ProspectRow = {
  id: 1, name: 'Acme College', domain: 'acme.test', createdAt: '2026-07-09T00:00:00.000Z',
  salesTokenActive: true,
  latestAudit: { id: 'a1', status: 'complete', completedAt: '2026-07-09T01:00:00.000Z', adaScore: 62, reportable: true },
}
const RUNNING_ROW: ProspectRow = {
  id: 2, name: 'Running U', domain: 'running.test', createdAt: '2026-07-09T00:00:00.000Z',
  salesTokenActive: false,
  latestAudit: { id: 'a2', status: 'running', completedAt: null, adaScore: null, reportable: false },
}
const VERIFYING_ROW: ProspectRow = {
  id: 3, name: 'Verifying U', domain: 'verifying.test', createdAt: '2026-07-09T00:00:00.000Z',
  salesTokenActive: false,
  // parent complete but live-scan run not written yet → "Report building…"
  latestAudit: { id: 'a3', status: 'complete', completedAt: '2026-07-09T01:00:00.000Z', adaScore: null, reportable: false },
}
const FRESH_ROW: ProspectRow = {
  id: 4, name: 'Fresh', domain: 'fresh.test', createdAt: '2026-07-09T00:00:00.000Z', salesTokenActive: false, latestAudit: null,
}

const rows: ProspectRow[] = [REPORTABLE_ROW, RUNNING_ROW, VERIFYING_ROW, FRESH_ROW]

function routeFetch(prospectsBody: unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/sales/prospects') return jsonResponse({ prospects: prospectsBody })
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

describe('ProspectDashboard', () => {
  it('renders form, list states, and per-state actions', () => {
    routeFetch(rows)
    render(<ProspectDashboard initialProspects={rows} />)
    expect(screen.getByLabelText(/prospect name/i)).toBeTruthy()
    expect(screen.getByLabelText(/domain/i)).toBeTruthy()
    // brief-fixture note: /scan/i matches the submit button PLUS every row's
    // Re-scan/Scan now button (guaranteed >1 with 4 rows) — getAllBy, same
    // pattern the brief already uses below for the identical ambiguity class.
    expect(screen.getAllByRole('button', { name: /scan/i }).length).toBeGreaterThan(0)
    expect(screen.getByText('Acme College')).toBeTruthy()
    expect(screen.getByRole('button', { name: /copy sales link/i })).toBeTruthy() // reportable row only
    expect(screen.getByText(/scanning/i)).toBeTruthy() // running row
    expect(screen.getByText(/report building/i)).toBeTruthy() // complete-but-not-reportable row
    expect(screen.getByText(/not scanned yet/i)).toBeTruthy() // fresh row
    expect(screen.getAllByRole('button', { name: /re-scan|scan now/i }).length).toBeGreaterThan(0)
  })
})

describe('ProspectDashboard — SSE-aware poll (A5 Task 19)', () => {
  it('always subscribes to prospect-list (even with no transient rows)', async () => {
    routeFetch([REPORTABLE_ROW])
    render(<ProspectDashboard initialProspects={[REPORTABLE_ROW]} />)
    await act(async () => { await flushAsync() })
    expect(__lastTopic()).toBe('prospect-list')
  })

  it('invalidate on prospect-list triggers an immediate refetch regardless of transient state', async () => {
    routeFetch([REPORTABLE_ROW])
    render(<ProspectDashboard initialProspects={[REPORTABLE_ROW]} />)
    await act(async () => { await flushAsync() })
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/sales/prospects').length

    await act(async () => {
      __fire()
      await flushAsync()
    })

    const callsAfter = fetchMock.mock.calls.filter((c) => c[0] === '/api/sales/prospects').length
    expect(callsAfter).toBe(callsBefore + 1)
  })

  it('does not run a periodic interval when nothing is transient (bounded-poll semantics preserved)', async () => {
    routeFetch([REPORTABLE_ROW])
    render(<ProspectDashboard initialProspects={[REPORTABLE_ROW]} />)
    await act(async () => { await flushAsync() })
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/sales/prospects').length

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/sales/prospects').length).toBe(callsBefore)
  })

  it('while transient and unhealthy, polls at the original 8s cadence', async () => {
    routeFetch([RUNNING_ROW])
    render(<ProspectDashboard initialProspects={[RUNNING_ROW]} />)
    await act(async () => { await flushAsync() })
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/sales/prospects').length

    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/sales/prospects').length).toBe(callsBefore + 1)
  })

  it('demotes to the 60s safety cadence once SSE is healthy, and re-arms fast on drop', async () => {
    routeFetch([RUNNING_ROW])
    render(<ProspectDashboard initialProspects={[RUNNING_ROW]} />)
    await act(async () => { await flushAsync() })
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/sales/prospects').length

    // Health flips true: an immediate refetch fires and cadence demotes.
    await act(async () => { __setHealth(true); await flushAsync() })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/sales/prospects').length).toBe(callsBefore + 1)

    // Well under the 60s safety cadence — no new fetch.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/sales/prospects').length).toBe(callsBefore + 1)

    // Health drops: re-arm fast (8s).
    await act(async () => { __setHealth(false) })
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/sales/prospects').length).toBe(callsBefore + 2)
  })

  it('the periodic interval only runs while a prospect is transient/not-yet-reportable (VERIFYING_ROW counts)', async () => {
    routeFetch([VERIFYING_ROW])
    render(<ProspectDashboard initialProspects={[VERIFYING_ROW]} />)
    await act(async () => { await flushAsync() })
    const callsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/sales/prospects').length

    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/sales/prospects').length).toBe(callsBefore + 1)
  })
})
