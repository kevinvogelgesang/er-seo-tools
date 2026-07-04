# ADA Scoring v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blunt v1 ADA score with a per-page, size-normalized,
WCAG-level-aware v2 score, labeled per-run so historical v1 scores never change
and trends never silently mix formulas.

**Architecture:** A new pure `scoring-v2` module computes a per-page saturating
density score and a site score = mean of per-page scores. `ada-mapper` (the sole
write-path) switches to v2 and writes a versioned `CrawlRun.scoreBreakdown`. The
runner preserves the raw pre-truncation node count in the blob so density is
faithful. Read surfaces prefer the persisted score + version; the count-based
recompute fallback stays v1. Trend/delta surfaces become version-aware.

**Tech Stack:** TypeScript, Next.js 15 App Router, Prisma + SQLite, Vitest.

## Global Constraints

- **No schema migration.** `nodeCount` is a JSON-blob shape change on stored
  `AxeViolation`; the version label lives in the existing `CrawlRun.scoreBreakdown`
  string column. Confirm (Task 4) that no reader breaks; if a column is ever
  wanted, that is a separate schema-change PR.
- **v1 is frozen.** `computeScore` / `computeScoreFromCounts` in
  `lib/ada-audit/scoring.ts` are NOT modified. They remain the fallback for
  pre-v2 / pruned data.
- **Never rely on identifier names at runtime; injected-into-page code stays
  SWC-helper-free** — N/A here (no page-injected code changes), but do not add
  `typeof` to anything under `lib/ada-audit/seo/parse-seo-dom.ts`.
- **Array-form `$transaction([...])` only** — N/A (no new transactions), noted.
- **Dark mode:** every new UI element needs `dark:` variants; guard against
  hydration mismatch (see `ThemeToggle.tsx` `mounted` pattern) if adding client
  state.
- **Test env pragmas:** node-env tests get `// @vitest-environment node`; React
  render tests get `// @vitest-environment jsdom` + `afterEach(cleanup)`.
- **Local commands prefix:** `DATABASE_URL="file:./local-dev.db"` before
  `vitest` / prisma CLI.
- Gate before PR: `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test`
  · `npm run build`, all green.

---

## File Structure

- **Create** `lib/ada-audit/node-cap.ts` — pure `capViolationNodesForStorage()`:
  sets raw `nodeCount` then truncates `nodes` to 20. Extracted from the runner's
  inline map so it is unit-testable without puppeteer.
- **Create** `lib/ada-audit/scoring-v2.ts` — pure v2 scorer: `computeScoreV2`,
  `computeSiteScoreV2`, constants, `AdaScoreV2Breakdown` type,
  `serializeAdaBreakdown`, `ADA_SCORE_VERSION`.
- **Create** `lib/scoring/breakdown-version.ts` — pure `parseScoreVersion()`:
  reads `.version` from a `scoreBreakdown` string, default 1. Used by trend
  surfaces (type-safe, tolerates any breakdown shape).
- **Modify** `lib/ada-audit/types.ts` — `AxeViolation` gains `nodeCount?: number`.
- **Modify** `lib/ada-audit/runner.ts` — use `capViolationNodesForStorage`.
- **Modify** `lib/findings/ada-mapper.ts` — v2 per-page + site score, write
  `scoreBreakdown`, use raw `nodeCount` for `ViolationInput.nodeCount`, extend
  `parseAxe` to return `domElementCount`.
- **Modify** `lib/services/scorecard-shared.ts` — `ScorePoint.scoreVersion`,
  version-aware `buildSeries` (suppress cross-version delta).
- **Modify** the ScorePoint builders + delta computers:
  `lib/services/client-schedules.ts`, `lib/report/report-data.ts`, and the
  dashboard/fleet series builders — populate `scoreVersion`.
- **Modify** read-surface pages: `app/ada-audit/[id]/page.tsx`,
  `app/ada-audit/share/[token]/page.tsx` (prefer persisted score + version).
- **Create** `lib/ada-audit/display-score.ts` — pure `resolveDisplayScore()`:
  prefer persisted score + version; recompute v1 as labeled fallback. Used by the
  read pages + a small badge component.
- **Create** `components/ada-audit/ScoreVersionBadge.tsx` — the "v2" badge +
  pass/incomplete adjacency (dark-mode).

---

## Task 1: Preserve the raw pre-truncation node count in the blob

**Files:**
- Create: `lib/ada-audit/node-cap.ts`
- Test: `lib/ada-audit/node-cap.test.ts`
- Modify: `lib/ada-audit/types.ts` (add `nodeCount?`)
- Modify: `lib/ada-audit/runner.ts:337-348` (use the helper)

**Interfaces:**
- Produces: `capViolationNodesForStorage(violations: AxeViolation[]): AxeViolation[]`
  — returns new violations each with `nodeCount = <raw length>` and `nodes`
  sliced to `STORED_NODE_LIMIT` (20). Also `STORED_NODE_LIMIT = 20`.

- [ ] **Step 1: Add `nodeCount` to `AxeViolation`**

In `lib/ada-audit/types.ts`, in the `AxeViolation` interface (currently ends with
`nodes: AxeNode[]` and an optional `screenshotPath?`), add:

```ts
  /** Raw pre-truncation count of failing nodes. `nodes` is capped at 20 for
   *  storage; this preserves the true count for v2 density scoring. Absent on
   *  pre-v2 blobs — consumers fall back to `nodes.length`. */
  nodeCount?: number
```

- [ ] **Step 2: Write the failing test**

Create `lib/ada-audit/node-cap.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { capViolationNodesForStorage, STORED_NODE_LIMIT } from './node-cap'
import type { AxeViolation } from './types'

function v(id: string, nodeN: number): AxeViolation {
  return {
    id, impact: 'serious', help: '', description: '', helpUrl: '', tags: [],
    nodes: Array.from({ length: nodeN }, (_, i) => ({ html: `<a${i}>` })),
  }
}

describe('capViolationNodesForStorage', () => {
  it('records the raw count and truncates nodes to the limit', () => {
    const [out] = capViolationNodesForStorage([v('image-alt', 200)])
    expect(out.nodeCount).toBe(200)
    expect(out.nodes.length).toBe(STORED_NODE_LIMIT)
  })
  it('leaves sub-limit violations intact with an exact count', () => {
    const [out] = capViolationNodesForStorage([v('label', 3)])
    expect(out.nodeCount).toBe(3)
    expect(out.nodes.length).toBe(3)
  })
  it('does not mutate the input array elements', () => {
    const input = [v('x', 50)]
    capViolationNodesForStorage(input)
    expect(input[0].nodes.length).toBe(50)
    expect(input[0].nodeCount).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/node-cap.test.ts`
