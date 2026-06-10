# Durable Job Queue Phase 3 — Site-Audit Page Loop Design

**Date:** 2026-06-10 · **Roadmap item:** A1 Phase 3 (parent spec:
`2026-06-10-durable-job-queue-design.md`, phase table row 3)
**Status:** spec — Codex-reviewed (accept with named fixes; all eight applied 2026-06-10)

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
  runner and `ada-audit:<id>` PDF groups, untouched (the new
  `@@unique([siteAuditId, url])` index treats their NULL `siteAuditId` as
  distinct, so it never binds them).

## Schema change

One addition: `@@unique([siteAuditId, url])` on `AdaAudit`. Discovery
fan-out must be idempotent at the child-row level — a zombie discover
attempt (timed out at the queue layer but still executing) racing its own
retry could otherwise create duplicate children, which strand as `pending`
or pollute summaries. Active-window job dedup alone can't prevent that;
the DB constraint does. SQLite treats NULLs as distinct in unique indexes,
so standalone single-page audits (`siteAuditId = NULL`) are unaffected.

The migration must first dedupe any existing `(siteAuditId, url)`
duplicates (keep the earliest row per pair, delete the rest) before
creating the index — verify against production data during deploy.

## Design

### Two new job types

**`site-audit-discover`** — one per audit (dedupKey `discover:<siteAuditId>`,
groupKey `site-audit:<siteAuditId>`). Owns the `queued → running` claim,
page discovery, child-row creation, and page-job fan-out. Making this a job
(rather than inline work in `processNext`) is what makes the enqueue step
itself crash-safe: a restart mid-fan-out re-queues the discover job, which
resumes idempotently.

Handler flow:

1. Conditional claim — raw SQL, because it must enforce **one site audit at
   a time at the DB level** (the stateless promoter alone can't — see the
   promoter race below):

   ```sql
   UPDATE "SiteAudit"
   SET "status" = 'running', "startedAt" = <now>, "updatedAt" = <Date.now()>
   WHERE "id" = ? AND "status" = 'queued'
     AND NOT EXISTS (
       SELECT 1 FROM "SiteAudit"
       WHERE "status" IN ('running','pdfs-running','lighthouse-running'))
   ```

   (`updatedAt` set manually — raw SQL bypasses `@updatedAt`.)
   - `count === 1` → fresh run, continue.
   - `count === 0` → read the row:
     - `running` → crash-resume, continue at step 2.
     - `queued` → another audit is active (or won the race) — complete the
       job as a no-op. The active audit's finalize will kick
       `processNext()`, which enqueues a **fresh** discover job (this one
       has left the dedup window by then).
     - terminal (cancelled/error/complete) → no-op; kick `processNext()`.
2. URLs: if `discoveredUrls` is set (pre-discovered at enqueue time, or
   persisted by a previous attempt), parse and use it. Otherwise
   `discoverPages(domain)`, then persist `discoveredUrls` + `pagesTotal`
   with a **first-writer-wins conditional write**: `updateMany({ where:
   { id, discoveredUrls: null }, data: { discoveredUrls, pagesTotal } })`.
   `count === 0` → a racing attempt (zombie past its queue timeout)
   already persisted — re-read the row and use the stored set, so every
   attempt fans out the **same** URL list and `pagesTotal` can never
   diverge from it. This write is also the "discovery done" marker the
   finalizer guard keys off; it always lands before any child rows exist.
3. Child rows: read existing children once, then per-URL `create` with
   `P2002` catch-and-skip (Prisma's `createMany.skipDuplicates` is not
   supported on SQLite). The `@@unique([siteAuditId, url])` index makes
   this idempotent under any zombie/retry interleaving.
