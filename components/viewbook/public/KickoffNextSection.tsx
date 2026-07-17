import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { KickoffNextCta } from './KickoffNextButton'
import { KickoffQuestionsOutro } from './KickoffQuestionsOutro'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'

export function KickoffNextSection({
  isOperator,
  section,
  data,
  token,
}: {
  isOperator: boolean
  section: PublicSection
  data: ViewbookPublicData
  token: string
}) {
  // STAGE_LINEUPS only lists 'kickoff-next' in the 'kickoff' stage's primary
  // section list (never carried), so renderSection never reaches this
  // component outside 'kickoff' — this check is a defensive no-op, not the
  // primary gate.
  if (data.stage !== 'kickoff') return null
  const hero = data.theme.sectionHeroes[section.sectionKey]

  return (
    <SectionShell
      section={section}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
    >
      {isOperator ? (
        <KickoffNextCta viewbookId={data.viewbookId} csmName={data.csmName} />
      ) : (
        <KickoffQuestionsOutro csmName={data.csmName} />
      )}
    </SectionShell>
  )
}
