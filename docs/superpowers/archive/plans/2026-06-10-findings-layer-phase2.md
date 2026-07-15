# Findings Layer Phase 2 (ADA Dual-Write) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dual-write ADA audit results (site audits + standalone page audits) into the `CrawlRun`/`CrawlPage`/`Finding`/`Violation` tables shipped in Phase 1, with ADA parity comparators and rebuild-script support.

**Architecture:** Two pure mappers (`mapAdaChildren` from the finalizer's already-loaded children, `mapAdaSingle` for standalone audits) produce `FindingsBundle`s persisted by the existing Phase-1 writer. The site-audit hook lives in `finalizeSiteAudit` AFTER the terminal update + `closeBatchIfDrained` + promoter kick, as fire-and-forget; the standalone hook lives in the background runner of `app/api/ada-audit/route.ts` for both the `complete` and `redirected` outcomes. Scores are computed by the mappers (never read from scalar columns): per-page and standalone-run scores via `computeScore` (node-based), site-run score via `computeScoreFromCounts` (violation-count-based) — each mirrors what the UI shows for that context.

**Tech Stack:** Prisma 5.22 + SQLite, Next.js 15 App Router, vitest (colocated `*.test.ts`, shared dev DB), tsx CLIs. No schema changes — the full schema shipped in Phase 1.

**Spec:** `docs/superpowers/specs/2026-06-10-findings-layer-design.md` (Codex-reviewed) — see "Row mapping" + "Hook points". Read it before starting. This plan itself is Codex-reviewed (accept-with-fixes ×5, all applied).

**Branch:** `feat/findings-layer-phase2` off `main`.

**Local dev quirk (applies to every prisma/vitest command):** `.env` points at a path that doesn't exist on this Mac. Prefix every prisma CLI and vitest invocation with `DATABASE_URL="file:./local-dev.db"`.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/findings/ada-mapper.ts` | pure: `mapAdaChildren(parent, children)` + `mapAdaSingle(audit)` → bundle; `mapImpactToSeverity`; node capping |
| `lib/findings/ada-write.ts` | fetch-map-write entries: `writeAdaSiteFindings(siteAuditId)` (rebuild path) + `writeAdaSingleFindings(adaAuditId)` (standalone hook + rebuild) |
| `lib/findings/parity.ts` | + `compareAdaParity(siteAuditId)` + `compareAdaSingleParity(adaAuditId)` |
| `lib/ada-audit/site-audit-finalizer.ts` | widen parent select; fire-and-forget bundle write after terminal update + batch close + promoter kick |
| `lib/ada-audit/site-audit-finalizer.test.ts` | clearTestState also deletes `CrawlRun`s (the hook now writes them) |
| `lib/ada-audit/site-audit-finalizer.findings.test.ts` | NEW: hook behavior — run written on completion, injected findings failure never affects completion |
| `app/api/ada-audit/route.ts` | standalone hooks: after the `redirected` update and after the `complete` update |
| `scripts/findings-rebuild.ts` | auto-detect id type (session / site audit / standalone ada audit) |
| `scripts/findings-parity.ts` | auto-detect id type, route to the right comparator |

Design decisions locked in (don't relitigate during implementation):

- **Severity mapping:** critical/serious → `critical`, moderate → `warning`, minor → `notice`. A null axe impact maps to severity `notice` and is stored on `Violation.impact` as the literal sentinel `'unknown'` (the column is non-null; coalescing to `'minor'` would falsify the aggregate vs `summary.aggregate`, whose buckets only count the four real impacts).
- **Keep-first dedupe by normalized URL** for child pages, same as the SEO mapper after PR #56 — `@@unique([runId, url])` would reject the bundle otherwise. A deduped child contributes no page and no findings. **Because keep-first is order-sensitive, every DB caller that feeds `mapAdaChildren` MUST load children with `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]`** (finalizer, `writeAdaSiteFindings`, `compareAdaParity`) — otherwise the finalizer write, the rebuild, and parity could keep *different* children for the same duplicate URL and produce phantom parity drift (Codex review fix).
- **Malformed/missing result blob on a `complete` child** → page row with `score: null` and no findings (mirrors `parseAxeScorecardFromResult` returning null). Never score 100.
- **Run score counts only the violations actually stored** (post-dedupe), so the run row is internally consistent with its `Violation` rows. The independent `summary.aggregate` cross-check in parity will surface any real divergence — that's its job.
- **Capped nodes:** ≤5 nodes, `html` truncated to 300 chars, `target` selectors kept; `null` when the violation has no nodes.
- **`CrawlRun.status`** = `'partial'` when `pagesError > 0`, else `'complete'`. A redirected standalone audit's run is `'complete'` (the audit finished; the page row carries `status: 'redirected'`).

---

### Task 1: ADA mapper (`lib/findings/ada-mapper.ts`)

**Files:**
- Create: `lib/findings/ada-mapper.ts`
- Test: `lib/findings/ada-mapper.test.ts`

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/findings-layer-phase2
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/findings/ada-mapper.test.ts
import { describe, it, expect } from 'vitest'
import type { AxeViolation, StoredAxeResults } from '@/lib/ada-audit/types'
import { computeScore, computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import { mapAdaChildren, mapAdaSingle, mapImpactToSeverity } from './ada-mapper'
import { pageFindingKey } from './keys'

function violation(over: Partial<AxeViolation> = {}): AxeViolation {
  return {
    id: 'color-contrast',
    impact: 'serious',
    help: 'Elements must meet color contrast',
    description: 'Ensures contrast',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
    tags: ['wcag2aa', 'wcag143'],
    nodes: [
      { html: '<a class="x">low</a>', target: ['a.x'] },
      { html: '<p class="y">low</p>', target: ['p.y'] },
    ],
    ...over,
  }
}

function axeBlob(violations: AxeViolation[]): string {
  const blob: StoredAxeResults = {
    violations,
    passes: [], incomplete: [], inapplicable: [],
    timestamp: '2026-06-10T00:00:00Z', url: 'https://x.test/',
    testEngine: { name: 'axe-core', version: '4.10' },
    testRunner: { name: 'er-seo-tools' },
  }
  return JSON.stringify(blob)
}

const PARENT = {
  id: 'site-1',
  domain: 'www.Mapper.test',
  clientId: 7,
  wcagLevel: 'wcag21aa',
  pagesError: 0,
  startedAt: new Date('2026-06-10T00:00:00Z'),
  completedAt: new Date('2026-06-10T00:10:00Z'),
}

function child(over: Partial<{
  id: string; url: string; status: string; error: string | null
  finalUrl: string | null; result: string | null
}> = {}) {
  return {
    id: 'child-1', url: 'https://mapper.test/a', status: 'complete',
    error: null, finalUrl: null, result: axeBlob([violation()]),
    ...over,
  }
}

describe('mapImpactToSeverity', () => {
  it('maps the four impacts and null', () => {
    expect(mapImpactToSeverity('critical')).toBe('critical')
    expect(mapImpactToSeverity('serious')).toBe('critical')
    expect(mapImpactToSeverity('moderate')).toBe('warning')
    expect(mapImpactToSeverity('minor')).toBe('notice')
    expect(mapImpactToSeverity(null)).toBe('notice')
  })
})

describe('mapAdaChildren', () => {
  it('builds the run with origin, wcagLevel, normalized domain, pagesTotal', () => {
    const b = mapAdaChildren(PARENT, [child()])
    expect(b.run.tool).toBe('ada-audit')
    expect(b.run.source).toBe('site-audit')
    expect(b.run.siteAuditId).toBe('site-1')
    expect(b.run.sessionId).toBeNull()
    expect(b.run.adaAuditId).toBeNull()
    expect(b.run.clientId).toBe(7)
    expect(b.run.wcagLevel).toBe('wcag21aa')
    expect(b.run.domain).toBe('mapper.test') // www stripped, lowercased
    expect(b.run.status).toBe('complete')
    expect(b.run.pagesTotal).toBe(1)
    expect(b.run.startedAt).toEqual(PARENT.startedAt)
    expect(b.run.completedAt).toEqual(PARENT.completedAt)
  })

  it('marks the run partial when the parent has errored pages', () => {
    const b = mapAdaChildren({ ...PARENT, pagesError: 1 }, [
      child(),
      child({ id: 'child-2', url: 'https://mapper.test/b', status: 'error', error: 'timeout', result: null }),
    ])
    expect(b.run.status).toBe('partial')
  })

  it('computes the run score from stored violation counts via computeScoreFromCounts', () => {
    const b = mapAdaChildren(PARENT, [
      child({ result: axeBlob([violation(), violation({ id: 'image-alt', impact: 'critical' })]) }),
    ])
    expect(b.run.score).toBe(
      computeScoreFromCounts({ critical: 1, serious: 1, moderate: 0, minor: 0 }, 'wcag21aa').score,
    )
  })

  it('builds one CrawlPage per child with status, error, finalUrl, adaAuditId', () => {
    const b = mapAdaChildren(PARENT, [
      child(),
      child({ id: 'child-2', url: 'https://mapper.test/gone', status: 'error', error: 'nav timeout', result: null }),
      child({ id: 'child-3', url: 'https://mapper.test/old', status: 'redirected', finalUrl: 'https://mapper.test/new', result: null }),
    ])
    expect(b.pages).toHaveLength(3)
    const ok = b.pages.find((p) => p.url === 'https://mapper.test/a')!
    expect(ok.status).toBe('complete')
    expect(ok.adaAuditId).toBe('child-1')
    expect(ok.score).toBe(computeScore([violation()], 'wcag21aa').score)
    const err = b.pages.find((p) => p.url === 'https://mapper.test/gone')!
    expect(err.status).toBe('error')
    expect(err.error).toBe('nav timeout')
    expect(err.score).toBeNull()
    const redir = b.pages.find((p) => p.url === 'https://mapper.test/old')!
    expect(redir.status).toBe('redirected')
    expect(redir.finalUrl).toBe('https://mapper.test/new')
  })

  it('errored and redirected children get no findings', () => {
    const b = mapAdaChildren(PARENT, [
      child({ status: 'error', error: 'x', result: null }),
      child({ id: 'child-2', url: 'https://mapper.test/old', status: 'redirected', finalUrl: 'https://mapper.test/new' }),
    ])
    expect(b.findings).toHaveLength(0)
    expect(b.violations).toHaveLength(0)
  })

  it('builds a page-scope Finding + 1:1 Violation per axe violation', () => {
    const b = mapAdaChildren(PARENT, [child()])
    expect(b.findings).toHaveLength(1)
    expect(b.violations).toHaveLength(1)
    const f = b.findings[0]
    const page = b.pages[0]
    expect(f.scope).toBe('page')
    expect(f.type).toBe('color-contrast')
    expect(f.severity).toBe('critical') // serious → critical
    expect(f.pageId).toBe(page.id)
    expect(f.url).toBe('https://mapper.test/a')
    expect(f.dedupKey).toBe(pageFindingKey('color-contrast', 'https://mapper.test/a'))
    const v = b.violations[0]
    expect(v.findingId).toBe(f.id)
    expect(v.runId).toBe(b.run.id)
    expect(v.pageId).toBe(page.id)
    expect(v.ruleId).toBe('color-contrast')
    expect(v.impact).toBe('serious') // exact axe impact preserved
    expect(JSON.parse(v.wcagTags)).toEqual(['wcag2aa', 'wcag143'])
    expect(v.help).toBe('Elements must meet color contrast')
    expect(v.nodeCount).toBe(2)
  })

  it('null impact → severity notice, Violation.impact "unknown", excluded from score counts', () => {
    const b = mapAdaChildren(PARENT, [
      child({ result: axeBlob([violation({ id: 'odd-rule', impact: null })]) }),
    ])
    expect(b.findings[0].severity).toBe('notice')
    expect(b.violations[0].impact).toBe('unknown')
    expect(b.run.score).toBe(
      computeScoreFromCounts({ critical: 0, serious: 0, moderate: 0, minor: 0 }, 'wcag21aa').score,
    )
  })

  it('caps stored nodes at 5 with html truncated to 300 chars; nodeCount keeps the real total', () => {
    const nodes = Array.from({ length: 7 }, (_, i) => ({
      html: `<div class="n${i}">` + 'x'.repeat(400) + '</div>',
      target: [`.n${i}`],
    }))
    const b = mapAdaChildren(PARENT, [child({ result: axeBlob([violation({ nodes })]) })])
    const v = b.violations[0]
    expect(v.nodeCount).toBe(7)
    const stored = JSON.parse(v.nodes!) as { html: string; target: string[] }[]
    expect(stored).toHaveLength(5)
    expect(stored[0].html.length).toBe(300)
    expect(stored[0].target).toEqual(['.n0'])
  })

  it('keep-first dedupes children that normalize to the same URL (no findings from the loser)', () => {
    const b = mapAdaChildren(PARENT, [
      child({ url: 'https://mapper.test/' }),
      child({ id: 'child-2', url: 'https://Mapper.test', result: axeBlob([violation({ id: 'image-alt' })]) }),
    ])
    expect(b.pages).toHaveLength(1)
    expect(b.pages[0].url).toBe('https://mapper.test')
    expect(b.pages[0].adaAuditId).toBe('child-1')
    expect(b.run.pagesTotal).toBe(1)
    expect(b.findings.map((f) => f.type)).toEqual(['color-contrast'])
  })

  it('a complete child with a malformed result blob gets score null and no findings', () => {
    const b = mapAdaChildren(PARENT, [child({ result: 'not json' })])
    expect(b.pages[0].score).toBeNull()
    expect(b.findings).toHaveLength(0)
  })

  it('defensively dedupes a repeated ruleId on one page (one Finding + one Violation)', () => {
    const b = mapAdaChildren(PARENT, [
      child({ result: axeBlob([violation(), violation()]) }),
    ])
    expect(b.findings).toHaveLength(1)
    expect(b.violations).toHaveLength(1)
  })
})

describe('mapAdaSingle', () => {
  const SINGLE = {
    id: 'ada-1',
    url: 'https://www.Single.test/page',
    status: 'complete',
    result: axeBlob([violation()]),
    finalUrl: null,
    wcagLevel: 'wcag22aa',
    clientId: null,
    startedAt: new Date('2026-06-10T01:00:00Z'),
    completedAt: new Date('2026-06-10T01:02:00Z'),
  }

  it('builds a page-audit run with one page and node-based score', () => {
    const b = mapAdaSingle(SINGLE)
    expect(b.run.tool).toBe('ada-audit')
    expect(b.run.source).toBe('page-audit')
    expect(b.run.adaAuditId).toBe('ada-1')
    expect(b.run.sessionId).toBeNull()
    expect(b.run.siteAuditId).toBeNull()
    expect(b.run.domain).toBe('single.test')
    expect(b.run.wcagLevel).toBe('wcag22aa')
    expect(b.run.status).toBe('complete')
    expect(b.run.pagesTotal).toBe(1)
    const expectedScore = computeScore([violation()], 'wcag22aa').score
    expect(b.run.score).toBe(expectedScore)
    expect(b.pages).toHaveLength(1)
    expect(b.pages[0].url).toBe('https://www.single.test/page')
    expect(b.pages[0].adaAuditId).toBe('ada-1')
    expect(b.pages[0].score).toBe(expectedScore)
    expect(b.findings).toHaveLength(1)
    expect(b.violations).toHaveLength(1)
  })

  it('a redirected standalone gets a run + one redirected page, no findings, null scores', () => {
    const b = mapAdaSingle({
      ...SINGLE, status: 'redirected', result: null,
      finalUrl: 'https://single.test/final',
    })
    expect(b.run.status).toBe('complete')
    expect(b.run.score).toBeNull()
    expect(b.pages).toHaveLength(1)
    expect(b.pages[0].status).toBe('redirected')
    expect(b.pages[0].finalUrl).toBe('https://single.test/final')
    expect(b.pages[0].score).toBeNull()
    expect(b.findings).toHaveLength(0)
    expect(b.violations).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/ada-mapper.test.ts`
Expected: FAIL — cannot resolve `./ada-mapper`.

- [ ] **Step 4: Implement**

```typescript
// lib/findings/ada-mapper.ts
//
// Pure mappers: ADA audit rows (+ their axe result blobs) → FindingsBundle.
// No DB access. Scores are COMPUTED here, never read from scalar columns —
// AdaAudit.score / SiteAudit.score are not reliably persisted (the list and
// detail routes compute them dynamically from blobs today):
//   - page + standalone-run score: computeScore (node-based), matching the
//     standalone list/detail display
//   - site-run score: computeScoreFromCounts (violation-count-based),
//     matching the site detail page's summary.aggregate derivation
import { randomUUID } from 'crypto'
import type { AxeNode, AxeViolation, ImpactLevel, StoredAxeResults } from '@/lib/ada-audit/types'
import { computeScore, computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import { normalizeHost } from '@/lib/services/normalize-host'
import { normalizeFindingUrl, pageFindingKey } from './keys'
import type { CrawlPageInput, FindingInput, FindingsBundle, ViolationInput } from './types'

/** Parent fields the site mapper needs — the finalizer's widened select. */
export interface AdaSiteParent {
  id: string
  domain: string
  clientId: number | null
  wcagLevel: string
  pagesError: number
  startedAt: Date | null
  completedAt: Date | null
}

/** Child fields the site mapper needs — a structural subset of the
 *  finalizer's already-loaded AdaAudit rows. */
export interface AdaChildInput {
  id: string
  url: string
  status: string // 'complete' | 'error' | 'redirected' at finalize time
  error: string | null
  finalUrl: string | null
  result: string | null
}

/** Standalone audit fields mapAdaSingle needs. */
export interface AdaSingleInput {
  id: string
  url: string
  status: string // 'complete' | 'redirected'
  result: string | null
  finalUrl: string | null
  wcagLevel: string
  clientId: number | null
  startedAt: Date | null
  completedAt: Date | null
}

/** ADA → canonical severity: critical/serious → critical, moderate →
 *  warning, minor → notice. Null impact (rare axe rules without impact
 *  metadata) → notice. */
export function mapImpactToSeverity(impact: ImpactLevel | null): 'critical' | 'warning' | 'notice' {
  switch (impact) {
    case 'critical':
    case 'serious':
      return 'critical'
    case 'moderate':
      return 'warning'
    default:
      return 'notice'
  }
}

const NODE_CAP = 5
const NODE_HTML_CAP = 300

function capNodes(nodes: AxeNode[]): string | null {
  if (!nodes.length) return null
  return JSON.stringify(
    nodes.slice(0, NODE_CAP).map((n) => ({
      html: typeof n.html === 'string' ? n.html.slice(0, NODE_HTML_CAP) : '',
      target: n.target ?? [],
    })),
  )
}

/** null = blob missing/malformed (≠ a valid empty violations array): the
 *  page must NOT be scored — score 100 from an unreadable blob would lie. */
function parseViolations(result: string | null): AxeViolation[] | null {
  if (!result) return null
  try {
    const r = JSON.parse(result) as StoredAxeResults
    return Array.isArray(r?.violations) ? r.violations : null
  } catch {
    return null
  }
}

interface ViolationCounts {
  critical: number
  serious: number
  moderate: number
  minor: number
}

/** Shared per-page finding/violation emission. Mutates the bundle arrays and
 *  count accumulator; dedup is defensive (axe emits one entry per rule, but
 *  the @@unique([runId, dedupKey]) constraint must never see a duplicate). */
function emitPageViolations(
  runId: string,
  page: CrawlPageInput,
  axeViolations: AxeViolation[],
  seenKeys: Set<string>,
  findings: FindingInput[],
  violations: ViolationInput[],
  counts: ViolationCounts,
): void {
  for (const v of axeViolations) {
    const dedupKey = pageFindingKey(v.id, page.url)
    if (seenKeys.has(dedupKey)) continue
    seenKeys.add(dedupKey)

    const impact = v.impact ?? 'unknown'
    if (impact !== 'unknown') counts[impact]++

    const findingId = randomUUID()
    findings.push({
      id: findingId,
      runId,
      pageId: page.id,
      scope: 'page',
      type: v.id,
      severity: mapImpactToSeverity(v.impact),
      url: page.url,
      count: 1,
      affectedComplete: null,
      affectedSource: null,
      detail: null,
      dedupKey,
    })
    violations.push({
      id: randomUUID(),
      findingId,
      runId,
      pageId: page.id,
      ruleId: v.id,
      // Exact axe impact; 'unknown' sentinel for null (column is non-null,
      // and coalescing to 'minor' would falsify aggregate-vs-summary parity).
      impact,
      wcagTags: JSON.stringify(v.tags ?? []),
      help: v.help ?? null,
      helpUrl: v.helpUrl ?? null,
      nodeCount: v.nodes?.length ?? 0,
      nodes: capNodes(v.nodes ?? []),
    })
  }
}

export function mapAdaChildren(parent: AdaSiteParent, children: AdaChildInput[]): FindingsBundle {
  const runId = randomUUID()
  const pages: CrawlPageInput[] = []
  const findings: FindingInput[] = []
  const violations: ViolationInput[] = []
  const seenUrls = new Set<string>()
  const seenKeys = new Set<string>()
  const counts: ViolationCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 }

  for (const child of children) {
    const url = normalizeFindingUrl(child.url)
    // Keep-first dedupe by normalized URL, same as the SEO mapper (PR #56):
    // @@unique([runId, url]) would reject the bundle otherwise.
    if (seenUrls.has(url)) continue
    seenUrls.add(url)

    const axeViolations = child.status === 'complete' ? parseViolations(child.result) : null
    const page: CrawlPageInput = {
      id: randomUUID(),
      runId,
      url,
      status: child.status,
      error: child.error,
      finalUrl: child.finalUrl,
      statusCode: null,
      title: null,
      h1: null,
      metaDescription: null,
      wordCount: null,
      crawlDepth: null,
      indexable: null,
      score: axeViolations ? computeScore(axeViolations, parent.wcagLevel).score : null,
      adaAuditId: child.id,
    }
    pages.push(page)

    if (axeViolations) {
      emitPageViolations(runId, page, axeViolations, seenKeys, findings, violations, counts)
    }
  }

  return {
    run: {
      id: runId,
      tool: 'ada-audit',
      source: 'site-audit',
      domain: normalizeHost(parent.domain),
      clientId: parent.clientId,
      sessionId: null,
      siteAuditId: parent.id,
      adaAuditId: null,
      status: parent.pagesError > 0 ? 'partial' : 'complete',
      // Site-level derivation the summary-based UI uses: violation counts →
      // computeScoreFromCounts. Counts cover only the violations actually
      // stored (post-dedupe), so the run row is consistent with its
      // Violation rows.
      score: computeScoreFromCounts(counts, parent.wcagLevel).score,
      wcagLevel: parent.wcagLevel,
      pagesTotal: pages.length,
      startedAt: parent.startedAt,
      completedAt: parent.completedAt,
    },
    pages,
    findings,
    violations,
  }
}

export function mapAdaSingle(audit: AdaSingleInput): FindingsBundle {
  const runId = randomUUID()
  const url = normalizeFindingUrl(audit.url)
  const findings: FindingInput[] = []
  const violations: ViolationInput[] = []
  const counts: ViolationCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 }

  const axeViolations = audit.status === 'complete' ? parseViolations(audit.result) : null
  const score = axeViolations ? computeScore(axeViolations, audit.wcagLevel).score : null

  const page: CrawlPageInput = {
    id: randomUUID(),
    runId,
    url,
    status: audit.status,
    error: null,
    finalUrl: audit.finalUrl,
    statusCode: null,
    title: null,
    h1: null,
    metaDescription: null,
    wordCount: null,
    crawlDepth: null,
    indexable: null,
    score,
    adaAuditId: audit.id,
  }
  if (axeViolations) {
    emitPageViolations(runId, page, axeViolations, new Set<string>(), findings, violations, counts)
  }

  return {
    run: {
      id: runId,
      tool: 'ada-audit',
      source: 'page-audit',
      domain: normalizeHost(audit.url),
      clientId: audit.clientId,
      sessionId: null,
      siteAuditId: null,
      adaAuditId: audit.id,
      // A redirected standalone still completed as a run; the page row
      // carries status 'redirected'. Run status is only 'partial' for site
      // audits with errored pages.
      status: 'complete',
      score,
      wcagLevel: audit.wcagLevel,
      pagesTotal: 1,
      startedAt: audit.startedAt,
      completedAt: audit.completedAt,
    },
    pages: [page],
    findings,
    violations,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/ada-mapper.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/findings/ada-mapper.ts lib/findings/ada-mapper.test.ts
git commit -m "feat(findings): ADA blob -> bundle mappers (site children + standalone)"
```

---

### Task 2: ADA write entries (`lib/findings/ada-write.ts`)

**Files:**
- Create: `lib/findings/ada-write.ts`
- Test: `lib/findings/ada-write.test.ts` (real shared dev DB — clean up everything you create)

- [ ] **Step 1: Write the failing test**

```typescript
// lib/findings/ada-write.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { writeAdaSiteFindings, writeAdaSingleFindings } from './ada-write'

const DOMAIN = 'ada-write.test'

const AXE_BLOB = JSON.stringify({
  violations: [{
    id: 'image-alt', impact: 'critical', help: 'Images must have alt text',
    description: 'alt', helpUrl: 'https://example.org', tags: ['wcag2a'],
    nodes: [{ html: '<img src="x.png">', target: ['img'] }],
  }],
  passes: [], incomplete: [], inapplicable: [],
  timestamp: '2026-06-10T00:00:00Z', url: `https://${DOMAIN}/`,
  testEngine: { name: 'axe-core', version: '4.10' },
  testRunner: { name: 'er-seo-tools' },
})

async function clearTestState() {
  // Delete by BOTH origin and domain: SetNull origins mean a run whose
  // audit row was deleted is unreachable via siteAuditId/adaAuditId.
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}

describe('writeAdaSiteFindings', () => {
  beforeEach(clearTestState)
  afterEach(clearTestState)

  async function makeCompleteSiteAudit() {
    const site = await prisma.siteAudit.create({
      data: {
        domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa',
        pagesTotal: 2, pagesComplete: 1, pagesError: 1,
        startedAt: new Date(), completedAt: new Date(),
      },
    })
    await prisma.adaAudit.createMany({
      data: [
        { url: `https://${DOMAIN}/a`, status: 'complete', result: AXE_BLOB, siteAuditId: site.id, wcagLevel: 'wcag21aa' },
        { url: `https://${DOMAIN}/b`, status: 'error', error: 'timeout', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
      ],
    })
    return site
  }

  it('maps + persists a run for a complete site audit', async () => {
    const site = await makeCompleteSiteAudit()
    await writeAdaSiteFindings(site.id)
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId: site.id },
      include: { pages: true, findings: true, violations: true },
    })
    expect(run).not.toBeNull()
    expect(run!.tool).toBe('ada-audit')
    expect(run!.source).toBe('site-audit')
    expect(run!.status).toBe('partial') // pagesError = 1
    expect(run!.pages).toHaveLength(2)
    expect(run!.findings).toHaveLength(1)
    expect(run!.violations).toHaveLength(1)
    expect(run!.violations[0].ruleId).toBe('image-alt')
  })

  it('is idempotent: rewriting the same site audit replaces, never duplicates', async () => {
    const site = await makeCompleteSiteAudit()
    await writeAdaSiteFindings(site.id)
    await writeAdaSiteFindings(site.id)
    const runs = await prisma.crawlRun.findMany({ where: { siteAuditId: site.id } })
    expect(runs).toHaveLength(1)
    expect(await prisma.crawlPage.count({ where: { runId: runs[0].id } })).toBe(2)
    expect(await prisma.violation.count({ where: { runId: runs[0].id } })).toBe(1)
  })

  it('rejects a non-complete site audit', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'running', wcagLevel: 'wcag21aa' },
    })
    await expect(writeAdaSiteFindings(site.id)).rejects.toThrow(/not complete/i)
  })

  it('rejects an unknown id', async () => {
    await expect(writeAdaSiteFindings('nope')).rejects.toThrow(/not found/i)
  })
})

describe('writeAdaSingleFindings', () => {
  beforeEach(clearTestState)
  afterEach(clearTestState)

  it('maps + persists a run for a complete standalone audit', async () => {
    const audit = await prisma.adaAudit.create({
      data: {
        url: `https://${DOMAIN}/solo`, status: 'complete', result: AXE_BLOB,
        wcagLevel: 'wcag21aa', startedAt: new Date(), completedAt: new Date(),
      },
    })
    await writeAdaSingleFindings(audit.id)
    const run = await prisma.crawlRun.findUnique({
      where: { adaAuditId: audit.id },
      include: { pages: true, findings: true, violations: true },
    })
    expect(run).not.toBeNull()
    expect(run!.source).toBe('page-audit')
    expect(run!.pagesTotal).toBe(1)
    expect(run!.pages[0].adaAuditId).toBe(audit.id)
    expect(run!.findings).toHaveLength(1)
    expect(run!.violations).toHaveLength(1)
  })

  it('writes a redirected standalone as a run + one redirected page, no findings', async () => {
    const audit = await prisma.adaAudit.create({
      data: {
        url: `https://${DOMAIN}/old`, status: 'redirected', redirected: true,
        finalUrl: `https://${DOMAIN}/new`, wcagLevel: 'wcag21aa', completedAt: new Date(),
      },
    })
    await writeAdaSingleFindings(audit.id)
    const run = await prisma.crawlRun.findUnique({
      where: { adaAuditId: audit.id },
      include: { pages: true, findings: true },
    })
    expect(run).not.toBeNull()
    expect(run!.score).toBeNull()
    expect(run!.pages).toHaveLength(1)
    expect(run!.pages[0].status).toBe('redirected')
    expect(run!.pages[0].finalUrl).toBe(`https://${DOMAIN}/new`)
    expect(run!.findings).toHaveLength(0)
  })

  it('rejects a site-audit child', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa' },
    })
    const childAudit = await prisma.adaAudit.create({
      data: { url: `https://${DOMAIN}/child`, status: 'complete', result: AXE_BLOB, siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await expect(writeAdaSingleFindings(childAudit.id)).rejects.toThrow(/child/i)
  })

  it('rejects a non-terminal standalone audit', async () => {
    const audit = await prisma.adaAudit.create({
      data: { url: `https://${DOMAIN}/run`, status: 'running', wcagLevel: 'wcag21aa' },
    })
    await expect(writeAdaSingleFindings(audit.id)).rejects.toThrow(/complete|redirected/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/ada-write.test.ts`
Expected: FAIL — cannot resolve `./ada-write`.

- [ ] **Step 3: Implement**

```typescript
// lib/findings/ada-write.ts
//
// Fetch-map-write entries for the ADA side. writeAdaSingleFindings is the
// standalone hook target (app/api/ada-audit background runner) and the
// rebuild path; writeAdaSiteFindings is the rebuild path for site audits —
// the live finalizer hook maps from its already-loaded children instead
// (no second load) and calls writeFindingsRun directly. Callers wrap these
// in try/catch — a findings failure must never affect the legacy path.
import { prisma } from '@/lib/db'
import { mapAdaChildren, mapAdaSingle } from './ada-mapper'
import { writeFindingsRun } from './writer'

export async function writeAdaSiteFindings(siteAuditId: string): Promise<void> {
  const parent = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: {
      id: true, domain: true, clientId: true, wcagLevel: true, status: true,
      pagesError: true, startedAt: true, completedAt: true,
    },
  })
  if (!parent) throw new Error(`site audit ${siteAuditId} not found`)
  if (parent.status !== 'complete') {
    throw new Error(`site audit ${siteAuditId} is not complete (status: ${parent.status})`)
  }
  const children = await prisma.adaAudit.findMany({
    where: { siteAuditId },
    select: { id: true, url: true, status: true, error: true, finalUrl: true, result: true },
    // Deterministic order: keep-first URL dedupe in the mapper must keep the
    // SAME child here, in the finalizer, and in compareAdaParity.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  await writeFindingsRun(mapAdaChildren(parent, children))
}

export async function writeAdaSingleFindings(adaAuditId: string): Promise<void> {
  const audit = await prisma.adaAudit.findUnique({
    where: { id: adaAuditId },
    select: {
      id: true, url: true, status: true, result: true, finalUrl: true,
      wcagLevel: true, clientId: true, siteAuditId: true,
      startedAt: true, completedAt: true,
    },
  })
  if (!audit) throw new Error(`ada audit ${adaAuditId} not found`)
  if (audit.siteAuditId) {
    throw new Error(`ada audit ${adaAuditId} is a site-audit child — rebuild its parent site audit instead`)
  }
  if (audit.status !== 'complete' && audit.status !== 'redirected') {
    throw new Error(`ada audit ${adaAuditId} is not complete/redirected (status: ${audit.status})`)
  }
  await writeFindingsRun(mapAdaSingle(audit))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/ada-write.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/findings/ada-write.ts lib/findings/ada-write.test.ts
git commit -m "feat(findings): ADA fetch-map-write entries (site rebuild + standalone hook)"
```

---

### Task 3: Site-audit finalizer hook

**Files:**
- Modify: `lib/ada-audit/site-audit-finalizer.ts`
- Modify: `lib/ada-audit/site-audit-finalizer.test.ts` (clearTestState only)
- Create: `lib/ada-audit/site-audit-finalizer.findings.test.ts`

The hook goes AFTER the terminal update + `closeBatchIfDrained` + promoter kick, as fire-and-forget (`void …​.catch(log)`) — it must never delay or block the legacy completion side effects (spec "Hook points", A1 invariant: `finalizeSiteAudit` semantics unchanged).

- [ ] **Step 1: Write the failing test (new file)**

```typescript
// lib/ada-audit/site-audit-finalizer.findings.test.ts
//
// A2 Phase 2: the finalizer's fire-and-forget findings dual-write.
// Separate file from site-audit-finalizer.test.ts because it mocks
// lib/findings/writer with a failure-injectable wrapper.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/audit-batch-helpers', () => ({
  closeBatchIfDrained: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ada-audit/queue-manager', () => ({
  processNext: vi.fn(async () => undefined),
}))

// vi.mock factories are hoisted above module scope — a plain `let` would be
// in the temporal dead zone when the factory runs. vi.hoisted is the
// sanctioned escape hatch for mutable mock state.
const state = vi.hoisted(() => ({ failWrites: false }))
vi.mock('@/lib/findings/writer', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/findings/writer')>()
  return {
    writeFindingsRun: vi.fn(async (bundle: Parameters<typeof real.writeFindingsRun>[0]) => {
      if (state.failWrites) throw new Error('injected findings failure')
      return real.writeFindingsRun(bundle)
    }),
  }
})

const { prisma } = await import('@/lib/db')
const { finalizeSiteAudit } = await import('./site-audit-finalizer')
const { processNext } = await import('@/lib/ada-audit/queue-manager')

const DOMAIN_PREFIX = 'finalize-findings-'

const AXE_BLOB = JSON.stringify({
  violations: [{
    id: 'color-contrast', impact: 'serious', help: 'contrast', description: 'c',
    helpUrl: 'https://example.org', tags: ['wcag2aa'],
    nodes: [{ html: '<a>x</a>', target: ['a'] }],
  }],
  passes: [], incomplete: [], inapplicable: [],
  timestamp: '2026-06-10T00:00:00Z', url: 'https://x/',
  testEngine: { name: 'axe-core', version: '4.10' },
  testRunner: { name: 'er-seo-tools' },
})

async function clearTestState() {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: DOMAIN_PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: DOMAIN_PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: DOMAIN_PREFIX } } })
}

