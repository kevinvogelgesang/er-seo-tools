// Viewbook UX pass, Lane 1 Task 2 (+ PR3 restructure, + 2026-07-19 collapse
// local-only revision): the shared section frame — a brand hero band + a
// compact STICKY header (title + summary face) + a collapsible detail body.
// This stays a SERVER component: it computes the display mode, builds BOTH
// hero variants (the expanded hero + the compact collapsed-row accordion
// look, sharing the image/overlay/done-check), composes the summary face
// (the section's own `summary` band PLUS the done/ack celebratory ✓ /
// "Completed {doneAt}" styling), computes the pure `initiallyOpen` policy and
// the region ids (a server component cannot use `useId`), and delegates the
// interactive expand/collapse + the collapsible region to the
// `CollapsibleSection` client island (which itself delegates the "Show/Hide
// details" sticky header + body to `SectionReveal`). The ONLY things crossing
// the RSC boundary are serializable props + server-rendered nodes
// (`heroExpanded`, `heroCollapsed`, `body`) — never a function prop.
//
// Display modes (lib/viewbook/section-display.ts):
//   always-open             → expanded, no toggle, never collapses (currently
//                             no section key uses this mode — retained as a
//                             seam for a future permanently-open section)
//   normal                  → open per the stage policy, click-toggle only
//   done / ack-collapsed    → start collapsed, celebratory summary face, open
//                             on deliberate toggle or vb:navigate
//
// 2026-07-19 revision (docs/superpowers/specs/2026-07-19-viewbook-collapse-
// local-revision.md): the viewer-facing collapse-to-hero state is now
// PURELY LOCAL (per-machine localStorage, default collapsed) — this file no
// longer reads `section.collapsedShared` at all (that column is DORMANT; see
// prisma/schema.prisma).
//
// 2026-07-19 welcome-auto-reveal follow-up: ALL sections are now collapse-
// eligible (`sectionSupportsCollapse`, theme.ts's COLLAPSE_EXCLUDED_SECTION_
// KEYS is empty) — the former bookend carve-out (pc-intro / pc-thanks
// rendered with no CollapsibleSection wrapper at all) is retired. The
// `collapsible ? … : …` branch below is kept as a dormant path for any future
// carve-out rather than deleted.
//
// Post-review a11y fix (2026-07-19): a <button> may not validly contain a
// block heading. `buildExpandedHero`/`buildCompactRow` used to render the
// section title as an <h2> INSIDE the hero markup that CollapsibleSection
// then wrapped in a <button> — invalid nesting. The title is now always built
// as a plain <span> here; CollapsibleSection supplies the real <h2> WRAPPING
// its <button> for collapsible sections (APG Accordion pattern). Any future
// collapse-ineligible section (`collapsible === false`) has no button at all,
// so buildExpandedHero renders the title as a real <h2> for it instead —
// `collapsible` picks the tag.
//
// Round-2 review fix (same date): a <button> may ALSO only contain PHRASING
// content, but `buildCompactRow`/`buildExpandedHero` wrap their decorative
// image/gradient/accent/cluster layers in <div>s — invalid when this hero
// ends up inside CollapsibleSection's <button> (collapsible sections; a
// collapse-ineligible section would render this markup directly with no
// button, where either tag would have been fine). Every decorative wrapper
// below is now a <span> instead — visually inert, since each one already
// carries an explicit Tailwind `flex` class (sets `display:flex` outright) or
// `absolute` positioning (CSS forces `display:block` on an absolutely-
// positioned element regardless of its default), except the OUTER
// compact-row wrapper, which gets an explicit `block` class since it relies
// on `mx-auto` alone. This also means the button's only VISIBLE content is
// the title span (every decorative span is aria-hidden), which is what lets
// CollapsibleSection derive the button's accessible name from content
// instead of an aria-label (see CollapsibleSection.tsx).
//
// Task 8 (2026-07-19, docs/superpowers/sdd/task-8-brief.md): CollapsibleSection
// now renders BOTH `heroExpanded` and `heroCollapsed` simultaneously, stacked
// in a cross-fading `.vb-hero-stage` that owns the animated height — so
// `buildExpandedHero`'s root no longer sets its own `min-h-[38vh]`/
// `min-h-[30vh]`/`overflow-hidden` (the stage clips + sizes it; the stage
// picks the 38svh-vs-30svh clamp via `hasHeroImage`, threaded here from
// `heroUrl != null`).
//
// Spread-morph revision (2026-07-19, follow-up to #217): `buildCompactRow`
// no longer carries ANY of the compact-card chrome either — the gutter
// column, 74px height, `py-1` row gap, radius, shadow, and hover lift all
// moved onto `.vb-hero-stage` in CollapsibleSection (collapsed state), so
// the card's width/corners/height morph into the full-bleed hero footprint
// on one curve instead of cross-fading across a width jump. Both faces are
// now plain fill-the-stage content.
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import type { CollapseAffordanceKind } from '@/lib/viewbook/presentation-config'
import { sectionDisplayMode, sectionInitiallyOpen } from '@/lib/viewbook/section-display'
import { sectionSupportsCollapse } from '@/lib/viewbook/theme'
import { SectionReveal } from './SectionReveal'
import { CollapsibleSection } from './CollapsibleSection'
import { CollapseAffordance } from './CollapseAffordance'
import { CornerBracket, TickDivider } from './SectionAccents'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

