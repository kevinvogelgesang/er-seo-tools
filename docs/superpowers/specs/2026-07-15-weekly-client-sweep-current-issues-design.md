# Weekly Client Sweep + Current Issues — Design

**Date:** 2026-07-15 · **Status:** reviewed (Codex ×1, accept with named fixes — all 17 applied)
**Mockup:** Claude artifact `45d4871d` ("Current Scan Issues — /issues mockup", codex-fixes-applied revision)

## 1. Goal

Every Sunday 6pm Pacific, scan every active client domain with a full site audit
(ADA + live-SEO), then surface the resulting issues two ways:

1. A cookie-gated **`/issues` "Current Scan Issues" page** — the work queue: one row
   per (client, domain, tool, issue type) with honest week-over-week change states.
2. A **Monday 7am Pacific digest email** to support@ — counts, cohort-aware deltas,
   coverage, and a ranked "start here" shortlist. The email is a pointer to the page,
   never an issue database.

The "work 1 hour this week" nudge is **temporary backlog throttling** (Kevin,
2026-07-15): once the issue count evens out, the standing expectation becomes
clearing the list weekly. The nudge must therefore be retire-in-one-line copy, and
the page must work as a full clear-the-list queue, not a top-3 sampler.

## 2. Background (verified code facts this builds on)

- **Cadence:** `weekly:<dow>@HH:MM` parses in `lib/jobs/scheduler.ts` (dow 0–6);
  daily/weekly fire on **server-local time**, and prod runs UTC. Schedule slots are
  exactly-once via `@@unique([scheduleId, scheduledFor])`; a scheduled job row
  carries its slot's `scheduledFor`.
- **Fan-out precedent (D5):** `lib/jobs/handlers/robots-monitor-sweep.ts` — a
  `system-*` schedule fires an enqueue-only sweep job that iterates
  `client.findMany({ where: { archivedAt: null } })`, parses the `Client.domains`
  JSON array through `normalizeClientDomain` (malformed entries skipped), and
  enqueues one child job per domain with a per-domain `dedupKey` so sweep retries
  are idempotent.
- **Enqueue seam:** `queueSiteAuditRequest()` (`lib/ada-audit/queue-request.ts`)
  accepts `clientId`, `domain`, `wcagLevel`, `seoIntent`, `seoOnly`, `requestedBy`,
  `scheduleId`; returns `duplicate` with `existingId` when the domain already has an
  in-flight audit (C2 semantics: the duplicate consumes the slot); auto-injects
  client seed URLs.
- **Both tools per audit:** a full (non-seoOnly) site audit produces a
  `tool:'ada-audit'` CrawlRun at finalize and a `tool:'seo-parser'` live-scan
  CrawlRun written **after** the parent flips `complete` (the `broken-link-verify`
  builder, enqueued last in `finalizeSiteAudit`). Any consumer that needs both must
  gate on the live-scan run existing, not on `status === 'complete'`.
- **Issue identity:** `Finding.dedupKey` is unique per run
  (`@@unique([runId, dedupKey])`); cross-run identity is semantic — run scope:
  (scope, type); page scope: (scope, type, normalized URL). The page-set-aware
  classifier `diffInstancesDetailed` (`lib/services/findings-shared.ts`)
  distinguishes regressed vs new-page and resolved vs not-rescanned.
- **Group presentation model:** `lib/services/client-findings.ts` already groups
  findings per issue type with an `affectedComplete` flag marking incomplete URL
  attribution.
- **Retention:** `pruneScheduledSiteAudits` (`lib/ada-audit/scheduled-retention.ts`)
  keeps `KEEP_LATEST_COMPLETED = 2` completed audits **per schedule** — correct for
  C2 (one schedule = one domain), wrong for a sweep schedule spanning ~30 domains.
  Its schedule query filters `jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE` only.
- **Email:** `lib/notify/` — dark gate `isNotifyEnabled()` (Mailgun env), pure
  content builders, at-least-once send with durable sent-markers (D7 pattern);
  `notifyAdminEmail()` = `NOTIFY_ADMIN_EMAIL || notifyFrom()`.
- **System schedules:** `SYSTEM_SCHEDULES` in `lib/jobs/system-schedules.ts`,
  seeded idempotently at boot; `system-` is a reserved namespace.

## 3. Scope decisions (locked with Kevin, 2026-07-15)

- **D1 — Surfacing model.** Webapp page + summary digest email (his Option 2),
  upgraded per Codex: coverage line, cohort-aware deltas, top-3 shortlist, one
  small `WeeklySweep` campaign record. Full-issue-list email (Option 1) rejected.
