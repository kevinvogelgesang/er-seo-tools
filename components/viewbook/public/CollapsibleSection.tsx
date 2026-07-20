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
//
// Task 8 (2026-07-19, docs/superpowers/sdd/task-8-brief.md): the hero itself
// gets the same cross-fade treatment. Both `heroCollapsed` and `heroExpanded`
// are now rendered SIMULTANEOUSLY, stacked absolutely inside a `.vb-hero-
// stage` whose height animates between the collapsed-row height and the
// expanded-hero clamp, with each face opacity-crossfading in/out via
// `.vb-hero-face`. The inactive face is `aria-hidden` (not display:none —
// same "keep it mounted, hide it from AT" pattern as the body region above)
// so the button's accessible name still resolves to the ONE visible title
// (name-from-content excludes aria-hidden subtrees). `hasHeroImage` (threaded
// from SectionShell, which owns `heroUrl`) sets `data-vb-hero="none"` on the
// root for image-less sections so the CSS can key the shorter 30svh clamp
// instead of 38svh — preserving the pre-Task-8 no-image sizing. Two `<img>`
// nodes (one per face) is an accepted non-goal — hoisting the image to a
// shared plane isn't supported by the current hero-prop shape.
import { useEffect, type ReactNode } from 'react'
import { useCollapseState } from './useCollapseState'
import { useWelcomeAutoReveal } from './useWelcomeAutoReveal'
import { scrollToSectionAfterReveal } from './viewbook-navigate'

