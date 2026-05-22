// Detect rules that appear on a configurable threshold of scanned pages and
// project them into a UI-ready callout shape. Pure functions only — no DB,
// no React, no I/O. Consumed at finalization by `buildSiteAuditSummary` and
// stored in `SiteAudit.summary.commonIssues`.

import type { CommonIssue, CommonIssueTier, ImpactLevel, LandmarkTag, AncestorConfidence } from './types'

// Lowest tier gates inclusion. Each tier's lower bound determines its label.
export const COMMON_ISSUE_THRESHOLD = 0.25
export const COMMON_ISSUE_TIER_TEMPLATE = 0.8
export const COMMON_ISSUE_TIER_COMMON = 0.5
export const COMMON_ISSUE_TIER_RECURRING = 0.25
export const COMMON_ISSUE_MIN_PAGES = 5
export const COMMON_ISSUE_MAX_CALLOUTS = 5

const TIER_RANK: Record<CommonIssueTier, number> = {
  template: 0,
  common: 1,
  recurring: 2,
}

export function tierForRatio(ratio: number): CommonIssueTier | null {
  if (ratio >= COMMON_ISSUE_TIER_TEMPLATE) return 'template'
  if (ratio >= COMMON_ISSUE_TIER_COMMON) return 'common'
  if (ratio >= COMMON_ISSUE_TIER_RECURRING) return 'recurring'
  return null
}

const LANDMARK_TAGS: readonly LandmarkTag[] = ['header', 'footer', 'nav', 'aside', 'main']
const IMPACT_RANK: Record<ImpactLevel, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
}
const VALID_IMPACTS: readonly ImpactLevel[] = ['critical', 'serious', 'moderate', 'minor']

export interface CommonIssueInputRow {
  id: string
  status: string
  result: string | null
  /** Page URL — used to attribute selector votes back to a specific page for
   *  the "View on …" example link in the common-issue callout. */
  url: string
}

/**
 * Walk a CSS selector and emit its top-level simple-selector segments' leading
 * tag names. Skips content inside (), [], and string literals so attribute
 * values, pseudo-class arguments, and escaped tokens don't false-positive.
 */
export function extractTagsFromSelector(selector: string): string[] {
  const tags: string[] = []
  let depth = 0
  let stringChar: '"' | "'" | null = null
  let segment = ''

  const flush = () => {
    const trimmed = segment.trim()
    if (trimmed) {
      const m = trimmed.match(/^([a-z][a-z0-9-]*)/i)
      if (m) tags.push(m[1].toLowerCase())
    }
    segment = ''
  }

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]
    if (stringChar) {
      if (ch === stringChar) stringChar = null
      continue
    }
    if (ch === '"' || ch === "'") {
      stringChar = ch
      continue
    }
    if (ch === '(' || ch === '[') {
      depth++
      segment += ch
      continue
    }
    if (ch === ')' || ch === ']') {
      depth--
      segment += ch
      continue
    }
    if (depth === 0 && /[\s>+~,]/.test(ch)) {
      flush()
      continue
    }
    segment += ch
  }
  flush()
  return tags
}

/** Find the first landmark tag in a target selector array. */
export function extractLandmarkFromTarget(target: string[] | undefined): LandmarkTag | null {
  if (!target || target.length === 0) return null
  for (const sel of target) {
    for (const tag of extractTagsFromSelector(sel)) {
      if ((LANDMARK_TAGS as readonly string[]).includes(tag)) return tag as LandmarkTag
    }
  }
  return null
}

interface RawNode { target?: string[]; html?: string }

/** Pick the most common landmark from this page's nodes for one rule. Ties → null. */
function computeModalLandmarkForPage(nodes: RawNode[]): LandmarkTag | null {
  if (!Array.isArray(nodes) || nodes.length === 0) return null

  const tally: Partial<Record<LandmarkTag, number>> = {}
  for (const node of nodes) {
    const landmark = extractLandmarkFromTarget(node?.target)
    if (landmark) tally[landmark] = (tally[landmark] ?? 0) + 1
  }

  const entries = Object.entries(tally) as [LandmarkTag, number][]
  if (entries.length === 0) return null

  entries.sort((a, b) => b[1] - a[1])
  const [topTag, topCount] = entries[0]
  if (entries.length > 1 && entries[1][1] === topCount) return null
  return topTag
}

