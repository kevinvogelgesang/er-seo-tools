# C5 — SEO Source-Agnostic Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize the A2 `FindingsBundle` as the source-agnostic crawl-ingestion contract, make every `Session.result` blob reader findings-capable (degraded fallback or explicit 409), and activate `PRUNE_ACTIVATED['seo-parser']`.

**Architecture:** Blob-first, findings-fallback (the proven C3 ada-audit pattern). A new run-centric builder (`lib/findings/seo-findings-fallback.ts`) reconstructs a degraded-but-safe `AggregatedResult` from `CrawlRun`/`CrawlPage`/`Finding` rows; view/JSON surfaces serve it with an archived banner, memo exports and diff refuse archived sessions with 409 `session_archived`. The SF parsers + aggregator stay untouched — they are the SF adapter's internals.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-seo-ingestion-interface-design.md` (Codex ×9 applied)

**House rules that apply to every task:** array-form `$transaction` only; DB-backed test files use a unique domain/id prefix, track created ids, clean only tracked ids (pre-clean prefix in `beforeAll`, clean `CrawlRun` by domain BEFORE origin rows); local commands prefix `DATABASE_URL="file:./local-dev.db"` for vitest/prisma.

---

## File structure

**Create:**
- `lib/findings/seo-findings-fallback.ts` — pure builder + DB loader (+ test)
- `components/seo-parser/ArchivedSessionBanner.tsx` — shared archived banner
- `lib/findings/seo-findings-fallback.test.ts`, `lib/findings/adapter-readiness.test.ts`, route/UI tests listed per task

**Modify:**
- `lib/findings/types.ts` (contract docs + `'live-scan'`), `lib/types/index.ts` (`archived?` flag)
- Readers: `app/seo-parser/results/[sessionId]/page.tsx`, `components/seo-parser/ResultsView.tsx`, `app/share/[token]/page.tsx`, `app/api/share/[token]/route.ts`, `app/api/share/route.ts`, `app/api/parse/[sessionId]/route.ts` (GET), `app/api/parse/history/route.ts`, `app/api/diff/route.ts`, `app/api/export/[sessionId]/[format]/route.ts`, `app/api/export/[sessionId]/claude/route.ts`, `app/api/seo-roadmap/[id]/route.ts`, `app/api/keyword-memo/[id]/route.ts`, `app/keyword-research/[sessionId]/page.tsx`
- `lib/findings/retention.ts` (flag flip) + its test, `scripts/findings-rebuild.ts`, `lib/findings/parity.ts`, `CLAUDE.md`

---

### Task 1: Ingestion contract — `'live-scan'` + adapter rules

**Files:**
- Modify: `lib/findings/types.ts`

- [ ] **Step 1: Extend the source union and write the contract header**

In `lib/findings/types.ts`, change the `CrawlRunInput.source` line to:

```ts
  source: 'sf-upload' | 'site-audit' | 'page-audit' | 'live-scan'
```

Replace the module header comment (lines 1–5) with:

```ts
// lib/findings/types.ts
//
// THE source-agnostic crawl-ingestion contract (C5). An "adapter" is any
// producer of crawl data — the SF-CSV pipeline (parsers + aggregator +
// seo-mapper) is adapter #1; the C6 live scan becomes adapter #2. Every
// adapter produces one FindingsBundle per run and persists it via
// writeFindingsRun() — fire-and-forget AFTER its legacy commit (or as its
// only write for blob-less sources).
//
// Adapter rules (all enforced by convention + parity, not the compiler):
// - URLs: every CrawlPageInput.url and page-scope FindingInput.url goes
//   through normalizeFindingUrl(); pages dedupe keep-first by normalized URL.
// - Dedup keys: runFindingKey(type) / pageFindingKey(type, url) from
//   keys.ts — never hand-rolled.
// - Severity vocabulary: exactly critical | warning | notice.
// - Issue shape: one run-scope finding per type (count + detail JSON
//   {description}) plus page-scope findings per affected URL carrying
//   affectedComplete/affectedSource.
// - Score: the adapter computes it; CrawlRun.score is the canonical
//   cross-source score (readers never depend on origin-row scores).
// - Origin: exactly ONE origin FK (writer-enforced). Origin FKs are each
//   @unique — one CrawlRun per origin row. C6 NOTE: a live-SEO run sharing
//   a SiteAudit origin with the ADA run requires removing @unique from
//   siteAuditId, adding @@unique([siteAuditId, tool]), and re-keying
//   writer.ts + every findUnique({ where: { siteAuditId } }) reader to
//   { siteAuditId, tool } — that migration ships IN the C6 PR that
//   introduces the second run, before any live-scan dual-write.
//
// Ids are pre-generated (crypto.randomUUID) so rows can cross-reference
// before insert — createMany cannot return ids.
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (union widened, no consumers narrow on `source`).

- [ ] **Step 3: Commit**

```bash
git add lib/findings/types.ts
git commit -m "feat(c5): live-scan source + adapter contract docs on FindingsBundle"
```

---

### Task 2: Degraded-report builder (`seo-findings-fallback.ts`)

**Files:**
- Modify: `lib/types/index.ts` (one field)
- Create: `lib/findings/seo-findings-fallback.ts`
- Test: `lib/findings/seo-findings-fallback.test.ts`

- [ ] **Step 1: Add the `archived` flag to `AggregatedResult`**

In `lib/types/index.ts`, inside `export interface AggregatedResult { ... }` add after `completeness?: Completeness;`:

```ts
  /** C5: set ONLY by the findings-fallback builder (blob pruned). Blob results never carry it. */
  archived?: boolean;
```

- [ ] **Step 2: Write the failing test**

`lib/findings/seo-findings-fallback.test.ts` — DB-backed, prefix `c5fb-`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from './writer'
import { runFindingKey, pageFindingKey } from './keys'
import { loadArchivedSeoResult, buildSeoResultFromRun } from './seo-findings-fallback'
import type { FindingsBundle } from './types'

const DOMAIN = 'c5fb-fallback.example.com'
const SESSION_ID = 'c5fb-session-1'
const createdSessionIds: string[] = []

async function cleanup() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: { in: createdSessionIds.length ? createdSessionIds : [SESSION_ID] } } })
}

function bundle(runId: string, sessionId: string): FindingsBundle {
  const pageA = { id: `${runId}-p1`, runId, url: `https://${DOMAIN}/a`, status: null, error: null, finalUrl: null, statusCode: null, title: 'A', h1: 'A', metaDescription: null, wordCount: 100, crawlDepth: 1, indexable: true, score: null, passCount: null, incompleteCount: null, adaAuditId: null }
  const pageB = { ...pageA, id: `${runId}-p2`, url: `https://${DOMAIN}/b`, wordCount: 300, crawlDepth: 3, indexable: false }
  return {
    run: { id: runId, tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId: null, sessionId, siteAuditId: null, adaAuditId: null, status: 'complete', score: 72, wcagLevel: null, pagesTotal: 2, startedAt: new Date(), completedAt: new Date() },
    pages: [pageA, pageB],
    findings: [
      { id: `${runId}-f1`, runId, pageId: null, scope: 'run', type: 'missing_title', severity: 'critical', url: null, count: 2, affectedComplete: true, affectedSource: 'derived-page-index', detail: JSON.stringify({ description: 'Pages missing titles' }), dedupKey: runFindingKey('missing_title') },
      { id: `${runId}-f2`, runId, pageId: pageA.id, scope: 'page', type: 'missing_title', severity: 'critical', url: pageA.url, count: 1, affectedComplete: true, affectedSource: 'derived-page-index', detail: null, dedupKey: pageFindingKey('missing_title', pageA.url) },
      { id: `${runId}-f3`, runId, pageId: null, scope: 'run', type: 'thin_content', severity: 'warning', url: null, count: 1, affectedComplete: null, affectedSource: null, detail: JSON.stringify({ description: 'Thin pages' }), dedupKey: runFindingKey('thin_content') },
    ],
    violations: [],
  }
}

