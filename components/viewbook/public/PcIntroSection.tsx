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
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'
import { PC_INTRO_DEFAULT } from '@/lib/viewbook/content-validators'

export function PcIntroSection({
  section,
  data,
  token,
  isOperator = false,
  meta,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
  isOperator?: boolean
  meta: SectionRenderMeta
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
      summary={<SummaryStat headline={sectionStatusLabel(section)} />}
      affordance={data.collapseAffordance}
      overlayStrength={data.heroOverlayStrength}
      isOperator={isOperator}
      viewbookId={data.viewbookId}
      token={token}
      meta={meta}
      viewerMode={data.viewerMode}
      sectionCopy={data.sectionCopy[section.sectionKey]}
      autoRevealMs={data.stage === 'post-contract' ? data.firstLoadDelayMs : undefined}
    >
      <p className="text-lg text-black/70" style={{ fontFamily: 'var(--vb-body-font)' }}>
        {data.global.pcIntro || PC_INTRO_DEFAULT}
      </p>
    </SectionShell>
  )
}
