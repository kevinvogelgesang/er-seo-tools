// The themed page frame: CSS-variable scope (inline styles — values validated
// by parseStoredTheme), Google Fonts link, sticky ProgressNav, the current
// stage's primary sections, then ONE outer collapsed "Earlier steps" band for
// everything carried forward from prior stages. The public page does NOT
// participate in app dark mode (spec §6) — colors here are explicit, never
// `dark:` variants. ViewbookShell is the SINGLE rendering owner (Codex plan
// fix 7): both primary and carried sections render through the caller's
// SAME renderSection, so a section behaves identically wherever it appears.
import type { ReactNode } from 'react'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { ProgressNav } from './ProgressNav'
import { EarlierSteps } from './EarlierSteps'
import { ThemeStyle, publicAssetUrl, themeCssVars } from './ThemeStyle'
import { ViewbookSyncClient } from './ViewbookSyncClient'

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
    <div className="min-h-screen bg-[#fafafa] text-[#1a1a1a]" style={themeCssVars(data.theme)}>
      <ThemeStyle theme={data.theme} />
      <ViewbookSyncClient token={token} initialVersion={data.syncVersion} />
      {/* The (public) layout already renders the page's <main> — no nested
          main here; exactly ONE h1 on the page (Codex plan-fix 5). */}
      <h1 className="sr-only">{data.displayName} — Viewbook</h1>
      <ProgressNav
        clientName={data.displayName}
        stageLabel={data.stageLabel}
        logoUrl={logoUrl}
        sections={primarySections}
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
    </div>
  )
}