beforeAll(async () => { await cleanup() })
afterAll(async () => { await cleanup() })

describe('loadArchivedSeoResult', () => {
  it('rebuilds a safe degraded AggregatedResult from findings rows', async () => {
    createdSessionIds.push(SESSION_ID)
    await prisma.session.create({ data: { id: SESSION_ID, files: '["internal_all.csv"]', status: 'complete', result: null, siteName: DOMAIN, totalUrls: 2, workflow: 'technical' } })
    await writeFindingsRun(bundle('c5fb-run-1', SESSION_ID))

    const r = await loadArchivedSeoResult(SESSION_ID)
    expect(r).not.toBeNull()
    expect(r!.archived).toBe(true)
    // crawl_summary reconstruction
    expect(r!.crawl_summary.total_urls).toBe(2)
    expect(r!.crawl_summary.indexable_urls).toBe(1)
    expect(r!.crawl_summary.non_indexable_urls).toBe(1)
    expect(r!.crawl_summary.avg_word_count).toBe(200)
    expect(r!.crawl_summary.max_crawl_depth).toBe(3)
    // status-code counts UNAVAILABLE (all statusCode null) — never 0
    expect(r!.crawl_summary.ok_responses).toBeUndefined()
    expect(r!.crawl_summary.client_errors).toBeUndefined()
    // issues from run-scope rows, urls from page-scope rows
    expect(r!.issues.critical).toHaveLength(1)
    expect(r!.issues.critical[0]).toMatchObject({ type: 'missing_title', count: 2, description: 'Pages missing titles', affectedUrlRefsComplete: true })
    expect(r!.issues.critical[0].urls).toEqual([`https://${DOMAIN}/a`])
    expect(r!.issues.warnings).toHaveLength(1)
    expect(r!.issues.notices).toEqual([])
    // depth distribution
    expect(r!.site_structure.crawl_depth_distribution).toEqual({ 1: 1, 3: 1 })
    // safe shape: arrays/objects the UI assumes
    expect(r!.recommendations).toEqual([])
    expect(r!.metadata.parsers_used).toEqual([])
    expect(r!.metadata.files_processed).toEqual(['internal_all.csv'])
    expect(r!.metadata.health_score).toBe(72)
    expect(r!.metadata.site_name).toBe(DOMAIN)
    expect(r!.resources).toEqual({})
    expect(r!.technical_seo).toEqual({})
    expect(r!.performance).toEqual({})
    // never fabricated
    expect(r!.completeness).toBeUndefined()
    expect(r!.keyword_signals).toBeUndefined()
    expect(r!.duplicate_content).toBeUndefined()
  })

  it('computes status buckets opportunistically when statusCode is present', async () => {
    const id = 'c5fb-session-2'
    createdSessionIds.push(id)
    await prisma.session.create({ data: { id, files: '[]', status: 'complete', result: null, workflow: 'technical' } })
    const b = bundle('c5fb-run-2', id)
    b.pages[0].statusCode = 200
    b.pages[1].statusCode = 404
    await writeFindingsRun(b)
    const r = await loadArchivedSeoResult(id)
    expect(r!.crawl_summary.ok_responses).toBe(1)
    expect(r!.crawl_summary.client_errors).toBe(1)
    expect(r!.crawl_summary.redirects).toBe(0)
    expect(r!.crawl_summary.server_errors).toBe(0)
  })

  it('returns null when the session has no CrawlRun', async () => {
    const id = 'c5fb-session-3'
    createdSessionIds.push(id)
    await prisma.session.create({ data: { id, files: '[]', status: 'complete', result: null, workflow: 'technical' } })
    expect(await loadArchivedSeoResult(id)).toBeNull()
  })
})

