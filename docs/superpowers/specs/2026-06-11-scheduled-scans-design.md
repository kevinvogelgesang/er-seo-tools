# C2 — Scheduled Recurring Site Audits + Score Deltas — Design

**Date:** 2026-06-11 · **Status:** Draft for Codex review
**Roadmap:** `../nyi/improvement-roadmaps/02-ada-audit.md` Phase 2 · Tracker item C2
**Depends on:** A1 (durable queue + Schedule table) ✓ · C1 (standalone ADA durable) ✓

---

## 1. Problem & goals

Every audit today is human-triggered. The 02-doc's Phase 2 wants: client → cadence
scan schedules whose results attach to the client timeline, score-level deltas
(honestly scoped — violation-level run-over-run diffing is C3), triage checks
carried forward across runs, and — per the DB-growth gate decided 2026-06-10 —
a **cadence-aware retention class for scheduled-run artifacts** before anything
nightly is ever enabled.

Verified current state (matters — the doc was written before A1/B1/B2 landed):

- `Schedule` already has `clientId Int?` (FK → Client, **Cascade**), `payload`,
  cadence parsing (`every:N{m,h,d}`, `daily@HH:MM`, `weekly:DOW@HH:MM`), an
  exactly-once-per-slot tick that enqueues `jobType` with `payload` and
  `groupKey: schedule:<id>`, and a reserved `system-` name namespace
  (client schedules carry `name: null`).
- The client dashboard **already reads and displays** `Schedule` rows for the
  client (`client-dashboard.ts:106` → `ClientHeader` "No scheduled scans" line),
  and archiving a client already disables its schedules (`PATCH /api/clients/[id]`).
- Score-level deltas **already exist**: `ScoreSeries.delta`, score-drop alerts
  (`SCORE_DROP_THRESHOLD=10`), sparklines (B1), and type-level regression chips
  via `newCriticalTypes` (B2) — all keyed off `CrawlRun.score`/`Finding`, which
  scheduled runs feed automatically once `clientId` is set.

So C2 is precisely: **(a)** the schedule→enqueue wrapper job, **(b)** monthly
cadence support, **(c)** schedule CRUD API + dashboard management card,
**(d)** triage-check carry-forward, **(e)** the cadence-aware retention class,
**(f)** scheduled-run attribution on existing surfaces. No new delta math.

## 2. Non-goals

- **No violation-level diffing** (new/resolved/unchanged) — that is C3.
- **No notifications** — regression surfacing stays the existing dashboard
  badge/chips (02-doc defers notify to "later").
- **No nightly/daily cadences in v1.** The DB-growth gate's verdict: weekly and
  monthly human-cadence scans are safe; nightly is not while child
  `AdaAudit.result` blobs (~100s of KB/page) persist per run. The CRUD route
  rejects daily-class cadences (`cadence_not_allowed`); the retention class is
  built cadence-aware so enabling daily later (post-C3, when blobs become
  prunable-on-arrival) is a one-constant change. This is the honest reading of
  the gate — retention alone does not make nightly×fleet safe at current blob
  sizes.
- **No scheduled standalone page audits** — schedules trigger site audits only.
- **No scheduling for SEO-parser** (no live SEO source until C5/C6; this phase
  is the substrate C6 rides on, not C6 itself).
- **No edit-in-place** of a schedule's cadence/level in v1 — delete + recreate
  (the card makes this one click each; avoids nextRunAt-recompute edge cases).
  Pause/resume (enabled toggle) IS supported.

## 3. Approaches considered

