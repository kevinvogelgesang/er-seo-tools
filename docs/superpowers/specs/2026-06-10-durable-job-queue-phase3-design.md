# Durable Job Queue Phase 3 — Site-Audit Page Loop Design

**Date:** 2026-06-10 · **Roadmap item:** A1 Phase 3 (parent spec:
`2026-06-10-durable-job-queue-design.md`, phase table row 3)
**Status:** spec — pending Codex review

## Problem

The site-audit page loop is the last non-durable leg of a site audit. It
lives in `runAudit()` (`lib/ada-audit/queue-manager.ts`): a conditional
`queued → running` claim, `discoverPages()`, then an in-memory batched loop
(axe via browser pool → PDF dispatch → page-settle transaction → PSI
enqueue), guarded globally by the in-memory `processing` mutex in
`processNext()`. A restart during the `running` phase kills the loop;
`recoverQueue`/`resetStaleAudits` can only fail the parent and cascade-fail
its children. PSI (Phase 1) and PDF scans (Phase 2) already survive
restarts; pages don't.

## Goals

1. `running` parents become restart-survivable like `pdfs-running` /
   `lighthouse-running` — a deploy mid-audit resumes page work instead of
   failing the audit.
2. Delete the `processing` mutex and the `running`-status special-casing in
   both recovery paths.
3. Preserve every existing invariant: one site audit at a time, SiteAudit
   FIFO, pdfsTotal-before-pagesComplete ordering, redirected-page handling,
   detached-PSI vs local/off provider branching, browser recycling, batch
   closure.

## Non-goals

- Phase 4 (cleanup ticks + screenshot sweeper as scheduled jobs) — next
  session.
- Multi-site-audit parallelism. One active site audit at a time stays.
- Changing standalone single-page audits — they keep their own POST-driven
  runner and `ada-audit:<id>` PDF groups, untouched.
- Schema changes. None needed — `Job`, `SiteAudit.discoveredUrls`, and the
  counters already exist.

## Design

### Two new job types

**`site-audit-discover`** — one per audit (dedupKey `discover:<siteAuditId>`,
groupKey `site-audit:<siteAuditId>`). Owns the `queued → running` claim,
page discovery, child-row creation, and page-job fan-out. Making this a job
(rather than inline work in `processNext`) is what makes the enqueue step
itself crash-safe: a restart mid-fan-out re-queues the discover job, which
resumes idempotently.

Handler flow:

1. Conditional claim: `updateMany({ where: { id, status: 'queued' }, data:
   { status: 'running', startedAt } })`.
   - `count === 1` → fresh run, continue.
   - `count === 0` → read the row: `running` means this is a crash-resume
     (continue at step 2); any terminal status (cancelled/error/complete)
     means no-op — kick `processNext()` and return.
2. URLs: if `discoveredUrls` is set (pre-discovered at enqueue time, or
   persisted by a previous attempt), parse and use it. Otherwise
   `discoverPages(domain)`, then persist `discoveredUrls` + `pagesTotal`
   in **one** update — this write is the "discovery done" marker the
   finalizer guard keys off (see below). `pagesTotal` is always written
   together with `discoveredUrls`, before any child rows exist.
3. Child rows: read existing children once, `createMany` the missing URLs
   as `status: 'pending'` (with `clientId`, `siteAuditId`, `wcagLevel`).
4. Fan-out: for every child still in `pending`/`running`, `enqueueJob({
   type: 'site-audit-page', payload: { adaAuditId, siteAuditId, url,
   wcagLevel }, dedupKey: 'page:<siteAuditId>:<url>', groupKey:
   'site-audit:<siteAuditId>' })`. Active-window dedup absorbs re-runs; a
   duplicate job against a settled child no-ops via the child-row claim.
5. If `urls.length === 0`: call `finalizeSiteAudit` (an empty audit
   completes immediately, as today).

Errors: `discoverPages` throws (DNS failure, no sitemap and crawl failed)
→ the job throws → queue retry with backoff. `onExhausted` → fail the
audit via the shared `failSiteAudit()` helper (below). Config:
`maxAttempts: 3`, `backoffBaseMs: 30_000`, `timeoutMs: 300_000`
(discovery of a 1000-page sitemap + 1000 inserts fits comfortably).

**`site-audit-page`** — one per page (concurrency = `SITE_AUDIT_CONCURRENCY`,
default 1, prod 2). Payload `{ adaAuditId, siteAuditId, url, wcagLevel }`.

