// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CollapsibleSection } from './CollapsibleSection'
import { collapseKey } from './useCollapseState'
import { requestRefresh } from './useViewbookSync'

vi.mock('./useViewbookSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useViewbookSync')>()
  return { ...actual, requestRefresh: vi.fn() }
})

let stored = new Map<string, string>()

beforeEach(() => {
  stored = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  })
  window.location.hash = ''
  vi.mocked(requestRefresh).mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Harness(props: Partial<Parameters<typeof CollapsibleSection>[0]> = {}) {
  return (
    <CollapsibleSection
      viewbookId={1}
      token="tok123"
      sectionKey="brand"
      collapsedShared={false}
      isOperator={false}
      affordance="bar"
      heroExpanded={<div data-testid="hero-expanded">Hero expanded</div>}
      heroCollapsed={<div data-testid="hero-collapsed">Hero collapsed</div>}
      body={<div data-testid="body">Body content</div>}
      regionId="vb-region-brand"
      {...props}
    />
  )
}

function jsonOk() {
  return { ok: true, status: 200, json: async () => ({ collapsedShared: false }) }
}

describe('CollapsibleSection', () => {
  it('collapsed: shows heroCollapsed + affordance; region present but hidden+inert', () => {
    render(<Harness collapsedShared />)
    expect(screen.getByTestId('hero-collapsed')).toBeDefined()
    expect(screen.queryByTestId('hero-expanded')).toBeNull()

    const region = document.getElementById('vb-region-brand')
    expect(region).not.toBeNull()
    expect(region?.hasAttribute('hidden')).toBe(true)
    expect(region?.getAttribute('aria-hidden')).toBe('true')

    const btn = screen.getByRole('button', { name: 'Expand (just for you)' })
    expect(btn.getAttribute('aria-controls')).toBe('vb-region-brand')
  })

  it('client expand: localStorage override set, region shown, NO fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<Harness collapsedShared isOperator={false} />)

    const btn = screen.getByRole('button', { name: 'Expand (just for you)' })
    await act(async () => {
      fireEvent.click(btn)
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    const region = document.getElementById('vb-region-brand')
    expect(region?.hasAttribute('hidden')).toBe(false)
    expect(stored.get(collapseKey(1, 'brand'))).toBe('expanded')
    // Personal expand has nothing shared to refresh — no house-convention nudge.
    expect(requestRefresh).not.toHaveBeenCalled()
  })

  it('client collapse: POSTs {collapsed:true}, clears override, optimistic collapse; restores override on failure', async () => {
    stored.set(collapseKey(1, 'brand'), 'expanded') // simulate a prior personal expand
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchSpy)
    render(<Harness collapsedShared={false} isOperator={false} />)

    const collapseBtn = screen.getByRole('button', { name: 'Collapse for everyone' })
    await act(async () => {
      fireEvent.click(collapseBtn)
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/viewbook/tok123/collapse')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ sectionKey: 'brand', collapsed: true })

    // Failure: rolled back to expanded AND the prior localStorage override restored.
    const region = document.getElementById('vb-region-brand')
    expect(region?.hasAttribute('hidden')).toBe(false)
    expect(stored.get(collapseKey(1, 'brand'))).toBe('expanded')
    // A failed write is not a "successful shared write" — no latch, no nudge.
    expect(requestRefresh).not.toHaveBeenCalled()
  })

  it('client collapse HOLDS after settle — does not revert while collapsedShared is still stale (Codex FIX-9 regression)', async () => {
    const fetchSpy = vi.fn(async () => jsonOk())
    vi.stubGlobal('fetch', fetchSpy)
    render(<Harness collapsedShared={false} isOperator={false} />)

    const collapseBtn = screen.getByRole('button', { name: 'Collapse for everyone' })
    await act(async () => {
      fireEvent.click(collapseBtn)
    })

    // The write succeeded and endPending() reran the reconcile effect, but
    // the harness's collapsedShared prop is UNCHANGED (still false) — exactly
    // the pre-refresh window. Pre-fix this reverted to expanded; the region
    // must stay collapsed until the real prop catches up.
    const region = document.getElementById('vb-region-brand')
    expect(region?.hasAttribute('hidden')).toBe(true)
    expect(region?.getAttribute('aria-hidden')).toBe('true')
    expect(requestRefresh).toHaveBeenCalledTimes(1)
  })

  it('operator expand HOLDS after settle — does not revert while collapsedShared is still stale (Codex FIX-9 regression)', async () => {
    const fetchSpy = vi.fn(async () => jsonOk())
    vi.stubGlobal('fetch', fetchSpy)
    render(<Harness collapsedShared isOperator />)

    const btn = screen.getByRole('button', { name: 'Expand (visible to everyone)' })
    await act(async () => {
      fireEvent.click(btn)
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ sectionKey: 'brand', collapsed: false })

    // collapsedShared is still true (the harness prop is unchanged) — pre-fix
    // this reverted to collapsed; it must stay expanded until the poll's
    // eventual page refresh brings the real prop in line.
    const region = document.getElementById('vb-region-brand')
    expect(region?.hasAttribute('hidden')).toBe(false)
    expect(requestRefresh).toHaveBeenCalledTimes(1)
  })

  it('latch clears once collapsedShared catches up — a genuinely later shared change still applies', async () => {
    const fetchSpy = vi.fn(async () => jsonOk())
    vi.stubGlobal('fetch', fetchSpy)
    const { rerender } = render(<Harness collapsedShared={false} isOperator={false} />)

    const collapseBtn = screen.getByRole('button', { name: 'Collapse for everyone' })
    await act(async () => {
      fireEvent.click(collapseBtn)
    })
    expect(document.getElementById('vb-region-brand')?.hasAttribute('hidden')).toBe(true)

    // The sync poll refreshes the page — collapsedShared now matches what we wrote.
    rerender(<Harness collapsedShared isOperator={false} />)
    expect(document.getElementById('vb-region-brand')?.hasAttribute('hidden')).toBe(true)

    // A genuinely NEW shared change (e.g. someone else re-expands it) applies normally.
    rerender(<Harness collapsedShared={false} isOperator={false} />)
    expect(document.getElementById('vb-region-brand')?.hasAttribute('hidden')).toBe(false)
  })

  it('affordance accessible name is actor-specific (just for you / visible to everyone)', () => {
    const { unmount } = render(<Harness collapsedShared isOperator={false} />)
    expect(screen.getByRole('button', { name: 'Expand (just for you)' })).toBeDefined()
    unmount()

    render(<Harness collapsedShared isOperator />)
    expect(screen.getByRole('button', { name: 'Expand (visible to everyone)' })).toBeDefined()
  })

  it('controls disabled while pending; a second collapse click mid-flight is a no-op (beginPending guard)', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    const fetchSpy = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal('fetch', fetchSpy)
    render(<Harness collapsedShared={false} isOperator={false} />)

    const collapseBtn = screen.getByRole('button', { name: 'Collapse for everyone' })
    // First click starts the in-flight write.
    fireEvent.click(collapseBtn)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // The button is now disabled — a second click must not issue a second fetch.
    fireEvent.click(collapseBtn)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: async () => ({ collapsedShared: true }) })
      await Promise.resolve()
    })
  })

  it('vb:navigate force-expands via forceExpandedLocal — region shown, NO fetch, NO localStorage write', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<Harness collapsedShared isOperator={false} />)

    const regionBefore = document.getElementById('vb-region-brand')
    expect(regionBefore?.hasAttribute('hidden')).toBe(true)

    await act(async () => {
      window.dispatchEvent(new CustomEvent('vb:navigate', { detail: { sectionKey: 'brand' } }))
    })

    const region = document.getElementById('vb-region-brand')
    expect(region?.hasAttribute('hidden')).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(stored.has(collapseKey(1, 'brand'))).toBe(false)
  })

  it('previewMode flips visuals but NEVER calls fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<Harness collapsedShared isOperator={false} previewMode />)

    const expandBtn = screen.getByRole('button', { name: 'Expand (just for you)' })
    await act(async () => {
      fireEvent.click(expandBtn)
    })
    expect(document.getElementById('vb-region-brand')?.hasAttribute('hidden')).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()

    const collapseBtn = screen.getByRole('button', { name: 'Collapse for everyone' })
    await act(async () => {
      fireEvent.click(collapseBtn)
    })
    expect(document.getElementById('vb-region-brand')?.hasAttribute('hidden')).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(requestRefresh).not.toHaveBeenCalled()
  })
})
