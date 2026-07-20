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
// aria-expanded aria-controls>…hero content…</button></h2>`.
//
// Round-2 review fix (same date): a <button> may ALSO only contain PHRASING
// content — SectionShell's hero markup used to nest <div> decorative layers
// (image/gradient/accent/cluster) directly inside it, which is invalid for
// the same reason a block heading is. SectionShell now builds every one of
// those decorative layers as a <span> (same classes/positioning — Tailwind's
// `flex`/`absolute` utilities set `display` explicitly, so the swap is
// visually inert), leaving only phrasing content (spans, the visible title
// span, inline SVGs, the alt="" image) inside the button.
//
// With ONLY phrasing content inside — and every decorative layer marked
// aria-hidden — the button's accessible name now comes from its one visible
// text node (the title span) via ordinary "name from content": no explicit
// aria-label needed, so it (and the wrapping <h2>'s, which would otherwise
// duplicate it) is REMOVED — one visible title, one source of truth for the
// name, instead of three copies that could drift. `aria-expanded` already
// conveys open/closed state to AT, so no "Expand"/"Collapse" verb prefix is
// needed either (the reference APG example doesn't use one).
//
// The always-rendered controlled region below is a landmark (`role="region"`)
// and every landmark needs its own accessible name — it has no title span of
// its own to point `aria-labelledby` at (the two candidate title spans live
// in caller-supplied, conditionally-rendered hero content), so it gets a
// direct `aria-label={title}` — simpler than plumbing a shared id across the
// SectionShell/CollapsibleSection boundary for content that's already
// visually adjacent.
//
// The controlled region is ALWAYS rendered (collapse toggles aria-hidden/
// inert, never DOM presence) so `aria-controls` always resolves to a real
// element regardless of collapsed state.
//
// This island does NOT emit `data-operator-section` — OperatorSectionWrapper
// (rendered OUTSIDE every section component, server-side in the page) owns
// that single scroll-spy marker.
//
// Task 7 (2026-07-19, docs/superpowers/sdd/): the body region no longer
// toggles via instant `display:none` — `hidden`/`display:none` freeze the
// element out of layout entirely, which kills any transition on it. Instead
// the region is ALWAYS laid out and a scoped grid-rows animation
// (`.vb-body{grid-template-rows:1fr↔0fr}`) reveals/hides it, with an inner
// opacity+translateY lift for polish. The root carries `data-vb-state`
// (rather than a boolean prop) so the CSS can key off logical `collapsed`
// without a second source of truth. `--vb-reveal-scale` (default 1) lets a
// caller (e.g. a reduced-emphasis or QA context) scale every duration here
// without touching the calc() literals; `prefers-reduced-motion` disables the
// transition outright. This task does NOT touch hero rendering — that's a
// later task.
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
    <div data-vb-state={collapsed ? 'collapsed' : 'expanded'} className="vb-collapsible">
      {/* Scoped animation for the body reveal. grid-template-rows 1fr↔0fr on
          a single-row grid is the standard "animate to auto height" trick —
          unlike max-height it needs no guessed cap. The inner opacity+
          translateY lift is purely cosmetic polish on top of that. Every
          duration scales off `--vb-reveal-scale` (default 1) so a caller can
          speed up/slow down/freeze the animation globally without editing
          the calc() literals here. */}
      <style>{`
        .vb-collapsible .vb-body{display:grid;grid-template-rows:1fr;transition:grid-template-rows calc(520ms*var(--vb-reveal-scale,1)) cubic-bezier(.16,1,.3,1)}
        .vb-collapsible[data-vb-state="collapsed"] .vb-body{grid-template-rows:0fr}
        .vb-collapsible .vb-body-inner{overflow:hidden;min-height:0}
        .vb-collapsible .vb-body-lift{opacity:1;transform:none;transition:opacity calc(520ms*var(--vb-reveal-scale,1)) cubic-bezier(.16,1,.3,1),transform calc(520ms*var(--vb-reveal-scale,1)) cubic-bezier(.16,1,.3,1)}
        .vb-collapsible[data-vb-state="collapsed"] .vb-body-lift{opacity:0;transform:translateY(20px)}
        @media (prefers-reduced-motion:reduce){.vb-collapsible .vb-body,.vb-collapsible .vb-body-lift{transition:none}}
      `}</style>
      {/* APG Accordion: the heading WRAPS the button (not the reverse) — see
          the file banner. `id={sectionKey}` scroll anchor stays on the outer
          <section> in SectionShell, unaffected by this h2. Neither the h2 nor
          the button carries an explicit aria-label — the button's ONLY
          visible content is the title (everything decorative inside is
          aria-hidden), so both derive their accessible name from it. */}
      <h2>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={regionId}
          onClick={collapsed ? expand : collapse}
          className="group block w-full appearance-none rounded-xl border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2"
        >
          {collapsed ? heroCollapsed : heroExpanded}
        </button>
      </h2>
      {/* Region ALWAYS mounted (never `hidden`/`display:none` — those would
          freeze it out of layout and kill the transition above); aria-hidden
          + inert while collapsed so aria-controls resolves and AT/keyboard
          can't reach content that's visually collapsed away. aria-label
          names the landmark (see file banner). */}
      <div
        id={regionId}
        role="region"
        aria-label={title}
        aria-hidden={collapsed ? true : undefined}
        inert={collapsed}
        className="vb-body"
      >
        <div className="vb-body-inner">
          <div className="vb-body-lift">{body}</div>
        </div>
      </div>
    </div>
  )
}
