# Live SEO Score (C6 Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the live-scan `CrawlRun` a real SEO health score (0–100 or `null`) computed from the on-page signals the C6 Phase 2 builder already harvests — a forked, coverage-aware scorer that never awards points for signals the live audit can't measure.

**Architecture:** A pure `scoreLiveSeo(inputs)` (`lib/findings/live-seo-score.ts`) called by the builder (`broken-link-verify.ts`) at build time, where the `HarvestedPageSeo` rows + SiteAudit counters are in hand; result replaces the hardcoded `null` on `CrawlRun.score`. Coverage/confidence is recomputed at read time for the results page — no migration, no runner surgery, no `selectRuns` change.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Vitest. Node 22.

**Spec:** `docs/superpowers/specs/2026-06-17-live-seo-score-design.md`

---

## Conventions (read once)
- Local prisma/vitest prefixed with `DATABASE_URL="file:./local-dev.db"`.
- Array-form `$transaction` only (not relevant here — no new transactions).
- DB-test hygiene: unique domain/id prefix; clean `CrawlRun` by domain BEFORE origin rows; `crawlRun` lookups by `siteAuditId` use the compound `siteAuditId_tool` input.

## File Structure

**Create:**
- `lib/findings/live-seo-score.ts` — pure `scoreLiveSeo(inputs): number | null` + `LiveScoreInputs`
- `lib/findings/live-seo-score.test.ts`

**Modify:**
- `lib/jobs/handlers/broken-link-verify.ts` — extend the `site` + `seoRows` selects, compute scorer inputs, set `run.score`
- `lib/jobs/handlers/broken-link-verify.test.ts` — score-persisted / observed≠pagesComplete / noindex→null / schema-affects tests
- `app/ada-audit/site/[id]/page.tsx` — select `score` + page `{statusCode, indexable}`; pass to `OnPageSeoSection`
- `components/site-audit/OnPageSeoSection.tsx` — render score + coverage line

---

## Phase 1 — The pure scorer

### Task 1: `scoreLiveSeo`

