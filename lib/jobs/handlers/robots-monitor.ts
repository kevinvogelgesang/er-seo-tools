// lib/jobs/handlers/robots-monitor.ts
//
// D5 per-domain scheduled robots/sitemap monitor, fired by the weekly
// robots-monitor-sweep fan-out. Runs (or job-scope-reuses) a scheduled D4
// RobotsCheck and, when the stored row CHANGED vs its exact predecessor,
// sends ONE change-alert email (dark-gated, marker-fenced, at-least-once).
//
// Ordering rules (spec Codex #1/#2/#3/#6 + plan-Codex #1/#2):
// - revalidation (with NORMALIZED stored-domain membership) runs BEFORE
//   reuse and alerting, on every path
// - reuse boundary = the sweep slot's createdAt carried in the payload
//   (durable across child re-enqueues; never wall clock); fallback = this
//   job row's own createdAt
// - only source:'scheduled' rows ever alert (a manual single-flight winner
//   absorbs the change silently)
// - dark notify env = PERMANENT suppression for that change (no stamp)

import { prisma } from '@/lib/db'
import { normalizeClientDomain, InvalidDomainError } from '@/lib/security/domain-validation'
import { isNotifyEnabled, notifyAdminEmail } from '@/lib/notify/config'
import { buildRobotsChangeEmail } from '@/lib/notify/robots-change-content'
import { sendEmail } from '@/lib/notify/transport'
import { runAndStoreRobotsCheck, getRobotsCheck, type StoredRobotsCheck } from '@/lib/robots-check/service'
import { registerJobHandler } from '../registry'

export const ROBOTS_MONITOR_JOB_TYPE = 'robots-monitor'

export interface RobotsMonitorDeps {
  runAndStore: (clientId: number, domain: string, opts: { source: 'scheduled' }) => Promise<StoredRobotsCheck>
  getCheck: (clientId: number, checkId: number) => Promise<StoredRobotsCheck | null>
  send: typeof sendEmail
  notifyEnabled: () => boolean
  adminEmail: () => string
  now: () => Date
}

export const realRobotsMonitorDeps: RobotsMonitorDeps = {
  runAndStore: (clientId, domain, opts) => runAndStoreRobotsCheck(clientId, domain, opts),
  getCheck: (clientId, checkId) => getRobotsCheck(clientId, checkId),
  send: sendEmail,
  notifyEnabled: isNotifyEnabled,
  adminEmail: notifyAdminEmail,
  now: () => new Date(),
}

interface Payload { clientId: number; domain: string; slotStartedAt: number | null }

function parsePayload(payload: unknown): Payload | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  if (typeof p.clientId !== 'number' || !Number.isInteger(p.clientId) || p.clientId < 1) return null
  if (typeof p.domain !== 'string' || p.domain.length === 0) return null
  const slotStartedAt =
    typeof p.slotStartedAt === 'number' && Number.isInteger(p.slotStartedAt) && p.slotStartedAt > 0
      ? p.slotStartedAt
      : null
  return { clientId: p.clientId, domain: p.domain, slotStartedAt }
}

function parseClientDomains(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : []
  } catch {
    return []
  }
}

