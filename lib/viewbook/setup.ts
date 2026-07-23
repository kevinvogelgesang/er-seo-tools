// pc-setup `clientNotifyJson` write (v2 PR5 spec §5/§8): the public "who
// gets notified on a stage advance" list. Every posted address MUST already
// be known to the viewbook — equal (canonicalized) to a stored
// `ViewbookTeamMember.email` OR the current `school-contact-email` answer
// value — via the SAME `resolveAllowedNotifyRecipients` set
// `moveViewbookStage` (service.ts) filters its recipients against
// (lib/viewbook/notify-recipients.ts). An arbitrary address is rejected
// (400 `invalid_notify_recipient`) even though the value only becomes
// load-bearing at the NEXT stage move.
//
// Value-idempotent (Codex fix 8): the write is fenced not just on the access
// chain but on `clientNotifyJson IS NOT <canonical serialization>` — a
// repost of the identical (deduped/canonicalized/sorted) list is a true
// no-op: 0 rows, no activity, syncVersion +0. The validated array is
// deduped, lowercased (via canonicalMailbox), and sorted before
// serialization so the equality compare is deterministic regardless of the
// order the client posted addresses in.
//
// `clientMutationId` is advisory only — there is no durable column to key a
// replay against (unlike ack.ts/team-members.ts), so it is validated for
// shape (if present) but never used as a fence. Value-idempotence is the
// real replay guard here.

import { Prisma, type Viewbook } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { requireViewbookToken } from './route-auth'
import { validateClientMutationId } from './public-write-guard'
import { syncVersionBumpWhere } from './sync'
import { canonicalMailbox, PRIMARY_CONTACT_EMAIL_DEFKEY } from './global-content-keys'
import { resolveAllowedNotifyRecipients } from './notify-recipients'
import {
  attributionOf,
  memberWriteFence,
  requireMemberStillAuthorized,
  type PublicMutationAuth,
} from './principal'

const MAX_NOTIFY_EMAILS = 5

export interface MutationHooks {
  beforeCommit?: () => Promise<void>
}

export interface SetNotifyEmailsInput {
  notifyEmails: unknown
  clientMutationId?: string
}

export interface SetNotifyEmailsResult {
  notifyEmails: string[]
}

function validateNotifyEmails(raw: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(raw) || raw.length > MAX_NOTIFY_EMAILS) {
    throw new HttpError(400, 'invalid_notify_emails')
  }
  const canonical = new Set<string>()
  for (const entry of raw) {
    const email = canonicalMailbox(entry)
    if (!email) throw new HttpError(400, 'invalid_notify_emails')
    if (!allowed.has(email)) throw new HttpError(400, 'invalid_notify_recipient')
    canonical.add(email)
  }
  // Stable (sorted) order so the serialized JSON is deterministic regardless
  // of client-submitted order — the value-idempotence fence compares this
  // string verbatim.
  return [...canonical].sort()
}

// The pc-setup section gates this write exactly like team-members.ts gates
// the invite add/resend on pc-invite (Global Constraints route contract:
// token current + not-revoked + client active + section visible). JOIN
// (not EXISTS) mirrors that file's existing style.
function accessChainPredicate(viewbookId: number, token: string): Prisma.Sql {
  return Prisma.sql`
    EXISTS (
      SELECT 1 FROM "Viewbook" v
      JOIN "Client" c ON c."id" = v."clientId"
      JOIN "ViewbookSection" s ON s."viewbookId" = v."id" AND s."sectionKey" = 'pc-setup' AND s."state" <> 'hidden'
      WHERE v."id" = ${viewbookId} AND v."token" = ${token} AND v."revokedAt" IS NULL AND c."archivedAt" IS NULL
    )
  `
}

// Hidden-section diagnosis (mirrors team-members.ts's
// `requirePcInviteSectionVisible` / ack.ts's `!section || section.state ===
// 'hidden'` check): a hidden pc-setup section must 404 as `not_found` — the
// SAME oracle as a missing/revoked viewbook — BEFORE the value-idempotent
// no-op is assumed, so a hidden section never leaks distinguishing
// information through a false "success" no-op.
async function requirePcSetupSectionVisible(viewbookId: number): Promise<void> {
  const section = await prisma.viewbookSection.findFirst({
    where: { viewbookId, sectionKey: 'pc-setup' },
  })
  if (!section || section.state === 'hidden') throw new HttpError(404, 'not_found')
}

