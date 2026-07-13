# Internal-link Verify Time Budget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the internal-link verification pass in `broken-link-verify.ts` a time budget so it no longer blows the 15-min ceiling before the write — the live-scan run is written (as `status:'partial'` when truncated) instead of being lost. (This removes the timeout-before-write failure mode; DB/writer failures can still prevent a run — Codex fix #5.)

**Architecture:** Mirror the external pass's existing deadline pattern. Add an `INTERNAL_TIME_BUDGET` env-configurable budget, clamp an internal deadline that reserves the external budget (when enabled) + a post-verification reserve, check that deadline at the top of each `cacheWorker` iteration, add failure isolation to the internal worker, and thread a new `internalBudgetHit` flag through every place the existing `capped` flag already flows (run status, broken-link `affectedComplete`+confidence, validation `affectedComplete`, log line).

**Tech Stack:** TypeScript, Prisma+SQLite, Vitest (DB-backed tests against `local-dev.db`).

**Spec:** `docs/superpowers/specs/2026-07-06-broken-link-verify-internal-time-budget-design.md` (Codex ACCEPT-WITH-FIXES, all 7 applied).

## Global Constraints

- Single file changed: `lib/jobs/handlers/broken-link-verify.ts` + one new test file.
- `JOB_TIMEOUT_MS = 900_000` stays hardcoded (do NOT raise it).
- Array-form `$transaction` only (not touched here, but house rule).
- Gate-green before PR: `npm run lint` + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`.
- No new REQUIRED env var (default 600_000 applies) → no `instrumentation.ts` boot-guard change, no server `.env` edit.
- Injected-into-page rule N/A (this file is server-only, never `.toString()`-injected).

---

### Task 1: Add the internal-link verification time budget

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts`
  - Constants block (~line 82-91): add `INTERNAL_TIME_BUDGET` + hoist a module-scope `unconfirmedResult()` helper.
  - Internal pass (~line 226-243): compute the clamped deadline, add the per-iteration deadline check + failure isolation.
  - Completeness surfaces (lines ~379, 380, 388, 425): thread `internalBudgetHit`.
  - Log line (~line 436): report `internalBudgetHit` + resolved/total.
  - External pass (~line 291): replace the inline `unconfirmedResult` const with the hoisted helper (DRY).
- Test: `lib/jobs/handlers/broken-link-verify.time-budget.test.ts` (new)

**Interfaces:**
- Consumes: `runBrokenLinkVerify(payload, deps: VerifyDeps)` (existing export), `VerifyDeps` (`resolve`, `resolveExternal`, `now`, `sleep`), the existing module consts `JOB_TIMEOUT_MS`, `SAFETY_RESERVE_MS`, `EXTERNAL_TIME_BUDGET()`, `EXTERNAL_MAX_CHECKS()`, `parsePositiveInt`.
- Produces: new behavior only — no new exported symbol. New env var `BROKEN_LINK_INTERNAL_TIME_BUDGET_MS` (default `600_000`). New module-scope `unconfirmedResult(): ResolveResult`.

- [ ] **Step 1: Write the failing test file**

Create `lib/jobs/handlers/broken-link-verify.time-budget.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { runBrokenLinkVerify, type VerifyDeps } from './broken-link-verify'

const DOMAIN = 'c6tb.example.com'
const url = (i: number) => `https://c6tb.example.com/p${i}`

async function clean() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}
beforeEach(clean)
afterEach(async () => {
  vi.unstubAllEnvs() // Codex fix #3: restore env, never leak BROKEN_LINK_* to other tests
  await prisma.scoringWeights.deleteMany({ where: { id: 1 } })
})
afterAll(clean)

// N distinct internal targets (p0..p{n-1}), each linked from one source page on DOMAIN.
async function seedInternal(n: number) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })
  const data = Array.from({ length: n }, (_, i) => ({
    siteAuditId: sa.id, targetUrl: url(i), kind: 'internal-link', sourcePageUrl: 'https://c6tb.example.com/a',
  }))
  if (n) await prisma.harvestedLink.createMany({ data })
  return sa.id
}

