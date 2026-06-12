# Standalone ADA Audits onto the Durable Job Queue — Design (C1 remainder)

**Date:** 2026-06-11 · **Status:** spec
**Tracker item:** C1 (ADA orchestration onto the job queue), scope-reconciled against A1.

## Scope reconciliation

The 02-ada-audit roadmap's Phase 1 (C1, budgeted 2–3 wks) named three migrations:
site-audit pages, PSI jobs, and PDF scans. **A1 Phases 1–4 already shipped all
three** (`site-audit-page`, `site-audit-discover`, `psi`, `pdf-scan` job types;
recovery collapsed to the generic transient treatment; maintenance ticks
scheduled). The verified remainder is one path:

- **Standalone single-page ADA audits** still run via fire-and-forget
  `void runAuditInBackground(...)` in `app/api/ada-audit/route.ts:154`. A
  standalone `AdaAudit` row in `pending`/`running` at restart is orphaned
  forever: `recoverQueue()`/`resetStaleAudits()` only treat `SiteAudit` rows,
  and `failOrphanAdaAudits()` only cascades from a failed parent. The client
  poller spins indefinitely.
- **Secondary gap:** standalone-attached `PdfAudit` rows whose durable enqueue
  was lost (crash between row insert and job insert) sit in `pending` forever —
  nothing gates on them, but the UI shows a never-finishing scan.

Everything else in C1 is absorbed; this spec covers only the remainder
(~1–2 days, not 2–3 weeks). After it ships, C1 is complete-with-reconciliation
and C2 (scheduling + score deltas) becomes the next Track C item.

## Goals

1. `POST /api/ada-audit` enqueues a durable `ada-audit` job — a deploy
   mid-audit pauses the audit and the queue resumes it, instead of destroying it.
2. Recovery (startup + the every-10-min stale sweep) fails dead standalone
   audits and stale standalone PDF rows so pollers terminate.
3. Zero schema changes, zero UI changes, POST/GET response shapes unchanged.

## Non-goals

