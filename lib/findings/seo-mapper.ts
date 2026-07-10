// lib/findings/seo-mapper.ts
//
// Pure mapper: AggregatedResult blob → FindingsBundle. No DB access.
// Mirrors buildSessionPages' field mapping for pages so parity holds.
import { randomUUID } from 'crypto'
import type { AggregatedResult, Issue } from '@/lib/types'
import { rehydrate } from '@/lib/services/url-registry'
import { normalizeHost } from '@/lib/services/normalize-host'
import { computeHealthScore } from '@/lib/services/scoring.service'
import type { ScoringWeights } from '@/lib/scoring/weights'
import { serializeBreakdownV2 } from '@/lib/scoring/seo-core'
import { hashWeights } from '@/lib/scoring/weights-hash'
import { normalizeFindingUrl, runFindingKey, pageFindingKey } from './keys'
import type { CrawlPageInput, FindingInput, FindingsBundle } from './types'

export interface SeoMapContext {
  sessionId: string
  clientId: number | null
  startedAt: Date | null
  completedAt: Date | null
  weights: ScoringWeights
}

const SEVERITIES = [
  ['critical', 'critical'],
  ['warnings', 'warning'],
  ['notices', 'notice'],
] as const

export function mapSeoResult(result: AggregatedResult, ctx: SeoMapContext): FindingsBundle {
  const runId = randomUUID()
  const reg = result.url_registry
  const pageIndex = result.page_index ?? []

  // Keep-first dedupe by normalized URL: production blobs can carry literal
  // duplicate page_index entries (same URL under two refs), and the writer's
  // @@unique([runId, url]) would reject the bundle.
  const pages: CrawlPageInput[] = []
  const pageByUrl = new Map<string, CrawlPageInput>()
  if (reg) {
    for (const p of pageIndex) {
      const url = normalizeFindingUrl(rehydrate(reg, p.ref))
      if (pageByUrl.has(url)) continue
      const page: CrawlPageInput = {
        id: randomUUID(),
        runId,
        url,
        status: null,
        error: null,
        finalUrl: null,
        statusCode: null,
        title: p.title,
        h1: p.h1,
        metaDescription: p.metaDescription,
        wordCount: p.wordCount,
        crawlDepth: p.crawlDepth,
        inlinks: p.inlinks ?? null,
        outlinks: p.outlinks ?? null,
        indexable: p.indexable,
        score: null,
        passCount: null,
        incompleteCount: null,
        adaAuditId: null,
      }
      pages.push(page)
      pageByUrl.set(url, page)
    }
  }

  const findings: FindingInput[] = []
  const seenKeys = new Set<string>()
  const push = (f: FindingInput) => {
    if (seenKeys.has(f.dedupKey)) return
    seenKeys.add(f.dedupKey)
    findings.push(f)
  }

  for (const [bucket, severity] of SEVERITIES) {
    for (const issue of result.issues?.[bucket] ?? []) {
      // Run-scope row: the authoritative per-type record.
      push({
        id: randomUUID(),
        runId,
        pageId: null,
        scope: 'run',
        type: issue.type,
        severity,
        url: null,
        count: issue.count ?? 1,
        affectedComplete: issue.affectedUrlRefsComplete ?? null,
        affectedSource: issue.affectedUrlSource ?? null,
        detail: JSON.stringify({ description: issue.description ?? '' }),
        dedupKey: runFindingKey(issue.type),
      })

      // Page-scope rows: best-available URL attribution. Each row carries
      // its issue's completeness flags so diff consumers can tell complete
      // sets from sampled ones.
      for (const url of affectedUrls(issue, reg)) {
        const normalized = normalizeFindingUrl(url)
        push({
          id: randomUUID(),
          runId,
          pageId: pageByUrl.get(normalized)?.id ?? null,
          scope: 'page',
          type: issue.type,
          severity,
          url: normalized,
          count: 1,
          affectedComplete: issue.affectedUrlRefsComplete ?? null,
          affectedSource: issue.affectedUrlSource ?? null,
          detail: null,
          dedupKey: pageFindingKey(issue.type, url),
        })
      }
    }
  }

  const healthResult = computeHealthScore(result, ctx.weights)

  return {
    run: {
      id: runId,
      tool: 'seo-parser',
      source: 'sf-upload',
      domain: normalizeHost(result.metadata?.site_name ?? reg?.sessionOrigin.host ?? null),
      clientId: ctx.clientId,
      sessionId: ctx.sessionId,
      siteAuditId: null,
      adaAuditId: null,
      status: 'complete',
      score: healthResult.score,
      scoreBreakdown: serializeBreakdownV2(
        'health', healthResult, hashWeights(ctx.weights as unknown as Record<string, number>), healthResult.inputsSnapshot,
      ),
      wcagLevel: null,
      pagesTotal: pages.length,
      startedAt: ctx.startedAt,
      completedAt: ctx.completedAt,
    },
    pages,
    findings,
    violations: [],
  }
}

/** Page-scope rows need page_index context to be meaningful; a legacy blob
 *  (no registry) gets run-scope rows only. Extraction order mirrors
 *  recommendation-builder: refs first, then groups[*].urls (duplicate
 *  title/meta/H1 issues carry URLs ONLY there), then sampled issue.urls. */
function affectedUrls(issue: Issue, reg: AggregatedResult['url_registry']): string[] {
  if (!reg) return []
  const fromRefs = (issue.affectedUrlRefs ?? []).map((ref) => rehydrate(reg, ref)).filter(Boolean)
  const fromGroups = (issue.groups ?? []).flatMap((g) => g.urls ?? [])
  const fromSamples = fromRefs.length ? [] : (issue.urls ?? [])
  return Array.from(new Set([...fromRefs, ...fromGroups, ...fromSamples]))
}
