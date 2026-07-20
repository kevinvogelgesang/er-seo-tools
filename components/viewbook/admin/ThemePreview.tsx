'use client'

// The admin frame is dark-mode aware; the nested client canvas is deliberately
// light-only and uses the same public SectionShell + brand variables clients see.
import { useEffect, useState } from 'react'
import type { ViewbookTheme } from '@/lib/viewbook/theme'
import { isAllowedFont } from '@/lib/viewbook/font-manifest'
import type { ResolvedThemeFonts } from '@/lib/viewbook/resolved-theme-fonts'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { PRESENTATION_DEFAULTS } from '@/lib/viewbook/presentation-config'
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

// Placeholder identity for the bounded admin preview canvas — this is not a
// real viewbook, so viewbookId/token are inert placeholders and previewMode
// guarantees CollapsibleSection never issues a public collapse POST.
const PREVIEW_VIEWBOOK_ID = 0
const PREVIEW_TOKEN = 'theme-preview'

export function ThemePreview({
  theme,
  clientName = 'Your Client',
}: {
  theme: ViewbookTheme
  clientName?: string
}) {
  const [resolvedFonts, setResolvedFonts] = useState<ResolvedThemeFonts | undefined>()

  useEffect(() => {
    if (isAllowedFont(theme.headingFont) && isAllowedFont(theme.bodyFont)) {
      setResolvedFonts(undefined)
      return
    }
    let current = true
    void import('@/lib/viewbook/font-catalog').then(({ resolveCatalogFont }) => {
      const fallback = resolveCatalogFont('inter')
      const heading = resolveCatalogFont(theme.headingFont) ?? fallback
      const body = resolveCatalogFont(theme.bodyFont) ?? fallback
      if (!current || !heading || !body) return
      const headingMeta = { key: resolveCatalogFont(theme.headingFont) ? theme.headingFont : 'inter', family: heading.family, gfQuery: heading.gfQuery }
      const bodyMeta = { key: resolveCatalogFont(theme.bodyFont) ? theme.bodyFont : 'inter', family: body.family, gfQuery: body.gfQuery }
      setResolvedFonts({
        href: `https://fonts.googleapis.com/css2?${[...new Set([heading.gfQuery, body.gfQuery])].join('&')}&display=swap`,
        heading: headingMeta,
        body: bodyMeta,
      })
    })
    return () => { current = false }
  }, [theme.bodyFont, theme.headingFont])

  return (
    <section data-testid="theme-preview-frame" className="min-w-0 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-navy-border dark:bg-navy-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-navy-border">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-navy dark:text-white">Live client preview</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">The bounded canvas stays light, matching the public viewbook.</p>
        </div>
        <StatusPill label="Client view · light" tone="neutral" />
      </div>
      <div className="min-w-0 max-w-full overflow-x-hidden bg-gray-100 p-3 dark:bg-navy-deep/55">
        <div className="max-h-[680px] min-w-0 max-w-full overflow-x-hidden overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-inner dark:border-navy-border">
          <div
            data-testid="theme-preview-canvas"
            // Morph CSS keys off an ancestor data-vb-morph (ViewbookShell's
            // theme root on the public page) — the preview canvas stamps the
            // default so the sample section still animates sanely here.
            data-vb-morph={PRESENTATION_DEFAULTS.collapseMorph}
            className="isolate min-w-0 max-w-full overflow-x-hidden bg-[#fafafa] text-[#1a1a1a]"
            style={{ ...themeCssVars(theme, resolvedFonts), colorScheme: 'light' }}
          >
            <ThemeStyle theme={theme} resolvedFonts={resolvedFonts} />
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
              <SectionShell
                section={SAMPLE_SECTION}
                title="Brand Guidelines"
                heroUrl={null}
                stage="kickoff"
                affordance={PRESENTATION_DEFAULTS.collapseAffordance}
                overlayStrength={PRESENTATION_DEFAULTS.heroOverlayStrength}
                isOperator={false}
                viewbookId={PREVIEW_VIEWBOOK_ID}
                token={PREVIEW_TOKEN}
                previewMode
              >
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
