// Shared allowed-notify-recipient resolver (v2 PR5 spec §5/§8). The set of
// canonical mailboxes a viewbook may notify on a stage change: every stored
// `ViewbookTeamMember.email` UNION the current `school-contact-email`
// (`PRIMARY_CONTACT_EMAIL_DEFKEY`) answer value — both canonicalized via
// `canonicalMailbox`. ONE home reused by:
//   - `moveViewbookStage` (service.ts) — filters the client-requested
//     `clientNotifyJson` list down to this allowed set before creating
//     stage-change deliveries.
//   - `setNotifyEmails` (setup.ts) — validates the client's WRITE against
//     this same set (an address not already on the viewbook is rejected,
//     400 `invalid_notify_recipient`) so the two surfaces can never drift.
import { prisma } from '@/lib/db'
import { canonicalMailbox, PRIMARY_CONTACT_EMAIL_DEFKEY } from './global-content-keys'

export async function resolveAllowedNotifyRecipients(viewbookId: number): Promise<Set<string>> {
  const allowed = new Set<string>()
  const vb = await prisma.viewbook.findUnique({
    where: { id: viewbookId },
    select: {
      teamMembers: { select: { email: true } },
      fields: {
        where: { defKey: PRIMARY_CONTACT_EMAIL_DEFKEY, archivedAt: null },
        select: { value: true },
        take: 1,
      },
    },
  })
  if (!vb) return allowed
  for (const member of vb.teamMembers) {
    const email = canonicalMailbox(member.email)
    if (email) allowed.add(email)
  }
  const primaryEmail = canonicalMailbox(vb.fields[0]?.value)
  if (primaryEmail) allowed.add(primaryEmail)
  return allowed
}