function voteAcrossPages(
  pageLandmarks: Map<string, LandmarkTag>,
  affectedPagesCount: number,
): { sharedAncestor: LandmarkTag | null; ancestorConfidence: AncestorConfidence | null } {
  const votingPages = pageLandmarks.size
  if (votingPages === 0) return { sharedAncestor: null, ancestorConfidence: null }

  // Fewer than half of affected pages contributed any landmark → not enough evidence.
  if (votingPages * 2 < affectedPagesCount) {
    return { sharedAncestor: null, ancestorConfidence: null }
  }

  const tally: Partial<Record<LandmarkTag, number>> = {}
  for (const landmark of pageLandmarks.values()) {
    tally[landmark] = (tally[landmark] ?? 0) + 1
  }
  const entries = Object.entries(tally) as [LandmarkTag, number][]
  entries.sort((a, b) => b[1] - a[1])
  const [topTag, topCount] = entries[0]

  if (entries.length > 1 && entries[1][1] === topCount) {
    return { sharedAncestor: null, ancestorConfidence: null }
  }

  if (topCount === votingPages) {
    return { sharedAncestor: topTag, ancestorConfidence: 'all' }
  }

  if (topCount * 2 > affectedPagesCount) {
    return { sharedAncestor: topTag, ancestorConfidence: 'majority' }
  }

  return { sharedAncestor: null, ancestorConfidence: null }
}

interface RuleAccumulator {
  metadata: { impact: ImpactLevel; help: string; description: string; helpUrl: string }
  pageIds: Set<string>
  landmarkByPage: Map<string, LandmarkTag>
  /** Per-affected-page bundles of (url, node targets) used by canonical-selector voting. */
  pagesForSelector: { url: string; nodes: { target: string[] }[] }[]
}

/**
 * Page-based selector voting: each affected page contributes one vote — the
 * most-frequent target selector among that page's violation nodes. The
 * cross-page mode of those votes is the canonical selector, requiring a
 * strict majority of all affected pages (half or less → no canonical).
 *
 * Confidence is reported relative to total affected pages (not just voting
 * pages), so a rule that fires on a page with zero target data dilutes
 * confidence as expected.
 */
