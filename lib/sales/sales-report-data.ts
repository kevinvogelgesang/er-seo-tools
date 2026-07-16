// C14: THE single server-side loader for the public sales view. All curation
// happens here — the token never grants access beyond what this module chose.
import { prisma } from '@/lib/db'
import { buildSummaryFromFindings } from '@/lib/ada-audit/findings-fallback'
import type { CommonIssue, ImpactLevel, SiteAuditSummary } from '@/lib/ada-audit/types'
import type { LighthouseSummary } from '@/lib/ada-audit/lighthouse-types'
import { aggregatePerformance, pickHomepageCwv, type HomepageCwv, type PerformanceRollup } from './cwv-aggregate'
import { loadRepresentativeExamples } from './representative-examples'
import { HIGH_VALUE_SCHEMA_TYPES, ISSUE_LABELS, standardLabel } from './copy'
import type { SchemaTypesSummary } from '@/lib/ada-audit/seo/schema-types'
import { isPlaceholderRun } from '@/lib/findings/exhausted-placeholder'

const MAX_PATTERNS = 4
const MAX_EXAMPLE_PAGES = 5
const MAX_ISSUE_TYPES = 6
const IMPACT_RANK: Record<ImpactLevel, number> = { critical: 3, serious: 2, moderate: 1, minor: 0 }

/** A generic accessibility-issue TYPE surfaced to the prospect: the axe rule's
 *  plain-English description + severity + how widespread it is — never the
 *  site-specific element/selector/page instances. */
export interface AccessibilityIssueType {
  ruleId: string
  help: string
  impact: ImpactLevel
  affectedPages: number
}

export interface SeoIssueGroup {
  type: string
  label: string
  count: number            // issue-specific unit (targets / groups / pages) — label copy only, NEVER the bar
  affectedPages: number    // distinct page-scope finding URLs — drives UrgencyBar (spec Codex fix 4)
  affectedComplete: boolean // false ⇒ render "at least N pages"
  examplePages: string[]
}

export interface SalesReportData {
  prospect: { id: number; name: string; domain: string }
  auditId: string
  completedAt: string | null
  pagesTotal: number | null
  preparedBy: string | null
  archived: boolean
  overallScore: number | null          // rounded avg of available headline values
  heroScreenshot: boolean              // view builds /api/sales/[token]/hero/[auditId]
  standardTested: string               // "WCAG 2.1 AA" | "WCAG 2.2 AA + best practices"
  // Task 4 (verifier-memory-loop fix): true when the only seo-parser run is
  // an exhausted-verifier terminal placeholder — SEO analysis never
  // completed for this scan. Accessibility/performance/schema are unaffected.
  seoUnavailable: boolean
  headline: {
    accessibilityScore: number | null
    seoScore: number | null
    performanceScore: number | null
    schemaCoveragePct: number | null
  }
  accessibility: {
    score: number | null
    counts: { critical: number; serious: number; moderate: number; minor: number; total: number }
    issueTypes: AccessibilityIssueType[] // generic rule descriptions, no site-specific instances
  }
  seo: {
    score: number | null
    issueGroups: SeoIssueGroup[]
    duplicateContentGroups: number | null
    sitemapMissRatePct: number | null
  }
  performance: { rollup: PerformanceRollup | null; homepage: HomepageCwv | null } // homepage independent of the rollup's <3-pages null
  geo: {
    coveragePct: number | null
    pagesWithSchema: number | null
    observedPages: number | null
    types: { type: string; pages: number }[]
    missingHighValueTypes: string[]
    hreflangIssueCount: number
  }
}

export type SalesReportResult =
  | { kind: 'invalid' }
  | { kind: 'pending'; prospect: { name: string; domain: string } }
  | { kind: 'ready'; data: SalesReportData }

export async function validateSalesToken(
  token: string,
): Promise<{ id: number; name: string; domain: string; createdBy: string | null } | null> {
  if (!token) return null
  const prospect = await prisma.prospect.findUnique({
    where: { salesToken: token },
    select: { id: true, name: true, domain: true, createdBy: true, salesTokenExpiresAt: true },
  })
  if (!prospect || !prospect.salesTokenExpiresAt || prospect.salesTokenExpiresAt <= new Date()) return null
  return { id: prospect.id, name: prospect.name, domain: prospect.domain, createdBy: prospect.createdBy }
}

/**
 * Task 10's screenshot route: the set of `${adaAuditId}/${filename}` keys the
 * curated report for the URL's PINNED audit actually renders (Codex plan-review
 * fix #2 — ownership alone would expose any guessed screenshot under the
 * prospect's child audits; the token authorizes ONLY what the loader curated).
 * Pinned: resolved from the URL's child audit → its parent SiteAudit, NOT
 * re-resolved to "latest", so an open report keeps loading after a re-scan.
 */
