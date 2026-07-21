// Post-contract team-invite section (PR5 Task 7, spec §7/§8): the stored
// team list (data.teamMembers — name/email + "Invite requested" status from
// the EXISTENCE-only `invited` boolean, NEVER "Sent"; Codex fix 7), the add
// form, per-member resend, a ≤15 note, and the shared ack action
// (post-contract only). Carried into kickoff/website-specifics/building
// (STAGE_LINEUPS) — must NOT hard-gate to post-contract.
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { inviteProgress } from '@/lib/viewbook/summary-metrics'
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'
import { AckButton } from './AckButton'
import { ResendInviteButton, TeamInviteForm } from './TeamInviteForm'
import { SummaryStat } from './SummaryStat'

const MEMBER_CAP = 15

export function PcInviteSection({
  section,
  data,
  token,
  meta,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
  meta: SectionRenderMeta
}) {
  const hero = data.theme.sectionHeroes['pc-invite']
  const members = data.teamMembers
  const { invited, total } = inviteProgress(members)

  return (
    <SectionShell
      section={section}
      stage={data.stage}
      meta={meta}
      title={SECTION_TITLES['pc-invite']}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={
        <SummaryStat
          eyebrow="Team Invites"
          headline={`${invited} invite${invited === 1 ? '' : 's'} requested`}
          chip={`${total} added`}
        />
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-black/60">
          Invite up to {MEMBER_CAP} people from your team — {members.length} of {MEMBER_CAP} invited.
        </p>

        {members.length === 0 ? (
          <p className="text-black/40">No one has been invited yet.</p>
        ) : (
          <ul className="divide-y divide-black/5">
            {members.map((m) => (
              <li key={m.memberKey} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold">{m.name}</p>
                  <p className="text-sm text-black/50">{m.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-black/50">
                    {m.invited ? 'Invite requested' : 'Invite pending'}
                  </span>
                  <ResendInviteButton token={token} memberId={m.id} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <TeamInviteForm token={token} disabled={members.length >= MEMBER_CAP} />
      </div>
      {data.stage === 'post-contract' && (
        <AckButton token={token} sectionKey="pc-invite" acknowledgedAt={section.acknowledgedAt} />
      )}
    </SectionShell>
  )
}