4. Fan-out: for every child still in `pending`/`running`, `enqueueJob({
   type: 'site-audit-page', payload: { adaAuditId, siteAuditId, url,
   wcagLevel }, dedupKey: 'page:<siteAuditId>:<url>', groupKey:
   'site-audit:<siteAuditId>' })`. Active-window dedup absorbs re-runs; a
   duplicate job against a settled child no-ops via the child-row claim.
   If an enqueue fails after the child row exists, settle that child via
   `settlePageFailure` (mirrors the PSI/PDF enqueue-failure fallback).
5. If `urls.length === 0`: call `finalizeSiteAudit` (an empty audit
   completes immediately, as today).

Errors: `discoverPages` throws (DNS failure, no sitemap and crawl failed)
→ the job throws → queue retry with backoff. `onExhausted` → fail the
audit via the shared `failSiteAudit()` helper (below). Config:
`concurrency: 1` (there is never a reason to run two discovers),
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

All settle transactions are **array-form `$transaction([...])`** in this
exact order, mirroring psi/pdf-scan:

1. Raw parent counter bump FIRST — `UPDATE "SiteAudit" SET "<counter>" =
   "<counter>" + 1, "updatedAt" = <Date.now()> WHERE id = ? AND EXISTS
   (SELECT 1 FROM "AdaAudit" WHERE id = ? AND status IN (<claimable>))`.
   The `EXISTS` must see the **pre-flip** child state, so the bump cannot
   run after the flip.
2. Conditional child flip second — `updateMany` with the same claimable
   status predicate.

Treat the page as settled iff the child flip's `count === 1` (when the
child was claimable, the `EXISTS` guarantees the bump matched too — same
contract as `settlePsiOutcome`/`settlePdfOutcome`). Never interactive
transactions (2026-06-10 incident).

`settlePageFailure(payload, message)` is the shared failure settle
(claimable `['pending','running']` → child `error` + `pagesError`++ +
finalize), used by `onExhausted` and by the discover handler if a page-job
enqueue fails after the child row exists. Config: `maxAttempts: 3`,
`backoffBaseMs: 30_000`, `timeoutMs: 300_000` (navigation 30 s + settle
5 s + axe on heavy DOMs + a possible browser-recycle drain wait — and
with `LIGHTHOUSE_PROVIDER=local`, the inline Lighthouse run that
`runAxeAudit` performs while holding the page; prod uses `pagespeed`, but
the budget must cover the local branch).

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
queued row, so they enqueue the same dedupKey — one wins, one dedups. But
the promoter alone canNOT enforce one-at-a-time: caller B can pass the
active check, then the worker claims caller A's discover job (audit 1 →
`running`, no longer `queued`), and B's oldest-queued query now returns
audit 2 — two discover jobs for two different audits exist. That's why
the **discover handler's claim carries the `NOT EXISTS` one-active guard**
(above): audit 2's claim matches 0 rows while audit 1 is transient, the
job no-ops, and audit 2 is re-promoted by the next finalize kick. The
promoter is best-effort ordering; the DB claim is the invariant. Kicks
stay where they are today (enqueueAudit, finalizeSiteAudit, both recovery
paths, cancel route) plus the discover handler's no-op paths.

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
   from page-job no-op paths and recovery's finalize-before-fail while the
   audit is `running`. Guard: if `status === 'running' && discoveredUrls
   === null`, return — discovery still owns the row. The discover handler
   always persists `discoveredUrls` + `pagesTotal` in one write before
   creating any child rows, so once `discoveredUrls` is non-null the
   predicate is meaningful.

   **Pre-discovered audits need one more piece:** they have
   `discoveredUrls` set from creation while `pagesTotal` is still 0, so
   the null-guard alone wouldn't protect the window between the discover
   claim and its `pagesTotal` write (e.g. recovery finalize-attempt after
   the discover job exhausted on repeated restarts → `0 >= 0` →
   spuriously complete). Fix: `enqueueAudit` sets `pagesTotal:
   preDiscoveredUrls.length` at creation whenever it stores
   `discoveredUrls`, so the predicate is meaningful from birth. A
   genuinely empty pre-discovered list (`[]`, `pagesTotal` 0) finalizes
   as an empty audit — correct.
