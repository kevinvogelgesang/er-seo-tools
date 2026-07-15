# C3 — ADA Run Diffing + Blob-Archive Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instance-level (URL×rule) ADA run-over-run diffing with regression surfacing, plus activation of the ada-audit 90-day blob archive (`PRUNE_ACTIVATED['ada-audit'] = true`) with every reader flipped to a findings-table fallback.

**Architecture:** Pure diff classifier in `findings-shared.ts` keyed on `Finding.dedupKey` with page-set awareness; a DB service that selects a domain+wcagLevel-matched previous run; two fallback builders (`buildSummaryFromFindings`, `buildArchivedAxeResults`) that reconstruct degraded views from `CrawlPage`/`Violation` rows; retention extended to child blobs + screenshots. Spec: `docs/superpowers/specs/2026-06-12-ada-run-diffing-design.md` (Codex ×6, all applied).

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, vitest. House rules: array-form `$transaction` only; findings hook stays LAST; never backfill blobs; DB tests use unique domain prefixes + tracked-id cleanup; local commands prefix `DATABASE_URL="file:./local-dev.db"`; `prisma migrate dev` is interactive-only — write migration SQL by hand, apply with `prisma migrate deploy`.

---

### Task 0: Branch

- [ ] **Step 0.1:** `git checkout -b feat/ada-run-diffing` from up-to-date `main`.

---

### Task 1: `CrawlPage.passCount` / `incompleteCount` (schema → types → mappers → parity)

**Files:**
- Modify: `prisma/schema.prisma` (CrawlPage model)
- Create: `prisma/migrations/20260612100000_c3_pass_counts/migration.sql`
- Modify: `lib/findings/types.ts` (CrawlPageInput)
- Modify: `lib/findings/ada-mapper.ts` (parseViolations → parseAxe; both mappers)
- Modify: `lib/findings/seo-mapper.ts` (null-fill the two new fields on every CrawlPageInput it builds)
- Modify: `lib/findings/parity.ts` (compare counts with null-skip)
- Test: `lib/findings/ada-mapper.test.ts` (extend), `lib/findings/parity.test.ts` (extend)

`lib/findings/writer.ts` needs **no code change** (it passes typed inputs straight to `createMany`), but verify the CHUNK=50 comment math still holds: CrawlPage goes 15 → 17 columns, 50 × 17 = 850 < 999. Update the comment's column count.

- [ ] **Step 1.1: Schema + migration.** In `prisma/schema.prisma`, after `score Int?` in `model CrawlPage`:

```prisma
  score           Int?     // ada page score (mapper-computed)
  passCount       Int?     // axe passes.length at write time; null = unknown (pre-C3 run)
  incompleteCount Int?     // axe incomplete.length at write time; null = unknown (pre-C3 run)
```

Create `prisma/migrations/20260612100000_c3_pass_counts/migration.sql`:

```sql
ALTER TABLE "CrawlPage" ADD COLUMN "passCount" INTEGER;
ALTER TABLE "CrawlPage" ADD COLUMN "incompleteCount" INTEGER;
```

Run: `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`
Expected: migration applied, client regenerated.

- [ ] **Step 1.2: Types.** In `lib/findings/types.ts`, add to `CrawlPageInput` after `score`:

```ts
  score: number | null
  passCount: number | null
  incompleteCount: number | null
  adaAuditId: string | null
```

