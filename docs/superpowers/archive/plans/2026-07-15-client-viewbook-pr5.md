# Client Viewbook PR5 — Assessment Section + Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Codex review 2026-07-16:** accepted with 8 named fixes — all applied inline below (central `requireViewbookToken`, `logError` record signature, `completedAt desc, id desc` tie-break, curated SEO type sets, null-ADA-score tile, p75 CWV rendering + 3-child loader test, `vi.hoisted` mock, SetNull-aware test cleanup CrawlRuns→SiteAudits→Clients, cross-client isolation test, Tooltip `aria-describedby`, `details[open]` animation + `prefers-reduced-motion`, program-map `D:` entry).

**Goal:** Ship the Current-Site Assessment section (audit-pull loader + operator narrative) and the PR5 polish pass (SectionShell done-state animation + hero rendering, Tooltip) on the public viewbook page.

**Architecture:** A server-only loader `lib/viewbook/assessment.ts` resolves token → viewbook → client → latest REPORTABLE site audit (C14 rule: `complete` ∧ `seoOnly:false` ∧ has a `seo-parser` CrawlRun) and derives a client-safe `AssessmentData` payload (scores from `CrawlRun.score`, ADA patterns from the summary blob with the C3 findings fallback, SEO issue groups from live-scan run-scope findings, CWV via the C14 `cwv-aggregate` pures). `AssessmentSection` is an **async server component** with the exact same props as `AssessmentPlaceholder` (the swap is one import change at the page mount point); it loads its own data and fails soft to the "first scan coming soon" state. SectionShell keeps its props surface stable — PR5 only enriches rendering.

**Tech Stack:** Next.js 15 App Router RSC, Prisma/SQLite, Tailwind, vitest (+ jsdom/@testing-library for components).

