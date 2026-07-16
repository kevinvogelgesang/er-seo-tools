// The themed page frame: CSS-variable scope (inline styles — values validated
// by parseStoredTheme), Google Fonts link, sticky ProgressNav, then the
// visible sections in fixed order via the caller's render map. The public
// page does NOT participate in app dark mode (spec §6) — colors here are
// explicit, never `dark:` variants.
import type { ReactNode } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'
import type { ViewbookPublicData } from '@/lib/viewbook/public-types'
import { ProgressNav } from './ProgressNav'
import { ThemeStyle, publicAssetUrl, themeCssVars } from './ThemeStyle'

export function ViewbookShell({
  token,
  data,
  sectionContent,
}: {
  token: string
  data: ViewbookPublicData
  sectionContent: (sectionKey: SectionKey) => ReactNode
}) {
  const logoUrl = data.theme.logo ? publicAssetUrl(token, data.theme.logo) : null
  return (
    <div className="min-h-screen bg-[#fafafa] text-[#1a1a1a]" style={themeCssVars(data.theme)}>
      <ThemeStyle theme={data.theme} />
      {/* The (public) layout already renders the page's <main> — no nested
          main here; exactly ONE h1 on the page (Codex plan-fix 5). */}
      <h1 className="sr-only">{data.clientName} — Viewbook</h1>
      <ProgressNav clientName={data.clientName} logoUrl={logoUrl} sections={data.sections} />
      <div style={{ fontFamily: 'var(--vb-body-font)' }}>
        {data.sections.map((s) => (
          <div key={s.sectionKey}>{sectionContent(s.sectionKey)}</div>
        ))}
      </div>
      <footer className="px-6 py-10 text-center text-sm text-black/40">
        Prepared for {data.clientName} by Enrollment Resources
      </footer>
    </div>
  )
}
