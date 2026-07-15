# Independent Accessibility Check (IBM Equal Access / ACE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⚠️ GATE:** Phase 0 (Spike) is a hard gate. It resolves three unverified facts — the ACE policy string, the result object shape, and per-scan cost/behavior — that later phases depend on. **Do not start Phase 1 until Phase 0's findings are recorded** in `docs/superpowers/specs/2026-05-29-independent-a11y-check-design.md` (append a "Phase 0 findings" section). Where later phases say `ACE_POLICY` or reference the result path, use the Phase-0-confirmed value.

**Goal:** Add a genuinely independent (non-axe) accessibility check using IBM's ACE engine (`accessibility-checker-engine`, injected like axe), runnable on-demand as a tie-breaker, surfaced in a separate "Independent Review" block that never feeds the compliance score.

**Architecture:** Engine-only injection of `ace.js` into a fresh puppeteer-core page; a self-contained deep-check operation (navigate → axe snapshot → screenshots → ACE, strictly sequential on one page) driven by a dedicated low-concurrency queue; results persisted to a new `AdaIndependentCheck` table; an on-demand button plus a server-side auto-trigger when PSI-only a11y findings exist (reusing `splitPsiAccessibility` from the sibling feature).

**Tech Stack:** Next.js 15, TypeScript, Prisma + SQLite, puppeteer-core, `accessibility-checker-engine` (Apache-2.0), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-29-independent-a11y-check-design.md`
**Depends on:** `2026-05-29-psi-a11y-reframe.md` (the `splitPsiAccessibility` helper).

**Reviewed:** Codex (ACCEPT WITH NAMED FIXES) 2026-05-29 — fixes applied: DB-enforced atomic claim (partial unique index + P2002 catch, replacing `findFirst+create`), real fresh axe snapshot (violation IDs + wcagLevel + finalUrl + timestamp), PASS-outcome drop + XPath snippet `||` fallback, wrapped-summary `ruleArchive`/version handling, Phase-0 network/cost/DOM-mutation checks + no swallowed nav failures, single-self-contained-component UI ownership, guarded GET parse + POST eligibility (409), auto-trigger relocated to `route.ts:runAuditInBackground` (single-page PSI is inline, not via `lighthouse-queue`), stale-running recovery, `serverExternalPackages` note, claim-race tests.

---

## File Structure

- **Create** `lib/ada-audit/ace-runner.ts` — inject `ace.js`, run `ace.Checker().check`, tolerant parse, normalize (level→tier), resolve XPath→`{html,target}`.
- **Create** `lib/ada-audit/ace-types.ts` — `IndependentFinding`, `IndependentCheckResult`, tier enum.
- **Create** `lib/ada-audit/independent-check-orchestrator.ts` — deep-check operation + atomic status + the dedicated queue.
- **Create** `lib/ada-audit/independent-check-queue.ts` — small worker pool (cap `ACE_CONCURRENCY`, default 2).
- **Modify** `prisma/schema.prisma` — add `AdaIndependentCheck` model.
- **Create** `app/api/ada-audit/[id]/independent-check/route.ts` — POST (enqueue, atomic) + GET (poll).
- **Create** `components/ada-audit/IndependentCheckButton.tsx` + `IndependentCheckSection.tsx`.
- **Modify** `components/ada-audit/AuditResultsView.tsx` — render the button + section.
- **Modify** `lib/ada-audit/lighthouse-queue.ts` — server-side auto-trigger after PSI write.
- Tests alongside each `lib/` module.

---

## Phase 0 — Spike / Smoke test (GATE)

**Files:**
- Create (throwaway): `scripts/ace-spike.mjs`

- [ ] **Step 1: Install the engine-only package**

Run: `npm install accessibility-checker-engine`
Verify it pulled **no** browser binary: `ls node_modules/accessibility-checker-engine/` should show `ace.js`; `npm ls puppeteer chromedriver` should NOT list them as deps of this package.

- [ ] **Step 2: Write the spike script**

```js
// scripts/ace-spike.mjs  — THROWAWAY. Confirms policy string, result shape, cost.
import puppeteer from 'puppeteer-core'
import path from 'node:path'
const ACE = path.join(process.cwd(), 'node_modules/accessibility-checker-engine/ace.js')
const URLS = [
  'https://www.molloy.edu/certificates/program/online-marketing-certified-associate-omca-test-prep/',
  'https://example.com',
  // add: 3 clean, 3 known-bad, 2 consent-heavy client pages
]
const CHROME = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome'
const POLICIES = ['IBM_Accessibility', 'WCAG_2_1', 'WCAG_2_2'] // discover which the engine accepts
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
for (const url of URLS) {
  const page = await browser.newPage()
  const reqs = []
  page.on('request', r => reqs.push(r.url()))
  // Do NOT swallow navigation failures — a failed nav can leave about:blank and
  // make ACE "succeed" against nothing. Skip the page and record it.
  let resp = null
  try { resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }) }
  catch (e) { console.log(JSON.stringify({ url, navError: String(e) })); await page.close(); continue }
  if (!resp || !resp.ok()) { console.log(JSON.stringify({ url, navStatus: resp?.status() ?? null, skipped: true })); await page.close(); continue }

  // Baseline axe cost on the same page for an apples-to-apples comparison.
  const metaBefore = await page.metrics()
  const domBefore = await page.evaluate(() => document.querySelectorAll('*').length)

  await page.addScriptTag({ path: ACE })
  const preAceReqCount = reqs.length   // anything after this index is post-injection
  for (const policy of POLICIES) {
    const t0 = Date.now()
    const probe = await page.evaluate(async (p) => {
      try {
        const checker = new (window).ace.Checker()
        const r = await checker.check(document, [p])
        const results = r?.results ?? r?.report?.results ?? null
        return { ok: true, shape: r?.results ? 'r.results' : (r?.report?.results ? 'r.report.results' : 'unknown'),
                 count: results?.length ?? null, summary: r?.summary ?? r?.report?.summary ?? null,
                 levels: results ? [...new Set(results.map(x => x.level))] : null,
                 sampleValue: results?.[0]?.value ?? null, samplePath: results?.[0]?.path ?? null,
                 sample: results?.slice(0, 2) ?? null }
      } catch (e) { return { ok: false, error: String(e) } }
    }, policy)
    console.log(JSON.stringify({ url, policy, ms: Date.now() - t0, ...probe }, null, 2))
  }
  const metaAfter = await page.metrics()
  const domAfter = await page.evaluate(() => document.querySelectorAll('*').length)
  console.log(JSON.stringify({
    url,
    // Only requests issued AFTER ACE injection count as ACE network activity.
    aceNetworkRequests: reqs.slice(preAceReqCount),
    domMutatedByAce: domBefore !== domAfter, domBefore, domAfter,
    jsHeapDeltaMB: ((metaAfter.JSHeapUsedSize - metaBefore.JSHeapUsedSize) / 1e6).toFixed(1),
  }, null, 2))
  await page.close()
}
await browser.close()
```

- [ ] **Step 3: Run it (locally with a real Chrome path, and once on the server)**

Run: `CHROME_EXECUTABLE="$(which google-chrome || echo /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome)" node scripts/ace-spike.mjs`
Also run once on the production server (`ssh $PROD_SSH`) against `/usr/bin/google-chrome` to confirm prod parity.

- [ ] **Step 4: Record findings (GATE — must answer all)**

Append a "Phase 0 findings" section to the spec capturing:
1. **Which policy string the engine accepts** for WCAG 2.1 AA (and the resulting `summary.policies` / `summary.ruleArchive`). Set `ACE_POLICY` accordingly.
2. **Result shape** — `r.results` vs `r.report.results`; the exact `level` values observed; whether `value` is `[TYPE, OUTCOME]` as documented.
3. **No-network confirmation** — `aceNetworkRequests` (post-injection only) is empty.
4. **Cost** — `ms` per page, `jsHeapDeltaMB`; sanity that runtime is the same order as axe.
5. **No DOM mutation** — `domMutatedByAce` is false (ACE must not perturb the DOM screenshots/axe depend on).
6. **XPath/value samples** — confirm `samplePath.dom` is an XPath resolvable via `document.evaluate`, and `sampleValue` is the `[TYPE, OUTCOME]` 2-array.

- [ ] **Step 5: Commit the package + delete the spike**

```bash
rm scripts/ace-spike.mjs
git add package.json package-lock.json docs/superpowers/specs/2026-05-29-independent-a11y-check-design.md
git commit -m "chore(ada): add accessibility-checker-engine; record ACE Phase 0 findings"
```

> If Phase 0 shows ACE is materially slower than axe, makes network calls, or its findings are mostly noise on the calibration set, **STOP and revisit** with Kevin before Phase 1. The spec's smoke-test gate exists for exactly this.

---

## Phase 1 — Schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model**

```prisma
model AdaIndependentCheck {
  id            String    @id @default(cuid())
  adaAuditId    String
  adaAudit      AdaAudit  @relation(fields: [adaAuditId], references: [id], onDelete: Cascade)
  engine        String    // 'ibm-ace'
  engineVersion String?
  policy        String?
  ruleArchive   String?
  status        String    // 'running' | 'complete' | 'error'
  result        String?   // JSON: IndependentCheckResult
  freshRender   String?   // JSON: { axeViolationIds, domElementCount, finalUrl, timestamp }
  error         String?
  createdAt     DateTime  @default(now())
  completedAt   DateTime?

  @@index([adaAuditId])
}
```

Add the back-relation on `AdaAudit`: `independentChecks AdaIndependentCheck[]`.

- [ ] **Step 2: Migrate**

Run: `npx prisma migrate dev --name ada_independent_check`
Expected: migration created, client regenerated.

- [ ] **Step 3: Add a DB-enforced atomic-claim index (Codex fix)**

Prisma can't express a partial unique index, but the atomic claim in Phase 3 depends on one. Hand-edit the generated migration's `migration.sql` to append a SQLite **partial unique index** so the DB itself rejects a second concurrent running check per audit:

```sql
-- only one 'running' independent check per audit, enforced by the DB
CREATE UNIQUE INDEX "AdaIndependentCheck_one_running_per_audit"
  ON "AdaIndependentCheck" ("adaAuditId") WHERE "status" = 'running';