**Worktree/branch:** `.claude/worktrees/client-viewbook`, branch `feat/viewbook-pr5` (from origin/main @ b7be08e — PR1 #185 + PR2 #187 + PR4 #189 merged). PR3 (Codex) runs in parallel and owns `DataSourceSection.tsx`, `ViewbookEditor.tsx`, `middleware.ts` — **never touch those files** in this lane.

## Global Constraints

- File ownership (program plan): Create `lib/viewbook/assessment.ts`, `components/viewbook/public/AssessmentSection.tsx`, `components/viewbook/public/Tooltip.tsx` + tests. Modify ONLY `components/viewbook/public/SectionShell.tsx` (+ its test) and `app/(public)/viewbook/[token]/page.tsx`. Delete `components/viewbook/public/AssessmentPlaceholder.tsx` (its only consumer is the page mount being swapped) — Task 5 also records this as a `D:` entry in the program plan's PR5 map (Codex fix 8). The handoff-doc/tracker updates in Task 6 are the standing docs-ritual exception to "Modify ONLY".
- NEVER touch: `prisma/schema.prisma`, `middleware.ts`, `lib/viewbook/public-data.ts`, `public-types.ts`, `DataSourceSection.tsx`, `MilestonesSection.tsx`, `MaterialsSection.tsx`, `ViewbookEditor.tsx` (PR3/PR4 territory).
- Honest labels (spec §8, C14 copy rules): performance is Lighthouse LAB data — never "Core Web Vitals pass", never "WCAG compliant"; standard line uses `standardLabel(wcagLevel)` from `lib/sales/copy.ts` verbatim.
- Public page renders plain text only, escaped by React — narrative/intros are never HTML.
- The loader must NEVER throw into the page (fault isolation, spec §8): every failure path returns `null` → coming-soon state; unexpected errors `logError('viewbook.assessment', err)`.
- `isPlaceholderRun` (`lib/findings/exhausted-placeholder.ts`) is THE predicate for a dead live-scan run — never inline source comparisons.
- Server components can render client leaves but never pass function props. `Tooltip`/`AssessmentSection`/`SectionShell` stay server components (no `'use client'`).
- Gates before any push: `npx tsc --noEmit` · `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`. Worktree has no `.env` — always prefix `DATABASE_URL` for tests.
- Cross-review before merge: `/codex-review` (P1) on the branch diff.

---

### Task 1: `lib/viewbook/assessment.ts` — the audit-pull loader

**Files:**
- Create: `lib/viewbook/assessment.ts`
- Test: `lib/viewbook/assessment.test.ts`

**Interfaces:**
- Consumes: `prisma` (`@/lib/db`), `isPlaceholderRun`, `buildSummaryFromFindings` (`@/lib/ada-audit/findings-fallback`), `aggregatePerformance`/`pickHomepageCwv`/`PerformanceRollup`/`HomepageCwv` (`@/lib/sales/cwv-aggregate`), `standardLabel` (`@/lib/sales/copy`), `ONPAGE_FINDING_LABELS`/`BROKEN_FINDING_LABELS` (`@/lib/findings/finding-type-sets`), `logError` (`@/lib/log`), `SiteAuditSummary`/`CommonIssue` types (`@/lib/ada-audit/types`), `LighthouseSummary` (`@/lib/ada-audit/lighthouse-types`).
- Produces (Task 3 relies on these exact names):

```ts
export interface AssessmentAdaPattern {
  help: string
  impact: string // 'critical' | 'serious' | 'moderate' | 'minor'
  affectedPagesCount: number
  totalPagesScanned: number
}
export interface AssessmentSeoIssue {
  label: string
  count: number
  unit: 'pages' | 'targets' | 'groups' // sweep snapshot.ts unit convention
}
export interface AssessmentData {
  domain: string
  completedAt: string | null // ISO
  standardTested: string     // standardLabel(wcagLevel)
  pagesAudited: number       // SiteAudit.pagesComplete
  adaScore: number | null    // ada-audit CrawlRun.score
  seoScore: number | null    // live-scan CrawlRun.score (null when unavailable)
  seoUnavailable: boolean    // live-scan run is the exhausted placeholder
  adaPatterns: AssessmentAdaPattern[] // ≤4, impact-rank then affected-count
  seoIssues: AssessmentSeoIssue[]     // ≤5 run-scope findings by count desc
  performance: PerformanceRollup | null
  homepage: HomepageCwv | null
}
export async function loadAssessmentData(token: string): Promise<AssessmentData | null>
```

**Behavior (spec §8 assessment bullet):**
1. Resolve the viewbook via the ONE central validator (Codex fix 1 — never a second raw token lookup): `const vb = await requireViewbookToken(token)` inside the try; an `HttpError` from it (unknown/revoked/archived) is a CONTROLLED absence → return `null` WITHOUT `logError` (only unexpected errors log).
2. Latest reportable audit, client-wide (audits carry `clientId` regardless of which registered domain was scanned; the audited `domain` is displayed). Deterministic tie-break mirrors C14: `completedAt desc, id desc` (Codex fix 1):
   ```ts
   const audit = await prisma.siteAudit.findFirst({
     where: {
       clientId: vb.clientId,
       status: 'complete',
       seoOnly: false,
       crawlRuns: { some: { tool: 'seo-parser' } },
     },
     orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
   })
   ```
   No audit → `null`.
3. Runs: `prisma.crawlRun.findMany({ where: { siteAuditId: audit.id }, select: { tool: true, source: true, score: true, findings: { where: { scope: 'run' }, select: { type: true, count: true } } } })`. `adaScore` = the `tool: 'ada-audit'` run's score (null if absent — dual-write failure degrades, never throws). The `tool: 'seo-parser'` run: `isPlaceholderRun(run)` → `seoUnavailable: true`, `seoScore: null`, `seoIssues: []`; else `seoScore = run.score`, `seoIssues` = run-scope findings **filtered to `count > 0` members of `ONPAGE_FINDING_TYPE_SET ∪ BROKEN_FINDING_TYPE_SET`** (Codex fix 2 — the C14-style curated catalog; an unknown future finding type must never surface as a raw snake_case label with a guessed unit), sorted `count desc`, top 5, mapped `{ label: ONPAGE_FINDING_LABELS[type] ?? BROKEN_FINDING_LABELS[type] ?? type, count, unit: unitFor(type) }` where `unitFor` = `type.startsWith('broken_') ? 'targets' : type.startsWith('duplicate_') ? 'groups' : 'pages'`.
4. ADA patterns: `JSON.parse(audit.summary)` (try/catch → null) → fallback `await buildSummaryFromFindings(audit.id)`; from `summary?.commonIssues ?? []` sort by `IMPACT_RANK[impact] desc` (`{ critical: 3, serious: 2, moderate: 1, minor: 0 }`, missing → 0) then `affectedPagesCount desc`, slice 4, map to `AssessmentAdaPattern` (counts + help only — no node HTML, no screenshots).
5. CWV: `prisma.adaAudit.findMany({ where: { siteAuditId: audit.id, lighthouseSummary: { not: null } }, select: { id: true, url: true, lighthouseSummary: true } })` → parse each (drop unparseable) → `performance = aggregatePerformance(rows)`, `homepage = pickHomepageCwv(rows, audit.domain)`.
6. Whole body inside `try { … } catch (err) { if (!(err instanceof HttpError)) logError({ subsystem: 'viewbook', op: 'assessment-load' }, err); return null }` — `logError`'s first argument is a RECORD, not a string (Codex fix 1; check `lib/log`'s exact signature while implementing), and controlled token 404s never log.

- [ ] **Step 1: Write the failing tests**

`lib/viewbook/assessment.test.ts` (DB-backed — repo convention: import `prisma` from `@/lib/db`, unique client names, clean up in `afterAll`):

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { loadAssessmentData } from './assessment'

const clientIds: number[] = []
const auditIds: string[] = []

async function mkClient(domain = 'acme.edu') {
  const c = await prisma.client.create({
    data: { name: `vb-test-${randomUUID()}`, domains: JSON.stringify([domain]) },
  })
  clientIds.push(c.id)
  return c
}

async function mkViewbook(clientId: number) {
  return prisma.viewbook.create({
    data: { clientId, kind: 'upgrade', token: randomUUID() },
  })
}

interface AuditOpts {
  seoOnly?: boolean
  status?: string
  completedAt?: Date
  summary?: string | null
  domain?: string
  liveScan?: { score?: number | null; placeholder?: boolean; findings?: { type: string; count: number }[] } | null
  adaScore?: number | null
}

