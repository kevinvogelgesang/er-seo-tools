// lib/findings/broken-link-mapper.ts
//
// Pure: broken-link verifier results -> FindingInput[] for the live-scan run (C6).
// Run-scope count = distinct broken TARGET urls per type. Page-scope findings keyed
// by SOURCE PAGE (one per (type, source page)) so multiple sources to one broken
// target never collide on @@unique([runId, dedupKey]); broken target urls ride in
// detail. The BUILDER owns runId + the shared page map (ensurePage).
import { randomUUID } from 'crypto'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import type { CrawlPageInput, FindingInput } from './types'

export interface BrokenTarget {
  targetUrl: string
  kind: 'internal-link' | 'image' | 'external-link'
  sourcePageUrls: string[] // sample, <=25; normalized by the caller
}

export interface BrokenLinkMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
  affectedComplete: boolean
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

export function mapBrokenLinkFindings(broken: BrokenTarget[], deps: BrokenLinkMapDeps): FindingInput[] {
  const { runId, ensurePage, affectedComplete, confidence } = deps
  const byType = new Map<string, BrokenTarget[]>()
  for (const t of broken) {
    const type = TYPE_OF[t.kind]
    if (!type) continue
    const arr = byType.get(type) ?? byType.set(type, []).get(type)!
    arr.push(t)
  }

  const findings: FindingInput[] = []
  for (const [type, targets] of byType) {
    const distinctTargets = new Set(targets.map((t) => t.targetUrl)).size
    findings.push({
      id: randomUUID(), runId, pageId: null, scope: 'run', type, severity: 'critical',
      url: null, count: distinctTargets, affectedComplete, affectedSource: 'live-scan-verify',
      detail: JSON.stringify({ description: DESC[type] ?? type, ...confidence }),
      dedupKey: runFindingKey(type),
    })
    const bySource = new Map<string, string[]>()
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
        id: randomUUID(), runId, pageId: page.id, scope: 'page', type, severity: 'critical',
        url: src, count: targetUrls.length, affectedComplete, affectedSource: 'live-scan-verify',
        detail: JSON.stringify({ brokenTargetUrls: targetUrls.slice(0, URLS_PER_FINDING) }),
        dedupKey: pageFindingKey(type, src),
      })
    }
  }
  return findings
}
