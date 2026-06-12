// lib/findings/parity.ts
//
// Blob-vs-tables parity for the dual-write phase. Recomputes the expected
// bundle from the archived blob with the same mapper, then diffs counts,
// identity sets, and field values against the stored rows. Used by
// scripts/findings-parity.ts against production data before any reader flips.
import type { CrawlPage, Finding, Violation } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { AggregatedResult } from '@/lib/types'
import type { SiteAuditSummary } from '@/lib/ada-audit/types'
import { mapSeoResult } from './seo-mapper'
import { mapAdaChildren, mapAdaSingle } from './ada-mapper'
import type { FindingsBundle } from './types'

export interface ParityReport {
  ok: boolean
  diffs: string[]
}

export async function compareSeoParity(sessionId: string): Promise<ParityReport> {
  const diffs: string[] = []
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { result: true, clientId: true, createdAt: true },
  })
  if (!session?.result) return { ok: false, diffs: ['session missing or result blob pruned (archived) — parity requires the blob'] }

  let blob: AggregatedResult
  try {
    blob = JSON.parse(session.result) as AggregatedResult
  } catch {
    return { ok: false, diffs: ['result blob is not valid JSON'] }
  }

  const expected = mapSeoResult(blob, {
    sessionId,
    clientId: session.clientId,
    startedAt: session.createdAt,
    completedAt: null,
  })

  const run = await prisma.crawlRun.findUnique({
    where: { sessionId },
    include: { pages: true, findings: true },
  })
  if (!run) return { ok: false, diffs: ['no CrawlRun for session'] }

  if (run.score !== expected.run.score) diffs.push(`score: tables=${run.score} blob=${expected.run.score}`)
  if (run.pagesTotal !== expected.run.pagesTotal) diffs.push(`pagesTotal: tables=${run.pagesTotal} blob=${expected.run.pagesTotal}`)
  if (run.pages.length !== expected.pages.length) diffs.push(`pages: tables=${run.pages.length} blob=${expected.pages.length}`)

  const storedUrls = new Set(run.pages.map((p) => p.url))
  for (const p of expected.pages) {
    if (!storedUrls.has(p.url)) diffs.push(`missing CrawlPage: ${p.url}`)
  }

  // Field-level finding comparison keyed by dedupKey — a stored row with
  // the right key but wrong count/severity/flags must NOT pass.
  const storedByKey = new Map(run.findings.map((f) => [f.dedupKey, f]))
  const expectedByKey = new Map(expected.findings.map((f) => [f.dedupKey, f]))
  const FIELDS = ['scope', 'type', 'severity', 'url', 'count', 'affectedComplete', 'affectedSource'] as const
  for (const [key, exp] of expectedByKey) {
    const stored = storedByKey.get(key)
    if (!stored) {
      diffs.push(`missing Finding: ${exp.scope}/${exp.type}${exp.url ? ` @ ${exp.url}` : ''}`)
      continue
    }
    for (const field of FIELDS) {
      if (stored[field] !== exp[field]) {
        diffs.push(`Finding ${exp.scope}/${exp.type}${exp.url ? ` @ ${exp.url}` : ''} ${field}: tables=${stored[field]} blob=${exp[field]}`)
      }
    }
  }
  for (const f of run.findings) {
    if (!expectedByKey.has(f.dedupKey)) diffs.push(`extra Finding: ${f.scope}/${f.type}${f.url ? ` @ ${f.url}` : ''}`)
  }

  // severity counts (run-scope rows mirror the blob's issue buckets)
  for (const severity of ['critical', 'warning', 'notice'] as const) {
    const stored = run.findings.filter((f) => f.scope === 'run' && f.severity === severity).length
    const exp = expected.findings.filter((f) => f.scope === 'run' && f.severity === severity).length
    if (stored !== exp) diffs.push(`run-scope ${severity} count: tables=${stored} blob=${exp}`)
  }

  // sampled page scalars: every expected page, compared by url
  const storedPageByUrl = new Map(run.pages.map((p) => [p.url, p]))
  for (const p of expected.pages) {
    const stored = storedPageByUrl.get(p.url)
    if (!stored) continue // already reported as missing above
    for (const field of ['title', 'h1', 'metaDescription', 'wordCount', 'crawlDepth', 'indexable'] as const) {
      if (stored[field] !== p[field]) {
        diffs.push(`CrawlPage ${p.url} ${field}: tables=${stored[field]} blob=${p[field]}`)
      }
    }
  }

  return { ok: diffs.length === 0, diffs }
}

