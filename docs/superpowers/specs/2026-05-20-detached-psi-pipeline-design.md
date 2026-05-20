# Detached PSI Pipeline — Design Spec

**Date:** 2026-05-20
**Goal:** Remove the PageSpeed Insights HTTP fetch from the per-page Chrome slot in site audits so axe runs back-to-back while PSI drains in parallel through a dedicated worker pool.
**Expected outcome:** ~3× wall-clock speedup on a 30-page audit, no Chrome resource bump required in this PR.

---

## Background

In production we run `LIGHTHOUSE_PROVIDER=pagespeed`. `runAxeAudit` in `lib/ada-audit/runner.ts` awaits the PSI HTTP fetch *inline* while holding the puppeteer page slot (`runner.ts:167-176`). The puppeteer page is not released until the `finally` block at `runner.ts:239-241`. With `SITE_AUDIT_CONCURRENCY=1`, this means every page's 30-150s PSI wait blocks the next page from starting axe.

PSI is a remote HTTP call to Google. It does not need the puppeteer page. Decoupling it from the Chrome slot is the largest single throughput improvement available without changing concurrency or pool sizing.

This spec covers PR 1 of a two-PR sequence. PR 2 — the resource bumps already drafted in `docs/superpowers/plans/2026-05-14-audit-throughput-tuning.md` — lands as a fast-follow after PR 1 has been observed stable in production.

## Constraints

