// lib/services/client-schedules.ts
//
// C2: per-client scan schedules joined with last-run info for the
// ScheduledScansCard and the schedules CRUD GET. Scores come from
// CrawlRun.score joined by siteAuditId — the finalizer does not persist
// SiteAudit.score; CrawlRun is the ADA score source of truth (B1).

import { prisma } from '@/lib/db'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'

export interface ClientScheduleRow {
  id: string
  domain: string
  wcagLevel: string
  cadence: string
  enabled: boolean
  nextRunAt: string
  lastRun: { id: string; status: string; completedAt: string | null; score: number | null } | null
  /** lastRun score minus the previous completed scheduled run's score; null when <2 scored runs. */
  lastDelta: number | null
}

export async function getClientSchedules(clientId: number): Promise<ClientScheduleRow[]> {
  const schedules = await prisma.schedule.findMany({
    where: { clientId, jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  if (schedules.length === 0) return []

  const audits = await prisma.siteAudit.findMany({
    where: { scheduleId: { in: schedules.map((s) => s.id) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      scheduleId: true,
      status: true,
      completedAt: true,
      crawlRun: { select: { score: true } },
    },
  })

  return schedules.map((s) => {
    let domain = ''
    let wcagLevel = 'wcag21aa'
    try {
      const p = JSON.parse(s.payload) as Record<string, unknown>
      if (typeof p?.domain === 'string') domain = p.domain
      if (p?.wcagLevel === 'wcag22aa') wcagLevel = 'wcag22aa'
    } catch { /* malformed payload — render the row anyway */ }

    const mine = audits.filter((a) => a.scheduleId === s.id)
    const last = mine[0] ?? null
    const lastScore = last?.crawlRun?.score ?? null
    const prevScore =
      mine.slice(1).find((a) => a.status === 'complete' && typeof a.crawlRun?.score === 'number')
        ?.crawlRun?.score ?? null

    return {
      id: s.id,
      domain,
      wcagLevel,
      cadence: s.cadence,
      enabled: s.enabled,
      nextRunAt: s.nextRunAt.toISOString(),
      lastRun: last
        ? {
            id: last.id,
            status: last.status,
            completedAt: last.completedAt?.toISOString() ?? null,
            score: lastScore,
          }
        : null,
      lastDelta:
        last?.status === 'complete' && lastScore !== null && prevScore !== null
          ? lastScore - prevScore
          : null,
    }
  })
}
