'use client'

// The admin frame is dark-mode aware; the nested client canvas is deliberately
// light-only and uses the same public SectionShell + brand variables clients see.
import type { ViewbookTheme } from '@/lib/viewbook/theme'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { SectionShell } from '@/components/viewbook/public/SectionShell'
import { ThemeStyle, themeCssVars } from '@/components/viewbook/public/ThemeStyle'
import { StatusPill } from '@/components/ui/StatusPill'

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
    <section data-testid="theme-preview-frame" className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-navy-border dark:bg-navy-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-navy-border">
        <div>
          <h2 className="font-display text-base font-bold text-navy dark:text-white">Live client preview</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">The bounded canvas stays light, matching the public viewbook.</p>
        </div>
        <StatusPill label="Client view · light" tone="neutral" />
      </div>
      <div className="bg-gray-100 p-3 dark:bg-navy-deep/55">
        <div className="max-h-[620px] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-inner dark:border-navy-border">
          <div
            data-testid="theme-preview-canvas"
            className="isolate bg-[#fafafa] text-[#1a1a1a]"
            style={{ ...themeCssVars(theme), colorScheme: 'light' }}
          >
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
                  {[theme.primary, theme.secondary, theme.tertiary].map((color) => (
                    <span
                      key={color}
                      className="inline-block h-10 w-10 rounded-lg border border-black/10"
                      style={{ background: color }}
                      title={color}
                    />
                  ))}
                </div>
              </SectionShell>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
