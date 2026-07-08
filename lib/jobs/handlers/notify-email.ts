// lib/jobs/handlers/notify-email.ts
//
// D7 durable scan-completion notifier. Recipient + content resolved at send
// time from the SiteAudit row. Idempotency guard = durable sent-markers
// (dedupKey is active-window only). NO site-audit:<id> group key — failSiteAudit
// cancels that group. Concurrency 1, 3 attempts + backoff.
//
// No-op (return, never throw) when: feature dark; row deleted; no recipient;
// sent-marker already set; NEXT_PUBLIC_APP_URL unset (no relative-link email).
// A send failure THROWS -> one retry; the marker is only stamped AFTER a
// successful send (at-least-once, narrow dup window).

import { prisma } from '@/lib/db'
import { isNotifyEnabled, notifyAdminEmail } from '@/lib/notify/config'
import { buildCompleteEmail, buildFailedEmail } from '@/lib/notify/content'
import { loadCompleteEnrichment } from '@/lib/notify/enrichment'
import { sendEmail, realNotifyDeps, type NotifyDeps } from '@/lib/notify/transport'
import { logError } from '@/lib/log'
import { registerJobHandler } from '../registry'
import { enqueueJob } from '../queue'

export const NOTIFY_EMAIL_JOB_TYPE = 'notify-email'

// The 30s worker timeout does NOT cancel pending Prisma work, so cap the
// best-effort enrichment read — a slow read must not push the send past the job
// timeout and widen the at-least-once duplicate window.
const ENRICHMENT_DEADLINE_MS = 5_000

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('enrichment deadline exceeded')), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

export interface NotifyEmailJob {
  siteAuditId: string
  kind: 'complete' | 'failed'
}

function assertPayload(payload: unknown): NotifyEmailJob {
  const p = payload as Partial<NotifyEmailJob> | null
  if (!p || typeof p.siteAuditId !== 'string' || (p.kind !== 'complete' && p.kind !== 'failed')) {
    throw new Error('Invalid notify-email job payload')
  }
  return p as NotifyEmailJob
}

// Returns null when NEXT_PUBLIC_APP_URL is unset — the handler then no-ops
// rather than emailing a relative, un-clickable link.
function resultsUrl(id: string): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  if (!base) return null
  return `${base}/ada-audit/site/${id}`
}

export async function runNotifyEmailJob(payload: unknown, deps: NotifyDeps = realNotifyDeps): Promise<void> {
  const { siteAuditId, kind } = assertPayload(payload)
  if (!isNotifyEnabled()) return // dark — clean no-op, no retry burn

  const audit = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: {
      id: true, domain: true, status: true, error: true, requestedBy: true, notifyEmail: true,
      seoOnly: true, seoIntent: true, notifyCompleteSentAt: true, notifyFailedSentAt: true,
      startedAt: true, completedAt: true,
      pagesComplete: true, pagesTotal: true,
      crawlRuns: { select: { id: true, tool: true, source: true, status: true, score: true, scoreBreakdown: true, domain: true, completedAt: true, createdAt: true } },
    },
  })
  if (!audit) return // deleted -> no-op
  if (!audit.notifyEmail) return // opt-in never set -> silent
  const url = resultsUrl(audit.id)
  if (!url) return // NEXT_PUBLIC_APP_URL unset -> no relative-link email

  if (kind === 'complete') {
    if (audit.notifyCompleteSentAt) return // already sent
    const adaScore = audit.crawlRuns.find((r) => r.tool === 'ada-audit')?.score ?? null
    // Live SEO score: the seo-parser live-scan run (precise identity).
    const seoRun = audit.crawlRuns.find((r) => r.tool === 'seo-parser' && r.source === 'live-scan')
    const liveScore = seoRun?.score ?? null
    const durationMs = audit.startedAt && audit.completedAt
      ? audit.completedAt.getTime() - audit.startedAt.getTime() : null
    const scanType = audit.seoOnly ? 'SEO' : audit.seoIntent ? 'ADA + SEO' : 'ADA'
    const base = {
      domain: audit.domain, scanType, requestedBy: audit.requestedBy,
      adaScore: audit.seoOnly ? null : adaScore, seoScore: liveScore, durationMs,
      resultsUrl: url, seoUnavailable: !seoRun,
    }
    // Enrichment is best-effort: loading AND the enriched build sit inside the
    // try; a failure (or the deadline) degrades to the base email. sendEmail +
    // the marker stamp stay OUTSIDE — a send failure must never stamp, and an
    // enrichment failure must never suppress the send.
    let content
    try {
      const enrichment = await withDeadline(loadCompleteEnrichment({
        id: audit.id, domain: audit.domain, seoOnly: audit.seoOnly,
        pagesComplete: audit.pagesComplete, pagesTotal: audit.pagesTotal, crawlRuns: audit.crawlRuns,
      }), ENRICHMENT_DEADLINE_MS)
      content = buildCompleteEmail({ ...base, ...enrichment })
    } catch (err) {
      logError({ subsystem: 'jobs', job: 'notify-email', siteAuditId: audit.id }, err)
      content = buildCompleteEmail(base)
    }
    await sendEmail({ to: audit.notifyEmail, content }, deps)
    await prisma.siteAudit.updateMany({
      where: { id: audit.id, notifyCompleteSentAt: null },
      data: { notifyCompleteSentAt: new Date() },
    })
    return
  }

  // failed
  if (audit.notifyFailedSentAt) return // already sent
  const admin = notifyAdminEmail()
  if (!admin) return
  const content = buildFailedEmail({
    domain: audit.domain, requestedBy: audit.requestedBy,
    error: audit.error ?? 'Unknown error', resultsUrl: url,
  })
  await sendEmail({ to: admin, content }, deps)
  await prisma.siteAudit.updateMany({
    where: { id: audit.id, notifyFailedSentAt: null },
    data: { notifyFailedSentAt: new Date() },
  })
}

export function enqueueNotifyEmail(siteAuditId: string, kind: 'complete' | 'failed'): Promise<unknown> {
  return enqueueJob({
    type: NOTIFY_EMAIL_JOB_TYPE,
    payload: { siteAuditId, kind },
    dedupKey: `${NOTIFY_EMAIL_JOB_TYPE}:${siteAuditId}:${kind}`,
    // NO groupKey: must not be site-audit:<id> (failSiteAudit cancels that group).
  }).catch((err) => {
    console.error('[notify-email] enqueue failed for', siteAuditId, kind, ':', (err as Error).message)
  })
}

export function registerNotifyEmailHandler(): void {
  registerJobHandler({
    type: NOTIFY_EMAIL_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    timeoutMs: 30_000,
    handler: (payload) => runNotifyEmailJob(payload),
  })
}