```

Re-run `npx prisma migrate dev` (or `prisma migrate reset` locally) so the index is applied. This is what makes `claimIndependentCheck` race-safe (catch `P2002`), not the application-level check.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(ada): AdaIndependentCheck table for independent a11y engine results"
```

---

## Phase 2 — ACE runner (inject, parse, map, resolve)

**Files:**
- Create: `lib/ada-audit/ace-types.ts`, `lib/ada-audit/ace-runner.ts`, `lib/ada-audit/ace-runner.test.ts`

- [ ] **Step 1: Types**

```ts
// lib/ada-audit/ace-types.ts
export type IndependentTier = 'violation' | 'potential' | 'recommendation'
export interface IndependentNode { html: string; target: string | null; xpath: string }
export interface IndependentFinding {
  ruleId: string; reasonId?: string; tier: IndependentTier
  message: string; nodes: IndependentNode[]
}
export interface IndependentCheckResult {
  engine: 'ibm-ace'; engineVersion: string | null; policy: string | null; ruleArchive: string | null
  findings: IndependentFinding[]      // violation/potential/recommendation
  manualReview: { ruleId: string; message: string }[]   // level === 'manual', never scored
}
```

- [ ] **Step 2: Write failing tests for the pure normalizer**

```ts
// lib/ada-audit/ace-runner.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeAceReport, tierForLevel } from './ace-runner'

describe('tierForLevel', () => {
  it('maps ACE levels to independent-review tiers (NOT axe severity)', () => {
    expect(tierForLevel('violation')).toBe('violation')
    expect(tierForLevel('potentialviolation')).toBe('potential')
    expect(tierForLevel('recommendation')).toBe('recommendation')
    expect(tierForLevel('potentialrecommendation')).toBe('recommendation')
    expect(tierForLevel('manual')).toBeNull()
    expect(tierForLevel('pass')).toBeNull()
  })
})

describe('normalizeAceReport', () => {
  const raw = {
    summary: { policies: ['WCAG_2_1'], ruleArchive: 'latest' },
    results: [
      { ruleId: 'WCAG20_Html_HasLang', level: 'violation', value: ['VIOLATION','FAIL'], message: 'No lang', snippet: '<html>', path: { dom: '/html[1]' } },
      { ruleId: 'X', level: 'manual', value: ['RECOMMENDATION','MANUAL'], message: 'check', snippet: '<a>', path: { dom: '/a' } },
      { ruleId: 'Y', level: 'pass', value: ['VIOLATION','PASS'], message: 'ok', snippet: '<b>', path: { dom: '/b' } },
    ],
  }
  it('tolerates r.results and drops pass; routes manual separately', () => {
    const out = normalizeAceReport(raw, 'v', new Map([['/html[1]', { html: '<html lang>', target: 'html' }]]))
    expect(out.findings.map(f => f.ruleId)).toEqual(['WCAG20_Html_HasLang'])
    expect(out.findings[0].tier).toBe('violation')
    expect(out.findings[0].nodes[0].target).toBe('html')
    expect(out.manualReview.map(m => m.ruleId)).toEqual(['X'])
  })
  it('tolerates r.report.results shape', () => {
    const wrapped = { report: { results: raw.results, summary: raw.summary } }
    expect(normalizeAceReport(wrapped, 'v', new Map()).findings.length).toBe(1)
  })
})
```