// Deterministic clock: now() reads a shared `clock`; resolve() advances it by
// stepMs and counts calls (Codex fix #1). brokenSet -> those targets resolve
// 'broken' (Codex fix #2, lets us assert only-resolved-are-counted). throwSet ->
// resolve() throws (Codex fix #4, exercises the new failure isolation).
function makeDeps(opts: { stepMs?: number; brokenSet?: Set<string>; throwSet?: Set<string> } = {}) {
  const { stepMs = 0, brokenSet = new Set<string>(), throwSet = new Set<string>() } = opts
  let clock = 0
  let calls = 0
  const deps: VerifyDeps = {
    resolve: async (u: string) => {
      calls++; clock += stepMs
      if (throwSet.has(u)) throw new Error('boom')
      return brokenSet.has(u)
        ? { result: 'broken', finalUrl: null, status: 404, hops: 0, chain: [], tooManyRedirects: false }
        : { result: 'ok', finalUrl: u, status: 200, hops: 0, chain: [], tooManyRedirects: false }
    },
    resolveExternal: async (u: string) => ({ result: 'ok', finalUrl: u, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
    now: () => clock,
    sleep: async () => {},
  }
  return { deps, getCalls: () => calls }
}

const liveRun = (id: string) =>
  prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: id, tool: 'seo-parser' } },
    include: { findings: true },
  })
const brokenCount = (r: NonNullable<Awaited<ReturnType<typeof liveRun>>>) =>
  r.findings.find((f) => f.scope === 'run' && f.type === 'broken_internal_links')?.count ?? 0

