// lib/services/site-audit-diff.ts
//
// C3: instance-level run-over-run diff selection + loading. Previous-run
// selection for the results page is domain-scoped and client-agnostic
// (domain is the identity), wcagLevel-matched (mixed levels produce false
// "new" instances — spec § 4.2), with B2's ordering: completedAt ?? createdAt
// desc, id-desc tie-break. Reads normalized tables ONLY — never blobs.

import { prisma } from '@/lib/db'
import {
  diffInstances, diffInstancesDetailed,
  type InstanceDiff, type InstanceDiffDetailed, type InstanceRef,
} from './findings-shared'

export interface SiteAuditDiffResult {
  diff: InstanceDiff
  previous: { runId: string; siteAuditId: string | null; completedAt: string | null }
}

export interface SiteAuditDiffDetailedResult {
  detailed: InstanceDiffDetailed
  previous: { runId: string; siteAuditId: string | null; completedAt: string | null }
}

type RunStamp = { id: string; completedAt: Date | null; createdAt: Date }
const runTime = (r: RunStamp) => (r.completedAt ?? r.createdAt).getTime()
const isEarlier = (r: RunStamp, cur: RunStamp) =>
  runTime(r) < runTime(cur) || (runTime(r) === runTime(cur) && r.id.localeCompare(cur.id) < 0)

interface SelectedPair {
  runId: string
  previous: { id: string; siteAuditId: string | null; completedAt: Date | null }
}

// SINGLE previous-run selection used by both the capped and detailed entries
// (Codex plan fix: extract so the two can never drift). Anchored at this
// audit's own run, domain + wcagLevel matched, B2 ordering.
async function selectAuditPair(siteAuditId: string): Promise<SelectedPair | null> {
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'ada-audit' } },
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
  return { runId: run.id, previous }
}

interface RefsAndPages {
  cur: InstanceRef[]
  prev: InstanceRef[]
  curPages: Set<string>
  prevPages: Set<string>
}

async function loadRefsAndPages(currentRunId: string, previousRunId: string): Promise<RefsAndPages> {
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
  return {
    cur: refs(curFindings),
    prev: refs(prevFindings),
    curPages: new Set(completePages.filter((p) => p.runId === currentRunId).map((p) => p.url)),
    prevPages: new Set(completePages.filter((p) => p.runId === previousRunId).map((p) => p.url)),
  }
}

async function loadAndDiff(currentRunId: string, previousRunId: string): Promise<InstanceDiff> {
  const { cur, prev, curPages, prevPages } = await loadRefsAndPages(currentRunId, previousRunId)
  return diffInstances(cur, prev, curPages, prevPages)
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

function previousStamp(previous: SelectedPair['previous']) {
  return {
    runId: previous.id,
    siteAuditId: previous.siteAuditId,
    completedAt: previous.completedAt?.toISOString() ?? null,
  }
}

/** Results-page entry: anchored at this audit's own run (not the latest). */
export async function getSiteAuditInstanceDiff(siteAuditId: string): Promise<SiteAuditDiffResult | null> {
  const pair = await selectAuditPair(siteAuditId)
  if (!pair) return null
  const diff = await loadAndDiff(pair.runId, pair.previous.id)
  return { diff, previous: previousStamp(pair.previous) }
}

/** Changes-CSV entry: same anchor + same previous selection as
 *  getSiteAuditInstanceDiff, uncapped classifier. */
export async function getSiteAuditInstanceDiffDetailed(
  siteAuditId: string,
): Promise<SiteAuditDiffDetailedResult | null> {
  const pair = await selectAuditPair(siteAuditId)
  if (!pair) return null
  const { cur, prev, curPages, prevPages } = await loadRefsAndPages(pair.runId, pair.previous.id)
  return {
    detailed: diffInstancesDetailed(cur, prev, curPages, prevPages),
    previous: previousStamp(pair.previous),
  }
}