- [ ] **Step 3: Run, verify fail**

Run: `npx vitest run lib/ada-audit/ace-runner.test.ts` → FAIL (not defined).

- [ ] **Step 4: Implement the pure parts + the page-driving part**

```ts
// lib/ada-audit/ace-runner.ts
import type { Page } from 'puppeteer-core'
import path from 'path'
import type { IndependentCheckResult, IndependentTier, IndependentNode } from './ace-types'

const ACE_PATH = path.join(process.cwd(), 'node_modules/accessibility-checker-engine/ace.js')
// Set from Phase 0 findings. Do NOT assume — confirm the engine accepts it.
export const ACE_POLICY = process.env.ACE_POLICY ?? 'IBM_Accessibility'

export function tierForLevel(level: string): IndependentTier | null {
  switch (level) {
    case 'violation': return 'violation'
    case 'potentialviolation': return 'potential'
    case 'recommendation':
    case 'potentialrecommendation': return 'recommendation'
    default: return null // 'manual' (routed separately by caller), 'pass' (ignored)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeAceReport(raw: any, engineVersion: string | null,
  resolved: Map<string, { html: string; target: string | null }>): IndependentCheckResult {
  const results = raw?.results ?? raw?.report?.results ?? []
  const summary = raw?.summary ?? raw?.report?.summary ?? {}
  const findings: IndependentCheckResult['findings'] = []
  const manualReview: IndependentCheckResult['manualReview'] = []
  for (const r of results) {
    // Drop PASS outcomes regardless of level (value = [TYPE, OUTCOME]).
    if (Array.isArray(r?.value) && r.value[1] === 'PASS') continue
    if (r?.level === 'manual') { manualReview.push({ ruleId: r.ruleId, message: r.message ?? '' }); continue }
    const tier = tierForLevel(r?.level)
    if (!tier) continue
    const xpath = r?.path?.dom ?? ''
    const hit = resolved.get(xpath)
    // `||` not `??`: unresolved nodes store html:'' (empty string, not nullish),
    // so we must fall back to the ACE snippet when resolution failed.
    const node: IndependentNode = { html: hit?.html || r?.snippet || '', target: hit?.target ?? null, xpath }
    findings.push({ ruleId: r.ruleId, reasonId: r.reasonId, tier, message: r.message ?? '', nodes: [node] })
  }
  return {
    engine: 'ibm-ace', engineVersion,
    policy: Array.isArray(summary.policies) ? summary.policies.join(',') : (summary.policies ?? null),
    ruleArchive: summary.ruleArchive ?? null,
    findings, manualReview,
  }
}

// Runs ACE on an already-navigated page. Caller guarantees axe + screenshots
// already ran (ACE strictly last). Returns the raw report + per-xpath resolution.
export async function runAceOnPage(page: Page): Promise<{ raw: unknown; engineVersion: string | null;
  resolved: Map<string, { html: string; target: string | null }> }> {
  await page.addScriptTag({ path: ACE_PATH })
  const raw = await page.evaluate(async (policy) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checker = new (window as any).ace.Checker()
    return await checker.check(document, [policy])
  }, ACE_POLICY)
  // Resolve every XPath to {outerHTML, css selector} in-page, while DOM is live.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xpaths: string[] = [...new Set((((raw as any)?.results ?? (raw as any)?.report?.results ?? []) as any[])
    .map((r) => r?.path?.dom).filter(Boolean))]
  const resolvedArr = await page.evaluate((xs: string[]) => {
    function cssFor(el: Element): string | null {
      if (el.id) return `#${CSS.escape(el.id)}`
      const parts: string[] = []
      let cur: Element | null = el
      while (cur && cur.nodeType === 1 && parts.length < 6) {
        let sel = cur.tagName.toLowerCase()
        const p: Element | null = cur.parentElement
        if (p) { const sibs = [...p.children].filter(c => c.tagName === cur!.tagName); if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(cur) + 1})` }
        parts.unshift(sel); cur = p
      }
      return parts.length ? parts.join(' > ') : null
    }
    return xs.map((xp) => {
      try {
        const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element | null
        if (!el || el.nodeType !== 1) return [xp, { html: '', target: null }]
        return [xp, { html: el.outerHTML.slice(0, 2000), target: cssFor(el) }]
      } catch { return [xp, { html: '', target: null }] }
    })
  }, xpaths)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sum = (raw as any)?.summary ?? (raw as any)?.report?.summary ?? {}
  const engineVersion = sum?.ruleArchiveVersion ?? sum?.ruleArchive ?? null // confirm exact field in Phase 0
  await page.evaluate(() => { try { delete (window as any).ace } catch {} })
  return { raw, engineVersion, resolved: new Map(resolvedArr as [string, { html: string; target: string | null }][]) }
}
```

