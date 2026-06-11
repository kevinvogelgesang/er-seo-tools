// lib/findings/parity.ts
//
// Blob-vs-tables parity for the dual-write phase. Recomputes the expected
// bundle from the archived blob with the same mapper, then diffs counts,
// identity sets, and field values against the stored rows. Used by
// scripts/findings-parity.ts against production data before any reader flips.
import { prisma } from '@/lib/db'
import type { AggregatedResult } from '@/lib/types'
import { mapSeoResult } from './seo-mapper'

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
  if (!session?.result) return { ok: false, diffs: ['session missing or has no result blob'] }

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
