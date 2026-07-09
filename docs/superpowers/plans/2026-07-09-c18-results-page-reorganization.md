# C18 — Results-Page Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the full-audit results page into a shared header + Accessibility/SEO tabs, mature the site-wide-patterns cards into expandable element samples, surface the live SEO score in the clients view, and land C13 ride-alongs + the triage `checkedBy` SSO fix.

**Architecture:** A new client shell (`SiteAuditResultsShell`) owns tab state and renders a shared header (domain, ADA score, SEO score, export bar, diff panel) above two tab panels. The panels are pre-rendered **slots** passed down from the server page: the Accessibility slot is the existing `SiteAuditResultsView` (client), the SEO slot is the existing stack of six server-rendered SEO section components. Pattern element samples load lazily via a new cookie-gated bounded server route (one child audit per expand — never a fan-out). The public share page adopts the same shell, loading SEO data server-side (zero cookie-gated fetches), with pattern screenshots + element dropdowns omitted.

**Tech Stack:** Next.js 15 App Router (server + `'use client'` components), TypeScript, Tailwind (class-based dark mode), Prisma + SQLite, Vitest + Testing Library.

## Global Constraints

- **Dark mode on every element** — Tailwind `dark:` variants (`bg-white`→`dark:bg-navy-card`, `text-gray-*`→`dark:text-white/*`, `border-gray-*`→`dark:border-navy-border`, semantic colors→`dark:bg-{color}-500/{opacity}`). No hydration-mismatch patterns (SSR-safe; prefer `<details>`/URL-param state over post-mount reads).
- **New Tailwind classes must be reachable by the content globs** (the app's existing `components/**` / `app/**` globs already cover every file here).
- **`withRoute` + `parseJsonBody`** on any new API route; JSON parse only inside try/catch.
- **Array-form `$transaction([...])` only** — none needed here (all reads), but never introduce interactive transactions.
- **Never rely on `Class.name`/identifier names at runtime** — not applicable here, but no code is injected into audited pages in this plan.
- **Share view keeps its zero-cookie-gated-fetch rule** — all share data loads server-side; the cookie-gated screenshot route and `/api/site-audit/[id]/pattern-sample` are NEVER called in `shareMode`.
- **Gate commands** (run all three, green before PR):
  ```bash
  npx tsc --noEmit
  DATABASE_URL="file:./local-dev.db" npm test
  npm run build
  ```
- **WCAG label copy (verbatim):** `wcag21aa` → label "WCAG 2.1 AA" / badge "Required"; `wcag22aa` → label "+ Best Practices" / badge "Aspirational". Full header badge string: `wcag22aa` → "WCAG 2.1 AA + Best Practices", else "WCAG 2.1 AA".
- **seoOnly audits are unaffected** — they land on `/seo-audits/results/run/[liveScanRunId]` (C16/C17 routing). All work here is on the full-audit page `app/(app)/ada-audit/site/[id]/page.tsx` + its share twin. The seoOnly branch (`seo-only-view.ts`) stays where it is, BEFORE ADA summary resolution.

---

## Context the implementer needs (verified 2026-07-09)

**The SEO sections are already server-rendered, prop-driven components** (`components/site-audit/*`): `BrokenLinksSection`, `OnPageSeoSection`, `TechnicalSeoSection`, `DiscoveryCoverageSection`, `ReachabilitySection`, `ContentSimilaritySection`, plus `SeoPhaseBanner`. None fetches client-side. The tab split is therefore layout-only; the share view just needs the same server query added.

**`SiteAuditResultsView` is the Accessibility half only** — it does not render any SEO section. It owns the interactive scorecard→table filter state (`filterImpact`), so the scorecard stays inside it.

**Issue-1 root cause (evidence-backed, prod read-only query 2026-07-09):** of 38 completed bulk ADA audits from a queue-all, all 38 have an ADA score, all 38 have a live-scan SEO run, and 33 have a live SEO score (5 legitimately null — noindex/login-walled/<50% coverage). The SEO scan **already runs** for every bulk audit. The clients-view "Score" column reads only the `tool:'ada-audit'` CrawlRun score and never surfaces the live-scan SEO score. **Fix = surface the existing SEO score, not change what gets queued.** No bulk-queue behavior change.

**Element screenshots have a 24 h on-disk retention** (`SCREENSHOT_RETENTION_MS`) and the screenshot route is cookie-gated. So the pattern-sample screenshot is inherently best-effort — often absent even on non-pruned audits older than a day — and the `<img>` must hide itself on error (mirror `NodeScreenshot` in `AuditIssueCard.tsx:23-37`).

---

## File Structure

**New files:**
- `app/api/site-audit/[id]/pattern-sample/route.ts` — cookie-gated bounded loader: `(rule, page)` → the ONE representative child audit's nodes for that rule (archived-degraded). Responsibility: read-only extraction, no fan-out.
- `app/api/site-audit/[id]/pattern-sample/route.test.ts` — route tests (found / not-found / archived).
- `components/ada-audit/SiteAuditResultsShell.tsx` — client shell: shared header + Accessibility/SEO tab switcher + slot rendering. Responsibility: layout + tab state only (no data).
- `components/ada-audit/SiteAuditResultsShell.test.tsx` — tab switching + shareMode render.

**Modified files:**
- `app/api/site-audit/[id]/checks/route.ts` — `checkedBy` via `getOperatorLabel` (item 6).
- `app/api/site-audit/[id]/checks/route.test.ts` — SSO-branch coverage.
- `app/api/clients/audit-summary/route.ts` — also return `seoScore` (Issue 1).
- `lib/ada-audit/types.ts` — `ClientAuditSummary.latestSiteAudit.seoScore`.
- `components/ada-audit/ClientsAuditSummary.tsx` — SEO score column (Issue 1); remove "View queue" (Issue 4).
- `components/ada-audit/SiteAuditForm.tsx` — compact WCAG control under Accessibility (Issue 3); "includes SEO" copy (Issue 2).
- `components/ada-audit/SiteAuditPoller.tsx` — reword copy line (C13).
- `components/ada-audit/KnownLimitationsNotice.tsx` — collapse to `<details>` (C13).
- `components/ada-audit/CommonIssueCallout.tsx` — expandable cards + lazy sample; remove View-affected-pages CTA; `shareMode` prop.
- `components/ada-audit/SiteAuditResultsView.tsx` — drop header card (moves to shell), keep scorecard as a section, move triage toggle into Pages-with-Issues header, `PAGE_SIZE` 50→25.
- `components/ada-audit/SiteAuditResultsView.test.tsx` — update for the restructure.
- `app/(app)/ada-audit/site/[id]/page.tsx` — compose the shell (header data + exportBar/diffPanel slots + ADA/SEO slots).
- `app/(public)/ada-audit/site/share/[token]/page.tsx` — load SEO server-side + render the shell in shareMode.

---

## Task 1: Triage `checkedBy` SSO fix + tests

**Files:**
- Modify: `app/api/site-audit/[id]/checks/route.ts:3,38`
- Test: `app/api/site-audit/[id]/checks/route.test.ts`

**Interfaces:**
- Consumes: `getOperatorLabel(authCookieValue, operatorCookieValue): Promise<string|null>`, `AUTH_COOKIE_NAME`, `OPERATOR_NAME_COOKIE_NAME` from `@/lib/auth`; `createAuthCookieValue` (tests).
- Produces: nothing new; `PUT` still returns `{ checks }` where `checks[i].checkedBy` is the derived operator.

- [ ] **Step 1: Write the failing tests** — append to `app/api/site-audit/[id]/checks/route.test.ts`. Mirror `app/api/site-audit/route.requested-by.test.ts`. The checks route uses REAL Prisma (no auth mock today), so set `APP_AUTH_SECRET` and build a signed cookie:

```ts
import { createAuthCookieValue, AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME } from '@/lib/auth'

// at top-level (guard if the file already sets a secret):
const ORIG_SECRET = process.env.APP_AUTH_SECRET
beforeAll(() => { process.env.APP_AUTH_SECRET = 'test-auth-secret' })
afterAll(() => {
  if (ORIG_SECRET === undefined) delete process.env.APP_AUTH_SECRET
  else process.env.APP_AUTH_SECRET = ORIG_SECRET
})

function putReq(id: string, cookies: { session?: string; operator?: string }, body: object) {
  const headers = new Headers({ 'content-type': 'application/json' })
  const jar: string[] = []
  if (cookies.session) jar.push(`${AUTH_COOKIE_NAME}=${cookies.session}`)
  if (cookies.operator) jar.push(`${OPERATOR_NAME_COOKIE_NAME}=${cookies.operator}`)
  if (jar.length) headers.set('cookie', jar.join('; '))
  return new NextRequest(`http://localhost/api/site-audit/${id}/checks`, { method: 'PUT', headers, body: JSON.stringify(body) })
}

