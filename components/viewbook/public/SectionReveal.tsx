'use client'

// Viewbook UX pass, Lane 1 Task 2 — the sticky-header, STATE-ONLY reveal island.
//
// This replaces the self-oscillating IntersectionObserver (the "blink" bug):
// the old island watched the SAME element whose height it mutated, so scrolling
// the tall Data Source section made it flip expanded↔collapsed on every frame.
// Body visibility is now driven ONLY by state — the toggle button and the
// deliberate `vb:navigate`/hash force-open. NO observer, NO scroll listener.
//
// SectionShell (a SERVER component) renders the brand hero band, composes the
// summary FACE, and hands BOTH the face (`summary`) and the detail body
// (`children`) to this island as server-rendered nodes. It also computes
// `regionId` (a server component cannot use `useId`) and the pure
// `initiallyOpen` policy. The ONLY things crossing the RSC boundary are
// serializable props + nodes (never a function prop) — Wave-4 P1 stays intact.
//
// Shape: a COMPACT sticky header bar (`position: sticky; top: var(--vb-sticky-
// offset)`) carrying the section title + summary face + the toggle button, then
// a collapsible detail REGION. Height animates purely in CSS via
// `grid-template-rows: 0fr → 1fr` over an `overflow:hidden` child, reduced-
// motion-guarded by an inline <style>. Nothing drives the collapse from scroll,
// so there is no layout thrash. `expanded` seeds from `initiallyOpen` at mount
// (no window read in the initializer) so SSR and first client render agree.
import { useEffect, useState, type ReactNode } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'

// Per-section "Show/Hide details" toggle is HIDDEN for now (Kevin, 2026-07-17)
// — kept in code, not removed. While disabled, every section renders EXPANDED
// (there is no toggle to reopen a collapsed one, so nothing must start
// collapsed). Flip back to `true` to restore the per-section collapse toggle
// and the stage-driven initial-open policy.
const SECTION_TOGGLE_ENABLED = false

