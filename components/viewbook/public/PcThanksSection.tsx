// Post-contract completion section (PR5 Task 7, spec §7): revealed once
// `pcCompletedAt` is stamped (ack.ts's `buildPcCompletion` / a force-advance).
// Task 1's public-data `gatePcThanks` already excludes this section key from
// `primarySections` when `pcCompletedAt` is null (so the ProgressNav never
// shows a dead dot) — this null gate is belt-and-suspenders.
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'
import { SummaryStat, sectionStatusLabel } from './SummaryStat'

const THANK_YOU_COPY =
  "Thank you! We've received your information — adjust anything or add users; we look forward to starting."

export function PcThanksSection({
  section,
  data,
  token,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
}) {
  if (!data.pcCompletedAt) return null
  const hero = data.theme.sectionHeroes['pc-thanks']

  return (
    <SectionShell
      section={section}
      stage={data.stage}
      title={SECTION_TITLES['pc-thanks']}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={<SummaryStat eyebrow={SECTION_TITLES['pc-thanks']} headline={sectionStatusLabel(section)} />}
    >
      <p className="text-lg text-black/70" style={{ fontFamily: 'var(--vb-body-font)' }}>{THANK_YOU_COPY}</p>
    </SectionShell>
  )
}
