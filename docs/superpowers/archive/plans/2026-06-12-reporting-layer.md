# C4 Reporting Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the C4 reporting layer — site-audit share links, violations/changes CSV export, branded PDF report via a durable `report-render` job, and a VPAT scaffold download — per `docs/superpowers/specs/2026-06-12-reporting-layer-design.md` (Codex-reviewed ×9).

**Architecture:** Everything is relational-first (works on archived/pruned audits via the C3 read paths). The PDF report is pure template-string HTML (`lib/report/`) rendered through `page.setContent()` + `page.pdf()` on the existing browser pool inside a durable job — no self-HTTP, no middleware tokens. Share links mirror the single-page `AdaAudit` pattern verbatim onto `SiteAudit`.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, puppeteer-core via `lib/ada-audit/browser-pool.ts`, durable job queue (`lib/jobs/`), vitest.

**Conventions that apply to every task:**
- Local commands prefix: `DATABASE_URL="file:./local-dev.db"` for vitest/prisma.
- Array-form `$transaction` only (no interactive transactions exist in this plan — none needed).
- DB-backed test files use a unique domain/id prefix, pre-clean in `beforeAll`, scope cleanup to tracked ids, clean `CrawlRun` by domain BEFORE origin rows.
- New public routes MUST be added to `middleware.ts` + `middleware.test.ts`.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` + `prisma/migrations/20260612200000_c4_reporting/migration.sql` | modify/create | `SiteAudit.shareToken/shareExpiresAt/reportGeneratedAt` |
| `lib/report/csv.ts` (+test) | create | pure RFC-4180 builder + formula-injection neutralization |
| `lib/services/findings-shared.ts` (+existing test file) | modify | `diffInstancesDetailed()`; `diffInstances()` becomes a capped derivation |
| `lib/services/site-audit-diff.ts` (+test) | modify | shared previous-run selection; `getSiteAuditInstanceDiffDetailed()` |
| `app/api/site-audit/[id]/csv/route.ts` (+test) | create | violations CSV + `?sheet=changes` |
| `lib/report/wcag-criteria.ts` (+test) | create | static WCAG A/AA criteria table + axe-tag parsing |
| `lib/report/vpat.ts` (+test) | create | pure VPAT 2.4 markdown scaffold builder |
| `app/api/site-audit/[id]/vpat/route.ts` (+test) | create | VPAT download route |
| `lib/report/escape.ts` (+test) | create | `escapeHtml`/`escapeAttr` |
| `lib/report/report-html.ts` (+test) | create | `buildSiteReportHtml()` + inline-SVG sparkline |
| `lib/report/report-file.ts` (+test) | create | `REPORTS_DIR`, atomic write, delete, exists |
| `lib/report/report-data.ts` (+test) | create | `loadSiteReportData()` (prisma reads, child-blob screenshots) |
| `lib/jobs/handlers/report-render.ts` (+test) | create | durable `report-render` job |
| `lib/jobs/handlers/register.ts` | modify | register the new handler |
| `app/api/site-audit/[id]/report/route.ts` + `report/status/route.ts` (+tests) | create | POST enqueue / GET stream / GET status |
| `app/api/site-audit/[id]/share/route.ts` (+test) | create | mint/rotate site share token |
| `lib/cleanup.ts` (+test) | modify | `cleanExpiredSiteAuditShareTokens()` in `runCleanup()` |
| `app/ada-audit/site/share/[token]/page.tsx` (+test) | create | public share page |
| `components/ada-audit/SiteAuditResultsView.tsx` | modify | `shareMode` prop threading |
| `components/ada-audit/SiteAuditToolbar.tsx` | modify | `hideViewToggle` prop |
| `components/ada-audit/CommonIssueCallout.tsx` | modify | optional CTA |
| `components/ada-audit/ShareAuditButton.tsx` | modify | optional `endpoint` prop |
| `middleware.ts` + `middleware.test.ts` | modify | `/ada-audit/site/share/` public prefix |
| `app/api/site-audit/[id]/route.ts` (+test) | modify | DELETE also cancels report jobs + deletes report file |
| `lib/ada-audit/scheduled-retention.ts` (+test) | modify | snapshot-based report-file deletion |
| `components/ada-audit/SiteAuditExportBar.tsx` (+test) | create | Share / CSV / report / VPAT toolbar |
| `app/ada-audit/site/[id]/page.tsx` | modify | render export bar |
| `ecosystem.config.js`, `.gitignore` | modify | `REPORTS_DIR`, ignore local `data/` |

---

### Task 1: Schema migration + env plumbing

**Files:**
- Modify: `prisma/schema.prisma` (SiteAudit model)
- Create: `prisma/migrations/20260612200000_c4_reporting/migration.sql`
- Modify: `ecosystem.config.js`, `.gitignore`

- [ ] **Step 1: Add columns to the SiteAudit model** in `prisma/schema.prisma`, after `scheduleId`/`schedule`:

```prisma
  shareToken        String?   @unique
  shareExpiresAt    DateTime?
  reportGeneratedAt DateTime?
```

- [ ] **Step 2: Hand-write the migration** (local `prisma migrate dev` is interactive-only):

```sql
-- prisma/migrations/20260612200000_c4_reporting/migration.sql
ALTER TABLE "SiteAudit" ADD COLUMN "shareToken" TEXT;
ALTER TABLE "SiteAudit" ADD COLUMN "shareExpiresAt" DATETIME;
ALTER TABLE "SiteAudit" ADD COLUMN "reportGeneratedAt" DATETIME;
CREATE UNIQUE INDEX "SiteAudit_shareToken_key" ON "SiteAudit"("shareToken");
```

- [ ] **Step 3: Apply + regenerate**

Run: `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && npx prisma generate`
Expected: `1 migration applied`, client regenerated.

- [ ] **Step 4: Env plumbing.** In `ecosystem.config.js` `env` block add `REPORTS_DIR: \`${DATA_HOME}/reports\`,` next to `SCREENSHOTS_DIR`. In `.gitignore`, if `/data/` (or `data/`) is not already ignored, add `/data/` (local dev report output lands in `./data/reports`).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(c4): SiteAudit share/report columns + REPORTS_DIR plumbing"`

---

### Task 2: `lib/report/csv.ts`

**Files:** Create `lib/report/csv.ts`, `lib/report/csv.test.ts`