export function CollapsibleSection({
  viewbookId,
  sectionKey,
  title,
  heroExpanded,
  heroCollapsed,
  hasHeroImage = true,
  body,
  regionId,
  previewMode = false,
  autoRevealMs,
}: {
  viewbookId: number
  sectionKey: string
  title: string
  heroExpanded: ReactNode // full hero (image+overlay+title+done-check+collapse cue)
  heroCollapsed: ReactNode // compact accordion row (image+wash+accent+title+done-check+affordance)
  hasHeroImage?: boolean // false → shorter stage clamp (mirrors the pre-Task-8 no-image hero height)
  body: ReactNode // SectionReveal body — ALWAYS rendered, hidden when collapsed
  regionId: string
  previewMode?: boolean // ThemePreview: render visuals but NEVER touch localStorage
  // Task 13 (docs/superpowers/sdd/task-13-brief.md): set ONLY by the welcome
  // (pc-intro) section — every other caller omits this, leaving it
  // `undefined`. `useWelcomeAutoReveal`'s `enabled` is gated on `autoRevealMs
  // != null`, and this component's own `consume()` call sites (button click,
  // vb:navigate/hash force-expand) are gated the SAME way. This is
  // deliberate and load-bearing: `welcomeRevealedKey` is a single
  // VIEWBOOK-scoped localStorage flag (not per-section), and EVERY section
  // renders this component — an ungated consume() call would let clicking or
  // deep-linking to ANY section permanently suppress the real welcome
  // auto-reveal for this device.
  autoRevealMs?: number
}) {
  const { collapsed, expand, collapse, forceExpand, ready } = useCollapseState({
    viewbookId,
    sectionKey,
    previewMode,
  })

  const { consume } = useWelcomeAutoReveal({
    viewbookId,
    enabled: autoRevealMs != null,
    ready,
    collapsed,
    expand,
    delayMs: autoRevealMs ?? 0,
    previewMode,
  })

  useEffect(() => {
    // vb:navigate (TOC/inspector clicks) → force-open, in-memory only — never
    // persisted (see useCollapseState). The scroll itself is driven by the
    // dispatcher (navigateToAnchor), not here.
    function onNav(e: Event) {
      const detail = (e as CustomEvent).detail as { sectionKey?: string } | null
      if (detail?.sectionKey === sectionKey) {
        // Task 13: cancel the welcome's own pending auto-reveal BEFORE
        // force-expanding it — gated to the welcome section only (see the
        // `autoRevealMs` prop banner above); every other section's nav
        // force-expand must never touch the shared welcome flag.
        if (autoRevealMs != null) consume()
        forceExpand()
      }
    }
    window.addEventListener('vb:navigate', onNav)
    // Initial #hash-on-mount → force-open AND scroll once the reveal (if any)
    // finishes. Task 10: previously this only force-expanded and relied on
    // the browser's native initial-hash scroll — which fires once, before
    // React mounts/expands anything, and lands on a since-resized (or, for a
    // fresh-machine default-collapsed section, since-EXPANDED) box. Routing
    // through the shared helper (used identically by the vb:navigate path in
    // viewbook-navigate.ts) makes this deep-link case animation-aware too:
    // `forceExpand()` is called first (synchronously, in the same tick) so
    // the helper's own "already revealed?" check below reads the PRE-update
    // DOM state — collapsed here means a reveal transition is about to
    // start, and the helper waits for it before scrolling.
    if (window.location.hash === `#${sectionKey}`) {
      if (autoRevealMs != null) consume()
      forceExpand()
      scrollToSectionAfterReveal(sectionKey)
    }
    return () => window.removeEventListener('vb:navigate', onNav)
  }, [sectionKey, forceExpand, autoRevealMs, consume])

  return (
    <div
      data-vb-state={collapsed ? 'collapsed' : 'expanded'}
      data-vb-hero={hasHeroImage ? undefined : 'none'}
      className="vb-collapsible"
    >
      {/* Scoped animation for the body reveal. grid-template-rows 1fr↔0fr on
          a single-row grid is the standard "animate to auto height" trick —
          unlike max-height it needs no guessed cap. The inner opacity+
          translateY lift is purely cosmetic polish on top of that. Every
          duration scales off `--vb-reveal-scale` (default 1) so a caller can
          speed up/slow down/freeze the animation globally without editing
          the calc() literals here.

          The hero stage (Task 8) mirrors that pattern one level up: both
          hero faces stay mounted, stacked via `.vb-hero-face{position:
          absolute;inset:0}` inside a `.vb-hero-stage` that owns the
          animated height (82px collapsed row ↔ the expanded clamp — 30svh
          for image-less heroes via `[data-vb-hero="none"]`, 38svh
          otherwise), with the faces themselves opacity-crossfading. */}
      <style>{`
        .vb-collapsible .vb-body{display:grid;grid-template-rows:1fr;transition:grid-template-rows calc(520ms*var(--vb-reveal-scale,1)) cubic-bezier(.16,1,.3,1)}
        .vb-collapsible[data-vb-state="collapsed"] .vb-body{grid-template-rows:0fr}
        .vb-collapsible .vb-body-inner{overflow:hidden;min-height:0}
        .vb-collapsible .vb-body-lift{opacity:1;transform:none;transition:opacity calc(520ms*var(--vb-reveal-scale,1)) cubic-bezier(.16,1,.3,1),transform calc(520ms*var(--vb-reveal-scale,1)) cubic-bezier(.16,1,.3,1)}
        .vb-collapsible[data-vb-state="collapsed"] .vb-body-lift{opacity:0;transform:translateY(20px)}
        .vb-collapsible .vb-hero-stage{position:relative;display:block;width:100%;overflow:hidden;height:82px;transition:height calc(600ms*var(--vb-reveal-scale,1)) cubic-bezier(.16,1,.3,1)}
        .vb-collapsible[data-vb-state="expanded"] .vb-hero-stage{height:clamp(240px,38svh,560px)}
        .vb-collapsible[data-vb-hero="none"][data-vb-state="expanded"] .vb-hero-stage{height:clamp(180px,30svh,420px)}
        .vb-collapsible .vb-hero-face{position:absolute;inset:0;width:100%;height:100%;display:block;transition:opacity calc(400ms*var(--vb-reveal-scale,1)) ease}
        .vb-collapsible .vb-hero-face--expanded{opacity:0}
        .vb-collapsible[data-vb-state="expanded"] .vb-hero-face--expanded{opacity:1}
        .vb-collapsible[data-vb-state="expanded"] .vb-hero-face--collapsed{opacity:0}
        @media (prefers-reduced-motion:reduce){.vb-collapsible .vb-body,.vb-collapsible .vb-body-lift,.vb-collapsible .vb-hero-stage,.vb-collapsible .vb-hero-face{transition:none}}
        .vb-collapsible .vb-hero-img{transform:scale(1.06);transform-origin:60% 40%;transition:transform calc(1100ms*var(--vb-reveal-scale,1)) cubic-bezier(.16,1,.3,1)}
        .vb-collapsible[data-vb-state="expanded"] .vb-hero-img{transform:scale(1)}
        .vb-collapsible .vb-hero-eyebrow{opacity:0;transform:translateY(6px);transition:opacity calc(600ms*var(--vb-reveal-scale,1)) ease,transform calc(600ms*var(--vb-reveal-scale,1)) ease}
        .vb-collapsible[data-vb-state="expanded"] .vb-hero-eyebrow{opacity:1;transform:none}
        .vb-collapsible .vb-hero-rule{transform:scaleX(0);transform-origin:left center;transition:transform calc(700ms*var(--vb-reveal-scale,1)) cubic-bezier(.16,1,.3,1)}
        .vb-collapsible[data-vb-state="expanded"] .vb-hero-rule{transform:scaleX(1)}
        @media (prefers-reduced-motion:reduce){.vb-collapsible .vb-hero-img,.vb-collapsible .vb-hero-eyebrow,.vb-collapsible .vb-hero-rule{transition:none;transform:none;opacity:1}}
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
          onClick={() => {
            // Task 13 (Codex fix 4): a deliberate click always consumes the
            // welcome's own one-shot auto-reveal FIRST — gated to the
            // welcome section only (see the `autoRevealMs` prop banner
            // above), so every other section's click never touches the
            // shared, viewbook-scoped welcome flag.
            if (autoRevealMs != null) consume()
            ;(collapsed ? expand : collapse)()
          }}
          className="group block w-full appearance-none rounded-xl border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2"
        >
          {/* Task 8: BOTH faces render, stacked — the inactive one is
              aria-hidden (never removed) so the cross-fade has something to
              animate between and the button keeps exactly one accessible
              name (name-from-content skips aria-hidden subtrees). */}
          <span className="vb-hero-stage">
            <span
              className="vb-hero-face vb-hero-face--collapsed"
              data-vb-face="collapsed"
              aria-hidden={collapsed ? undefined : true}
            >
              {heroCollapsed}
            </span>
            <span
              className="vb-hero-face vb-hero-face--expanded"
              data-vb-face="expanded"
              aria-hidden={collapsed ? true : undefined}
            >
              {heroExpanded}
            </span>
          </span>
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
