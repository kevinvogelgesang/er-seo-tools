// lib/findings/ada-mapper.ts
//
// Pure mappers: ADA audit rows (+ their axe result blobs) → FindingsBundle.
// No DB access. Scores are COMPUTED here, never read from scalar columns —
// AdaAudit.score / SiteAudit.score are not reliably persisted (the list and
// detail routes compute them dynamically from blobs today). Scoring is v4
// (C19, see lib/scoring/ada-v4.ts — v2/v3 density model in
// lib/ada-audit/scoring-v2.ts is frozen for history, `isAdvisory` still
// shared from there):
//   - page score: computeAdaScoreV4 with pagesAudited:1, prevalence-1 rules
//     built from that page's own violations
//   - site-run score: computeAdaScoreV4 over the SITE-WIDE per-rule
//     prevalence aggregated across all scored pages (NOT a mean of page
//     scores)
//   - run.scoreBreakdown: serialized AdaV4Breakdown (version 4) + weightsHash
import { randomUUID } from 'crypto'
import type { AxeNode, AxeViolation, ImpactLevel, StoredAxeResults } from '@/lib/ada-audit/types'
import { isAdvisory } from '@/lib/ada-audit/scoring-v2'
import {
  computeAdaScoreV4, DEFAULT_ADA_V4_WEIGHTS, serializeAdaV4Breakdown,
  type AdaV4Weights, type AdaV4RuleInput,
} from '@/lib/scoring/ada-v4'
import { hashWeights } from '@/lib/scoring/weights-hash'
import { normalizeHost } from '@/lib/services/normalize-host'
import { normalizeFindingUrl, pageFindingKey } from './keys'
import type { CrawlPageInput, FindingInput, FindingsBundle, ViolationInput } from './types'

/** Parent fields the site mapper needs — the finalizer's widened select. */
export interface AdaSiteParent {
  id: string
  domain: string
  clientId: number | null
  wcagLevel: string
  pagesError: number
  startedAt: Date | null
  completedAt: Date | null
  /** The ORIGIN SiteAudit.pagesTotal (the audit universe) — used as the v4
   *  site-score `pagesTotal` input so low-coverage audits (missing/errored/
   *  duplicate rows) surface `lowCoverage` correctly. Optional/nullable:
   *  falls back to the deduped `pages.length` when absent. NOT the same
   *  thing as `CrawlRun.pagesTotal`, which always keeps pages.length. */
  pagesTotal?: number | null
}

/** Child fields the site mapper needs — a structural subset of the
 *  finalizer's already-loaded AdaAudit rows. Callers MUST load children in
 *  deterministic order (createdAt asc, id asc): the keep-first URL dedupe
 *  below must keep the same child in the finalizer, the rebuild path, and
 *  parity. */
export interface AdaChildInput {
  id: string
  url: string
  status: string // 'complete' | 'error' | 'redirected' at finalize time
  error: string | null
  finalUrl: string | null
  result: string | null
}

/** Standalone audit fields mapAdaSingle needs. */
export interface AdaSingleInput {
  id: string
  url: string
  status: string // 'complete' | 'redirected'
  result: string | null
  finalUrl: string | null
  wcagLevel: string
  clientId: number | null
  startedAt: Date | null
  completedAt: Date | null
}

/** ADA → canonical severity: critical/serious → critical, moderate →
 *  warning, minor → notice. Null impact (rare axe rules without impact
 *  metadata) → notice. */
export function mapImpactToSeverity(impact: ImpactLevel | null): 'critical' | 'warning' | 'notice' {
  switch (impact) {
    case 'critical':
    case 'serious':
      return 'critical'
    case 'moderate':
      return 'warning'
    default:
      return 'notice'
  }
}

const NODE_CAP = 5
const NODE_HTML_CAP = 300

function capNodes(nodes: AxeNode[]): string | null {
  if (!nodes.length) return null
  return JSON.stringify(
    nodes.slice(0, NODE_CAP).map((n) => ({
      html: typeof n.html === 'string' ? n.html.slice(0, NODE_HTML_CAP) : '',
      target: n.target ?? [],
    })),
  )
}

interface ParsedAxe {
  violations: AxeViolation[]
  passCount: number
  incompleteCount: number
  domElementCount: number | null
}

/** null = blob missing/malformed (≠ a valid empty violations array): the
 *  page must NOT be scored — score 100 from an unreadable blob would lie. */
function parseAxe(result: string | null): ParsedAxe | null {
  if (!result) return null
  try {
    const r = JSON.parse(result) as StoredAxeResults
    if (!Array.isArray(r?.violations)) return null
    return {
      violations: r.violations,
      // C13: post-fix blobs store the passCount scalar (passes trimmed
      // in-page); pre-fix full-array blobs count the array; stripped legacy
      // blobs have neither → 0 (matches their already-stored relational rows).
      passCount: typeof r.passCount === 'number' ? r.passCount : (Array.isArray(r.passes) ? r.passes.length : 0),
      incompleteCount: Array.isArray(r.incomplete) ? r.incomplete.length : 0,
      domElementCount: typeof r.domElementCount === 'number' ? r.domElementCount : null,
    }
  } catch {
    return null
  }
}

