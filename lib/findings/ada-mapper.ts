// lib/findings/ada-mapper.ts
//
// Pure mappers: ADA audit rows (+ their axe result blobs) → FindingsBundle.
// No DB access. Scores are COMPUTED here, never read from scalar columns —
// AdaAudit.score / SiteAudit.score are not reliably persisted (the list and
// detail routes compute them dynamically from blobs today):
//   - page + standalone-run score: computeScore (node-based), matching the
//     standalone list/detail display
//   - site-run score: computeScoreFromCounts (violation-count-based),
//     matching the site detail page's summary.aggregate derivation
import { randomUUID } from 'crypto'
import type { AxeNode, AxeViolation, ImpactLevel, StoredAxeResults } from '@/lib/ada-audit/types'
import { computeScore, computeScoreFromCounts } from '@/lib/ada-audit/scoring'
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
      passCount: Array.isArray(r.passes) ? r.passes.length : 0,
      incompleteCount: Array.isArray(r.incomplete) ? r.incomplete.length : 0,
    }
  } catch {
    return null
  }
}

interface ViolationCounts {
  critical: number
  serious: number
  moderate: number
  minor: number
}

/** Shared per-page finding/violation emission. Mutates the bundle arrays and
 *  count accumulator; dedup is defensive (axe emits one entry per rule, but
 *  the @@unique([runId, dedupKey]) constraint must never see a duplicate). */
function emitPageViolations(
  runId: string,
  page: CrawlPageInput,
  axeViolations: AxeViolation[],
  seenKeys: Set<string>,
  findings: FindingInput[],
  violations: ViolationInput[],
  counts: ViolationCounts,
): void {
  for (const v of axeViolations) {
    const dedupKey = pageFindingKey(v.id, page.url)
    if (seenKeys.has(dedupKey)) continue
    seenKeys.add(dedupKey)

    const impact = v.impact ?? 'unknown'
    if (impact !== 'unknown') counts[impact]++

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
      nodeCount: v.nodes?.length ?? 0,
      nodes: capNodes(v.nodes ?? []),
    })
  }
}

export function mapAdaChildren(parent: AdaSiteParent, children: AdaChildInput[]): FindingsBundle {
  const runId = randomUUID()
  const pages: CrawlPageInput[] = []
  const findings: FindingInput[] = []
  const violations: ViolationInput[] = []
  const seenUrls = new Set<string>()
  const seenKeys = new Set<string>()
  const counts: ViolationCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 }

  for (const child of children) {
    const url = normalizeFindingUrl(child.url)
    // Keep-first dedupe by normalized URL, same as the SEO mapper (PR #56):
    // @@unique([runId, url]) would reject the bundle otherwise.
    if (seenUrls.has(url)) continue
    seenUrls.add(url)

    const axe = child.status === 'complete' ? parseAxe(child.result) : null
    const page: CrawlPageInput = {
      id: randomUUID(),
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
      score: axe ? computeScore(axe.violations, parent.wcagLevel).score : null,
      passCount: axe?.passCount ?? null,
      incompleteCount: axe?.incompleteCount ?? null,
      adaAuditId: child.id,
    }
    pages.push(page)

    if (axe) {
      emitPageViolations(runId, page, axe.violations, seenKeys, findings, violations, counts)
    }
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
      // Site-level derivation the summary-based UI uses: violation counts →
      // computeScoreFromCounts. Counts cover only the violations actually
      // stored (post-dedupe), so the run row is consistent with its
      // Violation rows.
      score: computeScoreFromCounts(counts, parent.wcagLevel).score,
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

export function mapAdaSingle(audit: AdaSingleInput): FindingsBundle {
  const runId = randomUUID()
  const url = normalizeFindingUrl(audit.url)
  const findings: FindingInput[] = []
  const violations: ViolationInput[] = []
  const counts: ViolationCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 }

  const axe = audit.status === 'complete' ? parseAxe(audit.result) : null
  const score = axe ? computeScore(axe.violations, audit.wcagLevel).score : null

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
    adaAuditId: audit.id,
  }
  if (axe) {
    emitPageViolations(runId, page, axe.violations, new Set<string>(), findings, violations, counts)
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
