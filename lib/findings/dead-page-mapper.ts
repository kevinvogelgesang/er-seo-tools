// lib/findings/dead-page-mapper.ts
//
// C21 sweep-triage (Bucket 1): dead audited URLs (HTTP 404/410 in the crawl
// frontier) -> dead_page findings on the live-scan run. One page-scope finding
// per dead URL (detail carries statusCode), one run-scope count = distinct URLs.
// ensurePage is called WITHOUT statusCode so a dead page never counts as
// "observed/analyzed" in coverage/score math.
import { randomUUID } from 'crypto'
import { DEAD_PAGE_FINDING_TYPE } from './finding-type-sets'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import type { CrawlPageInput, FindingInput } from './types'

export interface DeadPageRow {
  url: string
  statusCode: number
}

export interface DeadPageMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
  affectedComplete: boolean
}

export function mapDeadPageFindings(rows: DeadPageRow[], deps: DeadPageMapDeps): FindingInput[] {
  const { runId, ensurePage, affectedComplete } = deps
  if (rows.length === 0) return []

  // Distinct by normalized URL; first status code wins.
  const byUrl = new Map<string, number>()
  for (const row of rows) {
    const url = normalizeFindingUrl(row.url)
    if (!byUrl.has(url)) byUrl.set(url, row.statusCode)
  }

  const findings: FindingInput[] = [{
    id: randomUUID(),
    runId,
    pageId: null,
    scope: 'run',
    type: DEAD_PAGE_FINDING_TYPE,
    severity: 'warning',
    url: null,
    count: byUrl.size,
    affectedComplete,
    affectedSource: 'live-scan-frontier',
    detail: JSON.stringify({
      description: 'Audited URLs that return HTTP 404/410 (advertised by the sitemap/crawl but gone).',
    }),
    dedupKey: runFindingKey(DEAD_PAGE_FINDING_TYPE),
  }]

  for (const [url, statusCode] of byUrl) {
    const page = ensurePage(url) // No statusCode scalar — must stay null.
    findings.push({
      id: randomUUID(),
      runId,
      pageId: page.id,
      scope: 'page',
      type: DEAD_PAGE_FINDING_TYPE,
      severity: 'warning',
      url,
      count: 1,
      affectedComplete,
      affectedSource: 'live-scan-frontier',
      detail: JSON.stringify({ statusCode }),
      dedupKey: pageFindingKey(DEAD_PAGE_FINDING_TYPE, url),
    })
  }

  return findings
}
