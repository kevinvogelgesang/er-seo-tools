// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { SectionReveal } from './SectionReveal'

// Sticky-header rewrite (blink-bug fix): body visibility is STATE-ONLY. No
// IntersectionObserver, no scroll listener. The spy below is the regression
// guard — if any observer is ever re-introduced, these tests fail.
let ioSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  cleanup()
  ioSpy = vi.fn()
  ;(globalThis as any).IntersectionObserver = class {
    constructor() {
      ioSpy()
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(window as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })
  window.location.hash = ''
})

describe('SectionReveal (state-only)', () => {
  it('never constructs an IntersectionObserver', () => {
    render(
      <SectionReveal regionId="r" title="Data Source" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    expect(ioSpy).not.toHaveBeenCalled()
  })

  it('toggle disabled: initiallyOpen={false} renders no button and an expanded, non-inert region', () => {
    const { queryByRole, getByTestId } = render(
      <SectionReveal regionId="r" title="Data Source" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    // The per-section toggle is hidden while SECTION_TOGGLE_ENABLED=false — no
    // button, no [aria-controls] element pointing at the region.
    expect(queryByRole('button')).toBeNull()
    expect(document.querySelector('[aria-controls]')).toBeNull()

    const region = getByTestId('vb-region')
    expect(region.getAttribute('data-vb-expanded')).toBe('true')
    // With no toggle to reopen it, the region must never start collapsed —
    // neither inert nor aria-hidden.
    expect(region.hasAttribute('inert')).toBe(false)
    expect(region.hasAttribute('aria-hidden')).toBe(false)
  })

  it('initiallyOpen has no effect while the toggle is disabled — the region is expanded even when initiallyOpen={false}', () => {
    const { queryByRole, getByTestId } = render(
      <SectionReveal regionId="r" title="Data Source" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    expect(queryByRole('button')).toBeNull()
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('true')
  })

  it('always-open: no toggle button, region always expanded', () => {
    const { queryByRole, getByTestId } = render(
      <SectionReveal regionId="r2" title="Intro" alwaysOpen initiallyOpen>
        body
      </SectionReveal>,
    )
    expect(queryByRole('button')).toBeNull()
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('true')
  })

  it('vb:navigate with a matching sectionKey is a harmless no-op — the section is already expanded', () => {
    const { getByTestId } = render(
      <SectionReveal regionId="r" sectionKey="pc-setup" title="Setup" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('true')
    // The listener is still wired (no-op) — dispatching must not throw.
    expect(() =>
      act(() =>
        window.dispatchEvent(
          new CustomEvent('vb:navigate', { detail: { sectionKey: 'pc-setup', anchor: '#pc-setup' } }),
        ),
      ),
    ).not.toThrow()
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('true')
  })

  it('vb:navigate for a different section is also a no-op — the region stays expanded (always-open invariant)', () => {
    const { getByTestId } = render(
      <SectionReveal regionId="r" sectionKey="pc-setup" title="Setup" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    act(() => window.dispatchEvent(new CustomEvent('vb:navigate', { detail: { sectionKey: 'brand', anchor: '#brand' } })))
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('true')
  })

  it('initial-load hash force-opens the owning section', () => {
    window.location.hash = '#pc-setup'
    const { getByTestId } = render(
      <SectionReveal regionId="r" sectionKey="pc-setup" title="Setup" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('true')
  })

  it('renders the compact title in the sticky header', () => {
    const { getByText } = render(
      <SectionReveal regionId="r" title="Data Source" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    expect(getByText('Data Source')).toBeDefined()
  })

  // Task 8 — the reveal-on-hero-exit fix (Codex fix #5): the sticky bar's ONLY
  // visible title content is this aria-hidden duplicate label, so the bar
  // genuinely reads empty while the hero is in view and the label fades in
  // once the hero scrolls off (CSS keyed off the ancestor's
  // data-vb-hero-visible). It must carry no interactive children so it can
  // never trap a click/tab stop while faded.
  it('renders an aria-hidden duplicate sticky label with no interactive children', () => {
    const { container } = render(
      <SectionReveal regionId="r" title="Brand" alwaysOpen={false} initiallyOpen>
        body
      </SectionReveal>,
    )
    const dup = container.querySelector('[data-vb-sticky-label]')!
    expect(dup).toBeTruthy()
    expect(dup.getAttribute('aria-hidden')).toBe('true')
    expect(dup.querySelector('a,button')).toBeNull()
  })
})