- [ ] **Step 5: Run tests, verify pass; type-check**

Run: `npx vitest run lib/ada-audit/ace-runner.test.ts && npx tsc --noEmit`
Expected: PASS. (Adjust `engineVersion`/`summary` field names to the Phase 0 findings if they differ.)

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/ace-types.ts lib/ada-audit/ace-runner.ts lib/ada-audit/ace-runner.test.ts
git commit -m "feat(ada): ACE runner — inject engine, tolerant parse, level→tier, xpath→node"
```

---

## Phase 3 — Deep-check orchestration + atomic status + queue

**Files:**
- Create: `lib/ada-audit/independent-check-queue.ts`, `lib/ada-audit/independent-check-orchestrator.ts`

- [ ] **Step 1: Atomic claim + orchestration**

```ts
// lib/ada-audit/independent-check-orchestrator.ts
import { prisma } from '@/lib/db'
import { acquirePage, releasePage } from './browser-pool'
import { gotoWithRetryOn5xx, postLoadSettle } from './page-load'
import { runAceOnPage, normalizeAceReport, ACE_POLICY } from './ace-runner'
import { assertSafeHttpUrl } from '../security/safe-url'

// DB-enforced atomic claim: the partial unique index (one 'running' row per
// audit) makes the INSERT itself the lock. Catch P2002 (unique violation) →
// a check is already running. Do NOT use findFirst+create (races across awaits).
export async function claimIndependentCheck(adaAuditId: string): Promise<string | null> {
  try {
    const row = await prisma.adaIndependentCheck.create({
      data: { adaAuditId, engine: 'ibm-ace', status: 'running' },
      select: { id: true },
    })
    return row.id
  } catch (err) {
    // Prisma P2002 = unique constraint failed (the partial 'running' index).
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') return null
    throw err
  }
}

