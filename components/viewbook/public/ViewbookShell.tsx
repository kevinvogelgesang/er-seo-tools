// The themed page frame: CSS-variable scope (inline styles — values validated
// by parseStoredTheme), Google Fonts link, sticky ProgressNav, the current
// stage's primary sections, then ONE outer collapsed "Earlier steps" band for
// everything carried forward from prior stages. The public page does NOT
// participate in app dark mode (spec §6) — colors here are explicit, never
// `dark:` variants. ViewbookShell is the SINGLE rendering owner (Codex plan
// fix 7): both primary and carried sections render through the caller's
// SAME renderSection, so a section behaves identically wherever it appears.
//
// PR7 Task 11: also mounts TocRail, a 'use client' LEAF island, with indexes
// built server-side from `data` (buildTocIndex/buildSearchIndex — pure, no
// server imports). ViewbookShell itself stays a SERVER component, so this is
// safe in BOTH the anonymous branch (ViewbookShell is the page root) and the
// operator branch (ViewbookShell is passed as `children` to the client
// OperatorViewbookLayer — a client component may receive a server-rendered
// subtree as children; only ITS OWN props must be serializable, and none of
// TocRail's props are ever a function). Outside the `building` stage the
// search index MUST be `[]` (Codex fix 7) — don't serialize Q&A/milestone/
// material/doc values into stages where those sections aren't the
// searchable focus; buildSearchIndex is only ever called when building.
import type { CSSProperties, ReactNode } from 'react'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import type { ResolvedThemeFonts } from '@/lib/viewbook/resolved-theme-fonts'
import { buildSearchIndex, buildTocIndex } from '@/lib/viewbook/toc-index'
import { computeSectionStatuses, carriedStatus, type SectionRenderMeta } from '@/lib/viewbook/section-status'
import { groupCarriedByOrigin } from '@/lib/viewbook/section-origin'
import { ProgressNav } from './ProgressNav'
import { EarlierSteps } from './EarlierSteps'
import { StageOverview } from './StageOverview'
import { PreviousStages } from './PreviousStages'
import { ReadingProgressController } from './ReadingProgressController'
import { SECTION_TITLES } from './section-titles'
import { TocRail } from './TocRail'
import { ThemeStyle, publicAssetUrl, themeCssVars } from './ThemeStyle'
import { ViewbookSyncClient } from './ViewbookSyncClient'
import { StickyOffsetProbe } from './StickyOffsetProbe'

