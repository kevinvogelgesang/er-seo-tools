// lib/jobs/handlers/scheduled-site-audit.ts
//
// C2: thin wrapper fired by client-owned Schedule rows. Resolves its
// Schedule via the Job row (JobHandlerContext has no scheduleId and the
// scheduler does not inject it into payloads), re-validates the client +
// domain, then enters the normal site-audit queue via queueSiteAuditRequest
// — so the one-active claim, dedup, finalizer, recovery, and findings
// dual-write all apply unchanged.
//
// Self-healing, never destructive: config rot (archived client, delisted
// domain, malformed payload) disables the schedule and completes. A
// duplicate in-flight audit consumes the slot (no catch-up run). DB errors
// throw → worker retries with backoff; the next cadence slot is the
// durable retry after exhaustion.

import { prisma } from '@/lib/db'
import { registerJobHandler } from '../registry'

export const SCHEDULED_SITE_AUDIT_JOB_TYPE = 'scheduled-site-audit'

interface ScheduledSiteAuditPayload {
  clientId: number
  domain: string
  wcagLevel: string
  /** D1: true when this schedule was created by the autonomous SEO pipeline. */
  seoIntent?: boolean
}

function parsePayload(payload: unknown): ScheduledSiteAuditPayload | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  if (typeof p.clientId !== 'number' || !Number.isInteger(p.clientId)) return null
  if (typeof p.domain !== 'string' || p.domain.length === 0) return null
  const wcagLevel = p.wcagLevel === 'wcag22aa' ? 'wcag22aa' : 'wcag21aa'
  const seoIntent = p.seoIntent === true
  return { clientId: p.clientId, domain: p.domain, wcagLevel, seoIntent }
}

async function disableSchedule(scheduleId: string, reason: string): Promise<void> {
  try {
    await prisma.schedule.update({ where: { id: scheduleId }, data: { enabled: false } })
    console.warn(`[schedule] disabled ${scheduleId}: ${reason}`)
  } catch (err) {
    // Schedule already deleted → nothing to disable, fine. Any other DB
    // error must THROW so the worker retries (config rot disables, DB
    // errors retry).
    if ((err as { code?: string }).code === 'P2025') {
      console.warn(`[schedule] ${scheduleId} already gone while disabling (${reason})`)
      return
    }
    throw err
  }
}

export function registerScheduledSiteAuditHandler(): void {
  registerJobHandler({
    type: SCHEDULED_SITE_AUDIT_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    timeoutMs: 30_000, // it only enqueues
    onExhausted: async (_payload, ctx) => {
      // No domain row to fail — the next cadence slot is the durable retry.
      console.warn(
        `[schedule] scheduled-site-audit job ${ctx.jobId} exhausted after ${ctx.attempts} attempts: ${ctx.lastError}`,
      )
    },
    handler: async (payload, ctx) => {
      const job = await prisma.job.findUnique({
        where: { id: ctx.jobId },
        select: { scheduleId: true },
      })
      if (!job?.scheduleId) {
        console.warn(`[schedule] job ${ctx.jobId} has no scheduleId; skipping`)
        return
      }
      const schedule = await prisma.schedule.findUnique({
        where: { id: job.scheduleId },
        select: { id: true, enabled: true },
      })
      if (!schedule || !schedule.enabled) return // deleted or paused since enqueue — no-op

      const p = parsePayload(payload)
      if (!p) {
        await disableSchedule(schedule.id, 'malformed payload')
        return
      }

      const client = await prisma.client.findUnique({
        where: { id: p.clientId },
        select: { archivedAt: true, domains: true },
      })
      let domains: string[] = []
      try {
        const parsed = client ? JSON.parse(client.domains) : []
        if (Array.isArray(parsed)) domains = parsed.filter((d): d is string => typeof d === 'string')
      } catch { /* treat as no domains */ }
      if (!client || client.archivedAt || !domains.includes(p.domain)) {
        await disableSchedule(schedule.id, 'client missing/archived or domain no longer listed')
        return
      }

      // Dynamic import: avoids a static handler → queue-manager edge
      // (same reasoning as stale-audit-reset / site-audit-discover).
      const { queueSiteAuditRequest } = await import('@/lib/ada-audit/queue-request')
      const result = await queueSiteAuditRequest({
        domain: p.domain,
        clientId: p.clientId,
        wcagLevel: p.wcagLevel,
        requestedBy: 'scheduled',
        scheduleId: schedule.id,
        seoIntent: p.seoIntent ?? false,
      })
      if (result.kind === 'duplicate') {
        console.log(`[schedule] ${schedule.id}: slot skipped — audit ${result.existingId} already in flight`)
      } else if (result.kind === 'invalid') {
        await disableSchedule(schedule.id, `request invalid: ${result.reason}`)
      }
    },
  })
}