**Files:**
- Create: `lib/findings/live-seo-score.ts`
- Test: `lib/findings/live-seo-score.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { scoreLiveSeo, type LiveScoreInputs } from './live-seo-score'

// A perfect indexable site: every factor maxed.
const perfect = (o: Partial<LiveScoreInputs> = {}): LiveScoreInputs => ({
  attempted: 100, observed: 100, indexableScored: 100, pagesError: 0,
  missingTitle: 0, missingMeta: 0, missingH1: 0, thin: 0, pagesWithSchema: 30, ...o,
})

describe('scoreLiveSeo', () => {
  it('returns null when nothing was attempted', () => {
    expect(scoreLiveSeo(perfect({ attempted: 0 }))).toBeNull()
  })
  it('returns null below 50% extraction coverage (observed/attempted)', () => {
    expect(scoreLiveSeo(perfect({ attempted: 100, observed: 40, indexableScored: 40 }))).toBeNull()
  })
  it('returns null when no indexable pages (noindex / login-wall site)', () => {
    expect(scoreLiveSeo(perfect({ indexableScored: 0 }))).toBeNull()
  })
  it('scores a perfect indexable site at 100 (no phantom crawl-depth/broken factors)', () => {
    expect(scoreLiveSeo(perfect())).toBe(100)
  })
  it('penalizes missing titles', () => {
    expect(scoreLiveSeo(perfect({ missingTitle: 50 }))).toBeLessThan(100)
  })
  it('penalizes a high error rate', () => {
    expect(scoreLiveSeo(perfect({ pagesError: 50 }))).toBeLessThan(100)
  })
  it('penalizes thin content', () => {
    expect(scoreLiveSeo(perfect({ thin: 50 }))).toBeLessThan(100)
  })
  it('a partially-noindex site scores (not null) and below a fully-indexable one', () => {
    const partial = scoreLiveSeo(perfect({ indexableScored: 50 }))
    expect(partial).not.toBeNull()
    expect(partial!).toBeLessThan(100) // indexability factor (50/100) drags it down
  })
  it('indexability uses observed (not attempted) as denominator', () => {
    // observed 50 of 100 attempted (50% — passes the guard); all 50 indexable → indexability full
    const s = scoreLiveSeo(perfect({ attempted: 100, observed: 50, indexableScored: 50, pagesWithSchema: 15 }))
    expect(s).toBe(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/live-seo-score.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/findings/live-seo-score.ts
//
// C6 Phase 3: forked, coverage-aware live SEO health score (0–100 | null).
// Forked from computeHealthScore (lib/services/scoring.service.ts) with EXPLICIT
// factor availability — it must NOT (a) award full crawl-depth points for a
// missing/zero depth, or (b) skip thin content when no thin issue object exists.
// The live audit has no crawl graph, so crawl-depth and broken-link factors are
// never part of the denominator. Pure: all inputs are passed in by the builder.

export interface LiveScoreInputs {
  attempted: number        // SiteAudit.pagesTotal (discovered/attempted)
  observed: number         // HarvestedPageSeo row count (NOT pagesComplete)
  indexableScored: number  // observed rows that are indexable && !loginLike
  pagesError: number       // SiteAudit.pagesError
  missingTitle: number     // over the eligible (indexable && !login) set
  missingMeta: number
  missingH1: number
  thin: number             // 0 < wordCount < 300, over the eligible set
  pagesWithSchema: number  // observed rows with schemaCount > 0
}

const MIN_OBSERVED_COVERAGE = 0.5

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function scoreLiveSeo(inp: LiveScoreInputs): number | null {
  // Null-guard: not enough to produce an honest number.
  if (inp.attempted <= 0) return null
  if (inp.observed / inp.attempted < MIN_OBSERVED_COVERAGE) return null
  if (inp.indexableScored <= 0) return null // no indexable content → unscoreable

  const base = inp.indexableScored
  const observed = inp.observed
  const factors: Array<[number, number]> = [] // [earned, possible]

  // Indexability ratio (20) — observed HTML pages that are indexable.
  {
    const ratio = inp.indexableScored / observed
    const pts = ratio >= 0.95 ? 20 : (ratio / 0.95) * 20
    factors.push([clamp(pts, 0, 20), 20])
  }
  // Error rate (20) — full if < 1%, linear to 0 at 100%.
  {
    const errorRate = inp.pagesError / inp.attempted
    const pts = errorRate < 0.01 ? 20 : Math.max(0, 20 - errorRate * 20)
    factors.push([clamp(pts, 0, 20), 20])
  }
  // Missing title (10) / meta (8) / H1 (7) — over the indexable base.
  const missing = (count: number, weight: number) => {
    const pts = weight * (1 - Math.min(1, count / base))
    factors.push([clamp(pts, 0, weight), weight])
  }
  missing(inp.missingTitle, 10)
  missing(inp.missingMeta, 8)
  missing(inp.missingH1, 7)
  // Thin content (10) — full if < 5%, 0 if > 40%, linear between.
  {
    const ratio = inp.thin / base
    const pts = ratio < 0.05 ? 10 : ratio > 0.4 ? 0 : 10 * (1 - (ratio - 0.05) / 0.35)
    factors.push([clamp(pts, 0, 10), 10])
  }
  // Schema coverage (10) — full at >= 30% of observed.
  {
    const ratio = inp.pagesWithSchema / observed
    const pts = ratio >= 0.3 ? 10 : (ratio / 0.3) * 10
    factors.push([clamp(pts, 0, 10), 10])
  }

  const earned = factors.reduce((a, [e]) => a + e, 0)
  const possible = factors.reduce((a, [, p]) => a + p, 0)
  if (possible === 0) return null
  return clamp(Math.round((earned / possible) * 100), 0, 100)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/live-seo-score.test.ts`
Expected: PASS (9 tests). (Perfect inputs → earned 85 / possible 85 → 100, proving no crawl-depth/broken weight is in `possible`.)

- [ ] **Step 5: Commit**

```bash
git add lib/findings/live-seo-score.ts lib/findings/live-seo-score.test.ts
git commit -m "feat(c6): forked live SEO scorer (coverage-aware, null below coverage)"
```

---

## Phase 2 — Builder integration

### Task 2: Compute + persist the score in the builder

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts`
- Test: `lib/jobs/handlers/broken-link-verify.test.ts`

- [ ] **Step 1: Add DB-backed builder tests** to `broken-link-verify.test.ts` (follow the file's existing seed/cleanup harness — unique domain prefix; clean `crawlRun` by domain BEFORE origin rows; delete `harvestedLink`/`harvestedPageSeo`). Add these cases:

```ts
// Seed a SiteAudit + N HarvestedPageSeo rows; run the verifier (no broken links);
// read the live-scan run's score. Helper to seed an on-page row:
//   prisma.harvestedPageSeo.create({ data: { siteAuditId, url, statusCode: 200,
//     isHtml: true, robotsNoindex: false, xRobotsNoindex: false, loginLike: false,
//     title: 't', h1: 'h', metaDescription: 'm', wordCount: 800, schemaCount: 1 } })