export function SectionReveal({
  sectionKey,
  regionId,
  title,
  summary,
  alwaysOpen,
  initiallyOpen,
  children,
}: {
  sectionKey?: SectionKey
  regionId: string
  title: ReactNode
  summary?: ReactNode
  alwaysOpen: boolean
  initiallyOpen: boolean
  children: ReactNode
}) {
  // always-open sections are permanently expanded; otherwise seed from the
  // pure stage-driven policy. No scroll/observer ever mutates this. While the
  // toggle is disabled, ALWAYS start expanded (no control exists to reopen a
  // collapsed section).
  const [expanded, setExpanded] = useState(
    SECTION_TOGGLE_ENABLED ? alwaysOpen || initiallyOpen : true,
  )

  // Deliberate-open channels: a `vb:navigate` CustomEvent targeting this section
  // (ProgressNav / TOC clicks) AND the initial `location.hash` on mount. Both
  // force-expand. There is no auto-behaviour to fight, so no manual-toggle latch
  // is needed. always-open sections are already open — the listener is harmless.
  useEffect(() => {
    if (!sectionKey) return
    function forceOpen() {
      setExpanded(true)
    }
    function onNavigate(event: Event) {
      const detail = (event as CustomEvent).detail as { sectionKey?: string } | null
      if (detail && detail.sectionKey === sectionKey) forceOpen()
    }
    window.addEventListener('vb:navigate', onNavigate)
    if (window.location.hash === `#${sectionKey}`) forceOpen()
    return () => window.removeEventListener('vb:navigate', onNavigate)
  }, [sectionKey])

  return (
    <div>
      <style>{`
        .vb-reveal { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 320ms ease; }
        .vb-reveal[data-vb-expanded="false"] { grid-template-rows: 0fr; }
        .vb-reveal > .vb-reveal-inner { overflow: hidden; min-height: 0; }
        @media (prefers-reduced-motion: reduce) { .vb-reveal { transition: none; } }
        [data-vb-sticky-label] { transition: opacity 200ms; }
        [data-vb-hero-visible="true"] [data-vb-sticky-label] { opacity: 0; }
        @media (prefers-reduced-motion: reduce) { [data-vb-sticky-label] { transition: none; } }
      `}</style>

      {/* Compact STICKY header bar (§4.3): pins under the top nav at
          `--vb-sticky-offset`; the next section's header pushes it up via
          standard CSS sticky stacking — no JS. It IS the toggle for non-
          always-open sections. The outer div spans full width with a
          brand-tinted accent background (opaque — also keeps body content
          from showing through when pinned) that visually groups this header
          strip apart from the section body; the inner div centres the content
          to the 5xl column. The accent MUST match the TickDivider strip's
          background in SectionShell.

          Task 8 (Codex fix #5 — the reveal must actually reveal): the bar's
          ONLY visible title content is `[data-vb-sticky-label]` — an
          aria-hidden, text-only duplicate of the title with NO
          links/buttons inside it. There is deliberately no separate
          always-visible title here, so the bar genuinely reads empty while
          the section's own hero band is in view. The label fades in via the
          CSS above, keyed off the ancestor `<section>`'s
          `data-vb-hero-visible` (flipped by the Lane-A sticky-offset
          controller as the hero leaves the viewport) — pure opacity, so the
          bar's box height never changes. Any interactive content (the
          toggle) stays OUTSIDE this faded subtree; CTAs live in SectionShell's
          chapter header strip, never here. */}
      <div
        style={{
          position: 'sticky',
          top: 'var(--vb-sticky-offset, 0px)',
          zIndex: 30,
          background: 'color-mix(in srgb, var(--vb-primary) 10%, #fafafa)',
        }}
      >
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 px-6 py-3">
          <div className="min-w-0 flex-1">
            <div
              data-vb-sticky-label
              aria-hidden="true"
              className="text-xl font-bold tracking-tight text-black/80 sm:text-2xl"
              style={{ fontFamily: 'var(--vb-heading-font)' }}
            >
              {title}
            </div>
            {summary && <div className="mt-1 min-w-0 text-base text-black/60">{summary}</div>}
          </div>
          {SECTION_TOGGLE_ENABLED && !alwaysOpen && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={regionId}
              onClick={() => setExpanded((v) => !v)}
              className="ml-auto shrink-0 rounded-full border border-black/15 px-4 py-1.5 text-sm font-semibold text-black/70 transition-colors hover:bg-black/5"
              style={{ fontFamily: 'var(--vb-heading-font)' }}
            >
              {expanded ? 'Hide details' : 'Show details'}
            </button>
          )}
        </div>
      </div>

      <div
        id={regionId}
        role="region"
        aria-label={typeof title === 'string' ? title : undefined}
        data-testid="vb-region"
        // Collapsed = visually clipped only; without these the clipped
        // inputs/links/buttons stay tabbable and the region stays AT-exposed.
        // `inert` (React 19 boolean prop) + `aria-hidden` take the whole subtree
        // out of the tab order and the accessibility tree while collapsed, and
        // are REMOVED when expanded. Neither stops the CSS grid-rows transition.
        aria-hidden={expanded ? undefined : true}
        inert={!expanded}
        data-vb-expanded={expanded ? 'true' : 'false'}
        className="vb-reveal"
      >
        <div className="vb-reveal-inner">
          {/* Review fix (Task 8 follow-up): the Task 8 blanket `max-w-[68ch]`
              here wrapped the ENTIRE `children` column, over-constraining the
              multi-column card grids sections render (BrandSection swatches,
              WelcomeSection team grid, StrategySection/AssessmentSection card
              grids) from ~1024px down to ~600px. Cards may remain wider than a
              reading measure — only PROSE should be clamped to ~68ch. This
              wrapper goes back to the section body's original `max-w-5xl`
              column; `SectionSummaryPanel` manages its own prose width, and
              `section.introNote` is rendered by SectionShell.tsx (part of the
              opaque `children` passed in here), so its ~68ch measure lives
              there, not in this file. */}
          <div className="mx-auto w-full max-w-5xl space-y-6 px-6 pb-10 pt-2">{children}</div>
        </div>
      </div>
    </div>
  )
}
