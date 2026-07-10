// lib/services/client-schedules.ts
//
// C2: per-client scan schedules joined with last-run info for the
// ScheduledScansCard and the schedules CRUD GET. Scores come from
// CrawlRun.score joined by siteAuditId — the finalizer does not persist
// SiteAudit.score; CrawlRun is the ADA score source of truth (B1).

import { prisma } from '@/lib/db'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'
import { getRunPairInstanceDiff } from './site-audit-diff'
import { parseScoreMeta } from '@/lib/scoring/breakdown-version'

export interface ClientScheduleRow {
  id: string
  domain: string
  wcagLevel: string
  cadence: string
  enabled: boolean
  nextRunAt: string
  /** D1: true when this schedule was created by the autonomous SEO pipeline. */
  seoIntent: boolean
  /** C11: true when this schedule scans SEO only (no ADA run). */
  seoOnly: boolean
  /** C11: the live-scan run id for a seoOnly schedule's last run (SEO results link). */
  liveRunId: string | null
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
      crawlRuns: {
        where: { OR: [{ tool: 'ada-audit' }, { tool: 'seo-parser', source: 'live-scan' }] },
        select: { id: true, tool: true, source: true, score: true, scoreBreakdown: true },
      },
    },
  })

  type AuditRow = typeof audits[number]
  const adaRun = (a: AuditRow | null) => a?.crawlRuns.find((r) => r.tool === 'ada-audit') ?? null
  const liveRun = (a: AuditRow | null) => a?.crawlRuns.find((r) => r.tool === 'seo-parser') ?? null

  return Promise.all(schedules.map(async (s) => {
    let domain = ''
    let wcagLevel = 'wcag21aa'
    let seoIntent = false
    let seoOnly = false
    try {
      const p = JSON.parse(s.payload) as Record<string, unknown>
      if (typeof p?.domain === 'string') domain = p.domain
      if (p?.wcagLevel === 'wcag22aa') wcagLevel = 'wcag22aa'
      if (p?.seoIntent === true) seoIntent = true
      if (p?.seoOnly === true) seoOnly = true
    } catch { /* malformed payload — render the row anyway */ }

    const mine = audits.filter((a) => a.scheduleId === s.id)
    const last = mine[0] ?? null

    if (seoOnly) {
      // SEO schedule: score from the live-scan run; NO ADA instance-diff
      // (getRunPairInstanceDiff rejects non-ada runs). Delta null in 2a.
      const lr = liveRun(last)
      return {
        id: s.id,
        domain,
        wcagLevel,
        cadence: s.cadence,
        enabled: s.enabled,
        nextRunAt: s.nextRunAt.toISOString(),
        seoIntent,
        seoOnly,
        liveRunId: lr?.id ?? null,
        lastRun: last
          ? {
              id: last.id,
              status: last.status,
              completedAt: last.completedAt?.toISOString() ?? null,
              score: lr?.score ?? null,
              newCount: null,
              resolvedCount: null,
            }
          : null,
        lastDelta: null,
      }
    }

    const lastScore = adaRun(last)?.score ?? null
    // ONE previous audit drives BOTH the score Δ and the diff chips (Codex
    // plan-fix #4) — the pairs must never diverge.
    const prevAudit = mine.slice(1).find(
      (a) => a.status === 'complete' && typeof adaRun(a)?.score === 'number',
    ) ?? null
    const prevScore = adaRun(prevAudit)?.score ?? null
    // C19: comparable iff BOTH the formula version AND the weights hash match —
    // a same-version reweight is just as incomparable as a version bump.
    const lastMeta = parseScoreMeta(adaRun(last)?.scoreBreakdown)
    const prevMeta = parseScoreMeta(adaRun(prevAudit)?.scoreBreakdown)
    const scoreComparable = lastMeta.version === prevMeta.version && (lastMeta.weightsHash ?? null) === (prevMeta.weightsHash ?? null)
    let newCount: number | null = null
    let resolvedCount: number | null = null
    if (last?.status === 'complete' && adaRun(last) && adaRun(prevAudit)) {
      // Same pair as the score Δ; null on wcagLevel mismatch (spec § 4.2).
      const diff = await getRunPairInstanceDiff(adaRun(last)!.id, adaRun(prevAudit)!.id)
      if (diff) { newCount = diff.newCount; resolvedCount = diff.resolvedCount }
    }

    return {
      id: s.id,
      domain,
      wcagLevel,
      cadence: s.cadence,
      enabled: s.enabled,
      nextRunAt: s.nextRunAt.toISOString(),
      seoIntent,
      seoOnly: false,
      liveRunId: null,
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
      // C9-A/C19: never diff a score across a formula-version OR weights
      // boundary (absent scoreBreakdown = v1, no hash). An incomparable pair
      // suppresses the delta entirely — the UI already treats null as "no
      // delta shown."
      lastDelta:
        last?.status === 'complete' && lastScore !== null && prevScore !== null && scoreComparable
          ? lastScore - prevScore
          : null,
    }
  }))
}
