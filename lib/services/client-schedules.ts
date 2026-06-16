// lib/services/client-schedules.ts
//
// C2: per-client scan schedules joined with last-run info for the
// ScheduledScansCard and the schedules CRUD GET. Scores come from
// CrawlRun.score joined by siteAuditId — the finalizer does not persist
// SiteAudit.score; CrawlRun is the ADA score source of truth (B1).

import { prisma } from '@/lib/db'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'
import { getRunPairInstanceDiff } from './site-audit-diff'

export interface ClientScheduleRow {
  id: string
  domain: string
  wcagLevel: string
  cadence: string
  enabled: boolean
  nextRunAt: string
  lastRun: {
    id: string
    status: string
    completedAt: string | null
    score: number | null
    /** Instance-diff counts vs the SAME previous audit as lastDelta (C3);
     *  null when no diffable pair exists (e.g. <2 scored runs, level mismatch). */
    newCount: number | null
    resolvedCount: number | null
  } | null
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
      crawlRuns: { where: { tool: 'ada-audit' }, select: { id: true, score: true } },
    },
  })

  return Promise.all(schedules.map(async (s) => {
    let domain = ''
    let wcagLevel = 'wcag21aa'
    try {
      const p = JSON.parse(s.payload) as Record<string, unknown>
      if (typeof p?.domain === 'string') domain = p.domain
      if (p?.wcagLevel === 'wcag22aa') wcagLevel = 'wcag22aa'
    } catch { /* malformed payload — render the row anyway */ }

    const mine = audits.filter((a) => a.scheduleId === s.id)
    const last = mine[0] ?? null
    const lastScore = last?.crawlRuns[0]?.score ?? null
    // ONE previous audit drives BOTH the score Δ and the diff chips (Codex
    // plan-fix #4) — the pairs must never diverge.
    const prevAudit = mine.slice(1).find(
      (a) => a.status === 'complete' && typeof a.crawlRuns[0]?.score === 'number',
    ) ?? null
    const prevScore = prevAudit?.crawlRuns[0]?.score ?? null
    let newCount: number | null = null
    let resolvedCount: number | null = null
    if (last?.status === 'complete' && last.crawlRuns[0] && prevAudit?.crawlRuns[0]) {
      // Same pair as the score Δ; null on wcagLevel mismatch (spec § 4.2).
      const diff = await getRunPairInstanceDiff(last.crawlRuns[0].id, prevAudit.crawlRuns[0].id)
      if (diff) { newCount = diff.newCount; resolvedCount = diff.resolvedCount }
    }

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
            newCount,
            resolvedCount,
          }
        : null,
      lastDelta:
        last?.status === 'complete' && lastScore !== null && prevScore !== null
          ? lastScore - prevScore
          : null,
    }
  }))
}