- Production VPS: 2 vCPU, 3.8 GB RAM, 2 GB swap. PM2 ceiling `max_memory_restart: 2400M`, Node heap 2048 MB.
- SQLite only — no Postgres, no Redis. Worker pool is in-process, in-memory.
- Node 22, single PM2 process (fork mode, no clustering).
- The fei.edu OOM precedent (PR #15): bundling resource and semantic changes makes failures hard to attribute. PR 1 ships zero resource changes.
- Standalone single-page `/ada-audit` audits keep inline PSI — no UI churn for one-off requests.

## Out of scope

- `BROWSER_POOL_SIZE` / `SITE_AUDIT_CONCURRENCY` bumps. Those are PR 2, gated on observed evidence under detached-PSI baseline.
- Switching back to `LIGHTHOUSE_PROVIDER=local`. Provider selection unchanged.
- Persisting the PSI queue across process restarts. In-memory only; `recoverQueue()` cascade-fails orphans on startup.
- Single-page route changes. `/ada-audit` standalone audits still call `runAxeAudit` with PSI inline.

---

## Data model

Additive migration. No destructive changes.

### `SiteAudit`

Add three counter columns (mirror the `pdfs*` triplet):

```prisma
lighthouseTotal     Int @default(0)
lighthouseComplete  Int @default(0)
lighthouseError     Int @default(0)
```

New status string value: `lighthouse-running`. No enum — status is `String` throughout.

### `AdaAudit`

New status string value: `axe-complete`. Lifecycle for site-audit children becomes:

```
pending → running → axe-complete → complete
                          ↓
                        error
```

Single-page audits keep the existing `pending → running → complete` path.

The existing `lighthouseSummary` and `lighthouseError` columns are written by the PSI worker, not by the page loop.

### Migration

One file, additive: `ALTER TABLE "SiteAudit" ADD COLUMN ...` × 3. Status values are strings, no schema change required.

---

## Module boundaries

```
lib/ada-audit/
  lighthouse-queue.ts          ← NEW
  lighthouse-queue.test.ts     ← NEW
  runner.ts                    ← modified (siteAudit flag, skip inline PSI)
  queue-manager.ts             ← modified (per-page sequence, status sets)
  site-audit-finalizer.ts      ← modified (centralized drain predicate)
  pdf-orchestrator.ts          ← modified (defer finalize to finalizer)
  queue-request.ts             ← modified (in-flight status set)
  audit-batch-helpers.ts       ← modified (IN_FLIGHT_STATUSES)
```

### `lighthouse-queue.ts` (new)

Singleton in-process worker pool. Public API:

```ts
export function enqueuePsiJob(job: PsiJob): void          // fire-and-forget
export function getPsiQueueState(): { active: number; queued: number }  // for tests / diagnostics

interface PsiJob {
  adaAuditId: string
  siteAuditId: string
  url: string
  wcagLevel: string  // for symmetry, currently unused by PSI
}
```

No DB-backed PSI state distinct from the `AdaAudit` row exists, so there is no separate orphan-cleanup helper for PSI. Cleanup is handled by extending the existing `failOrphanAdaAudits` to also catch `'axe-complete'` rows (see Recovery semantics below).

Internal:
- Concurrency cap from env: `PSI_CONCURRENCY` (positive int, default 6).
- Job queue is a simple array; workers pop FIFO.
- Each worker calls `runPageSpeedInsights(url)` (existing function in `lighthouse-pagespeed.ts`).
- On settle (success OR error):
  1. Update `AdaAudit` row: write `lighthouseSummary` JSON or `lighthouseError` text, set `status='complete'`.
  2. Atomically increment `SiteAudit.lighthouseComplete` or `lighthouseError`.
  3. Invoke `finalizeSiteAudit(siteAuditId)` — the centralized drain check decides whether to actually finalize.
- All DB writes wrapped in try/catch with console.warn — never throw out of a worker.
- No SIGTERM hook. The in-process queue holds no durable state; on shutdown, in-flight workers are killed by the 10s PM2 grace period. Any rows left in `axe-complete` are cleaned up on next startup by `recoverQueue`.

### `runner.ts` (modified)

Add a new field to `RunAxeOptions`:

```ts
export interface RunAxeOptions {
  captureScreenshots?: boolean
  screenshotDir?: string
  auditId: string
  siteAudit?: boolean   // NEW: when true, skip inline PSI fetch
}
```

In the `pagespeed` branch (currently `runner.ts:167-176`):

```ts
if (provider === 'pagespeed') {
  if (options?.siteAudit) {
    // Site audit: PSI is queued separately; do not fetch here.
    // lighthouseSummary stays null; the PSI worker will fill it in later.
  } else {
    // Single-page audit: keep inline PSI fetch (unchanged behavior).
    await progress(22, 'Fetching Lighthouse from PageSpeed Insights…')
    try {
      const lh = await runLighthouse(parsed.toString(), page)
      lighthouseSummary = lh.summary
      lighthouseError = lh.error ?? null
    } catch (err) {
      lighthouseError = err instanceof Error ? err.message : String(err)
    }
  }
}
```

The `local` branch is unchanged — local Lighthouse genuinely needs the page slot, and we don't currently use it in production. Local stays inline.

### `queue-manager.ts:runAudit` (modified)

Per-page block changes. Current code:

```ts
const { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls } = await runAxeAudit(
  url, wcagLevel, undefined, { auditId: child.id },
)
await prisma.adaAudit.update({
  where: { id: child.id },
  data: {
    status: 'complete',
    result: JSON.stringify(axe),
    lighthouseSummary: lighthouseSummary ? JSON.stringify(lighthouseSummary) : null,
    lighthouseError,
    runnerType: 'browser',
  },
})
await prisma.siteAudit.update({ where: { id }, data: { pagesComplete: { increment: 1 } } })
```

Becomes:

```ts
const { axe, harvestedPdfUrls } = await runAxeAudit(
  url, wcagLevel, undefined, { auditId: child.id, siteAudit: true },
)

// CRITICAL: persist axe-complete AND bump lighthouseTotal BEFORE pagesComplete.
// This ordering prevents finalizeSiteAudit from observing pages_done=true with
// lighthouseTotal=0 (i.e. "no LH work outstanding, finalize now") for any page
// whose axe finished but whose PSI job hasn't been counted yet.
await prisma.$transaction([
  prisma.adaAudit.update({
    where: { id: child.id },
    data: {
      status: 'axe-complete',
      result: JSON.stringify(axe),
      runnerType: 'browser',
    },
  }),
  prisma.siteAudit.update({
    where: { id },
    data: {
      lighthouseTotal: { increment: 1 },
      pagesComplete: { increment: 1 },
    },
  }),
])

enqueuePsiJob({ adaAuditId: child.id, siteAuditId: id, url, wcagLevel })

await dispatchPdfScans({ ... })  // unchanged
```

End-of-page-loop block changes. Current code flips `pdfs-running` based on PDF outstanding, otherwise calls `finalizeSiteAudit`. New behavior: always call `finalizeSiteAudit(id)` and let it pick the next status (`pdfs-running` / `lighthouse-running` / `complete`). The centralized predicate owns the decision.

### `site-audit-finalizer.ts` (modified)

Becomes the single decision point. Pseudocode:

```ts
export async function finalizeSiteAudit(id: string): Promise<void> {
  const row = await prisma.siteAudit.findUnique({ where: { id } })
  if (!row) return
  if (row.status === 'complete' || row.status === 'error') return  // idempotent

  const pagesDone      = row.pagesComplete + row.pagesError >= row.pagesTotal
  const pdfsDone       = row.pdfsComplete + row.pdfsError >= row.pdfsTotal
  const lighthouseDone = row.lighthouseComplete + row.lighthouseError >= row.lighthouseTotal

  if (!pagesDone) return  // page loop still owns the row

  if (!pdfsDone || !lighthouseDone) {
    // Pick a transient status that reflects what's still outstanding.
    // 'pdfs-running' wins over 'lighthouse-running' for UI legibility — PDFs
    // are typically slower and more visible to the user.
    const next = !pdfsDone ? 'pdfs-running' : 'lighthouse-running'
    if (row.status !== next) {
      await prisma.siteAudit.update({ where: { id }, data: { status: next } })
    }
    return
  }

  // All drained — build summary and finalize.
  const summary = await buildSiteAuditSummary(id)
  await prisma.siteAudit.update({
    where: { id },
    data: { status: 'complete', summary: JSON.stringify(summary) },
  })

  if (row.batchId) await closeBatchIfDrained(row.batchId)
  void processNext()
}
```

Callers (`runAudit` end-of-loop, `pdf-orchestrator` settle callback, `lighthouse-queue` worker settle callback) all call `finalizeSiteAudit(id)` after their work without inspecting state themselves.

### `pdf-orchestrator.ts` (modified)

Where it currently inspects `pageState` and decides to finalize, it now just calls `finalizeSiteAudit(siteAuditId)` and lets the predicate handle it. Specifically the settle callback at the bottom of the orchestrator.

### Status-aware call sites that must learn `lighthouse-running`

Every place that currently treats `pdfs-running` as "in-flight" must also recognize `lighthouse-running`:

| File | Construct | Change |
|---|---|---|
| `queue-manager.ts:processNext` | `where: { status: { in: ['running', 'pdfs-running'] } }` | Add `'lighthouse-running'` |
| `queue-manager.ts:getQueueStatus` | active-row filter | Add `'lighthouse-running'` |
| `queue-manager.ts:resetStaleAudits` | stale filter | Add `'lighthouse-running'` |
| `queue-manager.ts:recoverQueue` | orphan filter | Add `'lighthouse-running'` |
| `audit-batch-helpers.ts:closeBatchIfDrained` | IN_FLIGHT_STATUSES + the raw SQL `IN(...)` clause | Add `'lighthouse-running'` (both places) |
| `queue-request.ts` | duplicate-active-audit guard | Add `'lighthouse-running'` |
| `queue-manager.ts:IN_FLIGHT_STATUSES` constant (if not shared) | — | Verify single source of truth |

Missing any one of these can cause: (a) the next site audit to start while PSI is still draining, (b) a batch to close mid-PSI, or (c) duplicate audits enqueued during the lighthouse-only tail.

`getQueueStatus` should also expose `lighthouseTotal/Complete/Error` in the active-row payload so the UI can show the LH progress bar during the `lighthouse-running` phase.

---

## Recovery semantics

### `recoverQueue()` (startup)

In addition to existing cascades:
- Add `'lighthouse-running'` to the orphan SiteAudit filter.
- Extend `failOrphanAdaAudits` to also catch `'axe-complete'` rows (not just `'pending'` / `'running'`). These are pages whose PSI was queued in-memory and never ran.

For an `axe-complete` row being errored:
- `status = 'error'`
- `error = 'Audit interrupted because the site audit was stopped or restarted'`
- `lighthouseError = 'Lighthouse interrupted because the site audit was stopped or restarted'`
- `result` is preserved (axe data is still valid; just unused because the parent is failing).

### `resetStaleAudits()` (10-min sweep)

Same additions. Stale `lighthouse-running` parents get errored, and `axe-complete` children cascade-fail via the extended `failOrphanAdaAudits`.

### In-memory queue lifecycle

`lighthouse-queue.ts` has no startup hook. Workers process whatever is enqueued during this process's lifetime. Anything in-flight when the process dies is lost — but the DB rows it would have updated are exactly what `failOrphanLighthouseJobs` cleans up on startup.

---

## Status model — UI implications

The per-page `AuditPoller` polls `/api/ada-audit/[id]` and renders based on `status`. New behavior:

- `pending` / `running` — unchanged, shows progress bar.
- `axe-complete` (NEW for site-audit children only) — shows "axe complete, awaiting Lighthouse" as a transitional state. Result table can render axe violations immediately; lighthouse card shows a small pending spinner.
- `complete` — full result available (axe + lighthouse).
- `error` — unchanged.

The poller continues polling until `status='complete'` or `status='error'`. The API route at `app/api/ada-audit/[id]/route.ts` returns the row as-is; the client handles the new state.

For single-page audits, `axe-complete` never appears (runner's `siteAudit` flag is false, PSI runs inline).

`SiteAuditPoller` learns the new `lighthouse-running` phase symmetrically to `pdfs-running`. The active-audit banner in `SiteAuditForm` learns the same.

---

## Test plan

New test file `lib/ada-audit/lighthouse-queue.test.ts`:

- `enqueuePsiJob` respects `PSI_CONCURRENCY` cap (no more than N workers run concurrently).
- Successful PSI job writes `lighthouseSummary`, flips AdaAudit to `complete`, increments `SiteAudit.lighthouseComplete`.
- Failed PSI job writes `lighthouseError`, still flips AdaAudit to `complete`, increments `SiteAudit.lighthouseError`.
- Worker settle calls `finalizeSiteAudit`.
- `failOrphanLighthouseJobs` flips `axe-complete` AdaAudit rows to `error` with the standard interrupt message, leaves `complete`/`error` rows alone.

New tests in `lib/ada-audit/site-audit-finalizer.test.ts` (or its containing file):

- **Early-finalization guard.** Setup: SiteAudit with `pagesTotal=3, pagesComplete=3, pagesError=0, pdfsTotal=0, lighthouseTotal=2, lighthouseComplete=1, lighthouseError=0`. Call `finalizeSiteAudit`. Expect: status flips to `lighthouse-running`, NOT `complete`.
- **All-drained finalization.** Same setup but `lighthouseComplete=2`. Expect: status flips to `complete`, summary written.
- **PDFs outstanding + LH done.** Expect: status flips to `pdfs-running`.
- **Both outstanding.** Expect: status flips to `pdfs-running` (PDFs win by convention).
- **Idempotent.** Calling `finalizeSiteAudit` twice when already `complete` is a no-op.
- **Pages not done.** Returns without changing status (page loop still owns the row).

Update existing tests in `lib/ada-audit/queue-manager.test.ts`:
- `recoverQueue` cascade now also includes `failOrphanLighthouseJobs`.
- `resetStaleAudits` same.
- `processNext` does not pick a queued audit when an existing one is in `lighthouse-running`.
- `getQueueStatus` reports `lighthouse-running` as the active phase.

Manual verification post-deploy:
- Queue a ~30-page audit. Watch `pm2 list` for steady memory (no spikes from removed inline PSI). Watch wall-clock: expect roughly 3× faster than baseline.
- Watch `pm2 logs` for any `failOrphanLighthouseJobs` invocations — should be zero during a healthy run.
- Verify a page that errors during PSI (force by passing an unreachable URL to a test audit) still finalizes correctly: AdaAudit ends `complete` with `lighthouseError` set, SiteAudit drains and finalizes.

---

## Env configuration

New variable in `ecosystem.config.js`:

```js
PSI_CONCURRENCY: '6',
```

Documented in `docs/SERVER_SETUP.md` env-var table.

No other env changes in this PR. `BROWSER_POOL_SIZE`, `SITE_AUDIT_CONCURRENCY`, `max_memory_restart`, `NODE_OPTIONS` all unchanged.

---

## Failure modes

| Scenario | Behavior |
|---|---|
| PSI fetch times out (90s default) | Worker writes `lighthouseError`, AdaAudit → `complete`, `SiteAudit.lighthouseError++`. Audit finalizes normally with partial data. |
| PSI returns 429 (rate limit) | Same as timeout — error recorded, audit continues. Rate budget should not be a problem at 6 concurrent with API key. |
| PSI worker throws unexpectedly | Caught and logged inside worker. AdaAudit gets `lighthouseError = err.message`, treated as error path above. |
| Process restart mid-`lighthouse-running` | `recoverQueue` flips parent SiteAudit to `error`, `failOrphanLighthouseJobs` flips child `axe-complete` rows to `error`. No wedged queue. |
| Many simultaneous site audits (impossible today — concurrency=1) | One audit's PSI workers share the pool with the next audit's. Per-audit fairness is FIFO. Not a concern in current single-active-audit world but PSI_CONCURRENCY cap holds regardless. |
| `lighthouseTotal=0` after a 0-page audit | `lighthouse_done` is trivially true (`0+0 >= 0`). Finalizer behaves as today. |

---

## Throughput expectation

Baseline (pagespeed, concurrency=1, inline PSI): per-page slot time ≈ axe (5s) + PSI (60s avg) = ~65s. 30 pages ≈ 32 min wall clock.

After PR 1 (detached PSI, concurrency=1, PSI_CONCURRENCY=6): per-page slot time ≈ axe (5s) + harvest (1-2s) = ~7s. 30 pages × 7s ≈ 3.5 min of axe work, then a `lighthouse-running` tail. With 6 concurrent PSI workers at 60s each, all 30 PSI jobs drain in ~30/6 × 60s = 5 min. Total wall clock ≈ 8 min. **~4× speedup**, conservative.

PR 2 (pool=4, concurrency=2) layered on top would bring axe work to ~2 min; PSI drain dominates at that point. Combined improvement vs baseline: ~5×.

---

## Deploy mechanics

Standard deploy via `git push` + `~/deploy.sh`. No PM2 config reload trick needed unless `ecosystem.config.js` is touched — and we add `PSI_CONCURRENCY` to it, so this deploy DOES need `pm2 delete seo-tools && pm2 start ecosystem.config.js` (not `pm2 restart`).

Add this to the deploy step in the PR body.

---

## Rollback plan

If detached PSI causes unexpected behavior, revert the PR. The migration is additive (three nullable-defaulted Int columns) so rollback doesn't require a down-migration; the columns stay in the schema with `0` values, which is benign.

Worst-case rollback path:
1. `git revert <merge commit>` on main
2. Push, deploy
3. Existing in-flight audits at the moment of revert: their `axe-complete` rows will never advance (the rolled-back code knows nothing about that status). Sweep manually: `UPDATE "AdaAudit" SET status = 'complete' WHERE status = 'axe-complete';` on prod DB. None should exist after a clean queue drain.
