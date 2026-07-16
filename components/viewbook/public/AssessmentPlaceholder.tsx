// Current-Site Assessment placeholder (spec §8/§14): PR5 swaps this for the
// real AssessmentSection at the page mount point — SAME props signature so
// the swap is one import change.
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'

export function AssessmentPlaceholder({
  section,
  data,
  token,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
}) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  return (
    <SectionShell
      section={section}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
    >
      <p className="text-black/60">
        Your first site scan is coming soon — we&apos;ll publish your current-site assessment here.
      </p>
    </SectionShell>
  )
}