export async function curatedScreenshotSet(prospectId: number, adaAuditId: string): Promise<Set<string>> {
  const child = await prisma.adaAudit.findUnique({
    where: { id: adaAuditId },
    select: { siteAudit: { select: { id: true, prospectId: true, summary: true } } },
  })
  if (!child?.siteAudit || child.siteAudit.prospectId !== prospectId) return new Set()

  let summary = parseJson<SiteAuditSummary>(child.siteAudit.summary)
  if (!summary) summary = await buildSummaryFromFindings(child.siteAudit.id)
  const set = new Set<string>()
  for (const issue of topPatternIssues(summary)) {
    for (const ex of await loadRepresentativeExamples(child.siteAudit.id, issue)) {
      if (ex.screenshotFile && ex.adaAuditId) set.add(`${ex.adaAuditId}/${ex.screenshotFile}`)
    }
  }
  return set
}

/** Shared pattern-selection rule: loader and screenshot allowlist MUST agree. */
function topPatternIssues(summary: SiteAuditSummary | null): CommonIssue[] {
  return [...(summary?.commonIssues ?? [])]
    .sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || b.affectedPagesCount - a.affectedPagesCount)
    .slice(0, MAX_PATTERNS)
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function loadSalesReportData(token: string): Promise<SalesReportResult> {
  const prospect = await validateSalesToken(token)
  if (!prospect) return { kind: 'invalid' }

  // Latest REPORTABLE audit: complete AND live-scan run exists (spec Codex fix #4 —
  // the finalizer flips complete before the verifier writes the SEO run).
  const audits = await prisma.siteAudit.findMany({
    where: { prospectId: prospect.id, status: 'complete', seoOnly: false },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true, completedAt: true, pagesTotal: true, wcagLevel: true, summary: true,
      domain: true, homepageScreenshot: true,
      crawlRuns: {
        select: {
          id: true, tool: true, source: true, score: true,
          schemaTypesJson: true, contentSimilarityJson: true, discoveryCoverageJson: true,
          findings: { select: { scope: true, type: true, count: true, url: true, affectedComplete: true } },
        },
      },
    },
  })
  const audit = audits.find((a) => a.crawlRuns.some((r) => r.tool === 'seo-parser'))
  if (!audit) return { kind: 'pending', prospect: { name: prospect.name, domain: prospect.domain } }

  const adaRun = audit.crawlRuns.find((r) => r.tool === 'ada-audit') ?? null
  const seoRun = audit.crawlRuns.find((r) => r.tool === 'seo-parser')!
  // Task 4: an exhausted verifier's terminal placeholder run still satisfies
  // the REPORTABLE resolution above (has a seo-parser run) — pinned decision,
  // never "being prepared" forever — but must not be presented as real SEO
  // analysis. score/findings/schema/similarity/coverage all read as absent
  // off the placeholder row (it carries none of them), so this flag is what
  // the UI needs to render an explicit "unavailable" note instead of silent zeros.
  const seoUnavailable = isPlaceholderRun(seoRun)

  // Accessibility: summary blob, findings-fallback when pruned.
  let summary = parseJson<SiteAuditSummary>(audit.summary)
  let archived = false
  if (!summary) {
    summary = await buildSummaryFromFindings(audit.id)
    archived = true
  }
  const counts = summary
    ? {
        critical: summary.aggregate.critical, serious: summary.aggregate.serious,
        moderate: summary.aggregate.moderate, minor: summary.aggregate.minor, total: summary.aggregate.total,
      }
    : { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0 }

  // Generic issue TYPES (axe rule descriptions) — what kinds of barriers were
  // found, by severity, without naming the specific elements/pages. Sourced
  // from the site-wide common-issue patterns; most-severe + most-widespread
  // first. Empty for older summaries that predate commonIssues.
  const issueTypes: AccessibilityIssueType[] = [...(summary?.commonIssues ?? [])]
    .sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || b.affectedPagesCount - a.affectedPagesCount)
    .slice(0, MAX_ISSUE_TYPES)
    .map((ci) => ({ ruleId: ci.ruleId, help: ci.help, impact: ci.impact, affectedPages: ci.affectedPagesCount }))

  // SEO groups from live-scan findings: run-scope count + page-scope example URLs.
  const issueGroups: SeoIssueGroup[] = []
  for (const type of Object.keys(ISSUE_LABELS)) {
    const runFinding = seoRun.findings.find((f) => f.scope === 'run' && f.type === type)
    if (!runFinding || runFinding.count === 0) continue
    const pageRows = seoRun.findings.filter((f) => f.scope === 'page' && f.type === type && f.url)
    issueGroups.push({
      type,
      label: ISSUE_LABELS[type],
      count: runFinding.count,
      // Spec Codex fix 4: count semantics are heterogeneous (targets/groups) —
      // only affectedPages (distinct page-scope URLs) may drive an urgency bar.
      affectedPages: new Set(pageRows.map((f) => f.url as string)).size,
      affectedComplete: runFinding.affectedComplete !== false, // null (unset) treated complete; live-scan mappers always set it
      examplePages: pageRows.slice(0, MAX_EXAMPLE_PAGES).map((f) => f.url as string),
    })
  }
  // Real shape (Codex plan-review fix #3): { v, exactDuplicateGroups, nearDuplicateGroups }.
  // Task 8 (memory fix stage B2): a budget-capped similarity pass persists a
  // non-null STUB { v, unavailable: true, ... } instead of a bare null — that is
  // "not measured", never "0 groups", so gate the arithmetic on !unavailable
  // (field absent on real/legacy payloads → measured path unchanged).
  const similarity = parseJson<{ unavailable?: boolean; exactDuplicateGroups?: unknown[]; nearDuplicateGroups?: unknown[] }>(
    seoRun.contentSimilarityJson,
  )
  const duplicateContentGroups = similarity && !similarity.unavailable
    ? (similarity.exactDuplicateGroups?.length ?? 0) + (similarity.nearDuplicateGroups?.length ?? 0)
    : null
  const coverage = parseJson<{ applicable?: boolean; missRate?: number }>(seoRun.discoveryCoverageJson)

  // Performance: per-page Lighthouse summaries off the child rows.
  const children = await prisma.adaAudit.findMany({
    where: { siteAuditId: audit.id, lighthouseSummary: { not: null } },
    select: { id: true, url: true, lighthouseSummary: true },
  })
  const lhRows = children
    .map((c) => ({ url: c.url, id: c.id, summary: parseJson<LighthouseSummary>(c.lighthouseSummary) }))
    .filter((r): r is { url: string; id: string; summary: LighthouseSummary } => r.summary !== null)
  const rollup = aggregatePerformance(lhRows)
  const homepage = pickHomepageCwv(lhRows, audit.domain)

  // GEO: schema histogram (denominators from Task 3's versioned shape).
  const schema = parseJson<SchemaTypesSummary>(seoRun.schemaTypesJson)
  const coveragePct =
    schema && schema.observedPages > 0 ? Math.round((schema.pagesWithSchema / schema.observedPages) * 100) : null
  const presentTypes = new Set((schema?.types ?? []).map((t) => t.type))
  const hreflangIssueCount = seoRun.findings
    .filter((f) => f.scope === 'run' && f.type.startsWith('hreflang_'))
    .reduce((sum, f) => sum + f.count, 0)

  // Kevin decision: simple average of the available headline scores; null
  // metrics excluded from the denominator (never counted as zero).
  const headlineValues = [
    adaRun?.score ?? null,
    seoRun.score,
    rollup?.medianPerformance ?? null,
    coveragePct,
  ].filter((v): v is number => v !== null)
  const overallScore = headlineValues.length
    ? Math.round(headlineValues.reduce((a, b) => a + b, 0) / headlineValues.length)
    : null

  return {
    kind: 'ready',
    data: {
      prospect: { id: prospect.id, name: prospect.name, domain: prospect.domain },
      auditId: audit.id,
      completedAt: audit.completedAt?.toISOString() ?? null,
      pagesTotal: audit.pagesTotal,
      preparedBy: prospect.createdBy,
      archived,
      overallScore,
      heroScreenshot: audit.homepageScreenshot !== null,
      standardTested: standardLabel(audit.wcagLevel),
      seoUnavailable,
      headline: {
        accessibilityScore: adaRun?.score ?? null,
        seoScore: seoRun.score,
        performanceScore: rollup?.medianPerformance ?? null,
        schemaCoveragePct: coveragePct,
      },
      accessibility: { score: adaRun?.score ?? null, counts, issueTypes },
      seo: {
        score: seoRun.score,
        issueGroups,
        duplicateContentGroups,
        sitemapMissRatePct: coverage?.applicable && typeof coverage.missRate === 'number'
          ? Math.round(coverage.missRate * 100)
          : null,
      },
      performance: { rollup, homepage },
      geo: {
        coveragePct,
        pagesWithSchema: schema?.pagesWithSchema ?? null,
        observedPages: schema?.observedPages ?? null,
        types: schema?.types ?? [],
        missingHighValueTypes: HIGH_VALUE_SCHEMA_TYPES.filter((t) => !presentTypes.has(t)),
        hreflangIssueCount,
      },
    },
  }
}
