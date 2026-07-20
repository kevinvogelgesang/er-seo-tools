// PR7 Task 9: the ONE client-side navigation primitive shared by the floating
// TOC rail (and any future in-page nav). Dependency-free, no React, no server
// imports. Every window/document access is guarded so an accidental
// server-side call (or a stripped-down test env) is a silent no-op, never a
// throw.
//
// Order is load-bearing: dispatch the `vb:navigate` CustomEvent on `window`
// FIRST so the owning SectionReveal (Task 4) / CollapsibleSection force-
// expands its collapsible region synchronously, THEN scroll the anchor
// target into view (and, for TOC/search navigation, briefly flash it). The
// flash is a `.vb-flash` class (styled by the TOC rail's inline <style>); the
// class is removed after the pulse. prefers-reduced-motion is respected by
// the CSS (static tint instead of a pulse) — the JS only toggles the class
// and picks a non-smooth scroll.
//
// Task 10 (2026-07-19, docs/superpowers/sdd/task-10-brief.md — Codex fix 4):
// Tasks 7-9 gave the hero band ("`.vb-hero-stage`") a real animated height
// transition on expand. The OLD scroll timing (defer one requestAnimationFrame
// then scrollIntoView) was a heuristic that assumed the region had already
// reached its final layout box by the next frame — true before the reveal
// was animated, false now: a collapsed→expanded section's stage is still
// mid-transition a frame later, so scrollIntoView targeted a box that kept
// growing underneath it. `scrollToSectionAfterReveal` replaces that guess
// with a real signal: wait for the stage's OWN `height` transitionend (with
// a computed-duration timeout backstop in case the event never fires — a
// detached node, a browser that coalesces the event, etc.) before scrolling.
// It ALSO absorbs the "open closed <details> ancestors" step (previously
// inline in this file's `run()`) so both call sites — the `vb:navigate`
// handler below and CollapsibleSection's initial-`#hash`-on-mount branch —
// share ONE implementation instead of two copies of the wait logic.
//
// The section that determines whether a transition is pending is ALWAYS the
// section named by `sectionKey` (`document.getElementById(sectionKey)`), even
// when the thing being scrolled to/flashed is a MORE SPECIFIC descendant
// anchor inside it (e.g. a DataSource field or a doc-carrier chip — TOC/
// search items whose `anchor` differs from `#${sectionKey}`). That's why
// `scrollToSectionAfterReveal` takes the section key AND an optional anchor/
// onScrolled override: the wait is scoped to the section's OWN hero-stage,
// the scroll+callback target can be narrower.
import type { SectionKey } from '@/lib/viewbook/theme'

const FLASH_MS = 1200

// Backstop used when the stage's computed `transition-duration` can't be
// read (jsdom returns "" for it — real browsers always resolve calc()/var()
// to a concrete value) or doesn't parse. Comfortably above the CSS's actual
// 600ms*scale hero-stage height transition (see CollapsibleSection.tsx).
const DEFAULT_REVEAL_FALLBACK_MS = 700

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Resolves an `anchor` selector the same way both call sites need: a `#id`
// anchor is looked up verbatim via `getElementById` (dots and other
// CSS-unsafe characters included — DataSource doc anchors look like
// `#vb-doc-a.webp`, which `querySelector` would parse as an id selector
// followed by a `.webp` CLASS selector and silently fail to find);
// `querySelector` is reserved for non-`#` selectors.
function resolveAnchorElement(anchor: string): Element | null {
  try {
    return anchor.startsWith('#') ? document.getElementById(anchor.slice(1)) : document.querySelector(anchor)
  } catch {
    return null
  }
}

// Opens every enclosing CLOSED <details> ancestor of `target`. The
// `vb:navigate` dispatch handles SectionReveal/CollapsibleSection expansion,
// but it does NOT own native <details> — in the building stage the carried
// pc-setup/pc-invite sections sit inside a closed EarlierSteps <details>, and
// DataSource categories/fields live inside per-category <details> that may be
// closed. A target inside a closed <details> has no layout box, so
// scrollIntoView would land on nothing.
function openClosedDetailsAncestors(target: Element): void {
  let ancestor: Element | null = target
  while (ancestor) {
    const details: Element | null = ancestor.closest('details:not([open])')
    if (!(details instanceof HTMLDetailsElement)) break
    details.open = true
    ancestor = details.parentElement
  }
}

// First comma-separated `transition-duration` entry (the hero stage only
// ever declares one transition-property — `height` — so the first entry is
// the right one), converted to milliseconds. Returns null if unparseable
// (including jsdom's empty-string computed value).
function parseCssDurationMs(value: string): number | null {
  const first = value.split(',')[0]?.trim()
  if (!first) return null
  const match = /^(-?[\d.]+)(m?s)$/.exec(first)
  if (!match) return null
  const num = parseFloat(match[1])
  if (!Number.isFinite(num) || num <= 0) return null
  return match[2] === 'ms' ? num : num * 1000
}

function heroStageDurationMs(stage: Element): number {
  try {
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const parsed = parseCssDurationMs(window.getComputedStyle(stage).transitionDuration)
      if (parsed !== null) return parsed
    }
  } catch {
    // getComputedStyle unavailable/partial (old browser, stripped test env) —
    // fall through to the default below.
  }
  return DEFAULT_REVEAL_FALLBACK_MS
}