// ── ADA parity ──────────────────────────────────────────────────────────────
//
// Same same-mapper discipline as compareSeoParity: recompute the expected
// bundle from the child/standalone blobs via the live mappers, then diff
// against the stored rows. Plus one independent cross-check for site audits:
// the aggregate scorecard recomputed from stored Violation rows must match
// summary.aggregate (the blob the UI renders) — this is the check that can
// surface real divergence the same-mapper diff cannot.

interface StoredRun {
  id: string
  status: string
  score: number | null
  wcagLevel: string | null
  pagesTotal: number
  pages: CrawlPage[]
  findings: Finding[]
  violations: Violation[]
}

function diffAdaRun(run: StoredRun, expected: FindingsBundle, diffs: string[]): void {
  if (run.status !== expected.run.status) diffs.push(`run status: tables=${run.status} blob=${expected.run.status}`)
  if (run.score !== expected.run.score) diffs.push(`score: tables=${run.score} blob=${expected.run.score}`)
  if (run.wcagLevel !== expected.run.wcagLevel) diffs.push(`wcagLevel: tables=${run.wcagLevel} blob=${expected.run.wcagLevel}`)
  if (run.pagesTotal !== expected.run.pagesTotal) diffs.push(`pagesTotal: tables=${run.pagesTotal} blob=${expected.run.pagesTotal}`)
  if (run.pages.length !== expected.pages.length) diffs.push(`pages: tables=${run.pages.length} blob=${expected.pages.length}`)

  // Pages by URL, field-level.
  const storedPageByUrl = new Map(run.pages.map((p) => [p.url, p]))
  const expectedPageById = new Map(expected.pages.map((p) => [p.id, p]))
  for (const p of expected.pages) {
    const stored = storedPageByUrl.get(p.url)
    if (!stored) {
      diffs.push(`missing CrawlPage: ${p.url}`)
      continue
    }
    // passCount/incompleteCount compare unconditionally (Codex plan-fix #3):
    // parity needs the blob, so a rebuild always populates them — stored null
    // is a stale pre-C3 row, never noise.
    for (const field of ['status', 'error', 'finalUrl', 'score', 'passCount', 'incompleteCount', 'adaAuditId'] as const) {
      if (stored[field] !== p[field]) {
        diffs.push(`CrawlPage ${p.url} ${field}: tables=${stored[field]} blob=${p[field]}`)
      }
    }
  }
  const expectedUrls = new Set(expected.pages.map((p) => p.url))
  for (const p of run.pages) {
    if (!expectedUrls.has(p.url)) diffs.push(`extra CrawlPage: ${p.url}`)
  }

  // Findings by dedupKey, field-level (ADA rows are all page-scope).
  const storedByKey = new Map(run.findings.map((f) => [f.dedupKey, f]))
  const expectedByKey = new Map(expected.findings.map((f) => [f.dedupKey, f]))
  for (const [key, exp] of expectedByKey) {
    const stored = storedByKey.get(key)
    if (!stored) {
      diffs.push(`missing Finding: ${exp.type} @ ${exp.url}`)
      continue
    }
    for (const field of ['scope', 'type', 'severity', 'url', 'count'] as const) {
      if (stored[field] !== exp[field]) {
        diffs.push(`Finding ${exp.type} @ ${exp.url} ${field}: tables=${stored[field]} blob=${exp[field]}`)
      }
    }
  }
  for (const f of run.findings) {
    if (!expectedByKey.has(f.dedupKey)) diffs.push(`extra Finding: ${f.type} @ ${f.url}`)
  }

  // Violations matched through their finding's dedupKey (1:1 with Finding).
  const storedFindingById = new Map(run.findings.map((f) => [f.id, f]))
  const storedViolationByKey = new Map(
    run.violations.flatMap((v) => {
      const f = storedFindingById.get(v.findingId)
      return f ? ([[f.dedupKey, v]] as const) : []
    }),
  )
  for (const exp of expected.violations) {
    const expFinding = expected.findings.find((f) => f.id === exp.findingId)!
    const stored = storedViolationByKey.get(expFinding.dedupKey)
    if (!stored) {
      diffs.push(`missing Violation: ${exp.ruleId} @ ${expectedPageById.get(exp.pageId)?.url}`)
      continue
    }
    for (const field of ['ruleId', 'impact', 'wcagTags', 'nodeCount'] as const) {
      if (stored[field] !== exp[field]) {
        diffs.push(`Violation ${exp.ruleId} ${field}: tables=${stored[field]} blob=${exp[field]}`)
      }
    }
  }
  if (run.violations.length !== expected.violations.length) {
    diffs.push(`violations: tables=${run.violations.length} blob=${expected.violations.length}`)
  }
}