it('persists a non-null score for an indexable run', async () => {
  // seed SiteAudit { pagesTotal: 3, pagesComplete: 3, pagesError: 0 } + 3 indexable rows w/ schema
  await runBrokenLinkVerify({ siteAuditId, domain }, stubDeps)
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } }, select: { score: true } })
  expect(run!.score).not.toBeNull()
  expect(run!.score).toBeGreaterThan(0)
})

it('score is null for a fully-noindex run', async () => {
  // seed pagesTotal: 3 + 3 rows all robotsNoindex: true
  await runBrokenLinkVerify({ siteAuditId, domain }, stubDeps)
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } }, select: { score: true } })
  expect(run!.score).toBeNull()
})

it('coverage uses the HarvestedPageSeo row count, not pagesComplete', async () => {
  // seed SiteAudit { pagesTotal: 10, pagesComplete: 10 } but only 3 indexable rows.
  // observed = 3 rows; 3/10 = 0.3 < 0.5 → null. (If it used pagesComplete=10, 10/10 would score.)
  await runBrokenLinkVerify({ siteAuditId, domain }, stubDeps)
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } }, select: { score: true } })
  expect(run!.score).toBeNull()
})

it('schema coverage moves the score (computed before transient deletion)', async () => {
  // run A: pagesTotal 4 + 4 indexable rows, schemaCount 1 each
  // run B (separate siteAudit): same but schemaCount 0 each
  // assert scoreA > scoreB
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: FAIL — score is still hardcoded `null` (and `schemaCount` not yet selected).

- [ ] **Step 3: Wire the scorer into the builder.** In `lib/jobs/handlers/broken-link-verify.ts`:

(a) Add the import near the other findings imports:
```ts
import { scoreLiveSeo } from '@/lib/findings/live-seo-score'
```

(b) Extend the `site` select (currently `{ id: true, domain: true, clientId: true }`) to add the counters:
```ts
    select: { id: true, domain: true, clientId: true, pagesTotal: true, pagesError: true },
```

(c) Extend the `seoRows` select to add `schemaCount`:
```ts
    select: {
      url: true, statusCode: true, isHtml: true, robotsNoindex: true, xRobotsNoindex: true,
      loginLike: true, title: true, h1: true, metaDescription: true, wordCount: true, schemaCount: true,
    },
```

(d) After `const findings: FindingInput[] = [...onPageFindings, ...brokenFindings]` and before the `bundle` literal, compute the score. `indexableOf` is already defined above; reuse it:
```ts
  // C6 Phase 3: live SEO score from the on-page signals (pure scorer).
  const runCounts = new Map(
    onPageFindings.filter((f) => f.scope === 'run').map((f) => [f.type, f.count] as const),
  )
  const score = scoreLiveSeo({
    attempted: site.pagesTotal,
    observed: seoRows.length,
    indexableScored: seoRows.filter((r) => indexableOf(r) && !r.loginLike).length,
    pagesError: site.pagesError,
    missingTitle: runCounts.get('missing_title') ?? 0,
    missingMeta: runCounts.get('missing_meta_description') ?? 0,
    missingH1: runCounts.get('missing_h1') ?? 0,
    thin: runCounts.get('thin_content') ?? 0,
    pagesWithSchema: seoRows.filter((r) => (r.schemaCount ?? 0) > 0).length,
  })
```

(e) In the `bundle.run` literal, replace `score: null,` with:
```ts
      score,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS (existing + 4 new). The on-page run-scope `count` for `missing_*`/`thin_content` is affected-page count (the on-page mapper), which is exactly the scorer's expected numerator.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(c6): compute + persist live SEO score in the live-scan builder"
```

---

## Phase 3 — Surface

### Task 3: Show the score + coverage on the results page

**Files:**
- Modify: `app/ada-audit/site/[id]/page.tsx`
- Modify: `components/site-audit/OnPageSeoSection.tsx`

- [ ] **Step 1: Extend the `liveScanRun` query** (`page.tsx:155-165`). Replace the `select` + the `onPageAnalyzed` line with:

```ts
  const liveScanRun = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: audit.id, tool: 'seo-parser' } },
    select: {
      status: true,
      score: true,
      findings: { select: { scope: true, type: true, count: true, url: true, detail: true } },
      // C6 Phase 3: page scalars drive the analyzed marker + the coverage line.
      pages: { select: { statusCode: true, indexable: true } },
    },
  })
  // observed = pages with a populated statusCode (= Phase-2 on-page rows).
  const observedPages = liveScanRun?.pages.filter((p) => p.statusCode != null).length ?? 0
  const indexablePages = liveScanRun?.pages.filter((p) => p.indexable === true).length ?? 0
  const onPageAnalyzed = observedPages > 0
```

- [ ] **Step 2: Pass the new props** to `OnPageSeoSection` (`page.tsx:203`):

```tsx
      <OnPageSeoSection
        run={liveScanRun}
        analyzed={onPageAnalyzed}
        score={liveScanRun?.score ?? null}
        observed={observedPages}
        indexable={indexablePages}
        attempted={audit.pagesTotal}
      />
```

- [ ] **Step 3: Render the score + coverage in `OnPageSeoSection.tsx`.** Update the signature and add a score header + coverage line. Change the component signature:

```tsx
export function OnPageSeoSection({
  run, analyzed, score, observed, indexable, attempted,
}: {
  run: BrokenLinksRun | null
  analyzed: boolean
  score: number | null
  observed: number
  indexable: number
  attempted: number
}) {
```

Add a small score+coverage block helper above the component (after `Card`):

```tsx
function ScoreLine({ score, observed, indexable, attempted }:
  { score: number | null; observed: number; indexable: number; attempted: number }) {
  return (
    <div className="mb-3">
      <p className="text-[13px] font-body text-navy dark:text-white">
        Live SEO score:{' '}
        {score === null ? (
          <span className="text-navy/50 dark:text-white/50">not enough coverage to score</span>
        ) : (
          <span className="font-heading font-semibold">{score}/100</span>
        )}
      </p>
      <p className="text-[12px] font-body text-navy/45 dark:text-white/45">
        {observed} of {attempted} page{attempted === 1 ? '' : 's'} analyzed · {indexable} indexable · rendered, sitemap-bounded (not Screaming Frog parity)
      </p>
    </div>
  )
}
```

Render `<ScoreLine .../>` at the top of BOTH the "clean" return and the "findings" return (the two branches reached when `run && analyzed`). In the **clean** branch, insert it before the green "no on-page issues" paragraph; in the **findings** branch, replace the existing `<p>Rendered-DOM, sitemap-bounded …</p>` caveat (line 72-74) with `<ScoreLine score={score} observed={observed} indexable={indexable} attempted={attempted} />` (it carries the same caveat). Leave the `!run` and `!analyzed` branches unchanged.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Manual verify** — `DATABASE_URL="file:./local-dev.db" npx next dev`, open a completed indexable site audit's results page; confirm the Live SEO score + coverage line render in the On-page SEO section.

- [ ] **Step 6: Commit**

```bash
git add app/ada-audit/site/[id]/page.tsx components/site-audit/OnPageSeoSection.tsx
git commit -m "feat(c6): surface the live SEO score + coverage on the results page"
```

---

## Phase 4 — Verify & ship

### Task 4: Full verification + deploy

- [ ] **Step 1: Typecheck + full suite**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npm test`
Expected: PASS, no regressions.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Deploy** (push first; server runs `prisma migrate deploy` — no migration this phase)

```bash
git push
ssh $PROD_SSH "~/deploy.sh"
```

- [ ] **Step 4: Live canary verification** (authed prod, per the handoff gotchas). Run an audit on an INDEXABLE client site (e.g. manhattanschool.edu) and confirm the live-scan `CrawlRun.score` is a 0–100 number consistent with its findings; run the noindex canary (proway.erstaging.site) and confirm `score` is `null` (no indexable pages). Spot-check the results page shows the score + coverage line.

- [ ] **Step 5: Update tracker + handoff** (improvement-roadmap protocol): C6 stays `[~]`, Phase 3 status-log line; archive this spec+plan on ship; rewrite the handoff for the next item (C7, or remaining C6 phases).

---

## Self-Review notes

- **Spec coverage:** §3 architecture → T1 (pure scorer) + T2 (build-time call); §4 coverage (`observed = row count`, attempted, indexableScored) → T2 Step 3(d) + the scorer; §5 null-guard (attempted=0 / <0.5 observed / indexableScored=0) + factor table → T1; §6 builder (schema before deletion, select extensions) → T2; §7 surface (score + counts, selectRuns unchanged) → T3; §8 testing → T1/T2 tests + T4; §9 acceptance → T4.
- **Codex fixes encoded:** `observed = seoRows.length` not `pagesComplete` (T2 + the "coverage uses row count" test); `indexableScored===0 → null` (T1 + the noindex test); schema computed at build before deletion (T2 select adds `schemaCount`, scorer reads `seoRows`); indexability denominator = observed (T1 + its test); no migration, `selectRuns` untouched (T3).
- **No placeholders:** scorer + builder wiring are complete code; T2 Step 1 / T3 sketch the test seeds + render against the existing harness/component by name (intentional, to match the repo's patterns).
- **Type consistency:** `LiveScoreInputs` (T1) is constructed in T2 Step 3(d) with matching field names; `scoreLiveSeo` returns `number | null` → `CrawlRun.score` (Int?) and the `score` prop (T3) is `number | null`.