export async function runRobotsMonitor(
  payload: unknown,
  ctx: { jobId: string },
  deps: RobotsMonitorDeps = realRobotsMonitorDeps,
): Promise<void> {
  const p = parsePayload(payload)
  if (!p) {
    console.warn('[robots-monitor] malformed payload; skipping')
    return
  }

  // 1. Revalidate FIRST, on every path (Codex #1): archived clients and
  //    delisted domains never get fetched, reused, or emailed.
  let domain: string
  try {
    domain = normalizeClientDomain(p.domain)
  } catch (err) {
    if (err instanceof InvalidDomainError) {
      console.warn('[robots-monitor] invalid payload domain; skipping')
      return
    }
    throw err
  }
  const client = await prisma.client.findUnique({
    where: { id: p.clientId },
    select: { name: true, archivedAt: true, domains: true },
  })
  if (!client || client.archivedAt) {
    console.warn(`[robots-monitor] client ${p.clientId} missing/archived; skipping`)
    return
  }
  // Membership over the NORMALIZED stored list (plan-Codex #2): a legacy
  // 'Dupe.example' entry was enqueued as 'dupe.example' — comparing raw
  // stored values would wrongly reject it as delisted.
  const listed = new Set<string>()
  for (const entry of parseClientDomains(client.domains)) {
    try {
      listed.add(normalizeClientDomain(entry))
    } catch (err) {
      if (!(err instanceof InvalidDomainError)) throw err // malformed legacy entry -> skip
    }
  }
  if (!listed.has(domain)) {
    console.warn(`[robots-monitor] ${domain} no longer listed for client ${p.clientId}; skipping`)
    return
  }

  // 2. Slot-scoped reuse (Codex #1 + plan-Codex #1): the SWEEP job's
  //    createdAt, carried in the payload, is the durable slot boundary — it
  //    survives child-job re-enqueues after an early child went terminal (a
  //    child's own createdAt would not). Fallback for hand-enqueued jobs
  //    without the field: this job row's createdAt.
  let boundary: Date | null = p.slotStartedAt !== null ? new Date(p.slotStartedAt) : null
  if (!boundary) {
    const job = await prisma.job.findUnique({ where: { id: ctx.jobId }, select: { createdAt: true } })
    boundary = job?.createdAt ?? null
  }
  const reusable = boundary
    ? await prisma.robotsCheck.findFirst({
        where: { clientId: p.clientId, domain, source: 'scheduled', createdAt: { gte: boundary } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      })
    : null

  let checkId: number
  if (reusable) {
    checkId = reusable.id
  } else {
    const fresh = await deps.runAndStore(p.clientId, domain, { source: 'scheduled' })
    // Source fence (Codex #2): a concurrent manual POST that won the D4
    // single-flight hands us ITS row — manual absorption means silence.
    if (fresh.summary.source !== 'scheduled') {
      console.log(`[robots-monitor] manual check absorbed the slot for ${domain}; no alert`)
      return
    }
    checkId = fresh.summary.id
  }

  // 3. Stored-row resolution (Codex #3): the service seam owns the exact
  //    predecessor + changeSummary. Never re-derive evidence here.
  const stored = await deps.getCheck(p.clientId, checkId)
  if (!stored) {
    console.warn(`[robots-monitor] check ${checkId} unreadable post-store; no alert`)
    return
  }
  if (stored.summary.changed !== true || stored.summary.source !== 'scheduled') return
  if (!stored.changeSummary) return // changed:true implies a summary; defensive

  // 4. Alert: read marker -> dark gate -> send -> conditional stamp (D7
  //    at-least-once contract, narrow dup window).
  const row = await prisma.robotsCheck.findUnique({ where: { id: checkId }, select: { alertSentAt: true } })
  if (!row || row.alertSentAt) return
  if (!deps.notifyEnabled()) {
    // Permanent suppression by design (Codex #6): next week compares against
    // this row and reads unchanged — dark means this email never existed.
    console.log(`[robots-monitor] change detected for ${domain} but notify env dark; suppressed`)
    return
  }
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '') || null
  const content = buildRobotsChangeEmail({
    clientName: client.name,
    clientId: p.clientId,
    domain,
    summary: stored.changeSummary,
    currFailure: stored.detail.robots.failure,
    appUrl,
  })
  await deps.send({ to: deps.adminEmail(), content })
  await prisma.robotsCheck.updateMany({
    where: { id: checkId, alertSentAt: null },
    data: { alertSentAt: deps.now() },
  })
}

export function registerRobotsMonitorHandler(): void {
  registerJobHandler({
    type: ROBOTS_MONITOR_JOB_TYPE,
    concurrency: 1, // politeness: one client site fetched at a time
    maxAttempts: 2,
    timeoutMs: 120_000, // worst-case check ~75s + DB + one 10s email send
    onExhausted: async (_payload, ctx) => {
      // The in-app changed badge still shows the change; next weekly slot
      // will NOT re-alert it (its predecessor becomes the changed row).
      console.warn(`[robots-monitor] job ${ctx.jobId} exhausted after ${ctx.attempts} attempts: ${ctx.lastError}`)
    },
    handler: async (payload, ctx) => {
      await runRobotsMonitor(payload, ctx)
    },
  })
}