- **D2 — Sweep scope.** All active clients, every registered domain
  (D5 grain: `(active client, normalizeClientDomain(domain))`). No opt-in/out in v1.
- **D3 — Times.** Sweep `weekly:1@01:00` (Mon 01:00 UTC = Sun 6pm PDT); digest
  `weekly:1@14:00` (Mon 14:00 UTC = 7am PDT). Fixed UTC — fire times drift one hour
  across DST boundaries; accepted.
- **D4 — Digest timing.** Fixed Monday-morning send regardless of sweep drain
  state. The digest **freezes a snapshot**; late completions count next week.
- **D5 — C2 replacement.** The sweep **replaces per-client scan schedules**.
  ⚠ **Deliberately reverses C2's per-client recurring-scan model** (CLAUDE.md
  "Scheduled scans (C2)"): existing client `scheduled-site-audit` Schedule rows are
  retired at deploy (§6 ops sequence), `ScheduledScansCard` is removed from the
  client page, and the client-schedules POST route is disabled with
  `410 schedule_retired` (Codex #11 — removing only the card would not prevent API
  creation). The rest of the C2 machinery (handler, PATCH/DELETE routes, cadence
  validation) stays in the codebase for now — removal is a separate cleanup.
- **D6 — Bounded-effort copy is temporary.** See §1. Digest nudge line is a named
  constant; page copy says "start here — keep going as time allows".
- **D7 — From the Codex mockup review.** Stale rows (failed domains) render inline,
  dimmed, `STALE · LAST OBSERVED <date>`, excluded from headline counts and deltas
  (not exiled to a side list — conflicts with the clear-the-list end state).
  No assignment/claim state in v1: one designated weekly owner on support,
  coordination outside the app.