// wcagLevel comes from the AdaAudit row so the fresh axe snapshot uses the SAME
// rule scope as the original audit (apples-to-apples).
export async function runIndependentCheck(checkId: string, adaAuditId: string, url: string, wcagLevel: string): Promise<void> {
  let page = null as Awaited<ReturnType<typeof acquirePage>> | null
  try {
    const parsed = await assertSafeHttpUrl(url)
    page = await acquirePage()
    await gotoWithRetryOn5xx(page, parsed.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 }, async () => {})
    await postLoadSettle(page)
    // FRESH axe snapshot for apples-to-apples comparison: same tag scope as the
    // original audit (mirror runner.ts wcagTags). Stores violation IDs + dom count.
    const path = await import('path')
    const AXE_PATH = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js')
    const wcagTags = wcagLevel === 'wcag22aa'
      ? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
      : ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
    await page.addScriptTag({ path: AXE_PATH })
    const freshAxe = await page.evaluate(async (tags: string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (window as any).axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'], reporter: 'no-passes', iframes: false })
      return {
        domElementCount: document.querySelectorAll('*').length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        axeViolationIds: (r.violations as any[]).map((v) => v.id),
      }
    }, wcagTags)
    const { raw, engineVersion, resolved } = await runAceOnPage(page) // ACE strictly last (after axe)
    const result = normalizeAceReport(raw, engineVersion, resolved)
    await prisma.adaIndependentCheck.update({
      where: { id: checkId },
      data: { status: 'complete', policy: ACE_POLICY, engineVersion, ruleArchive: result.ruleArchive,
        result: JSON.stringify(result),
        freshRender: JSON.stringify({ ...freshAxe, finalUrl: page.url(), wcagLevel, timestamp: new Date().toISOString() }),
        completedAt: new Date() },
    })
  } catch (err) {
    await prisma.adaIndependentCheck.update({
      where: { id: checkId },
      data: { status: 'error', error: err instanceof Error ? err.message : String(err), completedAt: new Date() },
    }).catch(() => {})
  } finally {
    if (page) await releasePage(page)
  }
}
```

```ts
// lib/ada-audit/independent-check-queue.ts — dedicated low-concurrency pool
import { runIndependentCheck } from './independent-check-orchestrator'
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.ACE_CONCURRENCY ?? '2', 10) || 2)
interface Job { checkId: string; adaAuditId: string; url: string; wcagLevel: string }
const queue: Job[] = []; let active = 0
export function enqueueIndependentCheck(job: Job): void { queue.push(job); pump() }
function pump(): void {
  while (active < CONCURRENCY && queue.length) {
    const job = queue.shift()!; active++
    void runIndependentCheck(job.checkId, job.adaAuditId, job.url, job.wcagLevel).finally(() => { active--; pump() })
  }
}
```

- [ ] **Step 2: Test the atomic claim**

```ts
// lib/ada-audit/independent-check-orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db', () => ({ prisma: { adaIndependentCheck: { create: vi.fn() } } }))
import { prisma } from '@/lib/db'
import { claimIndependentCheck } from './independent-check-orchestrator'

