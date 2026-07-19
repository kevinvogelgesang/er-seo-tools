// Viewbook UX pass, Lane 1 Task 2 (+ PR3 restructure): the shared section
// frame — a brand hero band + a compact STICKY header (title + summary face)
// + a collapsible detail body. This stays a SERVER component: it computes the
// display mode, builds BOTH hero variants (expanded + shrunken, sharing the
// image/overlay/done-check), composes the summary face (the section's own
// `summary` band PLUS the done/ack celebratory ✓ / "Completed {doneAt}"
// styling), computes the pure `initiallyOpen` policy and the region ids (a
// server component cannot use `useId`), and delegates the interactive
// expand/collapse + the collapsible region to the `CollapsibleSection` client
// island (which itself delegates the "Show/Hide details" sticky header + body
// to `SectionReveal`). The ONLY things crossing the RSC boundary are
// serializable props + server-rendered nodes (`heroExpanded`, `heroCollapsed`,
// `body`) — never a function prop (Wave-4 P1, carried into PR3).
//
// Display modes (lib/viewbook/section-display.ts):
//   always-open (pc-intro)  → expanded, no toggle, never collapses
//   normal                  → open per the stage policy, click-toggle only
//   done / ack-collapsed    → start collapsed, celebratory summary face, open
//                             on deliberate toggle or vb:navigate
//
// collapsedShared (PublicSection): the viewer-facing shared collapse-to-hero
// state (PR1 schema, PR2 write path, PR3 the interactive control below). Two
// bookend sections (pc-intro / pc-thanks) are collapse-INELIGIBLE
// (`sectionSupportsCollapse`) and render the plain hero + body with NO
// affordance/control at all — never wrapped in CollapsibleSection.
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import type { CollapseAffordanceKind } from '@/lib/viewbook/presentation-config'
import { sectionDisplayMode, sectionInitiallyOpen } from '@/lib/viewbook/section-display'
import { sectionSupportsCollapse } from '@/lib/viewbook/theme'
import { SectionReveal } from './SectionReveal'
import { CollapsibleSection } from './CollapsibleSection'
import { CornerBracket, TickDivider } from './SectionAccents'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