- **D8 — Fleet-wide scan profile (Codex #3).** Retiring C2 removes per-client WCAG
  selection. The sweep enqueues every audit with the locked profile
  `{ wcagLevel: 'wcag21aa', seoIntent: true, seoOnly: false }` — the app's
  "Required" default level. Changing the fleet level later is a one-constant
  change; per-client levels return only if a real need appears.

## 4. Architecture

### 4.1 `WeeklySweep` model (the campaign record — the only new table)

One row per sweep **slot**. Fields:

- `id` Int autoincrement; `createdAt`.
- `scheduledFor` DateTime `@unique` — the schedule slot (Codex #1). Identity is the
  slot, not job start time: a manual re-fire or delayed job can never mint a second
  row for the same week or steal the digest. `startedAt` DateTime records first
  execution separately.
- `membershipJson` (versioned `{ v: 1, expectedCount, members: [...] }`, Codex #15)
  — the **frozen cohort**: written in full at first execution BEFORE any enqueue
  (Codex #2), every member `{ clientId, clientName, domain, siteAuditId: null,
  outcome: 'pending' }`. Fan-out then processes pending members and updates each to
  a terminal outcome with a reason code: `enqueued` · `duplicate` (reused existing
  audit id, §4.2 fence) · `shared-domain` (normalized-domain collision — same
  audit id attributed to both clients, Codex #12) · `skipped-archived` /
  `skipped-delisted` (revalidation, Codex #12) · `invalid-domain` · `error`.
  `fanoutCompletedAt` DateTime nullable stamps the end. Retries re-process only
  `pending`/`error` members — re-querying clients mid-week never grows the cohort.
- `snapshotJson` (nullable, versioned `{ v: 1, ... }`) + `snapshotAt` — frozen by
  the digest job (§4.4). **The complete render payload** (Codex #4): selected
  ada/live-scan run ids per member, full renderable issue groups, stale groups,
  no-longer-detected groups, per-(member, tool) coverage classifications, the
  ranked shortlist, aggregate totals, and compact active semantic keys
  `[{ clientId, domain, tool, type, severity, unit, affectedCount }]` (streaks +
  next week's baseline survive Finding/audit retention, Codex #12 of the mockup
  review). The `/issues` page renders **only** this payload once it exists — late
  completions and audit deletions can never make the page disagree with the email.
- `digestSentAt` (nullable) — the D7-style at-least-once marker.

Both JSON fields get strict versioned parsers; unrecognized `v` or shape → treated
as absent with a logged warning, never a crash (Codex #15).

### 4.2 Sweep fan-out (`client-sweep` job + system schedule)

`system-client-sweep` (`weekly:1@01:00`, `immediate: false`) fires the enqueue-only
`client-sweep` job (concurrency 1, maxAttempts 3). Flow:

1. Resolve the slot: upsert `WeeklySweep` on `scheduledFor` (from the job's own
   schedule slot).
2. If `membershipJson` is absent: build the full cohort (active clients ×
   normalized registered domains, malformed skipped; normalized-domain collisions
   collapse to ONE member per (client, domain) sharing one planned audit, stable
   lowest-clientId order) and persist it with all-`pending` outcomes (Codex #2).
3. Process members whose outcome is `pending` or `error`: revalidate the client is
   still active and the domain still registered (`skipped-*` otherwise, Codex #12),
   then `queueSiteAuditRequest({ clientId, domain, wcagLevel: 'wcag21aa',
   seoIntent: true, seoOnly: false, requestedBy: 'sweep', scheduleId:
   <system-client-sweep row id> })` (D8, Codex #3) and record the outcome + audit id.
4. **Duplicate fence (Codex #13):** a `duplicate` result reuses the existing
   in-flight audit ONLY if it is non-seoOnly and its `clientId` is null or matches;
   otherwise record `outcome: 'skipped-conflict'` — the member classifies as
   `failed` at snapshot unless the required runs exist anyway.
5. Stamp `fanoutCompletedAt` when no member is left `pending`. If any member ended
   in a retryable `error`, **throw once at the end** so the worker retries the job;
   per-member successes are already persisted, so the retry resumes precisely
   (Codex #14 — "never abort the loop" and "retry the job" are both kept).

Audits flow through the normal FIFO queue (prospect audits still jump the line,
`queue-order.ts`); Sunday-night drain of ~30 serialized full audits is accepted
and measured post-ship (§11).

### 4.3 Issues aggregation (`lib/services/current-issues.ts`)

Pure-core service, two layers, both operating at **(clientId, domain, tool)**
grain (Codex #7):

- `classifyCoverage(member, tool, currentRuns, previousSnapshot)` →
  **coverageState**: `comparable` (required run present this sweep AND the pair was
  observed in the previous snapshot) · `first-baseline` (no prior observation) ·
  `partial` (crawl capped / live-scan `status:'partial'` / `affectedComplete !==
  true` aggregate — observed findings are shown, absence claims and net deltas are
  suppressed) · `failed` (no completed audit or required run missing at snapshot —
  prior rows go stale). Per tool: ADA can be `comparable` while SEO is `partial`.
  Fleet deltas sum ONLY over domain/tool pairs comparable in both snapshots; email
  wording says "across N comparable domain/tool observations".
- `buildIssueGroups(...)` → groups per (clientId, domain, tool, findingType) with
  **changeState modeled separately from coverageState** (Codex #6): a `partial`
  pair can still prove `new` (positive observation) while its absence/delta claims
  stay suppressed. Change vocabulary: `new` · `worsened +n <unit>` · `fewer −n
  <unit>` · `detected n sweeps` (streak from prior snapshots' semantic keys) ·
  `stale`. **Units are stored per group** (`pages` / `targets` / `groups`) and
  labels render the unit (Codex #9); `approximate: true` renders "≥n" when
  `affectedComplete !== true`. **Severity transitions (Codex #8):** semantic
  identity excludes severity; a warning→critical escalation with unchanged count
  classifies as `worsened` (and downgrade as `fewer`), with the transition carried
  on the group (`severityChanged: 'escalated' | 'downgraded' | null`) for the UI.
  `severity in ('critical','warning')` = actionable; notices carried but flagged.

The digest job runs these layers once and freezes the result; the page renders the
frozen payload (§4.1). Before the Monday snapshot exists, the page shows the
previous sweep's snapshot with a "sweep in progress" banner.

### 4.4 Digest (`sweep-digest` job + system schedule)

`system-sweep-digest` (`weekly:1@14:00`) fires `sweep-digest` (concurrency 1,
maxAttempts 3):

1. **Exact-slot selection (Codex #1):** derive the expected sweep `scheduledFor`
   (same UTC Monday, 01:00) from the digest job's own schedule slot and load THAT
   `WeeklySweep` row — never "newest". Missing row → log + no send (a sweep that
   never fired is an ops signal, not an email).
2. If `snapshotJson` is null: compute the full payload (§4.3) and publish
   **race-safely** (Codex #5): `updateMany({ where: { id, snapshotJson: null },
   data: ... })`; on zero rows updated, re-read and use the winner's snapshot for
   the email — two racers can never send different content.
3. D7 marker flow: read `digestSentAt` → dark-gate (`isNotifyEnabled()`; dark =
   permanent suppression, no stamp, no catch-up — D5 precedent) → build → send →
   conditional stamp. DB/transport failures throw for worker retry; only
   explicitly-permanent malformed data degrades without retry (Codex #14).

Recipient: new `SUPPORT_NOTIFY_EMAIL` env, default
`support@enrollmentresources.com`, deliberately separate from `NOTIFY_ADMIN_EMAIL`.

Content builder `lib/notify/sweep-digest-content.ts` (pure, HTML-escaped, D7
conventions): actionable count + delta "across N comparable domain/tool
observations", new/worsened and no-longer-detected counts, coverage `27/30 scanned
· 24 comparable · 1 partial · 2 failed`, top-3 shortlist (severity × affected
reach, **factual ranking lines only** — no causal inference) with per-item deep
links, and the nudge line as a named constant `DIGEST_EFFORT_NUDGE` (retiring the
1-hour framing = one line). Wording is observation-honest throughout: "no longer
detected", never "fixed"; a failed scan is reported as failed, never as
improvement.

### 4.5 `/issues` page + API

- `GET /api/issues` (cookie-gated, `withRoute`): serves the frozen snapshot payload
  `{ sweep: {…header/tiles}, shortlist, groups[], staleGroups[],
  notComparable[] }` (previous snapshot + `inProgress: true` before Monday).
- `app/(app)/issues/page.tsx` + client components per the approved mockup:
  header (sweep started / snapshot time / coverage), four tiles, "Start here"
  shortlist card, filter bar (Actionable | Critical | Warning | Notices ·
  ADA+SEO/ADA/SEO · Any change/New-worsened · client select · search), flat table
  (flat grain, default sort new/worsened → severity → reach → client), stale rows
  dimmed inline, not-comparable band, collapsed "No longer detected" section. Nav
  entry "Issues". Row links go to the audit results pages
  (`/ada-audit/site/[id]`, `/seo-audits/results/run/[liveScanRunId]`).

## 5. Data flow

```
Mon 01:00 UTC  (= Sun 6pm PDT) system-client-sweep → client-sweep job
                 → WeeklySweep upsert on scheduledFor
                 → cohort frozen (all-pending membership) BEFORE fan-out
                 → queueSiteAuditRequest × ~30 (wcag21aa, seoIntent, requestedBy
                   'sweep') → normal queue drains overnight
                 → each audit: ada run at finalize, live-scan run post-terminal
Mon 14:00 UTC  system-sweep-digest → sweep-digest job
                 → exact-slot WeeklySweep lookup (own slot − 13h)
                 → compute + race-safely publish snapshotJson (classifications,
                   groups, shortlist, totals, semantic keys) vs previous snapshot
                 → Mailgun email to SUPPORT_NOTIFY_EMAIL → stamp digestSentAt
Any time       /issues → GET /api/issues → frozen snapshot payload;
                 pre-snapshot → previous sweep's snapshot + in-progress banner
```

## 6. Retention, schema, and C2 retirement ops

- **Migration `20260716000000_weekly_sweep`:** `WeeklySweep` table (§4.1). No
  `SiteAudit` changes — membership lives on the sweep row.
- **Retention fix (prerequisite):** `pruneScheduledSiteAudits` — (a) the schedule
  query must include BOTH `scheduled-site-audit` AND `client-sweep` jobTypes
  (Codex #10: today's filter would exempt sweep audits from pruning entirely);
  (b) the keep-set becomes per **(scheduleId, domain)** — `KEEP_LATEST_COMPLETED
  = 2` per domain. Backward compatible: C2 schedules are single-domain. Sweep
  audits inherit the weekly class (90-day window) via the schedule cadence.
- **`WeeklySweep` retention:** keep 26 rows (~6 months of week-over-week history,
  bounded snapshots), pruned in `runCleanup()`. `digestSentAt`-less rows older than
  14 days are prunable too (dead sweeps).
- **C2 retirement ops sequence (Codex #11), scripted at deploy:** for each client
  `scheduled-site-audit` Schedule row: (1) run the existing per-schedule retention
  prune ONCE (so historical audits get their normal cadence-window deletion before
  going manual-class forever), (2) cancel its `schedule:<id>` job group (queued
  wrappers die; a running wrapper no-ops on its own schedule revalidation), (3)
  DELETE the row (existing C2 semantics SetNull historical audits to
  manual-class — bounded leftover set, acceptable). Code side: remove
  `ScheduledScansCard` from the client page; client-schedules POST returns
  `410 schedule_retired`; PATCH/DELETE stay for stragglers.

## 7. Error handling & invariants

- Cohort is frozen before fan-out; retries process only `pending`/`error` members
  and **throw once at the end** if retryable errors remain (worker retry resumes
  precisely; Codex #14). Zero-domain clients simply contribute no members.
- The digest job's snapshot publication is single-winner (`updateMany` fenced on
  `snapshotJson: null` + loser re-read); `snapshotJson`, once written, is
  immutable. Snapshot compute failure leaves it null and throws for retry.
- Corrupt/unversioned `membershipJson`/`snapshotJson` in a prior sweep → that
  sweep treated as absent (pairs become `first-baseline`), logged, never a crash,
  never a fake "resolved" (Codex #15).
- Email honesty invariants: deltas only across comparable domain/tool pairs;
  absence claims suppressed for `partial`; positive observations (`new`) allowed
  on `partial`; "no longer detected", never "fixed"; coverage drop can never
  present as improvement.
- All multi-statement writes use array-form `$transaction` (repo invariant).
- The digest send is at-least-once with a narrow dup window (marker after send),
  identical to D7.

## 8. Out of scope / future work (breadcrumbed)

- Triage workflow (dismiss / accepted-risk / assignment / claimed state) — revisit
  when support actively maintains state; keyed on semantic issue identity, not
  Finding rows.
- Causal "why" analysis on shortlist items (template-change detection etc.).
- Notices in the digest email (page-only, behind the filter).
- Removing C2 machinery (handler, PATCH/DELETE routes, cadence validation, UI
  code) — cleanup PR after the sweep has run for a few weeks.
- Per-client sweep opt-out flag and per-client WCAG levels (add on real need).
- Sweep drain-time telemetry → stagger decision (measure first, §11).

## 9. Testing

- **Pure core:** `classifyCoverage` (all four coverage states, per-tool split,
  corrupt prior snapshot, first sweep ever) · `buildIssueGroups` (change vocabulary
  incl. streaks from semantic keys and streak reset across partial/missing weeks,
  unit-parameterized labels, ≥-approximate, severity escalation with unchanged
  count → `worsened`, same count with changed URL set, notices excluded from
  actionable) · `sweep-digest-content` (frozen-fixture email, escaping, nudge
  constant, empty/degraded states) — vitest, fixture-pinned.
- **Handlers (Codex #16):** `client-sweep` — cohort frozen before fan-out and
  stable across retry (mid-week client addition NOT admitted), pending/error-only
  reprocessing, duplicate fence (manual reuse OK; `seoOnly`/foreign-client
  duplicate → `skipped-conflict`), shared-domain collision (two clients, one
  audit, both members), revalidation skips, throw-at-end on residual errors ·
  `sweep-digest` — exact-slot selection (manual re-fire cannot steal it; missing
  row no-sends), snapshot immutability + loser re-read, late completion excluded
  from frozen payload, deleted member audit tolerated, marker idempotency,
  dark-gate no-stamp — DB-backed per house conventions.
- **Retention:** per-(schedule, domain) keep-set proof (one schedule, two domains,
  five completed audits each → 2 kept per domain; C2 single-domain unchanged) AND
  `client-sweep`-jobType schedules included in the prune query (Codex #10/#16).
- **Route/page:** `GET /api/issues` shape + pre-snapshot fallback banner state.

## 10. Acceptance criteria

1. Monday 01:00 UTC (Sunday 6pm Pacific): cohort frozen, then one full audit
   (wcag21aa, seoIntent) enqueued per active-client domain; membership outcomes
   recorded; retry-safe; prospect scans still preempt.
2. Monday 14:00 UTC: the slot's snapshot frozen race-safely, digest sent once to
   `SUPPORT_NOTIFY_EMAIL` (dark env → no send, no stamp, no error), email numbers
   and `/issues` render from the SAME frozen payload.
3. `/issues` renders the approved mockup states: tiles, shortlist with links,
   filters, flat grain, change chips (`NEW`/`WORSENED +n <unit>`/`FEWER −n
   <unit>`/`DETECTED n SWEEPS`/`FIRST BASELINE`/`PARTIAL`/`STALE`), stale-inline,
   not-comparable band.
4. A failed/capped/late domain never produces a resolution or a delta; reduced
   coverage never reads as improvement; a partial scan may still prove `new`.
5. C2 retirement complete per §6 ops sequence: rows pruned-then-deleted, job
   groups cancelled, card removed, POST 410s; C14 prospect flows and manual audits
   unaffected.
6. `tsc --noEmit` + vitest + `npm run build` green (Codex #17; in-build type-check
   stays disabled — the build gate catches bundling/SSR breakage, not types).

## 11. Post-ship verification

First live sweep: measure wall-clock drain (enqueue → last live-scan run), confirm
the Monday snapshot found ≥90% of domains complete, and record drain time in the
tracker. If drain spills past Monday 14:00 UTC materially, revisit stagger
(out-of-scope hook, §8).
