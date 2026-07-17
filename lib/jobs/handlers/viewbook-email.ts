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
import type { JobExhaustedContext } from '../types'
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

  // The viewbook lookup is ESSENTIAL: it's the only source of the token that
  // builds a valid public viewbookUrl. A transient failure/timeout here must
  // throw (never fall back to the login-walled baseUrl) so the job retries;
  // a genuinely deleted viewbook (row absent, not an error) stays a no-op.
  // The stage label is a nicety — its own failure degrades to a generic
  // label rather than blocking the send.
  const eventKey = delivery.kind === 'stage-change' ? eventKeyFromStageDedup(delivery.dedupKey) : null
  const [viewbookResult, stageLogResult] = await Promise.allSettled([
    withDeadline(
      prisma.viewbook.findUnique({
        where: { id: delivery.viewbookId },
        select: { token: true, revokedAt: true, client: { select: { name: true, archivedAt: true } } },
      }),
      ENRICHMENT_DEADLINE_MS,
    ),
    eventKey
      ? withDeadline(
          prisma.viewbookStageLog.findUnique({ where: { eventKey }, select: { stage: true } }),
          ENRICHMENT_DEADLINE_MS,
        )
      : Promise.resolve(null),
  ])

  if (viewbookResult.status === 'rejected') {
    logError({ subsystem: 'jobs', job: VIEWBOOK_EMAIL_JOB_TYPE, deliveryId: delivery.id }, viewbookResult.reason)
    throw viewbookResult.reason instanceof Error
      ? viewbookResult.reason
      : new Error(String(viewbookResult.reason))
  }
  const viewbook = viewbookResult.value
  if (!viewbook) return // viewbook was deleted — nothing to send about

  // A revoked viewbook (public page 404s) or an archived client's viewbook
  // would produce a dead-link email — terminally suppress instead of sending.
  if (viewbook.revokedAt || viewbook.client.archivedAt) {
    await stampSuppressed(delivery.id)
    return
  }

  const clientName = viewbook.client.name
  const viewbookTitle = `${clientName} Project Viewbook`
  const viewbookUrl = `${baseUrl}/viewbook/${viewbook.token}`

  let stageLabel = 'the next stage'
  if (stageLogResult.status === 'fulfilled') {
    const stageLog = stageLogResult.value
    if (stageLog && isViewbookStage(stageLog.stage)) stageLabel = STAGE_LABELS[stageLog.stage]
  } else {
    logError({ subsystem: 'jobs', job: VIEWBOOK_EMAIL_JOB_TYPE, deliveryId: delivery.id }, stageLogResult.reason)
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

/**
 * Kill switch for a permanently-failing send (mirrors the class of bug
 * `lib/findings/exhausted-placeholder.ts` exists to prevent for
 * broken-link-verify): without this, an exhausted job leaves the delivery
 * non-terminal (sentAt+suppressedAt both null); `recoverViewbookEmailDeliveries`
 * skips it only while the error Job row exists, and once retention prunes
 * that row (30 d) the sweep re-enqueues it, exhausting forever. Stamping
 * `suppressedAt` here (the SAME sentAt/suppressedAt-both-null-fenced update
 * the handler uses) makes exhaustion terminal — recovery skips it for good.
 * Never throws: this runs from the worker's settle path.
 */
export async function onViewbookEmailExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  const value = payload as Partial<ViewbookEmailPayload> | null
  const deliveryId = value && Number.isInteger(value.deliveryId) ? (value.deliveryId as number) : null
  if (deliveryId == null) {
    logError(
      { subsystem: 'jobs', job: VIEWBOOK_EMAIL_JOB_TYPE },
      new Error(`viewbook-email exhausted with an unparseable payload after ${ctx.attempts} attempts: ${ctx.lastError}`),
    )
    return
  }
  try {
    await stampSuppressed(deliveryId)
  } catch (err) {
    logError({ subsystem: 'jobs', job: VIEWBOOK_EMAIL_JOB_TYPE, deliveryId }, err)
  }
}

export function registerViewbookEmailHandler(): void {
  registerJobHandler({
    type: VIEWBOOK_EMAIL_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    timeoutMs: 30_000,
    handler: (payload) => runViewbookEmailJob(payload),
    onExhausted: onViewbookEmailExhausted,
  })
}