- C2 material: schedules, recurring scans, score deltas.
- A cancel endpoint for standalone audits (doesn't exist today; not added).
- Making the A2 findings dual-write durable — it stays fire-and-forget
  best-effort by invariant (`npx tsx scripts/findings-rebuild.ts <id>` is the fix).
- Inline screenshot capture changes (the 30-min sweep + 24-h TTL already cover
  orphaned files).
- ADA scoring/results-view work (C9).

## Design

### 1. New job type: `ada-audit` (`lib/jobs/handlers/ada-audit.ts`)

Payload `{ adaAuditId, url, wcagLevel }` with the standard assert function.

Registration (in `handlers/register.ts`):

| knob | value | rationale |
|---|---|---|
| concurrency | `ADA_AUDIT_CONCURRENCY`, default 2 | was unbounded (browser pool gated); 2 + `SITE_AUDIT_CONCURRENCY` (prod 2) = `BROWSER_POOL_SIZE` (4), no pool starvation |
| maxAttempts | 3 | crash/timeout retries; domain errors never retry (below) |
| backoffBaseMs | 30 000 | matches site-audit-page |
| timeoutMs | 300 000 | same budget rationale; standalone runs Lighthouse inline within `runAxeAudit` |

Handler flow (transplants `runAuditInBackground`'s body, with the
site-audit-page error semantics):

1. **Claim:** `updateMany({ id, status IN ('pending','running') })` →
   `running`, `startedAt`, `progress: 0`, `progressMessage: 'Starting…'`.
   Count 0 → settled row (idempotent re-run / recovery beat us) → plain return.
   `'running'` is claimable because a crashed attempt leaves the row there;
   the re-run re-audits from scratch (same as site-audit pages).
2. **Progress:** `onProgress` callback writes `progress`/`progressMessage`,
   catch-swallowed — preserved verbatim so `AuditPoller`'s live bar is unchanged.
3. **`runAxeAudit(url, wcagLevel, onProgress, { auditId })` throwing is a
   DOMAIN result:** settle to `error` via conditional
   `updateMany({ status IN ('running') })`, job completes — no per-audit retry,
   parity with today's one-shot catch. DB failures THROW → the queue retries
   (transient SQLITE_BUSY coverage).
4. **Redirected:** settle (`redirected`, `finalUrl`, `redirected: true`,
   `progress: 100`, `'Redirected'`, `completedAt`) — field set kept verbatim
   from the current route code — then fire-and-forget
   `writeAdaSingleFindings` (A2 hook, unchanged).
5. **Audited:** `await dispatchPdfScans({ urls: harvestedPdfUrls, adaAuditId,
   sourcePageUrl: url })` **BEFORE** the complete settle. Today the route
   settles first and `void`s the dispatch — a crash between the two loses the
   PDFs with no repair path (the claim guard won't re-enter a `complete` row).
   Dispatch-first closes that window; a crash after dispatch re-runs the whole
   audit and `dispatchPdfScans` is idempotent (per-audit URL dedupe +
   `pdf:ada:<id>:<url>` job dedupKeys). Then settle `complete` (`result`,
   `lighthouseSummary`, `lighthouseError`, `progress: 100`, `'Complete'`,
   `runnerType: 'browser'`, `completedAt`), then fire-and-forget
   `writeAdaSingleFindings` (stays LAST, A2 invariant).
6. All settles are conditional `updateMany` with status guards (never clobber
   a row recovery already flipped). Plain Prisma throughout — no parent
   counters, so no raw SQL and no multi-statement transactions needed.

**`failStandaloneAudit(adaAuditId, message)`** (exported): conditional flip of
`pending|running` → `error` + `completedAt`. Used by:
- `onExhausted` → `Audit job failed after ${attempts} attempts: ${lastError}`.
- The route's enqueue-failure fallback (below).

### 2. Route change (`app/api/ada-audit/route.ts`)

- Delete `runAuditInBackground` (logic moves to the handler).
- POST: create the `AdaAudit` row exactly as today, then
  `await enqueueJob({ type: 'ada-audit', payload, dedupKey: 'ada-audit:<id>',
  groupKey: 'ada-audit:<id>' })`, then return the unchanged
  `202 { id, status: 'pending' }`. The groupKey deliberately matches the one
  `dispatchPdfScans` already uses for standalone PDFs, so
  `countActiveJobsByGroup('ada-audit:<id>')` measures whole-audit liveness.
- Enqueue throws → best-effort `failStandaloneAudit(id, 'Failed to enqueue
  audit job')` → `500 { error: 'Failed to queue audit' }`. (New observable
  transition; previously the fire-and-forget could only fail silently.)

### 3. Recovery (`lib/ada-audit/standalone-recovery.ts`)

New module exporting `recoverStandaloneAudits()`. `AdaAudit`/`PdfAudit` have
**no `updatedAt`** column, and none is added: job state is the liveness source
of truth. Active jobs include queued-in-backoff rows, so any legitimately
in-flight audit — however old — has ≥1 active job in its group; a
`createdAt < now − 5 min` threshold exists only to guard the seconds-wide
create→enqueue race in the POST route (and the equivalent PDF insert→enqueue
window).

1. **Audits:** find `AdaAudit { siteAuditId: null, status IN
   ('pending','running'), createdAt < now − 5 min }`. Per row:
   `countActiveJobsByGroup('ada-audit:<id>')` —
   - count read **fails** → log + skip this pass (a transient read error must
     never bias toward the destructive path; same rule as
     `recoverOrFailTransient`);
   - count > 0 → resume (leave alone);
   - count 0 → flip to `error` (`'Audit interrupted (server restarted or job
     lost)'`, `completedAt`).
2. **Standalone PDFs:** find `PdfAudit { siteAuditId: null, adaAuditId: not
   null, status IN ('pending','scanning'), createdAt < now − 5 min }`, grouped
   by `adaAuditId`; zero active jobs in that audit's group → flip those rows to
   `error` (`scanError: 'PDF scan interrupted (server restarted or job
   lost)'`). Conservative by design: a live sibling job in the group defers the
   flip to a later pass (sweep runs every 10 min).

Call sites, both appended after the existing site-audit treatment and
caught/logged so a standalone failure can never block site-audit recovery:
- `resetStaleAudits()` — the every-10-min `stale-audit-reset` scheduled job.
- `recoverQueue()` — once at startup.

**Deploy-migration note:** standalone audits in flight at the moment this
change deploys lost their in-process promise with the old process; they have
no durable jobs, so first-boot recovery flips them to `error`. That is the
correct disposition, and it is also exactly the cleanup the production fleet
needs for any pre-existing stuck rows.

### 4. Explicitly unchanged

`AuditPoller` and both GET routes (status strings and progress fields are
identical), share links, screenshots, `AdaAuditCheck` carry-over, the findings
dual-write contract, and the Prisma schema. A standalone audit may now sit in
`pending` a few seconds longer (worker poll ≤ 5 s + concurrency 2); the poller
already renders that state.

## Testing

- **Handler** (`lib/jobs/handlers/ada-audit.test.ts`, mirroring
  `site-audit-page.test.ts`): payload assert; claim no-op on settled rows;
  domain-error settle (job completes, no throw); redirect settle; complete
  settle with **dispatch-before-settle order asserted**; dual-write hook fired
  after settle (and never throwing into the handler); `onExhausted` flips only
  non-terminal rows; conditional settle never clobbers a recovery-flipped row.
- **Route**: POST enqueues with the right type/dedupKey/groupKey and still
  returns `202 { id, status: 'pending' }`; enqueue failure → row flipped to
  `error` + 500.
- **Recovery** (`standalone-recovery.test.ts`): young rows untouched;
  active-jobs → resume; zero-jobs → flip; count-read error → skip; PDF sweep
  flips only when the group is drained; site-audit children
  (`siteAuditId != null`) never touched.
- DB-backed test files use their own unique domain/id prefixes (existing
  suite gotcha).

## Risks / trade-offs

- **Re-run cost:** a crash mid-audit re-runs axe from scratch on resume — same
  trade-off already accepted for site-audit pages.
- **Duplicate-audit window:** dedupKey is per-row (`ada-audit:<id>`), so two
  POSTs for the same URL still create two audits — unchanged from today,
  intentional (analysts re-run URLs deliberately).
- **Throughput:** concurrency 2 serializes bursts of standalone audits that
  previously ran 4-wide against the pool; acceptable, and it stops standalone
  bursts from starving site audits.

## Tracker disposition after ship

Mark C1 `[x]` with the reconciliation note (Phase-1 scope mostly absorbed by
A1; remainder = this spec). Next Track C item: C2 — scheduled recurring audits
+ score-level deltas (with its DB-growth retention gate).
