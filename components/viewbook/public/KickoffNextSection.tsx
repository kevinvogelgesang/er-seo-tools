import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import type { SectionKey } from '@/lib/viewbook/theme'
import { KickoffNextCta } from './KickoffNextButton'
import { KickoffQuestionsOutro } from './KickoffQuestionsOutro'
import { SectionShell } from './SectionShell'
import { ChapterCtaButton } from './ChapterCtaButton'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'
import { SummaryStat, sectionStatusLabel } from './SummaryStat'

// Code-owned reader-facing action summary for the kickoff "Next Steps" chapter.
// Concrete next actions (no operator data) + one prominent CTA back into the
// plan, so the section reads as a clear hand-off rather than a near-empty
// "Questions?" outro. Server-safe (renders the ChapterCtaButton client island
// as a child — it never attaches onClick itself).
const NEXT_ACTIONS: string[] = [
  'Skim the milestones so you know what the next few weeks look like.',
  'Make sure the right teammates have been invited to follow along.',
  'Send your Enrollment Resources contact anything still outstanding — brand assets, access, or notes.',
]

const NEXT_STEPS_CTA: { label: string; sectionKey: SectionKey; anchor: string } = {
  label: 'Review your milestones',
  sectionKey: 'milestones',
  anchor: '#milestones',
}

function KickoffActionSummary() {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vb-secondary)' }}>
        What happens next
      </p>
      <p className="mt-1 text-sm text-black/70">
        Kickoff is wrapped up. A few small things keep the build moving:
      </p>
      <ul className="mt-3 space-y-2">
        {NEXT_ACTIONS.map((action) => (
          <li key={action} className="flex items-start gap-2 text-sm text-black/75">
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: 'var(--vb-secondary)' }}
            />
            <span>{action}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <ChapterCtaButton {...NEXT_STEPS_CTA} />
      </div>
    </div>
  )
}

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
      stage={data.stage}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={
        <SummaryStat headline={sectionStatusLabel(section)} />
      }
      affordance={data.collapseAffordance}
      overlayStrength={data.heroOverlayStrength}
      isOperator={isOperator}
      viewbookId={data.viewbookId}
      token={token}
    >
      {isOperator ? (
        <KickoffNextCta viewbookId={data.viewbookId} csmName={data.csmName} />
      ) : (
        <div className="space-y-6">
          <KickoffActionSummary />
          <KickoffQuestionsOutro csmName={data.csmName} />
        </div>
      )}
    </SectionShell>
  )
}
