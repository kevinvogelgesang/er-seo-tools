'use client'

// The client island that gives every viewer an in-hero expand/collapse
// control. 2026-07-19 revision (docs/superpowers/specs/2026-07-19-viewbook-
// collapse-local-revision.md): collapse is now PURELY LOCAL — no fetch, no
// shared/server state, no operator distinction. Every viewer (operator
// included) sees their own collapse preference on their own machine via
// useCollapseState (localStorage, default collapsed).
//
// The WHOLE hero band — collapsed compact row OR expanded hero — is a single
// real <button> (native keyboard activation, no manual role/tabIndex/keydown
// plumbing needed) that toggles collapse state. The body below is NEVER a
// collapse target, so its links/content stay clickable.
//
// Post-review a11y fix (2026-07-19): a <button> may not validly contain a
// block heading, so the section's <h2> title used to live INSIDE the button
// (SectionShell built it that way) — invalid HTML that strips heading-role
// from AT heading navigation. This now follows the W3C ARIA APG Accordion
// pattern: the heading WRAPS the button instead
// (https://www.w3.org/WAI/ARIA/apg/patterns/accordion/) — `<h2><button
// aria-expanded aria-controls>…hero content, incl. the title as a plain
// <span>…</button></h2>`. `aria-expanded` already conveys open/closed to AT,
// so the button's accessible name is just the title (`aria-label={title}`,
// decoupled from the decorative aria-hidden layers inside) — no "Expand"/
// "Collapse" verb prefix needed (the reference APG example doesn't use one
// either). The wrapping <h2> ALSO gets `aria-label={title}` directly — an
// ancestor's "name from content" is not guaranteed to adopt a descendant
// button's own aria-label (implementation-dependent name-computation
// recursion), so both elements declare the SAME name explicitly rather than
// relying on one to derive it from the other.
//
// The controlled region is ALWAYS rendered (collapse toggles hidden/inert,
// never DOM presence) so `aria-controls` always resolves to a real element
// regardless of collapsed state.
//
// This island does NOT emit `data-operator-section` — OperatorSectionWrapper
// (rendered OUTSIDE every section component, server-side in the page) owns
// that single scroll-spy marker.
import { useEffect, type ReactNode } from 'react'
import { useCollapseState } from './useCollapseState'

export function CollapsibleSection({
  viewbookId,
  sectionKey,
  title,
  heroExpanded,
  heroCollapsed,
  body,
  regionId,
  previewMode = false,
}: {
  viewbookId: number
  sectionKey: string
  title: string
  heroExpanded: ReactNode // full hero (image+overlay+title+done-check+collapse cue)
  heroCollapsed: ReactNode // compact accordion row (image+wash+accent+title+done-check+affordance)
  body: ReactNode // SectionReveal body — ALWAYS rendered, hidden when collapsed
  regionId: string
  previewMode?: boolean // ThemePreview: render visuals but NEVER touch localStorage
}) {
  const { collapsed, expand, collapse, forceExpand } = useCollapseState({
    viewbookId,
    sectionKey,
    previewMode,
  })

  useEffect(() => {
    // vb:navigate (TOC/inspector clicks) / initial #hash → force-open,
    // in-memory only — never persisted (see useCollapseState).
    function onNav(e: Event) {
      const detail = (e as CustomEvent).detail as { sectionKey?: string } | null
      if (detail?.sectionKey === sectionKey) forceExpand()
    }
    window.addEventListener('vb:navigate', onNav)
    if (window.location.hash === `#${sectionKey}`) forceExpand()
    return () => window.removeEventListener('vb:navigate', onNav)
  }, [sectionKey, forceExpand])

  return (
    <div>
      {/* APG Accordion: the heading WRAPS the button (not the reverse) — see
          the file banner. `id={sectionKey}` scroll anchor stays on the outer
          <section> in SectionShell, unaffected by this h2. */}
      <h2 aria-label={title}>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={regionId}
          aria-label={title}
          onClick={collapsed ? expand : collapse}
          className="group block w-full appearance-none rounded-xl border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2"
        >
          {collapsed ? heroCollapsed : heroExpanded}
        </button>
      </h2>
      {/* Region ALWAYS present; hidden+inert while collapsed so aria-controls
          resolves. `inert` (React 19 boolean) + aria-hidden + display:none is
          the tab-order/a11y guard incl. older engines. */}
      <div
        id={regionId}
        role="region"
        aria-hidden={collapsed ? true : undefined}
        inert={collapsed}
        hidden={collapsed}
        style={collapsed ? { display: 'none' } : undefined}
      >
        {body}
      </div>
    </div>
  )
}
