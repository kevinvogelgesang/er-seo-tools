// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import { useEffect } from 'react'
import { SelectionProvider, useSelectionContext } from './SelectionContext'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

function Probe() {
  const s = useSelectionContext()
  return (
    <div>
      <span data-testid="sel">{s.selectedKey ?? 'none'}</span>
      <span data-testid="kind">{s.pinnedKind ?? 'none'}</span>
      <button onClick={() => s.select('brand', 'dirty')}>hard-brand</button>
      <button onClick={() => { const ok = s.select('welcome', 'focus'); (globalThis as any).__ok = ok }}>hard-welcome</button>
      <button onClick={() => s.select('milestones', 'manual-nav')}>nav-milestones</button>
      <button onClick={() => s.select('brand', 'manual-nav')}>nav-brand</button>
      <button onClick={() => s.release('brand', 'activity')}>rel-brand-activity</button>
      <button onClick={() => s.release('brand', 'manual-nav')}>rel-brand-wrongkind</button>
    </div>
  )
}

describe('SelectionContext', () => {
  it('no-op default outside a provider does not throw', () => {
    render(<Probe />)
    expect(screen.getByTestId('sel').textContent).toBe('none')
    act(() => { screen.getByText('nav-milestones').click() })
    expect(screen.getByTestId('sel').textContent).toBe('none')
  })

  it('hard pin blocks a switch to another section (fail closed)', () => {
    render(<SelectionProvider><Probe /></SelectionProvider>)
    act(() => { screen.getByText('hard-brand').click() })
    expect(screen.getByTestId('sel').textContent).toBe('brand')
    expect(screen.getByTestId('kind').textContent).toBe('activity')
    act(() => { screen.getByText('hard-welcome').click() })
    expect((globalThis as any).__ok).toBe(false)           // blocked
    expect(screen.getByTestId('sel').textContent).toBe('brand') // pane unchanged
  })

  it('scoped release ignores a wrong-kind release, honors the matching one', () => {
    render(<SelectionProvider><Probe /></SelectionProvider>)
    act(() => { screen.getByText('hard-brand').click() })
    act(() => { screen.getByText('rel-brand-wrongkind').click() })
    expect(screen.getByTestId('kind').textContent).toBe('activity') // still pinned
    act(() => { screen.getByText('rel-brand-activity').click() })
    expect(screen.getByTestId('kind').textContent).toBe('none')     // released
  })

  it('manual-nav soft pin auto-releases after the timeout', () => {
    vi.useFakeTimers()
    render(<SelectionProvider><Probe /></SelectionProvider>)
    act(() => { screen.getByText('nav-milestones').click() })
    expect(screen.getByTestId('kind').textContent).toBe('manual-nav')
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.getByTestId('kind').textContent).toBe('none')
  })

  // Regression (M1): a weaker manual-nav select on the section that already
  // holds a HARD activity pin must NOT downgrade it — an outline click on the
  // actively-edited section can't drop its pin, even after the soft timeout.
  it('does not downgrade a same-section hard pin on a manual-nav select', () => {
    vi.useFakeTimers()
    render(<SelectionProvider><Probe /></SelectionProvider>)
    act(() => { screen.getByText('hard-brand').click() })
    expect(screen.getByTestId('kind').textContent).toBe('activity')
    act(() => { screen.getByText('nav-brand').click() })
    expect(screen.getByTestId('kind').textContent).toBe('activity') // still hard, not downgraded
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.getByTestId('kind').textContent).toBe('activity') // no soft-release armed
    expect(screen.getByTestId('sel').textContent).toBe('brand')
  })

  // Regression: re-pinning the SAME key+kind must be idempotent so calling
  // select() from a render-driven effect (the activity bridge) settles instead
  // of looping (new pin object → provider re-render → effect re-runs → …).
  it('select() from an effect that re-selects the same key+kind settles without a render loop', () => {
    function LoopProbe() {
      const s = useSelectionContext()
      // Runs on EVERY render; only stable if select() stops re-pinning an
      // already-identical pin. An unguarded select would exceed the update depth.
      useEffect(() => { s.select('brand', 'focus') })
      return <span data-testid="loop-sel">{s.selectedKey ?? 'none'}</span>
    }
    render(<SelectionProvider><LoopProbe /></SelectionProvider>)
    expect(screen.getByTestId('loop-sel').textContent).toBe('brand')
  })
})
