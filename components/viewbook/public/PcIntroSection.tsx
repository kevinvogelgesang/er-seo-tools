// Post-contract welcome hero (PR5 Task 7, spec §7): activates the dormant
// 'pc-intro' section key. Renders the operator-editable global-content
// string `data.global.pcIntro` (Task 1's new 'pc-intro' key) with a
// code-owned fallback when unset (Codex fix 10 — NOT purely code-owned).
// Never collapses, no ack — this is purely informational, mirroring
// WsIntroSection's shape (thin section via SectionShell + defensive gate).
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'
import { SummaryStat, sectionStatusLabel } from './SummaryStat'

const FALLBACK_INTRO =
  "Welcome! Let's get your viewbook set up — a few quick basics, then invite your team so everyone can follow along."

export function PcIntroSection({
  section,
  data,
  token,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
}) {
  // Defensive belt-and-suspenders gate — 'pc-intro' only ever appears in the
  // post-contract primary lineup, never carried.
  if (data.stage !== 'post-contract') return null
  const hero = data.theme.sectionHeroes['pc-intro']

  return (
    <SectionShell
      section={section}
      stage={data.stage}
      title={SECTION_TITLES['pc-intro']}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={<SummaryStat eyebrow={SECTION_TITLES['pc-intro']} headline={sectionStatusLabel(section)} />}
    >
      <p className="text-lg text-black/70" style={{ fontFamily: 'var(--vb-body-font)' }}>
        {data.global.pcIntro || FALLBACK_INTRO}
      </p>
    </SectionShell>
  )
}
