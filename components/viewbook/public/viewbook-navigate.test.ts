// @vitest-environment jsdom
// PR7 Task 9 review fix: `navigateToAnchor` resolves `#vb-doc-<filename>`
// anchors, and those filenames end `.webp`/`.pdf`. Regression coverage for the
// bug where `document.querySelector('#vb-doc-a.webp')` parsed `.webp` as a
// class selector, returned null, and silently dropped the scroll/flash.
//
// Task 10 (docs/superpowers/sdd/task-10-brief.md — Codex fix 4): the reveal
// transition (Tasks 7-9) means a collapsed section's `.vb-hero-stage` is
// still mid-animation a frame after it's told to expand — the old "defer one
// requestAnimationFrame then scrollIntoView" heuristic targets a still-moving
// box. `scrollToSectionAfterReveal` replaces the guess with a real signal
// (the stage's own filtered `height` transitionend, with a computed-duration
// timeout backstop) and is the ONE implementation both `navigateToAnchor`
// (vb:navigate / TOC clicks) and CollapsibleSection's initial-#hash mount
// path route through.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { navigateToAnchor, scrollToSectionAfterReveal } from './viewbook-navigate'

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// Builds the real DOM shape CollapsibleSection/SectionShell produce: a
// `<section id={sectionKey}>` containing `.vb-collapsible[data-vb-state]` >
// `.vb-hero-stage`, with an optional nested target (e.g. a DataSource field)
// deeper inside — mirroring how TOC/search anchors can point at something
// more specific than the section itself.
function buildSection(sectionKey: string, state: 'collapsed' | 'expanded', nestedId?: string) {
  const section = document.createElement('section')
  section.id = sectionKey
  section.innerHTML = `
    <div class="vb-collapsible" data-vb-state="${state}">
      <span class="vb-hero-stage"></span>
      <div class="vb-body">${nestedId ? `<div id="${nestedId}">nested</div>` : ''}</div>
    </div>`
  document.body.appendChild(section)
  const stage = section.querySelector('.vb-hero-stage') as HTMLElement
  const collapsibleRoot = section.querySelector('.vb-collapsible') as HTMLElement
  // jsdom implements neither CSS transitions nor scrollIntoView.
  ;(section as unknown as HTMLElement).scrollIntoView = vi.fn()
  if (nestedId) {
    ;(document.getElementById(nestedId) as HTMLElement).scrollIntoView = vi.fn()
  }
  return { section, stage, collapsibleRoot }
}

function fireTransitionEnd(target: Element, propertyName: string) {
  const evt = new Event('transitionend', { bubbles: false })
  Object.defineProperty(evt, 'propertyName', { value: propertyName })
  Object.defineProperty(evt, 'target', { value: target, configurable: true })
  target.dispatchEvent(evt)
}

