// lib/scoring/ada-v4-inputs.server.ts
//
// Builds AdaV4Inputs (lib/scoring/ada-v4.ts) from the findings tables for an
// ALREADY-PERSISTED CrawlRun. Server-only (imports prisma) — the `.server`
// suffix marks it non-client-safe; the pure scorer stays importable in the
// browser for the PR3 Score Lab. This module is extracted now (Codex plan-fix
// #5) so PR3 can reuse it verbatim, and so Task 6's read-only replay script
// (scripts/score-replay.ts) can recompute v4 scores from tables without
// touching the original blob/mapper path.
//
// null ONLY when the run has zero SCORED pages (CrawlPage.score !== null) —
// a clean run with pages but no Finding rows is still scoreable and returns
// `rules: []`, never null. A page with score:null (errored/redirected/
// unreadable blob at write time) is excluded from pagesAudited exactly as
// the mapper excludes it from scoring — see lib/findings/ada-mapper.ts.
import { prisma } from '@/lib/db'
import { isAdvisory } from '@/lib/ada-audit/scoring-v2'
import type { AdaV4Inputs, AdaV4RuleInput } from './ada-v4'

const KNOWN_IMPACTS = new Set(['critical', 'serious', 'moderate', 'minor', 'unknown'])

function normalizeImpact(impact: string): AdaV4RuleInput['impact'] {
  return (KNOWN_IMPACTS.has(impact) ? impact : 'unknown') as AdaV4RuleInput['impact']
}

interface RuleAgg {
  impact: AdaV4RuleInput['impact']
  advisory: boolean
  pages: Set<string>
}

export async function loadAdaV4InputsForRun(runId: string): Promise<AdaV4Inputs | null> {
  const run = await prisma.crawlRun.findUnique({
    where: { id: runId },
    select: { siteAudit: { select: { pagesTotal: true } } },
  })

  const pages = await prisma.crawlPage.findMany({
    where: { runId },
    select: { id: true, score: true, incompleteCount: true, adaAuditId: true },
  })
  const scoredPages = pages.filter((p) => p.score !== null)
  if (scoredPages.length === 0) return null

  const meanIncomplete = scoredPages.reduce((sum, p) => sum + (p.incompleteCount ?? 0), 0) / scoredPages.length

  // Page-scope Finding rows carry the axe ruleId as `type`; every one has
  // exactly one joined Violation (impact/wcagTags live there). Querying
  // Violation directly, scoped to page-scope findings, is equivalent to the
  // Finding-join-Violation the brief describes and avoids a second round trip.
  const violations = await prisma.violation.findMany({
    where: { runId, finding: { scope: 'page' } },
    select: { pageId: true, ruleId: true, impact: true, wcagTags: true },
  })

  // Mirror mapAdaChildren's first-seen semantics: children are walked in
  // (createdAt asc, id asc) order, so rank each page by its source AdaAudit
  // rather than by Violation.id (a mapper-generated randomUUID with no
  // relationship to source order). Pages whose child row is gone (SetNull
  // after audit deletion) sort last, deterministically by page id.
  const childIds = [...new Set(pages.map((p) => p.adaAuditId).filter((x): x is string => x !== null))]
  const children = childIds.length
    ? await prisma.adaAudit.findMany({
        where: { id: { in: childIds } },
        select: { id: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : []
  const childRank = new Map(children.map((c, i) => [c.id, i]))
  const pageRank = new Map(pages.map((p) => [
    p.id,
    p.adaAuditId !== null && childRank.has(p.adaAuditId) ? childRank.get(p.adaAuditId)! : Number.MAX_SAFE_INTEGER,
  ]))
  violations.sort((a, b) =>
    (pageRank.get(a.pageId) ?? Number.MAX_SAFE_INTEGER) - (pageRank.get(b.pageId) ?? Number.MAX_SAFE_INTEGER) ||
    a.pageId.localeCompare(b.pageId) || a.ruleId.localeCompare(b.ruleId))

  const byRule = new Map<string, RuleAgg>()
  for (const v of violations) {
    const impact = normalizeImpact(v.impact)
    let agg = byRule.get(v.ruleId)
    if (!agg) {
      let wcagTags: string[] = []
      try {
        const parsed = JSON.parse(v.wcagTags)
        if (Array.isArray(parsed)) wcagTags = parsed
      } catch {
        // malformed wcagTags → treat as no tags (never advisory-only)
      }
      agg = { impact, advisory: isAdvisory(wcagTags), pages: new Set() }
      byRule.set(v.ruleId, agg)
    } else if (agg.impact === 'unknown' && impact !== 'unknown') {
      // First-non-null-seen — mirrors the site-wide aggregation in
      // lib/findings/ada-mapper.ts so replay scores match the mapper exactly.
      agg.impact = impact
    }
    agg.pages.add(v.pageId)
  }

  const rules: AdaV4RuleInput[] = [...byRule.entries()].map(([ruleId, agg]) => ({
    ruleId, impact: agg.impact, advisory: agg.advisory, pagesAffected: agg.pages.size,
  }))

  return {
    pagesAudited: scoredPages.length,
    // Naturally null for standalone (`source: 'page-audit'`) runs — those
    // have no siteAuditId, so the relation is absent regardless of source.
    pagesTotal: run?.siteAudit?.pagesTotal ?? null,
    meanIncomplete,
    rules,
  }
}
