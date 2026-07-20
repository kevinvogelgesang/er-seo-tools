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
import { buildSearchIndex, buildTocIndex } from '@/lib/viewbook/toc-index'
import { ProgressNav } from './ProgressNav'
import { EarlierSteps } from './EarlierSteps'
import { TocRail } from './TocRail'
import { ThemeStyle, publicAssetUrl, themeCssVars } from './ThemeStyle'
import { ViewbookSyncClient } from './ViewbookSyncClient'
import { StickyOffsetProbe } from './StickyOffsetProbe'

export function ViewbookShell({
  token,
  data,
  primarySections,
  carriedSections,
  renderSection,
}: {
  token: string
  data: ViewbookPublicData
  primarySections: PublicSection[]
  carriedSections: PublicSection[]
  renderSection: (s: PublicSection) => ReactNode
}) {
  const logoUrl = data.theme.logo ? publicAssetUrl(token, data.theme.logo) : null
  return (
    <div
      data-vb-theme-root
      className="min-h-screen bg-[#fafafa] text-[#1a1a1a]"
      style={{
        ...themeCssVars(data.theme),
        // Pre-hydration fallback (matches the operator-bar-less common
        // case) so sticky pinning is sane before StickyOffsetProbe measures
        // the real chrome height. Plain, non-!important — Lane 2's
        // live-theme store overrides this same property on this same node.
        '--vb-sticky-offset': '64px',
        '--vb-reveal-scale': String(data.revealDurationScale),
      } as CSSProperties}
    >
      <ThemeStyle theme={data.theme} />
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
      <div style={{ fontFamily: 'var(--vb-body-font)' }}>
        {primarySections.map((s) => (
          <div key={s.sectionKey}>{renderSection(s)}</div>
        ))}
        <EarlierSteps sections={carriedSections} renderSection={renderSection} />
      </div>
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
