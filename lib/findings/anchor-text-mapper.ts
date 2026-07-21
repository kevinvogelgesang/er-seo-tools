// lib/findings/anchor-text-mapper.ts
//
// Pure: anchor aggregate -> FindingInput[] for the live-scan CrawlRun.
// empty/non-descriptive are page-scoped by SOURCE page (per-source counts);
// single_anchor_variation is RUN-SCOPE ONLY (destination sample in detail) so
// ensurePage is never called for an un-audited destination (no phantom pages).
import { randomUUID } from 'crypto'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import type { CrawlPageInput, FindingInput } from './types'

export interface AnchorAggregate {
  emptyCount: number
  emptySources: { url: string; count: number }[]
  nonDescriptiveCount: number
  nonDescriptiveSources: { url: string; count: number }[]
  singleVariationCount: number
  singleVariationTargets: string[]
  harvestTruncated: boolean
  targetsTruncated: boolean
}
export interface AnchorMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
}

const SEVERITY = { empty_anchor_text: 'warning', non_descriptive_anchor_text: 'notice', single_anchor_variation: 'notice' } as const
const DESC = {
  empty_anchor_text: 'Internal links whose anchor text is empty.',
  non_descriptive_anchor_text: 'Internal links with non-descriptive anchor text (e.g. "click here", "read more").',
  single_anchor_variation: 'Destination pages that receive internal links with only one anchor-text variation.',
}

export function mapAnchorTextFindings(agg: AnchorAggregate, deps: AnchorMapDeps): FindingInput[] {
  const { runId, ensurePage } = deps
  const out: FindingInput[] = []
  const pageComplete = !agg.harvestTruncated

  const perSource = (type: 'empty_anchor_text' | 'non_descriptive_anchor_text', count: number, sources: { url: string; count: number }[]) => {
    if (count <= 0) return
    out.push({
      id: randomUUID(), runId, pageId: null, scope: 'run', type, severity: SEVERITY[type],
      url: null, count, affectedComplete: pageComplete, affectedSource: 'live-scan-anchor',
      detail: JSON.stringify({ description: DESC[type] }), dedupKey: runFindingKey(type),
    })
    for (const s of sources) {
      const url = normalizeFindingUrl(s.url)
      const page = ensurePage(url)
      out.push({
        id: randomUUID(), runId, pageId: page.id, scope: 'page', type, severity: SEVERITY[type],
        url, count: s.count, affectedComplete: pageComplete, affectedSource: 'live-scan-anchor',
        detail: null, dedupKey: pageFindingKey(type, url),
      })
    }
  }
  perSource('empty_anchor_text', agg.emptyCount, agg.emptySources)
  perSource('non_descriptive_anchor_text', agg.nonDescriptiveCount, agg.nonDescriptiveSources)

  // single_anchor_variation: SF fires only when > 10; run-scope only.
  if (agg.singleVariationCount > 10) {
    out.push({
      id: randomUUID(), runId, pageId: null, scope: 'run', type: 'single_anchor_variation', severity: 'notice',
      url: null, count: agg.singleVariationCount,
      affectedComplete: !agg.harvestTruncated && !agg.targetsTruncated, affectedSource: 'live-scan-anchor',
      detail: JSON.stringify({ description: DESC.single_anchor_variation, sample: agg.singleVariationTargets }),
      dedupKey: runFindingKey('single_anchor_variation'),
    })
  }
  return out
}
