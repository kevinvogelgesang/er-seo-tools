import { Prisma, type ViewbookEmailDelivery } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { enqueueJob } from '@/lib/jobs/queue'
import { VIEWBOOK_EMAIL_JOB_TYPE } from '@/lib/jobs/types'
import { notifyAdminEmail } from '@/lib/notify/config'
import { getGlobalContent } from './global-content'
import { canonicalMailbox } from './global-content-keys'

const RECOVERY_LIMIT = 200

export function stageChangeDeliveryStatements(input: {
  viewbookId: number
  eventKey: string
  recipients: string[]
}) {
  return input.recipients.map((recipient) => prisma.viewbookEmailDelivery.create({
    data: {
      viewbookId: input.viewbookId,
      kind: 'stage-change',
      recipient,
      dedupKey: `vb-stage:${input.eventKey}:${recipient}`,
      stageLogId: null,
      memberId: null,
    },
  }))
}

// PR5: the simple (non-cap) team-invite delivery builder — a plain `.create`
// PrismaPromise for tests / any caller that doesn't need the cap predicate.
// The actual add/resend cores (lib/viewbook/team-members.ts) do NOT use this:
// the ordinal + cap must be computed in SQL, so they build their own raw
// `INSERT … SELECT … WHERE <cap predicate> … RETURNING "id"` statements.
export function teamInviteDeliveryStatement(input: {
  viewbookId: number
  memberId: number
  memberKey: string
  ordinal: number
  recipient: string
}): Prisma.PrismaPromise<ViewbookEmailDelivery> {
  return prisma.viewbookEmailDelivery.create({
    data: {
      viewbookId: input.viewbookId,
      kind: 'team-invite',
      recipient: input.recipient,
      dedupKey: `vb-invite:${input.memberKey}:${input.ordinal}`,
      memberId: input.memberId,
      stageLogId: null,
    },
  })
}

// PR5: the pc-complete delivery INSERT is a RAW, conflict-safe statement —
// NOT a Prisma `.create` (that builder can't express ON CONFLICT DO NOTHING).
// Both the ack-completion path (lib/viewbook/ack.ts) and the force-advance
// path (moveViewbookStage, Task 6) share this ONE builder so the unique
// `vb-pc-complete:<viewbookId>` dedupKey is always conflict-safe regardless
// of which caller wins the race. `predicate` carries the caller's full
// completion gate (self-contained EXISTS/AND chain) — this function does not
// interpret it.
export function pcCompleteDeliveryInsert(input: {
  viewbookId: number
  recipient: string
  predicate: Prisma.Sql
}): Prisma.PrismaPromise<number> {
  const now = Date.now()
  const dedupKey = `vb-pc-complete:${input.viewbookId}`
  return prisma.$executeRaw`
    INSERT INTO "ViewbookEmailDelivery"
      ("viewbookId", "kind", "recipient", "dedupKey", "memberId", "stageLogId", "createdAt")
    SELECT ${input.viewbookId}, 'pc-complete', ${input.recipient}, ${dedupKey}, NULL, NULL, ${now}
    WHERE (${input.predicate})
    ON CONFLICT("dedupKey") DO NOTHING
  `
}

// Resolved BEFORE the completion transaction (bound in as a plain string) —
// the recipient is the assigned CSM's roster email when flagged isCsm, else
// the admin fallback. Never throws: a corrupt/missing roster degrades to the
// fallback rather than blocking completion.
export async function resolvePcCompleteRecipient(viewbookId: number): Promise<string> {
  const vb = await prisma.viewbook.findUnique({ where: { id: viewbookId }, select: { csmName: true } })
  if (vb?.csmName) {
    const team = await getGlobalContent('team')
    if (Array.isArray(team)) {
      const member = team.find((m) => m.isCsm === true && m.name === vb.csmName)
      const canonical = member?.email ? canonicalMailbox(member.email) : null
      if (canonical) return canonical
    }
  }
  return notifyAdminEmail()
}

export function enqueueViewbookEmail(deliveryId: number): Promise<unknown> {
  return enqueueJob({
    type: VIEWBOOK_EMAIL_JOB_TYPE,
    payload: { deliveryId },
    dedupKey: `${VIEWBOOK_EMAIL_JOB_TYPE}:${deliveryId}`,
  })
}

export async function recoverViewbookEmailDeliveries(): Promise<void> {
  // The "no job has ever existed for this delivery" predicate is applied
  // INSIDE the query (NOT EXISTS) so `take`/LIMIT bounds actual recovery
  // candidates — jobless non-terminal deliveries — rather than the first
  // RECOVERY_LIMIT non-terminal rows overall. Filtering post-hoc would let a
  // genuinely stranded delivery hide behind 200 rows that already have jobs
  // and never get selected. The dedupKey format here (`<type>:<id>`) must
  // match `enqueueViewbookEmail` exactly.
  const dedupPrefix = `${VIEWBOOK_EMAIL_JOB_TYPE}:`
  const candidates = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT d."id"
    FROM "ViewbookEmailDelivery" d
    WHERE d."sentAt" IS NULL AND d."suppressedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Job" j
        WHERE j."dedupKey" = ${dedupPrefix} || d."id"
      )
    ORDER BY d."id" ASC
    LIMIT ${RECOVERY_LIMIT}
  `

  for (const { id } of candidates) {
    try {
      await enqueueViewbookEmail(id)
    } catch (err) {
      logError({ subsystem: 'viewbook', op: 'email-delivery-recovery', deliveryId: id }, err)
    }
  }
}
