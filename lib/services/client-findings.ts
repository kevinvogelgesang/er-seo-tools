// lib/services/client-findings.ts
//
// B2 read service: one client's open findings (latest runs per tool) with
// type-level run-over-run trends. Reads CrawlRun/Finding/Violation + scalar
// session columns ONLY — never origin blobs (A2 retention invariant).

import { prisma } from '@/lib/db'
import {
  aggregateAdaTypes, aggregateSeoTypes, diffTypes, selectRuns,
  SEVERITY_RANK, URLS_PER_FINDING,
  type RunRef, type Severity, type TypeAggregate, type TypeDiff,
} from './findings-shared'

export interface OpenFindingRow {
  tool: 'seo' | 'ada'
  type: string
  severity: Severity
  count: number
  countDelta: number | null
  isNew: boolean
  description: string | null
  helpUrl: string | null
  urls: string[]
  totalUrls: number
  isSample: boolean
  href: string | null
}

export interface SourceRunMeta {
  runAt: string
  href: string | null
  domain: string | null
  hasPrevious: boolean
  newTypeCount: number
  resolvedTypeCount: number
}

export interface ClientFindings {
  rows: OpenFindingRow[]
  seo: SourceRunMeta | null
  ada: (SourceRunMeta & { sourceClass: 'site' | 'page' }) | null
}

function parseDescription(detail: string | null): string | null {
  if (!detail) return null
  try {
    const obj = JSON.parse(detail)
    return typeof obj?.description === 'string' && obj.description ? obj.description : null
  } catch {
    return null
  }
}

function runHref(run: RunRef): string | null {
  if (run.tool === 'seo-parser') return run.sessionId ? `/seo-parser/results/${run.sessionId}` : null
  if (run.source === 'site-audit') return run.siteAuditId ? `/ada-audit/site/${run.siteAuditId}` : null
  return run.adaAuditId ? `/ada-audit/${run.adaAuditId}` : null
}

function meta(run: RunRef, diff: TypeDiff, hasPrevious: boolean): SourceRunMeta {
  return {
    runAt: (run.completedAt ?? run.createdAt).toISOString(),
    href: runHref(run),
    domain: run.domain,
    hasPrevious,
    newTypeCount: diff.newTypes.size,
    resolvedTypeCount: diff.resolvedCount,
  }
}

function buildRows(args: {
  tool: 'seo' | 'ada'
  aggregates: TypeAggregate[]
  diff: TypeDiff
  hasPrevious: boolean
  urlsByType: Map<string, string[]>
  descriptions: Map<string, { description: string | null; helpUrl: string | null }>
  sampleByType: Map<string, boolean>
  href: string | null
}): OpenFindingRow[] {
  return args.aggregates.map((a) => {
    // Deterministic visible sample (Codex plan-fix #3): dedupe + sort before the cap.
    const urls = [...new Set(args.urlsByType.get(a.type) ?? [])].sort()
    const d = args.descriptions.get(a.type)
    return {
      tool: args.tool,
      type: a.type,
      severity: a.severity,
      count: a.count,
      countDelta: args.hasPrevious ? (args.diff.countDelta.get(a.type) ?? null) : null,
      isNew: args.hasPrevious && args.diff.newTypes.has(a.type),
      description: d?.description ?? null,
      helpUrl: d?.helpUrl ?? null,
      urls: urls.slice(0, URLS_PER_FINDING),
      totalUrls: urls.length,
      isSample: args.sampleByType.get(a.type) ?? false,
      href: args.href,
    }
  })
}

