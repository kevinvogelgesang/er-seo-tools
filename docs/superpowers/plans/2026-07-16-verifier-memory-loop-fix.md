# Verifier Memory/Loop Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `runBrokenLinkVerify` memory-bounded and make verifier exhaustion terminal, so the 2026-07-16 OOM crash-loop class is impossible — unblocking the C21 deploy.

**Codex plan review (2026-07-16):** accept with named fixes — all applied below, marked "Codex plan-fix #N": #1 no re-expansion (weighted validation input, one shared array), #2 post-cap uniqueCount group counting + RSS-trip → null coverage/graph + partial run, #3 shared `isPlaceholderRun` + page-level SEO-unavailable branch + recents/seoOnly-early-branch coverage, #4 strict-prefix content budget + capped stub persisted when analyzers return null, #5 automated self-repair + notify-independence tests, #6 executable-detail corrections.

**Architecture:** Two independent fixes per the spec (`docs/superpowers/specs/2026-07-16-verifier-memory-loop-fix-design.md`): (1) an exhausted verifier durably publishes a minimal placeholder CrawlRun (`source: 'live-scan-placeholder'`) that breaks `recoverBrokenLinkVerifies`' predicate, with the recovery sweep itself as the self-repair path and every read surface treating the placeholder as "SEO analysis unavailable"; (2) the builder streams the HarvestedLink load into compact interned structures, bounds the content passes (similarity retention refactor, contentText byte budget, topic-overlap slice fix), and gates every optional pass on an injectable RSS guard. Measurement first: a profiling script produces before/after per-stage rss + wall-clock evidence.

**Tech Stack:** existing — Next.js 15 / Prisma + SQLite / vitest. No new dependencies. No schema migration.

## Global Constraints

- Array-form `$transaction([...])` ONLY; conditional logic as SQL `EXISTS`; raw SQL sets `updatedAt` manually (integer ms).
- `createMany` has no `skipDuplicates` on SQLite; chunk bulk inserts at 50.
- Never weaken `safeFetch`/SSRF guards; `lib/seo-fetch` is frozen — consume only.
- Builder happy-path output must be byte-identical (characterization-gated); analytics passes are fail-to-null and must NEVER fail the run write.
- New env vars are optional-with-defaults (no `instrumentation.ts` fail-fast additions).
- Tests: real `prisma` from `@/lib/db`, per-file unique `DOMAIN` constant, domain-scoped cleanup only (never blanket `deleteMany`); component tests `// @vitest-environment jsdom` + `afterEach(cleanup)`, no jest-dom.
- Never `git add -A` at repo root; stage explicit paths. No backticks in `-m` commit messages. No raw NUL bytes in source.
- Dark-mode `dark:` variants on every new UI element.
- Feature branch: `fix/verifier-memory-loop`.

---

### Task 1: Profiling script + baseline measurement

**Files:**
- Create: `scripts/profile-verifier-memory.ts`

**Interfaces:**
- Produces: a dev-only CLI (`DATABASE_URL="file:./local-dev.db" npx tsx scripts/profile-verifier-memory.ts [--pages 1000] [--links-per-page 300] [--text-kb 30]`) printing a per-stage table: `stage | rssMB | heapMB | elapsedMs`, plus `EXPLAIN QUERY PLAN` for the chunked HarvestedLink query. Never imported by app code.

No TDD cycle (dev tooling; verified by running it). Steps:

- [ ] **Step 1: Write the script**

```ts
// scripts/profile-verifier-memory.ts
// Dev-only: seeds a synthetic worst-case audit and profiles runBrokenLinkVerify
// stage-by-stage (rss/heap/elapsed via reportProgress checkpoints + a sampler).
// NEVER deployed / imported by app code. Usage:
//   DATABASE_URL="file:./local-dev.db" npx tsx scripts/profile-verifier-memory.ts
import { prisma } from '../lib/db'
import { runBrokenLinkVerify, type VerifyDeps } from '../lib/jobs/handlers/broken-link-verify'

const args = new Map(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter((p) => p.length) as [string, string][])
const PAGES = Number(args.get('pages') ?? 1000)
const LINKS = Number(args.get('links-per-page') ?? 300)
const TEXT_KB = Number(args.get('text-kb') ?? 30)
const DOMAIN = 'profile-verifier.example.com'

function mb(n: number): number { return Math.round(n / 1048576) }
const marks: { stage: string; rssMB: number; heapMB: number; at: number }[] = []
let peakRss = 0
function mark(stage: string): void {
  const m = process.memoryUsage()
  peakRss = Math.max(peakRss, m.rss)
  marks.push({ stage, rssMB: mb(m.rss), heapMB: mb(m.heapUsed), at: Date.now() })
}

async function seed(): Promise<string> {
  await cleanup()
  const urls = Array.from({ length: PAGES }, (_, i) => `https://${DOMAIN}/page-${String(i).padStart(4, '0')}`)
  const sa = await prisma.siteAudit.create({ data: {
    domain: DOMAIN, status: 'complete', pagesTotal: PAGES, pagesComplete: PAGES,
    discoveredUrls: JSON.stringify(urls), discoveryMode: 'sitemap',
  } })
  const text = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do '.repeat(Math.ceil((TEXT_KB * 1024) / 62)).slice(0, TEXT_KB * 1024)
  for (let i = 0; i < PAGES; i += 50) {
    await prisma.harvestedPageSeo.createMany({ data: urls.slice(i, i + 50).map((url, j) => ({
      siteAuditId: sa.id, url, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false,
      loginLike: false, title: `Title ${i + j}`, h1: `H1 ${i + j}`, metaDescription: `Meta ${i + j}`,
      wordCount: 5000, schemaCount: 1, canonicalUrl: url, detailsJson: null,
      contentText: `${text} page-variant-${i + j}`, contentTruncated: false,
    })) })
  }
  for (let i = 0; i < PAGES; i++) {
    const links = Array.from({ length: LINKS }, (_, k) => ({
      siteAuditId: sa.id, sourcePageUrl: urls[i],
      targetUrl: urls[(i * 7 + k) % PAGES], kind: 'internal-link', harvestTruncated: false,
    }))
    for (let c = 0; c < links.length; c += 50) await prisma.harvestedLink.createMany({ data: links.slice(c, c + 50) })
  }
  return sa.id
}

async function cleanup(): Promise<void> {
  const sas = await prisma.siteAudit.findMany({ where: { domain: DOMAIN }, select: { id: true } })
  const ids = sas.map((s) => s.id)
  if (!ids.length) return
  await prisma.harvestedLink.deleteMany({ where: { siteAuditId: { in: ids } } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAuditId: { in: ids } } })
  await prisma.crawlRun.deleteMany({ where: { siteAuditId: { in: ids } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: ids } } })
}