async function mkAudit(clientId: number, opts: AuditOpts = {}) {
  const audit = await prisma.siteAudit.create({
    data: {
      domain: opts.domain ?? 'acme.edu',
      status: opts.status ?? 'complete',
      seoOnly: opts.seoOnly ?? false,
      wcagLevel: 'wcag21aa',
      clientId,
      pagesTotal: 5,
      pagesComplete: 5,
      completedAt: opts.completedAt ?? new Date('2026-07-01T00:00:00Z'),
      summary: opts.summary ?? null,
    },
  })
  auditIds.push(audit.id)
  if (opts.adaScore !== null) {
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', status: 'complete', siteAuditId: audit.id, score: opts.adaScore ?? 82 },
    })
  }
  if (opts.liveScan !== null) {
    const ls = opts.liveScan ?? {}
    await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser',
        source: ls.placeholder ? 'live-scan-placeholder' : 'live-scan',
        status: ls.placeholder ? 'partial' : 'complete',
        siteAuditId: audit.id,
        score: ls.placeholder ? null : ls.score ?? 74,
        findings: {
          create: (ls.findings ?? []).map((f) => ({
            scope: 'run', type: f.type, severity: 'warning', count: f.count,
            dedupKey: `${f.type}-${randomUUID()}`,
          })),
        },
      },
    })
  }
  return audit
}

// SetNull FKs: client delete does NOT cascade SiteAudits/CrawlRuns (Codex
// fix 4) — clean explicitly, in dependency order.
afterAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { siteAuditId: { in: auditIds } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: auditIds } } })
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
})

describe('loadAssessmentData', () => {
  it('returns null for an unknown token', async () => {
    expect(await loadAssessmentData(randomUUID())).toBeNull()
  })

  it('returns null when the client has no reportable audit', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { seoOnly: true })                 // seoOnly excluded
    await mkAudit(c.id, { status: 'error' })               // not complete
    await mkAudit(c.id, { liveScan: null })                // no seo-parser run
    expect(await loadAssessmentData(vb.token)).toBeNull()
  })

  it('builds the full payload from the newest reportable audit', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { completedAt: new Date('2026-06-01T00:00:00Z'), adaScore: 40 })
    const summary = JSON.stringify({
      commonIssues: [
        { ruleId: 'a', impact: 'moderate', help: 'Moderate thing', description: '', helpUrl: '', affectedPagesCount: 5, totalPagesScanned: 5, sharedAncestor: null, ancestorConfidence: null },
        { ruleId: 'b', impact: 'critical', help: 'Critical thing', description: '', helpUrl: '', affectedPagesCount: 2, totalPagesScanned: 5, sharedAncestor: null, ancestorConfidence: null },
      ],
    })
    await mkAudit(c.id, {
      completedAt: new Date('2026-07-02T00:00:00Z'),
      summary,
      adaScore: 82,
      liveScan: { score: 74, findings: [
        { type: 'missing_title', count: 3 },
        { type: 'broken_internal_links', count: 9 },
        { type: 'duplicate_title', count: 2 },
      ] },
    })
    const data = await loadAssessmentData(vb.token)
    expect(data).not.toBeNull()
    expect(data!.domain).toBe('acme.edu')
    expect(data!.adaScore).toBe(82) // newest reportable, not the June audit
    expect(data!.seoScore).toBe(74)
    expect(data!.seoUnavailable).toBe(false)
    expect(data!.standardTested).toMatch(/WCAG 2\.1 AA/)
    expect(data!.pagesAudited).toBe(5)
    // impact rank beats affected count: critical first
    expect(data!.adaPatterns.map((p) => p.help)).toEqual(['Critical thing', 'Moderate thing'])
    // count-desc, labeled, unit-mapped
    expect(data!.seoIssues[0]).toEqual({ label: 'Broken internal links', count: 9, unit: 'targets' })
    expect(data!.seoIssues.find((i) => i.unit === 'groups')?.count).toBe(2)
    // <3 lighthouse rows → rollup null, homepage null
    expect(data!.performance).toBeNull()
    expect(data!.homepage).toBeNull()
  })

  it('marks a placeholder live-scan run seoUnavailable with no seo issues', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { liveScan: { placeholder: true } })
    const data = await loadAssessmentData(vb.token)
    expect(data).not.toBeNull()
    expect(data!.seoUnavailable).toBe(true)
    expect(data!.seoScore).toBeNull()
    expect(data!.seoIssues).toEqual([])
    expect(data!.adaScore).toBe(82) // ADA half still renders
  })

  it('degrades corrupt summary JSON via the findings fallback (never throws)', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { summary: '{not json', liveScan: {} })
    const data = await loadAssessmentData(vb.token)
    expect(data).not.toBeNull()
    // No CrawlPage/Violation rows in this fixture → buildSummaryFromFindings
    // yields no commonIssues → empty patterns, not a throw.
    expect(data!.adaPatterns).toEqual([])
  })

  it('drops curated-set-external and zero-count finding types from seoIssues', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { liveScan: { findings: [
      { type: 'missing_title', count: 3 },
      { type: 'hreflang_conflict', count: 99 }, // not in the curated sets
      { type: 'thin_content', count: 0 },       // zero-count
    ] } })
    const data = await loadAssessmentData(vb.token)
    expect(data!.seoIssues).toEqual([{ label: 'Missing titles', count: 3, unit: 'pages' }])
    // pin the label to ONPAGE_FINDING_LABELS' real value while implementing
  })

  it('returns null for a revoked viewbook (controlled, no throw)', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { liveScan: {} })
    await prisma.viewbook.update({ where: { id: vb.id }, data: { revokedAt: new Date() } })
    expect(await loadAssessmentData(vb.token)).toBeNull()
  })

  it('resolves client-wide across domains and never leaks another client', async () => {
    const c = await mkClient('one.edu')
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { domain: 'one.edu', completedAt: new Date('2026-06-01T00:00:00Z') })
    await mkAudit(c.id, { domain: 'two.edu', completedAt: new Date('2026-07-03T00:00:00Z'), adaScore: 55 })
    const other = await mkClient('other.edu')
    await mkAudit(other.id, { domain: 'other.edu', completedAt: new Date('2026-07-10T00:00:00Z'), adaScore: 99 })
    const data = await loadAssessmentData(vb.token)
    expect(data!.domain).toBe('two.edu') // newest for THIS client, audited domain displayed
    expect(data!.adaScore).toBe(55)      // the other client's newer audit never leaks
  })

  it('aggregates CWV from 3+ lighthouse children and picks the homepage row', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    const audit = await mkAudit(c.id, { liveScan: {} })
    const lh = (performance: number, lcp: number) => JSON.stringify({
      scores: { performance },
      cwv: { lcp, cls: 0.05, tbt: 150, lcpStatus: 'pass', clsStatus: 'pass', tbtStatus: 'pass' },
    })
    // Provide every required AdaAudit scalar per prisma/schema.prisma —
    // check the model while implementing (url + status are required).
    await prisma.adaAudit.createMany({
      data: [
        { url: 'https://acme.edu/', status: 'complete', siteAuditId: audit.id, lighthouseSummary: lh(95, 1800) },
        { url: 'https://acme.edu/a', status: 'complete', siteAuditId: audit.id, lighthouseSummary: lh(60, 2500) },
        { url: 'https://acme.edu/b', status: 'complete', siteAuditId: audit.id, lighthouseSummary: lh(40, 4000) },
      ],
    })
    const data = await loadAssessmentData(vb.token)
    expect(data!.performance).not.toBeNull()
    expect(data!.performance!.measuredPages).toBe(3)
    expect(data!.homepage).not.toBeNull()
    expect(data!.homepage!.performance).toBe(95) // canonical root wins
  })
})
```

(The CWV test's child AdaAudit rows ride the audit cascade (`siteAuditId` FK) — verify the delete relation while implementing; if AdaAudit→SiteAudit is also `SetNull`, add an `adaAudit.deleteMany` line FIRST in the `afterAll`.)

Note: exact `standardLabel('wcag21aa')` wording — check `lib/sales/copy.ts:37` while implementing and pin the regex to its actual copy.

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/assessment.test.ts`
Expected: FAIL — `Cannot find module './assessment'`.