export async function getClientFindings(clientId: number): Promise<ClientFindings> {
  const [sessions, crawlRuns] = await Promise.all([
    prisma.session.findMany({ where: { clientId }, select: { id: true, workflow: true } }),
    prisma.crawlRun.findMany({
      where: { clientId },
      select: {
        id: true, tool: true, source: true, domain: true, completedAt: true, createdAt: true,
        sessionId: true, siteAuditId: true, adaAuditId: true,
      },
    }),
  ])
  const keywordSessionIds = new Set(sessions.filter((s) => s.workflow === 'keyword-research').map((s) => s.id))
  const sel = selectRuns(crawlRuns, keywordSessionIds)

  const currentIds = [sel.seo.current?.id, sel.ada.current?.id].filter((x): x is string => !!x)
  if (currentIds.length === 0) return { rows: [], seo: null, ada: null }

  const [currentFindings, prevSeoRows, prevAdaGroups, adaHelp] = await Promise.all([
    prisma.finding.findMany({
      where: { runId: { in: currentIds } },
      select: {
        runId: true, scope: true, type: true, severity: true, url: true,
        count: true, detail: true, affectedComplete: true,
      },
    }),
    sel.seo.previous
      ? prisma.finding.findMany({
          where: { runId: sel.seo.previous.id, scope: 'run' },
          select: { type: true, count: true },
        })
      : Promise.resolve(null),
    // Previous-run shape is type+count only — severity intentionally absent
    // (Codex fix #4). Scope guard (Codex plan-fix #1): ADA findings are
    // page-scope today, but future run-scope rows must never pollute the
    // diff baseline.
    sel.ada.previous
      ? prisma.finding.groupBy({
          by: ['type'],
          where: { runId: sel.ada.previous.id, scope: 'page' },
          _count: { _all: true },
        })
      : Promise.resolve(null),
    sel.ada.current
      ? prisma.violation.findMany({
          where: { runId: sel.ada.current.id },
          select: { ruleId: true, help: true, helpUrl: true },
          distinct: ['ruleId'],
        })
      : Promise.resolve([]),
  ])

  const rows: OpenFindingRow[] = []
  let seoMeta: SourceRunMeta | null = null
  let adaMeta: (SourceRunMeta & { sourceClass: 'site' | 'page' }) | null = null

  if (sel.seo.current) {
    const cur = sel.seo.current
    const mine = currentFindings.filter((f) => f.runId === cur.id)
    const runScope = mine.filter((f) => f.scope === 'run')
    const pageScope = mine.filter((f) => f.scope === 'page' && f.url !== null)
    const aggregates = aggregateSeoTypes(runScope)
    const diff = diffTypes(aggregates, prevSeoRows)
    const urlsByType = new Map<string, string[]>()
    for (const p of pageScope) {
      const list = urlsByType.get(p.type) ?? []
      list.push(p.url as string)
      urlsByType.set(p.type, list)
    }
    const descriptions = new Map(runScope.map((f) => [f.type, { description: parseDescription(f.detail), helpUrl: null }]))
    // Three-state completeness (Codex fix #2): only explicit true is complete.
    const sampleByType = new Map(runScope.map((f) => [f.type, f.affectedComplete !== true]))
    rows.push(...buildRows({
      tool: 'seo', aggregates, diff, hasPrevious: sel.seo.previous !== null,
      urlsByType, descriptions, sampleByType, href: runHref(cur),
    }))
    seoMeta = meta(cur, diff, sel.seo.previous !== null)
  }

  if (sel.ada.current && sel.ada.sourceClass) {
    const cur = sel.ada.current
    const pageScope = currentFindings.filter((f) => f.runId === cur.id && f.scope === 'page')
    const aggregates = aggregateAdaTypes(pageScope)
    const prev = prevAdaGroups ? prevAdaGroups.map((g) => ({ type: g.type, count: g._count._all })) : null
    const diff = diffTypes(aggregates, prev)
    const urlsByType = new Map<string, string[]>()
    for (const p of pageScope) {
      if (p.url === null) continue
      const list = urlsByType.get(p.type) ?? []
      list.push(p.url)
      urlsByType.set(p.type, list)
    }
    const descriptions = new Map(adaHelp.map((v) => [v.ruleId, { description: v.help, helpUrl: v.helpUrl }]))
    const sampleByType = new Map<string, boolean>() // ADA URL lists are always complete
    rows.push(...buildRows({
      tool: 'ada', aggregates, diff, hasPrevious: sel.ada.previous !== null,
      urlsByType, descriptions, sampleByType, href: runHref(cur),
    }))
    adaMeta = { ...meta(cur, diff, sel.ada.previous !== null), sourceClass: sel.ada.sourceClass }
  }

  rows.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count || a.type.localeCompare(b.type),
  )

  return { rows, seo: seoMeta, ada: adaMeta }
}
