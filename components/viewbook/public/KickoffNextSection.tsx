import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { KickoffNextButton } from './KickoffNextButton'
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
        <div className="space-y-3">
          <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
            Ready for the next step?
          </h2>
          <p className="text-black/70">Advance the client when the kickoff conversation is complete.</p>
          <KickoffNextButton viewbookId={data.viewbookId} />
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>Questions?</h2>
          <p className="text-black/70">
            {data.csmName ? `Reach out to ${data.csmName}, your primary contact.` : 'Reach out to your Enrollment Resources contact.'}
          </p>
        </div>
      )}
    </SectionShell>
  )
}
