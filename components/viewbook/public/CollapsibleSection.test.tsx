// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CollapsibleSection } from './CollapsibleSection'
import { collapseKey } from './useCollapseState'
import { welcomeRevealedKey } from './useWelcomeAutoReveal'

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
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Post-review a11y fix: the button no longer carries an explicit aria-label
// (see CollapsibleSection.tsx's banner) — its accessible name now comes from
// its ONE visible text node. Real hero content (SectionShell) always
// contains the title as visible text; this harness mirrors that shape
// (rather than the old opaque "Hero expanded"/"Hero collapsed" strings) so
// `getByRole('button', { name: title })` still resolves correctly.
//
// Fixtures use <span> (not <div>) — the button may only contain phrasing
// content (see SectionShell.tsx's banner on the round-2 a11y fix); a <div>
// fixture would silently pass in jsdom/RTL (which doesn't enforce HTML
// content-model validity) while misrepresenting what real hero markup looks
// like inside the button.
function Harness(props: Partial<Parameters<typeof CollapsibleSection>[0]> = {}) {
  const title = props.title ?? 'Brand & Identity'
  return (
    <CollapsibleSection
      viewbookId={1}
      sectionKey="brand"
      title={title}
      heroExpanded={<span data-testid="hero-expanded">{title}</span>}
      heroCollapsed={<span data-testid="hero-collapsed">{title}</span>}
      body={<span data-testid="body">Body content</span>}
      regionId="vb-region-brand"
      {...props}
    />
  )
}