/** Shared per-page finding/violation emission. Mutates the bundle arrays;
 *  dedup is defensive (axe emits one entry per rule, but the
 *  @@unique([runId, dedupKey]) constraint must never see a duplicate). */
function emitPageViolations(
  runId: string,
  page: CrawlPageInput,
  axeViolations: AxeViolation[],
  seenKeys: Set<string>,
  findings: FindingInput[],
  violations: ViolationInput[],
): void {
  for (const v of axeViolations) {
    const dedupKey = pageFindingKey(v.id, page.url)
    if (seenKeys.has(dedupKey)) continue
    seenKeys.add(dedupKey)

    const impact = v.impact ?? 'unknown'

    const findingId = randomUUID()
    findings.push({
      id: findingId,
      runId,
      pageId: page.id,
      scope: 'page',
      type: v.id,
      severity: mapImpactToSeverity(v.impact),
      url: page.url,
      count: 1,
      affectedComplete: null,
      affectedSource: null,
      detail: null,
      dedupKey,
    })
    violations.push({
      id: randomUUID(),
      findingId,
      runId,
      pageId: page.id,
      ruleId: v.id,
      // Exact axe impact; 'unknown' sentinel for null (column is non-null,
      // and coalescing to 'minor' would falsify aggregate-vs-summary parity).
      impact,
      wcagTags: JSON.stringify(v.tags ?? []),
      help: v.help ?? null,
      helpUrl: v.helpUrl ?? null,
      nodeCount: v.nodeCount ?? v.nodes?.length ?? 0,
      nodes: capNodes(v.nodes ?? []),
    })
  }
}

/** Per-ruleId site-wide aggregation, built across the whole child walk. */
interface RuleAgg {
  impact: AdaV4RuleInput['impact']
  advisory: boolean
  pages: Set<string>
}

/** Dedupes a page's own violations by ruleId (one prevalence-1 rule input
 *  per distinct rule on that page — a defensively-duplicated axe entry for
 *  the same rule must not double-count in that page's own score). */
function pageV4Rules(violations: AxeViolation[]): AdaV4RuleInput[] {
  const byRule = new Map<string, { impact: AdaV4RuleInput['impact']; advisory: boolean }>()
  for (const v of violations) {
    if (byRule.has(v.id)) continue
    byRule.set(v.id, { impact: v.impact ?? 'unknown', advisory: isAdvisory(v.tags ?? []) })
  }
  return [...byRule.entries()].map(([ruleId, r]) => (
    { ruleId, impact: r.impact, advisory: r.advisory, pagesAffected: 1 }
  ))
}

