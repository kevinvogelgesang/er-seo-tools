// lib/findings/onpage-seo-mapper.ts
//
// Pure: on-page SEO rows -> FindingInput[] for the live-scan CrawlRun (C6 Phase 2).
// The BUILDER owns runId + the shared page map; this mapper pushes pages via the
// injected ensurePage and returns findings only (Codex fix #3). Missing/thin reuse
// deriveIssueTypesForPage so the live rule never drifts from the SF parser; duplicate
// comparison is trimmed-exact (Codex fix #6). Aggregation set = indexable & !login-like.
import { randomUUID } from 'crypto'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import { deriveIssueTypesForPage } from '@/lib/services/issue-membership'
import type { PerUrlRecord } from '@/lib/types'
import type { CrawlPageInput, FindingInput } from './types'

export interface OnPageSeoRow {
  url: string
  statusCode: number | null
  isHtml: boolean
  robotsNoindex: boolean
  xRobotsNoindex: boolean
  loginLike: boolean
  title: string | null | undefined
  h1: string | null | undefined
  metaDescription: string | null | undefined
  wordCount: number | null
}

export interface OnPageMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
  harvestTruncated: boolean
}

const SEVERITY: Record<string, 'critical' | 'warning' | 'notice'> = {
  missing_title: 'critical',
  duplicate_title: 'warning',
  missing_meta_description: 'warning',
  duplicate_meta_description: 'notice',
  missing_h1: 'warning',
  duplicate_h1: 'notice',
  thin_content: 'warning',
}
const DESC: Record<string, string> = {
  missing_title: 'Indexable pages with no <title>.',
  duplicate_title: 'Indexable pages sharing an identical <title>.',
  missing_meta_description: 'Indexable pages with no meta description.',
  duplicate_meta_description: 'Indexable pages sharing an identical meta description.',
  missing_h1: 'Indexable pages with no H1.',
  duplicate_h1: 'Indexable pages sharing an identical H1.',
  thin_content: 'Indexable pages with fewer than 300 visible words.',
}

const indexableOf = (r: OnPageSeoRow): boolean =>
  r.statusCode != null && r.statusCode >= 200 && r.statusCode < 300 &&
  r.isHtml && !r.robotsNoindex && !r.xRobotsNoindex

export function mapOnPageSeoFindings(rows: OnPageSeoRow[], deps: OnPageMapDeps): FindingInput[] {
  const { runId, ensurePage, harvestTruncated } = deps
  const affectedComplete = !harvestTruncated
  // Eligible set: indexable, not login-like. Normalize URL once.
  const eligible = rows
    .filter((r) => !r.loginLike && indexableOf(r))
    .map((r) => ({ ...r, url: normalizeFindingUrl(r.url) }))

  // type -> affected normalized URLs (insertion order, deduped). Page-scope rows
  // come from here for ALL types.
  const byType = new Map<string, string[]>()
  // type -> run-scope count. For missing_*/thin_content this is affected pages;
  // for duplicate_* it is the number of duplicate GROUPS (SF pageTitles.parser
  // semantics — Codex fix #3), set explicitly in dup() below.
  const runCount = new Map<string, number>()
  const add = (type: string, url: string) => {
    const arr = byType.get(type) ?? byType.set(type, []).get(type)!
    if (!arr.includes(url)) arr.push(url)
  }

  // missing_* + thin_content via the shared SF predicate. Run count = affected pages.
  for (const r of eligible) {
    const rec: PerUrlRecord = {
      url: r.url, title: r.title ?? null, h1: r.h1 ?? null, metaDescription: r.metaDescription ?? null,
      wordCount: r.wordCount, crawlDepth: null, indexable: true,
    }
    for (const t of deriveIssueTypesForPage(rec)) add(t, r.url)
  }

  // duplicates: trimmed-exact non-empty value shared by >= 2 pages. Run count =
  // number of duplicate groups; page rows = every page in any group.
  const dup = (key: 'title' | 'metaDescription' | 'h1', type: string) => {
    const groups = new Map<string, string[]>()
    for (const r of eligible) {
      const v = (r[key] ?? '').trim()
      if (!v) continue
      const arr = groups.get(v) ?? groups.set(v, []).get(v)!
      arr.push(r.url)
    }
    let groupCount = 0
    for (const urls of groups.values()) {
      if (urls.length < 2) continue
      groupCount++
      for (const u of urls) add(type, u)
    }
    if (groupCount > 0) runCount.set(type, groupCount)
  }
  dup('title', 'duplicate_title')
  dup('metaDescription', 'duplicate_meta_description')
  dup('h1', 'duplicate_h1')

  const findings: FindingInput[] = []
  for (const [type, urls] of byType) {
    findings.push({
      id: randomUUID(), runId, pageId: null, scope: 'run', type,
      severity: SEVERITY[type] ?? 'warning', url: null, count: runCount.get(type) ?? urls.length,
      affectedComplete, affectedSource: 'live-scan-onpage',
      detail: JSON.stringify({ description: DESC[type] ?? type }),
      dedupKey: runFindingKey(type),
    })
    for (const url of urls) {
      const page = ensurePage(url)
      findings.push({
        id: randomUUID(), runId, pageId: page.id, scope: 'page', type,
        severity: SEVERITY[type] ?? 'warning', url, count: 1,
        affectedComplete, affectedSource: 'live-scan-onpage', detail: null,
        dedupKey: pageFindingKey(type, url),
      })
    }
  }
  return findings
}