async function main(): Promise<void> {
  console.log(`[profile] seeding ${PAGES} pages x ${LINKS} links, ${TEXT_KB}KB text`)
  const id = await seed()
  const plan = await prisma.$queryRawUnsafe<unknown[]>(
    `EXPLAIN QUERY PLAN SELECT * FROM "HarvestedLink" WHERE "siteAuditId" = ? AND "kind" IN ('internal-link','image') ORDER BY "targetUrl" ASC, "kind" ASC, "sourcePageUrl" ASC, "id" ASC LIMIT 5000`, id)
  console.log('[profile] EXPLAIN QUERY PLAN:', JSON.stringify(plan))
  const deps: VerifyDeps = {
    resolve: async () => ({ result: 'ok', finalUrl: null, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
    resolveExternal: async () => ({ result: 'ok', finalUrl: null, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
    now: () => Date.now(), sleep: () => Promise.resolve(),
  }
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }, 100)
  mark('start')
  await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps, {
    reportProgress: (_p: number | null, msg: string | null) => { if (msg) mark(msg) },
  } as never)
  mark('end')
  clearInterval(sampler)
  const t0 = marks[0].at
  console.table(marks.map((m) => ({ stage: m.stage.slice(0, 48), rssMB: m.rssMB, heapMB: m.heapMB, elapsedMs: m.at - t0 })))
  console.log(`[profile] peak rss ${mb(peakRss)}MB (baseline ${marks[0].rssMB}MB, marginal ${mb(peakRss) - marks[0].rssMB}MB)`)
  await cleanup()
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
```

Note: `reportProgress` checkpoints are coarse (the builder reports during resolve + at "Building SEO report…"); the 100ms sampler catches the true peak. If stage attribution proves too coarse to identify the balloon, temporarily add `console.log('[profile-stage]', ...)` markers to a LOCAL copy of the builder while measuring — do not commit builder changes in this task.

- [ ] **Step 2: Run baseline** — `DATABASE_URL="file:./local-dev.db" npx tsx scripts/profile-verifier-memory.ts` (also once with `--pages 500 --links-per-page 150` to approximate the incident shape). Record: per-stage table, peak marginal rss, total wall-clock, EXPLAIN output. Save the output into the PR description draft (scratch note is fine for now).

- [ ] **Step 3: Commit**

```bash
git add scripts/profile-verifier-memory.ts
git commit -m "chore(verifier): add dev-only memory profiling script + baseline evidence"
```

---

### Task 2: `ensureExhaustedPlaceholder` + onExhausted wiring

**Files:**
- Create: `lib/findings/exhausted-placeholder.ts`
- Create: `lib/findings/exhausted-placeholder.test.ts`
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (`onBrokenLinkVerifyExhausted`, lines ~717-730)

**Interfaces:**
- Produces: `LIVE_SCAN_PLACEHOLDER_SOURCE = 'live-scan-placeholder'` (string const), `isPlaceholderRun(run: { source: string }): boolean` (Codex plan-fix #3 — THE one predicate every consumer uses; never inline source comparisons), `ensureExhaustedPlaceholder(siteAuditId: string): Promise<'created' | 'exists' | 'skipped' | 'failed'>`.

- [ ] **Step 1: Write the failing tests** (`lib/findings/exhausted-placeholder.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { ensureExhaustedPlaceholder, LIVE_SCAN_PLACEHOLDER_SOURCE } from './exhausted-placeholder'

const DOMAIN = 'exhausted-placeholder.test.example.com'

async function cleanup() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}
beforeEach(cleanup)
afterAll(cleanup)

describe('ensureExhaustedPlaceholder', () => {
  it('creates a minimal placeholder run for a complete audit', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', seoIntent: true } })
    expect(await ensureExhaustedPlaceholder(sa.id)).toBe('created')
    const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } } })
    expect(run).toMatchObject({
      source: LIVE_SCAN_PLACEHOLDER_SOURCE, status: 'partial', score: null,
      scoreBreakdown: null, pagesTotal: 0, seoIntent: false, domain: DOMAIN,
    })
    expect(run!.startedAt).not.toBeNull()
    expect(run!.completedAt).not.toBeNull()
  })

  it('is a no-op when a real run already exists (P2002 path)', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.crawlRun.create({ data: { tool: 'seo-parser', source: 'live-scan', status: 'complete', siteAuditId: sa.id, domain: DOMAIN } })
    expect(await ensureExhaustedPlaceholder(sa.id)).toBe('exists')
    const runs = await prisma.crawlRun.findMany({ where: { siteAuditId: sa.id, tool: 'seo-parser' } })
    expect(runs).toHaveLength(1)
    expect(runs[0].source).toBe('live-scan')
  })

  it('skips a deleted audit and never throws', async () => {
    expect(await ensureExhaustedPlaceholder('nonexistent-id')).toBe('skipped')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/exhausted-placeholder.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** (`lib/findings/exhausted-placeholder.ts`)

```ts
// lib/findings/exhausted-placeholder.ts
//
// Codex #1/#2 (verifier memory/loop fix spec §3): the durable terminality
// marker for an exhausted broken-link verifier. A minimal CrawlRun with the
// distinct 'live-scan-placeholder' source breaks recoverBrokenLinkVerifies'
// predicate (which only requires tool:'seo-parser') so a repeatedly-dying
// verifier can never re-enqueue, while staying invisible to canonical
// selection (source !== 'live-scan', seoIntent false) and honest on read
// surfaces (consumers check the source and render "SEO analysis unavailable").
// Direct create, NOT writeFindingsRun — its delete-and-recreate would clobber
// a real run racing in; the @@unique([siteAuditId, tool]) P2002 is the fence.
// NEVER throws (called from onExhausted and the recovery sweep).
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'

export const LIVE_SCAN_PLACEHOLDER_SOURCE = 'live-scan-placeholder'

/** Codex plan-fix #3: the ONE placeholder predicate. Every read surface uses
 * this — never an inline source comparison. */
export function isPlaceholderRun(run: { source: string }): boolean {
  return run.source === LIVE_SCAN_PLACEHOLDER_SOURCE
}

export type PlaceholderOutcome = 'created' | 'exists' | 'skipped' | 'failed'

export async function ensureExhaustedPlaceholder(siteAuditId: string): Promise<PlaceholderOutcome> {
  try {
    const site = await prisma.siteAudit.findUnique({
      where: { id: siteAuditId },
      select: { id: true, domain: true, clientId: true },
    })
    if (!site) return 'skipped' // deleted audit — nothing to mark terminal
    const now = new Date()
    await prisma.crawlRun.create({ data: {
      tool: 'seo-parser', source: LIVE_SCAN_PLACEHOLDER_SOURCE, status: 'partial',
      siteAuditId: site.id, domain: site.domain, clientId: site.clientId,
      seoIntent: false, pagesTotal: 0, startedAt: now, completedAt: now,
    } })
    console.warn(`[broken-link-verify] wrote exhausted placeholder run for ${siteAuditId}`)
    return 'created'
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'exists'
    console.error('[broken-link-verify] placeholder write failed for', siteAuditId, err)
    return 'failed'
  }
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Wire into `onBrokenLinkVerifyExhausted`** — placeholder BEFORE notify, independent catches. Replace the function body in `lib/jobs/handlers/broken-link-verify.ts`:

```ts
export async function onBrokenLinkVerifyExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  console.warn(`[broken-link-verify] exhausted after ${ctx.attempts} attempts: ${ctx.lastError}`)
  const p = payload as { siteAuditId?: string } | null
  if (!p?.siteAuditId) return
  // Spec §3.1 (Codex): terminality FIRST, notify second, independent catches —
  // a notify failure must never prevent the placeholder (and vice versa).
  // ensureExhaustedPlaceholder never throws by contract.
  await ensureExhaustedPlaceholder(p.siteAuditId)
  // D7: the parent SiteAudit is already terminal 'complete' at this point (verify
  // is enqueued post-terminal), so still send the completion email. The content
  // builder treats a placeholder run as a missing SEO run. Never throw from onExhausted.
  const row = await prisma.siteAudit
    .findUnique({ where: { id: p.siteAuditId }, select: { notifyEmail: true, notifyCompleteSentAt: true } })
    .catch(() => null)
  if (row?.notifyEmail && !row.notifyCompleteSentAt) {
    try { await enqueueNotifyEmail(p.siteAuditId, 'complete') } catch { /* never throw from onExhausted */ }
  }
}
```

Add the import: `import { ensureExhaustedPlaceholder } from '@/lib/findings/exhausted-placeholder'`.

- [ ] **Step 6: Add onExhausted tests** to `lib/findings/exhausted-placeholder.test.ts` (or a new `describe` in the existing `lib/jobs/handlers/broken-link-verify.test.ts` if it already covers onExhausted — check first):
  1. a complete audit with no run → call `onBrokenLinkVerifyExhausted({ siteAuditId }, { jobId: 'x', attempts: 2, lastError: 'oom' })` → placeholder run exists after;
  2. **Codex plan-fix #5 — notify independence:** `vi.spyOn(prisma.crawlRun, 'create').mockRejectedValueOnce(new Error('db down'))` (non-P2002) + audit with `notifyEmail` set and no sent-marker → `onBrokenLinkVerifyExhausted` still enqueues the notify-email job (assert the `notify-email` Job row exists) and does not throw.

  Run → PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/findings/exhausted-placeholder.ts lib/findings/exhausted-placeholder.test.ts lib/jobs/handlers/broken-link-verify.ts
git commit -m "fix(verifier): exhausted verifier writes terminal placeholder run (loop fix part 1)"
```

---

### Task 3: Recovery self-repair fence

**Files:**
- Modify: `lib/ada-audit/broken-link-recovery.ts` (per-id loop, after the `activeJob` check)
- Modify: `lib/ada-audit/broken-link-recovery.test.ts`

**Interfaces:**
- Consumes: `ensureExhaustedPlaceholder` from Task 2.

- [ ] **Step 1: Write failing tests** (append to `broken-link-recovery.test.ts`, reusing its `DOMAIN`/cleanup conventions):

```ts
it('does not re-enqueue when a terminal errored verifier exists; repairs the placeholder instead', async () => {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
  await prisma.harvestedLink.create({ data: { siteAuditId: sa.id, sourcePageUrl: `https://${DOMAIN}/`, targetUrl: `https://${DOMAIN}/a`, kind: 'internal-link' } })
  await prisma.job.create({ data: {
    type: 'broken-link-verify', status: 'error', attempts: 2, maxAttempts: 2,
    payload: JSON.stringify({ siteAuditId: sa.id, domain: DOMAIN }),
    groupKey: `site-audit:${sa.id}`, dedupKey: null,
  } })
  const n = await recoverBrokenLinkVerifies()
  expect(n).toBe(0)
  const jobs = await prisma.job.findMany({ where: { groupKey: `site-audit:${sa.id}`, status: { in: ['queued', 'running'] } } })
  expect(jobs).toHaveLength(0) // no fresh verifier
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } } })
  expect(run?.source).toBe('live-scan-placeholder') // placeholder repaired by the sweep
  // Codex plan-fix #5: this arrange (errored job + no run) IS the failed-hook
  // state — the sweep is the self-repair. Prove idempotence with a second pass:
  expect(await recoverBrokenLinkVerifies()).toBe(0)
  const runs = await prisma.crawlRun.findMany({ where: { siteAuditId: sa.id, tool: 'seo-parser' } })
  expect(runs).toHaveLength(1)
})