- [ ] **Step 1: Write failing tests** (`lib/report/csv.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { csvField, buildCsv } from './csv'

describe('csvField', () => {
  it('passes plain values through', () => expect(csvField('hello')).toBe('hello'))
  it('quotes commas, quotes, newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
  })
  it('neutralizes formula injection (=, +, -, @, tab, CR)', () => {
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvField('+1')).toBe("'+1")
    expect(csvField('-1')).toBe("'-1")
    expect(csvField('@cmd')).toBe("'@cmd")
    expect(csvField('\tx')).toBe('"\'\tx"') // neutralized THEN quoted (tab not special to RFC, but quote anyway when present)
  })
  it('renders null/undefined as empty and numbers verbatim', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
    expect(csvField(42)).toBe('42')
  })
})

describe('buildCsv', () => {
  it('emits BOM + CRLF rows', () => {
    const out = buildCsv(['a', 'b'], [['1', 'x,y']])
    expect(out).toBe('﻿a,b\r\n1,"x,y"')
  })
})
```

- [ ] **Step 2: Run to verify fail** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/report/csv.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** (`lib/report/csv.ts`):

```ts
// lib/report/csv.ts
// Pure RFC-4180 CSV builder with Excel formula-injection neutralization
// (page URLs and axe help text are externally controlled — Codex spec fix #2).

/** Header-safe filename fragment: DB strings (domain) must never carry
 *  quotes/CRLF/path chars into Content-Disposition (Codex plan fix #1). */
export function safeFilenamePart(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_')
}

export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  let s = value
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\n\r\t]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function buildCsv(
  header: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const lines = [header, ...rows].map((r) => r.map(csvField).join(','))
  return '﻿' + lines.join('\r\n')
}
```

- [ ] **Step 4: Run tests** → PASS. (Adjust the tab expectation if the implementation output differs — the invariant is: leading dangerous char neutralized, RFC quoting applied when any special char is present.)

- [ ] **Step 5: Commit** — `feat(c4): pure CSV builder with formula-injection neutralization`

---

### Task 3: `diffInstancesDetailed()` + detailed selection service

**Files:**
- Modify: `lib/services/findings-shared.ts` (the `diffInstances` block, ~lines 140–251)
- Modify: `lib/services/site-audit-diff.ts`
- Test: extend the existing findings-shared test file (where `diffInstances` is tested) + `lib/services/site-audit-diff` test file

- [ ] **Step 1: Write failing tests.** In the existing `diffInstances` test file add:

```ts
describe('diffInstancesDetailed', () => {
  const ref = (dedupKey: string, type: string, severity: string, url: string) => ({ dedupKey, type, severity, url })
  it('accumulates notRescannedUrls (counted-only in the capped diff)', () => {
    const prev = [ref('k1', 'image-alt', 'critical', '/gone')]
    const d = diffInstancesDetailed([], prev, new Set<string>([]), new Set(['/gone']))
    expect(d.notRescannedCount).toBe(1)
    expect(d.rules).toHaveLength(1)
    expect(d.rules[0].notRescannedUrls).toEqual(['/gone'])
    // capped derivation still excludes a not-rescanned-only rule:
    expect(diffInstances([], prev, new Set<string>([]), new Set(['/gone'])).rules).toHaveLength(0)
  })
  it('returns uncapped url lists', () => {
    const urls = Array.from({ length: 40 }, (_, i) => `/p${i}`)
    const cur = urls.map((u, i) => ref(`k${i}`, 'image-alt', 'critical', u))
    const d = diffInstancesDetailed(cur, [], new Set(urls), new Set(urls))
    expect(d.rules[0].regressedUrls).toHaveLength(40)
  })
})
```

- [ ] **Step 2: Run** → FAIL (`diffInstancesDetailed` not exported).

- [ ] **Step 3: Refactor.** In `findings-shared.ts`, add detailed shapes and make `diffInstances` derive from the detailed pass. The accumulation loop is the existing one plus `notRescannedUrls`:

```ts
export interface RuleInstanceDiffDetailed {
  type: string
  severity: Severity
  regressedUrls: string[]
  newPageUrls: string[]
  resolvedUrls: string[]
  notRescannedUrls: string[]
  unchangedTotal: number
}

export interface InstanceDiffDetailed {
  newCount: number
  regressedCount: number
  newPageCount: number
  resolvedCount: number
  notRescannedCount: number
  unchangedCount: number
  /** Any rule touched by the diff (incl. not-rescanned-only), severity rank then newTotal desc then type. */
  rules: RuleInstanceDiffDetailed[]
}

export function diffInstancesDetailed(
  current: InstanceRef[],
  previous: InstanceRef[],
  currentPages: Set<string>,
  previousPages: Set<string>,
): InstanceDiffDetailed {
  // identical accumulation to the old diffInstances, with two changes:
  // RuleAcc gains notRescannedUrls: [], and the previous-loop else branch does
  //   notRescannedCount++; acc(p.type, p.severity, false).notRescannedUrls.push(p.url)
  // Build rules for every byType entry with ANY non-empty list or unchangedTotal-only entries EXCLUDED:
  //   include when regressedUrls.length + newPageUrls.length + resolvedUrls.length + notRescannedUrls.length > 0
  // Sort: SEVERITY_RANK, then (regressedUrls+newPageUrls).length desc, then type.
}

export function diffInstances(
  current: InstanceRef[],
  previous: InstanceRef[],
  currentPages: Set<string>,
  previousPages: Set<string>,
): InstanceDiff {
  const d = diffInstancesDetailed(current, previous, currentPages, previousPages)
  return {
    newCount: d.newCount, regressedCount: d.regressedCount, newPageCount: d.newPageCount,
    resolvedCount: d.resolvedCount, notRescannedCount: d.notRescannedCount, unchangedCount: d.unchangedCount,
    rules: d.rules
      .filter((r) => r.regressedUrls.length + r.newPageUrls.length > 0 || r.resolvedUrls.length > 0)
      .map((r) => ({
        type: r.type,
        severity: r.severity,
        newUrls: [...capSample(r.regressedUrls), ...capSample(r.newPageUrls)].slice(0, URLS_PER_FINDING),
        newTotal: r.regressedUrls.length + r.newPageUrls.length,
        regressedTotal: r.regressedUrls.length,
        resolvedUrls: capSample(r.resolvedUrls),
        resolvedTotal: r.resolvedUrls.length,
        unchangedTotal: r.unchangedTotal,
      })),
  }
}
```

Write the accumulation loop out in full (move the body of the old `diffInstances` into `diffInstancesDetailed`, adding `notRescannedUrls` to `RuleAcc` and the push above). **The capped `diffInstances` output must be byte-for-byte equivalent for every existing test (Codex plan fix #5)** — verify each invariant explicitly:
  - not-rescanned-only rules are EXCLUDED from capped `rules` (newTotal 0, resolvedTotal 0 → filtered);
  - current-run severity still wins when the rule exists in the current run (`fromCurrent` upgrade in `acc()` unchanged);
  - previous-run severity is used for resolved-only rules;
  - capped sort order unchanged: SEVERITY_RANK, then newTotal desc, then type — and because the not-rescanned push calls `acc()` with `fromCurrent=false`, it must NOT overwrite an existing rule's severity;
  - `unchangedTotal` accumulation unchanged.

- [ ] **Step 4: Run the whole findings-shared test file** → PASS (old + new).

- [ ] **Step 5: Detailed selection service.** In `lib/services/site-audit-diff.ts`: extract the previous-run candidate selection from `getSiteAuditInstanceDiff` into a private helper, then add:

```ts
async function loadRefsAndPages(currentRunId: string, previousRunId: string) {
  // identical body to the current loadAndDiff up to (but not including) the diffInstances call;
  // returns { cur: InstanceRef[], prev: InstanceRef[], curPages: Set<string>, prevPages: Set<string> }
}

export interface SiteAuditDiffDetailedResult {
  detailed: InstanceDiffDetailed
  previous: { runId: string; siteAuditId: string | null; completedAt: string | null }
}

/** Changes-CSV entry: same anchor + same previous selection as
 *  getSiteAuditInstanceDiff, uncapped classifier. */
export async function getSiteAuditInstanceDiffDetailed(
  siteAuditId: string,
): Promise<SiteAuditDiffDetailedResult | null> {
  // identical selection to getSiteAuditInstanceDiff (use the shared helper),
  // then: const { cur, prev, curPages, prevPages } = await loadRefsAndPages(run.id, previous.id)
  // return { detailed: diffInstancesDetailed(cur, prev, curPages, prevPages), previous: {...} }
}
```

`loadAndDiff` becomes `diffInstances(...await loadRefsAndPages(...))` so the two entries can't drift. Add one DB-backed test in the site-audit-diff test file proving `getSiteAuditInstanceDiffDetailed` picks the SAME previous as `getSiteAuditInstanceDiff` and returns uncapped lists (seed >25 regressed instances of one rule across two runs of one unique-prefix domain).

- [ ] **Step 6: Run site-audit-diff tests** → PASS. **Commit** — `feat(c4): diffInstancesDetailed + detailed site-audit diff selection`

---

### Task 4: CSV export route

**Files:**
- Create: `app/api/site-audit/[id]/csv/route.ts`
- Test: `app/api/site-audit/[id]/csv/route.test.ts` (DB-backed; unique prefix `c4csv-`)

- [ ] **Step 1: Write failing tests.** DB-backed (real prisma, real route handler import). Seed: a Client-less complete `SiteAudit` (domain `c4csv-a.example.com`, wcagLevel `wcag21aa`) + `CrawlRun` (tool `ada-audit`, source `site-audit`, same domain+level) + 2 `CrawlPage` rows + `Finding`/`Violation` rows (one with impact `'unknown'`, one help text starting with `=`). Cases:
  1. GET → 200, `content-type: text/csv; charset=utf-8`, `content-disposition` contains `ada-violations-c4csv-a.example.com-`; body starts with BOM; header row exact; unknown-impact row sorts LAST; `=`-help field neutralized with leading `'`.
  2. Non-complete audit → 409 `{ error: 'not_complete' }`.
  3. Complete audit with no CrawlRun → 409 `{ error: 'no_findings_run' }`.
  4. Unknown id → 404.
  5. `?sheet=changes` with a seeded earlier run (same domain+level, one resolved + one regressed + one not-rescanned instance) → 200 with rows `new` / `resolved` / `not-rescanned` as expected.
  6. `?sheet=changes` with no previous run → 409 `{ error: 'no_previous_run' }`.

- [ ] **Step 2: Run** → FAIL (route module missing).

- [ ] **Step 3: Implement** (`app/api/site-audit/[id]/csv/route.ts`):

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { buildCsv, safeFilenamePart } from '@/lib/report/csv'
import { getSiteAuditInstanceDiffDetailed } from '@/lib/services/site-audit-diff'

export const dynamic = 'force-dynamic'

const IMPACT_RANK: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 }
const rank = (impact: string) => IMPACT_RANK[impact] ?? 4 // 'unknown' sentinel sorts last

function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

const dateStamp = (d: Date) => d.toISOString().slice(0, 10)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: { id: true, domain: true, status: true, completedAt: true, createdAt: true },
  })
  if (!audit) return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  if (audit.status !== 'complete') return NextResponse.json({ error: 'not_complete' }, { status: 409 })

  const stamp = dateStamp(audit.completedAt ?? audit.createdAt)

  if (request.nextUrl.searchParams.get('sheet') === 'changes') {
    const result = await getSiteAuditInstanceDiffDetailed(id)
    if (!result) return NextResponse.json({ error: 'no_previous_run' }, { status: 409 })
    const rows: (string | number)[][] = []
    for (const r of result.detailed.rules) {
      for (const u of r.regressedUrls) rows.push(['new', r.type, r.severity, u])
      for (const u of r.newPageUrls) rows.push(['new-page', r.type, r.severity, u])
      for (const u of r.resolvedUrls) rows.push(['resolved', r.type, r.severity, u])
      for (const u of r.notRescannedUrls) rows.push(['not-rescanned', r.type, r.severity, u])
    }
    return csvResponse(
      buildCsv(['change', 'rule_id', 'severity', 'page_url'], rows),
      `ada-changes-${safeFilenamePart(audit.domain)}-${stamp}.csv`,
    )
  }

  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId: id }, select: { id: true } })
  if (!run) return NextResponse.json({ error: 'no_findings_run' }, { status: 409 })

  const violations = await prisma.violation.findMany({
    where: { runId: run.id },
    select: {
      ruleId: true, impact: true, wcagTags: true, help: true, helpUrl: true, nodeCount: true,
      page: { select: { url: true } },
      finding: { select: { severity: true } },
    },
  })
  const rows = violations
    .sort((a, b) =>
      rank(a.impact) - rank(b.impact) || a.ruleId.localeCompare(b.ruleId) || a.page.url.localeCompare(b.page.url))
    .map((v) => {
      let tags: string[] = []
      try { const parsed = JSON.parse(v.wcagTags); if (Array.isArray(parsed)) tags = parsed.filter((x): x is string => typeof x === 'string') } catch { /* ignore */ }
      return [v.page.url, v.ruleId, v.impact, v.finding.severity, tags.join('|'), v.help, v.helpUrl, v.nodeCount]
    })
  return csvResponse(
    buildCsv(['page_url', 'rule_id', 'impact', 'severity', 'wcag_tags', 'help', 'help_url', 'node_count'], rows),
    `ada-violations-${safeFilenamePart(audit.domain)}-${stamp}.csv`,
  )
}
```

- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** — `feat(c4): violations + changes CSV export routes`

---

### Task 5: `lib/report/wcag-criteria.ts`

**Files:** Create `lib/report/wcag-criteria.ts`, `lib/report/wcag-criteria.test.ts`

- [ ] **Step 1: Failing tests:** `criterionFromTag('wcag111')` → `'1.1.1'`; `'wcag1412'` → `'1.4.12'`; `'wcag2410'` → `'2.4.10'`; level/meta tags (`wcag2a`, `wcag21aa`, `wcag22aa`, `best-practice`, `cat.color`) → `null`; AAA/unknown criteria (`wcag146` = 1.4.6 AAA) → in table lookup returns undefined; table contains 1.1.1 (A, 2.0), 1.4.12 (AA, 2.1), 2.5.8 (AA, 2.2); `criteriaForLevel('wcag21aa')` excludes 2.2 entries, `criteriaForLevel('wcag22aa')` includes them.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Full static table (Level A + AA only; AAA intentionally absent):

```ts
// lib/report/wcag-criteria.ts
// Static WCAG success-criteria table (A + AA, versions 2.0/2.1/2.2) and the
// axe wcagTags → criterion mapping. AAA is out of scope by design.