describe('buildSeoResultFromRun', () => {
  it('omits indexable counts when every page indexable is null', () => {
    const b = bundle('c5fb-pure-1', 'unused')
    b.pages = b.pages.map((p) => ({ ...p, indexable: null }))
    const r = buildSeoResultFromRun(
      { pagesTotal: 2, score: 50, domain: DOMAIN },
      b.pages.map((p) => ({ url: p.url, statusCode: p.statusCode, wordCount: p.wordCount, crawlDepth: p.crawlDepth, indexable: p.indexable })),
      [], { siteName: null, files: [] },
    )
    expect(r.crawl_summary.indexable_urls).toBeUndefined()
    expect(r.crawl_summary.non_indexable_urls).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/seo-findings-fallback.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// lib/findings/seo-findings-fallback.ts
//
// C5 findings-fallback (mirrors lib/ada-audit/findings-fallback.ts): rebuild
// a DEGRADED AggregatedResult from CrawlRun/CrawlPage/Finding rows once the
// Session.result blob is pruned. Degraded-by-contract: unknowns are OMITTED
// (render "—"/hidden), never fabricated as 0; arrays/objects the UI assumes
// always exist (safe shape). Run-centric so a future blob-less live-scan run
// renders through the same path.
import { prisma } from '@/lib/db'
import type { AggregatedResult, Issue, IssuesResult } from '@/lib/types'

interface RunFacts { pagesTotal: number; score: number | null; domain: string | null }
interface PageFacts { url: string; statusCode: number | null; wordCount: number | null; crawlDepth: number | null; indexable: boolean | null }
interface FindingFacts { scope: string; type: string; severity: string; url: string | null; count: number; affectedComplete: boolean | null; affectedSource: string | null; detail: string | null }
interface OriginContext { siteName: string | null; files: string[] }

const SEVERITY_TO_BUCKET = { critical: 'critical', warning: 'warnings', notice: 'notices' } as const

export function buildSeoResultFromRun(
  run: RunFacts,
  pages: PageFacts[],
  findings: FindingFacts[],
  origin: OriginContext,
): AggregatedResult {
  // --- crawl_summary ---
  const summary: AggregatedResult['crawl_summary'] = { total_urls: run.pagesTotal }
  const indexKnown = pages.filter((p) => p.indexable !== null)
  if (indexKnown.length > 0) {
    summary.indexable_urls = indexKnown.filter((p) => p.indexable === true).length
    summary.non_indexable_urls = indexKnown.filter((p) => p.indexable === false).length
  }
  const words = pages.map((p) => p.wordCount).filter((w): w is number => w !== null)
  if (words.length > 0) summary.avg_word_count = Math.round(words.reduce((a, b) => a + b, 0) / words.length)
  const depths = pages.map((p) => p.crawlDepth).filter((d): d is number => d !== null)
  if (depths.length > 0) {
    summary.avg_crawl_depth = Math.round((depths.reduce((a, b) => a + b, 0) / depths.length) * 10) / 10
    summary.max_crawl_depth = Math.max(...depths)
  }
  // Status buckets are OPPORTUNISTIC (Codex fix #6): computed only when page
  // status codes exist (future live-scan), never inferred from issue types.
  const statuses = pages.map((p) => p.statusCode).filter((s): s is number => s !== null)
  if (statuses.length > 0) {
    summary.ok_responses = statuses.filter((s) => s >= 200 && s < 300).length
    summary.redirects = statuses.filter((s) => s >= 300 && s < 400).length
    summary.client_errors = statuses.filter((s) => s >= 400 && s < 500).length
    summary.server_errors = statuses.filter((s) => s >= 500).length
  }

  // --- issues: run-scope rows are authoritative; page-scope rows supply URLs ---
  const urlsByType = new Map<string, string[]>()
  for (const f of findings) {
    if (f.scope !== 'page' || !f.url) continue
    const list = urlsByType.get(f.type) ?? []
    list.push(f.url)
    urlsByType.set(f.type, list)
  }
  const issues: IssuesResult = { critical: [], warnings: [], notices: [] }
  for (const f of findings) {
    if (f.scope !== 'run') continue
    let description = ''
    try { description = JSON.parse(f.detail ?? '{}')?.description ?? '' } catch { /* keep '' */ }
    const issue: Issue = {
      type: f.type,
      severity: f.severity as Issue['severity'],
      count: f.count,
      description,
      urls: (urlsByType.get(f.type) ?? []).sort(),
    }
    if (f.affectedComplete !== null) issue.affectedUrlRefsComplete = f.affectedComplete
    if (f.affectedSource !== null) issue.affectedUrlSource = f.affectedSource as Issue['affectedUrlSource']
    const bucket = SEVERITY_TO_BUCKET[f.severity as keyof typeof SEVERITY_TO_BUCKET]
    if (bucket) issues[bucket].push(issue)
  }
  for (const bucket of Object.values(issues)) {
    bucket.sort((a: Issue, b: Issue) => b.count - a.count || a.type.localeCompare(b.type))
  }

  // --- site_structure: depth distribution is cheaply reconstructible ---
  const site_structure: AggregatedResult['site_structure'] = {}
  if (depths.length > 0) {
    const dist: Record<number, number> = {}
    for (const d of depths) dist[d] = (dist[d] ?? 0) + 1
    site_structure.crawl_depth_distribution = dist
  }

  return {
    crawl_summary: summary,
    issues,
    site_structure,
    resources: {},
    technical_seo: {},
    performance: {},
    recommendations: [],
    metadata: {
      files_processed: origin.files,
      parsers_used: [],
      total_parsers_available: 0,
      site_name: origin.siteName ?? run.domain ?? undefined,
      health_score: run.score ?? undefined,
    },
    archived: true,
    // completeness intentionally ABSENT (Codex fix #4): callers must not
    // recompute it on degraded data — the archived banner replaces it.
  }
}

/** Session-origin loader. Returns null when no CrawlRun exists (pre-A2). */
export async function loadArchivedSeoResult(sessionId: string): Promise<AggregatedResult | null> {
  const run = await prisma.crawlRun.findUnique({
    where: { sessionId },
    select: {
      pagesTotal: true, score: true, domain: true,
      pages: { select: { url: true, statusCode: true, wordCount: true, crawlDepth: true, indexable: true } },
      findings: { select: { scope: true, type: true, severity: true, url: true, count: true, affectedComplete: true, affectedSource: true, detail: true } },
    },
  })
  if (!run) return null
  // Origin context is loaded per run type (Codex fix #8) — session origin here.
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { siteName: true, files: true } })
  let files: string[] = []
  try { const p = JSON.parse(session?.files ?? '[]'); files = Array.isArray(p) ? p : [] } catch { files = [] }
  return buildSeoResultFromRun(run, run.pages, run.findings, { siteName: session?.siteName ?? null, files })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/seo-findings-fallback.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/types/index.ts lib/findings/seo-findings-fallback.ts lib/findings/seo-findings-fallback.test.ts
git commit -m "feat(c5): degraded AggregatedResult builder from findings rows"
```

---

### Task 3: Archived banner component + ResultsView archived handling

**Files:**
- Create: `components/seo-parser/ArchivedSessionBanner.tsx`
- Modify: `components/seo-parser/ResultsView.tsx`
- Test: `components/seo-parser/ResultsView.archived.test.tsx`

- [ ] **Step 1: Banner component**

```tsx
// components/seo-parser/ArchivedSessionBanner.tsx
export function ArchivedSessionBanner() {
  return (
    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-6 py-4">
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Archived session</p>
      <p className="text-sm text-amber-700 dark:text-amber-200/80 mt-1">
        The full report data for this session was archived after 90 days. This view is rebuilt
        from the findings database — recommendations, keyword signals, duplicate-content detail,
        and performance data are unavailable.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write the failing test**

`components/seo-parser/ResultsView.archived.test.tsx` (jsdom; mock next/navigation + next/dynamic; localStorage quirk: none needed here):

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { ResultsView } from './ResultsView'
import type { AggregatedResult } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="chart" /> }))

const archivedResult: AggregatedResult = {
  crawl_summary: { total_urls: 5, indexable_urls: 4, non_indexable_urls: 1 },
  issues: {
    critical: [{ type: 'missing_title', severity: 'critical', count: 2, description: 'Missing titles', urls: ['https://x.test/a'] }],
    warnings: [], notices: [],
  },
  site_structure: { crawl_depth_distribution: { 1: 5 } },
  resources: {}, technical_seo: {}, performance: {},
  recommendations: [],
  metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0, site_name: 'x.test', health_score: 70 },
  archived: true,
}

describe('ResultsView archived mode', () => {
  it('shows the archived banner and suppresses completeness + status-code card', () => {
    render(<ResultsView result={archivedResult} sessionId="00000000-0000-4000-8000-000000000000" />)
    expect(screen.getByText('Archived session')).toBeTruthy()
    // completeness recompute suppressed: no completeness banner copy
    expect(screen.queryByText(/internal crawl/i)).toBeNull()
    // status-code card hidden at container level (no status data)
    expect(screen.queryByText('Response Code Distribution')).toBeNull()
    // depth chart still renders (reconstructed distribution)
    expect(screen.getByText('Crawl Depth Distribution')).toBeTruthy()
  })

  it('keeps the status-code card for non-archived results with status data', () => {
    const fresh = { ...archivedResult, archived: undefined, crawl_summary: { ...archivedResult.crawl_summary, ok_responses: 5, redirects: 0, client_errors: 0, server_errors: 0 } }
    render(<ResultsView result={fresh} sessionId="00000000-0000-4000-8000-000000000000" />)
    expect(screen.getByText('Response Code Distribution')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/ResultsView.archived.test.tsx`
Expected: FAIL (no banner, completeness recompute crashes or renders, status card always renders).

- [ ] **Step 4: Modify `ResultsView.tsx`**

Four changes:

1. Import the banner: `import { ArchivedSessionBanner } from './ArchivedSessionBanner';`
2. Header sub-line (lines 67–70) becomes:

```tsx
            {result.archived ? (
              <p className="text-gray-500 dark:text-white/50 text-sm mt-1">Archived — rebuilt from findings data</p>
            ) : (
              <p className="text-gray-500 dark:text-white/50 text-sm mt-1">
                {result.metadata.files_processed.length} files · {result.metadata.parsers_used.length}
                {result.metadata.total_parsers_available ? `/${result.metadata.total_parsers_available}` : ''} parsers matched
              </p>
            )}
```

3. Completeness banner (line 92) becomes (Codex fix #4 — never recompute on archived):

```tsx
        {result.archived ? (
          <ArchivedSessionBanner />
        ) : (
          <AuditCompletenessBanner completeness={result.completeness ?? computeCompleteness(result)} />
        )}
```

4. Status-code chart card (lines 121–123) is guarded at the container level (Codex fix #7). Add above the return, then wrap:

```tsx
  const hasStatusData = [
    result.crawl_summary.ok_responses,
    result.crawl_summary.redirects,
    result.crawl_summary.client_errors,
    result.crawl_summary.server_errors,
  ].some((v) => typeof v === 'number');
```

```tsx
          {hasStatusData && (
            <ChartCard title="Response Code Distribution">
              <StatusCodeBarChart summary={result.crawl_summary} />
            </ChartCard>
          )}
```

Also guard the debug footer (line 163) — `parsers_used` is `[]` on archived:

```tsx
        {result.metadata.parsers_used.length > 0 && (
          <details className="text-xs text-gray-400 dark:text-white/40 pb-4">
            <summary className="cursor-pointer hover:text-gray-600 dark:hover:text-white/60 select-none">Debug info</summary>
            <p className="mt-1">Parsers used: {result.metadata.parsers_used.join(', ')}</p>
          </details>
        )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/ResultsView.archived.test.tsx`
Expected: PASS (2 tests). If the dynamic-import mock fights the named-export pattern (`dynamic(() => import(...).then(...))`), mock as `vi.mock('next/dynamic', () => ({ default: (load: unknown, _opts: unknown) => function DynamicStub() { return <div data-testid="chart" /> } }))`.

- [ ] **Step 6: Commit**

```bash
git add components/seo-parser/ArchivedSessionBanner.tsx components/seo-parser/ResultsView.tsx components/seo-parser/ResultsView.archived.test.tsx
git commit -m "feat(c5): archived mode in ResultsView (banner, completeness suppression, status-card guard)"
```

---

### Task 4: Results page + parse GET fallback

**Files:**
- Modify: `app/seo-parser/results/[sessionId]/page.tsx` (guard ~line 52, parse ~line 92)
- Modify: `app/api/parse/[sessionId]/route.ts` (GET, ~line 365)
- Test: `app/api/parse/parse-get-archived.test.ts` (new DB-backed file — the existing parse route tests are mock-based POST tests; per house rules add a DB-backed sibling)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from '@/lib/findings/writer'
import { runFindingKey } from '@/lib/findings/keys'
import { GET } from '@/app/api/parse/[sessionId]/route'
import { NextRequest } from 'next/server'

const DOMAIN = 'c5pg-archived.example.com'
const SESSION_ID = '11111111-1111-4111-8111-c5a000000001'

async function cleanup() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.session.create({ data: { id: SESSION_ID, files: '[]', status: 'complete', result: null, siteName: DOMAIN, totalUrls: 1, workflow: 'technical' } })
  await writeFindingsRun({
    run: { id: 'c5pg-run-1', tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId: null, sessionId: SESSION_ID, siteAuditId: null, adaAuditId: null, status: 'complete', score: 64, wcagLevel: null, pagesTotal: 1, startedAt: null, completedAt: new Date() },
    pages: [{ id: 'c5pg-p1', runId: 'c5pg-run-1', url: `https://${DOMAIN}/`, status: null, error: null, finalUrl: null, statusCode: null, title: 'T', h1: null, metaDescription: null, wordCount: 50, crawlDepth: 0, indexable: true, score: null, passCount: null, incompleteCount: null, adaAuditId: null }],
    findings: [{ id: 'c5pg-f1', runId: 'c5pg-run-1', pageId: null, scope: 'run', type: 'thin_content', severity: 'warning', url: null, count: 1, affectedComplete: null, affectedSource: null, detail: JSON.stringify({ description: 'Thin' }), dedupKey: runFindingKey('thin_content') }],
    violations: [],
  })
})
afterAll(cleanup)

describe('GET /api/parse/[sessionId] on an archived session', () => {
  it('serves the degraded result with archived marker', async () => {
    const res = await GET(new NextRequest('http://test/api/parse/x'), { params: Promise.resolve({ sessionId: SESSION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('complete')
    expect(body.result.archived).toBe(true)
    expect(body.result.metadata.health_score).toBe(64)
    expect(body.result.issues.warnings).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/parse/parse-get-archived.test.ts`
Expected: FAIL — `body.result` is null today.

- [ ] **Step 3: Implement the GET fallback**

In `app/api/parse/[sessionId]/route.ts` add import `import { loadArchivedSeoResult } from '@/lib/findings/seo-findings-fallback';` and replace the complete branch (~line 365):

```ts
    let result = null;
    try { result = session.result ? JSON.parse(session.result) : null; } catch { result = null; }
    if (!result) {
      // C5: blob pruned (90-d archive) — serve the degraded findings-backed result.
      result = await loadArchivedSeoResult(sessionId);
    }
    return NextResponse.json({ status: 'complete', result });
```

- [ ] **Step 4: Implement the results-page fallback**

In `app/seo-parser/results/[sessionId]/page.tsx`:

1. Import: `import { loadArchivedSeoResult } from '@/lib/findings/seo-findings-fallback';`
2. Waiting-screen guard (~line 52): change `if (session.status !== 'complete' || !session.result) {` to `if (session.status !== 'complete') {` (the inner copy already branches on `error`/`parsing`; a non-complete status never had a result).
3. Result load (~line 92):

```tsx
  const result = (session.result ? parseStoredResult(session.result) : null)
    ?? await loadArchivedSeoResult(sessionId);
  if (!result) {
    return <ResultErrorState />;
  }
```

4. Archived sessions don't compose memo flows (mint → 409 dead end): wrap the props —

```tsx
  const rm = result.archived ? null : await prisma.seoRoadmap.findUnique({ where: { sessionId } });

  return (
    <ResultsView
      result={result}
      sessionId={sessionId}
      pillarButton={result.archived ? undefined : <PillarAnalysisButton sessionId={sessionId} />}
      roadmap={
        result.archived ? undefined : (
          <SeoRoadmapCard
            ... (existing props unchanged)
          />
        )
      }
    />
  );
```

- [ ] **Step 5: Run test + typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/parse/parse-get-archived.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add 'app/seo-parser/results/[sessionId]/page.tsx' 'app/api/parse/[sessionId]/route.ts' app/api/parse/parse-get-archived.test.ts
git commit -m "feat(c5): results page + parse GET serve archived findings fallback"
```

---

### Task 5: Share surfaces (page, token API, mint)

**Files:**
- Modify: `app/share/[token]/page.tsx`, `app/api/share/[token]/route.ts`, `app/api/share/route.ts`
- Test: `app/api/share/share-archived.test.ts` (DB-backed)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from '@/lib/findings/writer'
import { runFindingKey } from '@/lib/findings/keys'
import { GET as shareGet } from '@/app/api/share/[token]/route'
import { POST as shareMint } from '@/app/api/share/route'
import { NextRequest } from 'next/server'

const DOMAIN = 'c5sh-archived.example.com'
const SESSION_ID = '22222222-2222-4222-8222-c5a000000002'
const TOKEN = 'c5sh-token-archived-0000000000000000'

async function cleanup() {
  await prisma.shareLink.deleteMany({ where: { sessionId: SESSION_ID } })
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.session.create({ data: { id: SESSION_ID, files: '[]', status: 'complete', result: null, siteName: DOMAIN, workflow: 'technical' } })
  await writeFindingsRun({
    run: { id: 'c5sh-run-1', tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId: null, sessionId: SESSION_ID, siteAuditId: null, adaAuditId: null, status: 'complete', score: 80, wcagLevel: null, pagesTotal: 1, startedAt: null, completedAt: new Date() },
    pages: [{ id: 'c5sh-p1', runId: 'c5sh-run-1', url: `https://${DOMAIN}/`, status: null, error: null, finalUrl: null, statusCode: null, title: 'T', h1: null, metaDescription: null, wordCount: 10, crawlDepth: 0, indexable: true, score: null, passCount: null, incompleteCount: null, adaAuditId: null }],
    findings: [{ id: 'c5sh-f1', runId: 'c5sh-run-1', pageId: null, scope: 'run', type: 'missing_h1', severity: 'warning', url: null, count: 1, affectedComplete: null, affectedSource: null, detail: JSON.stringify({ description: 'Missing H1' }), dedupKey: runFindingKey('missing_h1') }],
    violations: [],
  })
  await prisma.shareLink.create({ data: { sessionId: SESSION_ID, token: TOKEN, expiresAt: new Date(Date.now() + 86400_000) } })
})
afterAll(cleanup)

describe('share surfaces on an archived session', () => {
  it('GET /api/share/[token] serves the degraded result', async () => {
    const res = await shareGet(new NextRequest('http://test/api/share/x'), { params: Promise.resolve({ token: TOKEN }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.archived).toBe(true)
    expect(body.result.issues.warnings).toHaveLength(1)
  })

  it('POST /api/share mints for an archived session (findings run exists)', async () => {
    const res = await shareMint(new NextRequest('http://test/api/share', { method: 'POST', body: JSON.stringify({ sessionId: SESSION_ID }) }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBeTruthy()
    await prisma.shareLink.deleteMany({ where: { token: body.token } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/share/share-archived.test.ts`
Expected: FAIL — token GET 400, mint 400.

- [ ] **Step 3: Implement**

`app/api/share/[token]/route.ts` — import the loader; replace the result block:

```ts
  if (session.status !== 'complete') {
    return NextResponse.json({ error: 'Session result not available' }, { status: 400 });
  }

  let result: AggregatedResult | null = null;
  if (session.result) {
    try { result = JSON.parse(session.result) as AggregatedResult; }
    catch { return NextResponse.json({ error: 'Failed to parse session result' }, { status: 500 }); }
  } else {
    result = await loadArchivedSeoResult(session.id); // C5: blob pruned
  }
  if (!result) {
    return NextResponse.json({ error: 'Session result not available' }, { status: 400 });
  }
```

`app/api/share/route.ts` (mint) — widen the existence check:

```ts
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { crawlRun: { select: { id: true } } },
  });

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (session.status !== 'complete' || (!session.result && !session.crawlRun)) {
    return NextResponse.json({ error: 'Session is not complete' }, { status: 400 });
  }
```

`app/share/[token]/page.tsx` — same blob-or-fallback load as the API; import `ArchivedSessionBanner` and the loader:

```tsx
  if (session.status !== 'complete') {
    return <ErrorState message="The session result for this link is not yet available." />;
  }

  let result: AggregatedResult | null = null;
  if (session.result) {
    try { result = JSON.parse(session.result) as AggregatedResult; }
    catch { return <ErrorState message="Could not parse the session result. Please contact the report owner." />; }
  } else {
    result = await loadArchivedSeoResult(session.id);
  }
  if (!result) {
    return <ErrorState message="The session result for this link is not yet available." />;
  }
```

Inside the JSX, under the header `<div>`: `{result.archived && <ArchivedSessionBanner />}`; guard the files line and footer:

```tsx
            {!result.archived && (
              <p className="text-gray-500 dark:text-white/50 text-sm mt-1">
                {result.metadata.files_processed.length} file
                {result.metadata.files_processed.length !== 1 ? 's' : ''} processed
              </p>
            )}
```

```tsx
          {result.metadata.parsers_used.length > 0 && (
            <div className="text-xs text-gray-400 dark:text-white/40 pb-4">
              Parsers used: {result.metadata.parsers_used.join(', ')}
            </div>
          )}
```

- [ ] **Step 4: Middleware check (thrice-bitten gotcha)**

Run: `grep -n "share" middleware.ts middleware.test.ts | head -20`
Expected: `/share/` and `/api/share/` already public with test coverage (this feature predates C5; no new routes are added). If `/share/` lacks a `middleware.test.ts` case, add one asserting it is public.

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/share/share-archived.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add 'app/share/[token]/page.tsx' 'app/api/share/[token]/route.ts' app/api/share/route.ts app/api/share/share-archived.test.ts
git commit -m "feat(c5): share page/API/mint serve archived sessions via findings fallback"
```

---

### Task 6: History route flip (blob-free for A2 sessions)

**Files:**
- Modify: `app/api/parse/history/route.ts`
- Test: `app/api/parse/history-flip.test.ts` (DB-backed)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { GET } from '@/app/api/parse/history/route'

const DOMAIN = 'c5hi-history.example.com'
const A2_ID = '33333333-3333-4333-8333-c5a000000003'
const PRE_A2_ID = '33333333-3333-4333-8333-c5a000000004'

async function cleanup() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: { in: [A2_ID, PRE_A2_ID] } } })
}

beforeAll(async () => {
  await cleanup()
  // A2 session: blob pruned, CrawlRun.score is the source
  await prisma.session.create({ data: { id: A2_ID, files: '[]', status: 'complete', result: null, siteName: DOMAIN, totalUrls: 7, workflow: 'technical' } })
  await prisma.crawlRun.create({ data: { id: 'c5hi-run-1', tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, sessionId: A2_ID, status: 'complete', score: 91, pagesTotal: 7, completedAt: new Date() } })
  // pre-A2-shaped session: no CrawlRun, blob carries the score
  await prisma.session.create({ data: { id: PRE_A2_ID, files: '[]', status: 'complete', siteName: DOMAIN, workflow: 'technical', result: JSON.stringify({ metadata: { health_score: 55, total_urls: 3 } }) } })
})
afterAll(cleanup)

describe('GET /api/parse/history', () => {
  it('serves healthScore from CrawlRun.score and urlCount from Session.totalUrls', async () => {
    const res = await GET()
    const body = await res.json()
    const a2 = body.sessions.find((s: { id: string }) => s.id === A2_ID)
    expect(a2.healthScore).toBe(91)
    expect(a2.urlCount).toBe(7)
  })

  it('keeps the blob fallback for pre-A2 sessions', async () => {
    const res = await GET()
    const body = await res.json()
    const legacy = body.sessions.find((s: { id: string }) => s.id === PRE_A2_ID)
    expect(legacy.healthScore).toBe(55)
    expect(legacy.urlCount).toBe(3)
  })
})
```

NOTE: check the actual response envelope first (`sessions` key vs bare array) — `sed -n '60,80p' app/api/parse/history/route.ts` — and match the test to it.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/parse/history-flip.test.ts`
Expected: A2 case FAIL (blob is null → healthScore undefined today).

- [ ] **Step 3: Implement**

In `app/api/parse/history/route.ts`, add to the `select`: `totalUrls: true, crawlRun: { select: { score: true } },` and replace the extraction block:

```ts
      // C5 flip: CrawlRun.score + Session.totalUrls scalars first;
      // the blob parse survives only for pre-A2 sessions (no CrawlRun).
      let healthScore: number | undefined = s.crawlRun?.score ?? undefined;
      let urlCount: number | undefined = s.totalUrls ?? undefined;
      if (!s.crawlRun) {
        try {
          if (s.result) {
            const r = JSON.parse(s.result);
            healthScore = typeof r?.healthScore === 'number' ? r.healthScore :
                          typeof r?.metadata?.health_score === 'number' ? r.metadata.health_score : undefined;
            urlCount = urlCount ?? (typeof r?.summary?.totalUrls === 'number' ? r.summary.totalUrls :
                       typeof r?.metadata?.total_urls === 'number' ? r.metadata.total_urls : undefined);
          }
        } catch { /* ignore */ }
      }
```

Keep the `const { result: _result, client: _client, ...rest } = s;` strip and add `crawlRun: _crawlRun,` to it so the relation never leaks into the response.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/parse/history-flip.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/parse/history/route.ts app/api/parse/history-flip.test.ts
git commit -m "feat(c5): history route reads CrawlRun.score + Session scalars (blob only pre-A2)"
```

---

### Task 7: Diff route — refuse archived sessions

**Files:**
- Modify: `app/api/diff/route.ts`
- Test: `app/api/diff/diff-archived.test.ts` (DB-backed)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { POST } from '@/app/api/diff/route'
import { NextRequest } from 'next/server'

const FRESH_ID = '44444444-4444-4444-8444-c5a000000005'
const ARCHIVED_ID = '44444444-4444-4444-8444-c5a000000006'
const BLOB = JSON.stringify({ crawl_summary: { total_urls: 1 }, issues: { critical: [], warnings: [], notices: [] }, metadata: {} })

async function cleanup() {
  await prisma.session.deleteMany({ where: { id: { in: [FRESH_ID, ARCHIVED_ID] } } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.session.create({ data: { id: FRESH_ID, files: '[]', status: 'complete', result: BLOB, workflow: 'technical' } })
  await prisma.session.create({ data: { id: ARCHIVED_ID, files: '[]', status: 'complete', result: null, workflow: 'technical' } })
})
afterAll(cleanup)

function req(a: string, b: string) {
  return new NextRequest('http://test/api/diff', { method: 'POST', body: JSON.stringify({ sessionAId: a, sessionBId: b }) })
}

describe('POST /api/diff with an archived side', () => {
  it('refuses with 409 session_archived', async () => {
    const res = await POST(req(FRESH_ID, ARCHIVED_ID))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('session_archived')
  })

  it('still diffs two fresh sessions', async () => {
    const res = await POST(req(FRESH_ID, FRESH_ID))
    expect(res.status).toBe(200)
  })
})
```

NOTE: confirm the request body field names first (`sessionAId`/`sessionBId` vs `session_a`/`session_b`): `sed -n '1,40p' app/api/diff/route.ts` — match the test to reality.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/diff/diff-archived.test.ts`
Expected: archived case FAIL (today: JSON.parse('') throws → 500).

- [ ] **Step 3: Implement**

In `app/api/diff/route.ts`, after the two status-complete checks and BEFORE the parse blocks:

```ts
    // C5: degraded diffs are refused — diffCrawls coalesces missing numerics
    // with ?? 0, so a full-vs-degraded diff would fabricate false deltas.
    if (!sessionA.result || !sessionB.result) {
      return NextResponse.json({ error: 'session_archived' }, { status: 409 });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/diff/diff-archived.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/diff/route.ts app/api/diff/diff-archived.test.ts
git commit -m "feat(c5): diff refuses archived sessions (409 session_archived)"
```

---

### Task 8: Export routes — degraded format exports, archived 409s on memo exports

**Files:**
- Modify: `app/api/export/[sessionId]/[format]/route.ts`, `app/api/export/[sessionId]/claude/route.ts`, `app/api/seo-roadmap/[id]/route.ts`, `app/api/keyword-memo/[id]/route.ts`
- Test: `app/api/export/export-archived.test.ts` (DB-backed; covers format + claude; the two token routes get their archived branch asserted in the same file by direct import — they validate tokens first, so seed via their existing mock-based test files ONLY if token bypass is impractical: see Step 3 note)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from '@/lib/findings/writer'
import { runFindingKey } from '@/lib/findings/keys'
import { GET as formatGet } from '@/app/api/export/[sessionId]/[format]/route'
import { GET as claudeGet } from '@/app/api/export/[sessionId]/claude/route'
import { NextRequest } from 'next/server'

const DOMAIN = 'c5ex-archived.example.com'
const SESSION_ID = '55555555-5555-4555-8555-c5a000000007'

async function cleanup() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.session.create({ data: { id: SESSION_ID, files: '[]', status: 'complete', result: null, siteName: DOMAIN, totalUrls: 1, workflow: 'technical' } })
  await writeFindingsRun({
    run: { id: 'c5ex-run-1', tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId: null, sessionId: SESSION_ID, siteAuditId: null, adaAuditId: null, status: 'complete', score: 70, wcagLevel: null, pagesTotal: 1, startedAt: null, completedAt: new Date() },
    pages: [{ id: 'c5ex-p1', runId: 'c5ex-run-1', url: `https://${DOMAIN}/`, status: null, error: null, finalUrl: null, statusCode: null, title: 'T', h1: null, metaDescription: null, wordCount: 10, crawlDepth: 0, indexable: true, score: null, passCount: null, incompleteCount: null, adaAuditId: null }],
    findings: [{ id: 'c5ex-f1', runId: 'c5ex-run-1', pageId: null, scope: 'run', type: 'broken_pages', severity: 'critical', url: null, count: 1, affectedComplete: null, affectedSource: null, detail: JSON.stringify({ description: 'Broken' }), dedupKey: runFindingKey('broken_pages') }],
    violations: [],
  })
})
afterAll(cleanup)

const params = (format: string) => ({ params: Promise.resolve({ sessionId: SESSION_ID, format }) })

describe('exports on an archived session', () => {
  it('markdown export serves degraded data with an archived note', async () => {
    const res = await formatGet(new NextRequest('http://test/x'), params('markdown'))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Archived session')
    expect(text).toContain('broken_pages')
  })

  it('json export serves the degraded object', async () => {
    const res = await formatGet(new NextRequest('http://test/x'), params('json'))
    expect(res.status).toBe(200)
    const body = JSON.parse(await res.text())
    expect(body.archived).toBe(true)
  })

  it('claude export refuses with 409 session_archived', async () => {
    const res = await claudeGet(new NextRequest('http://test/x'), { params: Promise.resolve({ sessionId: SESSION_ID }) })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('session_archived')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/export/export-archived.test.ts`
Expected: FAIL — all three return 400 today.

- [ ] **Step 3: Implement**

`[format]/route.ts` — widen the select to `{ status: true, result: true }` → add `id: true`; replace the guard + parse:

```ts
    if (session.status !== 'complete') {
      return NextResponse.json({ error: 'Parsing not complete' }, { status: 400 });
    }

    let result: AggregatedResult | null = null;
    if (session.result) {
      result = JSON.parse(session.result) as AggregatedResult;
    } else {
      result = await loadArchivedSeoResult(sessionId); // C5: degraded export
    }
    if (!result) {
      return NextResponse.json({ error: 'Parsing not complete' }, { status: 400 });
    }
```

For markdown + summary, prepend/flag the archived state. Markdown: wherever the markdown document header is assembled (the first `sections.push(...)`/template-literal header in `generateMarkdownSections`-equivalent code in this file), insert directly after obtaining `result`:

```ts
    const archivedNote = result.archived
      ? '\n> **Archived session** — full report data was pruned after 90 days; this export is rebuilt from the findings database (reduced data).\n'
      : '';
```

and include `${archivedNote}` right after the title line of the markdown output. Summary: add `archived: result.archived ?? false,` to the summary object.

`claude/route.ts` — replace the guard:

```ts
    if (session.status !== 'complete') {
      return NextResponse.json({ error: 'Parsing not complete' }, { status: 400 });
    }
    if (!session.result) {
      // C5: a degraded export would mislead the srt_ memo — refuse explicitly.
      return NextResponse.json({ error: 'session_archived' }, { status: 409 });
    }
```

(no `crawlRun` lookup needed: complete + null blob ⇒ pruned, because the prune is the only writer that nulls `result` on a complete session).

`app/api/seo-roadmap/[id]/route.ts` (~line 36) and `app/api/keyword-memo/[id]/route.ts` (~line 36) — same one-line semantic upgrade:

```ts
  if (!roadmap.session.result) return NextResponse.json({ error: 'session_archived' }, { status: 409 });
```

```ts
  if (!row.session.result) return NextResponse.json({ error: 'session_archived' }, { status: 409 });
```

Then update any existing tests asserting `session_result_missing` for these two routes (grep: `grep -rn "session_result_missing" app/ lib/ --include="*.test.*"`) to `session_archived`.

- [ ] **Step 4: Run tests + typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/export/export-archived.test.ts app/api/seo-roadmap app/api/keyword-memo && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'app/api/export/[sessionId]' 'app/api/seo-roadmap/[id]/route.ts' 'app/api/keyword-memo/[id]/route.ts' app/api/export/export-archived.test.ts
git commit -m "feat(c5): degraded format exports + session_archived 409 on memo exports"
```

---

### Task 9: Keyword-research page archived empty-state

**Files:**
- Modify: `app/keyword-research/[sessionId]/page.tsx`

- [ ] **Step 1: Implement (UI copy change; covered by the existing route tests + manual smoke)**

After `const result = parseStoredResult(session.result);` add an archived probe and branch the empty-state copy (Codex fix #9 — archived is *unavailable*, stated plainly, never silently degraded):

```tsx
  const result = parseStoredResult(session.result);
  const keywordSignals = result?.keyword_signals ?? null;
  // C5: blob pruned ⇒ keyword signals are gone (blob-only data).
  const archived = !session.result && !!(await prisma.crawlRun.findUnique({ where: { sessionId }, select: { archivePrunedAt: true } }))?.archivePrunedAt;
```

and replace the `:` branch of the signals block:

```tsx
        {keywordSignals ? (
          <KeywordSignalsPanel data={keywordSignals} />
        ) : archived ? (
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-6 py-4">
            <p className="text-sm text-amber-700 dark:text-amber-200/80">
              This session&rsquo;s keyword signals were archived after 90 days and are no longer
              available. Re-upload the SEMRush exports to run a fresh analysis.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border px-6 py-4">
            <p className="text-sm text-gray-500 dark:text-white/50">
              No SEMRush keyword data in this upload. Upload Organic Positions / Pages or a Keyword
              Gap &ldquo;Missing&rdquo; export to see keyword signals.
            </p>
          </div>
        )}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`

```bash
git add 'app/keyword-research/[sessionId]/page.tsx'
git commit -m "feat(c5): archived empty-state on keyword-research page"
```

---

### Task 10: Rebuild/parity graceful pruned-blob messages

**Files:**
- Modify: `scripts/findings-rebuild.ts` (~line 39), `lib/findings/parity.ts` (~line 28)

- [ ] **Step 1: Implement**

`scripts/findings-rebuild.ts` — in the session branch, before the existing `status/result` check:

```ts
    if (session.status === 'complete' && !session.result) {
      console.error(`Session ${id}: result blob was pruned (90-d archive) — cannot rebuild. Findings rows are the canonical record now.`)
      process.exit(1)
    }
```

`lib/findings/parity.ts` — in `compareSeoParity`, where the blob is read, replace the failure on a null blob with an explicit reason (match the function's existing error/return style — inspect lines 20–40 first):

```ts
  if (!session.result) {
    return { ok: false, errors: ['session result blob is pruned (archived) — parity requires the blob'] }
  }
```

(adjust the return shape to the file's actual `ParityReport` type — keep behavior: fail with a clear message instead of a JSON.parse crash).

- [ ] **Step 2: Typecheck + run the parity test file**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/parity.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/findings-rebuild.ts lib/findings/parity.ts
git commit -m "chore(c5): explicit pruned-blob messages in rebuild/parity"
```

---

### Task 11: Adapter-readiness test (`live-scan` bundle end-to-end)

**Files:**
- Test: `lib/findings/adapter-readiness.test.ts`

- [ ] **Step 1: Write the test (it should pass against the code from Tasks 1–2 — this is a contract pin, not TDD of new code)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from './writer'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import { loadArchivedSeoResult } from './seo-findings-fallback'
import type { FindingsBundle } from './types'

const DOMAIN = 'c5ar-livescan.example.com'
const SESSION_ID = '66666666-6666-4666-8666-c5a000000008'
const SITE_AUDIT_DOMAIN = 'c5ar-siteaudit.example.com'
let siteAuditId: string

async function cleanup() {
  await prisma.crawlRun.deleteMany({ where: { domain: { in: [DOMAIN, SITE_AUDIT_DOMAIN] } } })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
  await prisma.siteAudit.deleteMany({ where: { domain: SITE_AUDIT_DOMAIN } })
}

beforeAll(async () => { await cleanup() })
afterAll(cleanup)

function liveScanBundle(runId: string, origin: { sessionId?: string; siteAuditId?: string }, tool: 'seo-parser' | 'ada-audit' = 'seo-parser'): FindingsBundle {
  const url = normalizeFindingUrl(`https://${origin.siteAuditId ? SITE_AUDIT_DOMAIN : DOMAIN}/page`)
  const pageId = `${runId}-p1`
  return {
    run: { id: runId, tool, source: 'live-scan', domain: origin.siteAuditId ? SITE_AUDIT_DOMAIN : DOMAIN, clientId: null, sessionId: origin.sessionId ?? null, siteAuditId: origin.siteAuditId ?? null, adaAuditId: null, status: 'complete', score: 88, wcagLevel: null, pagesTotal: 1, startedAt: new Date(), completedAt: new Date() },
    pages: [{ id: pageId, runId, url, status: null, error: null, finalUrl: null, statusCode: 200, title: 'Live', h1: 'Live', metaDescription: 'd', wordCount: 420, crawlDepth: null, indexable: true, score: null, passCount: null, incompleteCount: null, adaAuditId: null }],
    findings: [
      { id: `${runId}-f1`, runId, pageId: null, scope: 'run', type: 'missing_meta_description', severity: 'warning', url: null, count: 1, affectedComplete: true, affectedSource: 'parser-complete', detail: JSON.stringify({ description: 'Missing meta' }), dedupKey: runFindingKey('missing_meta_description') },
      { id: `${runId}-f2`, runId, pageId, scope: 'page', type: 'missing_meta_description', severity: 'warning', url, count: 1, affectedComplete: true, affectedSource: 'parser-complete', detail: null, dedupKey: pageFindingKey('missing_meta_description', url) },
    ],
    violations: [],
  }
}

describe('adapter readiness: a live-scan bundle is a first-class citizen', () => {
  it('writes via writeFindingsRun and renders through the findings-based report path', async () => {
    await prisma.session.create({ data: { id: SESSION_ID, files: '[]', status: 'complete', result: null, siteName: DOMAIN, workflow: 'technical' } })
    await writeFindingsRun(liveScanBundle('c5ar-run-1', { sessionId: SESSION_ID }))

    const run = await prisma.crawlRun.findUnique({ where: { sessionId: SESSION_ID } })
    expect(run?.source).toBe('live-scan')

    const report = await loadArchivedSeoResult(SESSION_ID)
    expect(report).not.toBeNull()
    expect(report!.metadata.health_score).toBe(88)
    expect(report!.issues.warnings[0]).toMatchObject({ type: 'missing_meta_description', count: 1 })
    // live pages carry statusCode → buckets computed (Codex fix #6 payoff)
    expect(report!.crawl_summary.ok_responses).toBe(1)
  })

  it('DOCUMENTED LIMITATION: a second run on the same SiteAudit origin replaces the first (C6 must migrate to @@unique([siteAuditId, tool]) before live-scan dual-write)', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: SITE_AUDIT_DOMAIN, status: 'complete' } })
    siteAuditId = sa.id
    await writeFindingsRun(liveScanBundle('c5ar-run-2', { siteAuditId }, 'ada-audit'))
    await writeFindingsRun(liveScanBundle('c5ar-run-3', { siteAuditId }, 'seo-parser'))
    const runs = await prisma.crawlRun.findMany({ where: { siteAuditId } })
    expect(runs).toHaveLength(1)
    expect(runs[0].id).toBe('c5ar-run-3') // delete-and-recreate by origin clobbered the ada run
  })
})
```

NOTE: check `SiteAudit.create` minimum required fields first (`grep -n "model SiteAudit" -A 20 prisma/schema.prisma`) and add any non-defaulted requireds (e.g. `wcagLevel`) to the seed.

- [ ] **Step 2: Run it**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/adapter-readiness.test.ts`
Expected: PASS (if the limitation test fails because the writer does NOT clobber, that's a finding — re-read writer.ts and fix the test to pin actual behavior).

- [ ] **Step 3: Commit**

```bash
git add lib/findings/adapter-readiness.test.ts
git commit -m "test(c5): adapter-readiness pin — live-scan bundle end-to-end + origin-uniqueness limitation"
```

---

### Task 12: Activate `PRUNE_ACTIVATED['seo-parser']`

**Files:**
- Modify: `lib/findings/retention.ts` (line ~35)
- Modify: `lib/findings/retention.test.ts` (whatever asserts seo-parser inert)

- [ ] **Step 1: Find the existing assertions**

Run: `grep -n "seo-parser" lib/findings/retention.test.ts`

- [ ] **Step 2: Write/adjust the failing test**

Add (or convert the inert-flag test into) an active-flag test in `lib/findings/retention.test.ts`, following that file's existing seeding style (unique prefix, tracked ids):

```ts
  it('prunes seo-parser Session.result blobs >90d, keeps scalars, stamps archivePrunedAt', async () => {
    // seed: Session with result blob + CrawlRun completedAt 91 days ago (file's existing helpers/style)
    // run: await pruneArchivedBlobs(now)  — default PRUNE_ACTIVATED (now active for seo-parser)
    // assert: session.result === null, session.totalUrls unchanged, crawlRun.archivePrunedAt !== null
  })
```

(Write the real seed code in the file's established pattern — the ada-audit activation tests from C3 in the same file are the template; copy one and swap the tool/origin to a Session.)

- [ ] **Step 3: Flip the flag**

```ts
export const PRUNE_ACTIVATED: Readonly<Record<PrunableTool, boolean>> = {
  'seo-parser': true,  // C5: every Session.result reader is findings-capable (fallback or 409)
  'ada-audit': true,   // C3: all readers fall back to the findings tables (spec § 5.4)
}
```

Also update the module header comment ("'seo-parser' stays inert until C5" → flipped in C5).

- [ ] **Step 4: Run the retention tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/retention.test.ts`
Expected: PASS (new test green; any test that asserted seo-parser blobs survive the default flags updated to the new reality).

- [ ] **Step 5: Commit**

```bash
git add lib/findings/retention.ts lib/findings/retention.test.ts
git commit -m "feat(c5): activate seo-parser blob pruning (90-d archive)"
```

---

### Task 13: Full verification + docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run && npm run build`
Expected: all green, build succeeds. Fix anything that surfaces (e.g. tests that seeded complete sessions with null results expecting the old "Not Yet Analyzed"/400 behavior).

- [ ] **Step 2: Local smoke (manual, dev server)**

`DATABASE_URL="file:./local-dev.db" npx next dev` — parse a real SF export (fixtures in `~/enrollment-resources/sf-crawls/` if needed), confirm the fresh report is unchanged; then null that session's `result` via a one-off node/Prisma command and confirm: results page renders the archived banner + issues; share mint + public share page work; history shows the score; `/api/diff` against it 409s; markdown export carries the archived note; keyword page (on a keyword session) shows the archived copy.

- [ ] **Step 3: CLAUDE.md updates**

- Key files: add `lib/findings/seo-findings-fallback.ts` line (mirror the C3 `findings-fallback.ts` entry's style).
- Findings-layer architecture bullet: `'seo-parser' stays inert until C5` → `'seo-parser' ACTIVE since C5: Session.result nulled at 90 d; every SEO read surface serves the findings fallback (degraded AggregatedResult, archived banner) or an explicit 409 session_archived (diff, claude/srt_/krt_ exports)`.
- `lib/findings/` key-files line: note `types.ts` is the documented source-agnostic ingestion contract (`'live-scan'` reserved for C6; one CrawlRun per origin until the C6 `@@unique([siteAuditId, tool])` migration).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(c5): findings-fallback + prune activation + ingestion contract in CLAUDE.md"
```

---

## Self-review (done)

- **Spec coverage:** contract+'live-scan' (T1), builder+safe shape+status-opportunistic+per-origin context (T2), banner/completeness-suppression/container guard (T3), flip rows 1+5 (T4), rows 2–4 (T5), row 6 (T6), row 7 refusal (T7), rows 8–11 (T8), row 12 (T9), allowed-reader messages (T10), §2.3 adapter test + limitation pin (T11), §5 activation (T12), CLAUDE.md + verification (T13).
- **Type consistency:** `loadArchivedSeoResult(sessionId) → AggregatedResult|null` used in T4/T5/T8/T11; `buildSeoResultFromRun(run, pages, findings, origin)` matches T2's test; `archived?: boolean` on `AggregatedResult` consumed by T3/T4/T5/T8.
- **No placeholders:** T12's test body is intentionally a directive to copy the file's existing C3 activation test pattern (the file exists and the pattern is named); all other code is complete.
- **Known check-first notes embedded:** history response envelope (T6), diff body field names (T7), SiteAudit required fields (T11), parity return shape (T10).