it('still prefers an ACTIVE job over the errored-job fence', async () => {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
  await prisma.harvestedLink.create({ data: { siteAuditId: sa.id, sourcePageUrl: `https://${DOMAIN}/`, targetUrl: `https://${DOMAIN}/a`, kind: 'internal-link' } })
  await prisma.job.create({ data: { type: 'broken-link-verify', status: 'error', attempts: 2, maxAttempts: 2, payload: '{}', groupKey: `site-audit:${sa.id}` } })
  await prisma.job.create({ data: { type: 'broken-link-verify', status: 'queued', attempts: 0, maxAttempts: 2, payload: '{}', groupKey: `site-audit:${sa.id}` } })
  const n = await recoverBrokenLinkVerifies()
  expect(n).toBe(0) // active job — leave alone
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } } })
  expect(run).toBeNull() // fence not reached; active attempt may still write the real run
})
```

Adjust the `prisma.job.create` field list to the actual Job model (check `prisma/schema.prisma` — include any required fields such as `scheduledFor`/`priority` defaults; copy the shape used by existing tests in `lib/jobs/*.test.ts`).

- [ ] **Step 2: Run to verify failure** — first test fails (a fresh verifier IS enqueued today).

- [ ] **Step 3: Implement** — in `recoverBrokenLinkVerifies`' per-id loop, after `if (activeJob) continue`:

```ts
    // Spec §3.2 (Codex #1) — self-repair fence: onExhausted hooks are
    // best-effort (runOnExhausted swallows failures), so a crashed placeholder
    // write must be repaired HERE, and an exhausted verifier must never be
    // re-enqueued. Terminal errored job present -> retry the placeholder,
    // skip the enqueue. Active jobs take precedence (checked above).
    const erroredJob = await prisma.job.findFirst({
      where: { type: BROKEN_LINK_VERIFY_JOB_TYPE, groupKey: `site-audit:${siteAuditId}`, status: 'error' },
      select: { id: true },
    })
    if (erroredJob) {
      await ensureExhaustedPlaceholder(siteAuditId)
      continue
    }
```

Add the import: `import { ensureExhaustedPlaceholder } from '@/lib/findings/exhausted-placeholder'`.

- [ ] **Step 4: Run the full recovery suite** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/broken-link-recovery.test.ts` → PASS (including pre-existing cases: audits WITHOUT errored jobs must still re-enqueue).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/broken-link-recovery.ts lib/ada-audit/broken-link-recovery.test.ts
git commit -m "fix(verifier): recovery sweep repairs placeholder + never re-enqueues exhausted verifier (loop fix part 2)"
```

---

### Task 4: Server read surfaces for the placeholder

**Files:**
- Modify: `app/api/site-audit/[id]/route.ts` (liveScanRunId derivation, ~line 106)
- Modify: `app/(app)/ada-audit/site/[id]/page.tsx` (live-scan run select + seoOnly resolution, lines ~222-243)
- Modify: `app/api/site-audit/[id]/content-audit/mint-token/route.ts` (run guard, lines ~21-25)
- Modify: `lib/sales/sales-report-data.ts` (~lines 145-154 + payload type)
- Modify: `components/sales/sections.tsx` (SEO section unavailable note)
- Test: extend the routes'/services' existing test files (locate with `ls app/api/site-audit/[id]/*.test.ts lib/sales/*.test.ts`; follow their arrange conventions)

**Interfaces:**
- Consumes: `LIVE_SCAN_PLACEHOLDER_SOURCE` from Task 2.
- Produces: `SalesReportData` payload gains `seoUnavailable: boolean`; `GET /api/site-audit/[id]` returns `liveScanRunId: null` for placeholder runs (seo-phase then classifies `failed` off the errored job — no seo-phase change needed).

- [ ] **Step 1: Write failing tests.** One per surface, in the surface's existing test file, all sharing this arrange shape:

```ts
const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', seoOnly: true } })
await prisma.crawlRun.create({ data: { tool: 'seo-parser', source: 'live-scan-placeholder', status: 'partial', siteAuditId: sa.id, domain: DOMAIN, seoIntent: false } })
```

Assertions:
1. `GET /api/site-audit/[id]` → `liveScanRunId === null` (placeholder excluded), while a `source: 'live-scan'` run still yields the id.
2. mint-token route → 409 `no_live_scan_run` for a placeholder-only audit.
3. `loadSalesReportData` (ready state, prospect audit with placeholder run) → `seoUnavailable === true`; with a real run → `false`.
4. `resolveSeoOnlyView(audit, null)` already returns `{ kind: 'banner' }` — no change needed there; assert instead that the app page derives `liveScanRunId: null` for placeholder (covered by the route test if the page shares the derivation; if the page derives independently at lines 222-243, add `source: true` to its select and mirror the null-out there, asserted via the section-prop test in Task 5).

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Implement each surface:**

`app/api/site-audit/[id]/route.ts` — add `source: true` to the crawlRuns select, then:

```ts
const seoRun = audit.crawlRuns[0] ?? null
const liveScanRunId = seoRun && !isPlaceholderRun(seoRun) ? seoRun.id : null
```

(Codex plan-fix #3: ALL source checks in Tasks 4-5 go through `isPlaceholderRun` — the snippets below assume it.)

**Codex plan-fix #3 — additional derivation sites (each gets the same null-out + a test):**
- the **early seoOnly branch** in `app/(app)/ada-audit/site/[id]/page.tsx` (the `resolveSeoOnlyView` call site derives its own liveScanRunId before the main render — a placeholder must yield null there too, or the page still redirects to the placeholder's run URL);
- **unified recents** href/status resolution (grep `results/run/` under `lib/` + `app/` and `components/` recents code): a seoOnly recents row currently links `/seo-audits/results/run/<id>` when a run exists — a placeholder run must NOT produce that href (fall back to the site page link, which now renders the failed banner). Add `source` to the recents run select and gate with `isPlaceholderRun`;
- any other `getLatestSeoVerifyJob`/`classifySeoPhase` caller that derives `liveScanRunId` from a bare `tool: 'seo-parser'` lookup (grep `siteAuditId_tool` across `app/` and `lib/` and audit each hit — the mint route and the two pages are covered explicitly here; anything else found gets the same treatment + a line in the PR description).

(seo-phase needs no change: `liveScanRunId: null` + latest verify job `status: 'error'` → `classifySeoPhase` returns `failed`, which `SeoPhaseBanner` already renders; after 30-d job pruning it degrades to `unavailable` — also already rendered.)

`content-audit/mint-token/route.ts` — add `source: true` to the run select and extend the guard:

```ts
if (!run || isPlaceholderRun(run))
  return NextResponse.json({ error: 'no_live_scan_run' }, { status: 409 })
```

`lib/sales/sales-report-data.ts` — add `source: true` to the crawlRuns select (lines ~145-151); keep the REPORTABLE resolution unchanged (pinned: placeholder IS reportable — ADA-only report, never "being prepared" forever); compute and thread:

```ts
const seoRun = audit.crawlRuns.find((r) => r.tool === 'seo-parser')
const seoUnavailable = seoRun != null && isPlaceholderRun(seoRun)
```

into the returned payload (`seoUnavailable: boolean` on the ready-state type).

`components/sales/sections.tsx` — in the SEO section, when `seoUnavailable` render an explicit note instead of the urgency rows:

```tsx
<p className="text-sm text-gray-600 dark:text-white/60">
  SEO analysis is unavailable for this scan — the post-scan SEO verifier did not complete. Accessibility, performance, and structured-data results below are unaffected.
</p>
```

(Wire the prop through `SalesReportView` → sections; match the local prop-drilling pattern.)

`lib/notify/*`: NO change — `runNotifyEmailJob` already filters `r.source === 'live-scan'`, so a placeholder yields `seoUnavailable: true`. Add one pinning test in `lib/jobs/handlers/notify-email.test.ts` (placeholder run → `buildCompleteEmail` receives `seoUnavailable: true`) so a future refactor can't regress it silently.

- [ ] **Step 4: Run the touched suites** → PASS. Also run `npx vitest run middleware.test.ts` (no middleware change expected — confirm).

- [ ] **Step 5: Commit**

```bash
git add app/api/site-audit lib/sales components/sales lib/jobs/handlers/notify-email.test.ts app/(app)/ada-audit/site
git commit -m "fix(verifier): placeholder run reads as SEO-unavailable on server surfaces"
```

---

### Task 5: Page-level SEO-unavailable branch (Codex plan-fix #3)

Codex plan review rejected per-section props: a placeholder must not let ANY
of the SEO tab's cards (BrokenLinks, OnPageSeo, TechnicalSeo,
DiscoveryCoverage, Reachability, ContentSimilarity, ContentSignals,
TopicOverlap, content-audit card) render a misleading empty/"pre-dates
analysis" state. One page-level branch replaces the whole stack.

**Files:**
- Create: `components/site-audit/SeoUnavailableNotice.tsx`
- Create: `components/site-audit/SeoUnavailableNotice.test.tsx`
- Modify: `app/(app)/ada-audit/site/[id]/page.tsx` (add `source: true` to the live-scan select at ~222-239; branch the `seoContent` block at ~278-299)
- Modify: `app/(public)/ada-audit/site/share/[token]/page.tsx` (same branch in its SEO tab assembly)

**Interfaces:**
- Consumes: `isPlaceholderRun` from Task 2.
- Produces: `SeoUnavailableNotice` (no props) — a single card explaining the state.

- [ ] **Step 1: Write the failing component test** (jsdom):

```tsx
// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import SeoUnavailableNotice from './SeoUnavailableNotice'
afterEach(cleanup)

it('renders the explicit unavailable copy', () => {
  render(<SeoUnavailableNotice />)
  expect(screen.getByText(/SEO analysis unavailable/i)).toBeTruthy()
  expect(screen.getByText(/re-run the audit/i)).toBeTruthy()
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement the component** (match the sibling sections' Card structure and dark-mode classes):

```tsx
// components/site-audit/SeoUnavailableNotice.tsx
// Rendered INSTEAD OF the whole SEO section stack when the audit's only
// seo-parser run is the exhausted-verifier placeholder (spec §3.3).
export default function SeoUnavailableNotice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">SEO analysis unavailable</h3>
      <p className="mt-1 text-[13px] font-body text-amber-700 dark:text-amber-400/90">
        The post-scan SEO verifier did not complete for this audit, so broken-link,
        on-page, and content analysis are unavailable. Accessibility results are
        unaffected. Re-run the audit to populate this tab.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Branch both pages.** In `app/(app)/ada-audit/site/[id]/page.tsx` (and the share page's equivalent block):

```tsx
const liveScanUnavailable = liveScanRun != null && isPlaceholderRun(liveScanRun)
const seoContent = liveScanUnavailable
  ? <SeoUnavailableNotice />
  : ( /* existing section stack, unchanged */ )