export function computeCanonicalSelector(
  affectedPages: { url: string; nodes: { target: string[] }[] }[],
): { canonicalSelector: string | null; selectorConfidence: number; examplePageUrl: string | null } {
  if (affectedPages.length === 0) {
    return { canonicalSelector: null, selectorConfidence: 0, examplePageUrl: null }
  }
  const votes: { selector: string; pageUrl: string }[] = []
  for (const page of affectedPages) {
    if (page.nodes.length === 0) continue
    const counts = new Map<string, number>()
    for (const n of page.nodes) {
      if (!Array.isArray(n.target) || n.target.length === 0) continue
      const key = n.target.join(' ')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let topSelector: string | null = null
    let topCount = -1
    for (const [s, c] of counts) {
      if (c > topCount) { topSelector = s; topCount = c }
    }
    if (topSelector) votes.push({ selector: topSelector, pageUrl: page.url })
  }
  if (votes.length === 0) {
    return { canonicalSelector: null, selectorConfidence: 0, examplePageUrl: null }
  }
  const tally = new Map<string, number>()
  for (const v of votes) tally.set(v.selector, (tally.get(v.selector) ?? 0) + 1)
  let canonical: string | null = null
  let canonicalCount = 0
  for (const [s, c] of tally) {
    if (c > canonicalCount) { canonical = s; canonicalCount = c }
  }
  // Strict majority required across affected pages.
  if (canonical === null || canonicalCount * 2 <= affectedPages.length) {
    return { canonicalSelector: null, selectorConfidence: 0, examplePageUrl: null }
  }
  const examplePage = votes.find((v) => v.selector === canonical)?.pageUrl ?? null
  return {
    canonicalSelector: canonical,
    selectorConfidence: canonicalCount / affectedPages.length,
    examplePageUrl: examplePage,
  }
}

interface ParsedResult { violations?: unknown }

interface ViolationLike {
  id: string
  impact: ImpactLevel
  help?: unknown
  description?: unknown
  helpUrl?: unknown
  nodes?: unknown
}

function isViolationLike(v: unknown): v is ViolationLike {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (typeof obj.id !== 'string') return false
  if (typeof obj.impact !== 'string') return false
  if (!(VALID_IMPACTS as readonly string[]).includes(obj.impact)) return false
  return true
}

/**
 * Main entry: detect rules appearing on >= COMMON_ISSUE_THRESHOLD of complete
 * pages, bucketed into 'template' (≥80%), 'common' (≥50%), or 'recurring'
 * (≥25%). Returns empty when below the page floor or when no rule meets the
 * threshold. Output sorted by tier, then impact severity, then affected-page
 * count (desc).
 */
export function detectCommonIssues(rows: CommonIssueInputRow[]): CommonIssue[] {
  const completeRows = rows.filter((r) => r.status === 'complete')
  const N = completeRows.length
  if (N < COMMON_ISSUE_MIN_PAGES) return []

  const minHits = Math.ceil(N * COMMON_ISSUE_THRESHOLD)
  const accumulator = new Map<string, RuleAccumulator>()

  for (const row of completeRows) {
    if (row.result == null) continue
    let parsed: ParsedResult
    try {
      parsed = JSON.parse(row.result) as ParsedResult
    } catch {
      continue
    }
    if (!Array.isArray(parsed.violations)) continue

    for (const v of parsed.violations as unknown[]) {
      if (!isViolationLike(v)) continue
      const id = v.id
      const impact = v.impact as ImpactLevel
      const rawNodes = (v as { nodes?: unknown }).nodes
      const nodes: RawNode[] = Array.isArray(rawNodes) ? (rawNodes as RawNode[]) : []

      let entry = accumulator.get(id)
      if (!entry) {
        entry = {
          metadata: {
            impact,
            help: typeof v.help === 'string' ? v.help : '',
            description: typeof v.description === 'string' ? v.description : '',
            helpUrl: typeof v.helpUrl === 'string' ? v.helpUrl : '',
          },
          pageIds: new Set(),
          landmarkByPage: new Map(),
          pagesForSelector: [],
        }
        accumulator.set(id, entry)
      }
      entry.pageIds.add(row.id)
      const pageLandmark = computeModalLandmarkForPage(nodes)
      if (pageLandmark) entry.landmarkByPage.set(row.id, pageLandmark)
      entry.pagesForSelector.push({
        url: row.url,
        nodes: nodes
          .filter((n): n is { target: string[] } => Array.isArray(n?.target))
          .map((n) => ({ target: n.target })),
      })
    }
  }

  const out: CommonIssue[] = []
  for (const [ruleId, entry] of accumulator.entries()) {
    const affectedPagesCount = entry.pageIds.size
    if (affectedPagesCount < minHits) continue

    const tier = tierForRatio(affectedPagesCount / N)
    if (!tier) continue

    const { sharedAncestor, ancestorConfidence } = voteAcrossPages(entry.landmarkByPage, affectedPagesCount)

    // Canonical selector identifies the shared DOM element only when the
    // pattern is concentrated enough to be a single fix (template/common).
    // 'recurring' issues span too many distinct contexts to warrant one.
    const selectorExtras = (tier === 'template' || tier === 'common')
      ? computeCanonicalSelector(entry.pagesForSelector)
      : { canonicalSelector: null, selectorConfidence: 0, examplePageUrl: null }

    out.push({
      ruleId,
      impact: entry.metadata.impact,
      help: entry.metadata.help,
      description: entry.metadata.description,
      helpUrl: entry.metadata.helpUrl,
      affectedPagesCount,
      totalPagesScanned: N,
      sharedAncestor,
      ancestorConfidence,
      tier,
      canonicalSelector: selectorExtras.canonicalSelector,
      selectorConfidence: selectorExtras.selectorConfidence,
      examplePageUrl: selectorExtras.examplePageUrl,
    })
  }

  out.sort((a, b) => {
    const ta = TIER_RANK[a.tier ?? 'template']
    const tb = TIER_RANK[b.tier ?? 'template']
    if (ta !== tb) return ta - tb
    const ia = IMPACT_RANK[a.impact]
    const ib = IMPACT_RANK[b.impact]
    if (ia !== ib) return ia - ib
    return b.affectedPagesCount - a.affectedPagesCount
  })

  return out
}
