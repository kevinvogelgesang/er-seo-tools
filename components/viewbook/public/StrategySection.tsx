// SEO/GEO/E-E-A-T Strategy (spec §8): global base blocks ("our playbook") +
// the viewbook's override blocks ("your plan"), visually distinguished.
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import type { GlobalContentKey } from '@/lib/viewbook/global-content-keys'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'

const STRATEGY_KEYS: { key: Exclude<GlobalContentKey, 'team'>; label: string }[] = [
  { key: 'seo-base', label: 'SEO' },
  { key: 'geo-base', label: 'GEO' },
  { key: 'eeat-base', label: 'E-E-A-T' },
]

export function StrategySection({
  section,
  data,
  token,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
}) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  const hasAny = STRATEGY_KEYS.some(
    (k) => (data.global.blocks[k.key]?.blocks?.length ?? 0) > 0 || data.overrides[k.key],
  )
  return (
    <SectionShell
      section={section}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
    >
      {!hasAny && <p className="text-black/50">Your strategy playbook is coming soon.</p>}
      {STRATEGY_KEYS.map(({ key, label }) => {
        const blocks = data.global.blocks[key]?.blocks ?? []
        const override = data.overrides[key]
        if (blocks.length === 0 && !override) return null
        return (
          <div key={key} className="space-y-4">
            <h3 className="text-2xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
              {label}
            </h3>
            {blocks.map((b, i) => (
              <div key={i} className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
                {b.heading && <p className="font-bold">{b.heading}</p>}
                <p className="mt-1 whitespace-pre-line text-black/80">{b.body}</p>
              </div>
            ))}
            {override && (
              <div className="rounded-xl border-l-4 bg-white p-5 shadow-sm" style={{ borderColor: 'var(--vb-tertiary)' }}>
                <span
                  className="mb-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{ background: 'var(--vb-tertiary)', color: 'var(--vb-on-tertiary)' }}
                >
                  Your plan
                </span>
                <p className="whitespace-pre-line text-black/80">{override}</p>
              </div>
            )}
          </div>
        )
      })}
    </SectionShell>
  )
}