export interface WcagCriterion {
  id: string            // '1.4.12'
  name: string
  level: 'A' | 'AA'
  version: '2.0' | '2.1' | '2.2'
}

export const WCAG_CRITERIA: WcagCriterion[] = [
  { id: '1.1.1', name: 'Non-text Content', level: 'A', version: '2.0' },
  { id: '1.2.1', name: 'Audio-only and Video-only (Prerecorded)', level: 'A', version: '2.0' },
  { id: '1.2.2', name: 'Captions (Prerecorded)', level: 'A', version: '2.0' },
  { id: '1.2.3', name: 'Audio Description or Media Alternative (Prerecorded)', level: 'A', version: '2.0' },
  { id: '1.2.4', name: 'Captions (Live)', level: 'AA', version: '2.0' },
  { id: '1.2.5', name: 'Audio Description (Prerecorded)', level: 'AA', version: '2.0' },
  { id: '1.3.1', name: 'Info and Relationships', level: 'A', version: '2.0' },
  { id: '1.3.2', name: 'Meaningful Sequence', level: 'A', version: '2.0' },
  { id: '1.3.3', name: 'Sensory Characteristics', level: 'A', version: '2.0' },
  { id: '1.3.4', name: 'Orientation', level: 'AA', version: '2.1' },
  { id: '1.3.5', name: 'Identify Input Purpose', level: 'AA', version: '2.1' },
  { id: '1.4.1', name: 'Use of Color', level: 'A', version: '2.0' },
  { id: '1.4.2', name: 'Audio Control', level: 'A', version: '2.0' },
  { id: '1.4.3', name: 'Contrast (Minimum)', level: 'AA', version: '2.0' },
  { id: '1.4.4', name: 'Resize Text', level: 'AA', version: '2.0' },
  { id: '1.4.5', name: 'Images of Text', level: 'AA', version: '2.0' },
  { id: '1.4.10', name: 'Reflow', level: 'AA', version: '2.1' },
  { id: '1.4.11', name: 'Non-text Contrast', level: 'AA', version: '2.1' },
  { id: '1.4.12', name: 'Text Spacing', level: 'AA', version: '2.1' },
  { id: '1.4.13', name: 'Content on Hover or Focus', level: 'AA', version: '2.1' },
  { id: '2.1.1', name: 'Keyboard', level: 'A', version: '2.0' },
  { id: '2.1.2', name: 'No Keyboard Trap', level: 'A', version: '2.0' },
  { id: '2.1.4', name: 'Character Key Shortcuts', level: 'A', version: '2.1' },
  { id: '2.2.1', name: 'Timing Adjustable', level: 'A', version: '2.0' },
  { id: '2.2.2', name: 'Pause, Stop, Hide', level: 'A', version: '2.0' },
  { id: '2.3.1', name: 'Three Flashes or Below Threshold', level: 'A', version: '2.0' },
  { id: '2.4.1', name: 'Bypass Blocks', level: 'A', version: '2.0' },
  { id: '2.4.2', name: 'Page Titled', level: 'A', version: '2.0' },
  { id: '2.4.3', name: 'Focus Order', level: 'A', version: '2.0' },
  { id: '2.4.4', name: 'Link Purpose (In Context)', level: 'A', version: '2.0' },
  { id: '2.4.5', name: 'Multiple Ways', level: 'AA', version: '2.0' },
  { id: '2.4.6', name: 'Headings and Labels', level: 'AA', version: '2.0' },
  { id: '2.4.7', name: 'Focus Visible', level: 'AA', version: '2.0' },
  { id: '2.4.11', name: 'Focus Not Obscured (Minimum)', level: 'AA', version: '2.2' },
  { id: '2.5.1', name: 'Pointer Gestures', level: 'A', version: '2.1' },
  { id: '2.5.2', name: 'Pointer Cancellation', level: 'A', version: '2.1' },
  { id: '2.5.3', name: 'Label in Name', level: 'A', version: '2.1' },
  { id: '2.5.4', name: 'Motion Actuation', level: 'A', version: '2.1' },
  { id: '2.5.7', name: 'Dragging Movements', level: 'AA', version: '2.2' },
  { id: '2.5.8', name: 'Target Size (Minimum)', level: 'AA', version: '2.2' },
  { id: '3.1.1', name: 'Language of Page', level: 'A', version: '2.0' },
  { id: '3.1.2', name: 'Language of Parts', level: 'AA', version: '2.0' },
  { id: '3.2.1', name: 'On Focus', level: 'A', version: '2.0' },
  { id: '3.2.2', name: 'On Input', level: 'A', version: '2.0' },
  { id: '3.2.3', name: 'Consistent Navigation', level: 'AA', version: '2.0' },
  { id: '3.2.4', name: 'Consistent Identification', level: 'AA', version: '2.0' },
  { id: '3.2.6', name: 'Consistent Help', level: 'A', version: '2.2' },
  { id: '3.3.1', name: 'Error Identification', level: 'A', version: '2.0' },
  { id: '3.3.2', name: 'Labels or Instructions', level: 'A', version: '2.0' },
  { id: '3.3.3', name: 'Error Suggestion', level: 'AA', version: '2.0' },
  { id: '3.3.4', name: 'Error Prevention (Legal, Financial, Data)', level: 'AA', version: '2.0' },
  { id: '3.3.7', name: 'Redundant Entry', level: 'A', version: '2.2' },
  { id: '3.3.8', name: 'Accessible Authentication (Minimum)', level: 'AA', version: '2.2' },
  { id: '4.1.1', name: 'Parsing (obsolete in WCAG 2.2)', level: 'A', version: '2.0' },
  { id: '4.1.2', name: 'Name, Role, Value', level: 'A', version: '2.0' },
  { id: '4.1.3', name: 'Status Messages', level: 'AA', version: '2.1' },
]

