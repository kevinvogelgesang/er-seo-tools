// Viewbook UX pass, Lane 1 Task 2: the shared section frame — a brand hero band
// + a compact STICKY header (title + summary face + toggle) + a collapsible
// detail body whose visibility is STATE-ONLY (no scroll observer — that was the
// blink bug). This stays a SERVER component: it computes the display mode,
// renders the brand hero band, composes the summary face (the section's own
// `summary` band PLUS the done/ack celebratory ✓ / "Completed {doneAt}"
// styling), computes the pure `initiallyOpen` policy and the `regionId` (a
// server component cannot use `useId`), and delegates the sticky header + toggle
// + collapsible region + body to the `SectionReveal` client island. The ONLY
// things crossing the RSC boundary are serializable props + server-rendered
// nodes (`summary`, `children`) — never a function prop (Wave-4 P1).
//
// Display modes (lib/viewbook/section-display.ts):
//   always-open (pc-intro)  → expanded, no toggle, never collapses
//   normal                  → open per the stage policy, click-toggle only
//   done / ack-collapsed    → start collapsed, celebratory summary face, open
//                             on deliberate toggle or vb:navigate
//
// collapsedShared (PublicSection, orthogonal to the modes above, PR1
// transitional renderer): when true, the section renders HERO-ONLY — the
// header strip + entire detail body (regardless of display mode) are
// suppressed. Server-only for now; PR2 adds the write path, PR3 the
// interactive viewer control + personal override.
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import { sectionDisplayMode, sectionInitiallyOpen } from '@/lib/viewbook/section-display'
import { SectionReveal } from './SectionReveal'
import { CornerBracket, TickDivider } from './SectionAccents'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

export function SectionShell({
  section,
  title,
  heroUrl,
  summary,
  stage,
  children,
}: {
  section: PublicSection
  title: string
  heroUrl: string | null
  summary?: ReactNode
  stage: ViewbookStage
  children: ReactNode
}) {
  const mode = sectionDisplayMode(section, stage)
  // Shared collapse-to-hero (collapsedShared, PR1 transitional renderer): the
  // client sees ONLY the brand hero band below — the section header strip
  // (TickDivider) and the entire detail body (intro note + content) are not
  // rendered. Server-only for now; PR3 adds the interactive viewer control.
  const heroOnly = section.collapsedShared
  const alwaysOpen = mode === 'always-open'
  const initiallyOpen = sectionInitiallyOpen(section, stage)
  // Server component → cannot useId; the region anchor is derived from the
  // (unique) section key. `id={section.sectionKey}` on the <section> is the nav
  // anchor; this is the collapsible region — distinct, no collision.
  const regionId = `vb-region-${section.sectionKey}`
  // 'done' and 'ack-collapsed' carry the celebratory summary-face styling that
  // in v1 lived in the slim <details> header — data body always retained below.
  const celebratory = mode === 'done' || mode === 'ack-collapsed'

  // The summary FACE composes the celebratory badge (done/ack) with the
  // section's own summary band. `undefined` when neither is present, so
  // SectionReveal shows just the toggle row (or nothing, for always-open).
  const summaryFace: ReactNode | undefined = (celebratory || summary) ? (
    <div className="flex flex-wrap items-center gap-3">
      {celebratory && (
        <>
          <span
            aria-hidden
            className="vb-done-badge flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
            style={{ background: 'var(--vb-secondary)', color: 'var(--vb-on-secondary)' }}
          >
            ✓
          </span>
          {section.doneAt && (
            <span className="text-sm text-black/50">Completed {fmtDate(section.doneAt)}</span>
          )}
        </>
      )}
      {summary && <div className="min-w-0">{summary}</div>}
    </div>
  ) : undefined

  return (
    <section
      id={section.sectionKey}
      className="flex w-full flex-col"
      // Replaces the fixed `scroll-mt-24` — anchor scrolls clear the measured
      // cumulative sticky chrome (nav + operator bar) published by the Lane-1
      // measurement leaf, plus a small gap.
      style={{ scrollMarginTop: 'calc(var(--vb-sticky-offset, 0px) + 12px)' }}
    >
      {/* Celebratory badge pop, keyed off render (summary face is always visible
          now), with a reduced-motion override. */}
      <style>{`
        @keyframes vb-pop { 0% { transform: scale(0); } 70% { transform: scale(1.18); } 100% { transform: scale(1); } }
        .vb-done-badge { animation: vb-pop 400ms ease-out both; }
        @media (prefers-reduced-motion: reduce) { .vb-done-badge { animation: none; } }
      `}</style>
      <div
        className={`relative flex ${heroUrl ? 'min-h-[38vh]' : 'min-h-[30vh]'} items-end overflow-hidden`}
        style={{ background: 'var(--vb-primary)' }}
      >
        {/* Decorative-only corner accent (Task 10) — subtle brand-tinted
            geometry, never load-bearing for layout or a11y. */}
        <CornerBracket className="absolute left-4 top-4" />
        {heroUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
            {/* brand-primary bottom fade keeps the on-primary headline on
                effectively-primary pixels — preserves the theme's luminance
                contract over any photo */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ background: 'linear-gradient(to top, var(--vb-primary) 15%, transparent 70%)' }}
            />
          </>
        )}
        <h2
          className="relative mx-auto w-full max-w-5xl px-6 pb-6 text-3xl font-extrabold tracking-tight sm:text-5xl"
          style={{ color: 'var(--vb-on-primary)', fontFamily: 'var(--vb-heading-font)' }}
        >
          {title}
        </h2>
      </div>

      {/* Decorative hairline divider — the top of the section HEADER STRIP.
          Full-width brand-tinted accent background (matching the sticky bar in
          SectionReveal) so the divider + title/summary/toggle read as one
          header block, visually distinct from the section body below. The
          accent literal MUST match SectionReveal's sticky-bar background.
          Suppressed entirely when collapsedShared — only the hero band shows. */}
      {!heroOnly && (
        <div style={{ background: 'color-mix(in srgb, var(--vb-primary) 10%, #fafafa)' }}>
          <div className="mx-auto w-full max-w-5xl px-6 pt-5 pb-1">
            <TickDivider />
          </div>
        </div>
      )}

      {!heroOnly && (
        <SectionReveal
          sectionKey={section.sectionKey}
          regionId={regionId}
          title={title}
          summary={summaryFace}
          alwaysOpen={alwaysOpen}
          initiallyOpen={initiallyOpen}
        >
          {section.introNote && (
            <p className="border-l-4 pl-4 text-lg text-black/70" style={{ borderColor: 'var(--vb-tertiary)' }}>
              {section.introNote}
            </p>
          )}
          {children}
        </SectionReveal>
      )}
    </section>
  )
}