beforeEach(() => vi.clearAllMocks())
describe('claimIndependentCheck', () => {
  it('creates and returns id when none running', async () => {
    ;(prisma.adaIndependentCheck.create as any).mockResolvedValue({ id: 'new' })
    expect(await claimIndependentCheck('a1')).toBe('new')
  })
  it('returns null when the DB rejects a duplicate running row (P2002)', async () => {
    ;(prisma.adaIndependentCheck.create as any).mockRejectedValue({ code: 'P2002' })
    expect(await claimIndependentCheck('a1')).toBeNull()
  })
  it('rethrows non-P2002 errors', async () => {
    ;(prisma.adaIndependentCheck.create as any).mockRejectedValue({ code: 'P2010' })
    await expect(claimIndependentCheck('a1')).rejects.toBeTruthy()
  })
})
```

Run: `npx vitest run lib/ada-audit/independent-check-orchestrator.test.ts` → PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/independent-check-queue.ts lib/ada-audit/independent-check-orchestrator.ts lib/ada-audit/independent-check-orchestrator.test.ts
git commit -m "feat(ada): independent-check orchestration, atomic claim, dedicated queue"
```

---

## Phase 4 — API + UI

**Files:**
- Create: `app/api/ada-audit/[id]/independent-check/route.ts`
- Create: `components/ada-audit/IndependentCheckButton.tsx`, `components/ada-audit/IndependentCheckSection.tsx`
- Modify: `components/ada-audit/AuditResultsView.tsx`