```

The content-audit card is inside the stack → suppressed with it (consistent with the Task 4 mint-guard 409).

- [ ] **Step 5: Run component test + the pages' existing tests** → PASS.

- [ ] **Step 6: Commit**

```bash
git add components/site-audit/SeoUnavailableNotice.tsx components/site-audit/SeoUnavailableNotice.test.tsx app/(app)/ada-audit/site app/(public)/ada-audit/site
git commit -m "fix(verifier): page-level SEO-unavailable branch replaces section stack for placeholder runs"
```

---

### Task 6: Characterization fixtures (pre-refactor gate)

**Files:**
- Create: `lib/jobs/handlers/broken-link-verify.characterization.test.ts`
- Modify: `lib/ada-audit/seo/content-similarity.test.ts` (over-maxPages fixture)

**Interfaces:**
- Produces: the frozen-output gate Tasks 7-10 must keep green.

- [ ] **Step 1: Write the builder characterization test** — green on CURRENT code (this is the point). Follow `broken-link-verify.test.ts`'s seed/deps/mocking conventions (mock embeddings via `vi.mock` as its siblings do). Fixture MUST include:
  - duplicate `HarvestedLink` rows: the same `(sourcePageUrl, targetUrl, 'internal-link')` pair inserted 3×, where the target resolves as a redirect (deps.resolve returns `{ result: 'ok', hops: 1, chain: [...], ... }` shaped to trigger `redirect_chain`) — pins the multiplicity contract (Codex #3: count === occurrences, not distinct pairs);
  - ~30 pages of `HarvestedPageSeo` with contentText (two exact-duplicate pages, two near-duplicate) + a mix of missing titles/H1s;
  - enough unique targets to exceed a small `BROKEN_LINK_MAX_CHECKS` (set via env in the test, e.g. 10) — pins the cap SUBSET (assert the exact target list checked, not just the count);
  - one broken internal target + one broken image.

  Assert (deep-equal, not snapshots): the full sorted `findings` list (type, scope, count, url, detail), the run row (status/score/pagesTotal), `discoveryCoverageJson`, `reachabilityJson`, `contentSimilarityJson`, and the console-log counters if exposed. Extract the expected values by running the test once with `console.log(JSON.stringify(...))` and pinning them — the values themselves come from current-code execution, not hand-derivation. Codex plan-fix #6: any env var the suite sets (`BROKEN_LINK_MAX_CHECKS` etc.) is saved in `beforeEach` and restored in `afterEach` — the suites run in one worker process and a leaked env poisons sibling files.

- [ ] **Step 2: Run it** → PASS on current code. If any assertion is flaky (ordering), fix the assertion (sort first), never the code.

- [ ] **Step 3: Add the over-maxPages similarity fixture** to `content-similarity.test.ts`:

```ts
it('counts noText/thin/truncated across ALL inputs even past maxPages (Codex #6)', () => {
  const mk = (i: number, text: string | null) => ({ url: `https://x.test/p${String(i).padStart(2, '0')}`, contentText: text, contentTruncated: i === 9 })
  const pages = [
    ...Array.from({ length: 5 }, (_, i) => mk(i, `unique page body ${i} ` + 'alpha beta gamma delta epsilon zeta eta theta '.repeat(20))),
    mk(5, null),                       // noText — beyond maxPages by sort order
    mk(6, 'too short'),                // thin — beyond maxPages
    mk(9, 'trunc page ' + 'word '.repeat(100)),
  ]
  const r = computeContentSimilarity(pages, { maxPages: 3 })
  expect(r).not.toBeNull()
  expect(r!.pagesEligible).toBe(3)     // capped
  expect(r!.capped).toBe(true)
  expect(r!.pagesSkipped).toEqual({ noText: 1, thin: 1 })
  expect(r!.truncatedPages).toBe(1)
})
```

Run once against current code and correct the pinned numbers to ACTUAL current behavior (they are the contract; current code counts across all inputs because the cap happens after the loop).

- [ ] **Step 4: Run both** → PASS. **Step 5: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.characterization.test.ts lib/ada-audit/seo/content-similarity.test.ts
git commit -m "test(verifier): characterization fixtures — duplicate-pair multiplicity, cap subset, over-maxPages counters"
```

