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
  const candidates = await prisma.viewbookEmailDelivery.findMany({
    where: { sentAt: null, suppressedAt: null },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: RECOVERY_LIMIT,
  })
  if (candidates.length === 0) return

  const dedupKeys = candidates.map(({ id }) => `${VIEWBOOK_EMAIL_JOB_TYPE}:${id}`)
  const existingJobs = await prisma.job.findMany({
    where: { type: VIEWBOOK_EMAIL_JOB_TYPE, dedupKey: { in: dedupKeys } },
    select: { dedupKey: true },
  })
  const seen = new Set(existingJobs.flatMap((job) => job.dedupKey ? [job.dedupKey] : []))

  for (const { id } of candidates) {
    const dedupKey = `${VIEWBOOK_EMAIL_JOB_TYPE}:${id}`
    if (seen.has(dedupKey)) continue
    try {
      await enqueueViewbookEmail(id)
    } catch (err) {
      logError({ subsystem: 'viewbook', op: 'email-delivery-recovery', deliveryId: id }, err)
    }
  }
}