- [ ] **Step 3: Implement `lib/viewbook/assessment.ts`**

```ts
// PR5 Current-Site Assessment loader (spec §8): token → viewbook → client →
// latest REPORTABLE site audit (C14 rule: complete ∧ ¬seoOnly ∧ has a
// seo-parser run), derived into a client-safe payload. Read-only; every
// failure path returns null (fault isolation — the section renders the
// "first scan coming soon" state, the page never blanks).
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { HttpError } from '@/lib/api/errors'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { isPlaceholderRun } from '@/lib/findings/exhausted-placeholder'
import { buildSummaryFromFindings } from '@/lib/ada-audit/findings-fallback'
import { aggregatePerformance, pickHomepageCwv } from '@/lib/sales/cwv-aggregate'
import type { PerformanceRollup, HomepageCwv } from '@/lib/sales/cwv-aggregate'
import { standardLabel } from '@/lib/sales/copy'
import {
  ONPAGE_FINDING_LABELS, BROKEN_FINDING_LABELS,
  ONPAGE_FINDING_TYPE_SET, BROKEN_FINDING_TYPE_SET,
} from '@/lib/findings/finding-type-sets'
import type { SiteAuditSummary } from '@/lib/ada-audit/types'
import type { LighthouseSummary } from '@/lib/ada-audit/lighthouse-types'

const MAX_ADA_PATTERNS = 4
const MAX_SEO_ISSUES = 5
const IMPACT_RANK: Record<string, number> = { critical: 3, serious: 2, moderate: 1, minor: 0 }

export interface AssessmentAdaPattern { /* as in Interfaces block */ }
export interface AssessmentSeoIssue { /* as in Interfaces block */ }
export interface AssessmentData { /* as in Interfaces block */ }

function unitFor(type: string): AssessmentSeoIssue['unit'] {
  if (type.startsWith('broken_')) return 'targets'
  if (type.startsWith('duplicate_')) return 'groups'
  return 'pages'
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

export async function loadAssessmentData(token: string): Promise<AssessmentData | null> {
  try {
    const vb = await requireViewbookToken(token) // the ONE validator; throws HttpError(404) → controlled null below

    const audit = await prisma.siteAudit.findFirst({
      where: { clientId: vb.clientId, status: 'complete', seoOnly: false, crawlRuns: { some: { tool: 'seo-parser' } } },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    })
    if (!audit) return null

    const runs = await prisma.crawlRun.findMany({
      where: { siteAuditId: audit.id },
      select: { tool: true, source: true, score: true, findings: { where: { scope: 'run' }, select: { type: true, count: true } } },
    })
    const adaRun = runs.find((r) => r.tool === 'ada-audit') ?? null
    const seoRun = runs.find((r) => r.tool === 'seo-parser') ?? null
    const seoUnavailable = seoRun != null && isPlaceholderRun(seoRun)

    const seoIssues = seoRun && !seoUnavailable
      ? seoRun.findings
          .filter((f) => f.count > 0 && (ONPAGE_FINDING_TYPE_SET.has(f.type) || BROKEN_FINDING_TYPE_SET.has(f.type)))
          .sort((a, b) => b.count - a.count)
          .slice(0, MAX_SEO_ISSUES)
          .map((f) => ({
            label: ONPAGE_FINDING_LABELS[f.type] ?? BROKEN_FINDING_LABELS[f.type] ?? f.type,
            count: f.count,
            unit: unitFor(f.type),
          }))
      : []

    let summary = parseJson<SiteAuditSummary>(audit.summary)
    if (!summary) summary = await buildSummaryFromFindings(audit.id)
    const adaPatterns = [...(summary?.commonIssues ?? [])]
      .sort((a, b) => (IMPACT_RANK[b.impact] ?? 0) - (IMPACT_RANK[a.impact] ?? 0) || b.affectedPagesCount - a.affectedPagesCount)
      .slice(0, MAX_ADA_PATTERNS)
      .map((c) => ({ help: c.help, impact: c.impact, affectedPagesCount: c.affectedPagesCount, totalPagesScanned: c.totalPagesScanned }))

    const lhRows = (await prisma.adaAudit.findMany({
      where: { siteAuditId: audit.id, lighthouseSummary: { not: null } },
      select: { id: true, url: true, lighthouseSummary: true },
    }))
      .map((r) => ({ id: r.id, url: r.url, summary: parseJson<LighthouseSummary>(r.lighthouseSummary) }))
      .filter((r): r is { id: string; url: string; summary: LighthouseSummary } => r.summary != null)

    return {
      domain: audit.domain,
      completedAt: audit.completedAt?.toISOString() ?? null,
      standardTested: standardLabel(audit.wcagLevel),
      pagesAudited: audit.pagesComplete,
      adaScore: adaRun?.score ?? null,
      seoScore: seoUnavailable ? null : seoRun?.score ?? null,
      seoUnavailable,
      adaPatterns,
      seoIssues,
      performance: aggregatePerformance(lhRows),
      homepage: pickHomepageCwv(lhRows, audit.domain),
    }
  } catch (err) {
    if (!(err instanceof HttpError)) logError({ subsystem: 'viewbook', op: 'assessment-load' }, err)
    return null
  }
}
```

