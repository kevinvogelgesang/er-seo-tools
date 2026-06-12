// lib/services/site-audit-diff.ts
//
// C3: instance-level run-over-run diff selection + loading. Previous-run
// selection for the results page is domain-scoped and client-agnostic
// (domain is the identity), wcagLevel-matched (mixed levels produce false
// "new" instances — spec § 4.2), with B2's ordering: completedAt ?? createdAt
// desc, id-desc tie-break. Reads normalized tables ONLY — never blobs.

import { prisma } from '@/lib/db'
import { diffInstances, type InstanceDiff, type InstanceRef } from './findings-shared'

export interface SiteAuditDiffResult {
  diff: InstanceDiff
  previous: { runId: string; siteAuditId: string | null; completedAt: string | null }
}

type RunStamp = { id: string; completedAt: Date | null; createdAt: Date }
const runTime = (r: RunStamp) => (r.completedAt ?? r.createdAt).getTime()
const isEarlier = (r: RunStamp, cur: RunStamp) =>
  runTime(r) < runTime(cur) || (runTime(r) === runTime(cur) && r.id.localeCompare(cur.id) < 0)

async function loadAndDiff(currentRunId: string, previousRunId: string): Promise<InstanceDiff> {
  const select = { dedupKey: true, type: true, severity: true, url: true } as const
  const [curFindings, prevFindings, completePages] = await Promise.all([
    prisma.finding.findMany({ where: { runId: currentRunId, scope: 'page' }, select }),
    prisma.finding.findMany({ where: { runId: previousRunId, scope: 'page' }, select }),
    prisma.crawlPage.findMany({
      where: { runId: { in: [currentRunId, previousRunId] }, status: 'complete' },
      select: { runId: true, url: true },
    }),
  ])
  const refs = (rows: typeof curFindings): InstanceRef[] =>
    rows.filter((f): f is typeof f & { url: string } => f.url !== null)
  return diffInstances(
    refs(curFindings),
    refs(prevFindings),
    new Set(completePages.filter((p) => p.runId === currentRunId).map((p) => p.url)),
    new Set(completePages.filter((p) => p.runId === previousRunId).map((p) => p.url)),
  )
}

/** Pair diff for callers that already selected the runs (dashboard, schedules
 *  card). Returns null when either run is missing or the wcagLevels differ —
 *  instance counts never render across a level mismatch (Codex spec-fix #1). */
export async function getRunPairInstanceDiff(
  currentRunId: string,
  previousRunId: string,
): Promise<InstanceDiff | null> {
  const select = { id: true, tool: true, wcagLevel: true } as const
  const [cur, prev] = await Promise.all([
    prisma.crawlRun.findUnique({ where: { id: currentRunId }, select }),
    prisma.crawlRun.findUnique({ where: { id: previousRunId }, select }),
  ])
  // Defensive tool check (Codex plan-fix #6): a future caller must not be
  // able to diff an SEO run against an ADA run with compatible-looking ids.
  if (!cur || !prev || cur.tool !== 'ada-audit' || prev.tool !== 'ada-audit') return null
  if (cur.wcagLevel !== prev.wcagLevel) return null
  return loadAndDiff(cur.id, prev.id)
}

/** Results-page entry: anchored at this audit's own run (not the latest). */
export async function getSiteAuditInstanceDiff(siteAuditId: string): Promise<SiteAuditDiffResult | null> {
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId },
    select: { id: true, domain: true, wcagLevel: true, completedAt: true, createdAt: true },
  })
  if (!run || run.domain === null) return null

  const candidates = await prisma.crawlRun.findMany({
    where: {
      tool: 'ada-audit',
      source: 'site-audit',
      domain: run.domain,
      wcagLevel: run.wcagLevel,
      id: { not: run.id },
    },
    select: { id: true, siteAuditId: true, completedAt: true, createdAt: true },
  })
  const previous = candidates
    .filter((c) => isEarlier(c, run))
    .sort((a, b) => runTime(b) - runTime(a) || b.id.localeCompare(a.id))[0] ?? null
  if (!previous) return null

  const diff = await loadAndDiff(run.id, previous.id)
  return {
    diff,
    previous: {
      runId: previous.id,
      siteAuditId: previous.siteAuditId,
      completedAt: previous.completedAt?.toISOString() ?? null,
    },
  }
}
