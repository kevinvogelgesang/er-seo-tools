// PR5 Current-Site Assessment loader (spec §8): token → viewbook → client →
// latest REPORTABLE site audit (C14 rule: complete ∧ ¬seoOnly ∧ has a
// seo-parser run), derived into a client-safe payload. Read-only; every
// failure path returns null (fault isolation — the section renders the
// "first scan coming soon" state, the page never blanks). Controlled token
// 404s from requireViewbookToken return null WITHOUT operational logging.
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { HttpError } from '@/lib/api/errors'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { isPlaceholderRun } from '@/lib/findings/exhausted-placeholder'
import { buildSummaryFromFindings } from '@/lib/ada-audit/findings-fallback'
import { aggregatePerformance, pickHomepageCwv } from '@/lib/sales/cwv-aggregate'
import type { PerformanceRollup, HomepageCwv } from '@/lib/sales/cwv-aggregate'
import { standardLabel } from '@/lib/sales/copy'
import {
  ONPAGE_FINDING_LABELS, BROKEN_FINDING_LABELS,
  ONPAGE_FINDING_TYPE_SET, BROKEN_FINDING_TYPE_SET,
} from '@/lib/findings/finding-type-sets'
import type { SiteAuditSummary } from '@/lib/ada-audit/types'
import type { LighthouseSummary } from '@/lib/ada-audit/lighthouse-types'

const MAX_ADA_PATTERNS = 4
const MAX_SEO_ISSUES = 5
const IMPACT_RANK: Record<string, number> = { critical: 3, serious: 2, moderate: 1, minor: 0 }

export interface AssessmentAdaPattern {
  help: string
  impact: string // 'critical' | 'serious' | 'moderate' | 'minor'
  affectedPagesCount: number
  totalPagesScanned: number
}

export interface AssessmentSeoIssue {
  label: string
  count: number
  unit: 'pages' | 'targets' | 'groups' // sweep snapshot.ts unit convention
}

export interface AssessmentData {
  domain: string
  completedAt: string | null // ISO
  standardTested: string // standardLabel(wcagLevel)
  pagesAudited: number // SiteAudit.pagesComplete
  adaScore: number | null // ada-audit CrawlRun.score
  seoScore: number | null // live-scan CrawlRun.score (null when unavailable)
  seoUnavailable: boolean // live-scan run is the exhausted placeholder
  adaPatterns: AssessmentAdaPattern[] // ≤4, impact-rank then affected-count
  seoIssues: AssessmentSeoIssue[] // ≤5 curated run-scope findings by count desc
  performance: PerformanceRollup | null
  homepage: HomepageCwv | null
}

function unitFor(type: string): AssessmentSeoIssue['unit'] {
  if (type.startsWith('broken_')) return 'targets'
  if (type.startsWith('duplicate_')) return 'groups'
  return 'pages'
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function loadAssessmentData(token: string): Promise<AssessmentData | null> {
  try {
    const vb = await requireViewbookToken(token)

    const audit = await prisma.siteAudit.findFirst({
      where: {
        clientId: vb.clientId,
        status: 'complete',
        seoOnly: false,
        crawlRuns: { some: { tool: 'seo-parser' } },
      },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    })
    if (!audit) return null

    const runs = await prisma.crawlRun.findMany({
      where: { siteAuditId: audit.id },
      select: {
        tool: true,
        source: true,
        score: true,
        findings: { where: { scope: 'run' }, select: { type: true, count: true } },
      },
    })
    const adaRun = runs.find((r) => r.tool === 'ada-audit') ?? null
    const seoRun = runs.find((r) => r.tool === 'seo-parser') ?? null
    const seoUnavailable = seoRun != null && isPlaceholderRun(seoRun)

    const seoIssues = seoRun && !seoUnavailable
      ? seoRun.findings
          .filter((f) => f.count > 0 && (ONPAGE_FINDING_TYPE_SET.has(f.type) || BROKEN_FINDING_TYPE_SET.has(f.type)))
          .sort((a, b) => b.count - a.count)
          .slice(0, MAX_SEO_ISSUES)
          .map((f) => ({
            label: ONPAGE_FINDING_LABELS[f.type] ?? BROKEN_FINDING_LABELS[f.type] ?? f.type,
            count: f.count,
            unit: unitFor(f.type),
          }))
      : []

    let summary = parseJson<SiteAuditSummary>(audit.summary)
    if (!summary) summary = await buildSummaryFromFindings(audit.id)
    const adaPatterns = [...(summary?.commonIssues ?? [])]
      .sort((a, b) =>
        (IMPACT_RANK[b.impact] ?? 0) - (IMPACT_RANK[a.impact] ?? 0) || b.affectedPagesCount - a.affectedPagesCount,
      )
      .slice(0, MAX_ADA_PATTERNS)
      .map((c) => ({
        help: c.help,
        impact: c.impact,
        affectedPagesCount: c.affectedPagesCount,
        totalPagesScanned: c.totalPagesScanned,
      }))

    const lhRows = (
      await prisma.adaAudit.findMany({
        where: { siteAuditId: audit.id, lighthouseSummary: { not: null } },
        select: { id: true, url: true, lighthouseSummary: true },
      })
    )
      .map((r) => ({ id: r.id, url: r.url, summary: parseJson<LighthouseSummary>(r.lighthouseSummary) }))
      .filter((r): r is { id: string; url: string; summary: LighthouseSummary } => r.summary != null)

    return {
      domain: audit.domain,
      completedAt: audit.completedAt?.toISOString() ?? null,
      standardTested: standardLabel(audit.wcagLevel),
      pagesAudited: audit.pagesComplete,
      adaScore: adaRun?.score ?? null,
      seoScore: seoUnavailable ? null : seoRun?.score ?? null,
      seoUnavailable,
      adaPatterns,
      seoIssues,
      performance: aggregatePerformance(lhRows),
      homepage: pickHomepageCwv(lhRows, audit.domain),
    }
  } catch (err) {
    if (!(err instanceof HttpError)) logError({ subsystem: 'viewbook', op: 'assessment-load' }, err)
    return null
  }
}