export function mapAdaChildren(
  parent: AdaSiteParent,
  children: AdaChildInput[],
  weights: AdaV4Weights = DEFAULT_ADA_V4_WEIGHTS,
): FindingsBundle {
  const runId = randomUUID()
  const pages: CrawlPageInput[] = []
  const findings: FindingInput[] = []
  const violations: ViolationInput[] = []
  const seenUrls = new Set<string>()
  const seenKeys = new Set<string>()
  const ruleAgg = new Map<string, RuleAgg>()
  const scoredPageIds: string[] = []
  let incompleteSum = 0

  for (const child of children) {
    const url = normalizeFindingUrl(child.url)
    // Keep-first dedupe by normalized URL, same as the SEO mapper (PR #56):
    // @@unique([runId, url]) would reject the bundle otherwise.
    if (seenUrls.has(url)) continue
    seenUrls.add(url)

    const pageId = randomUUID()
    // parseAxe returns null for a missing/malformed blob (≠ a valid empty
    // violations array) — those pages are excluded from pagesAudited, not
    // silently scored as clean.
    const axe = child.status === 'complete' ? parseAxe(child.result) : null

    let pageScore: number | null = null
    if (axe) {
      for (const v of axe.violations) {
        const impact = v.impact ?? 'unknown'
        const agg = ruleAgg.get(v.id)
        if (agg) {
          agg.pages.add(pageId)
          // "first non-null seen" — an early null-impact occurrence must not
          // permanently pin the rule to 'unknown' once a real impact shows up.
          if (agg.impact === 'unknown' && impact !== 'unknown') agg.impact = impact
        } else {
          ruleAgg.set(v.id, { impact, advisory: isAdvisory(v.tags ?? []), pages: new Set([pageId]) })
        }
      }
      pageScore = computeAdaScoreV4({
        pagesAudited: 1,
        pagesTotal: null,
        meanIncomplete: axe.incompleteCount,
        rules: pageV4Rules(axe.violations),
      }, weights).score
      scoredPageIds.push(pageId)
      incompleteSum += axe.incompleteCount
    }

    const page: CrawlPageInput = {
      id: pageId,
      runId,
      url,
      status: child.status,
      error: child.error,
      finalUrl: child.finalUrl,
      statusCode: null,
      title: null,
      h1: null,
      metaDescription: null,
      wordCount: null,
      crawlDepth: null,
      indexable: null,
      score: pageScore,
      passCount: axe?.passCount ?? null,
      incompleteCount: axe?.incompleteCount ?? null,
      faqEvidence: null,
      adaAuditId: child.id,
    }
    pages.push(page)

    if (axe) {
      emitPageViolations(runId, page, axe.violations, seenKeys, findings, violations)
    }
  }

  // Zero scored pages (all children errored/redirected/malformed) → never
  // call the scorer (it throws on pagesAudited <= 0); the run is unscored.
  let runScore: number | null = null
  let runBreakdown: string | null = null
  if (scoredPageIds.length > 0) {
    const rules: AdaV4RuleInput[] = [...ruleAgg.entries()].map(([ruleId, a]) => (
      { ruleId, impact: a.impact, advisory: a.advisory, pagesAffected: a.pages.size }
    ))
    const { score, breakdown } = computeAdaScoreV4({
      pagesAudited: scoredPageIds.length,
      // The audit UNIVERSE (origin SiteAudit.pagesTotal), not the deduped
      // row count — a missing/duplicate/error-heavy audit must show as
      // low-coverage even though every surviving row scored cleanly.
      pagesTotal: parent.pagesTotal ?? pages.length,
      meanIncomplete: incompleteSum / scoredPageIds.length,
      rules,
    }, weights)
    runScore = score
    runBreakdown = serializeAdaV4Breakdown(breakdown, hashWeights(weights))
  }

  return {
    run: {
      id: runId,
      tool: 'ada-audit',
      source: 'site-audit',
      domain: normalizeHost(parent.domain),
      clientId: parent.clientId,
      sessionId: null,
      siteAuditId: parent.id,
      adaAuditId: null,
      status: parent.pagesError > 0 ? 'partial' : 'complete',
      // Site-level score = v4 prevalence-weighted deductions over the
      // SITE-WIDE rule aggregation (NOT a mean of per-page scores) — see
      // lib/scoring/ada-v4.ts.
      score: runScore,
      scoreBreakdown: runBreakdown,
      wcagLevel: parent.wcagLevel,
      pagesTotal: pages.length,
      startedAt: parent.startedAt,
      completedAt: parent.completedAt,
    },
    pages,
    findings,
    violations,
  }
}

export function mapAdaSingle(
  audit: AdaSingleInput,
  weights: AdaV4Weights = DEFAULT_ADA_V4_WEIGHTS,
): FindingsBundle {
  const runId = randomUUID()
  const url = normalizeFindingUrl(audit.url)
  const findings: FindingInput[] = []
  const violations: ViolationInput[] = []

  const axe = audit.status === 'complete' ? parseAxe(audit.result) : null
  let score: number | null = null
  let scoreBreakdown: string | null = null
  if (axe) {
    const { score: s, breakdown } = computeAdaScoreV4({
      pagesAudited: 1,
      pagesTotal: null,
      meanIncomplete: axe.incompleteCount,
      rules: pageV4Rules(axe.violations),
    }, weights)
    score = s
    scoreBreakdown = serializeAdaV4Breakdown(breakdown, hashWeights(weights))
  }

  const page: CrawlPageInput = {
    id: randomUUID(),
    runId,
    url,
    status: audit.status,
    error: null,
    finalUrl: audit.finalUrl,
    statusCode: null,
    title: null,
    h1: null,
    metaDescription: null,
    wordCount: null,
    crawlDepth: null,
    indexable: null,
    score,
    passCount: axe?.passCount ?? null,
    incompleteCount: axe?.incompleteCount ?? null,
    faqEvidence: null,
    adaAuditId: audit.id,
  }
  if (axe) {
    emitPageViolations(runId, page, axe.violations, new Set<string>(), findings, violations)
  }

  return {
    run: {
      id: runId,
      tool: 'ada-audit',
      source: 'page-audit',
      domain: normalizeHost(audit.url),
      clientId: audit.clientId,
      sessionId: null,
      siteAuditId: null,
      adaAuditId: audit.id,
      // A redirected standalone still completed as a run; the page row
      // carries status 'redirected'. Run status is only 'partial' for site
      // audits with errored pages.
      status: 'complete',
      score,
      scoreBreakdown,
      wcagLevel: audit.wcagLevel,
      pagesTotal: 1,
      startedAt: audit.startedAt,
      completedAt: audit.completedAt,
    },
    pages: [page],
    findings,
    violations,
  }
}
