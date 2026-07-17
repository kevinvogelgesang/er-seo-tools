import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { enqueueJob } from '@/lib/jobs/queue'
import { VIEWBOOK_EMAIL_JOB_TYPE } from '@/lib/jobs/types'

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