describe('PUT /api/site-audit/[id]/checks — checkedBy attribution (C18)', () => {
  const KEY = 'a'.repeat(64) // valid 64-char lowercase hex
  it('uses the verified session name over a stale legacy cookie', async () => {
    const audit = await makeAudit()
    const session = await createAuthCookieValue({ sub: 'google:1', email: 'kevin@enrollmentresources.com', hd: 'enrollmentresources.com', name: 'Kevin Vogelgesang' })
    const res = await PUT(putReq(audit.id, { session, operator: 'Stale Old Name' }, { scope: 'page', key: KEY, checked: true }), params(audit.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checks[0].checkedBy).toBe('Kevin Vogelgesang')
  })
  it('falls back to the legacy cookie when there is no session', async () => {
    const audit = await makeAudit()
    const res = await PUT(putReq(audit.id, { operator: '  Kevin  ' }, { scope: 'page', key: KEY, checked: true }), params(audit.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checks[0].checkedBy).toBe('Kevin')
  })
  it('writes null when neither cookie is present', async () => {
    const audit = await makeAudit()
    const res = await PUT(putReq(audit.id, {}, { scope: 'page', key: KEY, checked: true }), params(audit.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checks[0].checkedBy).toBeNull()
  })
})
```

> Reuse the file's existing `makeAudit()` and `params()` helpers (`params = (id) => ({ params: Promise.resolve({ id }) })`). Confirm `makeAudit()`'s row id prefix (`__a3sa__`) is still cleaned in `beforeEach`/`afterAll`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/\[id\]/checks/route.test.ts`
Expected: the new session/legacy tests FAIL (`checkedBy` is `null` because the route still reads only the legacy cookie).

- [ ] **Step 3: Implement the fix** — in `app/api/site-audit/[id]/checks/route.ts`:

Replace the import (line 3):
```ts
import { AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME, getOperatorLabel } from '@/lib/auth'
```
Replace line 38 (inside `PUT`; note the request param is named `req` here):
```ts
  const operator = await getOperatorLabel(
    req.cookies.get(AUTH_COOKIE_NAME)?.value,
    req.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value,
  )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/\[id\]/checks/route.test.ts`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add "app/api/site-audit/[id]/checks/route.ts" "app/api/site-audit/[id]/checks/route.test.ts"
git commit -m "fix(triage): derive site-audit checkedBy via SSO-aware getOperatorLabel (C18)"
```

---

## Task 2: Surface the live SEO score in the clients view + remove "View queue" (Issues 1 & 4)

**Files:**
- Modify: `lib/ada-audit/types.ts:268-275`
- Modify: `app/api/clients/audit-summary/route.ts`
- Modify: `components/ada-audit/ClientsAuditSummary.tsx`
- Test: `app/api/clients/audit-summary/route.test.ts` (create if absent)

**Interfaces:**
- Produces: `ClientAuditSummary.latestSiteAudit.seoScore: number | null` (the live-scan `CrawlRun.score`; null when unscoreable or no live run).

- [ ] **Step 1: Extend the type** — `lib/ada-audit/types.ts`, inside `latestSiteAudit` (after `score` on line 271):
```ts
    score: number | null
    seoScore: number | null           // live-scan CrawlRun.score (null = unscoreable / no live run)
```

- [ ] **Step 2: Write the failing route test** — create `app/api/clients/audit-summary/route.test.ts`. Mock `@/lib/db` so `client.findMany` returns one client and `siteAudit.findFirst` returns a completed non-seoOnly audit whose `crawlRuns` carry both an `ada-audit` score and a `live-scan` score:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db', () => ({ prisma: { client: { findMany: vi.fn() }, siteAudit: { findFirst: vi.fn() } } }))
const { prisma } = await import('@/lib/db')
const { GET } = await import('./route')

beforeEach(() => {
  vi.mocked(prisma.client.findMany).mockResolvedValue([{ id: 1, name: 'Acme', domains: '["acme.test"]' }] as never)
  vi.mocked(prisma.siteAudit.findFirst).mockResolvedValue({
    id: 'sa1', createdAt: new Date('2026-07-08T00:00:00Z'), pagesTotal: 10, pagesError: 0,
    wcagLevel: 'wcag21aa', summary: null,
    crawlRuns: [{ tool: 'ada-audit', source: 'ada-audit', score: 82 }, { tool: 'seo-parser', source: 'live-scan', score: 91 }],
  } as never)
})

it('returns both the ADA score and the live-scan SEO score', async () => {
  const res = await GET()
  const body = await res.json()
  expect(body[0].latestSiteAudit.score).toBe(82)
  expect(body[0].latestSiteAudit.seoScore).toBe(91)
})

it('seoScore is null when no live-scan run exists', async () => {
  vi.mocked(prisma.siteAudit.findFirst).mockResolvedValue({
    id: 'sa2', createdAt: new Date(), pagesTotal: 5, pagesError: 0, wcagLevel: 'wcag21aa', summary: null,
    crawlRuns: [{ tool: 'ada-audit', source: 'ada-audit', score: 70 }],
  } as never)
  const res = await GET()
  const body = await res.json()
  expect(body[0].latestSiteAudit.seoScore).toBeNull()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/clients/audit-summary/route.test.ts`
Expected: FAIL — `seoScore` undefined (and the mock's `crawlRuns` shape mismatches the current `where`-filtered select).

- [ ] **Step 4: Implement the route change** — `app/api/clients/audit-summary/route.ts`:

Broaden the select (replace the `crawlRuns` line inside `findFirst`):
```ts
          crawlRuns: { select: { tool: true, source: true, score: true } },
```
Replace the score-derivation block:
```ts
      let parsedSummary: SiteAuditSummary | null = null
      const adaRun = latest?.crawlRuns.find((r) => r.tool === 'ada-audit')
      // Codex #5: match BOTH tool and source, not source alone.
      const liveRun = latest?.crawlRuns.find((r) => r.tool === 'seo-parser' && r.source === 'live-scan')
      let score: number | null = adaRun?.score ?? null
      const seoScore: number | null = liveRun?.score ?? null
      if (latest?.summary) {
        try {
          parsedSummary = JSON.parse(latest.summary) as SiteAuditSummary
          const agg = parsedSummary?.aggregate
          if (score === null && agg) score = computeScoreFromCounts(agg, latest.wcagLevel).score
        } catch { parsedSummary = null }
      }
```
Add `seoScore` to the returned `latestSiteAudit` object (after `score,`):
```ts
          score,
          seoScore,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/clients/audit-summary/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the SEO column + remove "View queue" in `ClientsAuditSummary.tsx`**

Remove the "View queue →" `Link` (lines 245-250) from `trailing`. Keep the `Link` import (used elsewhere). Rename the accessibility column header "Score" → "Accessibility" and add an "SEO" header + cell.

In the `<thead>` header row, replace the single Score `<th>` (line 282) with two:
```tsx
            <th className="text-left px-6 py-2"><SortHeader label="Accessibility" ascKey="score-asc" descKey="score-desc" currentSort={sort} /></th>
            <th className="text-left px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">SEO</th>
```
Bump the `filtered` colspan (line 287) from `4` to `5`.

In the `<tbody>` row, replace the single Score `<td>` (lines 306-309) with:
```tsx
                <td className="px-6 py-3">
                  <ScoreBadge score={la?.score ?? null} />
                  <ChipForStatus status={inFlightByClient.get(c.clientId)} />
                </td>
                <td className="px-6 py-3">
                  <ScoreBadge score={la?.seoScore ?? null} />
                </td>
```

> Sorting stays on the accessibility score (existing `compareScore` reads `latestSiteAudit.score`) — no SEO sort added (YAGNI). `ScoreRing` already renders `null` as a dashed em-dash ring, so the 5 legitimately-unscoreable clients show "—" honestly.

- [ ] **Step 7: Verify gates for the touched files**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run app/api/clients/audit-summary/route.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/ada-audit/types.ts app/api/clients/audit-summary/ components/ada-audit/ClientsAuditSummary.tsx
git commit -m "feat(clients): surface live SEO score column; remove View-queue link (C18 Issues 1 & 4)"
```

---

## Task 3: SiteAuditForm — compact WCAG control + "includes SEO" copy (Issues 2 & 3)

**Files:**
- Modify: `components/ada-audit/SiteAuditForm.tsx`
- Test: `components/ada-audit/SiteAuditForm.test.tsx`

**Interfaces:** No prop/POST-body changes — `wcagLevel` state (line 68) and `intent` state (line 69) are unchanged; only the WCAG selector's markup and a helper line change.

- [ ] **Step 1: Write/extend failing tests** — in `SiteAuditForm.test.tsx`, assert (a) the SEO-inclusion copy is present when Accessibility is selected, and (b) the two WCAG options are still selectable and drive `wcagLevel` (query by accessible name / `aria-pressed`):

```tsx
it('states that Accessibility scans also run a live SEO scan', () => {
  render(<SiteAuditForm />)
  // Accessibility is the default intent
  expect(screen.getByText(/also run a full live SEO scan/i)).toBeInTheDocument()
})

it('keeps both WCAG levels selectable as a compact control', async () => {
  render(<SiteAuditForm />)
  const aspirational = screen.getByRole('button', { name: /Best Practices/i })
  expect(aspirational).toHaveAttribute('aria-pressed', 'false')
  await userEvent.click(aspirational)
  expect(aspirational).toHaveAttribute('aria-pressed', 'true')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditForm.test.tsx`
Expected: the SEO-copy test FAILS (no such text yet). The WCAG test may already pass against the old block — that's fine; it guards the behavior across the rewrite.

- [ ] **Step 3: Implement** — in `SiteAuditForm.tsx`:

Immediately after the Scan Type group's closing `</div>` (line 483), add the SEO-inclusion helper + the compact WCAG control, both gated on `intent === 'ada'`:
```tsx
        {intent === 'ada' && (
          <div className="space-y-2">
            <p className="text-[12px] font-body text-navy/50 dark:text-white/50">
              Accessibility scans also run a full live SEO scan (broken links + on-page SEO) — you get both reports.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span id="site-wcag-level-label" className="text-[12px] font-body text-navy/50 dark:text-white/50">WCAG level</span>
              <div role="group" aria-labelledby="site-wcag-level-label" className="inline-flex rounded-lg border border-gray-300 dark:border-navy-border overflow-hidden">
                {([
                  { value: 'wcag21aa', label: 'WCAG 2.1 AA', title: 'Required' },
                  { value: 'wcag22aa', label: '+ Best Practices', title: 'Aspirational' },
                ] as const).map(({ value, label, title }) => (
                  <button
                    key={value}
                    type="button"
                    title={title}
                    aria-pressed={wcagLevel === value}
                    onClick={() => setWcagLevel(value)}
                    disabled={isBusy}
                    className={`px-2.5 py-1 text-[12px] font-body transition-colors disabled:opacity-50 ${
                      wcagLevel === value
                        ? 'bg-orange/10 text-orange font-semibold'
                        : 'text-navy/60 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-navy-light'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
```

Delete the old standalone WCAG block (lines 505-534, the `{intent === 'ada' && ( <div> … WCAG Level heading … </div> )}` group). Leave the SF-upload section (485-503) and notify checkbox (536-542) intact.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/SiteAuditForm.tsx components/ada-audit/SiteAuditForm.test.tsx
git commit -m "feat(audit-form): compact WCAG control + explicit 'includes SEO' copy (C18 Issues 2 & 3)"
```

---

## Task 4: Ride-alongs — poller copy, KnownLimitations collapse, pagination 50→25 (C13)

**Files:**
- Modify: `components/ada-audit/SiteAuditPoller.tsx:259-261`
- Modify: `components/ada-audit/KnownLimitationsNotice.tsx`
- Modify: `components/ada-audit/SiteAuditResultsView.tsx:41`

- [ ] **Step 1: Reword the poller copy** — replace the static `<p>` (lines 259-261):
```tsx
          <p className="text-[12px] font-body text-navy/40 dark:text-white/40">
            Each page is scanned individually for accessibility and SEO. Large sites can take several minutes.
          </p>
```

- [ ] **Step 2: Collapse `KnownLimitationsNotice` into a `<details>`** — rewrite the component so the notice is collapsed by default (softer, SSR-safe, no post-mount state). Keep both `variant` copies. Replace the outer `<div>` with:
```tsx
export function KnownLimitationsNotice({ variant = 'single' }: { variant?: 'single' | 'site' }) {
  return (
    <details className="group px-4 py-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-[12px] font-body text-amber-800 dark:text-amber-400 leading-relaxed">
      <summary className="flex items-center gap-2 cursor-pointer list-none font-semibold">
        <svg className="w-4 h-4 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Known limitations
        <span className="ml-auto text-amber-500 transition-transform group-open:rotate-180" aria-hidden>▾</span>
      </summary>
      <div className="mt-2 pl-6">
        {variant === 'site' ? (
          <>Content behind login walls, scroll-triggered lazy loads, and interactive states (open modals, expanded accordions) may not be captured. Hover, focus, and other interactive states are not evaluated — CSS applied only via <code>:hover</code> or <code>:focus</code> pseudo-classes (e.g., underlines that appear on hover) are not visible to the scanner. WCAG requires links to be distinguishable without relying on interaction. Treat results as a starting point.</>
        ) : (
          <>This audit runs in a real browser and renders JavaScript, CSS, and fonts. However, content behind login walls, scroll-triggered lazy loads, and interactive states (open modals, expanded accordions) may not be captured. Treat results as a starting point, not a certification.</>
        )}
      </div>
    </details>
  )
}
```

- [ ] **Step 3: Pagination 50→25** — `SiteAuditResultsView.tsx:41`:
```ts
const PAGE_SIZE = 25
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditPoller.test.tsx components/ada-audit/SiteAuditResultsView.test.tsx`
Expected: PASS (fix any test that hard-asserted the old copy or a 50-row page; update those assertions to the new strings/size).

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/SiteAuditPoller.tsx components/ada-audit/KnownLimitationsNotice.tsx components/ada-audit/SiteAuditResultsView.tsx
git commit -m "chore(results): reword poller copy, collapse known-limitations, paginate at 25 (C13 ride-alongs)"
```

---

## Task 5: Bounded pattern-sample loader route

**Files:**
- Create: `app/api/site-audit/[id]/pattern-sample/route.ts`
- Test: `app/api/site-audit/[id]/pattern-sample/route.test.ts`

**Interfaces:**
- Produces: `GET /api/site-audit/[id]/pattern-sample?rule=<axeRuleId>&page=<exampleUrl>` →
  `{ found: boolean; childAuditId: string | null; archived: boolean; nodes: { html: string; target: string[]; screenshotPath: string | null }[] }`.
  Bounded: reads exactly ONE child audit (`@@unique([siteAuditId, url])`), caps nodes at `NODE_SAMPLE_CAP = 8`, dedupes by `target.join(' ')||html`. Archived (pruned blob) → `buildArchivedAxeResults(child.id)` → ≤5 nodes, no `screenshotPath`.
- Consumes: `withRoute`, `HttpError` (`@/lib/api`), `prisma`, `buildArchivedAxeResults` (`@/lib/ada-audit/findings-fallback`), `StoredAxeResults`/`AxeNode` (`@/lib/ada-audit/types`).

- [ ] **Step 1: Write the failing tests** — `app/api/site-audit/[id]/pattern-sample/route.test.ts`. Mock `@/lib/db` (`adaAudit.findUnique`) and `@/lib/ada-audit/findings-fallback` (`buildArchivedAxeResults`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/db', () => ({ prisma: { adaAudit: { findUnique: vi.fn() } } }))
vi.mock('@/lib/ada-audit/findings-fallback', () => ({ buildArchivedAxeResults: vi.fn() }))
const { prisma } = await import('@/lib/db')
const { buildArchivedAxeResults } = await import('@/lib/ada-audit/findings-fallback')
const { GET } = await import('./route')
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (id: string, qs: string) => new NextRequest(`http://localhost/api/site-audit/${id}/pattern-sample?${qs}`)

beforeEach(() => { vi.mocked(prisma.adaAudit.findUnique).mockReset(); vi.mocked(buildArchivedAxeResults).mockReset() })

it('400s when rule or page is missing', async () => {
  const res = await GET(req('sa1', 'rule=image-alt'), params('sa1'))
  expect(res.status).toBe(400)
})

it('extracts deduped nodes for the rule from the representative child blob', async () => {
  vi.mocked(prisma.adaAudit.findUnique).mockResolvedValue({
    id: 'child1',
    result: JSON.stringify({ violations: [{ id: 'image-alt', nodes: [
      { html: '<img>', target: ['img.a'], screenshotPath: 'image-alt-0.png' },
      { html: '<img>', target: ['img.a'] }, // dup of first by target
      { html: '<img2>', target: ['img.b'] },
    ] }] }),
  } as never)
  const res = await GET(req('sa1', 'rule=image-alt&page=' + encodeURIComponent('https://x.test/a')), params('sa1'))
  const body = await res.json()
  expect(body.found).toBe(true)
  expect(body.childAuditId).toBe('child1')
  expect(body.archived).toBe(false)
  expect(body.nodes).toHaveLength(2)
  expect(body.nodes[0].screenshotPath).toBe('image-alt-0.png')
})

it('degrades to the archived capped sample when the blob is pruned', async () => {
  vi.mocked(prisma.adaAudit.findUnique).mockResolvedValue({ id: 'child2', result: null } as never)
  vi.mocked(buildArchivedAxeResults).mockResolvedValue({
    archived: true,
    violations: [{ id: 'image-alt', nodes: [{ html: '<img>', target: ['img.a'] }] }],
  } as never)
  const res = await GET(req('sa1', 'rule=image-alt&page=' + encodeURIComponent('https://x.test/a')), params('sa1'))
  const body = await res.json()
  expect(body.archived).toBe(true)
  expect(body.nodes[0].screenshotPath).toBeNull()
})

it('found:false when no child page matches', async () => {
  vi.mocked(prisma.adaAudit.findUnique).mockResolvedValue(null as never)
  const res = await GET(req('sa1', 'rule=image-alt&page=' + encodeURIComponent('https://x.test/missing')), params('sa1'))
  const body = await res.json()
  expect(body.found).toBe(false)
  expect(body.nodes).toEqual([])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/\[id\]/pattern-sample/route.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the route** — `app/api/site-audit/[id]/pattern-sample/route.ts`:

```ts
// GET /api/site-audit/[id]/pattern-sample?rule=<axeRuleId>&page=<exampleUrl>
//
// C18 bounded loader for the site-wide-patterns dropdown. Resolves the
// pattern's ONE representative child audit (CommonIssue.examplePageUrl) and
// returns that page's nodes for the given rule. NEVER fans out across affected
// pages. Cookie-gated (authed only) — the share view omits the dropdown.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'   // Codex #2: no lib/api/index.ts — import from the module
import { HttpError } from '@/lib/api/errors'
import { prisma } from '@/lib/db'
import { buildArchivedAxeResults } from '@/lib/ada-audit/findings-fallback'
import type { StoredAxeResults, AxeNode } from '@/lib/ada-audit/types'

const NODE_SAMPLE_CAP = 8
const RULE_RE = /^[a-z0-9-]{1,64}$/i
const MAX_PAGE_LEN = 2048   // Codex #7: cap the user-supplied page before the indexed lookup

export const GET = withRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const rule = req.nextUrl.searchParams.get('rule')
  const page = req.nextUrl.searchParams.get('page')
  // Codex #2: HttpError takes (status, code) only — no third message arg.
  if (!rule || !page || !RULE_RE.test(rule) || page.length > MAX_PAGE_LEN) {
    throw new HttpError(400, 'invalid_request')
  }

  // ONE child row — compound unique scopes the lookup to this site audit, so
  // an attacker-supplied `page` can only ever read a page of THIS audit.
  const child = await prisma.adaAudit.findUnique({
    where: { siteAuditId_url: { siteAuditId: id, url: page } },
    select: { id: true, result: true },
  })
  if (!child) return NextResponse.json({ found: false, childAuditId: null, archived: false, nodes: [] })

  let stored: StoredAxeResults | null = null
  if (child.result) { try { stored = JSON.parse(child.result) as StoredAxeResults } catch { stored = null } }
  if (!stored) stored = await buildArchivedAxeResults(child.id) // pruned → capped no-image sample

  const violation = stored?.violations.find((v) => v.id === rule)
  const seen = new Set<string>()
  const nodes: { html: string; target: string[]; screenshotPath: string | null }[] = []
  for (const n of (violation?.nodes ?? []) as AxeNode[]) {
    const key = (n.target?.join(' ') || n.html || '').trim()
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    nodes.push({ html: n.html, target: n.target ?? [], screenshotPath: n.screenshotPath ?? null })
    if (nodes.length >= NODE_SAMPLE_CAP) break
  }

  return NextResponse.json({
    found: true,
    childAuditId: child.id,
    archived: stored?.archived ?? false,
    nodes,
  })
})
```

> This route lives under `/api/site-audit/…` — already cookie-gated by `middleware.ts` (not in `isPublicPath`). No middleware allowlist entry needed; do NOT add one (it must stay authed).

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/\[id\]/pattern-sample/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/site-audit/[id]/pattern-sample/"
git commit -m "feat(patterns): bounded pattern-sample loader route (C18)"
```

---

## Task 6: Expandable site-wide-pattern cards

**Files:**
- Modify: `components/ada-audit/CommonIssueCallout.tsx`
- Test: `components/ada-audit/CommonIssueCallout.test.tsx` (create)

**Interfaces:**
- Consumes: `GET /api/site-audit/[id]/pattern-sample` (Task 5).
- Produces: new `CommonIssueCallout` props `{ issues: CommonIssue[]; siteAuditId: string; shareMode?: boolean }` — the `onViewAffectedPages` prop is REMOVED (C13). Cards are expandable only when `!shareMode`.

- [ ] **Step 1: Write failing tests** — `CommonIssueCallout.test.tsx`. Mock `global.fetch`. Assert: (a) authed card shows an "expand" control and, on expand, fetches the sample route and renders node HTML; (b) in `shareMode` no expand control renders; (c) the "View affected pages →" text is gone:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CommonIssueCallout from './CommonIssueCallout'
import type { CommonIssue } from '@/lib/ada-audit/types'

const issue: CommonIssue = {
  ruleId: 'image-alt', impact: 'critical', help: 'Images must have alt text', description: '', helpUrl: 'https://x.test/rules/image-alt',
  affectedPagesCount: 4, totalPagesScanned: 10, sharedAncestor: null, ancestorConfidence: null,
  tier: 'template', canonicalSelector: 'img.logo', selectorConfidence: 0.9, examplePageUrl: 'https://x.test/a',
}

beforeEach(() => { vi.restoreAllMocks() })

it('never renders the removed "View affected pages" CTA', () => {
  render(<CommonIssueCallout issues={[issue]} siteAuditId="sa1" />)
  expect(screen.queryByText(/View affected pages/i)).toBeNull()
})

it('lazy-loads and shows the element sample on expand (authed)', async () => {
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    found: true, childAuditId: 'c1', archived: false,
    nodes: [{ html: '<img class="logo">', target: ['img.logo'], screenshotPath: 'image-alt-0.png' }],
  }), { status: 200 }))
  render(<CommonIssueCallout issues={[issue]} siteAuditId="sa1" />)
  await userEvent.click(screen.getByRole('button', { name: /affected elements/i }))
  await waitFor(() => expect(screen.getByText(/<img class="logo">/)).toBeInTheDocument())
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/site-audit/sa1/pattern-sample?rule=image-alt'))
})

it('omits the expand control in shareMode', () => {
  render(<CommonIssueCallout issues={[issue]} siteAuditId="sa1" shareMode />)
  expect(screen.queryByRole('button', { name: /affected elements/i })).toBeNull()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/CommonIssueCallout.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** — rewrite `CommonIssueCallout.tsx`:

Change `Props` and drop `onViewAffectedPages`:
```tsx
interface Props {
  issues: CommonIssue[]
  siteAuditId: string
  /** Public share view: cards are not expandable (the sample route is cookie-gated). */
  shareMode?: boolean
}
```
Add a small screenshot img that hides on error (mirror `AuditIssueCard`'s `NodeScreenshot`):
```tsx
function SampleScreenshot({ src }: { src: string }) {
  const [ok, setOk] = useState(true)
  if (!ok) return null
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" onError={() => setOk(false)} className="rounded border border-gray-200 dark:border-navy-border max-h-40" />
}

type SampleNode = { html: string; target: string[]; screenshotPath: string | null }
type SampleState = { loading: boolean; error: boolean; archived: boolean; childAuditId: string | null; nodes: SampleNode[] } | null
```
Rewrite `CommonIssueCard` to accept `{ issue, siteAuditId, expandable }`, hold `const [open, setOpen] = useState(false)` and `const [sample, setSample] = useState<SampleState>(null)`, and a loader:
```tsx
  const loadSample = async () => {
    if (sample) return
    setSample({ loading: true, error: false, archived: false, childAuditId: null, nodes: [] })
    try {
      const url = `/api/site-audit/${siteAuditId}/pattern-sample?rule=${encodeURIComponent(issue.ruleId)}&page=${encodeURIComponent(issue.examplePageUrl ?? '')}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { childAuditId: string | null; archived: boolean; nodes: SampleNode[] }
      setSample({ loading: false, error: false, archived: data.archived, childAuditId: data.childAuditId, nodes: data.nodes })
    } catch {
      setSample({ loading: false, error: true, archived: false, childAuditId: null, nodes: [] })
    }
  }
  const toggle = () => { const next = !open; setOpen(next); if (next) void loadSample() }
```
Replace the CTA row (old lines 130-150) with the expand toggle (only when `expandable && issue.examplePageUrl`) plus "Learn more ↗", then the dropdown body:
```tsx
          <div className="flex items-center gap-3 mt-2">
            {expandable && issue.examplePageUrl && (
              <button type="button" onClick={toggle} aria-expanded={open}
                className="text-[11px] font-body font-semibold text-orange hover:text-orange-light transition-colors">
                {open ? 'Hide affected elements' : 'Show affected elements'}
              </button>
            )}
            {helpHref && (
              <a href={helpHref} target="_blank" rel="noopener noreferrer"
                className="text-[11px] font-body text-navy/40 dark:text-white/40 hover:text-orange transition-colors">
                Learn more ↗
              </a>
            )}
          </div>
          {open && (
            <div className="mt-3 space-y-3">
              {sample?.loading && <p className="text-[11px] font-body text-navy/40 dark:text-white/40">Loading sample…</p>}
              {sample?.error && <p className="text-[11px] font-body text-red-500">Couldn’t load the element sample.</p>}
              {sample && !sample.loading && !sample.error && sample.nodes.length === 0 && (
                <p className="text-[11px] font-body text-navy/40 dark:text-white/40">No stored elements for this pattern.</p>
              )}
              {sample && sample.nodes.length > 0 && (
                <>
                  <p className="text-[11px] font-body text-navy/50 dark:text-white/50">
                    {sample.archived
                      ? 'Showing a capped element sample (full element list was pruned after 90 days; no screenshots).'
                      : `Sample of affected elements from ${(issue.examplePageUrl ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')}.`}
                  </p>
                  {sample.nodes.map((n, i) => (
                    <div key={i} className="space-y-1.5">
                      {!sample.archived && n.screenshotPath && sample.childAuditId && (
                        <SampleScreenshot src={`/api/ada-audit/screenshots/${sample.childAuditId}/${n.screenshotPath}`} />
                      )}
                      <pre className="text-[11px] font-mono bg-navy/[0.04] dark:bg-white/[0.04] rounded p-2 overflow-x-auto text-navy/80 dark:text-white/80">{n.html}</pre>
                      {n.target.length > 0 && <code className="text-[10px] font-mono text-orange">{n.target.join(' ')}</code>}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
```
Keep the existing CSS-selector line (old 108-129) as-is. In the default export, thread the new props to each card:
```tsx
export default function CommonIssueCallout({ issues, siteAuditId, shareMode = false }: Props) {
  ...
        {visible.map((issue) => (
          <CommonIssueCard key={issue.ruleId} issue={issue} siteAuditId={siteAuditId} expandable={!shareMode} />
        ))}
```
Update `CommonIssueCard`'s signature to `{ issue, siteAuditId, expandable }: { issue: CommonIssue; siteAuditId: string; expandable: boolean }`.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/CommonIssueCallout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/CommonIssueCallout.tsx components/ada-audit/CommonIssueCallout.test.tsx
git commit -m "feat(patterns): expandable pattern cards with bounded element sample (C18)"
```

---

## Task 7: Refactor SiteAuditResultsView (drop header, move triage, wire CommonIssueCallout)

**Files:**
- Modify: `components/ada-audit/SiteAuditResultsView.tsx`
- Modify: `components/ada-audit/SiteAuditResultsView.test.tsx`

**Interfaces:**
- Produces: `SiteAuditResultsView` props become `{ domain, summary, wcagLevel?, score?, compliant?, pdfs?, siteAuditId, shareMode?, scoreMeta? }` — the header-only props `clientName`, `createdAt`, `pagesTotal`, `pagesError` are REMOVED (the shared header in `SiteAuditResultsShell` owns them). `domain` stays (used by `PdfIssuesSection`).
- The interactive scorecard stays inside this component (its `handleScorecardImpactClick` drives the pages table filter). Triage toggle moves into the Pages-with-Issues section header. `CommonIssueCallout` now receives `siteAuditId` + `shareMode`.

- [ ] **Step 1: Update the test first** — in `SiteAuditResultsView.test.tsx`, remove any assertions on the domain title / date / pages-count header (now in the shell) and any props no longer passed; add/keep an assertion that the triage toggle renders in the Pages-with-Issues section (authed) and that `CommonIssueCallout` receives `siteAuditId`. Run it to see it fail against the current markup.

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditResultsView.test.tsx`
Expected: FAIL where the test now expects the new structure.

- [ ] **Step 2: Implement the refactor** — in `SiteAuditResultsView.tsx`:

**Props (lines 21-39):** remove `clientName`, `createdAt`, `pagesTotal`, `pagesError`. Keep the rest. Update the destructure (lines 55-58) accordingly and delete the now-unused `ClientDate` import (line 16) if nothing else uses it.

**Remove the `handleViewAffectedPages` wiring:** delete `handleViewAffectedPages` (lines 78-81) and the `selectedViolationId` state (line 74); pass `selectedViolationId={undefined}` to `GroupedViolationsView` (line 307) — or drop the prop if optional.

**Replace the whole Header block (lines 128-176)** with just the scorecard as a standalone card (no domain/meta/triage here):
```tsx
      {/* Scorecard */}
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
        <AuditScorecardComponent
          scorecard={summary.aggregate}
          score={score}
          compliant={compliant}
          wcagLevel={wcagLevel}
          archivedCounts={summary.archived ? summary.archivedCounts ?? { passed: null, incomplete: null } : undefined}
          onImpactClick={handleScorecardImpactClick}
          activeImpact={filterImpact}
          scoreMeta={scoreMeta}
        />
      </div>
```

**Add the triage toggle to the Pages-with-Issues section header** (lines 183-193). Add `ml-auto` triage button after the `<h2>`:
```tsx
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">
            Pages with Issues
            <span className="text-navy/40 dark:text-white/40 font-normal text-[14px] ml-2">{issuePages.length}</span>
          </h2>
          {!shareMode && (
            <button
              type="button"
              onClick={toggleTriage}
              className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-body font-semibold border rounded-lg transition-colors ${triageMode ? 'bg-orange/10 border-orange text-orange' : 'border-gray-300 dark:border-navy-border text-navy/60 dark:text-white/60 hover:border-orange hover:text-orange'}`}
            >
              {triageMode ? 'Triage on' : 'Triage off'}
            </button>
          )}
        </div>
```

**Update the `CommonIssueCallout` call (lines 196-201):**
```tsx
        {commonIssues.length > 0 && (
          <CommonIssueCallout issues={commonIssues} siteAuditId={siteAuditId} shareMode={shareMode} />
        )}
```

Leave `ComplianceBanner`, `ArchivedAuditBanner`, `KnownLimitationsNotice`, the toolbar, table, pagination, redirects, clean pages, and PDF sections in place (they are the Accessibility tab content).

- [ ] **Step 3: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditResultsView.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/SiteAuditResultsView.tsx components/ada-audit/SiteAuditResultsView.test.tsx
git commit -m "refactor(results): move header out of SiteAuditResultsView, triage into pages section (C18)"
```

---

## Task 8: SiteAuditResultsShell (shared header + tabs)

**Files:**
- Create: `components/ada-audit/SiteAuditResultsShell.tsx`
- Test: `components/ada-audit/SiteAuditResultsShell.test.tsx`

**Interfaces:**
- Produces:
```tsx
interface Props {
  domain: string
  clientName: string | null
  createdAt: string           // ISO
  pagesTotal: number
  pagesError: number
  wcagLevel?: string
  adaScore: number | null
  seoScore: number | null
  exportBar?: React.ReactNode // omitted in shareMode
  diffPanel?: React.ReactNode // null in shareMode
  accessibility: React.ReactNode
  seo: React.ReactNode
  shareMode?: boolean
}
```
- Consumes: `ScoreRing` (`@/components/ui/ScoreRing`), `ClientDate` (`@/components/ClientDate`), `useSearchParams`/`useRouter` (tab state, mirrors `AuditIndexTabs`).

- [ ] **Step 1: Write failing tests** — `SiteAuditResultsShell.test.tsx`. Wrap render so `useSearchParams` works (the repo's `AuditIndexTabs.test.tsx` shows the router-mock pattern — reuse it; C17 gotcha: the mocked router must be ONE stable object). Assert: Accessibility panel visible by default; clicking the SEO tab shows the SEO panel and hides the Accessibility panel; both score rings render; in `shareMode` the exportBar slot is not rendered.

```tsx
it('shows the Accessibility panel by default and switches to SEO on tab click', async () => {
  render(<SiteAuditResultsShell domain="x.test" clientName="Acme" createdAt={new Date().toISOString()}
    pagesTotal={10} pagesError={0} adaScore={82} seoScore={91}
    accessibility={<div>ADA-PANEL</div>} seo={<div>SEO-PANEL</div>} exportBar={<div>EXPORT</div>} />)
  expect(screen.getByText('ADA-PANEL')).toBeVisible()
  expect(screen.queryByText('SEO-PANEL')).toBeNull()
  await userEvent.click(screen.getByRole('tab', { name: /SEO/i }))
  expect(screen.getByText('SEO-PANEL')).toBeVisible()
})

it('omits the export bar in shareMode', () => {
  render(<SiteAuditResultsShell domain="x.test" clientName={null} createdAt={new Date().toISOString()}
    pagesTotal={1} pagesError={0} adaScore={null} seoScore={null}
    accessibility={<div>ADA</div>} seo={<div>SEO</div>} exportBar={<div>EXPORT</div>} shareMode />)
  expect(screen.queryByText('EXPORT')).toBeNull()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditResultsShell.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `SiteAuditResultsShell.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { ClientDate } from '@/components/ClientDate'

type ResultTab = 'accessibility' | 'seo'
function parseTab(v: string | null): ResultTab { return v === 'seo' ? 'seo' : 'accessibility' }

interface Props {
  domain: string
  clientName: string | null
  createdAt: string
  pagesTotal: number
  pagesError: number
  wcagLevel?: string
  adaScore: number | null
  seoScore: number | null
  exportBar?: React.ReactNode
  diffPanel?: React.ReactNode
  accessibility: React.ReactNode
  seo: React.ReactNode
  shareMode?: boolean
}

export default function SiteAuditResultsShell({
  domain, clientName, createdAt, pagesTotal, pagesError, wcagLevel,
  adaScore, seoScore, exportBar, diffPanel, accessibility, seo, shareMode = false,
}: Props) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [tab, setTab] = useState<ResultTab>(() => parseTab(searchParams.get('resultTab')))
  useEffect(() => { setTab(parseTab(searchParams.get('resultTab'))) }, [searchParams])

  const wcagLabel = wcagLevel === 'wcag22aa' ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'

  const selectTab = (next: ResultTab) => {
    setTab(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'accessibility') params.delete('resultTab')
    else params.set('resultTab', next)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  const tabBtn = (value: ResultTab, label: string) => (
    <button
      key={value}
      role="tab"
      aria-selected={tab === value}
      onClick={() => selectTab(value)}
      className={`px-4 py-1.5 text-[13px] font-body font-semibold rounded-md transition-colors ${
        tab === value
          ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
          : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-6">
      {/* Shared header */}
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm px-6 py-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">Site Audit — {domain}</h2>
              <span className="text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-navy/10 dark:bg-white/10 text-navy/50 dark:text-white/50">{wcagLabel}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {clientName && <span className="text-[12px] font-body text-navy/40 dark:text-white/40">{clientName}</span>}
              <span className="text-[12px] font-body text-navy/40 dark:text-white/40"><ClientDate iso={createdAt} variant="dateTime" /></span>
              <span className="text-[12px] font-body text-navy/40 dark:text-white/40">
                {pagesTotal} pages{pagesError > 0 && ` · ${pagesError} error${pagesError !== 1 ? 's' : ''}`}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="flex flex-col items-center gap-1">
              <ScoreRing score={adaScore} size={40} />
              <span className="text-[10px] font-body font-semibold uppercase tracking-wider text-navy/40 dark:text-white/40">Accessibility</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <ScoreRing score={seoScore} size={40} />
              <span className="text-[10px] font-body font-semibold uppercase tracking-wider text-navy/40 dark:text-white/40">SEO</span>
            </div>
          </div>
        </div>
        {/* Codex #1: export/diff hit cookie-gated routes — NEVER render in shareMode. */}
        {!shareMode && (exportBar || diffPanel) && (
          <div className="mt-4 space-y-4">
            {exportBar}
            {diffPanel}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Results section" className="inline-flex gap-0.5 bg-gray-100 dark:bg-navy-light rounded-lg p-0.5">
        {tabBtn('accessibility', 'Accessibility')}
        {tabBtn('seo', 'SEO')}
      </div>

      {/* Panel — conditional render (matches AuditIndexTabs's `{tab === … ? … : …}`
          pattern). Codex #3: `hidden`-class double-render keeps both in the DOM,
          which breaks the queryByText(null) test; conditional render is the
          idiom here. The Accessibility tab's client state (filter/pagination)
          resets on tab switch — acceptable, same as AuditIndexTabs. */}
      <div role="tabpanel">{tab === 'accessibility' ? accessibility : seo}</div>
    </div>
  )
}
```

> Confirm `ScoreRing` accepts `score: number | null` + `size` (it does — `ClientsAuditSummary` uses it) and renders a dashed em-dash ring for null.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditResultsShell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/SiteAuditResultsShell.tsx components/ada-audit/SiteAuditResultsShell.test.tsx
git commit -m "feat(results): shared header + Accessibility/SEO tab shell (C18)"
```

---

## Task 9: Wire the authed results page to the shell

**Files:**
- Modify: `app/(app)/ada-audit/site/[id]/page.tsx:270-314`

**Interfaces:** Consumes `SiteAuditResultsShell` (Task 8), `SiteAuditResultsView` (Task 7 signature), the six SEO sections + `SeoPhaseBanner`, `SiteAuditExportBar`, `SiteAuditDiffPanel`.

- [ ] **Step 1: Add the shell import** at the top of the file (alongside the other `@/components/ada-audit/*` imports):
```tsx
import SiteAuditResultsShell from '@/components/ada-audit/SiteAuditResultsShell'
```

- [ ] **Step 2: Replace the complete-path `return` (lines 270-313)** with the shell composition:
```tsx
  const seoContent = liveScanRun ? (
    <>
      <BrokenLinksSection run={liveScanRun} />
      <OnPageSeoSection
        run={liveScanRun}
        analyzed={onPageAnalyzed}
        score={liveScanRun?.score ?? null}
        observed={observedPages}
        indexable={indexablePages}
        attempted={audit.pagesTotal}
        breakdown={liveScanRun?.scoreBreakdown ?? null}
      />
      <TechnicalSeoSection run={liveScanRun} analyzed={onPageAnalyzed} />
      <DiscoveryCoverageSection run={liveScanRun} />
      <ReachabilitySection run={liveScanRun} />
      <ContentSimilaritySection run={liveScanRun} />
    </>
  ) : (
    <SeoPhaseBanner phase={seoPhase} />
  )

  const accessibilityContent = (
    <SiteAuditResultsView
      domain={audit.domain}
      summary={summary}
      wcagLevel={audit.wcagLevel}
      score={score}
      compliant={compliant}
      pdfs={pdfs}
      siteAuditId={audit.id}
      scoreMeta={{ version: scoreVersion, fromFallback: scoreFromFallback, passCount: sitePassCount, incompleteCount: siteIncompleteCount }}
    />
  )

  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      {breadcrumb}
      <SiteAuditResultsShell
        domain={audit.domain}
        clientName={audit.client?.name ?? null}
        createdAt={audit.createdAt.toISOString()}
        pagesTotal={audit.pagesTotal}
        pagesError={audit.pagesError}
        wcagLevel={audit.wcagLevel}
        adaScore={score}
        seoScore={liveScanRun?.score ?? null}
        exportBar={
          <SiteAuditExportBar
            siteAuditId={audit.id}
            hasPrevious={instanceDiff !== null}
            initialReportGeneratedAt={initialReportGeneratedAt}
          />
        }
        diffPanel={instanceDiff ? <SiteAuditDiffPanel diff={instanceDiff.diff} previous={instanceDiff.previous} /> : null}
        accessibility={accessibilityContent}
        seo={seoContent}
      />
    </main>
  )
```

> `score` may be `number` here (ADA path always resolves a number); `adaScore` prop is `number | null` — assignable. `liveScanRun?.score` is `number | null`.

- [ ] **Step 2b: Wrap the shell for `useSearchParams`** — `SiteAuditResultsShell` uses `useSearchParams`, which under Next 15 requires a `<Suspense>` boundary during static/prerender. This page is `force-dynamic`, but add a defensive boundary to avoid a build-time CSR-bailout error:
```tsx
import { Suspense } from 'react'
// ...wrap: <Suspense fallback={null}><SiteAuditResultsShell .../></Suspense>
```

- [ ] **Step 3: Verify build (the real test for this task)**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS, `/ada-audit/site/[id]` compiles. (`useSearchParams` CSR-bailout would surface here if the Suspense boundary is missing.)

- [ ] **Step 4: Update `page.fallback.test.tsx` (Codex #4)** — this test recurses only `props.children` (`app/(app)/ada-audit/site/[id]/page.fallback.test.tsx:84`) and asserts `SiteAuditResultsView` + `SiteAuditDiffPanel` render (`:101`, `:113`). After the refactor those components live in the shell's slot **props** (`accessibility`/`diffPanel`), not `children`, so the recursion misses them. Update the test's tree-walk to also traverse ReactNode-valued props (e.g. `accessibility`, `seo`, `exportBar`, `diffPanel`), or assert on the shell's props directly. Run:

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/(app)/ada-audit/site/[id]/page.fallback.test.tsx"`
Expected: PASS after the walk update.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/ada-audit/site/[id]/page.tsx" "app/(app)/ada-audit/site/[id]/page.fallback.test.tsx"
git commit -m "feat(results): compose authed results page into the tab shell (C18)"
```

---

## Task 10: Wire the share page to the shell (SEO loaded server-side, shareMode)

**Files:**
- Modify: `app/(public)/ada-audit/site/share/[token]/page.tsx`

**Interfaces:** Adds the seo-parser `crawlRun` query (mirrors the authed page) and renders `SiteAuditResultsShell` in `shareMode` with the SEO slot. Zero cookie-gated fetches: SEO sections are server components; pattern dropdowns are disabled via `shareMode`; screenshots (cookie-gated) never requested.

- [ ] **Step 1: Add imports** — the six SEO sections + `SeoPhaseBanner` (from `@/components/site-audit/*`), `SiteAuditResultsShell`, `Suspense`, `classifySeoPhase` + `getLatestSeoVerifyJob` (whatever the authed page imports for `seoPhase`).

- [ ] **Step 2: Add the SEO server query** after the ADA data loads (mirror authed page.tsx lines 217-242, using the share audit's `id`). **Codex #6: this query — and especially the `getLatestSeoVerifyJob` call, which reads internal job progress — MUST come AFTER the existing token status/expiry validation (`share/[token]/page.tsx:21`). Never move it above those guards.**
```tsx
  const liveScanRun = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: audit.id, tool: 'seo-parser' } },
    select: {
      id: true, status: true, score: true, scoreBreakdown: true,
      discoveryCoverageJson: true, reachabilityJson: true, contentSimilarityJson: true,
      findings: { select: { scope: true, type: true, count: true, url: true, detail: true } },
      pages: { select: { statusCode: true, indexable: true } },
    },
  })
  const observedPages = liveScanRun?.pages.filter((p) => p.statusCode != null).length ?? 0
  const indexablePages = liveScanRun?.pages.filter((p) => p.indexable === true).length ?? 0
  const onPageAnalyzed = observedPages > 0
  const seoPhase = liveScanRun
    ? ({ state: 'done', progress: null, message: null } as const)
    : classifySeoPhase({ liveScanRunId: null, job: await getLatestSeoVerifyJob(audit.id), completedAt: audit.completedAt })
```

- [ ] **Step 3: Build the SEO slot + render the shell in shareMode** — replace the current `<SiteAuditResultsView shareMode ... />` render (share page lines ~47-68) so the read-only header wrapper stays, then the shell:
```tsx
  const seoContent = liveScanRun ? (
    <>
      <BrokenLinksSection run={liveScanRun} />
      <OnPageSeoSection run={liveScanRun} analyzed={onPageAnalyzed} score={liveScanRun?.score ?? null} observed={observedPages} indexable={indexablePages} attempted={audit.pagesTotal} breakdown={liveScanRun?.scoreBreakdown ?? null} />
      <TechnicalSeoSection run={liveScanRun} analyzed={onPageAnalyzed} />
      <DiscoveryCoverageSection run={liveScanRun} />
      <ReachabilitySection run={liveScanRun} />
      <ContentSimilaritySection run={liveScanRun} />
    </>
  ) : (
    <SeoPhaseBanner phase={seoPhase} />
  )

  // ...inside the returned JSX, replacing the old <SiteAuditResultsView/>:
        <Suspense fallback={null}>
          <SiteAuditResultsShell
            domain={audit.domain}
            clientName={audit.client?.name ?? null}
            createdAt={audit.createdAt.toISOString()}
            pagesTotal={audit.pagesTotal}
            pagesError={audit.pagesError}
            wcagLevel={audit.wcagLevel}
            adaScore={score}
            seoScore={liveScanRun?.score ?? null}
            accessibility={
              <SiteAuditResultsView
                domain={audit.domain}
                summary={summary}
                wcagLevel={audit.wcagLevel}
                score={score}
                compliant={compliant}
                pdfs={pdfs}
                siteAuditId={audit.id}
                shareMode
                scoreMeta={/* keep the share page's existing scoreMeta object */}
              />
            }
            seo={seoContent}
            shareMode
          />
        </Suspense>
```

> `exportBar`/`diffPanel` are omitted (undefined) in share — the header renders without them. `shareMode` disables triage, checks, by-violation, and the pattern dropdowns; screenshots are never fetched. Keep the existing "Shared accessibility report — read-only" banner above the shell.

- [ ] **Step 4: Verify build + share route**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS; the public share route compiles.

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/ada-audit/site/share/[token]/page.tsx"
git commit -m "feat(share): tab shell + server-loaded SEO tab in read-only share view (C18)"
```

---

## Task 11: Full gate run + authed browser verification

- [ ] **Step 1: Full gates**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all green. Fix any component test elsewhere that referenced the old `SiteAuditResultsView` header props or the old `CommonIssueCallout` `onViewAffectedPages` prop.

- [ ] **Step 2: Authed browser verification** (dev server; house convention):

```bash
DATABASE_URL="file:./local-dev.db" NEXT_PUBLIC_APP_URL="http://localhost:3000" APP_AUTH_PASSWORD="" npm run dev
```
Verify against a completed **client** site audit already in the dev DB (never scan a non-client site):
- Results page shows the shared header (domain, both score rings, export bar, diff panel) + Accessibility/SEO tabs; `?resultTab=seo` deep-links to the SEO tab; switching tabs preserves table filter/pagination.
- Triage toggle now sits in the Pages-with-Issues header; toggling still gates the checkbox column.
- A site-wide pattern card expands and shows an element sample (screenshot when present within 24 h, HTML + selector always); older/pruned audit shows the capped no-image copy.
- Clients section: SEO score column populated for clients with a live-scan score, "—" for the unscoreable ones; no "View queue" link.
- Run-an-audit form: Accessibility shows the "also runs a live SEO scan" line + compact WCAG control; SEO hides them.
- Dark mode: toggle and re-check every new surface for contrast + no hydration warning in the console.
- Open the share URL in a logged-out browser: both tabs render, SEO sections present, pattern cards NOT expandable, no export bar, no console 401s.

- [ ] **Step 3: Commit any verification-driven fixes**, then proceed to PR (handled by the change-control ritual, not this plan).

---

## Self-Review (completed against the spec)

- **P3 layout (shared header + tabs):** Tasks 7–10. ✅
- **Share view same split, SEO server-loaded, screenshots/dropdowns omitted (Codex #11):** Task 10 + `shareMode` on `CommonIssueCallout` (Task 6). ✅
- **Triage moves into Pages-with-Issues header:** Task 7. ✅
- **Site-wide patterns matured — bounded loader, one representative page, no fan-out (Codex #10):** Task 5 (route reads ONE child via compound unique) + Task 6 (lazy per-card). ✅
- **Archived degradation to capped no-image sample with honest copy (Codex #12):** Task 5 (`buildArchivedAxeResults`) + Task 6 (archived copy, screenshots suppressed). ✅
- **"View affected pages →" removed (C13):** Task 6. ✅
- **C13 ride-alongs (poller copy, KnownLimitations, paginate 25):** Task 4. ✅
- **Triage `checkedBy` SSO fix + tests (item 6):** Task 1. ✅
- **Kevin Issue 1 (queue-all SEO):** root-caused to a display gap; Task 2 surfaces the existing live SEO score in the clients view (no bulk-queue change). ✅
- **Kevin Issue 2 (obvious SEO inclusion):** Task 3. ✅
- **Kevin Issue 3 (compact WCAG):** Task 3. ✅
- **Kevin Issue 4 (remove View queue):** Task 2. ✅
- **Out of scope (unchanged):** Bellus scorecard investigation (C13); seoOnly routing.

## Risks / notes
- The pattern-sample route reads a child blob per expand — bounded to ONE child, lazy, cookie-gated. It does NOT reintroduce blob loads into the page render (the page.tsx "no blobs on the site page" principle is preserved).
- Screenshots are best-effort (24 h retention + cookie-gated) — the sample `<img>` hides on error; copy never promises an image.
- `useSearchParams` in the shell needs a `<Suspense>` boundary at both page call sites (Tasks 9 & 10) to avoid a build-time CSR-bailout.
- Removing header-only props from `SiteAuditResultsView` touches both call sites (authed + share) — both are updated in Tasks 9 & 10; no other caller exists (grep `SiteAuditResultsView` to confirm before merging).