describe('CollapsibleSection', () => {
  it('defaults to collapsed on a fresh machine: shows heroCollapsed, region MOUNTED but aria-hidden+inert, root data-vb-state="collapsed"', () => {
    const { container } = render(<Harness />)
    // Task 8: both hero faces stay MOUNTED (stacked in the cross-fade stage)
    // — the inactive face is aria-hidden, not absent from the DOM.
    expect(screen.getByTestId('hero-collapsed')).toBeDefined()
    expect(screen.getByTestId('hero-collapsed').closest('[data-vb-face]')?.getAttribute('aria-hidden')).toBeNull()
    expect(screen.getByTestId('hero-expanded').closest('[data-vb-face]')?.getAttribute('aria-hidden')).toBe('true')

    const region = document.getElementById('vb-region-brand')
    expect(region).not.toBeNull()
    // Task 7: the region is never `hidden`/`display:none` (that would kill
    // the grid-rows transition) — it stays mounted, guarded by aria-hidden
    // + inert instead.
    expect(region?.hasAttribute('hidden')).toBe(false)
    expect(region?.style.display).not.toBe('none')
    expect(region?.getAttribute('aria-hidden')).toBe('true')

    const root = container.querySelector('.vb-collapsible')
    expect(root?.getAttribute('data-vb-state')).toBe('collapsed')

    const btn = screen.getByRole('button', { name: 'Brand & Identity' })
    expect(btn.getAttribute('aria-controls')).toBe('vb-region-brand')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })

  it('the region div is present in the DOM in BOTH collapsed and expanded states (mounted-region truth, not a display:none toggle)', () => {
    render(<Harness />)
    // Collapsed (default): present, mounted, not display:none, not hidden.
    let region = document.getElementById('vb-region-brand')
    expect(region).not.toBeNull()
    expect(region?.hasAttribute('hidden')).toBe(false)
    expect(region?.style.display).not.toBe('none')
    expect(screen.getByTestId('body')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Brand & Identity' }))

    // Expanded: still present (same node identity — never removed/remounted).
    region = document.getElementById('vb-region-brand')
    expect(region).not.toBeNull()
    expect(region?.hasAttribute('hidden')).toBe(false)
    expect(region?.style.display).not.toBe('none')
    expect(screen.getByTestId('body')).toBeDefined()
  })

  it('root data-vb-state flips from "collapsed" to "expanded" when the button is clicked', () => {
    const { container } = render(<Harness />)
    const root = container.querySelector('.vb-collapsible')
    expect(root?.getAttribute('data-vb-state')).toBe('collapsed')

    fireEvent.click(screen.getByRole('button', { name: 'Brand & Identity' }))
    expect(root?.getAttribute('data-vb-state')).toBe('expanded')
  })

  it('APG Accordion structure: the <button> does NOT contain a heading, and the section heading (same accessible name) WRAPS the button', () => {
    render(<Harness />)
    const btn = screen.getByRole('button', { name: 'Brand & Identity' })
    // A <button> may not validly contain a block <h2> — assert none is nested.
    expect(btn.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull()

    const heading = screen.getByRole('heading', { name: 'Brand & Identity' })
    expect(heading.tagName).toBe('H2')
    // The heading WRAPS the button (not the reverse).
    expect(heading.contains(btn)).toBe(true)
    expect(heading.querySelector('button')).toBe(btn)
  })

  it('the button and its wrapping heading carry NO explicit aria-label — the accessible name comes from the visible title text (name-from-content), not a duplicate string', () => {
    render(<Harness />)
    const btn = screen.getByRole('button', { name: 'Brand & Identity' })
    expect(btn.hasAttribute('aria-label')).toBe(false)
    const heading = screen.getByRole('heading', { name: 'Brand & Identity' })
    expect(heading.hasAttribute('aria-label')).toBe(false)
  })

  it('the always-rendered controlled region is a NAMED landmark (aria-label), independent of collapsed state', () => {
    render(<Harness />)
    const region = document.getElementById('vb-region-brand')!
    expect(region.getAttribute('role')).toBe('region')
    expect(region.getAttribute('aria-label')).toBe('Brand & Identity')
  })

  it('a stored "expanded" value starts expanded', () => {
    stored.set(collapseKey(1, 'brand'), 'expanded')
    const { container } = render(<Harness />)
    // Task 8: both faces stay mounted — collapsed face is the one aria-hidden now.
    expect(screen.getByTestId('hero-expanded')).toBeDefined()
    expect(screen.getByTestId('hero-expanded').closest('[data-vb-face]')?.getAttribute('aria-hidden')).toBeNull()
    expect(screen.getByTestId('hero-collapsed').closest('[data-vb-face]')?.getAttribute('aria-hidden')).toBe('true')
    const region = document.getElementById('vb-region-brand')
    expect(region?.hasAttribute('hidden')).toBe(false)
    expect(region?.getAttribute('aria-hidden')).toBeNull()
    expect(container.querySelector('.vb-collapsible')?.getAttribute('data-vb-state')).toBe('expanded')
    expect(screen.getByRole('button', { name: 'Brand & Identity' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('clicking the collapsed row expands it and persists "expanded" to localStorage', () => {
    render(<Harness />)
    const btn = screen.getByRole('button', { name: 'Brand & Identity' })
    fireEvent.click(btn)

    expect(screen.getByTestId('hero-expanded')).toBeDefined()
    const region = document.getElementById('vb-region-brand')
    expect(region?.hasAttribute('hidden')).toBe(false)
    expect(region?.getAttribute('aria-hidden')).toBeNull()
    expect(region?.hasAttribute('inert')).toBe(false)
    expect(stored.get(collapseKey(1, 'brand'))).toBe('expanded')
  })

  it('a deliberate expand click starts the destination-chasing scroll; a collapse click does not', () => {
    // The real DOM has `<section id={sectionKey}>` OUTSIDE this component
    // (SectionShell) — scrollSectionToTop resolves the scroll target via
    // `document.getElementById(sectionKey)`, so reproduce that wrapper.
    vi.useFakeTimers()
    const wrapper = document.createElement('section')
    wrapper.id = 'brand'
    document.body.appendChild(wrapper)
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)

    render(<Harness />, { container: wrapper })
    const btn = screen.getByRole('button', { name: 'Brand & Identity' })

    // Expand: the chase runs on animation frames (2026-07-20 rework — a
    // one-shot scrollIntoView went stale whenever a neighboring collapse was
    // still animating; see viewbook-navigate.ts).
    fireEvent.click(btn)
    vi.advanceTimersByTime(2000) // chase runs to its settle/cap and stops
    expect(scrollTo).toHaveBeenCalled()
    const callsAfterExpand = scrollTo.mock.calls.length

    // Collapse: never scrolls.
    fireEvent.click(btn)
    vi.advanceTimersByTime(2000)
    expect(scrollTo.mock.calls.length).toBe(callsAfterExpand)

    vi.unstubAllGlobals()
    wrapper.remove()
  })

  it('clicking the expanded hero collapses it and persists "collapsed"', () => {
    stored.set(collapseKey(1, 'brand'), 'expanded')
    render(<Harness />)
    const btn = screen.getByRole('button', { name: 'Brand & Identity' })
    fireEvent.click(btn)

    expect(screen.getByTestId('hero-collapsed')).toBeDefined()
    const region = document.getElementById('vb-region-brand')
    // Never `hidden` (see Task 7 banner) — collapsed is conveyed by
    // aria-hidden/inert (asserted below) plus the CSS-driven grid collapse.
    expect(region?.hasAttribute('hidden')).toBe(false)
    expect(region?.getAttribute('aria-hidden')).toBe('true')
    expect(region?.hasAttribute('inert')).toBe(true)
    expect(stored.get(collapseKey(1, 'brand'))).toBe('collapsed')
  })

  it('inert and aria-hidden are present ONLY when collapsed', () => {
    render(<Harness />)
    const region = document.getElementById('vb-region-brand')!
    expect(region.hasAttribute('inert')).toBe(true)
    expect(region.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Brand & Identity' }))
    expect(region.hasAttribute('inert')).toBe(false)
    expect(region.getAttribute('aria-hidden')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Brand & Identity' }))
    expect(region.hasAttribute('inert')).toBe(true)
    expect(region.getAttribute('aria-hidden')).toBe('true')
  })

  it('the body is never a collapse target — it is not wrapped by the toggle button', () => {
    render(<Harness />)
    const body = screen.getByTestId('body')
    expect(body.closest('button')).toBeNull()
  })

  it('the whole-hero control is keyboard-activable (native button — Enter/Space handled by the browser) and toggles on click', () => {
    render(<Harness />)
    const btn = screen.getByRole('button', { name: 'Brand & Identity' })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(btn)
    expect(screen.getByRole('button', { name: 'Brand & Identity' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('hero-expanded')).toBeDefined()
  })

  it('vb:navigate with a matching sectionKey force-expands WITHOUT writing localStorage', async () => {
    render(<Harness />)
    expect(document.getElementById('vb-region-brand')?.getAttribute('aria-hidden')).toBe('true')

    await act(async () => {
      window.dispatchEvent(new CustomEvent('vb:navigate', { detail: { sectionKey: 'brand' } }))
    })

    expect(document.getElementById('vb-region-brand')?.getAttribute('aria-hidden')).toBeNull()
    expect(stored.has(collapseKey(1, 'brand'))).toBe(false)
  })

  it('vb:navigate for a DIFFERENT sectionKey is a no-op', async () => {
    render(<Harness />)
    await act(async () => {
      window.dispatchEvent(new CustomEvent('vb:navigate', { detail: { sectionKey: 'assessment' } }))
    })
    expect(document.getElementById('vb-region-brand')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('an initial #hash matching the section force-expands on mount', () => {
    window.location.hash = '#brand'
    render(<Harness />)
    expect(document.getElementById('vb-region-brand')?.getAttribute('aria-hidden')).toBeNull()
    expect(stored.has(collapseKey(1, 'brand'))).toBe(false)
  })

  // Task 10 (docs/superpowers/sdd/task-10-brief.md): the initial-#hash path
  // now routes through the SAME animation-aware `scrollToSectionAfterReveal`
  // helper as `vb:navigate` (see viewbook-navigate.test.ts for the detailed
  // wait-vs-immediate coverage) instead of relying on the browser's native
  // (pre-React, single-shot) hash scroll. This is an end-to-end wiring check:
  // a fresh mount is default-collapsed, so `#brand` must NOT scroll
  // synchronously — it waits for the hero-stage reveal (in jsdom, which runs
  // no real CSS transitions, that means the computed-duration timeout
  // fallback) before scrolling.
  it('an initial #hash on a fresh (collapsed) mount does not scroll synchronously, but does scroll once the reveal wait elapses', () => {
    vi.useFakeTimers()
    window.location.hash = '#brand'
    // The real DOM has `<section id={sectionKey}>` OUTSIDE this component
    // (SectionShell) — reproduce that wrapper here, since
    // scrollToSectionAfterReveal resolves the scroll target and the
    // `.vb-collapsible`/`.vb-hero-stage` wait-source via
    // `document.getElementById(sectionKey)`.
    const wrapper = document.createElement('section')
    wrapper.id = 'brand'
    document.body.appendChild(wrapper)
    wrapper.scrollIntoView = vi.fn()

    render(<Harness />, { container: wrapper })

    const stage = wrapper.querySelector('.vb-hero-stage') as HTMLElement
    // forceExpand() ran synchronously in the mount effect (before the
    // scrollToSectionAfterReveal call in the same effect body), but React's
    // resulting re-render is deferred — the helper's own "already revealed?"
    // read happens against the PRE-update DOM, so it correctly sees
    // "collapsed" and sets up the wait, even though by the time render()
    // returns (after act() flushes the effect's state update) the DOM below
    // already shows "expanded".
    expect(stage.closest('.vb-collapsible')?.getAttribute('data-vb-state')).toBe('expanded')
    expect(wrapper.scrollIntoView).not.toHaveBeenCalled()

    // jsdom runs no real CSS transitions, so no transitionend ever fires —
    // this exercises the computed-duration/default timeout fallback.
    vi.advanceTimersByTime(1000)
    expect(wrapper.scrollIntoView).toHaveBeenCalledTimes(1)

    // Manually-appended wrapper (not RTL's own default container) — remove
    // it so it doesn't leak an id="brand" node into later tests in this file.
    wrapper.remove()
  })

  it('Task 8: BOTH data-vb-face="collapsed" and data-vb-face="expanded" nodes exist in the DOM simultaneously (the cross-fade stage)', () => {
    const { container } = render(<Harness />)
    expect(container.querySelector('[data-vb-face="collapsed"]')).not.toBeNull()
    expect(container.querySelector('[data-vb-face="expanded"]')).not.toBeNull()
  })

  it('Task 8: the inactive face is aria-hidden — collapsed (default): expanded face hidden; after toggling: collapsed face hidden', () => {
    const { container } = render(<Harness />)
    const collapsedFace = container.querySelector('[data-vb-face="collapsed"]')
    const expandedFace = container.querySelector('[data-vb-face="expanded"]')
    expect(collapsedFace?.getAttribute('aria-hidden')).toBeNull()
    expect(expandedFace?.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Brand & Identity' }))
    expect(collapsedFace?.getAttribute('aria-hidden')).toBe('true')
    expect(expandedFace?.getAttribute('aria-hidden')).toBeNull()
  })

  it('Task 8: with both faces rendering, the button still resolves to exactly ONE accessible name (name-from-content skips the aria-hidden face)', () => {
    render(<Harness />)
    // Would throw if more than one match / the name were duplicated.
    expect(screen.getByRole('button', { name: 'Brand & Identity' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Brand & Identity' }))
    expect(screen.getByRole('button', { name: 'Brand & Identity' })).toBeDefined()
  })

  it('previewMode: an expand click NEVER scrolls (the admin page must not yank to the preview canvas)', () => {
    vi.useFakeTimers()
    const wrapper = document.createElement('section')
    wrapper.id = 'brand'
    document.body.appendChild(wrapper)
    wrapper.scrollIntoView = vi.fn()
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)

    render(<Harness previewMode />, { container: wrapper })
    const btn = screen.getByRole('button', { name: 'Brand & Identity' })

    // previewMode starts expanded — collapse, then expand again.
    fireEvent.click(btn)
    fireEvent.click(btn)
    vi.advanceTimersByTime(2000)
    expect(screen.getByTestId('hero-expanded')).toBeDefined()
    expect(wrapper.scrollIntoView).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    wrapper.remove()
  })

  it('previewMode: clicking toggles visuals but NEVER writes localStorage', () => {
    render(<Harness previewMode />)
    // previewMode starts expanded (ThemePreview always shows the open hero).
    expect(screen.getByTestId('hero-expanded')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Brand & Identity' }))
    expect(screen.getByTestId('hero-collapsed')).toBeDefined()
    expect(stored.size).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Brand & Identity' }))
    expect(screen.getByTestId('hero-expanded')).toBeDefined()
    expect(stored.size).toBe(0)
  })

  // Task 13 (docs/superpowers/sdd/task-13-brief.md): wires
  // `useWelcomeAutoReveal` through this component. `autoRevealMs` gates BOTH
  // whether the hook is armed (`enabled: autoRevealMs != null`) AND whether
  // this component's own consume() call sites (button click, vb:navigate/
  // hash force-expand) touch the shared `vb:welcome-revealed:<id>` flag at
  // all — critical because that flag is VIEWBOOK-scoped, not section-scoped,
  // and every section renders this same component (see file banner /
  // Codex bug-fix note in the brief).
  describe('Task 13: welcome auto-reveal wiring', () => {
    it('autoRevealMs=0 with no stored flag: auto-expands after a frame and writes the welcome flag', () => {
      let rafCallback: FrameRequestCallback | null = null
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallback = cb
        return 1
      })
      const { container } = render(<Harness autoRevealMs={0} />)
      const root = container.querySelector('.vb-collapsible')
      expect(root?.getAttribute('data-vb-state')).toBe('collapsed')
      expect(stored.has(welcomeRevealedKey(1))).toBe(false)

      act(() => {
        rafCallback?.(0)
      })

      expect(root?.getAttribute('data-vb-state')).toBe('expanded')
      expect(stored.get(welcomeRevealedKey(1))).toBe('1')
    })

    it('autoRevealMs=undefined: never auto-expands, and clicking the button does NOT write the welcome flag', () => {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
      const { container } = render(<Harness autoRevealMs={undefined} />)
      // The hook is disabled entirely (enabled: autoRevealMs != null → false)
      // — it never arms a rAF/timer in the first place.
      expect(rafSpy).not.toHaveBeenCalled()

      const root = container.querySelector('.vb-collapsible')
      expect(root?.getAttribute('data-vb-state')).toBe('collapsed')

      fireEvent.click(screen.getByRole('button', { name: 'Brand & Identity' }))

      // Ordinary click still expands (unrelated to auto-reveal) — but this
      // is NOT the welcome section, so its click must never write the
      // viewbook-scoped welcome flag.
      expect(root?.getAttribute('data-vb-state')).toBe('expanded')
      expect(stored.has(welcomeRevealedKey(1))).toBe(false)
    })

    it('autoRevealMs=undefined: an initial #hash force-expand does NOT write the welcome flag either', () => {
      window.location.hash = '#brand'
      render(<Harness autoRevealMs={undefined} sectionKey="brand" />)
      expect(document.getElementById('vb-region-brand')?.getAttribute('aria-hidden')).toBeNull()
      expect(stored.has(welcomeRevealedKey(1))).toBe(false)
    })

    it('autoRevealMs=0 (the welcome section): clicking the button before the frame fires calls consume() — writes the flag and cancels the pending auto-reveal', () => {
      let rafCallback: FrameRequestCallback | null = null
      const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallback = cb
        return 5
      })
      render(<Harness autoRevealMs={0} />)

      fireEvent.click(screen.getByRole('button', { name: 'Brand & Identity' }))

      expect(stored.get(welcomeRevealedKey(1))).toBe('1')
      expect(cancelSpy).toHaveBeenCalledWith(5)

      // The (leaked, mocked) rAF callback firing afterward must be inert —
      // fire() re-reads the flag and bails (same guarantee as
      // useWelcomeAutoReveal's own test suite).
      act(() => {
        rafCallback?.(0)
      })
    })
  })
})
