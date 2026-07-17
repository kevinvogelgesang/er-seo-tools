// Brand Guidelines (spec §8): palette swatches (theme kit colors), live
// typography specimens in the actual heading/body fonts, and the operator's
// design-philosophy narrative. v1 palette = the three theme colors.
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { FONT_CATALOG } from '@/lib/viewbook/theme'
import { ContrastTester } from './ContrastTester'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'

const SWATCHES = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'tertiary', label: 'Tertiary' },
] as const

export function BrandSection({
  section,
  data,
  token,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
}) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  const headingFamily = FONT_CATALOG[data.theme.headingFont]?.family ?? 'Inter'
  const bodyFamily = FONT_CATALOG[data.theme.bodyFont]?.family ?? 'Inter'
  return (
    <SectionShell
      section={section}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
    >
      <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
        Palette
      </h3>
      <div className="grid gap-4 sm:grid-cols-3">
        {SWATCHES.map((s) => (
          <div key={s.key} className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
            <div className="h-24" style={{ background: `var(--vb-${s.key})` }} />
            <div className="px-4 py-3">
              <p className="font-semibold">{s.label}</p>
              <p className="text-sm text-black/50">{data.theme[s.key]}</p>
            </div>
          </div>
        ))}
      </div>

      <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
        Typography
      </h3>
      <div className="space-y-4 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-black/40">Headings — {headingFamily}</p>
          <p className="text-4xl font-extrabold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
            Aa Bb Cc — Your future starts here
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-black/40">Body — {bodyFamily}</p>
          <p className="text-base text-black/80" style={{ fontFamily: 'var(--vb-body-font)' }}>
            The quick brown fox jumps over the lazy dog. 0123456789
          </p>
        </div>
      </div>

      <ContrastTester theme={data.theme} />

      {section.narrative && (
        <>
          <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
            Design philosophy
          </h3>
          <p className="whitespace-pre-line text-black/80">{section.narrative}</p>
        </>
      )}
    </SectionShell>
  )
}
