// lib/findings/broken-link-mapper.ts
//
// Pure: out-of-band broken-link verifier results -> FindingsBundle (C6).
// Run-scope count = distinct broken TARGET urls per type (the headline metric).
// Page-scope findings are keyed by SOURCE PAGE (one per (type, source page)) —
// NOT by target — so multiple source pages pointing at the same broken target
// never collide on Finding's @@unique([runId, dedupKey]). Broken target urls
// ride in the page finding's detail. Written via writeFindingsRun (C5 contract).
import { randomUUID } from 'crypto'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import type { CrawlPageInput, FindingInput, FindingsBundle } from './types'

export interface BrokenTarget {
  targetUrl: string
  kind: 'internal-link' | 'image' | 'external-link'
  sourcePageUrls: string[] // sample, <=25; normalized by the caller
}

export interface BrokenLinkMapContext {
  siteAuditId: string
  domain: string | null
  clientId: number | null
  startedAt: Date | null
  completedAt: Date | null
  confidence: {
    checked: number
    broken: number
    unconfirmed: number
    capped: boolean
    harvestTruncated: boolean
  }
}

const TYPE_OF: Record<BrokenTarget['kind'], string | null> = {
  'internal-link': 'broken_internal_links',
  image: 'broken_images',
  'external-link': null, // not verified in v1
}

const DESC: Record<string, string> = {
  broken_internal_links: 'Internal links that resolve to a 4xx/5xx response.',
  broken_images: 'Image resources that resolve to a 4xx/5xx response.',
}

const URLS_PER_FINDING = 25

export function mapBrokenLinks(broken: BrokenTarget[], ctx: BrokenLinkMapContext): FindingsBundle {
  const runId = randomUUID()
  const affectedComplete = !ctx.confidence.capped && !ctx.confidence.harvestTruncated

  // Group broken targets by finding type (skip external — unverified in v1).
  const byType = new Map<string, BrokenTarget[]>()
  for (const t of broken) {
    const type = TYPE_OF[t.kind]
    if (!type) continue
    const arr = byType.get(type) ?? byType.set(type, []).get(type)!
    arr.push(t)
  }

  const findings: FindingInput[] = []
  const pages: CrawlPageInput[] = []
  const pageByUrl = new Map<string, CrawlPageInput>()
  const ensurePage = (url: string): CrawlPageInput => {
    const u = normalizeFindingUrl(url)
    let p = pageByUrl.get(u)
    if (!p) {
      p = {
        id: randomUUID(),
        runId,
        url: u,
        status: null,
        error: null,
        finalUrl: null,
        statusCode: null,
        title: null,
        h1: null,
        metaDescription: null,
        wordCount: null,
        crawlDepth: null,
        indexable: null,
        score: null,
        passCount: null,
        incompleteCount: null,
        adaAuditId: null,
      }
      pages.push(p)
      pageByUrl.set(u, p)
    }
    return p
  }

  for (const [type, targets] of byType) {
    // run-scope: count = distinct broken target URLs of this type
    const distinctTargets = new Set(targets.map((t) => t.targetUrl)).size
    findings.push({
      id: randomUUID(),
      runId,
      pageId: null,
      scope: 'run',
      type,
      severity: 'critical',
      url: null,
      count: distinctTargets,
      affectedComplete,
      affectedSource: 'live-scan-verify',
      detail: JSON.stringify({ description: DESC[type] ?? type, ...ctx.confidence }),
      dedupKey: runFindingKey(type),
    })

    // page-scope: keyed by SOURCE PAGE (one per (type, source page)).
    const bySource = new Map<string, string[]>() // normalized sourceUrl -> brokenTargetUrls
    for (const t of targets) {
      for (const src of t.sourcePageUrls) {
        const s = normalizeFindingUrl(src)
        const arr = bySource.get(s) ?? bySource.set(s, []).get(s)!
        arr.push(t.targetUrl)
      }
    }
    for (const [src, targetUrls] of bySource) {
      const page = ensurePage(src)
      findings.push({
        id: randomUUID(),
        runId,
        pageId: page.id,
        scope: 'page',
        type,
        severity: 'critical',
        url: src,
        count: targetUrls.length,
        affectedComplete,
        affectedSource: 'live-scan-verify',
        detail: JSON.stringify({ brokenTargetUrls: targetUrls.slice(0, URLS_PER_FINDING) }),
        dedupKey: pageFindingKey(type, src),
      })
    }
  }

  return {
    run: {
      id: runId,
      tool: 'seo-parser',
      source: 'live-scan',
      domain: ctx.domain,
      clientId: ctx.clientId,
      sessionId: null,
      siteAuditId: ctx.siteAuditId,
      adaAuditId: null,
      status: ctx.confidence.capped || ctx.confidence.harvestTruncated ? 'partial' : 'complete',
      score: null,
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