const BY_ID = new Map(WCAG_CRITERIA.map((c) => [c.id, c]))

/** 'wcag1412' → '1.4.12'; level/meta/category tags → null.
 *  Digit layout: principle (1 digit) + guideline (1 digit) + criterion (1-2 digits). */
export function criterionFromTag(tag: string): string | null {
  const m = /^wcag(\d{3,4})$/.exec(tag)
  if (!m) return null
  const d = m[1]
  return `${d[0]}.${d[1]}.${d.slice(2)}`
}

export function criterionById(id: string): WcagCriterion | undefined {
  return BY_ID.get(id)
}

/** Criteria in scan scope for a wcagLevel ('wcag21aa' excludes 2.2 additions). */
export function criteriaForLevel(wcagLevel: string): WcagCriterion[] {
  return wcagLevel === 'wcag22aa' ? WCAG_CRITERIA : WCAG_CRITERIA.filter((c) => c.version !== '2.2')
}
```

- [ ] **Step 4: Run** → PASS. **Commit** — `feat(c4): static WCAG A/AA criteria table + axe-tag mapping`

---

### Task 6: VPAT scaffold builder + route

**Files:** Create `lib/report/vpat.ts` (+test), `app/api/site-audit/[id]/vpat/route.ts` (+test)

- [ ] **Step 1: Failing unit tests** (`lib/report/vpat.test.ts`): build with two violations (one tagged `wcag111` impact `critical`, one `wcag143` impact `'unknown'`) over 3 pages →
  - output contains the scaffold disclaimer line verbatim ("**This is a scaffold, not a legal VPAT/ACR.**"),
  - `1.1.1` row says `Does Not Support` and remarks contain the ruleId + `3 pages` (or actual count) + impact incl. `unknown` rendered verbatim,
  - `1.2.1` row says `Not Evaluated`,
  - with `wcagLevel: 'wcag21aa'` the 2.2 section note appears and `2.5.8` is absent; with `'wcag22aa'` `2.5.8` row appears,
  - Table 1 = Level A, Table 2 = Level AA (headings present).

- [ ] **Step 2: Implement** (`lib/report/vpat.ts`):

```ts
// lib/report/vpat.ts — pure VPAT 2.4-shaped markdown scaffold from Violation rows.
// Two-state honesty model: automation can prove failures, never passes.
import { criteriaForLevel, criterionFromTag, type WcagCriterion } from './wcag-criteria'

export interface VpatViolationRow {
  ruleId: string
  impact: string
  wcagTags: string[]      // parsed
  helpUrl: string | null
  pageUrl: string
}

export interface VpatInput {
  domain: string
  auditDate: string       // ISO
  wcagLevel: string       // 'wcag21aa' | 'wcag22aa'
  pagesTotal: number
  rows: VpatViolationRow[]
}

interface RuleAgg { impact: string; helpUrl: string | null; pages: Set<string> }

export function buildVpatScaffold(input: VpatInput): string {
  // criterion id → (ruleId → agg)
  const byCriterion = new Map<string, Map<string, RuleAgg>>()
  for (const row of input.rows) {
    for (const tag of row.wcagTags) {
      const cid = criterionFromTag(tag)
      if (!cid) continue
      let rules = byCriterion.get(cid)
      if (!rules) { rules = new Map(); byCriterion.set(cid, rules) }
      let agg = rules.get(row.ruleId)
      if (!agg) { agg = { impact: row.impact, helpUrl: row.helpUrl, pages: new Set() }; rules.set(row.ruleId, agg) }
      agg.pages.add(row.pageUrl)
    }
  }

  const criteria = criteriaForLevel(input.wcagLevel)
  const renderRow = (c: WcagCriterion): string => {
    const rules = byCriterion.get(c.id)
    if (!rules || rules.size === 0) {
      return `| ${c.id} ${c.name} | Not Evaluated | No automated failures detected; manual review required. |`
    }
    const remarks = [...rules.entries()]
      .map(([ruleId, a]) =>
        `\`${ruleId}\` (${a.impact}, ${a.pages.size} page${a.pages.size === 1 ? '' : 's'}${a.helpUrl ? `, ${a.helpUrl}` : ''})`)
      .join('; ')
    return `| ${c.id} ${c.name} | Does Not Support | Automated failures: ${remarks} |`
  }
  const table = (level: 'A' | 'AA') => [
    '| Criteria | Conformance Level | Remarks and Explanations |',
    '|---|---|---|',
    ...criteria.filter((c) => c.level === level).map(renderRow),
  ].join('\n')

  const levelLabel = input.wcagLevel === 'wcag22aa' ? 'WCAG 2.2 AA (incl. best-practice rules)' : 'WCAG 2.1 AA'
  const wcag22Note = input.wcagLevel === 'wcag22aa'
    ? ''
    : '\n> WCAG 2.2-only criteria are **not in scan scope** for this audit (run at WCAG 2.1 AA) and are omitted.\n'

  return `# Accessibility Conformance Report Scaffold (VPAT® 2.4 shape) — ${input.domain}

**This is a scaffold, not a legal VPAT/ACR.** It is generated from a single
automated axe-core scan and MUST be completed by a human evaluator before any
external use. Automated scanning can demonstrate failures but can never
demonstrate conformance.

- **Product / site:** ${input.domain}
- **Report date:** ${input.auditDate.slice(0, 10)}
- **Evaluation methods:** automated axe-core scan via ER SEO Tools (${input.pagesTotal} pages, ${levelLabel})
- **Conformance vocabulary:** Supports / Partially Supports / Does Not Support / Not Applicable / Not Evaluated
${wcag22Note}
## Table 1: Success Criteria, Level A

${table('A')}

## Table 2: Success Criteria, Level AA

${table('AA')}
`
}
```

- [ ] **Step 3: Run unit tests** → PASS.

- [ ] **Step 4: Route + DB-backed test** (`app/api/site-audit/[id]/vpat/route.ts`; tests mirror Task 4's seeding with prefix `c4vpat-`; cases: 200 markdown with `Does Not Support` for the seeded tag, 404 unknown, 409 `not_complete`, 409 `no_findings_run`):

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { buildVpatScaffold, type VpatViolationRow } from '@/lib/report/vpat'
import { safeFilenamePart } from '@/lib/report/csv'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: { domain: true, status: true, wcagLevel: true, pagesTotal: true, completedAt: true, createdAt: true },
  })
  if (!audit) return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  if (audit.status !== 'complete') return NextResponse.json({ error: 'not_complete' }, { status: 409 })
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId: id }, select: { id: true } })
  if (!run) return NextResponse.json({ error: 'no_findings_run' }, { status: 409 })

  const violations = await prisma.violation.findMany({
    where: { runId: run.id },
    select: { ruleId: true, impact: true, wcagTags: true, helpUrl: true, page: { select: { url: true } } },
  })
  const rows: VpatViolationRow[] = violations.map((v) => {
    let tags: string[] = []
    try { const parsed = JSON.parse(v.wcagTags); if (Array.isArray(parsed)) tags = parsed.filter((x): x is string => typeof x === 'string') } catch { /* ignore */ }
    return { ruleId: v.ruleId, impact: v.impact, wcagTags: tags, helpUrl: v.helpUrl, pageUrl: v.page.url }
  })
  const stamp = (audit.completedAt ?? audit.createdAt).toISOString()
  const md = buildVpatScaffold({
    domain: audit.domain, auditDate: stamp, wcagLevel: audit.wcagLevel, pagesTotal: audit.pagesTotal, rows,
  })
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="vpat-scaffold-${safeFilenamePart(audit.domain)}-${stamp.slice(0, 10)}.md"`,
    },
  })
}
```

- [ ] **Step 5: Run** → PASS. **Commit** — `feat(c4): VPAT scaffold builder + download route`

---

### Task 7: HTML escaping + report HTML builder

**Files:** Create `lib/report/escape.ts` (+test), `lib/report/report-html.ts` (+test)

- [ ] **Step 1: `lib/report/escape.ts`** (test first: `<script>` → `&lt;script&gt;`, `&` → `&amp;`, quotes escaped in attr):

```ts
// lib/report/escape.ts — every dynamic string in report HTML goes through these.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
```

- [ ] **Step 2: Define `SiteReportData`** at the top of `lib/report/report-html.ts`:

```ts
import { escapeHtml, escapeAttr } from './escape'
import type { AuditScorecard, ArchivedCounts } from '@/lib/ada-audit/types'
import type { InstanceDiff } from '@/lib/services/findings-shared'
import type { ScorePoint } from '@/lib/services/scorecard-shared'