- [ ] **Step 1: Route (POST enqueues atomically; GET polls)**

```ts
// app/api/ada-audit/[id]/independent-check/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { claimIndependentCheck } from '@/lib/ada-audit/independent-check-orchestrator'
import { enqueueIndependentCheck } from '@/lib/ada-audit/independent-check-queue'
export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const audit = await prisma.adaAudit.findUnique({ where: { id }, select: { url: true, status: true, result: true, wcagLevel: true } })
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  // Eligibility: only run ACE against a completed audit with a stored axe result.
  if (audit.status !== 'complete' || !audit.result) {
    return NextResponse.json({ error: 'Audit is not complete; nothing to independently check.' }, { status: 409 })
  }
  const checkId = await claimIndependentCheck(id)
  if (!checkId) return NextResponse.json({ status: 'running' }) // already in flight (DB-enforced)
  enqueueIndependentCheck({ checkId, adaAuditId: id, url: audit.url, wcagLevel: audit.wcagLevel })
  return NextResponse.json({ status: 'running', checkId })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await prisma.adaIndependentCheck.findFirst({
    where: { adaAuditId: id }, orderBy: { createdAt: 'desc' },
  })
  if (!row) return NextResponse.json({ status: null })
  let result = null
  if (row.result) { try { result = JSON.parse(row.result) } catch { result = null } } // guard corrupt JSON — never 500 the poll
  return NextResponse.json({ status: row.status, result, error: row.error ?? null })
}
```

- [ ] **Step 2: One self-contained component owns all state (Codex: clarify ownership)**

`IndependentCheckButton.tsx` is the **single owner** of the independent-check state. It does NOT hand result state up to a parent. Behavior:
- On mount, `GET /api/ada-audit/${auditId}/independent-check` once — if a prior check is `complete`, render its section immediately (so reopening the page shows past results); if `running`, start polling.
- On click, `POST` the same path; then poll `GET` every 2s until `status` is `complete`/`error`.
- It renders the result **inline beneath itself** via a private `IndependentCheckSection`. Model the button states on `components/ada-audit/ReScanButton.tsx`.

`IndependentCheckSection.tsx` renders findings grouped by tier (Violation / Needs review / Recommendation), each finding's `message` + node `html`/`target` (no screenshots in v1), plus a "Manual review needed" list, under a header:

```tsx
<div className="text-[12px] ...">Independent Review — IBM Equal Access. A different rule engine from our primary scan; informational, <strong>not part of the compliance score.</strong> Rule IDs differ across engines, so treat agreement/disagreement as a prompt to verify, not proof.</div>
```

- [ ] **Step 3: Mount in AuditResultsView (one component, one place)**

Mount **only** `<IndependentCheckButton auditId={auditId} />` (single-page, non-`readOnly` only), positioned where the Independent Review should appear — directly below `<LighthouseSection>` (around line 167). The button renders both its trigger and (once available) the section; AuditResultsView holds no independent-check state.

- [ ] **Step 4: Type-check + build + commit**

Run: `npx tsc --noEmit && npx next build`

```bash
git add app/api/ada-audit/[id]/independent-check components/ada-audit/IndependentCheckButton.tsx components/ada-audit/IndependentCheckSection.tsx components/ada-audit/AuditResultsView.tsx
git commit -m "feat(ada): independent-check API + on-demand deep-check button & section"
```

---

## Phase 5 — Server-side auto-trigger on PSI-only findings

**Files:**
- Modify: `app/api/ada-audit/route.ts` (`runAuditInBackground`)

**Why here, not `lighthouse-queue.ts` (Codex):** standalone single-page audits run PSI **inline** in `runAxeAudit` and are persisted in `runAuditInBackground`; the `lighthouse-queue` path is for **site-audit children** only. Auto-trigger for single-page audits therefore belongs in `runAuditInBackground`, where `axe` and `lighthouseSummary` are already in memory — no extra DB read. (Site-audit-child auto-trigger stays out of scope, honoring "off by default for site audits.")

- [ ] **Step 1: After the `complete` update, compute PSI-only in-memory and enqueue**

