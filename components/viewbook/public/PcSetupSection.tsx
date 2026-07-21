// Post-contract org-basics section (PR5 Task 7, spec §7): renders the
// PC_SETUP_DEF_KEYS fields (found in data.fieldCategories by defKey) through
// the EXISTING answer-edit island (FieldEditor — no new write path; these
// same fields also appear in Data Source), the notify-emails control (the
// `setup` route — who gets stage-change mail), and the shared ack action
// (post-contract only). Carried into kickoff/website-specifics/building
// (STAGE_LINEUPS) — must NOT hard-gate to post-contract.
import type { PublicField, PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { PC_SETUP_DEF_KEYS } from '@/lib/viewbook/stages'
import { canonicalMailbox, PRIMARY_CONTACT_EMAIL_DEFKEY } from '@/lib/viewbook/global-content-keys'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'
import { FieldEditor } from './FieldEditor'
import { AckButton } from './AckButton'
import { NotifyEmailsControl, type NotifyCandidate } from './NotifyEmailsControl'
import { SummaryStat, sectionStatusLabel } from './SummaryStat'
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'

function orderedSetupFields(data: ViewbookPublicData): PublicField[] {
  const all = data.fieldCategories.flatMap((c) => c.fields)
  return PC_SETUP_DEF_KEYS.flatMap((defKey) => {
    const field = all.find((f) => f.defKey === defKey)
    return field ? [field] : []
  })
}

// The setup route only accepts addresses already known to the viewbook — a
// stored team-member email OR the current primary-contact answer value
// (lib/viewbook/notify-recipients.ts `resolveAllowedNotifyRecipients`). Build
// the SAME candidate set client-side so the checkboxes only ever offer
// addresses the write will actually accept.
function notifyCandidates(data: ViewbookPublicData): NotifyCandidate[] {
  const seen = new Set<string>()
  const out: NotifyCandidate[] = []
  for (const member of data.teamMembers) {
    const email = canonicalMailbox(member.email)
    if (email && !seen.has(email)) {
      seen.add(email)
      out.push({ email, label: member.name })
    }
  }
  const primaryValue = data.fieldCategories
    .flatMap((c) => c.fields)
    .find((f) => f.defKey === PRIMARY_CONTACT_EMAIL_DEFKEY)?.value
  const primaryEmail = canonicalMailbox(primaryValue)
  if (primaryEmail && !seen.has(primaryEmail)) {
    out.push({ email: primaryEmail, label: 'Primary contact' })
  }
  return out
}

export function PcSetupSection({
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
  const hero = data.theme.sectionHeroes['pc-setup']
  const fields = orderedSetupFields(data)

  return (
    <SectionShell
      section={section}
      stage={data.stage}
      title={SECTION_TITLES['pc-setup']}
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
    >
      <div className="space-y-4">
        {fields.map((field) => (
          <div key={field.id}>
            <p className="text-sm font-semibold text-black/60">{field.label}</p>
            <FieldEditor token={token} field={field} />
          </div>
        ))}
      </div>
      <NotifyEmailsControl token={token} candidates={notifyCandidates(data)} initialSelected={data.clientNotifyJson} />
      {data.stage === 'post-contract' && (
        <AckButton token={token} sectionKey="pc-setup" acknowledgedAt={section.acknowledgedAt} />
      )}
    </SectionShell>
  )
}