describe('navigateToAnchor', () => {
  it('flashes a dotted-id doc anchor (e.g. #vb-doc-a.webp) instead of silently missing it', async () => {
    const el = document.createElement('div')
    el.id = 'vb-doc-a.webp'
    el.scrollIntoView = vi.fn()
    document.body.appendChild(el)

    navigateToAnchor('strategy', '#vb-doc-a.webp')

    expect(el.classList.contains('vb-flash')).toBe(true)
  })

  it('still flashes a plain (non-dotted) anchor', async () => {
    const el = document.createElement('div')
    el.id = 'vb-section-strategy'
    el.scrollIntoView = vi.fn()
    document.body.appendChild(el)

    navigateToAnchor('strategy', '#vb-section-strategy')

    expect(el.classList.contains('vb-flash')).toBe(true)
  })

  // Review fix P2: a search/nav target inside a CLOSED <details> (building-stage
  // carried sections, DataSource category/field <details>) has no layout box —
  // scrollIntoView would land on nothing. Every enclosing closed <details>
  // ancestor must be opened before the scroll/flash.
  it('opens nested closed <details> ancestors before flashing the target', async () => {
    document.body.innerHTML = `
      <details id="outer"><summary>outer</summary>
        <details id="inner"><summary>inner</summary>
          <div id="vb-field-5">field</div>
        </details>
      </details>`
    const outer = document.getElementById('outer') as HTMLDetailsElement
    const inner = document.getElementById('inner') as HTMLDetailsElement
    const target = document.getElementById('vb-field-5') as HTMLElement
    target.scrollIntoView = vi.fn()
    expect(outer.open).toBe(false)
    expect(inner.open).toBe(false)

    navigateToAnchor('data-source', '#vb-field-5')

    expect(inner.open).toBe(true)
    expect(outer.open).toBe(true)
    expect(target.classList.contains('vb-flash')).toBe(true)
  })

  it('dispatches vb:navigate (with detail.sectionKey) before scrollIntoView runs, for a target with nothing to wait for', () => {
    const order: string[] = []
    let capturedDetail: { sectionKey?: string; anchor?: string } | null = null

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation((event: Event) => {
      if (event.type === 'vb:navigate') {
        order.push('dispatch')
        capturedDetail = (event as CustomEvent).detail as { sectionKey?: string; anchor?: string }
      }
      return true
    })

    const el = document.createElement('div')
    el.id = 'vb-section-order-check'
    el.scrollIntoView = vi.fn(() => {
      order.push('scroll')
    })
    document.body.appendChild(el)

    // No `.vb-collapsible`/`.vb-hero-stage` ancestor exists for this target
    // (there's no section with id "strategy") — nothing is animating, so the
    // scroll runs immediately, in the same call. Dispatch must still have
    // run first.
    navigateToAnchor('strategy', '#vb-section-order-check')

    expect(order).toEqual(['dispatch', 'scroll'])
    expect(capturedDetail).toEqual({ sectionKey: 'strategy', anchor: '#vb-section-order-check' })

    dispatchSpy.mockRestore()
  })

  it('an already-expanded section scrolls (and flashes) immediately — no wait', () => {
    const { section } = buildSection('brand', 'expanded')

    navigateToAnchor('brand', '#brand')

    expect(section.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(section.classList.contains('vb-flash')).toBe(true)
  })

  it('a COLLAPSED section does NOT scroll synchronously, and does NOT scroll after just one requestAnimationFrame — it waits for the hero-stage height transitionend', async () => {
    const { section, stage } = buildSection('brand', 'collapsed')

    navigateToAnchor('brand', '#brand')

    // Not synchronous.
    expect(section.scrollIntoView).not.toHaveBeenCalled()

    // Not after a single rAF tick either (the old, now-wrong, heuristic).
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(section.scrollIntoView).not.toHaveBeenCalled()

    // The reveal's height transition finishes — NOW it scrolls.
    fireTransitionEnd(stage, 'height')
    expect(section.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(section.classList.contains('vb-flash')).toBe(true)
  })

  it('filters transitionend to the stage element + "height" property — an unrelated transition on the stage (or on another element) is ignored', () => {
    const { section, stage } = buildSection('brand', 'collapsed')

    navigateToAnchor('brand', '#brand')

    // Same element, wrong property (Task 8 also transitions opacity on the
    // faces — a same-node different-property event must not fire early).
    fireTransitionEnd(stage, 'opacity')
    expect(section.scrollIntoView).not.toHaveBeenCalled()

    // Right property, wrong element.
    const other = document.createElement('div')
    fireTransitionEnd(other, 'height')
    expect(section.scrollIntoView).not.toHaveBeenCalled()

    // The real one.
    fireTransitionEnd(stage, 'height')
    expect(section.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('falls back to a timeout when transitionend never fires (jsdom does not run real CSS transitions; also covers a detached-node edge case in production)', () => {
    vi.useFakeTimers()
    const { section } = buildSection('brand', 'collapsed')

    navigateToAnchor('brand', '#brand')

    vi.advanceTimersByTime(100)
    expect(section.scrollIntoView).not.toHaveBeenCalled()

    // jsdom's getComputedStyle can't resolve the calc()/var() transition
    // duration (it returns ""), so this exercises the ~700ms DEFAULT
    // fallback, not a computed one — see the "honors a computed
    // transition-duration" test below for that half of the contract.
    vi.advanceTimersByTime(1000)
    expect(section.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('honors a computed transition-duration shorter than the default fallback (mocking getComputedStyle, since jsdom cannot resolve calc()/var() itself)', () => {
    vi.useFakeTimers()
    const { section, stage } = buildSection('brand', 'collapsed')

    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      if (el === stage) {
        return { transitionDuration: '0.3s' } as unknown as CSSStyleDeclaration
      }
      return {} as CSSStyleDeclaration
    })

    navigateToAnchor('brand', '#brand')

    vi.advanceTimersByTime(299)
    expect(section.scrollIntoView).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2)
    expect(section.scrollIntoView).toHaveBeenCalledTimes(1)

    getComputedStyleSpy.mockRestore()
  })

  it('prefers-reduced-motion scrolls immediately even when the section is collapsed — no wait', () => {
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    )
    const { section } = buildSection('brand', 'collapsed')

    navigateToAnchor('brand', '#brand')

    expect(section.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(section.classList.contains('vb-flash')).toBe(true)

    matchMediaSpy.mockRestore()
  })

  it('the wait is scoped to the SECTION (by sectionKey), but the scroll+flash target can be a more specific nested anchor (e.g. a DataSource field)', () => {
    const { stage } = buildSection('data-source', 'collapsed', 'vb-field-9')
    const field = document.getElementById('vb-field-9') as HTMLElement

    navigateToAnchor('data-source', '#vb-field-9')

    expect(field.scrollIntoView).not.toHaveBeenCalled()

    fireTransitionEnd(stage, 'height')

    expect(field.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(field.classList.contains('vb-flash')).toBe(true)
  })
})

describe('scrollToSectionAfterReveal', () => {
  it('defaults the anchor to `#${sectionKey}` (the initial-#hash mount case has no separate anchor)', () => {
    const { section } = buildSection('assessment', 'expanded')

    scrollToSectionAfterReveal('assessment')

    expect(section.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the target does not exist', () => {
    expect(() => scrollToSectionAfterReveal('does-not-exist')).not.toThrow()
  })

  it('a section with no `.vb-collapsible` (e.g. a bookend, per Task 9\'s widen-collapse note) scrolls immediately — nothing to wait for', () => {
    const section = document.createElement('section')
    section.id = 'welcome'
    section.scrollIntoView = vi.fn()
    document.body.appendChild(section)

    scrollToSectionAfterReveal('welcome')

    expect(section.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('invokes onScrolled with the resolved target after scrolling', () => {
    const { section } = buildSection('brand', 'expanded')
    const onScrolled = vi.fn()

    scrollToSectionAfterReveal('brand', { anchor: '#brand', onScrolled })

    expect(onScrolled).toHaveBeenCalledWith(section)
  })
})