export interface ReportTopIssue {
  ruleId: string
  impact: string          // exact axe impact, may be 'unknown' — render verbatim
  help: string | null
  helpUrl: string | null
  pageCount: number
  sampleUrls: string[]    // ≤5
  nodeSamples: string[]   // ≤2 capped html samples
  screenshot: string | null // data URI or null
}

export interface ReportWorstPage {
  url: string
  critical: number
  serious: number
  moderate: number
  minor: number
  total: number
}

export interface SiteReportData {
  siteAuditId: string
  domain: string
  clientName: string | null
  wcagLevel: string
  auditDate: string        // ISO — audit completedAt ?? createdAt
  generatedAt: string      // ISO — render time
  requestedBy: string | null
  score: number
  compliant: boolean
  archived: boolean
  pagesTotal: number
  pagesError: number
  aggregate: AuditScorecard
  archivedCounts: ArchivedCounts | null
  trend: ScorePoint[]      // ascending, ≤12, includes this audit's point
  diff: InstanceDiff | null
  previousCompletedAt: string | null
  topIssues: ReportTopIssue[]   // ≤10
  worstPages: ReportWorstPage[] // ≤50
  issuePagesTotal: number
  pdfsTotal: number
  pdfsWithIssues: number
}
```

- [ ] **Step 3: Failing tests** (`lib/report/report-html.test.ts`) against a fixture `SiteReportData`:
  - output contains `<!doctype html>`, the domain, the score, `Enrollment Resources`;
  - node sample `<img src=x onerror=alert(1)>` appears ONLY escaped (assert `&lt;img` present and `<img src=x` absent);
  - impact `'unknown'` rendered verbatim;
  - trend section: with 0 points → section omitted ("Score trend" absent); with 1 point → no `<polyline`; with 12 → `<polyline` present;
  - diff null → "Changes since previous audit" absent; diff present → headline counts rendered;
  - archived fixture → archived note present, screenshots absent, pass/incomplete render `—` when archivedCounts members null;
  - footer disclaimer text present.

- [ ] **Step 4: Implement `buildSiteReportHtml(data): string`.** Single exported function + small private section builders, all values through `escapeHtml`/`escapeAttr`. Brand constants:

```ts
const BRAND = { navy: '#1c2d4a', navyDeep: '#0f1d30', orange: '#f5a623', light: '#f7f8fa' }
const IMPACT_COLOR: Record<string, string> = {
  critical: '#dc2626', serious: '#ea580c', moderate: '#ca8a04', minor: '#2563eb',
}
const impactColor = (impact: string) => IMPACT_COLOR[impact] ?? '#6b7280'
```

Document structure (one `<style>` block, print-oriented: `@page` not needed — margins come from puppeteer; use `page-break-inside: avoid` on cards, `page-break-before: always` on the appendix):

1. **Cover band**: navy background, "ENROLLMENT RESOURCES" wordmark (letter-spaced, orange accent rule), title "Website Accessibility Audit Report", domain, client name, WCAG level label (`wcag22aa` → 'WCAG 2.2 AA + Best Practices', else 'WCAG 2.1 AA'), audit date + generated date.
2. **Executive summary**: big score number with compliant/non-compliant pill, grid of count tiles (pages scanned, pages with issues, critical/serious/moderate/minor totals from `aggregate`, passed/incomplete — from `aggregate` normally; when `archived`, from `archivedCounts` with `—` for null).
3. **Score trend** (omit when `trend.length === 0`): inline SVG 480×80 — normalize points to the box, `<polyline>` when ≥2 points, a circle per point, first/last date + score labels. Pure helper `sparklineSvg(points: ScorePoint[]): string`.
4. **Changes since previous audit** (omit when `diff === null`): counts line (new = regressed + new-page split, resolved, not-rescanned, unchanged) + table of top 10 `diff.rules` (rule, severity, new, resolved).
5. **Top issues** (`topIssues`): one card per issue — rank, ruleId, impact chip (impactColor), help text, pageCount, sample URLs list, node samples in `<code>` blocks (escaped), `<img>` with the data-URI screenshot when present (max-width 100%).
6. **Remediation priorities**: ordered list of topIssues grouped by impact rank — "Fix critical issues first" framing, each item "ruleId — N pages".
7. **Worst pages appendix** (page-break-before): table url/crit/ser/mod/min/total, then "…and N more pages" line when `issuePagesTotal > worstPages.length`.
8. **PDF accessibility note**: one line "N linked PDFs scanned, M with accessibility issues" (omit when `pdfsTotal === 0`).
9. **Archived note** (when `archived`): amber box mirroring the UI copy ("full per-page detail was pruned after 90 days; violations shown are exact").
10. **Footer text in-document** (puppeteer footer adds page numbers): "Generated by Enrollment Resources SEO Tools — automated axe-core scan; not a legal conformance statement."

- [ ] **Step 5: Run** → PASS. **Commit** — `feat(c4): report HTML builder (escaped, branded, archived-aware)`

---

### Task 8: report file helpers + data loader

**Files:** Create `lib/report/report-file.ts` (+test), `lib/report/report-data.ts` (+test)

- [ ] **Step 1: `lib/report/report-file.ts`** (test with `REPORTS_DIR` pointed at a tmp dir via `vi.stubEnv` — module reads env at call time to stay testable):

```ts
// lib/report/report-file.ts — one PDF per site audit under REPORTS_DIR.
import { promises as fs } from 'fs'
import path from 'path'

export function reportsDir(): string {
  return process.env.REPORTS_DIR || path.join(process.cwd(), 'data', 'reports')
}

/** ids are cuids; reject anything path-unsafe defensively. */
function assertSafeId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`unsafe report id: ${id}`)
}

export function reportPath(siteAuditId: string): string {
  assertSafeId(siteAuditId)
  return path.join(reportsDir(), `${siteAuditId}.pdf`)
}