export function ViewbookShell({
  token,
  data,
  renderSection,
  resolvedFonts,
}: {
  token: string
  data: ViewbookPublicData
  // ONE canonical rendered lineup (spec §4): rendering, status, overview,
  // previous-stages, and TOC all derive from data.primarySections /
  // data.carriedSections — no separate props to drift out of sync.
  renderSection: (s: PublicSection, meta: SectionRenderMeta) => ReactNode
  resolvedFonts?: ResolvedThemeFonts
}) {
  const logoUrl = data.theme.logo ? publicAssetUrl(token, data.theme.logo) : null
  const primary = data.primarySections
  const carried = data.carriedSections
  const statuses = computeSectionStatuses(
    primary.map((s) => s.sectionKey),
    primary,
    { pcCompletedAt: data.pcCompletedAt },
  )
  const statusOf = (key: PublicSection['sectionKey']) => statuses[key] ?? 'current'
  const primaryMeta = (i: number): SectionRenderMeta => ({
    heroSize: i === 0 ? 'full' : 'chapter',
    chapterNumber: i + 1,
    status: statusOf(primary[i].sectionKey),
    isLead: i === 0,
  })
  const carriedMeta = (s: PublicSection): SectionRenderMeta => ({
    heroSize: 'none',
    chapterNumber: null,
    status: carriedStatus(s),
    isLead: false,
  })
  return (
    <div
      data-vb-theme-root
      // Collapse↔hero morph treatment (presentation config): CSS variants in
      // CollapsibleSection key off this SINGLE ancestor attribute — no
      // per-section prop threading.
      data-vb-morph={data.collapseMorph}
      className="min-h-screen bg-[#fafafa] text-[#1a1a1a]"
      style={{
        ...themeCssVars(data.theme, resolvedFonts),
        // Pre-hydration fallback (matches the operator-bar-less common
        // case) so sticky pinning is sane before StickyOffsetProbe measures
        // the real chrome height. Plain, non-!important — Lane 2's
        // live-theme store overrides this same property on this same node.
        '--vb-sticky-offset': '64px',
        '--vb-reveal-scale': String(data.revealDurationScale),
      } as CSSProperties}
    >
      <ThemeStyle theme={data.theme} resolvedFonts={resolvedFonts} />
      {/* Codex-review fix P2-1: nested TOC/search targets (building-stage
          field/category/milestone/doc anchors) live INSIDE a section, not on
          the section root, so SectionShell's own `scrollMarginTop` (spec §)
          never covers them — scrollIntoView lands them under the sticky nav +
          sticky section header. This scoped rule gives EVERY id'd element in
          the viewbook the same scroll-margin, uniformly, without touching
          SectionShell: `--vb-sticky-offset` is a CSS custom property set on
          this theme-root node (above) and inherits to every descendant, so it
          resolves correctly here too. `scroll-margin-top` is inert on an
          element unless that element is itself a scroll target, so applying
          it broadly to `[id]` is layout-safe — it complements, not replaces,
          the section's own inline scrollMarginTop. */}
      <style>{`[data-vb-theme-root] [id] { scroll-margin-top: calc(var(--vb-sticky-offset, 64px) + 12px); }`}</style>
      <ViewbookSyncClient token={token} initialVersion={data.syncVersion} />
      {/* Mounted EXACTLY ONCE here — ViewbookShell renders in both the
          anonymous and operator branches (the operator branch passes this
          whole tree down as `children`), so this single mount covers both.
          A second mount anywhere else would double-write the measured CSS
          vars (Codex plan-fix 2). */}
      <StickyOffsetProbe />
      {/* The (public) layout already renders the page's <main> — no nested
          main here; exactly ONE h1 on the page (Codex plan-fix 5). */}
      <h1 className="sr-only">{data.displayName} — Viewbook</h1>
      <ProgressNav
        token={token}
        displayName={data.displayName}
        logoUrl={logoUrl}
        stage={data.stage}
        csmName={data.csmName}
        team={data.global.team}
      />
      {data.viewerMode === 'continuous' ? (
        <>
          <ReadingProgressController />
          <div style={{ fontFamily: 'var(--vb-body-font)' }}>
            {primary.length > 0 && <div key={primary[0].sectionKey}>{renderSection(primary[0], primaryMeta(0))}</div>}
            <StageOverview
              items={primary.map((s) => ({
                sectionKey: s.sectionKey,
                label: SECTION_TITLES[s.sectionKey],
                status: statusOf(s.sectionKey),
                anchor: `#${s.sectionKey}`,
              }))}
            />
            {primary.slice(1).map((s, i) => (
              <div key={s.sectionKey}>{renderSection(s, primaryMeta(i + 1))}</div>
            ))}
            <PreviousStages groups={groupCarriedByOrigin(carried)} renderSection={renderSection} />
          </div>
        </>
      ) : (
        <div style={{ fontFamily: 'var(--vb-body-font)' }}>
          {primary.map((s, i) => (
            <div key={s.sectionKey}>{renderSection(s, primaryMeta(i))}</div>
          ))}
          <EarlierSteps sections={carried} renderSection={(s) => renderSection(s, carriedMeta(s))} />
        </div>
      )}
      <footer className="px-6 py-10 text-center text-sm text-black/40">
        Prepared for {data.clientName} by Enrollment Resources
      </footer>
      <TocRail
        toc={buildTocIndex(data)}
        searchIndex={data.stage === 'building' ? buildSearchIndex(data) : []}
        verbose={data.stage === 'building'}
      />
    </div>
  )
}