// Locates the section's own collapse root + animated hero stage (both live
// INSIDE `<section id={sectionKey}>` — see SectionShell.tsx/CollapsibleSection.tsx).
// Returns null when the section isn't collapsible (e.g. the bookend sections,
// which don't render CollapsibleSection) or hasn't mounted yet — both callers
// treat "no hero found" the same as "already revealed": scroll immediately,
// nothing to wait for.
function findHeroStage(sectionKey: string): { collapsibleRoot: Element; stage: Element } | null {
  let sectionEl: Element | null = null
  try {
    sectionEl = document.getElementById(sectionKey)
  } catch {
    sectionEl = null
  }
  if (!sectionEl) return null
  const collapsibleRoot = sectionEl.querySelector('.vb-collapsible')
  if (!collapsibleRoot) return null
  const stage = collapsibleRoot.querySelector('.vb-hero-stage')
  if (!stage) return null
  return { collapsibleRoot, stage }
}

export interface ScrollToSectionOptions {
  /** Element to scroll to (and, if `onScrolled` is given, hand back to it).
   * Defaults to `#${sectionKey}` — the section itself — which is exactly
   * right for the initial-`#hash`-on-mount case. TOC/search navigation
   * passes the more specific item anchor. */
  anchor?: string
  /** Invoked once scrollIntoView has run (used by `navigateToAnchor` to layer
   * the flash pulse on top without duplicating the wait logic here). */
  onScrolled?: (target: Element) => void
}

// The shared animation-aware navigation primitive (Task 10). Both the
// `vb:navigate` handler below and CollapsibleSection's initial-`#hash` mount
// branch route through this so there is exactly ONE implementation of "wait
// for the section's reveal before scrolling to it."
export function scrollToSectionAfterReveal(sectionKey: string, options: ScrollToSectionOptions = {}): void {
  if (typeof document === 'undefined') return

  const anchor = options.anchor ?? `#${sectionKey}`
  const target = resolveAnchorElement(anchor)
  if (!target) return

  openClosedDetailsAncestors(target)

  const scrollNow = () => {
    if (typeof (target as HTMLElement).scrollIntoView === 'function') {
      try {
        ;(target as HTMLElement).scrollIntoView(
          prefersReducedMotion() ? { block: 'start' } : { behavior: 'smooth', block: 'start' },
        )
      } catch {
        // jsdom / partial impls — non-fatal.
      }
    }
    options.onScrolled?.(target)
  }

  if (prefersReducedMotion()) {
    scrollNow()
    return
  }

  const hero = findHeroStage(sectionKey)
  const alreadyRevealed = !hero || hero.collapsibleRoot.getAttribute('data-vb-state') !== 'collapsed'
  if (alreadyRevealed) {
    // Nothing animating (not collapsible, or already expanded) — scroll now,
    // same as before Task 10.
    scrollNow()
    return
  }

  const stageEl = hero.stage
  let settled = false
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined

  function onTransitionEnd(e: Event) {
    // The stage has MULTIPLE transitions declared over its lifetime (Task 8
    // added cross-fading faces alongside the height transition) — filter to
    // the exact height transition on the stage element itself so an
    // unrelated transitionend bubbling/firing nearby doesn't trigger early.
    const te = e as TransitionEvent
    if (te.target === stageEl && te.propertyName === 'height') finish()
  }

  function finish() {
    if (settled) return
    settled = true
    stageEl.removeEventListener('transitionend', onTransitionEnd)
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer)
    scrollNow()
  }

  stageEl.addEventListener('transitionend', onTransitionEnd)
  fallbackTimer = setTimeout(finish, heroStageDurationMs(stageEl))
}

// Deliberate click-to-expand scroll (2026-07-19): smooth-scroll the SECTION
// TOP to the viewport top IN PARALLEL with the expand animation, so the hero
// rests at the top of the page as it morphs (the theme root's
// `[id]{scroll-margin-top:calc(var(--vb-sticky-offset)+12px)}` rule accounts
// for the sticky header). This deliberately does NOT wait for the reveal the
// way `scrollToSectionAfterReveal` does — that wait exists because TOC/hash
// anchors can live INSIDE the expanding region, where the target's position
// keeps moving until the transition settles. A section's OWN top never moves
// during its own expansion (only content BELOW it shifts), so scrolling
// immediately is stable and reads as one gesture with the morph.
export function scrollSectionToTop(sectionKey: string): void {
  if (typeof document === 'undefined') return
  let target: HTMLElement | null = null
  try {
    target = document.getElementById(sectionKey)
  } catch {
    return
  }
  if (!target || typeof target.scrollIntoView !== 'function') return
  try {
    target.scrollIntoView(
      prefersReducedMotion() ? { block: 'start' } : { behavior: 'smooth', block: 'start' },
    )
  } catch {
    // jsdom / partial impls — non-fatal.
  }
}

export function navigateToAnchor(sectionKey: SectionKey, anchor: string): void {
  if (typeof window === 'undefined') return

  // 1) Tell the owning SectionReveal/CollapsibleSection to force-expand
  // BEFORE we try to scroll — a collapsed region has zero (or animating)
  // height and would otherwise scroll to nothing (or a still-moving target).
  try {
    window.dispatchEvent(new CustomEvent('vb:navigate', { detail: { sectionKey, anchor } }))
  } catch {
    // CustomEvent unavailable (very old/edge env) — nothing more we can do.
    return
  }

  if (typeof document === 'undefined') return

  scrollToSectionAfterReveal(sectionKey, {
    anchor,
    onScrolled: (target) => {
      target.classList.add('vb-flash')
      setTimeout(() => {
        try {
          target.classList.remove('vb-flash')
        } catch {
          // element detached — ignore.
        }
      }, FLASH_MS)
    },
  })
}
