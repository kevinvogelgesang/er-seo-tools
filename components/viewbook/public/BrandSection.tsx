// Brand Guidelines (spec §8): palette swatches (theme kit colors), live
// typography specimens in the actual heading/body fonts, and the operator's
// design-philosophy narrative. v1 palette = the three theme colors.
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { FONT_MANIFEST } from '@/lib/viewbook/font-manifest'
import { ContrastTester } from './ContrastTester'
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'

const SWATCHES = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'tertiary', label: 'Tertiary' },
] as const

// The summary face's "key visual" for Brand Guidelines — three small swatch
// dots, not a SummaryStat metric (there's no meaningful count to show; the
// palette itself IS the glanceable summary).
function BrandSwatchesSummary() {
  return (
    <div className="flex items-center gap-2">
      {SWATCHES.map((s) => (
        <span
          key={s.key}
          aria-hidden
          className="h-6 w-6 rounded-full border border-black/10"
          style={{ background: `var(--vb-${s.key})` }}
        />
      ))}
      <span className="text-sm text-black/60">Your brand palette</span>
    </div>
  )
}

export function BrandSection({
  section,
  data,
  token,
  meta,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
  meta: SectionRenderMeta
}) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  const headingFamily = FONT_MANIFEST[data.theme.headingFont as keyof typeof FONT_MANIFEST]?.family ?? 'Inter'
  const bodyFamily = FONT_MANIFEST[data.theme.bodyFont as keyof typeof FONT_MANIFEST]?.family ?? 'Inter'
  return (
    <SectionShell
      section={section}
      stage={data.stage}
      meta={meta}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={<BrandSwatchesSummary />}
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

      <ContrastTester viewbookId={data.viewbookId} theme={data.theme} />

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