- [ ] **Step 1.3: Failing mapper tests.** In `lib/findings/ada-mapper.test.ts`, add (reusing the file's existing fixture helpers for a stored result blob — follow its local builder for `result` JSON):

```ts
it('stamps passCount/incompleteCount from the blob on complete pages', () => {
  const result = JSON.stringify({
    violations: [],
    passes: [{ id: 'p1', help: '', nodes: [] }, { id: 'p2', help: '', nodes: [] }],
    incomplete: [{ id: 'i1', help: '', impact: null, nodes: [] }],
  })
  const bundle = mapAdaChildren(parentFixture(), [
    { id: 'c1', url: 'https://x.example/a', status: 'complete', error: null, finalUrl: null, result },
  ])
  expect(bundle.pages[0].passCount).toBe(2)
  expect(bundle.pages[0].incompleteCount).toBe(1)
})

it('leaves counts null on error/redirected/malformed pages', () => {
  const bundle = mapAdaChildren(parentFixture(), [
    { id: 'c1', url: 'https://x.example/a', status: 'error', error: 'boom', finalUrl: null, result: null },
    { id: 'c2', url: 'https://x.example/b', status: 'complete', error: null, finalUrl: null, result: '{not json' },
  ])
  expect(bundle.pages[0].passCount).toBeNull()
  expect(bundle.pages[1].passCount).toBeNull()
  expect(bundle.pages[1].incompleteCount).toBeNull()
})

it('mapAdaSingle stamps counts', () => {
  const result = JSON.stringify({ violations: [], passes: [{ id: 'p', help: '', nodes: [] }], incomplete: [] })
  const bundle = mapAdaSingle({ ...singleFixture(), status: 'complete', result })
  expect(bundle.pages[0].passCount).toBe(1)
  expect(bundle.pages[0].incompleteCount).toBe(0)
})
```

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/ada-mapper.test.ts` — Expected: FAIL (fields undefined).

- [ ] **Step 1.4: Implement mapper.** In `lib/findings/ada-mapper.ts`, replace `parseViolations` with:

```ts
interface ParsedAxe {
  violations: AxeViolation[]
  passCount: number
  incompleteCount: number
}

/** null = blob missing/malformed (≠ a valid empty violations array): the
 *  page must NOT be scored — score 100 from an unreadable blob would lie. */
function parseAxe(result: string | null): ParsedAxe | null {
  if (!result) return null
  try {
    const r = JSON.parse(result) as StoredAxeResults
    if (!Array.isArray(r?.violations)) return null
    return {
      violations: r.violations,
      passCount: Array.isArray(r.passes) ? r.passes.length : 0,
      incompleteCount: Array.isArray(r.incomplete) ? r.incomplete.length : 0,
    }
  } catch {
    return null
  }
}
```

In `mapAdaChildren`: `const axe = child.status === 'complete' ? parseAxe(child.result) : null`; page fields become `score: axe ? computeScore(axe.violations, parent.wcagLevel).score : null, passCount: axe?.passCount ?? null, incompleteCount: axe?.incompleteCount ?? null`; the `emitPageViolations` call uses `axe.violations`. Same pattern in `mapAdaSingle` (`const axe = audit.status === 'complete' ? parseAxe(audit.result) : null`).

In `lib/findings/seo-mapper.ts`, every `CrawlPageInput` literal gains `passCount: null, incompleteCount: null` (grep `adaAuditId: null` to find them all).

- [ ] **Step 1.5:** Run mapper + seo-mapper + writer tests — Expected: PASS.
- [ ] **Step 1.6: Parity compares counts unconditionally** (Codex plan-fix #3 — a
null-skip would mask fresh writer regressions). Parity can only run when the
origin blob exists, and a rebuild always populates the counts — so a stored
null is a legitimate stale-row signal, never noise. In `lib/findings/parity.ts`,
add `passCount`/`incompleteCount` to **both** ADA per-page field-comparison
loops (site + single) exactly like the existing fields:

```ts
for (const field of ['passCount', 'incompleteCount'] as const) {
  if (stored[field] !== p[field]) {
    diffs.push(`CrawlPage ${p.url} ${field}: tables=${stored[field]} blob=${p[field]} (null = pre-C3 row; rebuild to populate)`)
  }
}
```

Add a parity test: rebuild a seeded audit (counts present both sides → PARITY
OK), then `updateMany` the stored pages to `passCount: null` and assert a diff
IS reported (stale pre-C3 shape), then `passCount: 999` → diff reported.

- [ ] **Step 1.7:** Run `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/` — Expected: all PASS. Commit: `feat(c3): CrawlPage.passCount/incompleteCount — schema, mappers, parity null-skip`

---

### Task 2: Pure classifier `diffInstances()`

**Files:**
- Modify: `lib/services/findings-shared.ts`
- Test: `lib/services/findings-shared.test.ts` (extend)

- [ ] **Step 2.1: Failing tests** (key cases; all pure):

```ts
import { diffInstances, type InstanceRef } from './findings-shared'

const ref = (type: string, url: string, severity = 'critical'): InstanceRef =>
  ({ dedupKey: `${type}|${url}`, type, severity, url })

describe('diffInstances', () => {
  const pages = (...urls: string[]) => new Set(urls)

  it('classifies regressed vs new-page vs unchanged vs resolved vs not-rescanned', () => {
    const current = [ref('color-contrast', '/a'), ref('color-contrast', '/new'), ref('label', '/a')]
    const previous = [ref('label', '/a'), ref('image-alt', '/a'), ref('image-alt', '/gone')]
    const d = diffInstances(current, previous, pages('/a', '/new'), pages('/a', '/gone'))
    expect(d.unchangedCount).toBe(1)          // label /a
    expect(d.regressedCount).toBe(1)          // color-contrast /a (page scanned before)
    expect(d.newPageCount).toBe(1)            // color-contrast /new
    expect(d.newCount).toBe(2)
    expect(d.resolvedCount).toBe(1)           // image-alt /a (page rescanned)
    expect(d.notRescannedCount).toBe(1)       // image-alt /gone (page absent now)
  })

  it('only changed rules appear in rules[], sorted severity then newTotal desc', () => {
    const current = [ref('b-rule', '/a', 'notice'), ref('a-rule', '/a'), ref('same', '/a')]
    const previous = [ref('same', '/a'), ref('resolved-rule', '/a', 'warning')]
    const d = diffInstances(current, previous, pages('/a'), pages('/a'))
    expect(d.rules.map((r) => r.type)).toEqual(['a-rule', 'resolved-rule', 'b-rule'])
    expect(d.rules.find((r) => r.type === 'same')).toBeUndefined()
  })

  it('resolved-only rules carry the previous severity; current severity wins when both', () => {
    const d = diffInstances(
      [ref('x', '/a', 'warning'), ref('x', '/b', 'warning')],
      [ref('x', '/c', 'critical'), ref('y', '/a', 'notice')],
      new Set(['/a', '/b', '/c']), new Set(['/a', '/c']),
    )
    expect(d.rules.find((r) => r.type === 'x')!.severity).toBe('warning')
    expect(d.rules.find((r) => r.type === 'y')!.severity).toBe('notice')
  })

  it('caps, dedupes and sorts URL samples, regressed before new-page', () => {
    const current = [
      ...Array.from({ length: 30 }, (_, i) => ref('big', `/n${String(i).padStart(2, '0')}`)),
      ref('big', '/z-regressed'),
    ]
    const d = diffInstances(current, [], new Set(), new Set(['/z-regressed']))
    const rule = d.rules[0]
    expect(rule.newUrls).toHaveLength(25)
    expect(rule.newUrls[0]).toBe('/z-regressed')
    expect(rule.newTotal).toBe(31)
  })

  it('clean previous run → everything new; identical runs → all unchanged', () => {
    const cur = [ref('x', '/a')]
    expect(diffInstances(cur, [], new Set(['/a']), new Set(['/a'])).regressedCount).toBe(1)
    const same = diffInstances(cur, cur, new Set(['/a']), new Set(['/a']))
    expect(same.unchangedCount).toBe(1)
    expect(same.newCount + same.resolvedCount + same.notRescannedCount).toBe(0)
  })
})
```

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/findings-shared.test.ts` — Expected: FAIL.

- [ ] **Step 2.2: Implement** in `lib/services/findings-shared.ts` (append):

```ts
// ── C3: instance-level (URL×rule) diffing ───────────────────────────────────
// Keyed on Finding.dedupKey (sha256 of scope+type+normalized url — stable
// across runs). Page-set awareness keeps the diff honest vs sitemap churn:
// a violation only counts as regressed/resolved when the page was actually
// scanned on the other side. Pure — no prisma.

export interface InstanceRef {
  dedupKey: string
  type: string
  severity: string
  url: string
}

export interface RuleInstanceDiff {
  type: string
  /** Current run's severity; previous run's for resolved-only rules. */
  severity: Severity
  /** Capped at URLS_PER_FINDING, deduped + sorted, regressed before new-page. */
  newUrls: string[]
  newTotal: number
  regressedTotal: number
  resolvedUrls: string[]
  resolvedTotal: number
  unchangedTotal: number
}

export interface InstanceDiff {
  newCount: number
  regressedCount: number
  newPageCount: number
  resolvedCount: number
  notRescannedCount: number
  unchangedCount: number
  /** Only rules with newTotal > 0 or resolvedTotal > 0, severity rank then newTotal desc. */
  rules: RuleInstanceDiff[]
}

interface RuleAcc {
  severity: Severity
  fromCurrent: boolean
  regressedUrls: string[]
  newPageUrls: string[]
  resolvedUrls: string[]
  unchangedTotal: number
}

const capSample = (urls: string[]) => [...new Set(urls)].sort().slice(0, URLS_PER_FINDING)

export function diffInstances(
  current: InstanceRef[],
  previous: InstanceRef[],
  currentPages: Set<string>,
  previousPages: Set<string>,
): InstanceDiff {
  const prevKeys = new Set(previous.map((p) => p.dedupKey))
  const curKeys = new Set(current.map((c) => c.dedupKey))

  const byType = new Map<string, RuleAcc>()
  const acc = (type: string, severity: string, fromCurrent: boolean): RuleAcc => {
    let a = byType.get(type)
    if (!a) {
      a = { severity: toSeverity(severity), fromCurrent, regressedUrls: [], newPageUrls: [], resolvedUrls: [], unchangedTotal: 0 }
      byType.set(type, a)
    } else if (fromCurrent && !a.fromCurrent) {
      a.severity = toSeverity(severity) // current run's severity wins
      a.fromCurrent = true
    }
    return a
  }

  let newCount = 0, regressedCount = 0, newPageCount = 0
  let resolvedCount = 0, notRescannedCount = 0, unchangedCount = 0

  for (const c of current) {
    const a = acc(c.type, c.severity, true)
    if (prevKeys.has(c.dedupKey)) { unchangedCount++; a.unchangedTotal++; continue }
    newCount++
    if (previousPages.has(c.url)) { regressedCount++; a.regressedUrls.push(c.url) }
    else { newPageCount++; a.newPageUrls.push(c.url) }
  }
  for (const p of previous) {
    if (curKeys.has(p.dedupKey)) continue
    if (currentPages.has(p.url)) {
      resolvedCount++
      acc(p.type, p.severity, false).resolvedUrls.push(p.url)
    } else {
      notRescannedCount++
    }
  }

  const rules: RuleInstanceDiff[] = []
  for (const [type, a] of byType) {
    const newTotal = a.regressedUrls.length + a.newPageUrls.length
    const resolvedTotal = a.resolvedUrls.length
    if (newTotal === 0 && resolvedTotal === 0) continue
    rules.push({
      type,
      severity: a.severity,
      newUrls: [...capSample(a.regressedUrls), ...capSample(a.newPageUrls)].slice(0, URLS_PER_FINDING),
      newTotal,
      regressedTotal: a.regressedUrls.length,
      resolvedUrls: capSample(a.resolvedUrls),
      resolvedTotal,
      unchangedTotal: a.unchangedTotal,
    })
  }
  rules.sort((x, y) =>
    SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || y.newTotal - x.newTotal || x.type.localeCompare(y.type))

  return { newCount, regressedCount, newPageCount, resolvedCount, notRescannedCount, unchangedCount, rules }
}
```

- [ ] **Step 2.3:** Run the test file — Expected: PASS. Commit: `feat(c3): diffInstances — page-set-aware instance classifier`

---

### Task 3: DB service `lib/services/site-audit-diff.ts`

**Files:**
- Create: `lib/services/site-audit-diff.ts`
- Test: `lib/services/site-audit-diff.test.ts` (DB-backed; domain prefix `c3diff-*.example`, pre-clean in `beforeAll`, clean CrawlRun by domain in `afterAll`, track created ids)

- [ ] **Step 3.1: Failing DB tests.** Seed helper writes a CrawlRun + complete CrawlPages + page-scope Findings directly via prisma (use real `pageFindingKey` from `lib/findings/keys.ts` so dedupKeys match across runs). Cases:

```ts
// 1. two same-domain same-level site runs → diff computed; previous picked is
//    the most recent earlier run (seed three, assert middle ignored)
// 2. wcagLevel mismatch on getSiteAuditInstanceDiff → previous skipped entirely
//    (level filter is in the candidate WHERE) → null when no same-level earlier run
// 3. getRunPairInstanceDiff with mismatched levels → null (Codex spec-fix #1)
// 3b. getRunPairInstanceDiff with a tool='seo-parser' run on either side → null
//     (Codex plan-fix #6)
// 4. no CrawlRun for the siteAuditId (pre-A2) → null
// 5. id-desc tie-break: two candidates with identical completedAt → higher id wins
// 6. classification round-trip: a finding present in prev only, url present in
//    current pages → resolvedCount 1; url absent → notRescannedCount 1
```

Write each as a real test using the seed helper; assert `previous.siteAuditId` flows through. Run — Expected: FAIL (module missing).

- [ ] **Step 3.2: Implement**:

```ts
// lib/services/site-audit-diff.ts
//
// C3: instance-level run-over-run diff selection + loading. Previous-run
// selection for the results page is domain-scoped and client-agnostic
// (domain is the identity), wcagLevel-matched (mixed levels produce false
// "new" instances — spec § 4.2), with B2's ordering: completedAt ?? createdAt
// desc, id-desc tie-break. Reads normalized tables ONLY — never blobs.

import { prisma } from '@/lib/db'
import { diffInstances, type InstanceDiff, type InstanceRef } from './findings-shared'

export interface SiteAuditDiffResult {
  diff: InstanceDiff
  previous: { runId: string; siteAuditId: string | null; completedAt: string | null }
}

type RunStamp = { id: string; completedAt: Date | null; createdAt: Date }
const runTime = (r: RunStamp) => (r.completedAt ?? r.createdAt).getTime()
const isEarlier = (r: RunStamp, cur: RunStamp) =>
  runTime(r) < runTime(cur) || (runTime(r) === runTime(cur) && r.id.localeCompare(cur.id) < 0)

async function loadAndDiff(currentRunId: string, previousRunId: string): Promise<InstanceDiff> {
  const select = { dedupKey: true, type: true, severity: true, url: true } as const
  const [curFindings, prevFindings, completePages] = await Promise.all([
    prisma.finding.findMany({ where: { runId: currentRunId, scope: 'page' }, select }),
    prisma.finding.findMany({ where: { runId: previousRunId, scope: 'page' }, select }),
    prisma.crawlPage.findMany({
      where: { runId: { in: [currentRunId, previousRunId] }, status: 'complete' },
      select: { runId: true, url: true },
    }),
  ])
  const refs = (rows: typeof curFindings): InstanceRef[] =>
    rows.filter((f): f is typeof f & { url: string } => f.url !== null)
  return diffInstances(
    refs(curFindings),
    refs(prevFindings),
    new Set(completePages.filter((p) => p.runId === currentRunId).map((p) => p.url)),
    new Set(completePages.filter((p) => p.runId === previousRunId).map((p) => p.url)),
  )
}

/** Pair diff for callers that already selected the runs (dashboard, schedules
 *  card). Returns null when either run is missing or the wcagLevels differ —
 *  instance counts never render across a level mismatch (Codex spec-fix #1). */
export async function getRunPairInstanceDiff(
  currentRunId: string,
  previousRunId: string,
): Promise<InstanceDiff | null> {
  const select = { id: true, tool: true, wcagLevel: true } as const
  const [cur, prev] = await Promise.all([
    prisma.crawlRun.findUnique({ where: { id: currentRunId }, select }),
    prisma.crawlRun.findUnique({ where: { id: previousRunId }, select }),
  ])
  // Defensive tool check (Codex plan-fix #6): a future caller must not be
  // able to diff an SEO run against an ADA run with compatible-looking ids.
  if (!cur || !prev || cur.tool !== 'ada-audit' || prev.tool !== 'ada-audit') return null
  if (cur.wcagLevel !== prev.wcagLevel) return null
  return loadAndDiff(cur.id, prev.id)
}

/** Results-page entry: anchored at this audit's own run (not the latest). */
export async function getSiteAuditInstanceDiff(siteAuditId: string): Promise<SiteAuditDiffResult | null> {
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId },
    select: { id: true, domain: true, wcagLevel: true, completedAt: true, createdAt: true },
  })
  if (!run || run.domain === null) return null

  const candidates = await prisma.crawlRun.findMany({
    where: {
      tool: 'ada-audit',
      source: 'site-audit',
      domain: run.domain,
      wcagLevel: run.wcagLevel,
      id: { not: run.id },
    },
    select: { id: true, siteAuditId: true, completedAt: true, createdAt: true },
  })
  const previous = candidates
    .filter((c) => isEarlier(c, run))
    .sort((a, b) => runTime(b) - runTime(a) || b.id.localeCompare(a.id))[0] ?? null
  if (!previous) return null

  const diff = await loadAndDiff(run.id, previous.id)
  return {
    diff,
    previous: {
      runId: previous.id,
      siteAuditId: previous.siteAuditId,
      completedAt: previous.completedAt?.toISOString() ?? null,
    },
  }
}
```

- [ ] **Step 3.3:** Run the test file — Expected: PASS. Commit: `feat(c3): site-audit-diff service — level-matched previous selection + pair diff`

---

### Task 4: `detectCommonIssuesFromViolationRows` (common-issues refactor)

**Files:**
- Modify: `lib/ada-audit/common-issues.ts`
- Test: `lib/ada-audit/common-issues.test.ts` (extend)

- [ ] **Step 4.1: Failing tests:** seed 6 "pages" of violation rows where one rule hits 5/6 pages (tier `template`), assert exact `affectedPagesCount`/`totalPagesScanned`/tier; nodes JSON carrying `target: ['footer .x']` on all pages → `sharedAncestor: 'footer'`; rows with `nodes: null` still counted (hints null); `impact: 'unknown'` rows skipped; below `COMMON_ISSUE_MIN_PAGES` → `[]`. Also pin **zero behavior change** for the blob path: existing `detectCommonIssues` tests must stay green untouched.

- [ ] **Step 4.2: Implement.** Extract the tail of `detectCommonIssues` (the `out` build loop + sort, current lines ~309-352) into a private `finalizeCommonIssues(accumulator: Map<string, RuleAccumulator>, N: number): CommonIssue[]` (it computes `minHits` itself from N); `detectCommonIssues` calls it. Then add:

```ts
/** C3 archived-summary fallback input: one row per (page × rule), straight
 *  from Violation columns. Counts/tiers are EXACT (groupBy semantics);
 *  ancestor/selector hints are best-effort from the capped nodes JSON. */
export interface ViolationRowInput {
  pageId: string
  url: string
  ruleId: string
  impact: string
  help: string | null
  helpUrl: string | null
  nodes: string | null // capped [{html, target}] JSON from Violation.nodes
}

export function detectCommonIssuesFromViolationRows(
  rows: ViolationRowInput[],
  completePagesCount: number,
): CommonIssue[] {
  const N = completePagesCount
  if (N < COMMON_ISSUE_MIN_PAGES) return []

  const accumulator = new Map<string, RuleAccumulator>()
  for (const row of rows) {
    if (!(VALID_IMPACTS as readonly string[]).includes(row.impact)) continue // 'unknown' sentinel
    let nodes: RawNode[] = []
    if (row.nodes) {
      try {
        const parsed = JSON.parse(row.nodes)
        if (Array.isArray(parsed)) nodes = parsed as RawNode[]
      } catch { /* hints stay best-effort */ }
    }
    let entry = accumulator.get(row.ruleId)
    if (!entry) {
      entry = {
        metadata: {
          impact: row.impact as ImpactLevel,
          help: row.help ?? '',
          description: row.help ?? '', // Violation has no description column — degraded by contract
          helpUrl: row.helpUrl ?? '',
        },
        pageIds: new Set(),
        landmarkByPage: new Map(),
        pagesForSelector: [],
      }
      accumulator.set(row.ruleId, entry)
    }
    entry.pageIds.add(row.pageId)
    const pageLandmark = computeModalLandmarkForPage(nodes)
    if (pageLandmark) entry.landmarkByPage.set(row.pageId, pageLandmark)
    entry.pagesForSelector.push({
      url: row.url,
      nodes: nodes
        .filter((n): n is { target: string[] } => Array.isArray(n?.target))
        .map((n) => ({ target: n.target })),
    })
  }
  return finalizeCommonIssues(accumulator, N)
}
```

- [ ] **Step 4.3:** Run `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/common-issues.test.ts` — PASS. Commit: `feat(c3): detectCommonIssuesFromViolationRows — shared finalize, exact counts`

---

### Task 5: Fallback builders `lib/ada-audit/findings-fallback.ts` + type extensions

**Files:**
- Modify: `lib/ada-audit/types.ts`
- Create: `lib/ada-audit/findings-fallback.ts`
- Test: `lib/ada-audit/findings-fallback.test.ts` (DB-backed, domain prefix `c3fb-*.example`)

- [ ] **Step 5.1: Type extensions** in `lib/ada-audit/types.ts`:

```ts
/** Pass/incomplete counts preserved from the pruned blob; null = unknown
 *  (pre-C3 run). Drives "—" rendering — never coerce null to 0 (Codex #3/#4). */
export interface ArchivedCounts {
  passed: number | null
  incomplete: number | null
}
```

`StoredAxeResults` gains `archived?: boolean; archivedCounts?: ArchivedCounts`.
`SitePageResult` gains `archivedCounts?: ArchivedCounts`.
`SiteAuditSummary` gains `archived?: boolean; archivedCounts?: ArchivedCounts`.
The shared numeric `AuditScorecard` is **untouched**.

- [ ] **Step 5.2: Failing tests.** Seed one complete SiteAudit end-to-end shape: SiteAudit row + 6 child AdaAudit rows (5 complete with result blobs — one rule on all 5 pages for the commonIssues check — 1 redirected; one child with `lighthouseSummary` JSON and 2 PdfAudit rows: one complete-with-issues, one skipped), run the real `mapAdaChildren` + `writeFindingsRun` to populate findings, then call `buildSiteAuditSummary` on the children (the live builder) and `buildSummaryFromFindings(siteAuditId)` and compare:

```ts
// per-page scorecard impact counts identical; violationIds identical (set compare);
// pdfs state identical incl. skipped in pdfsAggregate; lighthouse passthrough identical;
// aggregate identical when passCount known (post-C3 mapper run);
// fallback.archived === true; commonIssues affectedPagesCount/tier identical, hints nullable;
// redirected page → minimal row (null scorecard, finalUrl, empty violationIds)
```

Plus: `updateMany` pages to `passCount: null` → fallback page `scorecard.passed === 0` **and** `archivedCounts.passed === null`; aggregate `archivedCounts.passed === null` when every page is null. Plus `buildArchivedAxeResults`: returns violations with parsed capped nodes + tags, `passes: []`, `archived: true`, counts; standalone (via `mapAdaSingle` seed) and site-child both resolve via `CrawlPage.adaAuditId`; unknown id → null; `impact: 'unknown'` row → `impact: null` on the synthesized violation.

Run — Expected: FAIL (module missing).

- [ ] **Step 5.3: Implement** `lib/ada-audit/findings-fallback.ts`:

```ts
// lib/ada-audit/findings-fallback.ts
//
// C3 read-time fallbacks for pruned origin/child blobs (spec § 5.2/5.3).
// Blob-first, findings-fallback: these run ONLY when a complete audit's blob
// is null and its CrawlRun exists. Degraded by contract: nodes capped 5×300,
// no screenshots, description = help, pass/incomplete via archivedCounts.

import { prisma } from '@/lib/db'
import type {
  ArchivedCounts, AuditScorecard, AxeNode, AxeViolation, ImpactLevel,
  SiteAuditSummary, SitePagePdfState, SitePageResult, StoredAxeResults,
} from './types'
import type { LighthouseSummary } from './lighthouse-types'
import type { PdfIssue } from './pdf-types'
import { ZERO_SCORECARD, addScorecards } from './site-audit-helpers'
import { detectCommonIssuesFromViolationRows, type ViolationRowInput } from './common-issues'

const REAL_IMPACTS: readonly string[] = ['critical', 'serious', 'moderate', 'minor']

type ViolationRow = {
  pageId: string
  ruleId: string
  impact: string
  wcagTags: string
  help: string | null
  helpUrl: string | null
  nodeCount: number
  nodes: string | null
}

function parseNodes(nodes: string | null): AxeNode[] {
  if (!nodes) return []
  try {
    const parsed = JSON.parse(nodes)
    if (!Array.isArray(parsed)) return []
    return parsed.map((n) => ({
      html: typeof n?.html === 'string' ? n.html : '',
      target: Array.isArray(n?.target) ? n.target : [],
    }))
  } catch {
    return []
  }
}

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function toAxeViolation(v: ViolationRow): AxeViolation {
  return {
    id: v.ruleId,
    impact: REAL_IMPACTS.includes(v.impact) ? (v.impact as ImpactLevel) : null,
    help: v.help ?? v.ruleId,
    description: v.help ?? '',
    helpUrl: v.helpUrl ?? '',
    tags: parseStringArray(v.wcagTags),
    nodes: parseNodes(v.nodes),
  }
}

function impactCounts(rows: ViolationRow[]): Pick<AuditScorecard, 'critical' | 'serious' | 'moderate' | 'minor'> {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  for (const v of rows) {
    if (v.impact in counts) counts[v.impact as keyof typeof counts]++
  }
  return counts
}

/** Degraded StoredAxeResults from Violation rows; resolves both standalone
 *  audits and site-audit children via CrawlPage.adaAuditId. Null when the
 *  audit has no findings page (pre-A2 / dual-write failure). */
export async function buildArchivedAxeResults(adaAuditId: string): Promise<StoredAxeResults | null> {
  const page = await prisma.crawlPage.findFirst({
    where: { adaAuditId },
    orderBy: { id: 'desc' },
    select: {
      id: true, url: true, passCount: true, incompleteCount: true,
      run: { select: { completedAt: true } },
    },
  })
  if (!page) return null

  const rows = await prisma.violation.findMany({
    where: { pageId: page.id },
    orderBy: [{ ruleId: 'asc' }, { id: 'asc' }],
    select: {
      pageId: true, ruleId: true, impact: true, wcagTags: true,
      help: true, helpUrl: true, nodeCount: true, nodes: true,
    },
  })

  return {
    violations: rows.map(toAxeViolation),
    passes: [],
    incomplete: [],
    inapplicable: [],
    timestamp: page.run.completedAt?.toISOString() ?? '',
    url: page.url,
    testEngine: { name: 'axe-core', version: '' },
    testRunner: { name: 'archived-findings' },
    archived: true,
    archivedCounts: { passed: page.passCount, incomplete: page.incompleteCount },
  }
}

/** Degraded SiteAuditSummary from CrawlPage/Violation rows + unpruned child
 *  scalars (lighthouseSummary, PdfAudit). Null when no CrawlRun exists. */
export async function buildSummaryFromFindings(siteAuditId: string): Promise<SiteAuditSummary | null> {
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId }, select: { id: true } })
  if (!run) return null

  const [pages, violations] = await Promise.all([
    prisma.crawlPage.findMany({
      where: { runId: run.id },
      orderBy: [{ url: 'asc' }],
      select: {
        id: true, url: true, status: true, error: true, finalUrl: true,
        adaAuditId: true, passCount: true, incompleteCount: true,
      },
    }),
    prisma.violation.findMany({
      where: { runId: run.id },
      orderBy: [{ ruleId: 'asc' }, { id: 'asc' }],
      select: {
        pageId: true, ruleId: true, impact: true, wcagTags: true,
        help: true, helpUrl: true, nodeCount: true, nodes: true,
      },
    }),
  ])

  const childIds = pages.map((p) => p.adaAuditId).filter((x): x is string => x !== null)
  const children = childIds.length
    ? await prisma.adaAudit.findMany({
        where: { id: { in: childIds } },
        select: { id: true, lighthouseSummary: true, pdfAudits: { select: { status: true, issues: true } } },
      })
    : []
  const childById = new Map(children.map((c) => [c.id, c]))

  const violationsByPage = new Map<string, ViolationRow[]>()
  for (const v of violations) {
    const list = violationsByPage.get(v.pageId) ?? []
    list.push(v)
    violationsByPage.set(v.pageId, list)
  }

  const pageResults: SitePageResult[] = pages.map((p) => {
    if (p.status === 'redirected') {
      return {
        adaAuditId: p.adaAuditId ?? '', url: p.url, status: 'redirected' as const,
        error: null, scorecard: null, lighthouse: null,
        pdfs: { total: 0, complete: 0, errored: 0, withIssues: 0 },
        finalUrl: p.finalUrl ?? null, violationIds: [],
      }
    }

    const mine = violationsByPage.get(p.id) ?? []
    const scorecard: AuditScorecard | null = p.status === 'complete'
      ? {
          ...impactCounts(mine),
          total: mine.length,
          passed: p.passCount ?? 0,
          incomplete: p.incompleteCount ?? 0,
        }
      : null

    const child = p.adaAuditId ? childById.get(p.adaAuditId) : undefined
    let lighthouse: LighthouseSummary | null = null
    if (child?.lighthouseSummary) {
      try { lighthouse = JSON.parse(child.lighthouseSummary) as LighthouseSummary } catch { lighthouse = null }
    }
    const pdfs: SitePagePdfState = { total: child?.pdfAudits.length ?? 0, complete: 0, errored: 0, withIssues: 0 }
    for (const pdf of child?.pdfAudits ?? []) {
      if (pdf.status === 'complete') {
        pdfs.complete++
        try {
          const issues = pdf.issues ? (JSON.parse(pdf.issues) as PdfIssue[]) : []
          if (Array.isArray(issues) && issues.length > 0) pdfs.withIssues++
        } catch { /* unparseable issues — counted complete, not withIssues */ }
      } else if (pdf.status === 'error') {
        pdfs.errored++
      }
    }

    return {
      adaAuditId: p.adaAuditId ?? '', url: p.url,
      status: (p.status === 'complete' ? 'complete' : 'error') as 'complete' | 'error',
      error: p.error ?? null, scorecard, lighthouse, pdfs,
      violationIds: [...new Set(mine.map((v) => v.ruleId))],
      archivedCounts: { passed: p.passCount, incomplete: p.incompleteCount },
    }
  })

  pageResults.sort((a, b) => (b.scorecard?.total ?? -1) - (a.scorecard?.total ?? -1))

  const aggregate = pageResults.reduce(
    (acc, p) => (p.scorecard ? addScorecards(acc, p.scorecard) : acc),
    { ...ZERO_SCORECARD },
  )

  const knownPass = pages.filter((p) => p.passCount !== null)
  const knownIncomplete = pages.filter((p) => p.incompleteCount !== null)
  const archivedCounts: ArchivedCounts = {
    passed: knownPass.length > 0 ? knownPass.reduce((s, p) => s + (p.passCount ?? 0), 0) : null,
    incomplete: knownIncomplete.length > 0 ? knownIncomplete.reduce((s, p) => s + (p.incompleteCount ?? 0), 0) : null,
  }

  const pdfsSkipped = children.reduce(
    (acc, c) => acc + c.pdfAudits.filter((pdf) => pdf.status === 'skipped').length, 0)
  const pdfsAggregate = pageResults.reduce(
    (acc, p) => ({
      total: acc.total + p.pdfs.total,
      complete: acc.complete + p.pdfs.complete,
      errored: acc.errored + p.pdfs.errored,
      skipped: acc.skipped,
      withIssues: acc.withIssues + p.pdfs.withIssues,
    }),
    { total: 0, complete: 0, errored: 0, skipped: pdfsSkipped, withIssues: 0 },
  )

  const completePageIds = new Set(pages.filter((p) => p.status === 'complete').map((p) => p.id))
  const pageUrlById = new Map(pages.map((p) => [p.id, p.url]))
  const commonRows: ViolationRowInput[] = violations
    .filter((v) => completePageIds.has(v.pageId))
    .map((v) => ({
      pageId: v.pageId, url: pageUrlById.get(v.pageId) ?? '',
      ruleId: v.ruleId, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes,
    }))
  const commonIssues = detectCommonIssuesFromViolationRows(commonRows, completePageIds.size)

  return { aggregate, pdfsAggregate, pages: pageResults, commonIssues, archived: true, archivedCounts }
}
```

- [ ] **Step 5.4:** Run the test file — PASS. Commit: `feat(c3): findings-fallback builders — degraded summary + axe results from Violation rows`

---

### Task 6: Retention extension + `PRUNE_ACTIVATED['ada-audit']` flip

**Files:**
- Modify: `lib/findings/retention.ts`
- Test: `lib/findings/retention.test.ts` (extend)

- [ ] **Step 6.1: Failing tests:** seed a >90d completed site-audit run (origin SiteAudit with summary + 3 child AdaAudits with result blobs + lighthouseSummary) and a >90d standalone; run `pruneArchivedBlobs(now, { 'seo-parser': false, 'ada-audit': true })`; assert: child `result` nulled, child `lighthouseSummary` KEPT, origin summary/standalone result nulled, `archivePrunedAt` stamped; `deleteAuditArtifacts` (mock via `vi.mock('@/lib/ada-audit/screenshot-helpers')`) called once per child id + once per standalone id and NOT for a seeded recent audit's children; an artifact rejection does not throw; default `PRUNE_ACTIVATED` now has `'ada-audit': true` and `'seo-parser': false` (pin both); recent (<90d) rows untouched.

- [ ] **Step 6.2: Implement** in `lib/findings/retention.ts`:

Flip the flag:

```ts
export const PRUNE_ACTIVATED: Readonly<Record<PrunableTool, boolean>> = {
  'seo-parser': false, // flips with C5 (that tool's last blob reader)
  'ada-audit': true,   // C3: all readers fallback to findings tables (spec § 5.4)
}
```

Add `import { deleteAuditArtifacts } from '@/lib/ada-audit/screenshot-helpers'`. Inside the chunk loop, before the `$transaction`:

```ts
      // Snapshot the affected child audits BEFORE the transaction (Codex
      // spec-fix #6) — artifact deletion below uses exactly this snapshot,
      // never a directory sweep.
      const childAudits = tool === 'ada-audit' && siteAuditIds.length > 0
        ? await prisma.adaAudit.findMany({
            where: { siteAuditId: { in: siteAuditIds }, result: { not: null } },
            select: { id: true },
          })
        : []
```

Extend the transaction array (bounded in-list — `siteAuditIds` ≤ CHUNK_SIZE, never the child-id list):

```ts
        prisma.adaAudit.updateMany({ where: { id: { in: adaAuditIds } }, data: { result: null } }),
        // C3: child blobs of pruned site audits — the real DB weight (spec § D3)
        ...(childAudits.length > 0
          ? [prisma.adaAudit.updateMany({
              where: { siteAuditId: { in: siteAuditIds } },
              data: { result: null },
            })]
          : []),
```

After the transaction, still inside the chunk loop:

```ts
      // Best-effort screenshot cleanup over the snapshot — blobs held the only
      // screenshotPath references; keeping the files would orphan disk forever.
      if (tool === 'ada-audit') {
        const artifactIds = [...adaAuditIds, ...childAudits.map((c) => c.id)]
        const settled = await Promise.allSettled(artifactIds.map((aid) => deleteAuditArtifacts(aid)))
        const failed = settled.filter((s) => s.status === 'rejected').length
        if (failed > 0) {
          console.warn(`[findings] failed to delete screenshot artifacts for ${failed} pruned audit(s)`)
        }
      }
```

Update the file's header comment: child blobs ARE now pruned for ada-audit (this PR is the deferred decision from A2 Phase 4).

- [ ] **Step 6.3:** Run `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/retention.test.ts` — PASS. Commit: `feat(c3): retention — child blob pruning + snapshot artifact cleanup; ada-audit PRUNE flip`

---

### Task 7: Score-source flips (lists, recents, batch, audit-summary, ?from=)

**Files:**
- Modify: `lib/ada-audit/recents-query.ts`, `app/api/site-audit/route.ts`, `app/api/ada-audit/route.ts`, `app/api/audit-batches/[id]/route.ts`, `app/api/clients/audit-summary/route.ts`, `app/ada-audit/[id]/page.tsx` (`?from=` block)
- Test: extend each surface's existing test file where it is already DB-backed.
  **Exception (Codex plan-fix #5):** the existing `/api/ada-audit` route tests
  are POST-focused with mocked prisma shapes that don't cover
  `findMany`/`groupBy`/`crawlPage` — do NOT bolt the GET fallback tests onto
  that mock file. Create a new DB-backed `app/api/ada-audit/route.list.test.ts`
  (house rules: unique domain prefix `c3list-*.example`, tracked-id cleanup,
  CrawlRun cleaned by domain before origin rows) that seeds real rows and
  calls the route handler directly. Same judgment per surface: if the
  existing file mocks prisma, add a DB-backed sibling file instead of
  expanding the mock. The `?from=` flip is covered by a DB-backed test on the
  page's prisma query path following the same pattern.

Pattern everywhere: **prefer `crawlRun.score` (identical formula, mapper-computed), blob parse only as pre-A2 fallback.** The list `summary` field passes through unchanged (`null` when pruned — every list UI already tolerates null summaries on non-complete rows).

- [ ] **Step 7.1: Failing tests** per surface (seed one audit with a CrawlRun score and a DIFFERENT-scoring blob → route returns the CrawlRun score; seed one pre-A2 audit, blob only → blob-derived score; seed pruned: blob null + CrawlRun → CrawlRun score, no crash):

```ts
// recents-query: site + page items prefer crawlRun.score; legacy blob fallback intact
// /api/site-audit GET: score from crawlRun; summary passthrough null when pruned
// /api/ada-audit GET: score + scorecard — scorecard from blob when present; when
//   pruned (result null, run present): scorecard rebuilt from Violation groupBy
//   (impact counts) + CrawlPage passCount sums (0 when null — list chips only)
// /api/audit-batches/[id]: member score prefers crawlRun.score
// /api/clients/audit-summary: score prefers crawlRun.score; null summary tolerated
// ?from=: previousScore = baseline crawlRun.score; blob fallback when no run
```

- [ ] **Step 7.2: Implement `recents-query.ts`.** Add `crawlRun: { select: { score: true } }` to both `select` blocks; item mapping:

```ts
      status: p.status, score: p.crawlRun?.score ?? pageScore(p.status, p.result, p.wcagLevel),
...
      status: s.status, score: s.crawlRun?.score ?? siteScore(s.status, s.summary, s.wcagLevel),
```

- [ ] **Step 7.3: Implement `/api/site-audit` GET.** `include: { client: ..., crawlRun: { select: { score: true } } }`; score derivation becomes:

```ts
    let summary = null
    let score: number | null = a.status === 'complete' ? a.crawlRun?.score ?? null : null
    const wcagLevel = a.wcagLevel ?? 'wcag21aa'

    if (a.status === 'complete' && a.summary) {
      try {
        summary = JSON.parse(a.summary)
        const agg = summary?.aggregate
        if (score === null && agg) score = computeScoreFromCounts(agg, wcagLevel).score
      } catch { /* ignore */ }
    }
```

- [ ] **Step 7.4: Implement `/api/ada-audit` GET (list).** Add `crawlRun: { select: { id: true, score: true } }` to the include. After the existing map, batch-rebuild scorecards for pruned rows:

```ts
  // Pruned rows (result null, findings present): rebuild the scorecard from
  // Violation rows in two batched queries — list chips show violation counts;
  // passed/incomplete use stored passCount sums (0 when unknown — list only).
  const prunedRunIds = audits
    .filter((a) => a.status === 'complete' && !a.result && a.crawlRun)
    .map((a) => a.crawlRun!.id)
  const prunedCounts = new Map<string, AuditScorecard>()
  if (prunedRunIds.length > 0) {
    const [groups, pages] = await Promise.all([
      prisma.violation.groupBy({
        by: ['runId', 'impact'],
        where: { runId: { in: prunedRunIds } },
        _count: { _all: true },
      }),
      prisma.crawlPage.findMany({
        where: { runId: { in: prunedRunIds } },
        select: { runId: true, passCount: true, incompleteCount: true },
      }),
    ])
    for (const runId of prunedRunIds) {
      const sc: AuditScorecard = { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 0, incomplete: 0 }
      for (const g of groups.filter((g) => g.runId === runId)) {
        const n = g._count._all
        sc.total += n
        if (g.impact === 'critical' || g.impact === 'serious' || g.impact === 'moderate' || g.impact === 'minor') {
          sc[g.impact] += n
        }
      }
      for (const p of pages.filter((p) => p.runId === runId)) {
        sc.passed += p.passCount ?? 0
        sc.incomplete += p.incompleteCount ?? 0
      }
      prunedCounts.set(runId, sc)
    }
  }
```

In the per-item mapping: `score = a.crawlRun?.score ?? <existing blob compute>` and `scorecard = <existing blob compute> ?? (a.crawlRun ? prunedCounts.get(a.crawlRun.id) ?? null : null)`. (Restructure the `if (a.status === 'complete' && a.result)` block so the pruned branch assigns from `prunedCounts`.)

- [ ] **Step 7.5: Implement batch + audit-summary routes.** `audit-batches/[id]`: add `crawlRun: { select: { score: true } }` to the members select; `let score = m.status === 'complete' ? m.crawlRun?.score ?? null : null`, blob compute only `if (score === null && ...)`. `clients/audit-summary`: add `crawlRun: { select: { score: true } }` to the `findFirst` select; `let score = latest?.crawlRun?.score ?? null`, blob compute only when still null. Then grep `components/` for consumers of `latestSiteAudit.summary` (ClientsAuditSummary) and make every access null-safe (`summary?.aggregate` etc. — render the score chip without impact breakdown when summary is null).

- [ ] **Step 7.6: Implement `?from=` flip** in `app/ada-audit/[id]/page.tsx`:

```ts
  let previousScore: number | null = null
  if (fromId) {
    const prev = await prisma.adaAudit.findUnique({
      where: { id: fromId },
      select: { result: true, wcagLevel: true, crawlRun: { select: { score: true } } },
    })
    previousScore = prev?.crawlRun?.score ?? null
    if (previousScore === null && prev?.result) {
      try {
        const prevResults = JSON.parse(prev.result) as StoredAxeResults
        previousScore = computeScore(prevResults.violations, prev.wcagLevel ?? 'wcag21aa').score
      } catch { /* malformed result — leave null */ }
    }
  }
```

- [ ] **Step 7.7:** Run all touched test files — PASS. Commit: `feat(c3): score-source flips — CrawlRun.score first, blob fallback pre-A2`

---

### Task 8: Detail fallbacks + archived render contract

**Files:**
- Modify: `app/api/ada-audit/[id]/route.ts`, `app/ada-audit/[id]/page.tsx`, `app/ada-audit/share/[token]/page.tsx`, `app/api/site-audit/[id]/route.ts`, `app/ada-audit/site/[id]/page.tsx`
- Modify: `components/ada-audit/AuditResultsView.tsx`, `components/ada-audit/AuditScorecard.tsx`, `components/ada-audit/SiteAuditResultsView.tsx`
- Test: route tests (extend) + component tests `components/ada-audit/AuditResultsView.test.tsx` (extend or create following the components' existing test conventions)

- [ ] **Step 8.1: Failing tests:**

```ts
// /api/ada-audit/[id]: complete + result null + findings page → results.archived true,
//   violations from rows, archivedCounts present; complete + result null + NO findings → results null (legacy copy path)
// /api/site-audit/[id]: complete + summary null + run → summary.archived true; no run → summary null
// AuditResultsView: archived results → banner rendered, scorecard passed cell shows
//   archived count (or "—" when null), NEVER literal 0-from-empty-passes; no
//   domElementCount warning; screenshots absent
// SiteAuditResultsView: summary.archived → banner; page rows render archivedCounts
```

- [ ] **Step 8.2: API fallbacks.** `app/api/ada-audit/[id]/route.ts` — after the existing parse block:

```ts
  let results: StoredAxeResults | null = null
  if (audit.status === 'complete' && audit.result) {
    ...existing parse + malformed-error return...
  } else if (audit.status === 'complete' && !audit.result) {
    // Pruned blob (C3): degraded view from Violation rows. Null when the
    // audit predates A2 — the UI keeps its legacy "no results" copy.
    results = await buildArchivedAxeResults(audit.id)
  }
```

`app/api/site-audit/[id]/route.ts` — replace the summary block:

```ts
  let summary = null
  if (audit.status === 'complete' && audit.summary) {
    try { summary = JSON.parse(audit.summary) } catch { /* ignore */ }
  }
  if (audit.status === 'complete' && summary === null) {
    summary = await buildSummaryFromFindings(audit.id) // null when no CrawlRun (pre-A2)
  }
```

- [ ] **Step 8.3: Server pages.** `app/ada-audit/site/[id]/page.tsx` complete branch:

```ts
  let summary: SiteAuditSummary | null = null
  if (audit.summary) {
    try { summary = JSON.parse(audit.summary) as SiteAuditSummary } catch { /* corrupted */ }
  }
  if (!summary) summary = await buildSummaryFromFindings(audit.id)
  if (!summary) { ...existing "Result data is unavailable" card... }
```

Score line: prefer the run score so archived (capped-pass) aggregates can't shift it:

```ts
  const crawlRun = await prisma.crawlRun.findUnique({ where: { siteAuditId: audit.id }, select: { score: true } })
  const fromCounts = computeScoreFromCounts(summary.aggregate, audit.wcagLevel)
  const score = crawlRun?.score ?? fromCounts.score
  const compliant = fromCounts.compliant
```

`app/ada-audit/[id]/page.tsx` complete branch (after the existing parse; before the `if (!results)` card):

```ts
  let archivedScore: number | null = null
  if (!results && audit.status === 'complete') {
    results = await buildArchivedAxeResults(id)
    if (results) {
      const run = await prisma.crawlRun.findUnique({ where: { adaAuditId: id }, select: { score: true } })
      archivedScore = run?.score ?? null
    }
  }
```

and the score derivation becomes:

```ts
  const computed = computeScore(results.violations, audit.wcagLevel)
  const score = results.archived ? archivedScore ?? computed.score : computed.score
  const compliant = results.archived ? results.violations.length === 0 : computed.compliant
```

(`compliant` for archived = zero violation rows — same semantics as `scoreFromPenalty`'s `totalElements === 0`; capped node counts would otherwise falsify the node-based score, hence `CrawlRun.score`.)

`app/ada-audit/share/[token]/page.tsx`: identical pattern (fallback + archived score/compliant), keyed by `audit.id`.

- [ ] **Step 8.4: Archived render contract.** `components/ada-audit/AuditScorecard.tsx`: add optional prop `archivedCounts?: ArchivedCounts`. Where the passed and incomplete VALUES render, replace the value expression with:

```tsx
{archivedCounts ? (archivedCounts.passed ?? '—') : scorecard.passed}
...
{archivedCounts ? (archivedCounts.incomplete ?? '—') : scorecard.incomplete}
```

**Visibility conditions too (Codex plan-fix #1):** the component currently
renders the incomplete row only when `scorecard.incomplete > 0` — with
archived counts that condition must become:

```tsx
{(archivedCounts ? archivedCounts.incomplete === null || archivedCounts.incomplete > 0 : scorecard.incomplete > 0) && ( ... )}
```

(unknown → row renders with "—"; apply the same treatment to any
`scorecard.passed > 0` visibility gate if present). Pin with a component test:
archived + `incomplete: null` → the row is visible showing "—".

`components/ada-audit/AuditResultsView.tsx`:

```tsx
  const scorecard = buildScorecard(results)
  // Archived results synthesize passes/incomplete as [] — archivedCounts is
  // the truth there; empty arrays must never render as a literal 0 (Codex #3).
```

pass `archivedCounts={results.archived ? results.archivedCounts ?? { passed: null, incomplete: null } : undefined}` to `AuditScorecardComponent`; gate the domElementCount warning with `!results.archived &&`.

**Disable triage on archived results (Codex plan-fix #2):** check keys are
content hashes of full node HTML — capped 5×300 reconstructed nodes can't
reproduce them, so triage writes against archived data would be unreliable.
Hide the triage toggle and never pass a checks context when archived:

```tsx
{auditId && !readOnly && !results.archived && ( ...triage button + ReScan + Share block... )}
...
checksContext={displayChecks && !results.archived ? { triageMode: displayChecks, readOnly, checks } : undefined}
```

(also gate the `useChecks` `enabled` flag with `&& !results.archived`). Pin
with a component test: archived results → no triage toggle rendered.

Render above `<ComplianceBanner />`:

```tsx
      {results.archived && (
        <div className="flex gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-[12px] font-body text-amber-800 dark:text-amber-400 leading-relaxed">
          <span>
            <strong>Archived audit:</strong> full detail (screenshots, complete code snippets,
            pass/incomplete lists) was pruned after 90 days. Violations shown are exact;
            node samples are capped at 5 per rule.
          </span>
        </div>
      )}
```

`components/ada-audit/SiteAuditResultsView.tsx`: same banner (text "full per-page detail was pruned after 90 days…") at the top of the component when `summary.archived`; pass `archivedCounts={summary.archived ? summary.archivedCounts ?? { passed: null, incomplete: null } : undefined}` to its `AuditScorecardComponent`. Page-row expansion needs no change (the API fallback returns synthesized `results.violations`).

- [ ] **Step 8.5:** Run touched test files + `npx tsc --noEmit` — PASS. Commit: `feat(c3): detail fallbacks + archived render contract (banner, archivedCounts, no literal 0)`

---

### Task 9: `SiteAuditDiffPanel` + results-page wiring

**Files:**
- Create: `components/ada-audit/SiteAuditDiffPanel.tsx`
- Modify: `app/ada-audit/site/[id]/page.tsx`
- Test: `components/ada-audit/SiteAuditDiffPanel.test.tsx`

- [ ] **Step 9.1: Failing component tests:** mixed diff renders headline chips (`2 new` with "1 regressed · 1 on new pages", `1 resolved`, unchanged + not-rescanned counts), per-rule rows with severity pill + expandable URL list + cap footer (`…and N more`), NEW badge on rules with `unchangedTotal === 0 && resolvedTotal === 0 && newTotal > 0`; clean diff (all-zero changes, previous exists) renders "No accessibility changes vs the audit of <date>"; baseline link href `/ada-audit/site/<previousSiteAuditId>` when present.

- [ ] **Step 9.2: Implement** (client component, FindingsPanel visual language, all `dark:` variants):

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { InstanceDiff, RuleInstanceDiff } from '@/lib/services/findings-shared'
import { ClientDate } from '@/components/ClientDate'

interface Props {
  diff: InstanceDiff
  previous: { siteAuditId: string | null; completedAt: string | null }
}

const SEV_PILL: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  notice: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
}

function RuleRow({ rule }: { rule: RuleInstanceDiff }) {
  const [open, setOpen] = useState(false)
  const isNewRule = rule.newTotal > 0 && rule.unchangedTotal === 0 && rule.resolvedTotal === 0
  return (
    <li className="py-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex flex-wrap items-center gap-2 text-left text-[12px] font-body">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${SEV_PILL[rule.severity]}`}>{rule.severity}</span>
        <span className="font-semibold text-navy dark:text-white">{rule.type}</span>
        {isNewRule && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-600 text-white">NEW</span>
        )}
        {rule.newTotal > 0 && <span className="text-red-600 dark:text-red-400">+{rule.newTotal} new{rule.regressedTotal > 0 ? ` (${rule.regressedTotal} regressed)` : ''}</span>}
        {rule.resolvedTotal > 0 && <span className="text-green-600 dark:text-green-400">−{rule.resolvedTotal} resolved</span>}
        {rule.unchangedTotal > 0 && <span className="text-navy/40 dark:text-white/40">{rule.unchangedTotal} unchanged</span>}
        <span className="ml-auto text-navy/30 dark:text-white/30">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-1.5 pl-2 space-y-1.5 text-[11px] font-body">
          {rule.newUrls.length > 0 && (
            <div>
              <span className="font-semibold text-red-600 dark:text-red-400">New on:</span>
              <ul className="mt-0.5 space-y-0.5">{rule.newUrls.map((u) => <li key={u} className="text-navy/60 dark:text-white/60 break-all">{u}</li>)}</ul>
              {rule.newTotal > rule.newUrls.length && <p className="text-navy/40 dark:text-white/40">…and {rule.newTotal - rule.newUrls.length} more</p>}
            </div>
          )}
          {rule.resolvedUrls.length > 0 && (
            <div>
              <span className="font-semibold text-green-600 dark:text-green-400">Resolved on:</span>
              <ul className="mt-0.5 space-y-0.5">{rule.resolvedUrls.map((u) => <li key={u} className="text-navy/60 dark:text-white/60 break-all">{u}</li>)}</ul>
              {rule.resolvedTotal > rule.resolvedUrls.length && <p className="text-navy/40 dark:text-white/40">…and {rule.resolvedTotal - rule.resolvedUrls.length} more</p>}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export default function SiteAuditDiffPanel({ diff, previous }: Props) {
  const noChanges = diff.newCount === 0 && diff.resolvedCount === 0
  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">Changes since previous audit</h2>
        {previous.completedAt && (
          <span className="text-[12px] font-body text-navy/40 dark:text-white/40">
            baseline <ClientDate iso={previous.completedAt} variant="dateTime" />
          </span>
        )}
        {previous.siteAuditId && (
          <Link href={`/ada-audit/site/${previous.siteAuditId}`} className="text-[12px] font-body text-orange hover:underline">
            view baseline →
          </Link>
        )}
      </div>
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap gap-2 text-[12px] font-body font-semibold">
          <span className={`px-2 py-1 rounded-lg ${diff.newCount > 0 ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50'}`}>
            {diff.newCount} new{diff.newCount > 0 ? ` (${diff.regressedCount} regressed · ${diff.newPageCount} on new pages)` : ''}
          </span>
          <span className={`px-2 py-1 rounded-lg ${diff.resolvedCount > 0 ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50'}`}>
            {diff.resolvedCount} resolved
          </span>
          <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50">{diff.unchangedCount} unchanged</span>
          {diff.notRescannedCount > 0 && (
            <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50" title="Violations on pages that were not part of this crawl — neither new nor resolved.">
              {diff.notRescannedCount} not re-scanned
            </span>
          )}
        </div>
        {noChanges ? (
          <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
            No accessibility changes vs the previous audit{previous.completedAt ? <> of <ClientDate iso={previous.completedAt} variant="date" /></> : null}.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-navy-border">
            {diff.rules.map((r) => <RuleRow key={r.type} rule={r} />)}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 9.3: Wire into the page.** In `app/ada-audit/site/[id]/page.tsx` complete branch:

```ts
  const instanceDiff = await getSiteAuditInstanceDiff(audit.id) // null → panel hidden
```

render between the breadcrumb's `<SiteAuditResultsView …/>` and above it:

```tsx
      {instanceDiff && <SiteAuditDiffPanel diff={instanceDiff.diff} previous={instanceDiff.previous} />}
```

- [ ] **Step 9.4:** Run component tests — PASS. Commit: `feat(c3): SiteAuditDiffPanel — changes-since-previous on the site results page`

---

### Task 10: ScheduledScansCard instance chips

**Files:**
- Modify: `lib/services/client-schedules.ts`, `components/clients/ScheduledScansCard.tsx`
- Test: `lib/services/client-schedules.test.ts` + card component test (extend)

- [ ] **Step 10.1: Failing tests:** schedule with two completed scored runs at the same level → `lastRun.newCount`/`resolvedCount` from the pair diff; levels differ → both null; <2 completed runs → null; service shape backwards-compatible.

- [ ] **Step 10.2: Implement service.** `ClientScheduleRow['lastRun']` gains `newCount: number | null; resolvedCount: number | null`. In `getClientSchedules`, the audits select adds `crawlRun: { select: { id: true, score: true } }`. After `prevScore` is computed:

```ts
    // ONE previous audit drives BOTH the score Δ and the diff chips (Codex
    // plan-fix #4) — the pairs must never diverge.
    const prevAudit = mine.slice(1).find(
      (a) => a.status === 'complete' && typeof a.crawlRun?.score === 'number',
    ) ?? null
    const prevScore = prevAudit?.crawlRun?.score ?? null
    let newCount: number | null = null
    let resolvedCount: number | null = null
    if (last?.status === 'complete' && last.crawlRun && prevAudit?.crawlRun) {
      // Same pair as the score Δ; null on wcagLevel mismatch (spec § 4.2).
      const diff = await getRunPairInstanceDiff(last.crawlRun.id, prevAudit.crawlRun.id)
      if (diff) { newCount = diff.newCount; resolvedCount = diff.resolvedCount }
    }
```

(this REPLACES the existing `prevScore` derivation — delete the old
`mine.slice(1).find(...)` for `prevScore`; add a test asserting the score Δ
and the chips come from the same previous audit when an intermediate
completed audit lacks a score.)

(The `schedules.map` callback becomes async — switch to `await Promise.all(schedules.map(async (s) => { … }))`.) `lastRun` gains `newCount, resolvedCount`.

- [ ] **Step 10.3: Implement card.** In `ScheduledScansCard.tsx`, after the existing `lastDelta` chip inside the `s.lastRun && (…)` span:

```tsx
                  {s.lastRun.newCount !== null && s.lastRun.newCount > 0 && (
                    <span className="ml-1 font-semibold text-red-600 dark:text-red-400">+{s.lastRun.newCount}</span>
                  )}
                  {s.lastRun.resolvedCount !== null && s.lastRun.resolvedCount > 0 && (
                    <span className="ml-1 font-semibold text-green-600 dark:text-green-400">−{s.lastRun.resolvedCount}</span>
                  )}
```

(and a `title="new / resolved violations vs the previous scheduled run"` on a wrapping span). Update the card's local `ScheduleRow` type to match the service shape, **and update every existing card test fixture** to carry the widened `lastRun` (`newCount`/`resolvedCount`, null is fine) so the suite doesn't fail on a structural type mismatch (Codex plan-fix #7).

- [ ] **Step 10.4:** Run both test files — PASS. Commit: `feat(c3): scheduled-scans card — instance new/resolved chips`

---

### Task 11: FindingsPanel ADA instance clause

**Files:**
- Modify: `lib/services/client-findings.ts`, `components/clients/FindingsPanel.tsx` (+ its `SourceMetaProp` type), `app/clients/[id]/page.tsx` (only if the prop shape is re-declared there — grep `SourceMetaProp`)
- Test: `lib/services/client-findings.test.ts` + `components/clients/FindingsPanel.test.tsx` (extend)

- [ ] **Step 11.1: Failing tests:** ada meta gains `newInstanceCount`/`resolvedInstanceCount` (null when no previous, level mismatch, or either run missing findings); SourceLine renders `· +N / −M violations` only when both non-null; SEO meta unchanged.

- [ ] **Step 11.2: Implement service.** `SourceRunMeta` gains `newInstanceCount: number | null; resolvedInstanceCount: number | null` (set `null, null` in the SEO `meta()` call — instance diffing is ADA-only v1). In the ADA branch of `getClientFindings`:

```ts
    let instanceDiff: InstanceDiff | null = null
    if (sel.ada.previous) {
      // B2's pair as-is; getRunPairInstanceDiff nulls on wcagLevel mismatch.
      instanceDiff = await getRunPairInstanceDiff(cur.id, sel.ada.previous.id)
    }
    adaMeta = {
      ...meta(cur, diff, sel.ada.previous !== null),
      newInstanceCount: instanceDiff?.newCount ?? null,
      resolvedInstanceCount: instanceDiff?.resolvedCount ?? null,
      sourceClass: sel.ada.sourceClass,
    }
```

(`meta()` itself fills `newInstanceCount: null, resolvedInstanceCount: null` defaults.)

- [ ] **Step 11.3: Implement SourceLine** in `FindingsPanel.tsx`, after the type-level `+N new / M resolved` span:

```tsx
      {m.newInstanceCount !== null && m.resolvedInstanceCount !== null && (
        <span>
          · <span className={m.newInstanceCount > 0 ? 'text-red-600 dark:text-red-400' : ''}>+{m.newInstanceCount}</span>
          {' / '}
          <span className={m.resolvedInstanceCount > 0 ? 'text-green-600 dark:text-green-400' : ''}>−{m.resolvedInstanceCount}</span>
          {' violations'}
        </span>
      )}
```

and extend the panel's `SourceMetaProp` with the two nullable fields.

- [ ] **Step 11.4:** Run both test files — PASS. Commit: `feat(c3): dashboard ADA source line — instance-level +/− violations clause`

---

### Task 12: Docs, gate comment, full verification

**Files:**
- Modify: `app/api/clients/[id]/schedules/route.ts` (cadence-gate comment only), `CLAUDE.md`

- [ ] **Step 12.1:** Update the `cadence_not_allowed` comment in the schedules CRUD route: daily stays gated NOT because blobs are unprunable (C3 fixed that) but because within-window volume (14 daily audits × full child blobs) needs supersede-based trimming — C6's design space. No behavior change (pin: existing 400 test stays green).
- [ ] **Step 12.2:** CLAUDE.md: update the findings-layer bullet (`PRUNE_ACTIVATED`: ada-audit ACTIVE — origin + child blobs + screenshots at 90 d; seo-parser still inert/C5), add `lib/services/site-audit-diff.ts` + `lib/ada-audit/findings-fallback.ts` to Key files, and a one-line C3 note in the ADA architecture bullet (instance diffing keyed on `Finding.dedupKey`, archived fallbacks).
- [ ] **Step 12.3:** Full gate:

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run
npx tsc --noEmit
npm run build
```

Expected: suite green (2,137 + new), tsc clean, build clean. Commit: `docs(c3): CLAUDE.md + cadence-gate rationale`

---

### Task 13: PR, deploy, production verification

- [ ] **Step 13.1:** Push branch, open PR (`gh pr create`) titled "C3: ADA run-over-run diffing + blob-archive activation", merge after checks.
- [ ] **Step 13.2:** `git push` main → `ssh $PROD_SSH "~/deploy.sh"` (runs `prisma migrate deploy`). Watch boot log for errors.
- [ ] **Step 13.3: Production verification** (authed via the form-POST login + cookie jar per handoff doc):
  1. Open the canary client's latest scheduled site audit (`/ada-audit/site/<id>`) — diff panel renders vs the previous canary run (expect "No accessibility changes" or real counts).
  2. `/clients/31` — ScheduledScansCard shows `+N/−M` chips (or none if level/pair unavailable); FindingsPanel ADA line shows the violations clause.
  3. Seed nothing: confirm the first cleanup tick logs no `[findings] pruned` line (no eligible >90 d runs yet — expected no-op until ~2026-09-08).
  4. Simulated-prune spot check ON A COPY ROW ONLY IF NEEDED — otherwise rely on the seeded-prune tests; do NOT null blobs on real production rows.
  5. `/ada-audit` list + recents render; scores match pre-deploy values (CrawlRun.score equality).
- [ ] **Step 13.4:** Tracker checkbox + status log; rewrite `HANDOFF-improvement-roadmap.md` for C4; archive spec + plan via `git mv`; commit.

---

## Self-review notes (run before finalizing)

- Spec § 4.1/4.2 → Tasks 2–3. § 5.1 → Task 1. § 5.2/5.3 → Tasks 4–5. § 5.4 flip table → Tasks 7–8 (every row covered: list/batch/recents/audit-summary/detail/page/share/?from=/expansion-via-API). § 5.5 → Task 6. § 6 UI → Tasks 8–11. § D4 → Task 12.1.
- Type names cross-checked: `InstanceDiff`/`RuleInstanceDiff`/`InstanceRef` (Task 2) used in Tasks 3/9/10/11; `ArchivedCounts` (Task 5.1) used in Tasks 5/8; `ViolationRowInput` (Task 4) used in Task 5.
- Invariants: all transactions array-form; no interactive `$transaction`; findings hook untouched; no blob backfills; `pruneScheduledSiteAudits` untouched; no new public routes (middleware untouched — pin only if a route is added).