export async function writeReportFile(siteAuditId: string, buf: Buffer): Promise<void> {
  const dest = reportPath(siteAuditId)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.tmp`
  await fs.writeFile(tmp, buf)
  await fs.rename(tmp, dest)
}

export async function deleteReportFile(siteAuditId: string): Promise<void> {
  await fs.unlink(reportPath(siteAuditId)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err
  })
}

export async function reportFileExists(siteAuditId: string): Promise<boolean> {
  return fs.access(reportPath(siteAuditId)).then(() => true, () => false)
}
```

Tests: write→exists→read back, atomicity (no `.tmp` left), delete idempotent, unsafe id throws.

- [ ] **Step 2: `lib/report/report-data.ts`** — `loadSiteReportData(siteAuditId): Promise<SiteReportData | null>`. DB-backed tests (prefix `c4rpt-`): fresh-blob audit returns topIssues aggregated from Violation rows; archived audit (null blobs + seeded `CrawlRun.archivePrunedAt`) returns `archived: true` + no screenshots; pre-A2 (no CrawlRun) → null; trend only includes same-domain same-level site runs.

```ts
// lib/report/report-data.ts — assembles SiteReportData through the SAME read
// paths the views use (summary-or-fallback, CrawlRun.score, level-matched
// trend, C3 instance diff). Screenshots best-effort from child AdaAudit
// blobs (fresh audits only — Violation.nodes never carries screenshotPath).
import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@/lib/db'
import { buildSummaryFromFindings } from '@/lib/ada-audit/findings-fallback'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import { getSiteAuditInstanceDiff } from '@/lib/services/site-audit-diff'
import { buildSeries, type ScorePoint } from '@/lib/services/scorecard-shared'
import { SCREENSHOTS_DIR } from '@/lib/ada-audit/screenshot-helpers'
import type { SiteAuditSummary, StoredAxeResults } from '@/lib/ada-audit/types'
import type { SiteReportData, ReportTopIssue, ReportWorstPage } from './report-html'

const TOP_ISSUES = 10
const SAMPLE_URLS = 5
const NODE_SAMPLES = 2
const MAX_SCREENSHOTS = 6
const MAX_SCREENSHOT_BYTES = 300 * 1024
const WORST_PAGES = 50
```

Loader steps (write them out in the implementation, in this order — all awaits happen here, never in the job's page-held section):

1. **Contract (Codex plan fix #3): reports are findings-run-only.** `loadSiteReportData` returns null iff the audit is missing, the CrawlRun is missing (pre-A2), or no summary can be built — and the POST route 409s `no_findings_run` up front (Task 10), so a queued job that no-ops here is a crash-window backstop, not the user-visible path. The handler checks `status === 'complete'` itself before calling.
2. `siteAudit.findUnique` incl. `client { name }`, `pdfAudits { status, issues }`; null → return null.
3. `crawlRun.findUnique({ where: { siteAuditId } })` select `id, score`; **null → return null**. Summary: parse `audit.summary` (try-catch) else `await buildSummaryFromFindings(id)`; both null → return null. Score = `crawlRun.score ?? computeScoreFromCounts(summary.aggregate, audit.wcagLevel).score`; `compliant` from `computeScoreFromCounts(...).compliant`. `archived = summary.archived === true`.
4. Top issues (relational): `violation.findMany({ where: { runId }, select: { ruleId, impact, help, helpUrl, nodes, page: { select: { url: true, adaAuditId: true } } } })`, aggregate in JS per ruleId: pageCount = distinct urls, impact = first row's, sampleUrls = first 5 distinct sorted, nodeSamples = first 2 parsed `nodes` html strings (try-catch JSON, shape `[{ html: string, ... }]`). Order rules by `IMPACT_RANK[impact] ?? 4` then pageCount desc; take 10.
5. Screenshots (skip entirely when `archived`): iterate topIssues in order; for each, take its first violation row's `page.adaAuditId`; load that child `adaAudit.findUnique` select `result` (cache parsed blobs per adaAuditId in a Map); parse `StoredAxeResults` (try-catch), find `violations` entry with matching rule id, first node with `screenshotPath`. **`screenshotPath` is a bare filename** (`screenshot-helpers.ts` sets `node.screenshotPath = filename`; files live at `SCREENSHOTS_DIR/<adaAuditId>/<filename>` — Codex plan fix #2): resolve `path.resolve(SCREENSHOTS_DIR, adaAuditId, screenshotPath)` and use it **only if it starts with `path.resolve(SCREENSHOTS_DIR, adaAuditId) + path.sep`** (traversal guard); `fs.stat` ≤ MAX_SCREENSHOT_BYTES, read, `data:image/png;base64,...`. Stop after 6 successes; every failure (missing file, parse error) silently skips.
6. Trend: `crawlRun.findMany({ where: { tool: 'ada-audit', source: 'site-audit', domain: audit.domain, wcagLevel: audit.wcagLevel, score: { not: null }, completedAt: { not: null } }, select: { score, completedAt, createdAt } })` → points `{ date: (completedAt ?? createdAt).toISOString(), score }` → `buildSeries(points).points`.
7. Diff: `await getSiteAuditInstanceDiff(siteAuditId)` → `diff`/`previousCompletedAt`.
8. Worst pages from `summary.pages` (already sorted by total desc): filter `scorecard.total > 0`, map to `ReportWorstPage`, cap 50; `issuePagesTotal` = unfiltered count of pages with total > 0.
9. PDFs: `pdfsTotal = audit.pdfsTotal`; `pdfsWithIssues` = pdfAudits where status complete and parsed `issues` array length > 0 (try-catch).
10. `generatedAt = new Date().toISOString()`, `auditDate = (audit.completedAt ?? audit.createdAt).toISOString()`.

- [ ] **Step 3: Run tests** → PASS. **Commit** — `feat(c4): report file store + report data loader (child-blob screenshots, level-matched trend)`

---

### Task 9: `report-render` durable job

**Files:**
- Create: `lib/jobs/handlers/report-render.ts`, `lib/jobs/handlers/report-render.test.ts`
- Modify: `lib/jobs/handlers/register.ts`

- [ ] **Step 1: Failing tests** (mock `@/lib/ada-audit/browser-pool` with `vi.mock` — `acquirePage` returns `{ setContent: vi.fn(), pdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-fake')) }`; mock `@/lib/report/report-data`; point `REPORTS_DIR` at a tmp dir; use the real DB for the SiteAudit row, prefix `c4job-`):
  1. happy path: complete audit → file written, `reportGeneratedAt` stamped, `releasePage` called once;
  2. audit missing → returns without acquiring a page;
  3. audit not complete → returns without acquiring a page (no retry — handler does not throw);
  4. `loadSiteReportData` null → returns, no file;
  5. audit deleted between render and stamp (delete the row from inside the mocked `pdf()` call) → file deleted, no throw;
  6. `pdf()` throws → `releasePage` still called (finally) and the error propagates (queue retries);
  7. registration: `registerReportRenderHandler()` then assert the registry has type `report-render` (mirror the existing `ada-audit` registration test pattern).

- [ ] **Step 2: Implement:**

```ts
// lib/jobs/handlers/report-render.ts
//
// Durable branded-PDF render for a completed SiteAudit. On-demand (POST
// /api/site-audit/[id]/report), one file per audit under REPORTS_DIR,
// regeneration overwrites. groupKey 'report:<id>' — deliberately NOT
// 'site-audit:<id>': recovery treats that group as audit liveness.
//
// Error semantics: deleted/non-complete/pre-A2 audits are domain no-ops
// (settle clean, no retry burn — Codex spec fix #9); render/data/db errors
// throw → one retry; onExhausted is log-only (a failed report NEVER touches
// the audit row).

import { prisma } from '@/lib/db'
import { acquirePage, releasePage } from '@/lib/ada-audit/browser-pool'
import { loadSiteReportData } from '@/lib/report/report-data'
import { buildSiteReportHtml } from '@/lib/report/report-html'
import { writeReportFile, deleteReportFile } from '@/lib/report/report-file'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'

export const REPORT_RENDER_JOB_TYPE = 'report-render'

export interface ReportRenderJob { siteAuditId: string }

function assertPayload(payload: unknown): ReportRenderJob {
  const p = payload as Partial<ReportRenderJob> | null
  if (!p || typeof p.siteAuditId !== 'string') throw new Error('Invalid report-render job payload')
  return p as ReportRenderJob
}

export async function runReportRenderJob(payload: unknown): Promise<void> {
  const { siteAuditId } = assertPayload(payload)

  const audit = await prisma.siteAudit.findUnique({ where: { id: siteAuditId }, select: { status: true } })
  if (!audit) return // deleted before we started — clean no-op
  if (audit.status !== 'complete') {
    console.warn(`[jobs/report-render] audit ${siteAuditId} is ${audit.status}, skipping`)
    return
  }

  const data = await loadSiteReportData(siteAuditId)
  if (!data) {
    console.warn(`[jobs/report-render] no report data for ${siteAuditId} (pre-A2?), skipping`)
    return
  }
  const html = buildSiteReportHtml(data)

  // All data work is done — only now take a browser page, and hold it for
  // nothing but setContent + pdf (browser-pool rule).
  const page = await acquirePage()
  let pdf: Buffer
  try {
    await page.setContent(html, { waitUntil: 'load' })
    pdf = Buffer.from(await page.pdf({
      format: 'letter',
      printBackground: true,
      margin: { top: '0.6in', bottom: '0.75in', left: '0.6in', right: '0.6in' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:8px;color:#9ca3af;text-align:center;">
        <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    }))
  } finally {
    await releasePage(page)
  }

  await writeReportFile(siteAuditId, pdf)
  const stamped = await prisma.siteAudit.updateMany({
    where: { id: siteAuditId },
    data: { reportGeneratedAt: new Date() },
  })
  if (stamped.count === 0) {
    // Audit deleted mid-render — don't leave an orphan file.
    await deleteReportFile(siteAuditId)
  }
}

export async function onReportRenderExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  const p = payload as Partial<ReportRenderJob> | null
  console.warn(`[jobs/report-render] report for ${p?.siteAuditId} failed after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerReportRenderHandler(): void {
  registerJobHandler({
    type: REPORT_RENDER_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 2,
    backoffBaseMs: 15_000,
    timeoutMs: 120_000,
    handler: runReportRenderJob,
    onExhausted: onReportRenderExhausted,
  })
}
```

- [ ] **Step 3: Register** — add `registerReportRenderHandler()` to `lib/jobs/handlers/register.ts` (import + call).

- [ ] **Step 4: Run tests** → PASS. **Commit** — `feat(c4): durable report-render job (pool-safe, deleted-audit no-ops)`

---

### Task 10: report routes

**Files:**
- Create: `app/api/site-audit/[id]/report/route.ts` (+test), `app/api/site-audit/[id]/report/status/route.ts` (+test)

- [ ] **Step 1: Failing tests** (DB-backed, prefix `c4rep-`; mock `@/lib/jobs/queue` `enqueueJob`/`countActiveJobsByGroup` with a partial mock via `vi.mock` + `importActual` so other exports stay real; `REPORTS_DIR` → tmp):
  - POST complete audit → 202 `{ queued: true }`, `enqueueJob` called with `{ type: 'report-render', dedupKey: 'report:<id>', groupKey: 'report:<id>' }`;
  - POST non-complete → 409; unknown → 404; enqueue throws → 500;
  - GET with file on disk → 200 `application/pdf` + filename `ada-report-<domain>-`; GET without file → 404;
  - status: no jobs + no stamp → `none`; active job → `rendering`; stamp + file → `ready`; stamp + NO file → `none` (Codex fix #6).

- [ ] **Step 2: Implement** `app/api/site-audit/[id]/report/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { prisma } from '@/lib/db'
import { enqueueJob } from '@/lib/jobs/queue'
import { REPORT_RENDER_JOB_TYPE } from '@/lib/jobs/handlers/report-render'
import { reportPath } from '@/lib/report/report-file'
import { safeFilenamePart } from '@/lib/report/csv'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({ where: { id }, select: { status: true } })
  if (!audit) return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  if (audit.status !== 'complete') return NextResponse.json({ error: 'not_complete' }, { status: 409 })
  // Reports are findings-run-only (loader contract) — reject pre-A2 audits
  // here instead of queueing a job that would no-op (Codex plan fix #3).
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId: id }, select: { id: true } })
  if (!run) return NextResponse.json({ error: 'no_findings_run' }, { status: 409 })
  try {
    await enqueueJob({
      type: REPORT_RENDER_JOB_TYPE,
      payload: { siteAuditId: id },
      dedupKey: `report:${id}`,
      groupKey: `report:${id}`,
    })
  } catch (err) {
    console.error('[site-audit/report] enqueue failed:', err)
    return NextResponse.json({ error: 'enqueue_failed' }, { status: 500 })
  }
  return NextResponse.json({ queued: true }, { status: 202 })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: { domain: true, completedAt: true, createdAt: true },
  })
  if (!audit) return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  let buf: Buffer
  try {
    buf = await fs.readFile(reportPath(id))
  } catch {
    return NextResponse.json({ error: 'report_not_generated' }, { status: 404 })
  }
  const stamp = (audit.completedAt ?? audit.createdAt).toISOString().slice(0, 10)
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ada-report-${safeFilenamePart(audit.domain)}-${stamp}.pdf"`,
    },
  })
}
```

and `app/api/site-audit/[id]/report/status/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { countActiveJobsByGroup } from '@/lib/jobs/queue'
import { reportFileExists } from '@/lib/report/report-file'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: { reportGeneratedAt: true },
  })
  if (!audit) return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })

  if (await countActiveJobsByGroup(`report:${id}`) > 0) {
    return NextResponse.json({ state: 'rendering', generatedAt: audit.reportGeneratedAt?.toISOString() ?? null })
  }
  // 'ready' requires the stamp AND the file (never trust the column alone).
  if (audit.reportGeneratedAt && (await reportFileExists(id))) {
    return NextResponse.json({ state: 'ready', generatedAt: audit.reportGeneratedAt.toISOString() })
  }
  return NextResponse.json({ state: 'none', generatedAt: null })
}
```

- [ ] **Step 3: Run** → PASS. **Commit** — `feat(c4): report POST/GET/status routes`

---

### Task 11: site share links (mint route, cleanup, public page, shareMode, middleware)

**Files:**
- Create: `app/api/site-audit/[id]/share/route.ts` (+test), `app/ada-audit/site/share/[token]/page.tsx` (+test)
- Modify: `lib/cleanup.ts` (+test), `middleware.ts` + `middleware.test.ts`,
  `components/ada-audit/SiteAuditResultsView.tsx`, `components/ada-audit/SiteAuditToolbar.tsx`,
  `components/ada-audit/CommonIssueCallout.tsx`, `components/ada-audit/ShareAuditButton.tsx`

- [ ] **Step 1: Mint route.** Copy `app/api/ada-audit/[id]/share/route.ts` VERBATIM to `app/api/site-audit/[id]/share/route.ts`, changing only: `prisma.adaAudit` → `prisma.siteAudit`, share URL path → `` `${origin}/ada-audit/site/share/${token}` ``, error copy "Audit" → "Site audit". Same 30-day TTL, same rotate-on-expiry, same complete-only 400. DB-backed tests (prefix `c4shr-`): mint on complete → token + url shape; second POST returns same token with extended expiry; expired token rotates; non-complete → 400; unknown → 404; GET returns null after expiry.

- [ ] **Step 2: Cleanup.** In `lib/cleanup.ts` add and register in `runCleanup()`'s `Promise.allSettled` list:

```ts
/** Clear expired SiteAudit share tokens (mirror of the AdaAudit cleanup). */
export async function cleanExpiredSiteAuditShareTokens(): Promise<void> {
  await prisma.siteAudit.updateMany({
    where: { shareExpiresAt: { lt: new Date() } },
    data: { shareToken: null, shareExpiresAt: null },
  })
}
```

Test next to the existing `cleanExpiredAdaShareTokens` tests: expired token nulled, live token kept.

- [ ] **Step 3: Middleware.** Add `'/ada-audit/site/share/'` to `PUBLIC_PATH_PREFIXES` in `middleware.ts`. In `middleware.test.ts` add `'/ada-audit/site/share/tok'` to the public `it.each` list AND assert `isPublicPath('/api/site-audit/abc/share')` is **false** (mint stays cookie-gated).

- [ ] **Step 4: `shareMode` threading.** In `SiteAuditResultsView.tsx`:
  - `Props` gains `shareMode?: boolean` (default false).
  - Triage: when `shareMode`, skip the localStorage effect, never enable triage, and don't render the Triage toggle button; `useChecks` gets `enabled: triageMode && !shareMode`.
  - Grouped view: `useGroupedViolations(summary.pages, viewMode === 'by-violation' && !shareMode)`; force `viewMode` to stay `'table'` (ignore setViewMode when shareMode) and pass `hideViewToggle={shareMode}` to `SiteAuditToolbar`.
  - `CommonIssueCallout` gets `onViewAffectedPages={shareMode ? undefined : handleViewAffectedPages}`.
  - `PageRowProps` gains `shareMode: boolean`. In `PageRow`: when `shareMode`, render the `<tr>` without `onClick`/`cursor-pointer`/chevron and never expand (the expanded branch with its `/api/ada-audit/[id]` fetch and "View full audit ↗" link is unreachable).
  - In `SiteAuditToolbar.tsx`: add `hideViewToggle?: boolean`; when true, don't render the table/by-violation view-mode buttons (read the component first; the toggle is the segmented control fed by `viewMode`/`onViewModeChange`).
  - In `CommonIssueCallout.tsx`: make `onViewAffectedPages` optional; render the "View affected pages" CTA only when provided.

- [ ] **Step 5: Public page.** `app/ada-audit/site/share/[token]/page.tsx` — mirror the complete branch of `app/ada-audit/site/[id]/page.tsx` and the token handling of `app/ada-audit/share/[token]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import SiteAuditResultsView from '@/components/ada-audit/SiteAuditResultsView'
import { buildSummaryFromFindings } from '@/lib/ada-audit/findings-fallback'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import type { SiteAuditSummary, AuditPdfRow } from '@/lib/ada-audit/types'
import type { PdfIssue } from '@/lib/ada-audit/pdf-types'