Expected: FAIL — `Cannot find module './node-cap'`.

- [ ] **Step 4: Write the implementation**

Create `lib/ada-audit/node-cap.ts`:

```ts
// Pure node-truncation for storage. Extracted from runner.ts so the raw-count
// preservation is unit-testable without puppeteer.
import type { AxeViolation } from './types'

export const STORED_NODE_LIMIT = 20

/** Preserve the raw failing-node count, then truncate `nodes` for storage. */
export function capViolationNodesForStorage(violations: AxeViolation[]): AxeViolation[] {
  return violations.map((v) => ({
    ...v,
    nodeCount: v.nodes.length,
    nodes: v.nodes.slice(0, STORED_NODE_LIMIT),
  }))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/node-cap.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Use the helper in the runner**

In `lib/ada-audit/runner.ts`, replace the inline truncation block (currently
lines ~337-348, the two `rawResults.violations = ...map(...slice(0,20))` and the
`rawResults.incomplete = ...` maps) with:

```ts
    await progress(90, 'Processing results…')
    rawResults.violations = capViolationNodesForStorage(rawResults.violations)
    if (Array.isArray(rawResults.incomplete)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawResults.incomplete = rawResults.incomplete.map((v: any) => ({
        ...v,
        nodes: v.nodes.slice(0, STORED_NODE_LIMIT),
      }))
    }
```

Add the import at the top of `runner.ts` (near the other `./` imports):

```ts
import { capViolationNodesForStorage, STORED_NODE_LIMIT } from './node-cap'
```

(Incomplete keeps its inline slice — v2 only counts incomplete rules, not their
nodes, so incomplete needs no raw count. Using `STORED_NODE_LIMIT` there keeps
the magic number in one place.)

Note: `rawResults.violations` is typed `any` in the runner, so passing it to
`capViolationNodesForStorage(violations: AxeViolation[])` type-checks (`any` is
assignable) and the return `AxeViolation[]` assigns back to the `any` field
cleanly — no cast needed. If lint complains about the `any` flowing in, the
existing `eslint-disable` on that block already covers it.

- [ ] **Step 7: Verify lint + the full ada-audit test dir still pass**

Run: `npm run lint && DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/`
Expected: PASS (no type errors; runner still compiles; existing runner tests green).

- [ ] **Step 8: Commit**

```bash
git add lib/ada-audit/node-cap.ts lib/ada-audit/node-cap.test.ts lib/ada-audit/types.ts lib/ada-audit/runner.ts
git commit -m "feat(c9a): preserve raw pre-truncation node count in stored axe blob"
```

---

## Task 2: The pure v2 scorer

**Files:**
- Create: `lib/ada-audit/scoring-v2.ts`
- Test: `lib/ada-audit/scoring-v2.test.ts`

**Interfaces:**
- Consumes: `AxeViolation` (with optional `nodeCount`), `ImpactLevel` from `./types`.
- Produces:
  - `ADA_SCORE_VERSION = 2`
  - `computeScoreV2(input: ScoreV2Input): ScoreV2Result`
    where `ScoreV2Input = { violations: AxeViolation[]; incompleteCount: number; domElementCount: number | null | undefined; wcagLevel: string }`
    and `ScoreV2Result = { score: number; compliant: boolean; breakdown: AdaScoreV2Breakdown }`
  - `computeComplianceV2(violations: AxeViolation[]): boolean` — `true` iff NO
    violation carries a WCAG-conformance tag (best-practice-only findings do not
    break compliance). Exported for site-level reuse.
  - `computeSiteScoreV2(pageScores: number[]): number | null` — unweighted mean,
    rounded; `null` for empty input.
  - `AdaScoreV2Breakdown = { version: 2; scorer: 'ada-v2'; score: number | null; factors: AdaScoreFactors }`
    where `AdaScoreFactors = { weightedFailNodes: number; incompletePenalty: number; domElementCount: number; density: number; k: number; pagesScored?: number }`
  - `serializeAdaBreakdown(b: AdaScoreV2Breakdown): string`
  - constants `K`, `NODE_CAP`, `DOM_FLOOR`, `INCOMPLETE_WEIGHT`, `IMPACT_WEIGHT`.

- [ ] **Step 1: Write the failing test**

Create `lib/ada-audit/scoring-v2.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { computeScoreV2, computeSiteScoreV2, ADA_SCORE_VERSION } from './scoring-v2'
import type { AxeViolation } from './types'

function viol(opts: Partial<AxeViolation> & { id: string; nodeCount: number }): AxeViolation {
  const { nodeCount, ...rest } = opts
  return {
    impact: 'serious', help: '', description: '', helpUrl: '', tags: ['wcag2aa'],
    nodes: Array.from({ length: Math.min(nodeCount, 20) }, () => ({ html: '<a>' })),
    nodeCount,
    ...rest, id: opts.id,
  }
}
const base = { incompleteCount: 0, wcagLevel: 'wcag21aa' as const }