1. **Domain `ScanSchedule` table + parallel scheduler** — rejected (handoff:
   parallel scheduler is a NO; duplicates A1's tick/slot machinery).
2. **`Schedule.jobType = 'site-audit-discover'` directly** — rejected:
   discover jobs require an existing `SiteAudit` row id; the tick would have to
   create domain rows, bloating the scheduler core.
3. **Client-owned `Schedule` rows firing a thin `scheduled-site-audit` job
   whose handler calls `queueSiteAuditRequest()`** — chosen. The scheduler
   stays generic; the wrapper job inherits durability/retry; the existing
   one-active-site-audit DB claim, dedup, queue promoter, finalizer, recovery,
   and findings dual-write all apply unchanged because the scheduled path joins
   the queue exactly where the manual POST route does.

## 4. Schema change (one migration)

```prisma
model SiteAudit {
  // … existing …
  scheduleId  String?
  schedule    Schedule? @relation(fields: [scheduleId], references: [id], onDelete: SetNull)
  @@index([scheduleId])
}

model Schedule {
  // … existing …
  siteAudits  SiteAudit[]   // reverse relation (required by Prisma validation)
}
```

- `scheduleId` is the attribution + retention marker: non-null ⇒ this audit was
  created by a schedule. `SetNull` on schedule delete ⇒ orphaned runs become
  manual-class (never pruned by the new retention class) — deliberately
  non-destructive.
- Hand-written migration SQL (local `prisma migrate dev` is interactive-only),
  applied with `prisma migrate deploy`. Nullable column + index: no backfill,
  no data risk.
- No `Schedule` schema change. Client schedules: `name: null`,
  `clientId: <id>`, `jobType: 'scheduled-site-audit'`,
  `payload: {"clientId":…,"domain":"…","wcagLevel":"…"}`.

## 5. Monthly cadence (`lib/jobs/scheduler.ts`)

Add `monthly:<DOM>@HH:MM` with DOM 1–28 (28-cap sidesteps month-length math) to
`parseCadence()` + `nextRun()`: next occurrence of that day-of-month at HH:MM
server-local, strictly after `from`; missed slots collapse to one run (same
semantics as `daily`/`weekly`). Pure-function change + unit tests; no callers
need touching (`Cadence` type gains a variant).

## 6. New job type: `scheduled-site-audit`

`lib/jobs/handlers/scheduled-site-audit.ts`, registered in
`handlers/register.ts`. Config: `concurrency: 1`, `maxAttempts: 3` (default
backoff — a transient enqueue failure must not wait a week for the next slot),
`timeoutMs: 30_000` (it only enqueues).

Handler, payload `{ clientId, domain, wcagLevel }` (re-validated, never
trusted stale):

1. Resolve the schedule: read the `Job` row by `ctx.jobId` and select its
   `scheduleId` (Codex fix — `JobHandlerContext` exposes only
   `jobId`/`attempt`/`signal`, and the scheduler does not inject `scheduleId`
   into payloads; reading the Job row keeps the scheduler generic). Load that
   Schedule row — if the job has no `scheduleId` or the schedule is
   missing/disabled, no-op complete.
2. Load the client. If missing, archived, or `domain` no longer in
   `client.domains` → **disable the schedule** (`enabled: false`), log
   `[schedule] disabled <id>: <reason>`, complete. Self-healing, never
   destructive to audits.
3. Call `queueSiteAuditRequest({ domain, clientId, wcagLevel, requestedBy: 'scheduled' })`
   — identical semantics to the manual POST route, including the client
   `seedUrls` fallback and in-flight duplicate check.
   - `kind: 'queued'` → set `scheduleId` on the created SiteAudit row (see §6a), done.
   - `kind: 'duplicate'` → log + complete (previous run still in flight —
     correct for a slow site on a weekly cadence; the slot is consumed, no
     pile-up).
   - `kind: 'invalid'` → disable schedule + complete (config rot).
4. DB errors throw (worker retries with backoff). `onExhausted`: log only —
   there is no domain row to fail; the next slot is the durable retry.

**6a. Stamping `scheduleId`:** both `QueueRequestInput` and
`EnqueueAuditOptions` gain an optional `scheduleId` passed through to the
`SiteAudit.create`, so the row is born attributed — no post-create UPDATE race
with the promoter. A test asserts the created row carries `scheduleId` from
birth (not via a follow-up update).

## 7. Schedule CRUD API (internal, behind existing auth)

`app/api/clients/[id]/schedules/route.ts` + `[scheduleId]/route.ts`.
These are UI-facing internal routes — **not** added to `middleware.ts`
`isPublicPath` (the token-route gotcha does not apply; a middleware test
asserts the routes are **not public** — protection is by omission from the
public-path list, which is exactly what the test pins down).

- `GET` — list the client's schedules (any `enabled` state) joined with
  last-run info: latest `SiteAudit` where `scheduleId` matches
  (`id`, `status`, `completedAt`), with scores read from **`CrawlRun.score`
  joined by `siteAuditId`** — the finalizer does not persist `SiteAudit.score`;
  B1 deliberately made `CrawlRun.score` the ADA score source of truth (Codex
  fix #3). Latest + previous completed scheduled scores → `lastDelta`.
  Service: `lib/services/client-schedules.ts` (keeps the route thin, testable
  pure selection).
- `POST` — body `{ domain, cadence, wcagLevel }`. Validation:
  - client exists and is active (archived → 409 `client_archived`);
  - `domain` ∈ `client.domains` (400 `domain_not_listed`);
  - `cadence` parses AND is weekly/monthly class (400 `cadence_invalid` /
    `cadence_not_allowed`);
  - `wcagLevel` ∈ {`wcag21aa`,`wcag22aa`} (defaults `wcag21aa`);
  - at most one schedule per (client, domain): 409 `schedule_exists`.
    **Best-effort v1, by design** (Codex fix #4 — named, not silently weak):
    the check is app-level because `Schedule` is shared infra and the domain
    lives inside the JSON payload, so no clean unique index exists. Two
    racing POSTs could create duplicates; consequence is bounded (the
    in-flight duplicate check in `queueSiteAuditRequest` means at most one
    audit runs per slot window) and the card UI makes duplicates visible and
    deletable. A DB-level guarantee is deferred until a real domain table
    exists for schedules (post-v1, if ever needed);
  - `name` is never accepted from the body (stays `null`; `system-`
    namespace untouchable by construction).
  - Creates with `nextRunAt = nextRun(cadence, now)` (never immediate — an
    analyst wanting a run now just triggers one manually), `jobType` hardcoded.
- `PATCH` — `{ enabled: boolean }` only. Re-enabling recomputes
  `nextRunAt = nextRun(cadence, now)` so a long-paused schedule doesn't fire
  instantly on a stale slot.
- `DELETE` — deletes the row (SiteAudit.scheduleId → SetNull). Queued jobs for
  the schedule: cancel via existing `cancelJobsByGroup('schedule:<id>')`.
  Consequence (intentional, surfaced in the UI confirm copy): the schedule's
  historical audits become manual-class and are **retained as manual history**
  — deleting a schedule never schedules data destruction (see §10).

## 8. UI

- **`ScheduledScansCard`** (client component) on `/clients/[id]`, rendered
  between the scorecard grid and `FindingsPanel`. Lists schedules: domain,
  humanized cadence ("Weekly · Mon 06:00", "Monthly · day 1 06:00"), WCAG
  level, next run, last run (status + score + Δ chip reusing the existing
  delta styling, linking to the audit), pause/resume, delete (confirm).
  Create form: domain `<select>` from client domains, cadence picker
  (weekly: day-of-week + time; monthly: day-of-month 1–28 + time), level
  select. Fetches/mutates the §7 routes; errors surface inline.
- **`ClientHeader` schedules line** — humanize: map
  `scheduled-site-audit` → "site audit" (generic fallback: raw jobType), e.g.
  "Scheduled: site audit (weekly:1@06:00) · next 2026-06-15".
- **Timeline attribution** — `client-dashboard.ts` selects `scheduleId` on
  SiteAudit rows; scheduled items get title suffix " · scheduled". Recents
  list (`/ada-audit` Recents) is untouched in v1.
- Fleet table untouched (alerts/regression chips already fire off scheduled
  runs' CrawlRuns).

## 9. Triage-check carry-forward

Problem: monthly re-audits make analysts re-dismiss identical findings.
`SiteAuditCheck` keys are content-derived sha256 digests (page/page-violation
scope), so identical findings hash to identical keys across runs.

Mechanism: `lib/ada-audit/carry-forward-checks.ts` →
`carryForwardSiteAuditChecks(siteAuditId)`:

1. Load the just-completed audit (`domain`, `completedAt`).
2. Find the previous **completed** `SiteAudit` with the same `domain`
   (latest `completedAt` before this one) — applies to ALL site audits, not
   just scheduled ones (the pain is re-running, however triggered).
   Intentionally domain-keyed, not client-keyed: if the same domain was
   audited under a different (or no) client, the checks still carry — keys
   are content-derived, so a dismissal is about the finding, not the client
   record.
3. Copy its `SiteAuditCheck` rows (`scope`, `key`, `checkedBy` preserved) to
   the new audit, skipping keys already present. SQLite Prisma `createMany`
   has no `skipDuplicates` → read existing keys first, insert the difference
   (chunked, array-form `$transaction`). Re-entry safe via the
   `@@unique([siteAuditId, scope, key])` index (P2002 → tolerate).
4. Keys that no longer match any finding in the new run are inert rows (the
   UI looks up checks by content key computed from current findings) and die
   with the audit row — bounded garbage.

Invocation: in `finalizeSiteAudit`'s completion path, fire-and-forget
(`void …().catch(log)`) **invoked before** the A2 findings hook — "before" is
**invocation order only**; both are unawaited and their writes may overlap in
time, which is fine because they touch disjoint tables (`SiteAuditCheck` vs
the `CrawlRun` subtree). The findings hook stays the LAST invocation
(load-bearing invariant). Carried checks are therefore eventually-visible —
they are NOT guaranteed present on the first post-complete render, and nothing
depends on that. A failure logs `[checks] carry-forward failed` and never
affects the audit.

Standalone `AdaAuditCheck` carry-forward: out of scope (standalone audits
aren't scheduled; revisit if requested).

## 10. Cadence-aware retention (the gate)

New artifact class: schedule-originated SiteAudits accumulate without human
intent, so they get a deletion policy manual audits don't have.

`lib/ada-audit/scheduled-retention.ts` → `pruneScheduledSiteAudits(now?)`,
registered in `runCleanup()`'s `Promise.allSettled` list (daily@09:00 + boot).
**Active immediately — no inert flag.** Unlike A2's `pruneArchivedBlobs` (which
must wait for blob readers), this policy only governs rows that cannot exist
before this PR ships (`scheduleId` is new), so there are no historical
expectations to honor.

Policy, per enabled-or-disabled Schedule row with scheduled audits:

- Window by cadence class at prune time:
  `RETENTION_DAYS = { daily: 14, weekly: 90, monthly: 365 }` (daily entry
  present but unreachable in v1 — cadence creation is gated). ≈ a dozen runs
  retained per schedule at any cadence.
- Candidates: `SiteAudit` where `scheduleId = <id>`, status **terminal**
  (`complete | error | cancelled`), `createdAt < now − window`.
- Guard: always keep the **2 most recent completed** audits per schedule
  regardless of age (preserves the latest human-readable results view and the
  carry-forward source).
- Delete `SiteAudit` rows in chunks (array-form `$transaction`): children
  cascade (`AdaAudit` → its `AdaAuditCheck`s, `PdfAudit`s, `SiteAuditCheck`s);
  **`CrawlRun` survives** (origin FK `SetNull`) with score + findings +
  violations — score series, regression chips, and trends are permanent;
  only the blob-backed results view ages out.
- Orphaned scheduled audits (schedule deleted → `scheduleId` null) are
  manual-class: never pruned by this policy. Deliberate: deleting a schedule
  must not schedule data destruction.
- Screenshot files: covered by existing machinery (verified — Codex fix #8):
  `sweepExpiredScreenshots()` deletes on-disk screenshot directories whose
  `AdaAudit` row no longer exists, so pruning cascaded child `AdaAudit` rows
  leaves no leaked files; the 30-min sweep collects them.

Logging: one `[retention] pruned N scheduled audit(s) (schedule <id>)` line
per schedule with deletions; silence otherwise. No silent caps.

## 11. Score-level deltas (what C2 actually adds)

- Scheduled runs carry `clientId` ⇒ they flow into `buildAdaSeries`
  (CrawlRun-first), `ScoreSeries.delta`, score-drop alerts, `selectRuns` +
  `newCriticalTypes` regression chips, `IssueTrendCard` — **zero new code**.
- New: per-schedule "last run score + Δ vs previous scheduled run" on
  `ScheduledScansCard` (from `client-schedules.ts`, comparing the two most
  recent completed scheduled audits' **`CrawlRun.score`** values joined by
  `siteAuditId` — scalar reads only, no blobs, and no second score source of
  truth).
- Explicitly NOT claimed: violation-level new/resolved/unchanged — C3.

## 12. Error handling & edge cases

| Case | Behavior |
|---|---|
| Slot fires while previous scheduled audit in flight | `duplicate` → log, complete; no pile-up (slot consumed) |
| Client archived after schedule created | Archive PATCH already disables schedules; handler also self-disables if it ever fires |
| Domain removed from client | Handler disables schedule, logs |
| Schedule deleted mid-flight | Queued wrapper jobs cancelled by group; in-flight site audit completes normally, `scheduleId` SetNull |
| Enqueue DB error in handler | Throw → worker retry ×3 backoff; exhausted → log (next slot is the durable retry) |
| Server down across a slot | Existing scheduler semantics: missed slots collapse to one run at next tick |
| Re-enable after long pause | `nextRunAt` recomputed from now (no instant stale fire) |
| Carry-forward failure | Logged, audit unaffected (fire-and-forget) |
| Prune failure | `Promise.allSettled` in `runCleanup` isolates it |

## 13. Testing

- **Scheduler:** `parseCadence`/`nextRun` monthly cases (DOM 1/28, month
  rollover, year rollover, missed-slot collapse, reject DOM 0/29+, malformed).
- **Handler (DB-backed):** queued → SiteAudit born with `scheduleId`;
  duplicate → no second audit; archived client / missing domain → schedule
  disabled; invalid → disabled; DB error → throws; registration test
  (type registered with expected config — C1 pattern).
- **CRUD routes (DB-backed):** POST happy path + every validation error;
  per-(client,domain) 409; PATCH enable recomputes nextRunAt; DELETE cancels
  group jobs + SetNull on audits; GET last-run join + delta; middleware test:
  routes stay auth-protected.
- **Carry-forward (DB-backed):** copies checks by key; skips existing;
  chooses latest previous completed same-domain; no previous → no-op;
  re-entrant (P2002 tolerated); finalizer wiring: fires on completion before
  findings hook, failure logged not thrown (extend existing finalizer tests —
  keep the established mock patterns).
- **Retention (DB-backed):** prunes past-window terminal scheduled audits;
  keeps 2 most recent completed; keeps non-terminal; keeps manual +
  orphaned-scheduled; window varies by cadence; CrawlRun survives with
  findings; cascades verified (checks/pdfAudits gone).
- **Services/UI:** `client-schedules.ts` selection; timeline " · scheduled"
  suffix; ClientHeader humanization; ScheduledScansCard render + create +
  pause + delete flows (jsdom; existing component-test patterns).
- Test hygiene per handoff gotchas: unique domain/name prefixes per file,
  clean `CrawlRun` by domain before origin rows, no new interactive
  transactions anywhere.

## 14. Invariants honored (don't relitigate)

- Array-form `$transaction` only; conditional logic in SQL; manual
  `updatedAt` in raw statements.
- One site audit active at a time — enforced by the existing discover-claim;
  the scheduled path enqueues through `queueSiteAuditRequest` like manual.
- `finalizeSiteAudit` stays the single decision point; findings hook LAST.
- `system-` Schedule namespace untouched; client schedules `name: null`.
- `failSiteAudit` / recovery paths unchanged — scheduled audits are ordinary
  SiteAudits to every existing subsystem.
- Findings layer: never backfill; origin FK SetNull semantics are what make
  the retention class safe.

## 15. Rollout

1. Migration (nullable `scheduleId` + index) — no backfill.
2. Deploy; verify boot seeds system schedules unchanged.
3. Create a weekly schedule on a real client (e.g. proway.erstaging.site,
   small) via the UI. v1 has no "run now", so for prod verification pull
   `nextRunAt` a few minutes out via node+Prisma on the server — same pattern
   as previous prod drills.
4. Watch: tick fires → wrapper job → audit queued → completes → timeline
   shows " · scheduled" → card shows last run + Δ after a second run.
5. Verify carry-forward: dismiss a finding, re-run, dismissal persists.
6. Retention verified by unit tests + a server-side dry query (no 90-day wait).