export const dynamic = 'force-dynamic'

export default async function SharedSiteAuditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const audit = await prisma.siteAudit.findUnique({
    where: { shareToken: token },
    include: {
      client: { select: { name: true } },
      pdfAudits: { select: { url: true, fileSize: true, pageCount: true, issues: true, scanError: true } },
    },
  })
  if (!audit || audit.status !== 'complete') notFound()
  if (!audit.shareExpiresAt || audit.shareExpiresAt <= new Date()) notFound()

  let summary: SiteAuditSummary | null = null
  if (audit.summary) {
    try { summary = JSON.parse(audit.summary) as SiteAuditSummary } catch { /* corrupted */ }
  }
  if (!summary) summary = await buildSummaryFromFindings(audit.id)
  if (!summary) notFound() // pre-A2 complete with no blob — nothing renderable publicly

  const crawlRun = await prisma.crawlRun.findUnique({ where: { siteAuditId: audit.id }, select: { score: true } })
  const fromCounts = computeScoreFromCounts(summary.aggregate, audit.wcagLevel)
  const score = crawlRun?.score ?? fromCounts.score

  const pdfs: AuditPdfRow[] = audit.pdfAudits.map((p) => {
    let issues: PdfIssue[] = []
    if (p.issues) {
      try { const parsed = JSON.parse(p.issues); if (Array.isArray(parsed)) issues = parsed as PdfIssue[] } catch { /* ignore */ }
    }
    return { url: p.url, fileSize: p.fileSize, pageCount: p.pageCount, issues, scanError: p.scanError ?? null }
  })

  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <div className="text-[13px] font-body text-navy/50 dark:text-white/50">
        Shared accessibility report — read-only
      </div>
      <SiteAuditResultsView
        domain={audit.domain}
        clientName={audit.client?.name ?? null}
        createdAt={audit.createdAt.toISOString()}
        pagesTotal={audit.pagesTotal}
        pagesError={audit.pagesError}
        summary={summary}
        wcagLevel={audit.wcagLevel}
        score={score}
        compliant={fromCounts.compliant}
        pdfs={pdfs}
        siteAuditId={audit.id}
        shareMode
      />
    </main>
  )
}
```

Check the single-page share page (`app/ada-audit/share/[token]/page.tsx`) for `metadata`/robots handling and layout chrome and mirror it exactly (e.g. if it exports `metadata = { robots: { index: false } }`, do the same).

- [ ] **Step 6: Share-page tests.** DB-backed render tests are awkward for server components — follow the C3 pattern: test the data-visible behavior via a component test for `SiteAuditResultsView` with `shareMode` (no triage button, no view toggle, rows not clickable) in `SiteAuditResultsView.test.tsx`, plus middleware tests (Step 3), plus mint-route tests (Step 1). **Zero-fetch assertion (Codex plan fix #6):** stub `global.fetch` with `vi.fn()`, render in `shareMode`, click a page row and every toolbar control, and assert fetch was NEVER called with `/api/ada-audit/` or `/checks` URLs (strongest proof the public page issues no cookie-gated calls). 

- [ ] **Step 7: `ShareAuditButton` endpoint prop:**

```ts
interface Props {
  auditId: string
  /** API base — defaults to the single-page audit endpoint. */
  endpoint?: string
}
// fetch(`${endpoint ?? `/api/ada-audit/${auditId}`}/share`, { method: 'POST' })
```

Keep the default exactly as today so existing call sites don't change.

- [ ] **Step 8: Run the full ada-audit component + middleware + cleanup test files** → PASS. **Commit** — `feat(c4): site-audit share links (mint, public share page, shareMode, middleware, cleanup)`

---

### Task 12: lifecycle — DELETE route + scheduled retention delete report files

**Files:**
- Modify: `app/api/site-audit/[id]/route.ts` (DELETE) + its test
- Modify: `lib/ada-audit/scheduled-retention.ts` + its test

- [ ] **Step 1: DELETE route.** In the existing DELETE handler (imports: `cancelJobsByGroup` from `@/lib/jobs/queue`, `deleteReportFile` from `@/lib/report/report-file`): call `cancelJobsByGroup(\`report:${id}\`)` **BEFORE** `prisma.siteAudit.delete` (Codex plan fix #7 — cancel queued renders first; a RUNNING render is handled by the handler's `stamped.count === 0` cleanup), then after the delete add:

```ts
  const reportCleanup = await Promise.allSettled([
    deleteReportFile(id),
  ])
  for (const result of reportCleanup) {
    if (result.status === 'rejected') {
      console.warn(`[site-audit] Failed report cleanup for deleted site audit ${id}:`, result.reason)
    }
  }
```

Extend the existing mock-based route test: mock `@/lib/report/report-file` + `@/lib/jobs/queue` and assert both are called with the audit id / `report:<id>`.

- [ ] **Step 2: Scheduled retention.** In `pruneScheduledSiteAudits()`, the candidate ids are already snapshotted (`candidates`). After each chunk's `deleteMany`, best-effort delete the report files for that chunk:

```ts
      await prisma.siteAudit.deleteMany({ where: { id: { in: ids } } })
      // Report PDFs have no sweep of their own (screenshots age out via the
      // 24-h sweep; reports don't) — delete from the pre-delete snapshot.
      const fileCleanup = await Promise.allSettled(ids.map((rid) => deleteReportFile(rid)))
      for (const r of fileCleanup) {
        if (r.status === 'rejected') console.warn('[retention] report file cleanup failed:', r.reason)
      }
```

Update the file header comment (the "screenshots are collected by the existing sweep" paragraph) to mention report files are deleted here explicitly. Extend the scheduled-retention test: seed a fake report file in a tmp `REPORTS_DIR` for a pruned audit → file gone; file for a kept audit → still there.

- [ ] **Step 3: Run both test files** → PASS. **Commit** — `feat(c4): report-file lifecycle on DELETE + scheduled retention`

---

### Task 13: `SiteAuditExportBar` + page wiring

**Files:**
- Create: `components/ada-audit/SiteAuditExportBar.tsx` (+test)
- Modify: `app/ada-audit/site/[id]/page.tsx`

- [ ] **Step 1: Component.** Client component:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import ShareAuditButton from './ShareAuditButton'

interface Props {
  siteAuditId: string
  hasPrevious: boolean
  initialReportGeneratedAt: string | null
}

type ReportState = 'none' | 'queueing' | 'rendering' | 'ready' | 'error'
```

Behavior:
- Row of controls in the existing toolbar idiom (same button classes as `ShareAuditButton`): `ShareAuditButton` with `endpoint={`/api/site-audit/${siteAuditId}`}`, plain `<a>` "Violations CSV" → `/api/site-audit/${siteAuditId}/csv`, `<a>` "Changes CSV" → `?sheet=changes` rendered only when `hasPrevious`, `<a>` "VPAT scaffold" → `/api/site-audit/${siteAuditId}/vpat`, and the PDF-report button.
- Report button state machine: initial `ready` if `initialReportGeneratedAt` else `none`. Click on `none`/`ready`/`error` → POST `/api/site-audit/${id}/report`; non-OK → `error` (3 s revert); OK → `rendering` and start a 2 s `setInterval` polling `/report/status`; status `ready` → clear interval, set `ready` + store `generatedAt`; status `none` after having been `rendering` → `error` (render failed/exhausted; revert to clickable after 3 s). Clear the interval on unmount (`useRef` + cleanup).
- `ready` renders two adjacent controls: `<a>` "Download report" → `/api/site-audit/${id}/report` and a small "Regenerate" button (re-POST). Show `generatedAt` as a `title` tooltip.
- Component test (`SiteAuditExportBar.test.tsx`, jsdom + `vi.useFakeTimers` — remember: NO `waitFor` with fake timers under `globals:false`; drive with `await act(...)` + `vi.advanceTimersByTimeAsync`): renders all links; Changes CSV hidden when `hasPrevious` false; click → POST then polls status until `ready` flips the button to the download link; status stuck `none` → error state.

- [ ] **Step 2: Wire into the page.** In `app/ada-audit/site/[id]/page.tsx` complete branch — `select` already includes everything via `findUnique` include; add `reportGeneratedAt` usage and render between the breadcrumb and the diff panel:

```tsx
      <SiteAuditExportBar
        siteAuditId={audit.id}
        hasPrevious={instanceDiff !== null}
        initialReportGeneratedAt={initialReportGeneratedAt}
      />
```

where the page computes (Codex plan fix #4 — never show "ready" from the stamp alone):

```ts
import { reportFileExists } from '@/lib/report/report-file'
// in the complete branch:
const initialReportGeneratedAt =
  audit.reportGeneratedAt && (await reportFileExists(audit.id))
    ? audit.reportGeneratedAt.toISOString()
    : null
```

- [ ] **Step 3: Run component tests** → PASS. **Commit** — `feat(c4): SiteAuditExportBar (share, CSVs, PDF report, VPAT) on the site results page`

---

### Task 14: verification + docs

- [ ] **Step 1: Full gates.**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npx vitest run
npm run build
```

Expected: 0 type errors; full suite green (2,233 existing + ~90 new); build clean.

- [ ] **Step 2: Local smoke (Playwright MCP or curl against `npm run dev`).** With a completed local site audit: CSV downloads + opens with BOM; VPAT downloads; share mint → open `/ada-audit/site/share/<token>` in a logged-out context (200, no triage button, rows not expandable); POST report → poll status → GET downloads a real PDF (Chrome must be installed locally — if not, verify the job path via the mocked tests and lean on prod verification).
- [ ] **Step 3: CLAUDE.md** — add `lib/report/` to Key files (one line: CSV/VPAT/report-html/report-data/report-file, `report-render` job, REPORTS_DIR) and extend the ADA architecture bullet with: site-audit share links mirror single-page (`/ada-audit/site/share/[token]` public prefix), report lifecycle (on-demand durable render, file dies with the audit row).
- [ ] **Step 4: Commit** — `docs(c4): CLAUDE.md reporting-layer notes` — then `gh pr create` (branch `feat/c4-reporting-layer`) with a summary listing the four features + test counts.

---

## Self-review notes (already applied)

- Spec coverage: share links (T1/T11), CSV ×2 (T2/T3/T4), PDF report (T7–T10, T12 lifecycle, T13 UI), VPAT (T5/T6), retention/cleanup (T11 step 2, T12), middleware (T11 step 3), unknown-impact (T4/T6/T7), escaping (T7), injection (T2), notRescannedUrls (T3), file-existence status (T10), deleted-audit no-ops (T9).
- Type consistency: `InstanceDiffDetailed`/`RuleInstanceDiffDetailed` (T3) consumed by T4; `SiteReportData`/`ReportTopIssue` (T7) produced by T8, consumed by T9; `reportPath`/`deleteReportFile`/`reportFileExists` (T8) used by T9/T10/T12.
- The only intentionally-summarized code is the body move in T3 (verbatim relocation of an existing loop) and the long static HTML/CSS of T7 (structure + invariants fully specified; tests pin the contract).