(Fill the three interface bodies verbatim from the Interfaces block. Check `AdaAudit.url` nullability in the schema while implementing — if nullable, filter `url != null` before the CWV calls. Verify the `logError` import path matches `lib/log`'s exports.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/assessment.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/viewbook/assessment.ts lib/viewbook/assessment.test.ts
git commit -m "feat(viewbook): PR5 assessment loader — latest reportable audit -> client-safe payload"
```

---

### Task 2: `Tooltip.tsx` — server-safe hover/focus tooltip

**Files:**
- Create: `components/viewbook/public/Tooltip.tsx`
- Test: `components/viewbook/public/Tooltip.test.tsx`

**Interfaces:**
- Produces: `Tooltip({ label, id, children? }: { label: string; id: string; children?: ReactNode })` — server component (no `'use client'`, no handlers); pure CSS `group-hover`/`focus-within` reveal; the bubble gets `id={id}` and the trigger `aria-describedby={id}` (Codex fix 6). When `children` is omitted renders a default keyboard-focusable ⓘ glyph; when children ARE supplied the component wraps them in a `tabIndex={0}` trigger span so keyboard focus always works (callers never have to remember focusability).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { Tooltip } from './Tooltip'

afterEach(cleanup)

describe('Tooltip', () => {
  it('renders the label in a tooltip role wired to a focusable default trigger', () => {
    render(<Tooltip id="tt-lab" label="Lab data explainer" />)
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('Lab data explainer')
    expect(tip.getAttribute('id')).toBe('tt-lab')
    const trigger = screen.getByText('ⓘ')
    expect(trigger.getAttribute('tabindex')).toBe('0')
    expect(trigger.getAttribute('aria-describedby')).toBe('tt-lab')
  })

  it('wraps provided children in a focusable described-by trigger', () => {
    render(<Tooltip id="tt-m" label="hint"><span>metric</span></Tooltip>)
    expect(screen.queryByText('ⓘ')).toBeNull()
    const wrapper = screen.getByText('metric').closest('[aria-describedby="tt-m"]')!
    expect(wrapper.getAttribute('tabindex')).toBe('0')
  })
})
```

(Plain `.textContent` assertions only — the repo does not load jest-dom matchers.)

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/viewbook/public/Tooltip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// PR5 (spec §8 "tooltips — marketing-exec depth"): pure-CSS tooltip, server
// component. Reveal on hover OR keyboard focus; no JS, no client bundle.
// The trigger is ALWAYS focusable and aria-describedby-wired here so callers
// can't ship a mouse-only tooltip (Codex fix 6).
import type { ReactNode } from 'react'

export function Tooltip({ label, id, children }: { label: string; id: string; children?: ReactNode }) {
  return (
    <span className="group relative inline-flex items-center">
      <span
        tabIndex={0}
        aria-describedby={id}
        className={children ? 'cursor-help outline-offset-2' : 'cursor-help select-none text-sm text-black/40 outline-offset-2'}
      >
        {children ?? 'ⓘ'}
      </span>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-lg bg-black/85 px-3 py-2 text-xs font-normal text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/viewbook/public/Tooltip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/Tooltip.tsx components/viewbook/public/Tooltip.test.tsx
git commit -m "feat(viewbook): PR5 pure-CSS Tooltip for public sections"
```

---

### Task 3: `AssessmentSection.tsx` — the real section

**Files:**
- Create: `components/viewbook/public/AssessmentSection.tsx`
- Test: `components/viewbook/public/AssessmentSection.test.tsx`

**Interfaces:**
- Consumes: `loadAssessmentData`/`AssessmentData` (Task 1), `Tooltip` (Task 2), `SectionShell`, `SECTION_TITLES`, `publicAssetUrl` (`./ThemeStyle`), `PublicSection`/`ViewbookPublicData` types.
- Produces: `async function AssessmentSection({ section, data, token }: { section: PublicSection; data: ViewbookPublicData; token: string })` — EXACT same props as `AssessmentPlaceholder` (Task 5 swaps the import).

**Render contract:**
- `const assessment = await loadAssessmentData(token)`.
- `assessment === null` → inside SectionShell, the placeholder's exact copy: "Your first site scan is coming soon — we'll publish your current-site assessment here."
- Otherwise, inside `SectionShell` with `summary` band (the CEO-skimmable line): big score numbers (ADA + SEO where present) + `Snapshot of {domain} · {pagesAudited} pages audited`.
- Detail blocks (all counts-only, no screenshots, no per-node data):
  1. Score tiles: "Accessibility {adaScore}/100 · measured against {standardTested}" and "SEO {seoScore}/100". EITHER score null → that tile shows "{Accessibility|SEO} details unavailable for this scan" — never a literal 0 and never `null/100` (Codex fix 2: the ADA tile needs this too — a dual-write failure legitimately nulls `adaScore`).
  2. "Accessibility patterns we found" — `adaPatterns` list: `{help}` + "{affectedPagesCount} of {totalPagesScanned} pages" + impact word. Empty → "No site-wide patterns detected in this scan."
  3. "SEO issues" — `seoIssues` list: `{label}: {count} {unit}`. Rendered only when non-empty.
  4. "Performance (Lighthouse lab test)" with `<Tooltip id="assessment-lab-tip" label="Lab measurements from Google Lighthouse under fixed test conditions — directional, not field data from real visitors." />`: homepage CWV numbers when `homepage` non-null (LCP s, CLS, TBT ms + performance score) and, when `performance` non-null, the ACTUAL rollup (Codex fix 3): median performance, `p75LcpMs` (rendered as seconds), `p75Cls`, `p75TbtMs`, over "{measuredPages} pages measured". Never worded as field data or a "Core Web Vitals pass". Both null → omit the block entirely.
  5. Operator narrative: `section.narrative` non-null → "What this means" heading + `whitespace-pre-line` paragraph.
  6. Footer line: "Scanned {fmtDate(completedAt)}" when set.
- No compliance claims anywhere; headings use `var(--vb-heading-font)`; accents use `--vb-*` vars (match DataSourceSection's styling idiom).

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import type { AssessmentData } from '@/lib/viewbook/assessment'

// vi.mock factories are HOISTED — a plain `const` here is a temporal-dead-zone
// ReferenceError (Codex fix 4; the repo has standing guard comments for this).
const { loadAssessmentData } = vi.hoisted(() => ({
  loadAssessmentData: vi.fn<(token: string) => Promise<AssessmentData | null>>(),
}))
vi.mock('@/lib/viewbook/assessment', () => ({ loadAssessmentData }))

import { AssessmentSection } from './AssessmentSection'

afterEach(() => { cleanup(); loadAssessmentData.mockReset() })

const section: PublicSection = { sectionKey: 'assessment', state: 'active', doneAt: null, introNote: null, narrative: 'It needs work.' }
const data = {
  clientName: 'Acme', kind: 'upgrade', welcomeNote: null, dataLockedAt: null,
  theme: DEFAULT_THEME, sections: [], fieldCategories: [], milestones: [],
  materials: [], global: { team: null, blocks: {} }, overrides: {},
} as ViewbookPublicData

const full: AssessmentData = {
  domain: 'acme.edu', completedAt: '2026-07-02T00:00:00.000Z',
  standardTested: 'WCAG 2.1 AA', pagesAudited: 12,
  adaScore: 82, seoScore: 74, seoUnavailable: false,
  adaPatterns: [{ help: 'Images missing alt text', impact: 'critical', affectedPagesCount: 8, totalPagesScanned: 12 }],
  seoIssues: [{ label: 'Broken internal links', count: 9, unit: 'targets' }],
  performance: null, homepage: null,
}

// Async server component: call it as a function, render the resolved JSX.
async function renderSection() {
  render(await AssessmentSection({ section, data, token: 'tok' }))
}

describe('AssessmentSection', () => {
  it('renders the coming-soon state when no assessment loads', async () => {
    loadAssessmentData.mockResolvedValue(null)
    await renderSection()
    expect(screen.getByText(/first site scan is coming soon/i)).toBeDefined()
  })

  it('renders scores, patterns, seo issues, and narrative', async () => {
    loadAssessmentData.mockResolvedValue(full)
    await renderSection()
    expect(screen.getAllByText(/82/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/74/).length).toBeGreaterThan(0)
    expect(screen.getByText(/WCAG 2\.1 AA/)).toBeDefined()
    expect(screen.getByText(/Images missing alt text/)).toBeDefined()
    expect(screen.getByText(/8 of 12 pages/)).toBeDefined()
    expect(screen.getByText(/Broken internal links/)).toBeDefined()
    expect(screen.getByText('It needs work.')).toBeDefined()
    expect(screen.queryByText(/Lighthouse lab test/)).toBeNull() // no perf data → block omitted
  })

  it('never renders a literal 0 for an unavailable SEO score', async () => {
    loadAssessmentData.mockResolvedValue({ ...full, seoScore: null, seoUnavailable: true, seoIssues: [] })
    await renderSection()
    expect(screen.getByText(/SEO details unavailable/i)).toBeDefined()
  })

  it('handles a null ADA score without rendering null/100 or 0', async () => {
    loadAssessmentData.mockResolvedValue({ ...full, adaScore: null, adaPatterns: [] })
    await renderSection()
    expect(screen.getByText(/Accessibility details unavailable/i)).toBeDefined()
    expect(screen.queryByText(/null\s*\/\s*100/)).toBeNull()
  })

  it('renders the p75 lab rollup when performance data exists', async () => {
    loadAssessmentData.mockResolvedValue({
      ...full,
      performance: {
        measuredPages: 3, medianPerformance: 60, p75LcpMs: 2500, p75Cls: 0.05,
        p75TbtMs: 150, pctPassing: 100, scoreBuckets: { good: 1, fair: 1, poor: 1 },
        worstPages: [{ url: 'https://acme.edu/b', performance: 40 }],
      },
      homepage: {
        performance: 95, lcpMs: 1800, cls: 0.05, tbtMs: 150,
        lcpStatus: 'pass', clsStatus: 'pass', tbtStatus: 'pass',
      },
    })
    await renderSection()
    expect(screen.getByText(/Lighthouse lab test/i)).toBeDefined()
    expect(screen.getByText(/3 pages measured/i)).toBeDefined()
    expect(screen.getAllByText(/2\.5\s*s/).length).toBeGreaterThan(0) // p75 LCP as seconds
  })
})
```

(Pin the `standardTested` fixture to the real `standardLabel('wcag21aa')` output once Task 1 landed.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/viewbook/public/AssessmentSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AssessmentSection.tsx`** per the render contract above (async server component; import `loadAssessmentData` from `@/lib/viewbook/assessment`; reuse the hero/SectionShell wiring verbatim from `AssessmentPlaceholder`; date formatting via the same `fmtDate` idiom as `DataSourceSection`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/viewbook/public/AssessmentSection.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/AssessmentSection.tsx components/viewbook/public/AssessmentSection.test.tsx
git commit -m "feat(viewbook): PR5 AssessmentSection — audit snapshot + narrative, fault-soft"
```

---

### Task 4: SectionShell polish (done-state animation + hero rendering)

**Files:**
- Modify: `components/viewbook/public/SectionShell.tsx`
- Test: `components/viewbook/public/SectionShell.test.tsx` (extend the existing suite)

**Interfaces:** props surface UNCHANGED (`{ section, title, heroUrl, summary?, children }`) — PR3's `DataSourceSection` and every other section keep rendering through it mid-flight.

**Polish contract:**
1. **Done state:** the ✓ badge gets a pop-in animation and the expanded body a fade-in. Keyframes ship inside the component (one `<style>` tag in the done branch — Tailwind has no built-in pop/fade keyframes and `tailwind.config` is out of scope). The body animation MUST be triggered by the open state — an inline animation on content inside an initially-closed `<details>` runs while hidden and is already finished when the user expands it (Codex fix 7) — and both animations respect `prefers-reduced-motion`:
   ```tsx
   <style>{`
     @keyframes vb-pop { 0% { transform: scale(0); } 70% { transform: scale(1.18); } 100% { transform: scale(1); } }
     @keyframes vb-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
     .vb-done-badge { animation: vb-pop 400ms ease-out both; }
     details[open] .vb-done-body { animation: vb-fade 250ms ease-out both; }
     @media (prefers-reduced-motion: reduce) {
       .vb-done-badge, details[open] .vb-done-body { animation: none; }
     }
   `}</style>
   ```
   Badge `<span>` gains `className={… + ' vb-done-badge'}`; the `<div className="space-y-6 px-5 pb-6">` body gains the `vb-done-body` class. No inline `animation` styles.
2. **Hero rendering:** when `heroUrl` is set, the band grows to `min-h-[38vh]` (stays `min-h-[30vh]` otherwise) and gains a brand-primary bottom fade for headline legibility above the photo:
   ```tsx
   {heroUrl && (
     <>
       {/* eslint-disable-next-line @next/next/no-img-element */}
       <img src={heroUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
       <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--vb-primary) 15%, transparent 70%)' }} />
     </>
   )}
   ```
   (Image opacity 30 → 40; the gradient guarantees the `--vb-on-primary` headline keeps sitting on effectively-primary pixels, preserving the theme's luminance contract.)
3. **Anchor offset:** both branches' `<section>` gain `scroll-mt-14` so ProgressNav jumps don't hide section tops under the sticky nav (verify the nav height class in `ViewbookShell.tsx` — read-only — and match it; adjust to `scroll-mt-16` if the nav is `h-16`).

- [ ] **Step 1: Extend the existing test file with failing assertions**

Append to `components/viewbook/public/SectionShell.test.tsx` (match its existing render idiom — read it first):

```tsx
it('PR5 polish: done badge animates and hero band renders the legibility gradient', () => {
  const { container } = render(
    <SectionShell
      section={{ sectionKey: 'welcome', state: 'done', doneAt: '2026-07-01T00:00:00.000Z', introNote: null, narrative: null }}
      title="Welcome"
      heroUrl={null}
    >
      <p>body</p>
    </SectionShell>,
  )
  expect(container.innerHTML).toContain('vb-pop')

  cleanup()
  const { container: c2 } = render(
    <SectionShell
      section={{ sectionKey: 'welcome', state: 'active', doneAt: null, introNote: null, narrative: null }}
      title="Welcome"
      heroUrl="/api/viewbook/tok/assets/hero.png"
    >
      <p>body</p>
    </SectionShell>,
  )
  expect(c2.innerHTML).toContain('linear-gradient(to top, var(--vb-primary)')
  expect(c2.innerHTML).toContain('scroll-mt-14')
})
```

- [ ] **Step 2: Run to verify the new assertions fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/viewbook/public/SectionShell.test.tsx`
Expected: the new test FAILS; pre-existing tests still pass.

- [ ] **Step 3: Apply the polish contract edits** (keep every existing class/var; additive only; update the header comment to note PR5 landed the polish pass).

- [ ] **Step 4: Run the component suite**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/viewbook/public/`
Expected: ALL pass (SectionShell, sections-read, sections-data, ThemeStyle, FeedbackThread, MaterialLinkForm, Tooltip, AssessmentSection).

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/SectionShell.tsx components/viewbook/public/SectionShell.test.tsx
git commit -m "feat(viewbook): PR5 SectionShell polish — done-state animation, hero gradient, scroll offset"
```

---

### Task 5: Page swap — AssessmentPlaceholder → AssessmentSection

**Files:**
- Modify: `app/(public)/viewbook/[token]/page.tsx`
- Delete: `components/viewbook/public/AssessmentPlaceholder.tsx` (only consumer is this mount; PR3/PR4 are forbidden from it)

**Interfaces:** Consumes `AssessmentSection` (Task 3 — identical props, so the swap is the import + the JSX tag + the comment).

- [ ] **Step 0: Record the deletion in the program map (Codex fix 8)**

In `docs/superpowers/plans/2026-07-15-client-viewbook-program.md`, PR5 entry of the file ownership map: append `D: components/viewbook/public/AssessmentPlaceholder.tsx` (the map is documented as exact — a deletion is a change of ownership and must be visible to the other lane).

- [ ] **Step 1: Swap the mount**

In `app/(public)/viewbook/[token]/page.tsx`: replace the `AssessmentPlaceholder` import with `import { AssessmentSection } from '@/components/viewbook/public/AssessmentSection'`; in the `case 'assessment':` branch drop the placeholder comment and return `<AssessmentSection {...props} />`.

- [ ] **Step 2: Delete the placeholder**

```bash
git rm components/viewbook/public/AssessmentPlaceholder.tsx
```

Then `grep -rn AssessmentPlaceholder --include='*.ts*' .` → expect zero hits.

- [ ] **Step 3: Full gates**

```bash
npx tsc --noEmit
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```

Expected: all green (full suite ~5,672+ tests; one unreproduced full-suite flake was seen in the PR4 lane — a red run is a red run, re-run only to collect evidence).

- [ ] **Step 4: Commit + push**

```bash
git add 'app/(public)/viewbook/[token]/page.tsx'
git commit -m "feat(viewbook): PR5 mount AssessmentSection, retire the placeholder"
git push -u origin feat/viewbook-pr5
```

---

### Task 6: Cross-review + PR

- [ ] **Step 1:** Run `/codex-review` (P1) on the branch diff vs `origin/main`; apply named fixes (each as its own commit), re-run gates on any code change.
- [ ] **Step 2:** Open the PR (`gh pr create`, base `main`, title `feat(viewbook): PR5 assessment section + polish`), body summarizing scope + gates. Do NOT merge until cross-review is clean and Kevin's lane rules are satisfied.
- [ ] **Step 3:** Update `docs/superpowers/todos/HANDOFF-client-viewbook.md` (PR5 state + PR3 lane status) per the docs protocol.

## Self-Review Notes

- Spec coverage: §8 assessment bullet (reportable rule, client-wide resolution, scores, top issues counts-only, CWV rollup, narrative, honest labels, coming-soon state) → Tasks 1+3; "hidden by default for new-build" already ships in PR1's seeding (verified `service.ts createViewbook`); §14 increment 5 polish (done-state animations, tooltips, section hero images) → Tasks 2+4; §12 assessment-loader tests → Task 1.
- The loader treats `isPlaceholderRun` as the single placeholder predicate; the sales-report `seoUnavailable` semantics are mirrored (ADA half still renders).
- No task touches PR3/PR4-owned files; `SectionShell` changes are additive with the props surface frozen.