describe('computeScoreV2', () => {
  it('scores a clean page 100', () => {
    expect(computeScoreV2({ ...base, violations: [], domElementCount: 500 }).score).toBe(100)
  })
  it('is monotonic — adding a violation never raises the score', () => {
    const one = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 5 })], domElementCount: 1000 }).score
    const two = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 5 }), viol({ id: 'b', nodeCount: 5 })], domElementCount: 1000 }).score
    expect(two).toBeLessThanOrEqual(one)
  })
  it('is size-invariant for equal proportional breakage', () => {
    const small = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 5 })], domElementCount: 100 }).score
    const large = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 250 })], domElementCount: 5000 }).score
    expect(Math.abs(small - large)).toBeLessThanOrEqual(1)
  })
  it('reads raw nodeCount, not truncated nodes.length (20 vs 200 differ)', () => {
    const twenty = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 20 })], domElementCount: 3000 }).score
    const twoHundred = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 200 })], domElementCount: 3000 }).score
    expect(twoHundred).toBeLessThan(twenty)
  })
  it('falls back to nodes.length when nodeCount is absent (pre-v2 blob)', () => {
    const v: AxeViolation = { id: 'a', impact: 'serious', help: '', description: '', helpUrl: '', tags: ['wcag2aa'], nodes: [{ html: '<a>' }, { html: '<b>' }] }
    expect(() => computeScoreV2({ ...base, violations: [v], domElementCount: 500 })).not.toThrow()
  })
  it('discounts best-practice-only violations (~0.4x)', () => {
    const conformance = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 30, tags: ['wcag2aa'] })], domElementCount: 1000 }).score
    const advisory = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 30, tags: ['best-practice'] })], domElementCount: 1000 }).score
    expect(advisory).toBeGreaterThan(conformance)
  })
  it('does not discount a rule tagged both best-practice AND wcag', () => {
    const both = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 30, tags: ['best-practice', 'wcag2aa'] })], domElementCount: 1000 }).score
    const conformance = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 30, tags: ['wcag2aa'] })], domElementCount: 1000 }).score
    expect(both).toBe(conformance)
  })
  it('applies a visible incomplete penalty even on a large DOM', () => {
    const clean = computeScoreV2({ ...base, violations: [], domElementCount: 8000 }).score
    const withIncomplete = computeScoreV2({ violations: [], incompleteCount: 6, wcagLevel: 'wcag21aa', domElementCount: 8000 }).score
    expect(withIncomplete).toBeLessThan(clean)
  })
  it('treats null impact as minor (does not throw, penalizes lightly)', () => {
    const nullImpact = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 10, impact: null })], domElementCount: 1000 }).score
    expect(nullImpact).toBeGreaterThan(0)
    expect(nullImpact).toBeLessThan(100)
  })
  it('uses DOM_FLOOR when domElementCount is missing', () => {
    const r = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 5 })], domElementCount: null })
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(100)
  })
  it('emits a version-2 breakdown', () => {
    const r = computeScoreV2({ ...base, violations: [], domElementCount: 500 })
    expect(r.breakdown.version).toBe(ADA_SCORE_VERSION)
    expect(r.breakdown.scorer).toBe('ada-v2')
  })
  it('compliance: clean page is compliant; a wcag violation breaks it', () => {
    expect(computeScoreV2({ ...base, violations: [], domElementCount: 500 }).compliant).toBe(true)
    expect(computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 1, tags: ['wcag2a'] })], domElementCount: 500 }).compliant).toBe(false)
  })
  it('compliance: a best-practice-only violation does NOT break compliance', () => {
    expect(computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 5, tags: ['best-practice'] })], domElementCount: 500 }).compliant).toBe(true)
  })
})