Handler flow (mirrors today's loop body):

1. Claim the child: `updateMany({ where: { id: adaAuditId, status: { in:
   ['pending', 'running'] } }, data: { status: 'running', startedAt } })`.
   `running` is claimable because a crashed attempt leaves the row there
   (same as pdf-scan's `scanning`).
   - `count === 0` → **resume/no-op path:** read the child's status.
     - `axe-complete` → the previous attempt crashed between the settle
       transaction and the PSI enqueue. Re-enqueue PSI (`enqueuePsiJob`
       dedups on `psi:<adaAuditId>`, so an already-active PSI job absorbs
       it) and call `finalizeSiteAudit`. This closes the legacy
       lost-PSI-enqueue window.
     - anything else → call `finalizeSiteAudit` (cheap, idempotent — covers
       a crash between settle and finalize) and return.
2. `runAxeAudit(url, wcagLevel, undefined, { auditId, siteAudit: detachPsi })`
   where `detachPsi = getLighthouseProvider() === 'pagespeed'`, exactly as
   today. The runner acquires/releases the browser-pool page internally —
   the handler never holds a page across its own awaits.
3. **Domain errors settle, DB errors throw** (same split as psi/pdf-scan):
   `runAxeAudit` throwing (navigation failure, axe crash) is a domain
   result — settle the child as `error` + `pagesError`++ and the job
   completes, preserving today's no-retry-per-page semantics. Everything
   outside that try/catch (claims, settle transactions, PDF dispatch DB
   work) throws → queue retry covers transient `SQLITE_BUSY`.
4. Redirected (`runResult.kind === 'redirected'`): settle the child as
   `redirected` (+ `finalUrl`, `redirected: true`, `runnerType: 'browser'`,
   `completedAt`) and bump `pagesRedirected` — skip PDF dispatch and PSI,
   then finalize.
5. Otherwise: `await dispatchPdfScans(...)` FIRST (pdfsTotal must be
   current before pagesComplete signals "page settled" — unchanged
   invariant), then the page-settle transaction:
   - detached PSI: child → `axe-complete` + result JSON, parent
     `lighthouseTotal`++ and `pagesComplete`++; then `enqueuePsiJob`.
   - local/off: child → `complete` + result + inline LH fields,
     `pagesComplete`++ only.
6. `finalizeSiteAudit(siteAuditId)` — warn-and-continue on failure (another
   settling job or stale recovery picks it up, same exposure as psi/pdf).

All settle transactions are **array-form `$transaction([...])`** with the
counter bump expressed as raw SQL — `UPDATE "SiteAudit" SET "<counter>" =
"<counter>" + 1, "updatedAt" = <Date.now()> WHERE id = ? AND EXISTS
(SELECT 1 FROM "AdaAudit" WHERE id = ? AND status IN (<claimable>))` —
paired with the conditional child flip, exactly the psi/pdf-scan pattern.
Never interactive transactions (2026-06-10 incident).

`settlePageFailure(payload, message)` is the shared failure settle
(claimable `['pending','running']` → child `error` + `pagesError`++ +
finalize), used by `onExhausted` and by the discover handler if a page-job
enqueue fails after the child row exists. Config: `maxAttempts: 3`,
`backoffBaseMs: 30_000`, `timeoutMs: 300_000` (navigation 30 s + settle
5 s + axe on heavy DOMs + a possible browser-recycle drain wait).

### `processNext()` becomes a stateless promoter; the mutex dies

```ts
export async function processNext() {
  // no mutex
  const active = await prisma.siteAudit.findFirst({ where: { status: { in:
    ['running', 'pdfs-running', 'lighthouse-running'] } } })
  if (active) return
  const next = await prisma.siteAudit.findFirst({ where: { status: 'queued' },
    orderBy: { createdAt: 'asc' } })
  if (!next) return
  await enqueueJob({ type: 'site-audit-discover',
    payload: { siteAuditId: next.id },
    dedupKey: `discover:${next.id}`, groupKey: `site-audit:${next.id}` })
}
```

Race-safety without the mutex: concurrent callers both pick the **oldest**
queued row, so they enqueue the same dedupKey — one wins, one dedups. The
window where the promoted audit is still `queued` (discover job enqueued
but not yet claimed) is covered the same way. One-at-a-time holds because
only `processNext` enqueues discover jobs and it bails whenever any audit
is in a transient status. Kicks stay where they are today (enqueueAudit,
finalizeSiteAudit, both recovery paths, cancel route) plus the discover
handler's no-op path.

`runAudit()` is deleted entirely. The page loop, the batch
`Promise.all`, the loop-index browser recycle, and the between-audit
`closeBrowser()` calls all go with it.

### Browser recycling moves into the pool

The loop-index recycle (`SITE_AUDIT_BROWSER_RECYCLE_PAGES`, prod 15) has no
home in a job model — there is no barrier between batches. Replacement, in
`browser-pool.ts`:

- Count pages served (`acquirePage` increments).
- When the count reaches the threshold, set a **draining gate**: new
  `acquirePage` callers wait behind it; when active pages hit zero, close
  Chrome, reset the counter, release the gate. This bounds recycle latency
  to one page's duration and — unlike today's between-batch `closeBrowser`
  — can never kill a concurrent standalone single-page audit's page,
  because it waits for *all* active pages, not just the site audit's.
- **Idle close:** when active pages hit zero and no waiters remain, start
  a 60 s timer; close Chrome when it fires (cancelled by the next
  `acquirePage`). This replaces the deleted between-audit `closeBrowser()`
  memory reclaim and also benefits standalone audits.

Env var name stays `SITE_AUDIT_BROWSER_RECYCLE_PAGES` (no prod config
churn); its scope is now pool-global rather than per-site-audit, which on a
single-site-audit-at-a-time system is the same thing in practice. Default
stays 25 in code, 15 in prod.

### Finalizer: discovery guard + scalar reads

Two changes to `finalizeSiteAudit`:

1. **Discovery guard.** During discovery, `pagesTotal` is 0, so the drain
   predicate (`0 >= 0` on all three) would complete an audit that hasn't
   discovered its pages yet — and unlike today, finalize now gets called
   from page-job no-op paths while the audit is `running`. Guard: if
   `status === 'running' && discoveredUrls === null`, return — discovery
   still owns the row. The discover handler always persists
   `discoveredUrls` + `pagesTotal` in one write before creating any child
   rows, so once `discoveredUrls` is non-null the predicate is meaningful.
   (Pre-discovered audits have `discoveredUrls` set from creation, and
   their `pagesTotal` is written by the same discover-handler update —
   order step 2 so the guard's invariant holds: re-persist is fine.)
2. **Scalar first.** Today finalize starts with `findUnique({ include:
   { pageAudits: { include: { pdfAudits: true } } } })` on every call.
   Page settles add ~one finalize call per page; on a 1000-page audit
   that's 1000 × O(children) loads. Change: read scalars only
   (status + counters + batchId + discoveredUrls); load the children
   `include` only after the drain predicate passes, for the summary build.

To keep the guard's invariant simple, step 2 of the discover handler
persists `discoveredUrls`+`pagesTotal` even when URLs were pre-discovered
(idempotent re-write of the same values, plus the authoritative
`pagesTotal`).

### Recovery: `running` joins the survivable set

`recoverQueue()` and `resetStaleAudits()` both collapse to one generic
treatment for all three transient statuses (`running`, `pdfs-running`,
`lighthouse-running`):

1. `countActiveJobsByGroup('site-audit:<id>')` — failure to count → skip
   this pass (never bias toward destruction).
2. `> 0` → resume (log and leave alone). A `running` parent's outstanding
   work is its discover job and/or page jobs, already re-queued by
   `recoverJobsOnStartup` (boot order unchanged).
3. `=== 0` → one `finalizeSiteAudit` attempt; if the row lands `complete`,
   done (finalize-before-fail, unchanged).
4. Still transient → `failSiteAudit(id, message)`.

**`failSiteAudit(id, message)`** is extracted as the shared destructive
path (today duplicated across both recovery loops): flip parent to
`error`, `failOrphanAdaAudits`, `failOrphanPdfAudits`,
`cancelJobsByGroup`, `closeBatchIfDrained`, all `.catch`-guarded. Also
used by the discover handler's `onExhausted`. It ends with a
`processNext()` kick so a failed audit releases the queue slot.

What this deletes: the `running`-vs-transient branching in both recovery
paths, the strong "any `running` parent is orphaned" startup assumption,
and the duplicated fail/cascade blocks. `failOrphanAdaAudits` /
`failOrphanPdfAudits` stay — they're the cascade used by the fail path.
`resetStaleAudits`'s 10-min interval + 5-min threshold stays as the
safety net for wedged-but-job-less parents.

Legacy `running` parents at deploy time (started under the old loop, no
jobs in their group): outstanding count is 0, finalize attempt won't
complete them (pages not drained), so they fail — exactly today's
behavior for the deploy that ships this change.

### Cancellation

Unchanged. Cancel is only legal on `queued` audits. The promoted-but-
unclaimed window is handled: cancel flips `queued → cancelled`, the
discover claim matches 0 rows, reads the terminal status, kicks
`processNext`, and completes as a no-op.

## What gets deleted

| Deleted | Replaced by |
|---|---|
| `runAudit()` + page loop + batch `Promise.all` | `site-audit-discover` + `site-audit-page` handlers |
| `processing` mutex | stateless promoter + dedupKey |
| loop-index browser recycle | pool-level draining gate |
| between-audit `closeBrowser()` calls | pool idle close (60 s) |
| `running` special-casing in `recoverQueue`/`resetStaleAudits` | generic transient treatment |
| duplicated fail/cascade blocks in both recovery paths | `failSiteAudit()` helper |

## Env vars

| Var | Default | Change |
|---|---|---|
| `SITE_AUDIT_CONCURRENCY` | 1 (prod 2) | now the `site-audit-page` job-type concurrency — same effective behavior |
| `SITE_AUDIT_BROWSER_RECYCLE_PAGES` | 25 (prod 15) | now a pool-global pages-served threshold |

No new env vars. The idle-close delay is a code constant (60 s).

## Testing

Existing pattern: vitest against the dev DB, `fileParallelism: false`,
tests drive `runWorkerTickOnce()` directly, cleanup by prefix.

- `handlers/site-audit-discover.test.ts` — fresh claim → discovers,
  persists `discoveredUrls`+`pagesTotal`, creates children, enqueues page
  jobs; resume re-run (row already `running`, partial children/jobs) tops
  up the missing ones without duplicates; pre-discovered URLs skip
  discovery; terminal-status no-op kicks processNext; zero URLs →
  finalize → complete; `onExhausted` → `failSiteAudit`.
- `handlers/site-audit-page.test.ts` — success (detached PSI): child
  `axe-complete`, `lighthouseTotal`+`pagesComplete` bumped, PSI job
  enqueued; success (local/off): child `complete` + inline LH fields, no
  `lighthouseTotal`; redirected: `pagesRedirected` bumped, no PDF/PSI;
  axe throw → domain settle (`pagesError`, job completes); claim-0 with
  `axe-complete` child → PSI re-enqueued + finalize; claim-0 with terminal
  child → finalize only; `onExhausted` → `settlePageFailure`; double
  settle impossible (conditional claim).
- `queue-manager.test.ts` rewrite — promoter: no active + oldest queued →
  discover job enqueued (deduped on double-call); active audit → no
  enqueue; recovery: `running` parent with active group jobs survives both
  paths; `running` parent with zero jobs gets finalize-then-fail;
  `failSiteAudit` cascades + cancels + closes batch + kicks.
- `site-audit-finalizer.test.ts` additions — discovery guard (`running` +
  null `discoveredUrls` → untouched even with all counters 0); scalar path
  still completes + builds summary when drained.
- `browser-pool.test.ts` additions — recycle gate: Nth release triggers
  drain, acquirers wait, Chrome relaunches, counter resets; idle timer
  closes after zero-active and is cancelled by a new acquire. (Pool tests
  may need a mockable browser factory — follow whatever the existing
  pool tests do.)

## Risks

- **Finalize call volume** — one per page settle. Mitigated by the
  scalar-first read; the heavy include runs once, at completion.
- **Recycle starvation** — under continuous load the pool is never idle,
  so recycling *must not* wait for natural idleness; the draining gate
  forces it. Conversely the gate adds up to one page-duration of latency
  every N pages — same cost as today's between-batch barrier.
- **Job-table churn** — a 1000-page audit now writes ~1001 Job rows plus
  PSI/PDF jobs. SQLite handles this fine; Phase 4 can add a terminal-job
  retention sweep if the table grows annoying.
- **Semantics shift on page errors after restart** — a page that was
  mid-flight at crash time is now *re-audited* (claimable `running`)
  instead of cascade-failed. That's the durability payoff, but it means a
  consistently-crashing page burns its job attempts before settling as
  `error` via `onExhausted` — bounded by `maxAttempts: 3`.
