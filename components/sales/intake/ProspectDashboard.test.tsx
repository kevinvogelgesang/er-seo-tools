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
import { cleanup, render, screen, act, fireEvent } from '@testing-library/react'
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

const AUDIT_DEFAULTS = {
  pagesTotal: 0, pagesComplete: 0, pagesError: 0, pagesRedirected: 0,
  pdfsTotal: 0, pdfsComplete: 0, pdfsError: 0, pdfsSkipped: 0,
  lighthouseTotal: 0, lighthouseComplete: 0, lighthouseError: 0,
  startedAt: null as string | null, queuePosition: null as number | null,
}

const REPORTABLE_ROW: ProspectRow = {
  id: 1, name: 'Acme College', domain: 'acme.test', createdAt: '2026-07-09T00:00:00.000Z',
  salesTokenActive: true, salesUrl: 'https://app.test/sales/tok-1',
  latestAudit: {
    id: 'a1', status: 'complete', completedAt: '2026-07-09T01:00:00.000Z', adaScore: 62, reportable: true,
    ...AUDIT_DEFAULTS, pagesTotal: 10, pagesComplete: 10,
  },
}
const RUNNING_ROW: ProspectRow = {
  id: 2, name: 'Running U', domain: 'running.test', createdAt: '2026-07-09T00:00:00.000Z',
  salesTokenActive: false, salesUrl: null,
  latestAudit: {
    id: 'a2', status: 'running', completedAt: null, adaScore: null, reportable: false,
    ...AUDIT_DEFAULTS, pagesTotal: 12, pagesComplete: 3, startedAt: '2026-07-09T00:59:00.000Z',
  },
}
const VERIFYING_ROW: ProspectRow = {
  id: 3, name: 'Verifying U', domain: 'verifying.test', createdAt: '2026-07-09T00:00:00.000Z',
  salesTokenActive: false, salesUrl: null,
  // parent complete but live-scan run not written yet → "Building report…"
  latestAudit: {
    id: 'a3', status: 'complete', completedAt: '2026-07-09T01:00:00.000Z', adaScore: null, reportable: false,
    ...AUDIT_DEFAULTS, pagesTotal: 10, pagesComplete: 10,
  },
}
const FRESH_ROW: ProspectRow = {
  id: 4, name: 'Fresh', domain: 'fresh.test', createdAt: '2026-07-09T00:00:00.000Z',
  salesTokenActive: false, salesUrl: null, latestAudit: null,
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
    expect(screen.getByText(/building report/i)).toBeTruthy() // complete-but-not-reportable row (spec wording)
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

describe('ProspectDashboard — PR3 progress + clickable cards', () => {
  type FakeTab = { opener: unknown; close: ReturnType<typeof vi.fn>; location: { href: string } }
  let openMock: ReturnType<typeof vi.fn>
  let fakeTab: FakeTab

  function stubOpen(returnsTab = true) {
    fakeTab = { opener: {}, close: vi.fn(), location: { href: '' } }
    openMock = vi.fn(() => (returnsTab ? (fakeTab as unknown as Window) : null))
    vi.stubGlobal('open', openMock)
  }

  function routeFetchWithShare(prospectsBody: unknown, opts: { shareOk?: boolean; salesUrl?: string } = {}) {
    const { shareOk = true, salesUrl = 'https://app.test/sales/tok-new' } = opts
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === '/api/sales/prospects') return jsonResponse({ prospects: prospectsBody })
      if (/^\/api\/sales\/prospects\/\d+\/share$/.test(url) && init?.method === 'POST') {
        return jsonResponse({ salesUrl }, shareOk)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  }

  const card = () => screen.getByRole('link', { name: /acme college/i })

  it('renders a progress bar with the phase label for a running audit', () => {
    routeFetch([RUNNING_ROW])
    render(<ProspectDashboard initialProspects={[RUNNING_ROW]} />)
    expect(screen.getByText(/scanning pages \(3\/12\)/i)).toBeTruthy()
  })

  it('the determinate bar is a real progressbar (label + valuemin/max/now)', () => {
    routeFetch([RUNNING_ROW])
    render(<ProspectDashboard initialProspects={[RUNNING_ROW]} />)
    const bar = screen.getByRole('progressbar', { name: /running u/i })
    // f = 0.7 × 3/12 = 0.175 → 18%
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    expect(bar.getAttribute('aria-valuenow')).toBe('18')
  })

  it('the indeterminate discovery bar keeps role+label but OMITS aria-valuenow', () => {
    const discovering: ProspectRow = {
      ...RUNNING_ROW,
      latestAudit: { ...RUNNING_ROW.latestAudit!, pagesTotal: 0, pagesComplete: 0 },
    }
    routeFetch([discovering])
    render(<ProspectDashboard initialProspects={[discovering]} />)
    const bar = screen.getByRole('progressbar', { name: /running u/i })
    // Omitted aria-valuenow is the ARIA-correct indeterminate signal.
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
    expect(screen.getByText(/discovering pages/i)).toBeTruthy()
  })

  it('renders the queue position for a queued audit', () => {
    const queued: ProspectRow = {
      ...RUNNING_ROW,
      latestAudit: { ...RUNNING_ROW.latestAudit!, status: 'queued', queuePosition: 2, startedAt: null },
    }
    routeFetch([queued])
    render(<ProspectDashboard initialProspects={[queued]} />)
    expect(screen.getByText(/queued — position 2/i)).toBeTruthy()
  })

  it('renders "Queued — next in line" at position 1', () => {
    const queued: ProspectRow = {
      ...RUNNING_ROW,
      latestAudit: { ...RUNNING_ROW.latestAudit!, status: 'queued', queuePosition: 1, startedAt: null },
    }
    routeFetch([queued])
    render(<ProspectDashboard initialProspects={[queued]} />)
    expect(screen.getByText(/queued — next in line/i)).toBeTruthy()
  })

  it('shows the ETA after the post-mount tick (hydration-safe)', async () => {
    // startedAt 25 min before "now"; 3+9 of 12 settled → f = 0.7 × 0.25 … use
    // counters that pass the ≥5% / ≥20s gates deterministically.
    const row: ProspectRow = {
      ...RUNNING_ROW,
      latestAudit: {
        ...RUNNING_ROW.latestAudit!,
        pagesTotal: 10, pagesComplete: 5, pagesError: 0, pagesRedirected: 0,
        startedAt: new Date(Date.now() - 10 * 60_000).toISOString(), // f=0.35, elapsed 10 min
      },
    }
    routeFetch([row])
    render(<ProspectDashboard initialProspects={[row]} />)
    // Before the tick effect runs there is no ETA text; advance the 1s tick.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByText(/min remaining/i)).toBeTruthy()
  })

  it('card click opens salesUrl in a new tab with the opener nulled', async () => {
    stubOpen()
    routeFetch([REPORTABLE_ROW])
    render(<ProspectDashboard initialProspects={[REPORTABLE_ROW]} />)
    await act(async () => { fireEvent.click(card()); await flushAsync() })
    expect(openMock).toHaveBeenCalledWith('https://app.test/sales/tok-1', '_blank')
    expect(fakeTab.opener).toBeNull()
  })

  it('Enter activates the card like a click', async () => {
    stubOpen()
    routeFetch([REPORTABLE_ROW])
    render(<ProspectDashboard initialProspects={[REPORTABLE_ROW]} />)
    await act(async () => { fireEvent.keyDown(card(), { key: 'Enter' }); await flushAsync() })
    expect(openMock).toHaveBeenCalledWith('https://app.test/sales/tok-1', '_blank')
  })

  it('clicks on nested interactive controls never activate the card', async () => {
    stubOpen()
    vi.stubGlobal('confirm', vi.fn(() => false)) // Delete short-circuits, no fetch
    routeFetch([REPORTABLE_ROW])
    render(<ProspectDashboard initialProspects={[REPORTABLE_ROW]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /delete/i })); await flushAsync() })
    expect(openMock).not.toHaveBeenCalled()
  })

  it('without an active token: pre-opens about:blank, mints via share POST, then navigates the tab', async () => {
    stubOpen()
    routeFetchWithShare([VERIFYING_ROW])
    render(<ProspectDashboard initialProspects={[VERIFYING_ROW]} />)
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /verifying u/i })); await flushAsync() })
    expect(openMock).toHaveBeenCalledWith('about:blank', '_blank')
    expect(fakeTab.opener).toBeNull()
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/sales/prospects/3/share')).toBe(true)
    expect(fakeTab.location.href).toBe('https://app.test/sales/tok-new')
  })

  it('popup blocked (window.open null) → notice with the link, no crash', async () => {
    stubOpen(false)
    routeFetchWithShare([VERIFYING_ROW])
    render(<ProspectDashboard initialProspects={[VERIFYING_ROW]} />)
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /verifying u/i })); await flushAsync() })
    expect(screen.getByText(/popup blocked/i).textContent).toContain('https://app.test/sales/tok-new')
  })

  it('failed share POST closes the pre-opened tab and shows a notice', async () => {
    stubOpen()
    routeFetchWithShare([VERIFYING_ROW], { shareOk: false })
    render(<ProspectDashboard initialProspects={[VERIFYING_ROW]} />)
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /verifying u/i })); await flushAsync() })
    expect(fakeTab.close).toHaveBeenCalled()
    expect(screen.getByText(/could not open the sales report/i)).toBeTruthy()
  })
})