// The small/large done-check badge shared by the compact row and the
// expanded hero cluster (the body summary-face badge is its own inline
// markup below — same look, different size, not worth extracting further).
function DoneBadge({ size }: { size: 'row' | 'hero' }) {
  const dims = size === 'hero' ? 'h-8 w-8 text-base' : 'h-[21px] w-[21px] text-[10px]'
  return (
    <span
      aria-hidden
      className={`vb-done-badge flex ${dims} flex-none items-center justify-center rounded-full font-bold`}
      style={{ background: 'var(--vb-secondary)', color: 'var(--vb-on-secondary)' }}
    >
      ✓
    </span>
  )
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
  viewbookId,
  previewMode = false,
  autoRevealMs,
}: {
  section: PublicSection
  title: string
  heroUrl: string | null
  summary?: ReactNode
  stage: ViewbookStage
  children: ReactNode
  affordance: CollapseAffordanceKind
  overlayStrength: number
  isOperator: boolean // vestigial — collapse is no longer operator-aware; kept so existing callers need no changes
  viewbookId: number
  token: string // vestigial — no longer needed by the (now purely local) collapse control; kept so existing callers need no changes
  previewMode?: boolean
  // Task 13: forwarded to CollapsibleSection untouched. Only PcIntroSection
  // (the welcome/pc-intro section) ever passes a defined value — see
  // CollapsibleSection.tsx's prop banner for why every other caller must
  // leave this `undefined`.
  autoRevealMs?: number
}) {
  const mode = sectionDisplayMode(section, stage)
  const alwaysOpen = mode === 'always-open'
  const initiallyOpen = sectionInitiallyOpen(section, stage)
  const collapsible = sectionSupportsCollapse(section.sectionKey)
  // Server component → cannot useId; region anchors are derived from the
  // (unique) section key. `id={section.sectionKey}` on the <section> is the
  // nav anchor. `regionId` is the OUTER viewer-collapse region (owned by
  // CollapsibleSection, target of the collapse control's aria-controls —
  // collapsible sections only). `detailRegionId` is SectionReveal's own
  // (currently vestigial — SECTION_TOGGLE_ENABLED=false) inner toggle region;
  // it must be a DISTINCT id from `regionId` for collapsible sections since
  // both regions nest in the same subtree — bookends have no outer region at
  // all, so they keep the plain, unsuffixed id.
  const regionId = `vb-region-${section.sectionKey}`
  const detailRegionId = collapsible ? `${regionId}-detail` : regionId
  // 'done' and 'ack-collapsed' carry the celebratory summary-face styling that
  // in v1 lived in the slim <details> header — data body always retained below.
  const celebratory = mode === 'done' || mode === 'ack-collapsed'
  const done = section.state === 'done'

  // Concrete overlay gradient stops computed in TS (Codex FIX-9 — NO
  // `calc()` with `var()*%`, unsupported on the project's older targets).
  // heroOverlayStrength in [0,100] → t in [0,1] drives BOTH the expanded
  // hero's vertical brand fade AND the compact row's horizontal brand wash —
  // one operator control, two looks.
  const t = clamp01((Number.isFinite(overlayStrength) ? overlayStrength : 55) / 100)
  const brandStop = Math.round(15 + t * 45)
  const fadeStop = Math.round(60 + t * 25)
  const rowWashStop = Math.round(t * 100)

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

  // The compact COLLAPSED accordion row (~74px): a brand horizontal wash
  // over the section image so the stack reads cohesive, a 4px secondary
  // left accent bar, and an inner flex cluster — title + a small done-check
  // (when done) + the expand affordance, all snug to the title (left-
  // clustered, no spacer). Rounded, with a hover lift driven by the `group`
  // class CollapsibleSection puts on its click wrapper.
  function buildCompactRow(): ReactNode {
    return (
      // Spread-morph revision (2026-07-19): ALL card chrome — the centered
      // `max-w-5xl px-6` gutter column, the `py-1` stacked-row gap (Fix 5),
      // the 74px height, radius, shadow, hover lift — moved OFF this markup
      // onto CollapsibleSection's `.vb-hero-stage`, the element whose
      // geometry animates. That's what lets the collapsed card visibly
      // SPREAD into the full-bleed hero (width/radius/height morph on one
      // curve) instead of cross-fading across a width jump. This face just
      // fills the stage; the stage rounds + clips it.
      <span
        className="relative flex h-full w-full items-center"
        style={{ background: 'var(--vb-primary)' }}
      >
        {heroUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
        )}
        {/* Brand wash: color-mix() over a SOLID var(--vb-primary) base
            (painted on this span's own `style.background` above) — if
            color-mix is unsupported, this whole `background` declaration
            fails to parse and the wash simply doesn't render, leaving the
            solid primary underneath fully readable (Fix 5, post-review).
            color-mix is already used elsewhere in shipped viewbook code
            under the same browserslist targets (ProgressNav, SectionReveal,
            EarlierSteps, TocRail) — kept here for consistency rather than
            forked to a gradient-layered fallback. */}
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to right, var(--vb-primary) 8%, color-mix(in srgb, var(--vb-primary) ${rowWashStop}%, transparent) 80%)`,
          }}
        />
        <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: 'var(--vb-secondary)' }} />
        <span className="relative z-[3] flex w-full min-w-0 items-center gap-2.5 px-5">
          {/* Plain <span> — this row only renders inside CollapsibleSection's
              <button>, which is itself wrapped in the real <h2> (see
              CollapsibleSection.tsx). A <button> may not contain a heading. */}
          <span
            className="min-w-0 truncate text-xl font-extrabold tracking-tight sm:text-2xl"
            style={{ color: 'var(--vb-on-primary)', fontFamily: 'var(--vb-heading-font)' }}
          >
            {title}
          </span>
          {done && <DoneBadge size="row" />}
          <CollapseAffordance kind={affordance} />
        </span>
      </span>
    )
  }

  // The EXPANDED hero: full brand band + image + overlay, with the title,
  // done-check, and a decorative up-chevron collapse cue grouped together at
  // the bottom-left (nothing flung to the corners) — the whole band is the
  // collapse trigger, owned by CollapsibleSection's click wrapper.
  function buildExpandedHero(): ReactNode {
    // Collapsible sections render inside CollapsibleSection's <button>, which
    // is wrapped in the real <h2> there (a <button> may not contain a
    // heading) — so the title here is a plain <span>. A collapse-ineligible
    // section (collapsible=false — none exist as of 2026-07-19
    // welcome-auto-reveal, retained as a seam) renders this hero directly
    // with no button at all, so it needs the real heading here.
    const TitleTag = collapsible ? 'span' : 'h2'
    return (
      // <span> (not <div>) — collapsible sections render this hero inside
      // CollapsibleSection's <button>, which permits only phrasing content
      // (see the file banner); a collapse-ineligible section would render it
      // directly with no button, where a span works identically since every
      // layer below sets its own `display` via an explicit Tailwind class
      // (`flex`) or absolute positioning (CSS forces block regardless of the
      // element's default).
      <span
        // Task 8 (docs/superpowers/sdd/task-8-brief.md): height is now owned
        // by CollapsibleSection's `.vb-hero-stage` (which also supplies the
        // absolute containing block for this hero's own `absolute inset-0`
        // decorative layers) — no `min-h-*`/`overflow-hidden` here anymore.
        className="relative flex h-full items-end"
        style={{ background: 'var(--vb-primary)' }}
      >
        {/* Decorative-only corner accent (Task 10) — subtle brand-tinted
            geometry, never load-bearing for layout or a11y. Embedded content
            (svg) is phrasing content — valid inside a button as-is. */}
        <CornerBracket className="absolute left-4 top-4" />
        {heroUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroUrl}
              alt=""
              className="vb-hero-img absolute inset-0 h-full w-full object-cover opacity-40"
            />
            {/* Configurable brand-primary bottom fade (PR4 heroOverlayStrength)
                keeps the on-primary headline on effectively-primary pixels —
                concrete percentage stops, no calc(var()*%) arithmetic. */}
            <span
              aria-hidden
              className="absolute inset-0"
              style={{ background: `linear-gradient(to top, var(--vb-primary) ${brandStop}%, transparent ${fadeStop}%)` }}
            />
          </>
        )}
        {/* Non-configurable MINIMUM title scrim (Codex FIX-PRESENTATION-CONFIG)
            — always present so overlayStrength=0 can't render on-primary text
            illegibly over a photo. color-mix() over the solid var(--vb-primary)
            base painted on this span above — same unsupported-fallback
            reasoning as the compact row's wash (Fix 5, post-review). */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2/5"
          style={{ background: 'linear-gradient(to top, color-mix(in srgb, var(--vb-primary) 55%, transparent), transparent)' }}
        />
        {/* Bottom-left cluster: eyebrow (pc-intro only) + a drawing gold rule
            + title + done-check + a decorative up-chevron collapse cue,
            grouped together — collapsible sections only. Task 9 (cinematic
            hero flourishes): both the eyebrow and rule are `aria-hidden` —
            neither may alter the button's accessible name, which must stay
            exactly the section title (name-from-content skips aria-hidden
            subtrees). */}
        <span className="relative z-[3] mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-2 px-6 pb-6">
          {section.sectionKey === 'pc-intro' && (
            <span
              aria-hidden
              className="vb-hero-eyebrow block text-xs font-bold tracking-[0.2em] uppercase"
              style={{ color: 'var(--vb-on-primary)' }}
            >
              A note from your team
            </span>
          )}
          <span
            aria-hidden
            className="vb-hero-rule block h-0.5 w-16"
            style={{ background: 'var(--vb-tertiary)' }}
          />
          <span className="flex min-w-0 items-center gap-3">
            <TitleTag
              className="min-w-0 truncate text-3xl font-extrabold tracking-tight sm:text-5xl"
              style={{ color: 'var(--vb-on-primary)', fontFamily: 'var(--vb-heading-font)' }}
            >
              {title}
            </TitleTag>
            {done && <DoneBadge size="hero" />}
            {collapsible && (
              <span
                aria-hidden
                className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-white/10 text-white transition-colors group-hover:bg-white/20"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <polyline points="6 15 12 9 18 15" />
                </svg>
              </span>
            )}
          </span>
        </span>
      </span>
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
          now), with a reduced-motion override. Shared by both hero done-checks
          and the body summary-face badge. */}
      <style>{`
        @keyframes vb-pop { 0% { transform: scale(0); } 70% { transform: scale(1.18); } 100% { transform: scale(1); } }
        .vb-done-badge { animation: vb-pop 400ms ease-out both; }
        @media (prefers-reduced-motion: reduce) { .vb-done-badge { animation: none; } }
      `}</style>

      {collapsible ? (
        <CollapsibleSection
          viewbookId={viewbookId}
          sectionKey={section.sectionKey}
          title={title}
          heroExpanded={buildExpandedHero()}
          heroCollapsed={buildCompactRow()}
          hasHeroImage={heroUrl != null}
          body={
            <>
              {headerStrip}
              {detailBody}
            </>
          }
          regionId={regionId}
          previewMode={previewMode}
          autoRevealMs={autoRevealMs}
        />
      ) : (
        // Dormant path: as of 2026-07-19 welcome-auto-reveal no section key
        // is collapse-ineligible (COLLAPSE_EXCLUDED_SECTION_KEYS is empty),
        // so this branch never runs today — retained as the seam for a
        // future carve-out. When it does run: no collapse state at all —
        // always the full hero + header strip + body, no affordance/control.
        <>
          {buildExpandedHero()}
          {headerStrip}
          {detailBody}
        </>
      )}
    </section>
  )
}