describe('computeSiteScoreV2', () => {
  it('is the rounded unweighted mean of page scores', () => {
    expect(computeSiteScoreV2([100, 80, 60])).toBe(80)
  })
  it('returns null for no scored pages', () => {
    expect(computeSiteScoreV2([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/scoring-v2.test.ts`
Expected: FAIL — `Cannot find module './scoring-v2'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ada-audit/scoring-v2.ts`:

```ts
// Pure ADA Scoring v2. v1 (scoring.ts) is frozen and untouched.
// Model: per-page saturating penalty over severity-weighted violation DENSITY.
//   density = (Σ impactWeight·min(rawNodeCount,NODE_CAP)·advisory + incomplete·W) / max(domElementCount, DOM_FLOOR)
//   score   = round( 100 / (1 + K·density) )    ∈ (0,100], monotonic, no cliff
// Site score = rounded unweighted mean of per-page scores.
// Constants calibrated against real audits (see the plan's calibration step);
// a golden test locks the scale.
import type { AxeViolation, ImpactLevel } from './types'

export const ADA_SCORE_VERSION = 2 as const

export const IMPACT_WEIGHT: Record<Exclude<ImpactLevel, null> | 'null', number> = {
  critical: 10, serious: 6, moderate: 3, minor: 1, null: 1,
}
export const NODE_CAP = 200
export const DOM_FLOOR = 50
export const INCOMPLETE_WEIGHT = 0.5
export const ADVISORY_DISCOUNT = 0.4
export const K = 12 // calibration constant — see plan §calibration

export interface ScoreV2Input {
  violations: AxeViolation[]
  incompleteCount: number
  domElementCount: number | null | undefined
  wcagLevel: string
}
export interface AdaScoreFactors {
  weightedFailNodes: number
  incompletePenalty: number
  domElementCount: number
  density: number
  k: number
  pagesScored?: number
}
export interface AdaScoreV2Breakdown {
  version: typeof ADA_SCORE_VERSION
  scorer: 'ada-v2'
  score: number | null
  factors: AdaScoreFactors
}
export interface ScoreV2Result { score: number; compliant: boolean; breakdown: AdaScoreV2Breakdown }

// `impact` is nullable in the current AxeViolation type — accept null.
function impactWeight(impact: ImpactLevel | null): number {
  return impact ? IMPACT_WEIGHT[impact] : IMPACT_WEIGHT.null
}

function hasWcagConformanceTag(tags: string[]): boolean {
  return tags.some((t) => /^wcag\d/.test(t))
}

/** Advisory = best-practice tag present AND no WCAG-conformance tag. */
export function isAdvisory(tags: string[]): boolean {
  return tags.includes('best-practice') && !hasWcagConformanceTag(tags)
}

/** Compliant = no violation carries a WCAG-conformance tag. Best-practice-only
 *  (advisory) violations do NOT break compliance. */
export function computeComplianceV2(violations: AxeViolation[]): boolean {
  return !violations.some((v) => hasWcagConformanceTag(v.tags ?? []))
}

export function computeScoreV2(input: ScoreV2Input): ScoreV2Result {
  let weightedFailNodes = 0
  for (const v of input.violations) {
    const raw = v.nodeCount ?? v.nodes.length
    const capped = Math.min(raw, NODE_CAP)
    const advisory = isAdvisory(v.tags ?? []) ? ADVISORY_DISCOUNT : 1
    weightedFailNodes += impactWeight(v.impact) * capped * advisory
  }
  const incompletePenalty = input.incompleteCount * INCOMPLETE_WEIGHT
  const dom = Math.max(input.domElementCount ?? DOM_FLOOR, DOM_FLOOR)
  const density = (weightedFailNodes + incompletePenalty) / dom
  const score = Math.round(100 / (1 + K * density))
  return {
    score,
    compliant: computeComplianceV2(input.violations),
    breakdown: {
      version: ADA_SCORE_VERSION, scorer: 'ada-v2', score,
      factors: { weightedFailNodes, incompletePenalty, domElementCount: dom, density, k: K },
    },
  }
}

/** Site score = rounded unweighted mean of per-page scores; null if none. */
export function computeSiteScoreV2(pageScores: number[]): number | null {
  if (pageScores.length === 0) return null
  return Math.round(pageScores.reduce((a, b) => a + b, 0) / pageScores.length)
}

export function serializeAdaBreakdown(b: AdaScoreV2Breakdown): string {
  return JSON.stringify(b)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/scoring-v2.test.ts`
Expected: PASS (all cases). If size-invariance is off by >1, adjust nothing yet —
the two cases use the same proportion (5/100 = 250/5000 = 0.05), so with capping
at 200 the large case's numerator is `min(250,200)=200` while small is 5 → they
will NOT be exactly equal. **Fix the test fixture** to keep both under NODE_CAP:
use `nodeCount: 5` at `domElementCount: 100` and `nodeCount: 200` at
`domElementCount: 4000` (0.05 each, both ≤ cap). Adjust the test, re-run.

- [ ] **Step 5: Add the calibration golden test**

Append to `lib/ada-audit/scoring-v2.test.ts` a `describe('calibration bands')`
that locks representative inputs to expected bands, then tune `K` (Task 2 Step 3)
until they hold:

```ts
describe('calibration bands', () => {
  const dom = 1500
  it('a few serious issues → mid band (55-80)', () => {
    const s = computeScoreV2({ incompleteCount: 2, wcagLevel: 'wcag21aa', domElementCount: dom,
      violations: [viol({ id: 'a', nodeCount: 8, impact: 'serious' }), viol({ id: 'b', nodeCount: 4, impact: 'moderate' })] }).score
    expect(s).toBeGreaterThanOrEqual(55); expect(s).toBeLessThanOrEqual(80)
  })
  it('a badly broken page → low but not pinned to 0 (5-40)', () => {
    const s = computeScoreV2({ incompleteCount: 10, wcagLevel: 'wcag21aa', domElementCount: dom,
      violations: [viol({ id: 'a', nodeCount: 120, impact: 'critical' }), viol({ id: 'b', nodeCount: 90, impact: 'serious' })] }).score
    expect(s).toBeGreaterThanOrEqual(5); expect(s).toBeLessThanOrEqual(40)
  })
})
```

Tune `K` (start 12; raise to sharpen penalties, lower to soften) until both bands
and all Step-1 assertions pass together. Record the final `K` in the module's
header comment with the calibration basis.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/scoring-v2.ts lib/ada-audit/scoring-v2.test.ts
git commit -m "feat(c9a): pure ADA scoring v2 (saturating density, WCAG-aware, calibrated)"
```

---

## Task 3: Wire v2 into the findings mapper + write the versioned breakdown

**Files:**
- Modify: `lib/findings/ada-mapper.ts`
- Test: `lib/findings/ada-mapper.test.ts` (add cases)

**Interfaces:**
- Consumes: `computeScoreV2`, `computeSiteScoreV2`, `serializeAdaBreakdown`,
  `ADA_SCORE_VERSION` from `@/lib/ada-audit/scoring-v2`.
- Produces: `run.score` = site mean v2 (site) / page v2 (standalone);
  `run.scoreBreakdown` = serialized ADA v2 breakdown; per-page `page.score` = v2.

- [ ] **Step 1: Extend `parseAxe` to return `domElementCount`**

In `lib/findings/ada-mapper.ts`, change the `ParsedAxe` interface and `parseAxe`:

```ts
interface ParsedAxe {
  violations: AxeViolation[]
  passCount: number
  incompleteCount: number
  domElementCount: number | null
}
```
and in `parseAxe`, add to the returned object:
```ts
      domElementCount: typeof r.domElementCount === 'number' ? r.domElementCount : null,
```

- [ ] **Step 2: Write the failing test**

Add to `lib/findings/ada-mapper.test.ts` (follow the file's existing fixture
style; if it lacks helpers, build a minimal `StoredAxeResults` JSON string):

```ts
describe('ada-mapper v2 scoring', () => {
  it('writes a version-2 scoreBreakdown on the standalone run', () => {
    const result = JSON.stringify({
      violations: [{ id: 'image-alt', impact: 'serious', help: '', description: '', helpUrl: '',
        tags: ['wcag2a'], nodes: [{ html: '<img>' }], nodeCount: 12 }],
      passes: [], incomplete: [], inapplicable: [], domElementCount: 800,
      timestamp: '', url: 'https://x.test/', testEngine: { name: '', version: '' }, testRunner: { name: '' },
    })
    const bundle = mapAdaSingle({ id: 'a1', url: 'https://x.test/', status: 'complete', result,
      finalUrl: null, wcagLevel: 'wcag21aa', clientId: null, startedAt: null, completedAt: null })
    expect(bundle.run.scoreBreakdown).toBeTruthy()
    const b = JSON.parse(bundle.run.scoreBreakdown as string)
    expect(b.version).toBe(2)
    expect(b.scorer).toBe('ada-v2')
    expect(bundle.run.score).toBe(bundle.pages[0].score)
  })

  it('site run score is the mean of per-page v2 scores', () => {
    const mk = (id: string, url: string, nodeCount: number) => ({
      id, url, status: 'complete', error: null, finalUrl: null,
      result: JSON.stringify({ violations: nodeCount ? [{ id: 'image-alt', impact: 'serious',
        help: '', description: '', helpUrl: '', tags: ['wcag2a'], nodes: [{ html: '<img>' }], nodeCount }] : [],
        passes: [], incomplete: [], inapplicable: [], domElementCount: 1000,
        timestamp: '', url, testEngine: { name: '', version: '' }, testRunner: { name: '' } }),
    })
    const parent = { id: 's1', domain: 'x.test', clientId: null, wcagLevel: 'wcag21aa',
      pagesError: 0, startedAt: null, completedAt: null }
    const bundle = mapAdaChildren(parent, [mk('c1', 'https://x.test/a', 0), mk('c2', 'https://x.test/b', 40)])
    const pageScores = bundle.pages.map((p) => p.score!).filter((s) => s != null)
    const mean = Math.round(pageScores.reduce((a, b) => a + b, 0) / pageScores.length)
    expect(bundle.run.score).toBe(mean)
    expect(JSON.parse(bundle.run.scoreBreakdown as string).version).toBe(2)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/ada-mapper.test.ts -t "v2 scoring"`
Expected: FAIL (`scoreBreakdown` undefined / score mismatch).

- [ ] **Step 4: Implement — standalone (`mapAdaSingle`)**

Replace the v1 line and the run object in `mapAdaSingle`:

```ts
  const axe = audit.status === 'complete' ? parseAxe(audit.result) : null
  const v2 = axe
    ? computeScoreV2({ violations: axe.violations, incompleteCount: axe.incompleteCount,
        domElementCount: axe.domElementCount, wcagLevel: audit.wcagLevel })
    : null
  const score = v2?.score ?? null
```

Leave `page.score = score` (it already binds `score`). In the returned `run`
object add, next to `score,`:

```ts
      score,
      scoreBreakdown: v2 ? serializeAdaBreakdown(v2.breakdown) : null,
```

- [ ] **Step 5: Implement — site (`mapAdaChildren`)**

In the child loop, compute the per-page v2 score and collect it. Replace the
`score: axe ? computeScore(...)` line in the `page` object with:

```ts
      score: axe
        ? computeScoreV2({ violations: axe.violations, incompleteCount: axe.incompleteCount,
            domElementCount: axe.domElementCount, wcagLevel: parent.wcagLevel }).score
        : null,
```

After the loop, before building the return, compute the site mean and breakdown:

```ts
  const pageScores = pages.map((p) => p.score).filter((s): s is number => s != null)
  const siteScore = computeSiteScoreV2(pageScores)
  const siteBreakdown: AdaScoreV2Breakdown = {
    version: ADA_SCORE_VERSION, scorer: 'ada-v2', score: siteScore,
    factors: { weightedFailNodes: 0, incompletePenalty: 0,
      domElementCount: 0, density: 0, k: 0, pagesScored: pageScores.length },
  }
```

In the returned `run` object, replace `score: computeScoreFromCounts(counts, parent.wcagLevel).score,`
with:

```ts
      score: siteScore,
      scoreBreakdown: serializeAdaBreakdown(siteBreakdown),
```

- [ ] **Step 6: Use the raw node count for `ViolationInput.nodeCount`**

In `emitPageViolations`, change `nodeCount: v.nodes?.length ?? 0,` to:

```ts
      nodeCount: v.nodeCount ?? v.nodes?.length ?? 0,
```

so the persisted `Violation.nodeCount` is the true count for new runs (keeps the
DB column honest; harmless for pre-v2 blobs).

- [ ] **Step 7: Update imports + drop now-unused v1 imports**

At the top of `ada-mapper.ts`: remove `computeScore, computeScoreFromCounts` from
the `@/lib/ada-audit/scoring` import IF they are no longer referenced (verify with
a grep — the file comment block also mentions them; update the comment). Add:

```ts
import { computeScoreV2, computeSiteScoreV2, serializeAdaBreakdown, ADA_SCORE_VERSION,
  type AdaScoreV2Breakdown } from '@/lib/ada-audit/scoring-v2'
```

Update the file's header comment (lines 5-10) to describe v2.

- [ ] **Step 8: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/ada-mapper.test.ts`
Expected: the new cases PASS. **Pre-existing mapper tests that assert exact v1
scores WILL fail — this is intentional, not a regression.** The mapper's output
score is changing from v1 to v2 by design. Specifically expect failures in any
test asserting: a standalone `mapAdaSingle` numeric `score`/`page.score`; a site
`mapAdaChildren` count-based `run.score`; and null-impact score behavior. For
each, recompute the expected value with the v2 formula (or assert a range /
`version === 2` instead of a brittle exact number where the exact value is not
the point) and update it. Do NOT change a v2 output to match an old v1 number.
Note every updated expectation in the commit body.

- [ ] **Step 9: Commit**

```bash
git add lib/findings/ada-mapper.ts lib/findings/ada-mapper.test.ts
git commit -m "feat(c9a): ada-mapper computes v2 score + writes versioned scoreBreakdown"
```

---

## Task 4: Confirm no breakdown-reader breaks + add a safe version reader

**Files:**
- Create: `lib/scoring/breakdown-version.ts`
- Test: `lib/scoring/breakdown-version.test.ts`
- (Verification only) grep `scoreBreakdown` readers.

**Interfaces:**
- Produces: `parseScoreVersion(scoreBreakdown: string | null | undefined): number`
  — returns `.version` if parseable, else `1`.

- [ ] **Step 1: Verify no SEO reader parses an ADA breakdown as `PersistedBreakdown`**

Run:
```bash
grep -rn "scoreBreakdown" lib app components --include=*.ts --include=*.tsx | grep -v "\.test\."
```
For each hit that `JSON.parse`s a breakdown, confirm it only ever receives
SEO-origin runs (`tool: 'seo-parser'`). Record findings in the commit message.
ADA runs are `tool: 'ada-audit'`; SEO result pages query by session/seo runs, so
they never receive an ADA breakdown. If any reader is shared, it must use
`parseScoreVersion` (below) or tolerate `version: 2`. **Do not widen
`PersistedBreakdown` in `weights.ts`** unless a shared reader forces it — ADA uses
its own `AdaScoreV2Breakdown` type, so the SEO type stays SEO-only.

- [ ] **Step 2: Write the failing test**

Create `lib/scoring/breakdown-version.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseScoreVersion } from './breakdown-version'

describe('parseScoreVersion', () => {
  it('reads the version from a v2 ADA breakdown', () => {
    expect(parseScoreVersion(JSON.stringify({ version: 2, scorer: 'ada-v2' }))).toBe(2)
  })
  it('reads the version from a v1 SEO breakdown', () => {
    expect(parseScoreVersion(JSON.stringify({ version: 1, scorer: 'health' }))).toBe(1)
  })
  it('defaults null/absent/garbage to 1', () => {
    expect(parseScoreVersion(null)).toBe(1)
    expect(parseScoreVersion(undefined)).toBe(1)
    expect(parseScoreVersion('not json')).toBe(1)
    expect(parseScoreVersion(JSON.stringify({ scorer: 'x' }))).toBe(1)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/breakdown-version.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `lib/scoring/breakdown-version.ts`:

```ts
// Pure, client-safe. Read the formula version from a scoreBreakdown string.
// A null/absent/unparseable breakdown means the score predates versioning → v1.
export function parseScoreVersion(scoreBreakdown: string | null | undefined): number {
  if (!scoreBreakdown) return 1
  try {
    const v = (JSON.parse(scoreBreakdown) as { version?: unknown }).version
    return typeof v === 'number' && Number.isFinite(v) ? v : 1
  } catch {
    return 1
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/breakdown-version.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/scoring/breakdown-version.ts lib/scoring/breakdown-version.test.ts
git commit -m "feat(c9a): parseScoreVersion helper + confirm no breakdown-reader regressions"
```

---

## Task 5: Version-aware trend / delta surfaces

**Files:**
- Modify: `lib/services/scorecard-shared.ts`
- Test: `lib/services/scorecard-shared.test.ts` (add cases)
- Modify: `lib/services/client-schedules.ts`, `lib/report/report-data.ts`, and any
  dashboard/fleet ScorePoint builder — populate `scoreVersion`.

**Interfaces:**
- Produces: `ScorePoint` gains `scoreVersion?: number` (default 1 when absent);
  `ScoreSeries` gains `formulaChanged: boolean`; `buildSeries` suppresses the
  delta (sets `delta: null`, `formulaChanged: true`) when the latest two points
  differ in version.

- [ ] **Step 1: Write the failing test**

Add to `lib/services/scorecard-shared.test.ts`:

```ts
describe('buildSeries version awareness', () => {
  it('computes a numeric delta within one version', () => {
    const s = buildSeries([
      { date: '2026-06-01T00:00:00Z', score: 70, scoreVersion: 1 },
      { date: '2026-07-01T00:00:00Z', score: 80, scoreVersion: 1 },
    ])
    expect(s.delta).toBe(10)
    expect(s.formulaChanged).toBe(false)
  })
  it('suppresses the delta across a v1→v2 boundary', () => {
    const s = buildSeries([
      { date: '2026-06-01T00:00:00Z', score: 70, scoreVersion: 1 },
      { date: '2026-07-01T00:00:00Z', score: 90, scoreVersion: 2 },
    ])
    expect(s.delta).toBeNull()
    expect(s.formulaChanged).toBe(true)
  })
  it('treats an absent version as 1', () => {
    const s = buildSeries([
      { date: '2026-06-01T00:00:00Z', score: 70 },
      { date: '2026-07-01T00:00:00Z', score: 80 },
    ])
    expect(s.delta).toBe(10)
    expect(s.formulaChanged).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/scorecard-shared.test.ts -t "version awareness"`
Expected: FAIL (`formulaChanged` undefined).

- [ ] **Step 3: Implement in `scorecard-shared.ts`**

Add `scoreVersion?: number` to `ScorePoint`; add `formulaChanged: boolean` to
`ScoreSeries`; add it to `EMPTY_SERIES` (`formulaChanged: false`). Rewrite
`buildSeries`:

```ts
export function buildSeries(points: ScorePoint[]): ScoreSeries {
  if (points.length === 0) return EMPTY_SERIES
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const latest = sorted[sorted.length - 1]
  const previous = sorted.length >= 2 ? sorted[sorted.length - 2] : null
  const changed = !!previous && (latest.scoreVersion ?? 1) !== (previous.scoreVersion ?? 1)
  return {
    latest: latest.score,
    previous: previous ? previous.score : null,
    delta: previous && !changed ? latest.score - previous.score : null,
    formulaChanged: changed,
    latestAt: latest.date,
    points: sorted.slice(-SPARKLINE_POINTS),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/scorecard-shared.test.ts`
Expected: PASS. Fix any pre-existing series test that now needs `formulaChanged`
in its expected object.

- [ ] **Step 5: Populate `scoreVersion` at the named ScorePoint builders**

These are the exact surfaces (Codex-enumerated). In each, add `scoreBreakdown` to
the Prisma `select` on the ADA `CrawlRun` rows, and set `scoreVersion:
parseScoreVersion(row.scoreBreakdown)` where the row → `ScorePoint` mapping
happens. Import `parseScoreVersion` from `@/lib/scoring/breakdown-version`.

- `lib/services/scorecard-shared.ts` — the ADA series helper `buildAdaSeries` (and
  confirm `buildSeoSeries` is left unchanged for SEO, or also carries version if
  it maps `CrawlRun`s; SEO runs already write a v1 breakdown, so
  `parseScoreVersion` returns 1 for them — safe to apply uniformly). Where these
  map rows → `ScorePoint`, attach `scoreVersion`.
- `lib/services/client-dashboard.ts` — the `crawlRuns` select must add
  `scoreBreakdown`; the row→point mapping attaches `scoreVersion`.
- `lib/services/client-fleet.ts` — same as client-dashboard.
- `lib/services/client-schedules.ts` (`lastDelta`, ~line 93) — the query reading
  `CrawlRun.score` by `siteAuditId` must also `select` `scoreBreakdown`; compute
  `lastDelta` between the two most recent runs with `parseScoreVersion` on each
  and set the delta to `null` (and surface a "formula changed" flag if the card
  renders one) when the versions differ.
- `lib/report/report-data.ts` (run + trend selectors, ~line 195) — add
  `scoreBreakdown` to both selects; attach `scoreVersion` to each trend
  `ScorePoint` so the PDF can detect the boundary from the points array itself
  (no `SiteReportData` shape change needed — see Step 5b).

- [ ] **Step 5b: Render the formula-change marker in the report HTML**

`lib/report/report-html.ts` receives the trend as `ScorePoint[]`. Since each
point now carries `scoreVersion`, the renderer detects a boundary without a data
shape change: when two adjacent trend points differ in `scoreVersion`, render a
small "formula changed" annotation (escaped) at that point and do NOT draw a
connecting delta label across it. Keep it minimal — one conditional in the
existing trend renderer. If the trend is drawn as an inline SVG, a short `<text>`
label or a dashed segment is sufficient.

- [ ] **Step 6: Add a focused test per wired surface**

Add at least one test each for `client-schedules` delta-suppression and the
report-data trend carrying `scoreVersion` (DB-backed where the service needs
rows; follow each file's existing test setup). Assert: same-version pair → numeric
delta; v1/v2 pair → null delta / marker.

- [ ] **Step 7: Run the service + report test dirs**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/ lib/report/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/services/scorecard-shared.ts lib/services/scorecard-shared.test.ts \
  lib/services/client-dashboard.ts lib/services/client-fleet.ts lib/services/client-schedules.ts \
  lib/report/report-data.ts lib/report/report-html.ts
# plus the added/updated tests for the wired surfaces
git commit -m "feat(c9a): version-aware trends — suppress v1↔v2 deltas, mark the boundary"
```

---

## Task 6: Read-surface preference + the v2 badge

**Files:**
- Create: `lib/ada-audit/display-score.ts`
- Test: `lib/ada-audit/display-score.test.ts`
- Create: `components/ada-audit/ScoreVersionBadge.tsx`
- Test: `components/ada-audit/ScoreVersionBadge.test.tsx`
- Modify: `app/ada-audit/[id]/page.tsx`, `app/ada-audit/share/[token]/page.tsx`
  (and confirm the site pages already prefer persisted score).

**Interfaces:**
- Produces: `resolveDisplayScore(args: { persistedScore: number | null; scoreBreakdown: string | null; recompute: () => number | null }): { score: number | null; version: number; fromFallback: boolean }`
  — prefer `persistedScore` + its parsed version; else recompute (v1) with
  `fromFallback: true`.
- Produces: `<ScoreVersionBadge version={n} fromFallback={bool} passCount={n} incompleteCount={n} />`.

- [ ] **Step 1: Write the failing test for the resolver**

Create `lib/ada-audit/display-score.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { resolveDisplayScore } from './display-score'

describe('resolveDisplayScore', () => {
  it('prefers the persisted score + its version', () => {
    const r = resolveDisplayScore({ persistedScore: 88,
      scoreBreakdown: JSON.stringify({ version: 2, scorer: 'ada-v2' }), recompute: () => 50 })
    expect(r).toEqual({ score: 88, version: 2, fromFallback: false })
  })
  it('recomputes as v1 when no persisted score exists', () => {
    const r = resolveDisplayScore({ persistedScore: null, scoreBreakdown: null, recompute: () => 73 })
    expect(r).toEqual({ score: 73, version: 1, fromFallback: true })
  })
  it('labels a persisted score without breakdown as v1', () => {
    const r = resolveDisplayScore({ persistedScore: 60, scoreBreakdown: null, recompute: () => 50 })
    expect(r).toEqual({ score: 60, version: 1, fromFallback: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/display-score.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Create `lib/ada-audit/display-score.ts`:

```ts
import { parseScoreVersion } from '@/lib/scoring/breakdown-version'

export function resolveDisplayScore(args: {
  persistedScore: number | null
  scoreBreakdown: string | null
  recompute: () => number | null
}): { score: number | null; version: number; fromFallback: boolean } {
  if (args.persistedScore != null) {
    return { score: args.persistedScore, version: parseScoreVersion(args.scoreBreakdown), fromFallback: false }
  }
  // Fallback recompute is always the frozen v1 formula.
  return { score: args.recompute(), version: 1, fromFallback: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/display-score.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the badge component test**

Create `components/ada-audit/ScoreVersionBadge.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ScoreVersionBadge } from './ScoreVersionBadge'

afterEach(cleanup)

describe('ScoreVersionBadge', () => {
  it('shows a v2 badge and pass/incomplete counts', () => {
    render(<ScoreVersionBadge version={2} fromFallback={false} passCount={40} incompleteCount={3} />)
    expect(screen.getByText(/v2/i)).toBeTruthy()
    expect(screen.getByText(/40/)).toBeTruthy()
    expect(screen.getByText(/3/)).toBeTruthy()
  })
  it('labels a fallback score as v1 / unavailable', () => {
    render(<ScoreVersionBadge version={1} fromFallback={true} passCount={null} incompleteCount={null} />)
    expect(screen.getByText(/v1/i)).toBeTruthy()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/ScoreVersionBadge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the badge (dark-mode)**

Create `components/ada-audit/ScoreVersionBadge.tsx`:

```tsx
export function ScoreVersionBadge({ version, fromFallback, passCount, incompleteCount }: {
  version: number
  fromFallback: boolean
  passCount: number | null
  incompleteCount: number | null
}) {
  const label = version >= 2 ? 'v2' : 'v1'
  const title = version >= 2
    ? 'Score v2 — size-normalized, WCAG-aware; passes & needs-review shown'
    : fromFallback
      ? 'Score v1 (formula label unavailable for this run)'
      : 'Score v1 (legacy formula)'
  return (
    <span className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-white/60">
      <span
        title={title}
        className="rounded px-1.5 py-0.5 font-medium bg-gray-100 text-gray-600 dark:bg-navy-border dark:text-white/70"
      >
        {label}
      </span>
      {passCount != null && <span>{passCount} passed</span>}
      {incompleteCount != null && <span>{incompleteCount} needs review</span>}
    </span>
  )
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/ScoreVersionBadge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 9: Add `crawlRun` to the detail-page query + prefer persisted v2**

In `app/ada-audit/[id]/page.tsx`, the main `prisma.adaAudit.findUnique` (lines
~24-32) currently `include`s `client` + `pdfAudits` but **NOT** `crawlRun`. Add it:

```tsx
    include: {
      client: { select: { name: true } },
      pdfAudits: { select: { url: true, fileSize: true, pageCount: true, issues: true, scanError: true } },
      crawlRun: { select: { score: true, scoreBreakdown: true } },
    },
```

Then replace the score/compliant derivation (currently lines ~176-178,
`const computed = computeScore(...)` / `const score = ...` / `const compliant = ...`)
with a version-aware block:

```tsx
  const { score, version, fromFallback } = resolveDisplayScore({
    persistedScore: audit.crawlRun?.score ?? null,
    scoreBreakdown: audit.crawlRun?.scoreBreakdown ?? null,
    // Archived blobs carry capped nodes → node-based v1 recompute would lie;
    // keep the archived guard for the fallback path only.
    recompute: () => (results.archived ? archivedScore ?? null : computeScore(results.violations, audit.wcagLevel).score),
  })
  // Compliance follows the score's version: v2 = no WCAG-conformance violation
  // (advisory best-practice findings don't break it); v1 fallback keeps the
  // legacy "zero violations" notion.
  const compliant = version >= 2
    ? computeComplianceV2(results.violations)
    : (results.archived ? results.violations.length === 0 : computeScore(results.violations, audit.wcagLevel).compliant)
```

Import `resolveDisplayScore` from `@/lib/ada-audit/display-score` and
`computeComplianceV2` from `@/lib/ada-audit/scoring-v2`; keep `computeScore`
imported (fallback). Compute `passCount`/`incompleteCount` for the badge:
`results.passes?.length ?? results.archivedCounts?.passed ?? null` and
`results.incomplete?.length ?? results.archivedCounts?.incomplete ?? null`.

- [ ] **Step 10: Thread the badge through the view components (real plumbing)**

The score number is NOT rendered in the page file — it flows into
`AuditResultsView` (`components/ada-audit/AuditResultsView.tsx`) which renders the
scorecard (`AuditScorecard`). Read `AuditResultsView.tsx` first to find the
score-render site. Add an optional prop `scoreMeta?: { version: number; fromFallback: boolean; passCount: number | null; incompleteCount: number | null }`
to `AuditResultsView` (and to the scorecard component it delegates to), thread it
from the page (`<AuditResultsView ... scoreMeta={{ version, fromFallback, passCount, incompleteCount }} />`),
and render `<ScoreVersionBadge {...scoreMeta} />` adjacent to the score in the
scorecard. Optional prop = backward-compatible: existing callers/tests that omit
it render exactly as today (no badge). Update the `AuditResultsView` test to
assert the badge appears when `scoreMeta` is passed.

- [ ] **Step 11: Share page + site pages**

- `app/ada-audit/share/[token]/page.tsx` (~line 82): add `crawlRun: { select: { score: true, scoreBreakdown: true } }` to its query, apply the same `resolveDisplayScore` + `computeComplianceV2` block, pass `scoreMeta` into its `AuditResultsView` (shareMode unchanged, read-only, no new fetches).
- `app/ada-audit/site/[id]/page.tsx` (~line 146) and `.../site/share/[token]/page.tsx` (~line 31): these already prefer `CrawlRun.score` then fall back to `computeScoreFromCounts`. Add `scoreBreakdown` to their `crawlRun`/run select, derive `version = parseScoreVersion(run?.scoreBreakdown)` and `fromFallback` (true when they hit the count fallback), and thread `scoreMeta` into `SiteAuditResultsView` (`components/ada-audit/SiteAuditResultsView.tsx`) → its scorecard, same optional-prop pattern. Site compliance: when `version >= 2`, the run is already v2-scored — leave the existing compliance derivation (site-level compliance stays count/summary-based in v1-of-v2; a per-page v2 compliance rollup is a documented follow-up, NOT built here to avoid loading blobs on the site page).

- [ ] **Step 12: Run the affected test dirs + lint**

Run: `npm run lint && DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/ lib/ada-audit/`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add lib/ada-audit/display-score.ts lib/ada-audit/display-score.test.ts \
  components/ada-audit/ScoreVersionBadge.tsx components/ada-audit/ScoreVersionBadge.test.tsx \
  components/ada-audit/AuditResultsView.tsx components/ada-audit/SiteAuditResultsView.tsx \
  app/ada-audit/[id]/page.tsx app/ada-audit/share/[token]/page.tsx \
  app/ada-audit/site/[id]/page.tsx app/ada-audit/site/share/[token]/page.tsx
git commit -m "feat(c9a): read surfaces prefer persisted v2 score; add version badge"
```

---

## Task 7: Full gate + parity check

**Files:** none (verification).

- [ ] **Step 1: Full gate**

Run:
```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all green.

- [ ] **Step 2: Sanity-check the v2 scale on real data**

`scripts/findings-rebuild.ts <id>` is **DB-mutating** (delete-and-recreate of the
run's findings tables) — NOT read-only. Do NOT run it against prod. Two safe
options, pick one:
- **(Preferred, no writes)** Write a throwaway `.mjs`/`.ts` that reads one recent
  completed ADA audit's blob from the **dev** DB (or a copied fixture), calls
  `mapAdaSingle`/`mapAdaChildren` in memory, and prints `run.score` +
  `scoreBreakdown.version` — no DB write at all.
- **(Dev-DB write, intentional)** Run `DATABASE_URL="file:./local-dev.db" npx tsx
  scripts/findings-rebuild.ts <id>` against a **dev** audit that still has its
  blob (the A2-f1 guard refuses a pruned one). This rewrites that dev run's
  findings — acceptable on dev only.

Either way, confirm `scoreBreakdown.version === 2` and the score lands in a
believable band vs the old v1 number (expect a shift — that is the point; it must
not be absurd, e.g. every page pinned to 0 or 100).

- [ ] **Step 3: Commit any calibration tweak**

If Step 2 shows the scale is off, adjust `K` in `scoring-v2.ts`, re-run Task 2's
tests + this gate, and commit:
```bash
git add lib/ada-audit/scoring-v2.ts lib/ada-audit/scoring-v2.test.ts
git commit -m "chore(c9a): calibrate K against real audit data"
```

---

## Post-plan: PR, deploy, verify, docs

(Not tasks — the change-control pipeline after the branch is green.)

1. Push `feat/c9a-ada-scoring-v2`, open the PR with `gh`.
2. Merge once gates re-run green in the session (rule 1).
3. Deploy `ssh seo@144.126.213.242 "~/deploy.sh"` (code-only, no migration).
4. **Prod verify:** run one real **client** audit (or wait for the weekly canary,
   client 31), confirm its live-scan/ada run `scoreBreakdown.version === 2` and the
   detail view shows the v2 badge; confirm an older audit still shows its v1
   number and a boundary-spanning trend renders the formula-change marker, not a
   bogus delta. Query prod read-only via a throwaway `.mjs` in the app dir.
5. Docs ritual: tracker checkbox (C9 → note C9-A done, C9-B pending) + dated
   status-log line; rewrite the handoff; move spec + plan to
   `docs/superpowers/archive/`; end the reply with the handoff paste-in prompt.

---

## Scope notes (v1-of-v2)

- **List / recents / API surfaces** (`lib/ada-audit/recents-query.ts`, the
  `/api/ada-audit` + `/api/site-audit` + `/api/audit-batches` + `audit-summary`
  routes) already **prefer the persisted `CrawlRun.score`** and only recompute a
  v1 count-based number as a null-fallback. They will therefore display the
  correct persisted v2 number for new audits with **no code change** — they just
  won't show a per-row version badge in v1-of-v2. That is acceptable: the badge
  lives on the detail / share / site / report / dashboard-trend surfaces where the
  score is the headline. A per-row list badge is a documented follow-up.
- **Site-level v2 compliance rollup** (per-page WCAG-conformance → site compliant)
  is deferred; site pages keep their existing count/summary-based compliance so we
  don't load per-page blobs on the site view. Documented follow-up.

## Self-Review

- **Spec coverage:** §3.1 per-page formula → Task 2. §3.2 site mean → Task 2/3.
  §3.4 raw nodeCount → Task 1. §4.1 version label → Task 3. §4.2 freeze +
  dual-write-fail label → Task 6 (`fromFallback`) + `resolveDisplayScore`. §4.3
  read-surface preference → Task 6. §4.4 trend widening → Task 5 (exact surfaces:
  scorecard-shared/client-dashboard/client-fleet/client-schedules/report-data/
  report-html). §5 surfacing → Task 6 badge threaded through `AuditResultsView`/
  `SiteAuditResultsView` → scorecard. **v2 compliance rule (spec §3.1 `compliant`)
  → Task 2 `computeComplianceV2` + Task 6 read-surface wiring** (Codex gap: score
  and compliance now move together, not score-v2 with compliance-v1). §6
  calibration → Task 2 Step 5 + Task 7 Step 2. §7 testing → every task's tests.
  §8 no-migration → Global Constraints + Task 4. §10 open items → Task 3 (factors
  shape, AdaAudit.score left to CrawlRun), Task 4 (reader grep), Task 1 (nodeCount
  capture), Task 5 (C3 diffing is findings-keyed — confirmed no change needed).
- **Query-shape correctness (Codex):** detail + share pages do NOT currently load
  `crawlRun` — Task 6 Steps 9/11 add the `include`/`select` explicitly.
- **Intentional test breakage (Codex):** Task 3 Step 8 tells the agent v1→v2 score
  changes in existing mapper tests are expected, and how to update them.
- **Placeholder scan:** every code step carries real code; the only judgment step
  is `K` calibration, which is bounded by the golden-band test.
- **Type consistency:** `computeScoreV2`/`computeSiteScoreV2`/`serializeAdaBreakdown`/
  `ADA_SCORE_VERSION`/`AdaScoreV2Breakdown` (Task 2) are used verbatim in Task 3;
  `parseScoreVersion` (Task 4) in Tasks 5 & 6; `resolveDisplayScore` (Task 6) shape
  matches its test; `ScorePoint.scoreVersion` + `ScoreSeries.formulaChanged`
  (Task 5) consistent across steps.
