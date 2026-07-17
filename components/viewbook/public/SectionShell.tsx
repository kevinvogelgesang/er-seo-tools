// PR7 Task 4: the shared section frame is now a two-layer shape — a brand
// header band + a persistent SUMMARY FACE + a collapsible detail body that
// reveals on scroll. This component stays a SERVER component: it computes the
// display mode (Task 3), renders the brand header band, composes the summary
// face (the section's own `summary` band PLUS the done/ack celebratory ✓ /
// "Completed {doneAt}" styling), and delegates the summary row + toggle +
// collapsible region + body to the `SectionReveal` client island. The ONLY
// things crossing the RSC boundary are serializable props + server-rendered
// nodes (`summary`, `children`) — never a function prop (Wave-4 P1).
//
// Display modes (lib/viewbook/section-display.ts):
//   always-open (pc-intro)  → expanded, no toggle, never collapses
//   normal                  → SSR-expanded, scroll-reveal after mount
//   done / ack-collapsed    → start collapsed, celebratory summary face, open
//                             only on deliberate toggle or vb:navigate
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import {
  sectionDisplayMode,
  sectionStartsCollapsed,
  sectionLocksAutoReveal,
} from '@/lib/viewbook/section-display'
import { SectionReveal } from './SectionReveal'

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
  const startCollapsed = sectionStartsCollapsed(mode)
  const lockAutoReveal = sectionLocksAutoReveal(mode)
  const alwaysOpen = mode === 'always-open'
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
    <section id={section.sectionKey} className="flex w-full scroll-mt-24 flex-col">
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

      <SectionReveal
        sectionKey={section.sectionKey}
        title={title}
        summary={summaryFace}
        startCollapsed={startCollapsed}
        lockAutoReveal={lockAutoReveal}
        alwaysOpen={alwaysOpen}
      >
        {section.introNote && (
          <p className="border-l-4 pl-4 text-lg text-black/70" style={{ borderColor: 'var(--vb-tertiary)' }}>
            {section.introNote}
          </p>
        )}
        {children}
      </SectionReveal>
    </section>
  )
}
