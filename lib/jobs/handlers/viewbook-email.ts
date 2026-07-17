import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { isNotifyEnabled } from '@/lib/notify/config'
import {
  buildPcCompleteEmail,
  buildStageChangeEmail,
  buildTeamInviteEmail,
} from '@/lib/notify/viewbook-email-content'
import { sendEmail } from '@/lib/notify/transport'
import { isViewbookStage, STAGE_LABELS } from '@/lib/viewbook/stages'
import { VIEWBOOK_EMAIL_JOB_TYPE } from '../types'
import { registerJobHandler } from '../registry'

const ENRICHMENT_DEADLINE_MS = 5_000

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('enrichment deadline exceeded')), ms)
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value) },
      (err) => { clearTimeout(timeout); reject(err) },
    )
  })
}

interface ViewbookEmailPayload { deliveryId: number }

function assertPayload(payload: unknown): ViewbookEmailPayload {
  const value = payload as Partial<ViewbookEmailPayload> | null
  if (!value || !Number.isInteger(value.deliveryId) || (value.deliveryId as number) < 1) {
    throw new Error('Invalid viewbook-email job payload')
  }
  return { deliveryId: value.deliveryId as number }
}

export interface ViewbookEmailDeps {
  sendEmail: typeof sendEmail
}

export const realViewbookEmailDeps: ViewbookEmailDeps = { sendEmail }

async function stampSuppressed(deliveryId: number): Promise<void> {
  await prisma.viewbookEmailDelivery.updateMany({
    where: { id: deliveryId, sentAt: null, suppressedAt: null },
    data: { suppressedAt: new Date() },
  })
}

function appBaseUrl(): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  return base || null
}

function eventKeyFromStageDedup(dedupKey: string): string | null {
  const parts = dedupKey.split(':')
  return parts.length >= 3 && parts[0] === 'vb-stage' && parts[1] ? parts[1] : null
}

export async function runViewbookEmailJob(
  payload: unknown,
  deps: ViewbookEmailDeps = realViewbookEmailDeps,
): Promise<void> {
  const { deliveryId } = assertPayload(payload)
  if (!isNotifyEnabled()) {
    await stampSuppressed(deliveryId)
    return
  }

  const delivery = await prisma.viewbookEmailDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      viewbookId: true,
      kind: true,
      recipient: true,
      dedupKey: true,
      sentAt: true,
      suppressedAt: true,
    },
  })
  if (!delivery || delivery.sentAt || delivery.suppressedAt) return

  const baseUrl = appBaseUrl()
  if (!baseUrl) {
    await stampSuppressed(delivery.id)
    logError(
      { subsystem: 'jobs', job: VIEWBOOK_EMAIL_JOB_TYPE, deliveryId: delivery.id },
      new Error('NEXT_PUBLIC_APP_URL is unset; delivery suppressed'),
    )
    return
  }

  let clientName = 'Your organization'
  let viewbookTitle = 'Your project viewbook'
  let viewbookUrl = baseUrl
  let stageLabel = 'the next stage'
  try {
    const eventKey = delivery.kind === 'stage-change' ? eventKeyFromStageDedup(delivery.dedupKey) : null
    const [viewbook, stageLog] = await withDeadline(Promise.all([
      prisma.viewbook.findUnique({
        where: { id: delivery.viewbookId },
        select: { token: true, client: { select: { name: true } } },
      }),
      eventKey
        ? prisma.viewbookStageLog.findUnique({ where: { eventKey }, select: { stage: true } })
        : Promise.resolve(null),
    ]), ENRICHMENT_DEADLINE_MS)
    if (viewbook) {
      clientName = viewbook.client.name
      viewbookTitle = `${clientName} Project Viewbook`
      viewbookUrl = `${baseUrl}/viewbook/${viewbook.token}`
    }
    if (stageLog && isViewbookStage(stageLog.stage)) stageLabel = STAGE_LABELS[stageLog.stage]
  } catch (err) {
    logError({ subsystem: 'jobs', job: VIEWBOOK_EMAIL_JOB_TYPE, deliveryId: delivery.id }, err)
  }

  const content = delivery.kind === 'team-invite'
    ? buildTeamInviteEmail({ clientName, viewbookTitle, inviteUrl: viewbookUrl })
    : delivery.kind === 'pc-complete'
      ? buildPcCompleteEmail({ clientName, viewbookTitle, viewbookUrl })
      : buildStageChangeEmail({ clientName, viewbookTitle, viewbookUrl, stageLabel })

  await deps.sendEmail({ to: delivery.recipient, content })
  await prisma.viewbookEmailDelivery.updateMany({
    where: { id: delivery.id, sentAt: null, suppressedAt: null },
    data: { sentAt: new Date() },
  })
}

export function registerViewbookEmailHandler(): void {
  registerJobHandler({
    type: VIEWBOOK_EMAIL_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    timeoutMs: 30_000,
    handler: (payload) => runViewbookEmailJob(payload),
  })
}