---

### Task 7: Streamed link load + interned shared pairs

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (replace the two `harvestedLink.findMany` loads, lines ~164-192 and ~357-371, and the three derived copies at ~233-235, ~437-441, ~520-528)
- Test: `lib/jobs/handlers/broken-link-verify.test.ts` + the Task 6 characterization suite (the real gate)

**Interfaces:**
- Consumes: `VerifyDeps` gains `rssBytes: () => number` (default `() => process.memoryUsage().rss`) — added HERE; Task 10 reuses it.
- Produces: internal only — `streamHarvestedLinks(siteAuditId, kinds, chunkSize, onRow)` helper (exported for tests), compact structures described below.

- [ ] **Step 1: Extend `VerifyDeps`:**

```ts
export interface VerifyDeps {
  resolve: (url: string) => Promise<ResolveResult>
  resolveExternal: (url: string, timeoutMs: number) => Promise<ResolveResult>
  now: () => number
  sleep: (ms: number) => Promise<void>
  rssBytes: () => number
}
```

Default in `productionDeps`: `rssBytes: () => process.memoryUsage().rss`. Fix every test `depsFor` helper to include it (mechanical).

- [ ] **Step 2: Implement the streamed loader** (same file, above `runBrokenLinkVerify`):

```ts
const LINK_STREAM_CHUNK = 5000
export const VERIFIER_RSS_GUARD_MB = () => parsePositiveInt(process.env.VERIFIER_RSS_GUARD_MB, 1600)

/** Keyset-stream HarvestedLink rows in the builder's deterministic order.
 * Exported for tests. onRow must be synchronous (single pass, no retention).
 * onChunkEnd fires after each DB chunk (RSS checkpoint seam, Codex #5).
 * chunkSize is overridable for cross-boundary tests (Codex plan-fix #6). */
export async function streamHarvestedLinks(
  siteAuditId: string,
  kinds: string[],
  onRow: (r: { targetUrl: string; kind: string; sourcePageUrl: string; harvestTruncated: boolean }) => void,
  opts?: { onChunkEnd?: () => void; chunkSize?: number },
): Promise<void> {
  const size = opts?.chunkSize ?? LINK_STREAM_CHUNK
  let cursor: string | null = null
  for (;;) {
    const chunk: { id: string; targetUrl: string; kind: string; sourcePageUrl: string; harvestTruncated: boolean }[] =
      await prisma.harvestedLink.findMany({
        where: { siteAuditId, kind: { in: kinds } },
        orderBy: [{ targetUrl: 'asc' }, { kind: 'asc' }, { sourcePageUrl: 'asc' }, { id: 'asc' }],
        select: { id: true, targetUrl: true, kind: true, sourcePageUrl: true, harvestTruncated: true },
        take: size,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
    for (const r of chunk) onRow(r)
    opts?.onChunkEnd?.()
    if (chunk.length < size) return
    cursor = chunk[chunk.length - 1].id
  }
}
```

