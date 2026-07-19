'use client'

// Viewbook UX pass, Lane 1 Task 4 — StickyOffsetProbe.
//
// A `'use client'` measurement leaf, no props, mounted EXACTLY ONCE by
// `ViewbookShell` (Task 5). It measures the top chrome — the `#vb-progress-
// nav` bar and, when the operator presentation-mode chrome is showing, the
// `#vb-operator-bar` — and publishes three CSS custom properties onto BOTH
// the nearest `[data-vb-theme-root]` element AND `document.documentElement`
// (deduped when the theme root IS documentElement, i.e. no marker present),
// so sticky section headers (`SectionReveal`) and scroll-margin anchors
// (`SectionShell`) inside the theme root, AND operator chrome mounted
// OUTSIDE it (e.g. the Context Lens inspector), can all pin/scroll beneath a
// responsive, possibly two-tier, top nav without any side hardcoding a pixel
// height:
//   --vb-progress-nav-height  the progress nav's measured height
//   --vb-operator-bar-height  the operator bar's measured height, or 0px when absent
//   --vb-sticky-offset        the sum of the two
//
// Re-measurement is driven by a ResizeObserver on whichever of the two ids
// exist (catches responsive height changes — e.g. the nav wrapping to two
// rows on narrow viewports) plus a MutationObserver on `document.body`
// (subtree childList) that re-queries `#vb-operator-bar` so the offset
// rebinds the instant the operator toggles presentation mode on/off — the
// ResizeObserver alone can't see an element that didn't exist a moment ago.
// All window/document access is confined to the effect (SSR-safe); jsdom/SSR
// environments without ResizeObserver just skip that observer and keep
// working off the MutationObserver-driven recomputes.
import { useEffect } from 'react'

const PROGRESS_NAV_ID = 'vb-progress-nav'
const OPERATOR_BAR_ID = 'vb-operator-bar'
const THEME_ROOT_SELECTOR = '[data-vb-theme-root]'

function measuredHeight(el: Element | null): number {
  if (!el) return 0
  const height = el.getBoundingClientRect().height
  return Number.isFinite(height) && height > 0 ? height : 0
}

function resolveThemeRoot(): HTMLElement {
  const marked = document.querySelector<HTMLElement>(THEME_ROOT_SELECTOR)
  return marked ?? document.documentElement
}

export function StickyOffsetProbe() {
  useEffect(() => {
    let operatorEl: HTMLElement | null = document.getElementById(OPERATOR_BAR_ID)

    function recompute() {
      const navEl = document.getElementById(PROGRESS_NAV_ID)
      const navHeight = measuredHeight(navEl)
      const operatorHeight = measuredHeight(operatorEl)
      const sticky = navHeight + operatorHeight
      // Publish to BOTH the nearest theme root (existing SectionReveal/
      // SectionShell consumers) AND document.documentElement, so operator
      // chrome mounted OUTSIDE the theme root (the Context Lens inspector)
      // inherits the offset. CSS vars resolve once — the theme root simply
      // overrides the inherited doc-root value, never double-applied.
      const targets = new Set<HTMLElement>([resolveThemeRoot(), document.documentElement])
      for (const root of targets) {
        root.style.setProperty('--vb-progress-nav-height', `${navHeight}px`)
        root.style.setProperty('--vb-operator-bar-height', `${operatorHeight}px`)
        root.style.setProperty('--vb-sticky-offset', `${sticky}px`)
      }
    }

    // Initial measurement — independent of whether/when the observers below
    // fire, so the offset is correct as soon as this effect runs.
    recompute()

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => recompute())
      const navEl = document.getElementById(PROGRESS_NAV_ID)
      if (navEl) resizeObserver.observe(navEl)
      if (operatorEl) resizeObserver.observe(operatorEl)
    }

    // The operator bar mounts/unmounts as the operator toggles presentation
    // mode. A ResizeObserver can only watch elements that already exist, so
    // rebind it whenever the body subtree changes.
    function rebindOperatorBar() {
      const current = document.getElementById(OPERATOR_BAR_ID)
      if (current === operatorEl) return
      if (operatorEl && resizeObserver) resizeObserver.unobserve(operatorEl)
      operatorEl = current
      if (operatorEl && resizeObserver) resizeObserver.observe(operatorEl)
      recompute()
    }

    let mutationObserver: MutationObserver | null = null
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => rebindOperatorBar())
      mutationObserver.observe(document.body, { subtree: true, childList: true })
    }

    return () => {
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [])

  return null
}