// Commit-time recipient revalidation (Codex fix — TOCTOU): resolveAllowedNotifyRecipients()
// snapshots the allowed set BEFORE the transaction opens. A concurrent edit
// between that read and commit — a team member removed, or the
// school-contact-email answer changed — must not let a now-stale address
// persist, so every validated recipient is re-checked as a CURRENT member
// (team OR primary-contact answer) INSIDE the same fence `S` the write
// commits under. `canonical` is already ≤5 canonical emails, so this is a
// small fixed number of extra EXISTS clauses. Empty list needs no clause —
// clearing the list is always allowed.
function recipientsStillAllowedPredicate(viewbookId: number, emails: string[]): Prisma.Sql {
  if (emails.length === 0) return Prisma.sql`1=1`
  const clauses = emails.map(
    (email) => Prisma.sql`
      (EXISTS (SELECT 1 FROM "ViewbookTeamMember" WHERE "viewbookId" = ${viewbookId} AND "email" = ${email})
       OR EXISTS (
         SELECT 1 FROM "ViewbookField"
         WHERE "viewbookId" = ${viewbookId} AND "defKey" = ${PRIMARY_CONTACT_EMAIL_DEFKEY}
           AND "archivedAt" IS NULL AND lower("value") = ${email}
       ))
    `,
  )
  return Prisma.join(clauses, ' AND ')
}

export async function setNotifyEmails(
  viewbook: Viewbook,
  token: string,
  input: SetNotifyEmailsInput,
  auth: PublicMutationAuth,
  hooks: MutationHooks = {},
): Promise<SetNotifyEmailsResult> {
  // Advisory only (no durable column) — validated for shape, never a fence.
  validateClientMutationId(input.clientMutationId ?? null)

  const allowed = await resolveAllowedNotifyRecipients(viewbook.id)
  const canonical = validateNotifyEmails(input.notifyEmails, allowed)
  const serialized = JSON.stringify(canonical)

  await hooks.beforeCommit?.()
  const now = Date.now()
  const { actorEmail, actorKind } = attributionOf(auth.principal)
  const S = Prisma.sql`
    ${accessChainPredicate(viewbook.id, token)}
    AND (SELECT "clientNotifyJson" FROM "Viewbook" WHERE "id" = ${viewbook.id}) IS NOT ${serialized}
    AND ${recipientsStillAllowedPredicate(viewbook.id, canonical)}
    AND ${memberWriteFence(auth.principal, viewbook.id, now)}
  `

  const [, activityCount, updateCount] = await prisma.$transaction([
    syncVersionBumpWhere(viewbook.id, S),
    prisma.$executeRaw`
      INSERT INTO "ViewbookActivity" ("viewbookId", "kind", "actor", "actorKind", "summary", "createdAt")
      SELECT ${viewbook.id}, 'notify-emails-set', ${actorEmail}, ${actorKind}, 'Updated notify emails', ${now}
      WHERE (${S})
    `,
    prisma.$executeRaw`
      UPDATE "Viewbook" SET "clientNotifyJson" = ${serialized}, "updatedAt" = ${now}
      WHERE "id" = ${viewbook.id} AND (${S})
    `,
  ])

  if (updateCount === 1 && activityCount === 1) {
    return { notifyEmails: canonical }
  }
  if (updateCount !== activityCount) throw new Error('viewbook_notify_activity_mismatch')

  // 0 rows: either the access chain failed (bad/revoked token, archived
  // client, hidden pc-setup section — re-preflight surfaces the honest 404),
  // the stored value already equals what was posted (value-idempotent no-op,
  // Codex fix 8), or a validated recipient stopped being a current member
  // between resolveAllowedNotifyRecipients() and this commit (TOCTOU fix).
  // Both preflights must pass before either explanation is assumed, or a
  // hidden section would leak through as a false "success".
  await requireMemberStillAuthorized(auth, viewbook.id)
  await requireViewbookToken(token)
  await requirePcSetupSectionVisible(viewbook.id)
  const allowedNow = await resolveAllowedNotifyRecipients(viewbook.id)
  if (canonical.some((email) => !allowedNow.has(email))) {
    throw new HttpError(400, 'invalid_notify_recipient')
  }
  return { notifyEmails: canonical }
}