Add a dedicated cursor-stability test (Codex plan-fix #6): seed rows where
identical `(targetUrl, kind, sourcePageUrl)` triples straddle a chunk
boundary (`chunkSize: 2`, 5 identical rows), assert every row is delivered
exactly once and in order (no duplicate, no skip across the cursor).

NOTE the ordering change: the existing `orderBy` gains an `id` tiebreaker. Rows identical in all three sort columns (exact duplicates) permute freely today, so the tiebreaker cannot change any observable output — the characterization suite proves it.

- [ ] **Step 3: Rewrite the internal/image load** as ONE streaming pass building:

```ts
const intern = new Map<string, string>()
const asIntern = (s: string): string => { const v = intern.get(s); if (v !== undefined) return v; intern.set(s, s); return s }

// (1) capped dedup list — identical first-seen order to the old byTarget map
const byTarget = new Map<string, { kind: 'internal-link' | 'image'; sources: Set<string> }>()
// Codex plan-fix #2: rows are (targetUrl, kind)-contiguous, so distinct groups
// are counted by group-key TRANSITION — a `!byTarget.has(key)` probe would
// over-count unadmitted (post-cap) targets once per ROW instead of per group.
let prevGroupKey: string | null = null
let uniqueCount = 0
// (2) ONE deduped internal-pair list with occurrence counts (Codex #3).
// kind is a constant string ref so the SAME array feeds computeLinkGraph
// directly (Codex plan-fix #1 — no per-consumer map/flatMap copies).
const pairKeyToIdx = new Map<string, number>()
const internalPairs: { sourcePageUrl: string; targetUrl: string; kind: 'internal-link'; occurrences: number }[] = []
let harvestTruncated = false
let linkStreamRssTripped = false

await streamHarvestedLinks(job.siteAuditId, ['internal-link', 'image'], (r) => {
  if (r.harvestTruncated) harvestTruncated = true
  const key = `${r.kind} ${r.targetUrl}`
  if (key !== prevGroupKey) { uniqueCount++; prevGroupKey = key }
  let e = byTarget.get(key)
  if (!e && byTarget.size < cap) {
    e = { kind: r.kind as 'internal-link' | 'image', sources: new Set() }
    byTarget.set(key, e)
  }
  if (e && e.sources.size < URLS_PER_FINDING) e.sources.add(normalizeFindingUrl(r.sourcePageUrl))
  if (r.kind === 'internal-link' && !linkStreamRssTripped) {
    const pk = `${r.sourcePageUrl}\n${r.targetUrl}`
    const idx = pairKeyToIdx.get(pk)
    if (idx !== undefined) internalPairs[idx].occurrences++
    else { pairKeyToIdx.set(pk, internalPairs.length); internalPairs.push({ sourcePageUrl: asIntern(r.sourcePageUrl), targetUrl: asIntern(r.targetUrl), kind: 'internal-link', occurrences: 1 }) }
  }
}, { onChunkEnd: () => {
  if (!linkStreamRssTripped && deps.rssBytes() > VERIFIER_RSS_GUARD_MB() * 1048576) {
    linkStreamRssTripped = true
    internalPairs.length = 0; pairKeyToIdx.clear()
    console.warn('[live-seo] rss guard tripped during link stream — graph/coverage/validation degrade')
  }
} })
pairKeyToIdx.clear(); intern.clear()
const capped = uniqueCount > cap
const toCheck = [...byTarget.entries()].map(([key, v]) => ({ targetUrl: key.slice(key.indexOf(' ') + 1), ...v }))
```

**Cap-subset equivalence argument (verify against characterization):** the old code collected ALL unique targets then `slice(0, cap)`; insertion order was first-seen in `(targetUrl, kind, sourcePageUrl)` row order, so the first `cap` map entries ARE the old slice. The new code stops ADMITTING new targets at `cap` but keeps counting `uniqueCount` — same subset, same `capped` flag. Source samples for admitted targets accumulate identically.

**RSS-trip downstream semantics (Codex plan-fix #2 — rejected the `discoveryCapped: true` fallback; empty-input coverage can still render clean-looking sitemap numbers):** on `linkStreamRssTripped`, the builder sets graph → `null` (existing fail-path), `discoveryCoverageJson` → `null` (do NOT call `computeDiscoveryCoverage`), skips `mapValidationFindings` entirely (no findings, not fabricated-clean ones), and ORs `linkStreamRssTripped` into the run-status disjunction so the run lands `'partial'`. `toCheck` (verification proper) is NEVER dropped. Note `discoveryCoverageJson` becomes conditionally null where it was unconditionally stringified — the column is nullable and `DiscoveryCoverageSection` already handles a missing payload (verify with its test).

- [ ] **Step 4: Re-point the three consumers to the ONE array (Codex plan-fix #1 — no map/flatMap copies):**
  - validation mapper — `ValidationLink` gains an optional `occurrences?: number`; `mapValidationFindings` applies multiplicity internally (wherever it currently pushes one hit per link row, loop `for (let i = 0; i < (l.occurrences ?? 1); i++)` — inspect the actual push sites in `lib/findings/validation-mapper.ts` and multiply EACH, keeping counts and sample-target lists byte-identical to per-row input; the characterization duplicate-pair fixture is the proof). Call: `mapValidationFindings(validationRows, internalPairs, cache, ...)`.
  - graph — `computeLinkGraph(internalPairs, graphNodes, homepageUrl, indexableUrls)`: the array already carries `kind: 'internal-link'` and structural typing accepts the extra `occurrences` field. Multiplicity-insensitive (dedupes into sets).
  - coverage — `internalLinks: internalPairs` (its input type is `{sourcePageUrl, targetUrl}[]`; extra fields are structurally fine when passing a typed variable).

  Delete the old `rows` variable entirely; `rows.some(harvestTruncated)` is replaced by the streamed flag.

- [ ] **Step 5: Stream the external pass the same way** (kinds `['external-link']`, dedup by targetUrl with source samples, cap `EXTERNAL_MAX`, truncated flag) — replaces the `extRows` findMany. Codex plan-fix #2 applies here too: count distinct external targets by group-key transition, never by admission probes.

- [ ] **Step 5b: Update the Task 1 profiling script's injected deps** with `rssBytes: () => process.memoryUsage().rss` (Codex plan-fix #6 — the script's `VerifyDeps` object no longer compiles without it).

- [ ] **Step 6: Run the characterization suite + full verify suites** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/ lib/ada-audit/broken-link-recovery.test.ts` → ALL PASS, byte-identical outputs.

- [ ] **Step 7: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/*.test.ts
git commit -m "fix(verifier): stream + intern HarvestedLink load; one shared occurrence-counted pair list (memory fix stage A)"
```

---

### Task 8: contentText byte budget with honest accounting

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (seoRows query ~lines 203-210 + the three content-pass blocks)
- Test: extend `broken-link-verify.test.ts` (or a new `.content-budget.test.ts` sibling)

**Interfaces:**
- Produces: seoRows loaded WITHOUT `contentText`; a separate `loadContentTextBudgeted()` chunked query fills a `Map<url, string>` under `CONTENT_TEXT_TOTAL_BYTE_BUDGET` (env `CONTENT_TEXT_TOTAL_BYTE_BUDGET`, default `25_165_824` = 24MB, `parsePositiveInt`); `budgetSkippedPages: number` threaded into the emitted analytics wrappers.

- [ ] **Step 1: Failing test:** seed pages whose combined contentText exceeds a tiny env budget (set `CONTENT_TEXT_TOTAL_BYTE_BUDGET=1024` in the test); assert (a) the similarity/signals JSON wrappers carry `inputCapped: true` and `budgetSkippedPages > 0`, (b) run status stays whatever it was (budget alone never flips `partial`), (c) with a generous budget the wrappers carry no `budgetSkippedPages`/`inputCapped:false` and outputs match Task 6's characterization.

- [ ] **Step 2: Implement:**
  - Remove `contentText: true` from the main seoRows select (keep `contentTruncated`).
  - Add:
    ```ts
    const CONTENT_TEXT_BUDGET = () => parsePositiveInt(process.env.CONTENT_TEXT_TOTAL_BYTE_BUDGET, 25_165_824)
    async function loadContentTextBudgeted(siteAuditId: string): Promise<{ textByUrl: Map<string, string>; budgetSkippedPages: number }> {
      const textByUrl = new Map<string, string>()
      let used = 0, skipped = 0, overflowed = false
      let cursor: string | null = null
      for (;;) {
        const chunk: { id: string; url: string; contentText: string | null }[] = await prisma.harvestedPageSeo.findMany({
          where: { siteAuditId }, orderBy: [{ url: 'asc' }, { id: 'asc' }],
          select: { id: true, url: true, contentText: true },
          take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        })
        for (const r of chunk) {
          if (!r.contentText) continue
          // Codex plan-fix #4: STRICT PREFIX admission in url order — after the
          // first overflow nothing else is admitted (first-fit would let later
          // small pages jump an earlier skip, making the admitted set depend on
          // page sizes instead of purely on url order).
          if (overflowed) { skipped++; continue }
          const bytes = Buffer.byteLength(r.contentText, 'utf8') // Codex #4: bytes, never .length
          if (used + bytes > CONTENT_TEXT_BUDGET()) { overflowed = true; skipped++; continue }
          used += bytes; textByUrl.set(r.url, r.contentText)
        }
        if (chunk.length < 200) return { textByUrl, budgetSkippedPages: skipped }
        cursor = chunk[chunk.length - 1].id
      }
    }
    ```
    (Confirm `HarvestedPageSeo` has a cuid `id` PK in the schema; it does — same shape as HarvestedLink.)
  - Call it ONCE before the content-signals block; the three passes read `textByUrl.get(r.url) ?? null` instead of `r.contentText`.
  - Stamp honesty (Codex #4) into the wrappers:
    ```ts
    if (signals) contentSignalsJson = JSON.stringify({ v: 1, ...signals, ...(budgetSkippedPages > 0 ? { inputCapped: true, budgetSkippedPages } : {}) })
    // similarity: same pattern on its wrapper
    // topic overlap: inputCapped: inputCapped || budgetSkippedPages > 0 (into the existing flag), plus budgetSkippedPages when > 0
    ```
  - **Codex plan-fix #4 — the null-result case must not lose the cap metadata:**
    when a pass was budget/RSS-capped AND its analyzer returned `null` (e.g.
    every page budget-skipped → fewer than 2 eligible), persist a capped STUB
    instead of null:
    ```ts
    else if (budgetSkippedPages > 0 || rssTrippedThisPass)
      contentSignalsJson = JSON.stringify({ v: 1, unavailable: true, inputCapped: true, budgetSkippedPages })
    // same for contentSimilarityJson / topicOverlapJson
    ```
    and update `ContentSignalsSection`, `ContentSimilaritySection`,
    `TopicOverlapSection` to render "Not measured — content input was capped
    for this run" for an `unavailable: true` payload (their strict parsers
    must tolerate the stub — extend each parser + one jsdom test per section).
    A pass skipped ONLY for time keeps writing plain null (existing behavior,
    unchanged).
  - `contentAuditRetainUntil` stamping and `HarvestedPageSeo` retention are untouched — the budget affects what THIS pass reads, not what is stored.

- [ ] **Step 3: Run tests + characterization** (characterization runs under default budget — unaffected) → PASS. **Step 4: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.content-budget.test.ts
git commit -m "fix(verifier): contentText loaded under a byte budget with honest inputCapped accounting (memory fix stage B2)"
```

---

### Task 9: `computeContentSimilarity` retention refactor

**Files:**
- Modify: `lib/ada-audit/seo/content-similarity.ts` (eligibility loop, lines ~70-95)
- Test: existing `content-similarity.test.ts` fixtures + Task 6's over-maxPages fixture (all must pass UNCHANGED)

- [ ] **Step 1: Confirm the gate is green** (fixtures pass pre-change).

- [ ] **Step 2: Refactor** — compute per-page digest + shingles inline; never retain `tokens`/`norm`:

```ts
let noText = 0, thin = 0, truncatedPages = 0
let capped = false // Codex plan-fix #6: declared BEFORE the loop (the loop now sets it)
type Row = { url: string; sh: number[]; exactHash: string | null; truncated: boolean }
const eligible: Row[] = []
for (const pg of [...pages].sort((x, y) => (x.url < y.url ? -1 : x.url > y.url ? 1 : 0))) {
  if (pg.contentTruncated) truncatedPages++
  if (!pg.contentText) { noText++; continue }
  const tokens = normalize(pg.contentText)
  if (tokens.length < o.minTokens) { thin++; continue }
  if (eligible.length >= o.maxPages) { capped = true; continue } // counters above still ran (Codex #6)
  eligible.push({
    url: pg.url,
    sh: shingleHashes(tokens, o.shingleSize),
    exactHash: pg.contentTruncated ? null : createHash('sha256').update(tokens.join(' ')).digest('hex'),
    truncated: pg.contentTruncated,
  })
}
if (eligible.length < 2) return null
```

Then: the exact-dup block reads `r.exactHash` instead of hashing `r.norm`; the `raw` array is replaced by `eligible` itself (it already carries `sh`); everything downstream (`df`, `dropped`, `sets`, `sigs`, pairwise) is unchanged. Delete the old `capped` slice (`eligible.length = o.maxPages`) — the loop now enforces it. IMPORTANT semantic checks against current behavior: (a) old code set `capped = true` only when eligible EXCEEDED maxPages — the `>=` skip branch preserves that (it only runs on page maxPages+1); (b) old exact-dup hashed `r.norm` = `tokens.join(' ')` — identical input string; (c) old code tokenized ALL pages including beyond-cap ones for counter purposes — the new loop still does (counters run before the cap skip).

- [ ] **Step 3: Run** `npx vitest run lib/ada-audit/seo/content-similarity.test.ts` → ALL PASS unchanged (pinned fixtures are the purity proof). Run the Task 6 characterization → PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/seo/content-similarity.ts
git commit -m "perf(verifier): content-similarity drops per-page token/norm retention — output-identical (memory fix stage B1)"
```

---

### Task 10: Topic-overlap slice fix + RSS guard on all optional passes

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (topic-overlap block ~lines 577-591; the four optional-pass gates; embedChunked call ~592-603)
- Test: `broken-link-verify.test.ts` (RSS-guard cases via injected `rssBytes`)

- [ ] **Step 1: Failing tests:** with `deps.rssBytes` returning above the guard, (a) signals/topic/similarity JSONs are all null, graph null, run still written with findings intact and status unchanged; (b) with rssBytes below guard, outputs match characterization.

- [ ] **Step 2: Implement:**
  - Slice-before-retain in the topic block:
    ```ts
    const withText = eligible.map((r) => {
      const full = (textByUrl.get(r.url) ?? '').trim()
      return {
        url: r.url,
        sigText: [r.title, r.h1, r.metaDescription].map((s) => (s ?? '').trim()).filter(Boolean).join('\n'),
        body: full.slice(0, TOPIC_OVERLAP_BODY_CHARS),
        bodyPrefixTruncated: full.length > TOPIC_OVERLAP_BODY_CHARS,
      }
    })
    ```
    (`bodyTexts` then maps `c.body` directly; the `vecByUrl` `bodyPrefixTruncated` reads the precomputed flag. NOTE: `.trim()` on the full string is transient inside the map iteration — retained objects hold only the 2000-char slice.)
  - One guard helper + apply at each optional gate alongside the existing time checks (signals, topic, similarity, graph):
    ```ts
    const rssOverGuard = () => deps.rssBytes() > VERIFIER_RSS_GUARD_MB() * 1048576
    // e.g. signals gate:
    if (sigRemaining >= ... && !rssOverGuard()) { ... } else if (rssOverGuard()) console.warn('[live-seo] rss guard: skipping content signals')
    ```
  - `embedChunked` `shouldAbort` gains the RSS term:
    ```ts
    shouldAbort: () =>
      JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS < CONTENT_SIM_RESERVE_MS || rssOverGuard(),
    ```

- [ ] **Step 3: Run tests + characterization + full handler suites** → PASS. **Step 4: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "fix(verifier): topic-overlap slice-before-retain + injectable RSS guard on every optional pass (memory fix stage B3-4)"
```

---

### Task 11: Post-fix profiling + acceptance evidence

**Files:** none (evidence task; possible constant calibration in `broken-link-verify.ts`)

- [ ] **Step 1: Re-run** `scripts/profile-verifier-memory.ts` at 1000×300×30KB and 500×150×30KB. Record the after table next to Task 1's baseline.
- [ ] **Step 2: Check acceptance:** marginal peak rss **< 500MB**; total wall-clock comfortably < 15 min (network mocked). If the EXPLAIN plan shows a per-chunk full sort AND wall-clock is at risk: fall back per spec §4.0 (id-ordered scan + in-memory ordered merge, or propose an index — an index means a migration, so STOP and route the choice through Codex before building it).
- [ ] **Step 3: Calibrate** `CONTENT_TEXT_TOTAL_BYTE_BUDGET` default if measurement says 24MB is wrong (one-line change + re-run).
- [ ] **Step 4: Recovery drills (spec §5):** locally with `DATABASE_URL="file:./local-dev.db"`:
  - drill A: seed a fake exhausted state (errored verify job + harvested rows + no run), boot the recovery path (`recoverBrokenLinkVerifies()` via a tsx one-liner) → exactly one placeholder run, zero queued jobs; run it AGAIN → still one run, zero jobs (idempotent).
  - drill B: monkey-patch/spy `ensureExhaustedPlaceholder` to fail once (or temporarily point at a bad table via a vitest test double) → recovery does NOT enqueue; next pass repairs. (This is largely covered by Task 3's tests; the drill is a belt-and-suspenders manual pass — keep evidence in the PR text.)
- [ ] **Step 5: Commit** any calibration; paste both profiling tables + drill results into the PR description.

---

### Task 12: Gates, smoke, PR, merge

- [ ] **Step 1:** `npm run lint` → clean. `DATABASE_URL="file:./local-dev.db" npm test` → all green. `npm run build` → success.
- [ ] **Step 2:** `export CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" && npm run smoke` → green (ADA-pipeline-adjacent change).
- [ ] **Step 3:** Push branch, open PR with `gh pr create` — body includes: incident link, spec path, before/after profiling tables, drill evidence, and the Claude Code footer.
- [ ] **Step 4:** Merge per change-control rule 1 (gates re-run green in this session). Then proceed to the C21 deploy sequence (separate work item — NOT part of this plan).

---

## Self-review notes

- Spec coverage: §3.1-3.2 → Tasks 2-3; §3.3 table → Tasks 4-5 (canonical/sweep/notify rows are no-change-with-pinning-tests); §4.0 → Tasks 1, 11; §4.1 → Task 7; §4.2.1 → Task 9; §4.2.2 → Task 8; §4.2.3-4 → Task 10; §5 drills → Tasks 3, 11; §6 → Task 12.
- The C21 sweep classify row needs no code change; its pinning lives in the existing sweep suites — if `lib/sweep/classify.test.ts` lacks a `runStatus: 'partial'` zero-findings case, add one in Task 4 Step 1 (assert coverage `partial`, no resolved claims).
- Type consistency: `LIVE_SCAN_PLACEHOLDER_SOURCE` (Tasks 2,3,4,5), `ensureExhaustedPlaceholder(siteAuditId): Promise<PlaceholderOutcome>` (Tasks 2,3), `VerifyDeps.rssBytes: () => number` (Tasks 7,10), `internalPairs: {sourcePageUrl,targetUrl,occurrences}[]` (Task 7), `loadContentTextBudgeted → {textByUrl, budgetSkippedPages}` (Tasks 8,10 — topic block reads `textByUrl`).
