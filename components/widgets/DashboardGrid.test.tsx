// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// Stub all data/router deps so the grid renders without real fetches.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/widgets/queue-poll', () => ({ useQueueStatus: () => ({ data: { active: null, queued: [], batch: null }, error: false, loading: false }) }))

import { DashboardGrid } from './DashboardGrid'
import { WIDGETS, DEFAULT_LAYOUT } from '@/lib/widgets/registry'

// This vitest jsdom setup exposes no working localStorage (window.localStorage
// is undefined) — provide an in-memory stand-in, same pattern as
// components/shell/AppShell.test.tsx, re-stubbed per test.
const lsStore = new Map<string, string>()
const localStorageMock = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => { lsStore.set(k, String(v)) },
  removeItem: (k: string) => { lsStore.delete(k) },
  clear: () => { lsStore.clear() },
}

function headingOrder() {
  return screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
}

beforeEach(() => {
  lsStore.clear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
  vi.stubGlobal('localStorage', localStorageMock)
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); lsStore.clear() })

describe('DashboardGrid', () => {
  it('renders a frame titled for every widget in the default layout', () => {
    render(<DashboardGrid />)
    // Titles come from the registry; at least the fixed set should be present.
    for (const title of ['Live now', 'Start a site audit', 'Recent parses']) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0)
    }
    // Sanity: 5 quick-start/live widgets + the 2 PR-3.5 aggregates (the
    // quick-robots + quarter-week dashboard widgets were removed 2026-07-08).
    expect(WIDGETS.length).toBe(7)
  })

  it('view mode shows a Customize button (aria-pressed=false) and live frames', () => {
    render(<DashboardGrid />)
    const customize = screen.getByRole('button', { name: 'Customize' })
    expect(customize.getAttribute('aria-pressed')).toBe('false')
    // A live widget body (not the edit-mode placeholder).
    expect(screen.getByPlaceholderText('example.com')).toBeTruthy()
    expect(screen.queryByLabelText(/Move .* later/)).toBeNull()
  })

  it('clicking Customize enters edit mode: editable tiles, no live bodies, Reset+Done present', () => {
    render(<DashboardGrid />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))

    // Live bodies are gone (edit-mode tile renders a placeholder instead).
    expect(screen.queryByPlaceholderText('example.com')).toBeNull()

    // Size steppers + move buttons visible for every widget.
    for (const widget of WIDGETS) {
      expect(screen.getByLabelText(`Move ${widget.title} later`)).toBeTruthy()
    }

    expect(screen.getByRole('button', { name: 'Reset layout' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
    // Customize is replaced by Done/Reset in edit mode — assert it's gone.
    expect(screen.queryByRole('button', { name: 'Customize' })).toBeNull()
  })

  it('the Done exit affordance is never `hidden md:`-gated once editing===true (mobile-narrowing regression)', () => {
    render(<DashboardGrid />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))

    const done = screen.getByRole('button', { name: 'Done' })
    const reset = screen.getByRole('button', { name: 'Reset layout' })
    // A user who entered edit mode on desktop and then narrowed below `md`
    // must still see Done/Reset — neither may carry the `hidden` class that
    // gates the view-mode Customize button.
    expect(done.className).not.toMatch(/\bhidden\b/)
    expect(reset.className).not.toMatch(/\bhidden\b/)
  })

  it('clicking a tile\'s move-down button swaps its DOM order with its neighbor', () => {
    render(<DashboardGrid />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))

    const before = headingOrder()
    expect(before).toEqual(DEFAULT_LAYOUT.map((i) => WIDGETS.find((w) => w.id === i.id)!.title))

    // Move the first widget "later" → it swaps with its neighbor (index 0↔1).
    const first = WIDGETS.find((w) => w.id === DEFAULT_LAYOUT[0].id)!
    fireEvent.click(screen.getByLabelText(`Move ${first.title} later`))

    const after = headingOrder()
    expect(after[0]).toBe(before[1])
    expect(after[1]).toBe(before[0])
    expect(after.slice(2)).toEqual(before.slice(2))
  })

  it('Reset layout restores default order after a reorder', () => {
    render(<DashboardGrid />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))

    const liveNow = WIDGETS.find((w) => w.id === 'live-now')!
    fireEvent.click(screen.getByLabelText(`Move ${liveNow.title} later`))
    expect(headingOrder()[0]).not.toBe(liveNow.title)

    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }))
    expect(headingOrder()).toEqual(DEFAULT_LAYOUT.map((i) => WIDGETS.find((w) => w.id === i.id)!.title))
  })

  it('Done returns to view mode (live frames return)', () => {
    render(<DashboardGrid />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    // Edit mode suppresses live bodies — the quick-site-audit input is gone.
    expect(screen.queryByPlaceholderText('example.com')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    // View mode remounts live bodies — the input is back.
    expect(screen.getByPlaceholderText('example.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Customize' })).toBeTruthy()
  })

  it('persists a reorder across remounts via the same localStorage', () => {
    const { unmount } = render(<DashboardGrid />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))

    const liveNow = WIDGETS.find((w) => w.id === 'live-now')!
    fireEvent.click(screen.getByLabelText(`Move ${liveNow.title} later`))
    const reordered = headingOrder()
    unmount()

    render(<DashboardGrid />)
    expect(headingOrder()).toEqual(reordered)
  })
})
