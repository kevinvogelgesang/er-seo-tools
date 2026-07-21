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
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'
import { SECTION_COPY } from '@/lib/viewbook/section-copy'
import { sectionDisplayMode, sectionInitiallyOpen } from '@/lib/viewbook/section-display'
import { SectionReveal } from './SectionReveal'
import { SectionSummaryPanel, StatusPill } from './SectionSummaryPanel'
import { ChapterCtaButton } from './ChapterCtaButton'
import { CornerBracket } from './SectionAccents'

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
  meta,
  children,
}: {
  section: PublicSection
  title: string
  heroUrl: string | null
  summary?: ReactNode
  stage: ViewbookStage
  meta: SectionRenderMeta
  children: ReactNode
}) {
  // Code-owned reading copy for this section — always defined (SECTION_COPY is
  // keyed by the full SectionKey catalog and section.sectionKey is a SectionKey).
  const copy = SECTION_COPY[section.sectionKey]
  const mode = sectionDisplayMode(section, stage)
  // Operator "collapse to hero" (state === 'collapsed'): the client sees ONLY
  // the brand hero band below — the section header strip (TickDivider) and the
  // entire detail body (intro note + content) are not rendered.
  const heroOnly = mode === 'hero-collapsed'
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
      data-vb-section={section.sectionKey}
      data-vb-status={meta.status}
      // Sticky-offset controller (Lane A) reads this to flip which hero is
      // active; a no-hero section seeds `false` (nothing to observe).
      data-vb-hero-visible={meta.heroSize === 'none' ? 'false' : 'true'}
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
      {/* Brand hero band — sized by meta.heroSize (spec §4.1): the lead section
          gets a tall `full` hero, every other chapter a compact `chapter` band,
          and `none` (carried/previous-stage renders) suppresses the band
          entirely. `data-vb-hero` is the sentinel the sticky-offset controller
          (Lane A) observes. */}
      {meta.heroSize !== 'none' && (
        <div
          data-vb-hero
          className={`relative flex ${meta.heroSize === 'full' ? 'min-h-[60vh]' : 'h-[220px]'} items-end overflow-hidden`}
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
      )}

      {/* Chapter header strip (replaces the bare TickDivider): the reader's
          orienting row — chapter number, one-line purpose, live StatusPill, and
          the optional primary CTA (the frozen ChapterCtaButton client island —
          SectionShell stays a server component and never wires onClick itself).
          Full-width brand-tinted accent background matching SectionReveal's
          sticky bar. Suppressed when hero-collapsed — only the hero band shows. */}
      {!heroOnly && (
        <div style={{ background: 'color-mix(in srgb, var(--vb-primary) 10%, #fafafa)' }}>
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 px-6 py-4">
            {meta.chapterNumber != null && (
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                style={{ background: 'var(--vb-primary)', color: 'var(--vb-on-primary)' }}
              >
                {meta.chapterNumber}
              </span>
            )}
            <p className="min-w-0 text-sm font-medium text-black/70">{copy.purpose}</p>
            <StatusPill status={meta.status} />
            {copy.cta && (
              <div className="ml-auto">
                <ChapterCtaButton
                  label={copy.cta.label}
                  sectionKey={copy.cta.sectionKey}
                  anchor={copy.cta.anchor}
                />
              </div>
            )}
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
          {/* Plain-language "what / what-we-need" panel + live status, always
              first inside the detail region (spec §4.2 / Task 5). */}
          <SectionSummaryPanel whatThis={copy.whatThis} whatWeNeed={copy.whatWeNeed} status={meta.status} />
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
