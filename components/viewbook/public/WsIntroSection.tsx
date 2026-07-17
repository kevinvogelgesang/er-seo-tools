// Website-Specifics intro hero (PR6, spec §8): activates the dormant
// 'ws-intro' section key through the CURRENT SectionShell. ws-intro has no
// narrative editor (ContentTab's showNarrative is brand/assessment only), so
// this component supplies ONLY the code-owned LEAD paragraph as children —
// SectionShell already renders section.introNote above children for every
// section, so the editable copy path comes for free. The current SectionShell
// renders active sections as a full-viewport min-h-screen hero — the spec's
// "slim hero" presentation lands with SectionShell v2 in PR7; this component
// does not attempt a bespoke slim layout.
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'

const LEAD =
  "Now we dial in the look and feel of your site — your brand palette, typography, and the accessibility bar every page has to clear."

export function WsIntroSection({
  section,
  data,
  token,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
}) {
  // The lineup already gates rendering to the 'website-specifics' stage —
  // this is a defensive belt-and-suspenders check, mirroring KickoffNextSection.
  if (data.stage !== 'website-specifics') return null
  const hero = data.theme.sectionHeroes['ws-intro']

  return (
    <SectionShell
      section={section}
      title={SECTION_TITLES['ws-intro']}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
    >
      <p className="text-lg text-black/70" style={{ fontFamily: 'var(--vb-body-font)' }}>{LEAD}</p>
    </SectionShell>
  )
}