export async function compareAdaParity(siteAuditId: string): Promise<ParityReport> {
  const diffs: string[] = []
  const parent = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: {
      id: true, domain: true, clientId: true, wcagLevel: true, status: true,
      pagesError: true, startedAt: true, completedAt: true, summary: true,
    },
  })
  if (!parent) return { ok: false, diffs: ['site audit missing'] }
  if (parent.status !== 'complete') {
    return { ok: false, diffs: [`site audit status is ${parent.status}, not complete`] }
  }

  const children = await prisma.adaAudit.findMany({
    where: { siteAuditId },
    select: { id: true, url: true, status: true, error: true, finalUrl: true, result: true },
    // Same deterministic order as the finalizer + writeAdaSiteFindings —
    // keep-first dedupe must pick the same child everywhere.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const expected = mapAdaChildren(parent, children)

  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId },
    include: { pages: true, findings: true, violations: true },
  })
  if (!run) return { ok: false, diffs: ['no CrawlRun for site audit'] }

  diffAdaRun(run, expected, diffs)

  // Independent cross-check: aggregate recomputed from stored Violation rows
  // vs summary.aggregate (what the UI renders). 'unknown' impacts count in
  // total only — summary.aggregate buckets only the four real impacts.
  // A complete site audit without a summary blob is itself a parity failure:
  // the summary is the UI's source of truth for this audit.
  if (!parent.summary) {
    diffs.push('summary blob missing on a complete site audit')
  } else {
    try {
      const summary = JSON.parse(parent.summary) as SiteAuditSummary
      const agg = summary.aggregate
      const fromRows = { critical: 0, serious: 0, moderate: 0, minor: 0, total: run.violations.length }
      for (const v of run.violations) {
        if (v.impact === 'critical' || v.impact === 'serious' || v.impact === 'moderate' || v.impact === 'minor') {
          fromRows[v.impact]++
        }
      }
      for (const k of ['critical', 'serious', 'moderate', 'minor', 'total'] as const) {
        if (fromRows[k] !== agg[k]) {
          diffs.push(`aggregate ${k}: violation rows=${fromRows[k]} summary.aggregate=${agg[k]}`)
        }
      }
    } catch {
      diffs.push('summary blob is not valid JSON')
    }
  }

  return { ok: diffs.length === 0, diffs }
}

export async function compareAdaSingleParity(adaAuditId: string): Promise<ParityReport> {
  const diffs: string[] = []
  const audit = await prisma.adaAudit.findUnique({
    where: { id: adaAuditId },
    select: {
      id: true, url: true, status: true, result: true, finalUrl: true,
      wcagLevel: true, clientId: true, siteAuditId: true,
      startedAt: true, completedAt: true,
    },
  })
  if (!audit) return { ok: false, diffs: ['ada audit missing'] }
  if (audit.siteAuditId) return { ok: false, diffs: ['ada audit is a site-audit child — use compareAdaParity on its parent'] }
  if (audit.status !== 'complete' && audit.status !== 'redirected') {
    return { ok: false, diffs: [`ada audit status is ${audit.status}, not complete/redirected`] }
  }

  const expected = mapAdaSingle(audit)
  const run = await prisma.crawlRun.findUnique({
    where: { adaAuditId },
    include: { pages: true, findings: true, violations: true },
  })
  if (!run) return { ok: false, diffs: ['no CrawlRun for ada audit'] }

  diffAdaRun(run, expected, diffs)
  return { ok: diffs.length === 0, diffs }
}