async function makeDrainedAudit() {
  const domain = `${DOMAIN_PREFIX}${Math.random().toString(36).slice(2, 8)}.example`
  const site = await prisma.siteAudit.create({
    data: {
      domain, status: 'running', discoveredUrls: '[]', wcagLevel: 'wcag21aa',
      pagesTotal: 2, pagesComplete: 1, pagesError: 1,
      startedAt: new Date(),
    },
  })
  await prisma.adaAudit.createMany({
    data: [
      { url: `https://${domain}/a`, status: 'complete', result: AXE_BLOB, siteAuditId: site.id, wcagLevel: 'wcag21aa' },
      { url: `https://${domain}/b`, status: 'error', error: 'timeout', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    ],
  })
  return site
}

describe('finalizeSiteAudit — findings dual-write hook', () => {
  beforeEach(async () => {
    state.failWrites = false
    vi.mocked(processNext).mockClear()
    await clearTestState()
  })

  it('writes a CrawlRun when the audit completes', async () => {
    const site = await makeDrainedAudit()
    await finalizeSiteAudit(site.id)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('complete')

    // The write is fire-and-forget — poll for it.
    await vi.waitFor(async () => {
      const run = await prisma.crawlRun.findUnique({
        where: { siteAuditId: site.id },
        include: { pages: true, findings: true, violations: true },
      })
      expect(run).not.toBeNull()
      expect(run!.status).toBe('partial') // pagesError = 1
      expect(run!.pages).toHaveLength(2)
      expect(run!.findings).toHaveLength(1)
      expect(run!.violations).toHaveLength(1)
      expect(run!.completedAt).not.toBeNull()
    })
  })

  it('a findings failure never affects completion, batch close, or the promoter kick', async () => {
    state.failWrites = true
    const site = await makeDrainedAudit()
    await finalizeSiteAudit(site.id)
    const after = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(after?.status).toBe('complete')
    expect(after?.summary).not.toBeNull()
    expect(processNext).toHaveBeenCalled()
    // give the rejected write a tick to surface if it were going to throw
    await new Promise((r) => setTimeout(r, 50))
    expect(await prisma.crawlRun.count({ where: { siteAuditId: site.id } })).toBe(0)
  })

  it('does not write a run for a non-drained audit', async () => {
    const site = await prisma.siteAudit.create({
      data: {
        domain: `${DOMAIN_PREFIX}pending.example`, status: 'running',
        discoveredUrls: '[]', wcagLevel: 'wcag21aa',
        pagesTotal: 2, pagesComplete: 1,
      },
    })
    await finalizeSiteAudit(site.id)
    await new Promise((r) => setTimeout(r, 50))
    expect(await prisma.crawlRun.count({ where: { siteAuditId: site.id } })).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/site-audit-finalizer.findings.test.ts`
Expected: FAIL — first test times out waiting for a `CrawlRun` (hook doesn't exist yet). The failure-injection and non-drained tests may already pass; that's fine.

- [ ] **Step 3: Implement the hook in `lib/ada-audit/site-audit-finalizer.ts`**

Add the imports at the top, with the existing `./` imports:

```typescript
import { mapAdaChildren } from '@/lib/findings/ada-mapper'
import { writeFindingsRun } from '@/lib/findings/writer'
```

Widen the scalar select (the mapper needs parent fields — spec "Hook points"):

```typescript
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: {
      status: true, batchId: true, discoveredUrls: true,
      domain: true, clientId: true, wcagLevel: true, startedAt: true,
      pagesTotal: true, pagesComplete: true, pagesError: true, pagesRedirected: true,
      pdfsTotal: true, pdfsComplete: true, pdfsError: true, pdfsSkipped: true,
      lighthouseTotal: true, lighthouseComplete: true, lighthouseError: true,
    },
  })
```

Hoist the completion timestamp so the legacy update and the bundle agree
(replace the inline `new Date()` in the terminal update):

```typescript
  // All drained — NOW load the children for the summary build.
  // Deterministic order (A2): the findings mapper's keep-first URL dedupe
  // must keep the same child here as in writeAdaSiteFindings/compareAdaParity.
  // Harmless to the summary build (it re-sorts pages itself).
  const pageAudits = await prisma.adaAudit.findMany({
    where: { siteAuditId: id },
    include: { pdfAudits: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const summary = buildSiteAuditSummary(pageAudits)
  const completedAt = new Date()
  await prisma.siteAudit.update({
    where: { id },
    data: {
      status: 'complete',
      summary: JSON.stringify(summary),
      completedAt,
    },
  })
```

Then append AFTER the existing `closeBatchIfDrained` call and the
`processNext` kick block, at the end of the function:

```typescript
  // Dual-write the normalized findings run (A2 Phase 2). Fire-and-forget and
  // best-effort: must never delay or fail the legacy completion side effects
  // above. The bundle maps from the already-loaded children — no second load.
  try {
    const bundle = mapAdaChildren(
      {
        id,
        domain: audit.domain,
        clientId: audit.clientId,
        wcagLevel: audit.wcagLevel,
        pagesError: audit.pagesError,
        startedAt: audit.startedAt,
        completedAt,
      },
      pageAudits,
    )
    void writeFindingsRun(bundle).catch((e) => {
      console.error('[findings] ADA dual-write failed for site audit', id, e)
    })
  } catch (e) {
    console.error('[findings] ADA bundle mapping failed for site audit', id, e)
  }
```

- [ ] **Step 4: Update clearTestState in the EXISTING finalizer test file**

The existing `lib/ada-audit/site-audit-finalizer.test.ts` audits now produce
`CrawlRun` rows when they complete. In its `clearTestState`, add one line
first:

```typescript
async function clearTestState() {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: 'finalize-test-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://finalize-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'finalize-test-' } } })
}
```

- [ ] **Step 5: Run both finalizer test files**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/site-audit-finalizer.findings.test.ts lib/ada-audit/site-audit-finalizer.test.ts`
Expected: PASS (3 new + 12 existing).

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/site-audit-finalizer.ts lib/ada-audit/site-audit-finalizer.test.ts lib/ada-audit/site-audit-finalizer.findings.test.ts
git commit -m "feat(findings): site-audit finalizer dual-write hook (fire-and-forget)"
```

---

### Task 4: Standalone audit hook (`app/api/ada-audit/route.ts`)

**Files:**
- Modify: `app/api/ada-audit/route.ts` (the `runAuditInBackground` function, lines ~14–86)

No new unit test — the background runner needs real Chrome; the write entry is
fully covered by `ada-write.test.ts`, and the hook is two one-liners verified
by tsc + production verification (same approach as the Phase-1 parser hook,
which leaned on `seo-write.test.ts`).

- [ ] **Step 1: Add the import**

At the top of `app/api/ada-audit/route.ts`, with the other `@/lib` imports:

```typescript
import { writeAdaSingleFindings } from '@/lib/findings/ada-write'
```

- [ ] **Step 2: Hook the `redirected` outcome**

In `runAuditInBackground`, inside the `if (result.kind === 'redirected')`
block, between the `prisma.adaAudit.update` and the `return`:

```typescript
      // Dual-write the normalized findings run (A2): a redirected standalone
      // still gets a CrawlRun + one redirected CrawlPage, no findings.
      // Best-effort — never affects the legacy path.
      void writeAdaSingleFindings(id).catch((e) => {
        console.error('[findings] dual-write failed for ada audit', id, e)
      })
      return
```

- [ ] **Step 3: Hook the `complete` outcome**

After the `void dispatchPdfScans({ ... })` call (PDF dispatch stays first —
standalone completion is not gated on findings any more than on PDFs):

```typescript
    // Dual-write the normalized findings run (A2). Best-effort: the blob
    // committed above is the source of truth; a findings failure must never
    // fail the audit.
    void writeAdaSingleFindings(id).catch((e) => {
      console.error('[findings] dual-write failed for ada audit', id, e)
    })
```

- [ ] **Step 4: Verify compile**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/ada-audit/route.ts
git commit -m "feat(findings): standalone ADA audit dual-write hook (complete + redirected)"
```

---

### Task 5: ADA parity comparators (`lib/findings/parity.ts`)

**Files:**
- Modify: `lib/findings/parity.ts` (append; `compareSeoParity` and `ParityReport` stay untouched)
- Modify: `lib/findings/parity.test.ts` (append two describes)

- [ ] **Step 1: Write the failing tests (append to `lib/findings/parity.test.ts`)**

Add to the existing imports:

```typescript
import { writeAdaSiteFindings, writeAdaSingleFindings } from './ada-write'
import { compareAdaParity, compareAdaSingleParity } from './parity'
```

Append the describes:

```typescript
const ADA_DOMAIN = 'par-ada.test'

const ADA_AXE_BLOB = JSON.stringify({
  violations: [
    {
      id: 'color-contrast', impact: 'serious', help: 'contrast', description: 'c',
      helpUrl: 'https://example.org/cc', tags: ['wcag2aa'],
      nodes: [{ html: '<a>x</a>', target: ['a'] }, { html: '<p>y</p>', target: ['p'] }],
    },
    {
      id: 'image-alt', impact: 'critical', help: 'alt', description: 'a',
      helpUrl: 'https://example.org/ia', tags: ['wcag2a'],
      nodes: [{ html: '<img>', target: ['img'] }],
    },
  ],
  passes: [], incomplete: [], inapplicable: [],
  timestamp: '2026-06-10T00:00:00Z', url: `https://${ADA_DOMAIN}/`,
  testEngine: { name: 'axe-core', version: '4.10' },
  testRunner: { name: 'er-seo-tools' },
})

// summary.aggregate matching the blob above: 1 critical + 1 serious.
const ADA_SUMMARY = JSON.stringify({
  aggregate: { critical: 1, serious: 1, moderate: 0, minor: 0, total: 2, passed: 0, incomplete: 0 },
  pdfsAggregate: { total: 0, complete: 0, errored: 0, skipped: 0, withIssues: 0 },
  pages: [],
})

async function clearAdaTestState() {
  await prisma.crawlRun.deleteMany({ where: { domain: ADA_DOMAIN } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: ADA_DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: ADA_DOMAIN } })
}

describe('compareAdaParity', () => {
  let siteId: string

  beforeEach(async () => {
    await clearAdaTestState()
    const site = await prisma.siteAudit.create({
      data: {
        domain: ADA_DOMAIN, status: 'complete', wcagLevel: 'wcag21aa',
        pagesTotal: 2, pagesComplete: 1, pagesRedirected: 1,
        summary: ADA_SUMMARY, startedAt: new Date(), completedAt: new Date(),
      },
    })
    siteId = site.id
    await prisma.adaAudit.createMany({
      data: [
        { url: `https://${ADA_DOMAIN}/a`, status: 'complete', result: ADA_AXE_BLOB, siteAuditId: siteId, wcagLevel: 'wcag21aa' },
        { url: `https://${ADA_DOMAIN}/old`, status: 'redirected', finalUrl: `https://${ADA_DOMAIN}/new`, siteAuditId: siteId, wcagLevel: 'wcag21aa' },
      ],
    })
  })
  afterEach(clearAdaTestState)

  it('reports ok when tables match the child blobs and summary aggregate', async () => {
    await writeAdaSiteFindings(siteId)
    const report = await compareAdaParity(siteId)
    expect(report.diffs).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('reports a diff when a violation row is missing', async () => {
    await writeAdaSiteFindings(siteId)
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { siteAuditId: siteId } })
    await prisma.finding.deleteMany({ where: { runId: run.id, type: 'image-alt' } })
    const report = await compareAdaParity(siteId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/image-alt/)
  })

  it('reports a diff when a stored nodeCount diverges from the blob', async () => {
    await writeAdaSiteFindings(siteId)
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { siteAuditId: siteId } })
    await prisma.violation.updateMany({
      where: { runId: run.id, ruleId: 'color-contrast' },
      data: { nodeCount: 99 },
    })
    const report = await compareAdaParity(siteId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/nodeCount/)
  })

  it('reports ONLY an aggregate diff when summary.aggregate disagrees with the Violation rows', async () => {
    await writeAdaSiteFindings(siteId)
    // Corrupt the summary blob, NOT the rows: the stored rows still match the
    // child blobs (no missing-Finding noise), so any diff comes solely from
    // the independent Violation-rows-vs-summary.aggregate cross-check.
    const corrupted = JSON.parse(ADA_SUMMARY)
    corrupted.aggregate.critical = 5
    await prisma.siteAudit.update({
      where: { id: siteId },
      data: { summary: JSON.stringify(corrupted) },
    })
    const report = await compareAdaParity(siteId)
    expect(report.ok).toBe(false)
    expect(report.diffs).toEqual(['aggregate critical: violation rows=1 summary.aggregate=5'])
  })

  it('reports a diff when a complete site audit has no summary blob', async () => {
    await writeAdaSiteFindings(siteId)
    await prisma.siteAudit.update({ where: { id: siteId }, data: { summary: null } })
    const report = await compareAdaParity(siteId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/summary blob missing/)
  })

  it('reports a diff when no run exists at all', async () => {
    const report = await compareAdaParity(siteId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/no CrawlRun/i)
  })
})

describe('compareAdaSingleParity', () => {
  let auditId: string

  beforeEach(async () => {
    await clearAdaTestState()
    const audit = await prisma.adaAudit.create({
      data: {
        url: `https://${ADA_DOMAIN}/solo`, status: 'complete', result: ADA_AXE_BLOB,
        wcagLevel: 'wcag21aa', startedAt: new Date(), completedAt: new Date(),
      },
    })
    auditId = audit.id
  })
  afterEach(clearAdaTestState)

  it('reports ok when tables match the blob', async () => {
    await writeAdaSingleFindings(auditId)
    const report = await compareAdaSingleParity(auditId)
    expect(report.diffs).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('reports a diff when the stored run score diverges', async () => {
    await writeAdaSingleFindings(auditId)
    await prisma.crawlRun.update({ where: { adaAuditId: auditId }, data: { score: 1 } })
    const report = await compareAdaSingleParity(auditId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/score/)
  })

  it('reports a diff when no run exists at all', async () => {
    const report = await compareAdaSingleParity(auditId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/no CrawlRun/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/parity.test.ts`
Expected: FAIL — `compareAdaParity` / `compareAdaSingleParity` not exported. The pre-existing `compareSeoParity` describes still pass.

- [ ] **Step 3: Implement (append to `lib/findings/parity.ts`)**

Add to the imports:

```typescript
import type { CrawlPage, Finding, Violation } from '@prisma/client'
import type { SiteAuditSummary } from '@/lib/ada-audit/types'
import { mapAdaChildren, mapAdaSingle } from './ada-mapper'
import type { FindingsBundle } from './types'
```

Append:

```typescript
// ── ADA parity ──────────────────────────────────────────────────────────────
//
// Same same-mapper discipline as compareSeoParity: recompute the expected
// bundle from the child/standalone blobs via the live mappers, then diff
// against the stored rows. Plus one independent cross-check for site audits:
// the aggregate scorecard recomputed from stored Violation rows must match
// summary.aggregate (the blob the UI renders) — this is the check that can
// surface real divergence the same-mapper diff cannot.

type StoredRun = {
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
    for (const field of ['status', 'error', 'finalUrl', 'score', 'adaAuditId'] as const) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/parity.test.ts`
Expected: PASS (3 pre-existing SEO + 9 new ADA tests).

- [ ] **Step 5: Commit**

```bash
git add lib/findings/parity.ts lib/findings/parity.test.ts
git commit -m "feat(findings): ADA parity comparators (site + standalone)"
```

---

### Task 6: CLI scripts — auto-detect id type

**Files:**
- Modify: `scripts/findings-rebuild.ts`
- Modify: `scripts/findings-parity.ts`

No vitest tests — thin wrappers over already-tested lib functions; verified by
running them. Existing session behavior (positional `<sessionId>`) is preserved.

- [ ] **Step 1: Rewrite `scripts/findings-rebuild.ts`**

```typescript
// scripts/findings-rebuild.ts
//
// Rebuild the findings run for one origin row from its archived blob.
// Auto-detects the id type: SEO parse session, ADA site audit, or
// standalone ADA page audit. Recovery tool for failed dual-writes of NEW
// (current-format) runs — NOT a historical backfill tool.
//
// Usage (local):  DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-rebuild.ts <sessionId|siteAuditId|adaAuditId>
// Usage (prod):   cd $APP_HOME && npx tsx scripts/findings-rebuild.ts <id>
import { prisma } from '../lib/db'
import { writeSeoFindings } from '../lib/findings/seo-write'
import { writeAdaSiteFindings, writeAdaSingleFindings } from '../lib/findings/ada-write'
import type { AggregatedResult } from '../lib/types'

async function printRun(where: { sessionId: string } | { siteAuditId: string } | { adaAuditId: string }) {
  const run = await prisma.crawlRun.findUnique({
    where,
    include: { _count: { select: { pages: true, findings: true, violations: true } } },
  })
  console.log(
    `rebuilt run ${run!.id}: ${run!._count.pages} pages, ${run!._count.findings} findings, ${run!._count.violations} violations`,
  )
}

async function main() {
  const id = process.argv[2]
  if (!id) {
    console.error('Usage: npx tsx scripts/findings-rebuild.ts <sessionId|siteAuditId|adaAuditId>')
    process.exit(1)
  }

  const [session, siteAudit, adaAudit] = await Promise.all([
    prisma.session.findUnique({ where: { id }, select: { result: true, clientId: true, status: true } }),
    prisma.siteAudit.findUnique({ where: { id }, select: { id: true } }),
    prisma.adaAudit.findUnique({ where: { id }, select: { id: true, siteAuditId: true } }),
  ])

  if (session) {
    if (session.status !== 'complete' || !session.result) {
      throw new Error(`session ${id} is not a completed run with a result blob`)
    }
    const result = JSON.parse(session.result) as AggregatedResult
    await writeSeoFindings(id, result, session.clientId)
    await printRun({ sessionId: id })
  } else if (siteAudit) {
    await writeAdaSiteFindings(id)
    await printRun({ siteAuditId: id })
  } else if (adaAudit) {
    await writeAdaSingleFindings(id) // throws its own message for child rows
    await printRun({ adaAuditId: id })
  } else {
    throw new Error(`no session, site audit, or ada audit with id ${id}`)
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Rewrite `scripts/findings-parity.ts`**

```typescript
// scripts/findings-parity.ts
//
// Blob-vs-tables parity for one origin row. Auto-detects the id type: SEO
// parse session, ADA site audit, or standalone ADA page audit. Run against
// production for 3-5 representative clients before flipping any reader
// (A2 Phase 3).
//
// Usage: DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-parity.ts <sessionId|siteAuditId|adaAuditId>
import { prisma } from '../lib/db'
import { compareSeoParity, compareAdaParity, compareAdaSingleParity } from '../lib/findings/parity'

async function main() {
  const id = process.argv[2]
  if (!id) {
    console.error('Usage: npx tsx scripts/findings-parity.ts <sessionId|siteAuditId|adaAuditId>')
    process.exit(1)
  }

  const [session, siteAudit, adaAudit] = await Promise.all([
    prisma.session.findUnique({ where: { id }, select: { id: true } }),
    prisma.siteAudit.findUnique({ where: { id }, select: { id: true } }),
    prisma.adaAudit.findUnique({ where: { id }, select: { id: true } }),
  ])

  const [kind, report] = session
    ? ['session', await compareSeoParity(id)] as const
    : siteAudit
      ? ['site audit', await compareAdaParity(id)] as const
      : adaAudit
        ? ['ada audit', await compareAdaSingleParity(id)] as const
        : ['session', await compareSeoParity(id)] as const // unknown id → same "missing" report as before

  if (report.ok) {
    console.log(`PARITY OK for ${kind} ${id}`)
  } else {
    console.log(`PARITY FAILED for ${kind} ${id}:`)
    for (const d of report.diffs) console.log(`  - ${d}`)
    process.exitCode = 1
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 3: Smoke-test both against the dev DB**

```bash
DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-rebuild.ts does-not-exist; echo "exit=$?"
DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-parity.ts does-not-exist; echo "exit=$?"
```

Expected: rebuild prints `no session, site audit, or ada audit with id does-not-exist`, exit 1; parity prints `PARITY FAILED for session does-not-exist` with the "session missing" diff, exit 1. No stack-trace crashes from missing-args handling.

- [ ] **Step 4: Commit**

```bash
git add scripts/findings-rebuild.ts scripts/findings-parity.ts
git commit -m "feat(findings): rebuild + parity CLIs auto-detect ADA origins"
```

---

### Task 7: Full verification + PR

- [ ] **Step 1: Full test suite**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run`
Expected: all green (1,753 pre-existing + ~26 new). If unrelated queue tests
flake on stray audits, re-run once (known shared-dev-DB sensitivity).

- [ ] **Step 2: Type-check + build**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npm run build
```

Expected: both clean.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/findings-layer-phase2
gh pr create --title "feat(findings): Phase 2 — ADA dual-write (site + standalone)" --body "$(cat <<'EOF'
## Summary
A2 (normalized findings layer) Phase 2 of 4 — see docs/superpowers/specs/2026-06-10-findings-layer-design.md (Codex-reviewed). No schema changes (the full schema shipped in Phase 1, PR #55).

- lib/findings/ada-mapper.ts: pure mappers — mapAdaChildren (site audits, from the finalizer's already-loaded children) + mapAdaSingle (standalone, incl. redirected → run + one redirected CrawlPage, no findings). Severity mapping critical/serious→critical, moderate→warning, minor→notice; exact axe impact kept on Violation ('unknown' sentinel for null); nodes capped at 5 × 300 chars; keep-first URL dedupe (PR #56 lesson); scores computed by the mapper, never read from scalar columns
- Hooks: finalizeSiteAudit (AFTER terminal update + batch close + promoter kick, fire-and-forget) and the standalone background runner (complete + redirected) — both best-effort, legacy path untouched
- lib/findings/ada-write.ts: fetch-map-write entries for the standalone hook + rebuild script
- compareAdaParity / compareAdaSingleParity incl. the independent Violation-rows-vs-summary.aggregate cross-check
- scripts/findings-rebuild.ts + findings-parity.ts auto-detect the id type (session / site audit / standalone ada audit)

## Post-deploy verification
1. Run a fresh standalone audit and a fresh small site audit
2. `npx tsx scripts/findings-parity.ts <siteAuditId>` and `<adaAuditId>` on the server → PARITY OK
3. Confirm audit UX is unchanged (hooks are non-fatal + post-completion)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope for this plan (later A2 phases)

- **Phase 3:** production parity on 3–5 representative clients (fresh parse +
  fresh site audit each), SessionPage reader flip + stop writing SessionPage.
- **Phase 4:** `pruneArchivedBlobs()` retention (inert activation constants),
  CLAUDE.md + roadmap updates.