2. **Scalar first.** Today finalize starts with `findUnique({ include:
   { pageAudits: { include: { pdfAudits: true } } } })` on every call.
   Page settles add ~one finalize call per page; on a 1000-page audit
   that's 1000 × O(children) loads. Change: read scalars only
   (status + counters + batchId + discoveredUrls); load the children
   `include` only after the drain predicate passes, for the summary build.

Note the interplay with the first-writer-wins persist: pre-discovered
audits have `discoveredUrls` non-null from creation, so the discover
handler's conditional write matches 0 rows and simply uses the stored set
— `pagesTotal` was already set correctly by `enqueueAudit`. The two
fields are therefore always written together (either at creation or by
the discover persist), which is the guard's whole invariant.

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
  up the missing ones without duplicates; **one-active guard**: claim
  matches 0 while another audit is transient, job no-ops, audit stays
  `queued` and is promotable later; **zombie idempotency**: a second
  attempt running the full body against an already-persisted audit
  creates no duplicate children (P2002 skip) and the first-writer-wins
  persist keeps `pagesTotal` consistent with the stored URL set;
  pre-discovered URLs skip discovery; terminal-status no-op kicks
  processNext; zero URLs → finalize → complete; `onExhausted` →
  `failSiteAudit`.
- `handlers/site-audit-page.test.ts` — success (detached PSI): child
  `axe-complete`, `lighthouseTotal`+`pagesComplete` bumped, PSI job
  enqueued; success (local/off): child `complete` + inline LH fields, no
  `lighthouseTotal`; redirected: `pagesRedirected` bumped, no PDF/PSI;
  axe throw → domain settle (`pagesError`, job completes); claim-0 with
  `axe-complete` child → PSI re-enqueued + finalize; claim-0 with terminal
  child → finalize only; `onExhausted` → `settlePageFailure`; double
  settle impossible (conditional claim).
- `handlers/site-audit-page.test.ts` also covers provider branching with
  a mocked `getLighthouseProvider` — `local`/`off` write inline LH fields
  and never bump `lighthouseTotal`.
- `queue-manager.test.ts` rewrite — promoter: no active + oldest queued →
  discover job enqueued (deduped on double-call); active audit → no
  enqueue; **promoter race**: simulate caller B enqueueing a discover for
  audit 2 after audit 1 flipped `running` — audit 2's discover claim
  no-ops on the one-active guard; recovery: `running` parent with active
  group jobs survives both paths; `running` parent with zero jobs gets
  **finalize-then-fail** (explicitly for `running`, not just the PDF/PSI
  transients: drained-but-unfinalized completes, undrained fails);
  `failSiteAudit` cascades + cancels + closes batch + kicks.
- `site-audit-finalizer.test.ts` additions — discovery guard (`running` +
  null `discoveredUrls` → untouched even with all counters 0);
  pre-discovered audit with `pagesTotal` set at creation is not
  spuriously completed mid-discovery; scalar path still completes +
  builds summary when drained.
- `browser-pool.test.ts` additions — full gate state machine: threshold
  reached while pages are still active → gate set, new acquirers wait;
  last active release → Chrome closes, counter resets, waiters resume on
  a fresh browser; idle timer closes after zero-active and is cancelled
  by a new acquire; external `closeBrowser()` (shutdown path) releases
  the gate and leaves no waiter stuck. (Pool tests may need a mockable
  browser factory — follow whatever the existing pool tests do.)

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
- **Migration dedupe** — the `@@unique([siteAuditId, url])` migration
  deletes duplicate child rows from historical audits (keeping the
  earliest per pair). Verify the duplicate count on production before
  deploying; summaries are precomputed JSON on the parent, so deleting
  redundant children only affects per-page detail listings.