describe('runBrokenLinkVerify — internal time budget', () => {
  it('budget trips mid-internal -> partial run written; only resolved targets counted', async () => {
    vi.stubEnv('BROKEN_LINK_CONCURRENCY', '1')          // deterministic sequential resolves
    vi.stubEnv('BROKEN_LINK_EXTERNAL_MAX_CHECKS', '0')  // isolate the internal pass
    vi.stubEnv('BROKEN_LINK_INTERNAL_TIME_BUDGET_MS', '250000')
    const id = await seedInternal(10)
    // ALL 10 targets would resolve 'broken'; step 100_000/resolve, deadline 250_000
    // -> checks at 0,100k,200k resolve p0,p1,p2, then 300k>=250k trips. 3 resolved.
    const { deps, getCalls } = makeDeps({ stepMs: 100_000, brokenSet: new Set(Array.from({ length: 10 }, (_, i) => url(i))) })
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    const run = await liveRun(id)
    expect(run).not.toBeNull()                 // the whole point: run got written
    expect(run!.status).toBe('partial')        // budget-hit -> partial
    expect(getCalls()).toBe(3)                 // only 3 launched (Codex fix #1)
    expect(brokenCount(run!)).toBe(3)          // unresolved 7 NOT counted (Codex fix #2)
    expect(await prisma.harvestedLink.count({ where: { siteAuditId: id } })).toBe(0) // transient cleaned
  })

  it('no time pressure -> complete run, all targets resolved (regression guard)', async () => {
    vi.stubEnv('BROKEN_LINK_CONCURRENCY', '1')
    vi.stubEnv('BROKEN_LINK_EXTERNAL_MAX_CHECKS', '0')
    const id = await seedInternal(5)
    const { deps, getCalls } = makeDeps({ stepMs: 0, brokenSet: new Set(Array.from({ length: 5 }, (_, i) => url(i))) })
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps) // clock never advances
    const run = await liveRun(id)
    expect(run!.status).toBe('complete')
    expect(getCalls()).toBe(5)                 // all resolved
    expect(brokenCount(run!)).toBe(5)
  })

  it('deadline <= 0 (no time left) -> zero internal checks, partial run still written', async () => {
    vi.stubEnv('BROKEN_LINK_CONCURRENCY', '1')
    vi.stubEnv('BROKEN_LINK_EXTERNAL_MAX_CHECKS', '1')          // external enabled -> its budget is reserved
    vi.stubEnv('BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS', '900000') // reserve >= JOB_TIMEOUT -> internal deadline clamps to 0
    const id = await seedInternal(5)
    const { deps, getCalls } = makeDeps({ stepMs: 100_000 })
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    const run = await liveRun(id)
    expect(run).not.toBeNull()
    expect(run!.status).toBe('partial')
    expect(getCalls()).toBe(0)                 // zero internal resolves launched
  })

  it('internal resolve throws -> isolated to that target, run still written (failure isolation)', async () => {
    vi.stubEnv('BROKEN_LINK_CONCURRENCY', '1')
    vi.stubEnv('BROKEN_LINK_EXTERNAL_MAX_CHECKS', '0')
    const id = await seedInternal(2)
    // p0 throws, p1 resolves broken. No budget pressure (step 0).
    const { deps } = makeDeps({ stepMs: 0, throwSet: new Set([url(0)]), brokenSet: new Set([url(1)]) })
    await expect(runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)).resolves.toBeUndefined()
    const run = await liveRun(id)
    expect(run).not.toBeNull()                 // a throw in one resolve did not sink the run
    expect(run!.status).toBe('complete')       // a throw is unconfirmed, not a partial trigger
    expect(brokenCount(run!)).toBe(1)          // p1 counted; p0 (threw -> unconfirmed) not broken
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.time-budget.test.ts`
Expected: FAIL — the budget-trip and deadline<=0 tests expect `status: 'partial'` but current code either resolves all targets (`complete`) or the job would run to completion (no budget exists), so `status` is `complete`.

- [ ] **Step 3: Add the `INTERNAL_TIME_BUDGET` const + hoist `unconfirmedResult`**

In the constants block (after the `EXTERNAL_TIME_BUDGET` line ~91), add:

```ts
const INTERNAL_TIME_BUDGET = () => parsePositiveInt(process.env.BROKEN_LINK_INTERNAL_TIME_BUDGET_MS, 600_000)
```

Add a module-scope helper (near the other top-level helpers, before `runBrokenLinkVerify`):

```ts
const unconfirmedResult = (): ResolveResult => ({
  result: 'unconfirmed', finalUrl: null, status: null, hops: 0, chain: [], tooManyRedirects: false,
})
```

- [ ] **Step 4: Add the clamped deadline + worker deadline-check + failure isolation**

Replace the internal resolution block (currently ~lines 226-243, from `const cache = new Map<...>()` through the `await Promise.all(...cacheWorker())` line) with:

```ts
  // Resolve legacy + validation targets ONCE into a shared cache (reuses throttle).
  const cache = new Map<string, ResolveResult>()
  const allToResolve = [...legacyTargets, ...validationToResolve]
  // Internal time budget (mirrors the external pass): clamp to reserve the external
  // budget (only when external is enabled) + the post-verification reserve, so the
  // run is ALWAYS written instead of the job dying at JOB_TIMEOUT_MS before the write.
  const externalReserveMs = EXTERNAL_MAX_CHECKS() > 0 ? EXTERNAL_TIME_BUDGET() : 0
  const internalDeadlineMs = Math.max(
    0,
    Math.min(INTERNAL_TIME_BUDGET(), JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - externalReserveMs - SAFETY_RESERVE_MS),
  )
  let internalBudgetHit = false
  const internalStartedAt = deps.now()
  let cursor2 = 0
  const cacheWorker = async (): Promise<void> => {
    while (cursor2 < allToResolve.length) {
      if (deps.now() - internalStartedAt >= internalDeadlineMs) { internalBudgetHit = true; return }
      const url = allToResolve[cursor2++]
      let host = ''
      try {
        host = new URL(url).hostname
      } catch {
        cache.set(normalizeFindingUrl(url), unconfirmedResult())
        continue
      }
      // Failure isolation (mirrors the external worker): a throw in throttle.wait or
      // deps.resolve degrades THIS target to unconfirmed, never rejecting the pool.
      try {
        await throttle.wait(host)
        cache.set(normalizeFindingUrl(url), await deps.resolve(url))
      } catch {
        cache.set(normalizeFindingUrl(url), unconfirmedResult())
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY(), allToResolve.length || 1) }, () => cacheWorker()))
```

- [ ] **Step 5: Replace the external pass's inline `unconfirmedResult` with the hoisted helper**

In the external pass (~line 291), delete the local `const unconfirmedResult = (): ResolveResult => ({ ... })` definition. The two call sites there (`extCache.set(norm, unconfirmedResult())`) now resolve to the module-scope helper — identical shape, no behavior change.

- [ ] **Step 6: Thread `internalBudgetHit` through the completeness surfaces**

Broken-link findings (~lines 378-381):

```ts
  const brokenFindings = mapBrokenLinkFindings(broken, {
    runId, ensurePage, affectedComplete: !capped && !harvestTruncated && !internalBudgetHit,
    confidence: { checked, broken: broken.length, unconfirmed, capped: capped || internalBudgetHit, harvestTruncated },
  })
```

Validation findings (~line 388):

```ts
  const validationFindings = mapValidationFindings(validationRows, internalLinks, cache, {
    runId, ensurePage, auditedHost, affectedComplete: !capped && !cappedValidation && !internalBudgetHit,
  })
```

Run status (~line 425):

```ts
      status: capped || harvestTruncated || cappedValidation || externalCapped || externalHarvestTruncated || internalBudgetHit ? 'partial' : 'complete',
```

- [ ] **Step 7: Extend the log line for observability (~line 436)**

Append the budget flag + resolved/total to the existing `console.log`:

```ts
  console.log(
    `[broken-link-verify] ${job.siteAuditId}: checked ${checked}, broken ${broken.length}, unconfirmed ${unconfirmed}, external checked ${externalChecked}, external broken ${externalBroken.length}, external unconfirmed ${externalUnconfirmed}, on-page rows ${seoRows.length}, internalBudgetHit ${internalBudgetHit} (${cache.size}/${allToResolve.length} resolved)`,
  )
```

- [ ] **Step 8: Run the new test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.time-budget.test.ts`
Expected: PASS (4/4).

- [ ] **Step 9: Run the existing handler tests (regression)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts lib/jobs/handlers/broken-link-verify.graph.test.ts lib/jobs/handlers/broken-link-verify.discovery-coverage.test.ts`
Expected: PASS (the hoisted helper + threaded flag are behavior-neutral for the non-budget paths; `now: () => 0` in those tests means the deadline never trips because `internalDeadlineMs` is large and `now - internalStartedAt` stays 0).

- [ ] **Step 10: Full gate**

Run:
```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.time-budget.test.ts
git commit -m "fix(c6): time budget for internal-link verify pass

The internal verify pass had no deadline (unlike external), so large sites blew
JOB_TIMEOUT_MS and the job was killed before writeFindingsRun -> total loss.
Add BROKEN_LINK_INTERNAL_TIME_BUDGET_MS + a clamped deadline + failure isolation;
budget-hit threads through status/affectedComplete/confidence as a dynamic cap.
Score/coverage/on-page stay complete (verification-independent).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

## Post-merge (tracked in the PR/deploy task, not a code step)

1. Deploy (`~/deploy.sh`) — no migration, no new required env var.
2. `recoverBrokenLinkVerifies()` (boot + every 10 min) re-enqueues the 5 stranded verify jobs (transient rows still present); they re-run under the new code and build `partial`/`complete` runs.
3. Prod-verify: each of cambria/brownson/manhattan/boca/discovery gets a fresh live-scan `seoIntent` run with non-null score + `discoveryCoverageJson`; **measure the log's post-verify timing on discovery (53k links)** against the 60 s `SAFETY_RESERVE_MS` (Codex fix #4) — if it overruns, raise the reserve in a follow-up.
4. Record parity + miss-rate per domain in the parity log.

## Self-Review

- **Spec coverage:** budget const (Step 3) ✓, clamped deadline w/ conditional external reserve (Step 4) ✓, worker deadline check (Step 4) ✓, failure isolation (Step 4/5, tested) ✓, all 5 completeness surfaces (Steps 6-7) ✓, 4 tests — budget-trip w/ resolve-count + only-resolved-counted assertions, regression, deadline<=0, failure-isolation (Step 1) ✓, rollout via recovery (post-merge) ✓.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `unconfirmedResult(): ResolveResult` matches the existing inline shape; `internalBudgetHit: boolean` used uniformly; `INTERNAL_TIME_BUDGET()` returns number like its siblings.
