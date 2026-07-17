'use client'

// PR7 Task 4: the scroll-reveal client island. SectionShell (a SERVER
// component) renders the brand header band + composes the summary face, then
// hands BOTH the summary face (`summary`) and the detail body (`children`) to
// this island as server-rendered nodes — the ONLY things that cross the RSC
// boundary are serializable props + nodes (never a function prop), so the
// Wave-4 P1 stays intact.
//
// Two-layer shape: a persistent summary FACE (always visible, carries the
// toggle) + a collapsible detail REGION that reveals on scroll. Height is
// animated purely in CSS via `grid-template-rows: 0fr → 1fr` over an
// `overflow:hidden` child, reduced-motion-guarded by an inline <style>.
//
// HYDRATION: `expanded` seeds from `!startCollapsed` ONLY (no window read in
// the initializer) so SSR and the first client render agree. Normal sections
// render SSR-EXPANDED — the full body is present and readable with no JS; the
// IntersectionObserver only applies scroll-collapse AFTER mount. window/
// matchMedia/document are touched exclusively inside effects.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'
import { hasActiveEditorActivity } from './useViewbookSync'

// Enter/leave uses a mid threshold so a section reveals when meaningfully in
// view and collapses only once it's well clear.
const REVEAL_THRESHOLD = 0.35

export function SectionReveal({
  sectionKey,
  title,
  summary,
  startCollapsed,
  lockAutoReveal,
  alwaysOpen,
  children,
}: {
  sectionKey: SectionKey
  title: string
  summary?: ReactNode
  startCollapsed: boolean
  lockAutoReveal: boolean
  alwaysOpen: boolean
  children: ReactNode
}) {
  // SSR-safe seed — no window read here (see the hydration note above).
  const [expanded, setExpanded] = useState(!startCollapsed)
  // Once the user (or a deliberate navigation) toggles, auto-behavior is off
  // for the rest of the pageview — manual wins.
  const manuallyToggledRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const reactId = useId()
  const regionId = `vb-region-${reactId.replace(/:/g, '')}`

  // Scroll-reveal observer. Attached ONLY for `normal` sections
  // (!lockAutoReveal) and ONLY when the viewer has not requested reduced
  // motion (read once at mount — reduced-motion is treated as static, no
  // observer, exactly like SSR). always-open + done/ack are locked and get no
  // observer at all.
  useEffect(() => {
    if (lockAutoReveal) return
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return
    // reduced-motion → no observer (static behavior, identical to SSR).
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const el = containerRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        if (manuallyToggledRef.current) return // manual wins
        if (entry.isIntersecting) {
          // Auto-EXPAND is always allowed.
          setExpanded(true)
        } else {
          // Never auto-COLLAPSE while this section holds focus OR any editor
          // island is active (the operator inline editors render OUTSIDE this
          // DOM, so the global registry is what covers them).
          if (el.contains(document.activeElement)) return
          if (hasActiveEditorActivity()) return
          setExpanded(false)
        }
      },
      { threshold: REVEAL_THRESHOLD },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [lockAutoReveal])

  // Deliberate-open channels: a `vb:navigate` CustomEvent targeting this
  // section (Task 9's ProgressNav) AND the initial `location.hash` on mount.
  // Both force-expand even when locked, and mark the section manually-toggled
  // so a later scroll doesn't fight the deliberate open.
  useEffect(() => {
    function forceOpen() {
      manuallyToggledRef.current = true
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

  function onToggle() {
    manuallyToggledRef.current = true
    setExpanded((v) => !v)
  }

  return (
    <div ref={containerRef}>
      <style>{`
        .vb-reveal { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 320ms ease; }
        .vb-reveal[data-vb-expanded="false"] { grid-template-rows: 0fr; }
        .vb-reveal > .vb-reveal-inner { overflow: hidden; min-height: 0; }
        @media (prefers-reduced-motion: reduce) { .vb-reveal { transition: none; } }
      `}</style>

      {(summary || !alwaysOpen) && (
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 px-6 py-4">
          {summary && <div className="min-w-0 flex-1 text-lg">{summary}</div>}
          {!alwaysOpen && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={regionId}
              onClick={onToggle}
              className="ml-auto shrink-0 rounded-full border border-black/15 px-4 py-1.5 text-sm font-semibold text-black/70 transition-colors hover:bg-black/5"
              style={{ fontFamily: 'var(--vb-heading-font)' }}
            >
              {expanded ? 'Hide details' : 'Show details'}
            </button>
          )}
        </div>
      )}

      <div
        id={regionId}
        role="region"
        aria-label={title}
        data-vb-expanded={expanded ? 'true' : 'false'}
        className="vb-reveal"
      >
        <div className="vb-reveal-inner">
          <div className="mx-auto w-full max-w-5xl space-y-6 px-6 pb-10 pt-2">{children}</div>
        </div>
      </div>
    </div>
  )
}