In `runAuditInBackground` (route.ts), immediately after the `prisma.adaAudit.update({ ... status: 'complete' ... })` for the `audited` branch, add (using the in-scope `axe`, `lighthouseSummary`, `id`, `url`, `wcagLevel`):

```ts
    // Auto-trigger the independent (IBM ACE) check when PSI flags a11y issues
    // our primary axe scan did not. Off by default until calibrated (Phase 0 +
    // human review). Best-effort — never fail the audit on trigger errors.
    if (process.env.ACE_AUTOTRIGGER === '1' && lighthouseSummary) {
      try {
        const ids = new Set<string>(axe.violations.map((v) => v.id))
        const { splitPsiAccessibility } = await import('@/lib/ada-audit/psi-a11y-split')
        if (splitPsiAccessibility(lighthouseSummary, ids).psiOnly.length > 0) {
          const { claimIndependentCheck } = await import('@/lib/ada-audit/independent-check-orchestrator')
          const { enqueueIndependentCheck } = await import('@/lib/ada-audit/independent-check-queue')
          const checkId = await claimIndependentCheck(id)
          if (checkId) enqueueIndependentCheck({ checkId, adaAuditId: id, url, wcagLevel })
        }
      } catch (e) { console.warn('[ace] auto-trigger skipped:', (e as Error).message) }
    }
```

Note: `lighthouseSummary` here is the parsed `LighthouseSummary` object from `runAxeAudit`'s result (not the stringified column) — pass it to `splitPsiAccessibility` directly.

- [ ] **Step 2: Type-check + commit**

```bash
git add app/api/ada-audit/route.ts
git commit -m "feat(ada): auto-trigger independent check on PSI-only a11y findings (single-page)"
```

---

## Phase 6 — Hardening & verification (Codex)

- [ ] **Stale-running recovery.** A process restart can leave an `AdaIndependentCheck` stuck in `running` (in-memory queue is wiped). Mirror the existing audit recovery: in `recoverQueue()` (startup) and `resetStaleAudits()` (the 10-min sweep) in `lib/ada-audit/queue-manager.ts`, flip `AdaIndependentCheck` rows in `running` older than the stale threshold to `error` (message: "interrupted by restart"). This also frees the partial-unique-index slot so a re-run can claim it.
- [ ] **Next bundling of the engine.** If `npx next build` complains about bundling `accessibility-checker-engine` (it's only read via `addScriptTag({ path })`, so it should stay external), add it to `serverExternalPackages` in `next.config.ts`. Confirm after Phase 0 install.
- [ ] `npx vitest run && npx tsc --noEmit && npx next build` — all green.
- [ ] Manual: click "Independent Check" on the Molloy audit; confirm it runs, renders the Independent Review block, and is clearly labeled not-scored.
- [ ] Confirm `ACE_AUTOTRIGGER` defaults off; enabling it on a single-page audit with a PSI-only finding auto-creates a check.
- [ ] Human-review the ACE findings on the calibration set before announcing the feature (spec smoke-test item 7).

---

## Self-Review (completed)

- **Spec coverage:** engine-only injection (Phase 2), on-demand button + server-side auto-trigger (Phase 4/5), sequential ACE-last on one page (Phase 3 orchestrator), separate `AdaIndependentCheck` table + atomic status (Phase 1/3), level→tier mapping never scored (Phase 2), tolerant parse + manual-review split (Phase 2), XPath→node resolution (Phase 2), dedicated low-concurrency queue (Phase 3), fresh-render metadata (Phase 3), v1 omits ACE screenshots (Phase 4), policy/shape/cost gated by Phase 0. ✓
- **Placeholders:** later phases intentionally reference `ACE_POLICY` and the Phase-0-confirmed result shape — this is the smoke-gate, not a placeholder; all code is concrete and the open values are isolated to named constants. ✓
- **Type consistency:** `IndependentCheckResult` / `IndependentFinding` / `IndependentTier` / `tierForLevel` / `normalizeAceReport` / `runAceOnPage` / `claimIndependentCheck` / `enqueueIndependentCheck` consistent across phases. ✓
- **Open dependency:** Phase 5 notes the single-page PSI path (inline vs queue) must be confirmed before wiring the trigger — flagged, not hidden.
