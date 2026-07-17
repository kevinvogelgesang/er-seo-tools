'use client'

// Live theme preview (spec §10): renders the PUBLIC page's own components
// (SectionShell + theming primitives) inline with sample content — a shared
// renderer, never an iframe (the app ships frame-ancestors 'none').
// Preview asset note: heroUrl/logo stay null here — asset previews need the
// token-gated public URL; the editor keeps PR1's "(uploaded)" indicators.
// Colors + fonts are the live-preview surface.
import type { ViewbookTheme } from '@/lib/viewbook/theme'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { SectionShell } from '@/components/viewbook/public/SectionShell'
import { ThemeStyle, themeCssVars } from '@/components/viewbook/public/ThemeStyle'

const SAMPLE_SECTION: PublicSection = {
  sectionKey: 'brand',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: 'A short operator intro note looks like this.',
  narrative: null,
}

export function ThemePreview({
  theme,
  clientName = 'Your Client',
}: {
  theme: ViewbookTheme
  clientName?: string
}) {
  return (
    // max-h + scroll: the shared SectionShell renders a full-viewport spread;
    // the admin preview shows it in a bounded scrollable frame.
    <div className="max-h-[480px] overflow-y-auto rounded-lg border border-gray-200 dark:border-navy-border">
      <div className="bg-[#fafafa] text-[#1a1a1a]" style={themeCssVars(theme)}>
        <ThemeStyle theme={theme} />
        <div
          className="px-4 py-2 text-sm font-bold"
          style={{
            background: 'var(--vb-primary)',
            color: 'var(--vb-on-primary)',
            fontFamily: 'var(--vb-heading-font)',
          }}
        >
          {clientName} — viewbook preview
        </div>
        <div style={{ fontFamily: 'var(--vb-body-font)' }}>
          <SectionShell section={SAMPLE_SECTION} title="Brand Guidelines" heroUrl={null} stage="kickoff">
            <p className="text-black/80">
              Body copy renders in the selected body font. Headers use the heading font on the brand
              primary band above.
            </p>
            <div className="flex gap-2">
              {[theme.primary, theme.secondary, theme.tertiary].map((c) => (
                <span
                  key={c}
                  className="inline-block h-10 w-10 rounded-lg border border-black/10"
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </SectionShell>
        </div>
      </div>
    </div>
  )
}