export function SectionShell({
  section,
  title,
  heroUrl,
  summary,
  stage,
  children,
  affordance,
  overlayStrength,
  isOperator,
  viewbookId,
  token,
  previewMode = false,
}: {
  section: PublicSection
  title: string
  heroUrl: string | null
  summary?: ReactNode
  stage: ViewbookStage
  children: ReactNode
  affordance: CollapseAffordanceKind
  overlayStrength: number
  isOperator: boolean
  viewbookId: number
  token: string
  previewMode?: boolean
}) {
  const mode = sectionDisplayMode(section, stage)
  const alwaysOpen = mode === 'always-open'
  const initiallyOpen = sectionInitiallyOpen(section, stage)
  const collapsible = sectionSupportsCollapse(section.sectionKey)
  // Server component → cannot useId; region anchors are derived from the
  // (unique) section key. `id={section.sectionKey}` on the <section> is the
  // nav anchor. `regionId` is the OUTER viewer-collapse region (owned by
  // CollapsibleSection, target of the collapse/expand controls' aria-controls
  // — collapsible sections only). `detailRegionId` is SectionReveal's own
  // (currently vestigial — SECTION_TOGGLE_ENABLED=false) inner toggle region;
  // it must be a DISTINCT id from `regionId` for collapsible sections since
  // both regions nest in the same subtree — bookends have no outer region at
  // all, so they keep the plain, unsuffixed id.
  const regionId = `vb-region-${section.sectionKey}`
  const detailRegionId = collapsible ? `${regionId}-detail` : regionId
  // 'done' and 'ack-collapsed' carry the celebratory summary-face styling that
  // in v1 lived in the slim <details> header — data body always retained below.
  const celebratory = mode === 'done' || mode === 'ack-collapsed'

  // Concrete overlay gradient stops computed in TS (Codex FIX-9 — NO
  // `calc()` with `var()*%`, unsupported on the project's older targets).
  // heroOverlayStrength in [0,100] → brandStop in [15,60], fadeStop in [60,85].
  const t = clamp01((Number.isFinite(overlayStrength) ? overlayStrength : 55) / 100)
  const brandStop = Math.round(15 + t * 45)
  const fadeStop = Math.round(60 + t * 25)

  // The summary FACE composes the celebratory badge (done/ack) with the
  // section's own summary band. `undefined` when neither is present, so
  // SectionReveal shows just the title row.
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

  // Both hero variants share the brand background, corner accent, big
  // done-check, image + overlay, and minimum scrim — only the container
  // height and title size differ between the full and shrunken presentation.
  function buildHero(compact: boolean): ReactNode {
    const heightClass = compact ? 'min-h-[150px]' : heroUrl ? 'min-h-[38vh]' : 'min-h-[30vh]'
    const titleClass = compact
      ? 'relative mx-auto w-full max-w-5xl px-6 pb-4 text-xl font-extrabold tracking-tight sm:text-2xl'
      : 'relative mx-auto w-full max-w-5xl px-6 pb-6 text-3xl font-extrabold tracking-tight sm:text-5xl'
    return (
      <div
        className={`relative flex ${heightClass} items-end overflow-hidden`}
        style={{ background: 'var(--vb-primary)' }}
      >
        {/* Decorative-only corner accent (Task 10) — subtle brand-tinted
            geometry, never load-bearing for layout or a11y. */}
        <CornerBracket className="absolute left-4 top-4" />
        {/* Large hero done-check (PR3) — shown in BOTH the collapsed and
            expanded hero, distinct from (and in addition to) the smaller
            body summary-face badge below. */}
        {section.state === 'done' && (
          <span
            aria-hidden
            className="vb-done-badge absolute right-4 top-4 z-[2] flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold"
            style={{ background: 'var(--vb-secondary)', color: 'var(--vb-on-secondary)' }}
          >
            ✓
          </span>
        )}
        {heroUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
            {/* Configurable brand-primary bottom fade (PR4 heroOverlayStrength)
                keeps the on-primary headline on effectively-primary pixels —
                concrete percentage stops, no calc(var()*%) arithmetic. */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ background: `linear-gradient(to top, var(--vb-primary) ${brandStop}%, transparent ${fadeStop}%)` }}
            />
          </>
        )}
        {/* Non-configurable MINIMUM title scrim (Codex FIX-PRESENTATION-CONFIG)
            — always present so overlayStrength=0 can't render on-primary text
            illegibly over a photo. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2/5"
          style={{ background: 'linear-gradient(to top, color-mix(in srgb, var(--vb-primary) 55%, transparent), transparent)' }}
        />
        <h2
          className={titleClass}
          style={{ color: 'var(--vb-on-primary)', fontFamily: 'var(--vb-heading-font)' }}
        >
          {title}
        </h2>
      </div>
    )
  }

  const headerStrip = (
    <div style={{ background: 'color-mix(in srgb, var(--vb-primary) 10%, #fafafa)' }}>
      <div className="mx-auto w-full max-w-5xl px-6 pt-5 pb-1">
        <TickDivider />
      </div>
    </div>
  )

  const detailBody = (
    <SectionReveal
      sectionKey={section.sectionKey}
      regionId={detailRegionId}
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
  )

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
          now), with a reduced-motion override. Shared by both the hero
          done-check and the body summary-face badge. */}
      <style>{`
        @keyframes vb-pop { 0% { transform: scale(0); } 70% { transform: scale(1.18); } 100% { transform: scale(1); } }
        .vb-done-badge { animation: vb-pop 400ms ease-out both; }
        @media (prefers-reduced-motion: reduce) { .vb-done-badge { animation: none; } }
      `}</style>

      {collapsible ? (
        <CollapsibleSection
          viewbookId={viewbookId}
          token={token}
          sectionKey={section.sectionKey}
          collapsedShared={section.collapsedShared}
          isOperator={isOperator}
          affordance={affordance}
          heroExpanded={buildHero(false)}
          heroCollapsed={buildHero(true)}
          body={
            <>
              {headerStrip}
              {detailBody}
            </>
          }
          regionId={regionId}
          previewMode={previewMode}
        />
      ) : (
        // Bookends (pc-intro / pc-thanks): no collapse state at all — always
        // the full hero + header strip + body, no affordance/control.
        <>
          {buildHero(false)}
          {headerStrip}
          {detailBody}
        </>
      )}
    </section>
  )
}
