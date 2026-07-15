# Weekly Client Sweep + Current Issues — Design

**Date:** 2026-07-15 · **Status:** draft (Codex review pending)
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
  daily/weekly fire on **server-local time**, and prod runs UTC.
- **Fan-out precedent (D5):** `lib/jobs/handlers/robots-monitor-sweep.ts` — a
  `system-*` schedule fires an enqueue-only sweep job that iterates
  `client.findMany({ where: { archivedAt: null } })`, parses the `Client.domains`
  JSON array through `normalizeClientDomain` (malformed entries skipped), and
  enqueues one child job per domain with a per-domain `dedupKey` so sweep retries
  are idempotent.
- **Enqueue seam:** `queueSiteAuditRequest()` (`lib/ada-audit/queue-request.ts`)
  accepts `clientId`, `domain`, `wcagLevel`, `requestedBy`, `scheduleId`; returns
  `duplicate` with `existingId` when the domain already has an in-flight audit
  (C2 semantics: the duplicate consumes the slot); auto-injects client seed URLs.
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
  deleted at deploy (ops step), and `ScheduledScansCard` is removed from the client
  page. The C2 machinery (handler, routes, cadence validation) stays in the
  codebase for now — removal is a separate cleanup, not this feature.
- **D6 — Bounded-effort copy is temporary.** See §1. Digest nudge line is a named
  constant; page copy says "start here — keep going as time allows".
- **D7 — From the Codex mockup review.** Stale rows (failed domains) render inline,
  dimmed, `STALE · LAST OBSERVED <date>`, excluded from headline counts and deltas
  (not exiled to a side list — conflicts with the clear-the-list end state).
  No assignment/claim state in v1: one designated weekly owner on support,
  coordination outside the app.

## 4. Architecture

### 4.1 `WeeklySweep` model (the campaign record — the only new table)

One row per sweep firing. Fields:

- `id` Int autoincrement; `createdAt`.
- `slotStartedAt` DateTime `@unique` — the sweep job row's `createdAt` (D5's durable
  slot-boundary pattern): retries of the same sweep job reuse the row.
- `membershipJson` — frozen at fan-out: per domain `{ clientId, clientName, domain,
  siteAuditId | null, enqueueOutcome: 'enqueued' | 'duplicate' | 'invalid' | 'error' }`.
  `duplicate` records the existing in-flight audit's id (it consumes the slot, C2
  precedent). `CrawlRun` rows survive audit deletion via SetNull, but membership
  stores ids only — readers must tolerate deleted audits.
- `snapshotJson` (nullable) + `snapshotAt` — frozen by the digest job (§4.4):
  aggregate counts, per-domain/per-tool comparability classification, the ranked
  shortlist, **and compact active semantic keys**
  `[{ clientId, domain, tool, type, severity, affectedCount }]` so `DETECTED n
  SWEEPS` streaks and future deltas survive Finding/audit retention (Codex #12 —
  issue-type grain keeps this small, no per-issue rows).
- `digestSentAt` (nullable) — the D7-style at-least-once marker.

### 4.2 Sweep fan-out (`client-sweep` job + system schedule)

`system-client-sweep` (`weekly:1@01:00`, `immediate: false`) fires the enqueue-only
`client-sweep` job (concurrency 1, maxAttempts 3, modeled on
`runRobotsMonitorSweep`): upsert the `WeeklySweep` row keyed on `slotStartedAt`,
iterate active clients' normalized domains, call `queueSiteAuditRequest({ clientId,
domain, requestedBy: 'sweep', scheduleId: <system-client-sweep row id> })` for each
domain **not already recorded in `membershipJson`** (a retried sweep resumes where
it stopped — membership is the idempotency record), and write the outcome per
domain. Audits flow through the normal FIFO queue (prospect audits still jump the
line, `queue-order.ts`); Sunday-night drain of ~30 serialized full audits is
accepted and measured post-ship (see §11).

`scheduleId` stamping makes sweep audits schedule-class, which gives pruning and
the "· scheduled" audit labeling for free — but requires the §8 retention fix
first.

### 4.3 Issues aggregation (`lib/services/current-issues.ts`)

Pure-core service, two layers:

- `classifySweepDomains(sweep, previousSweep, audits, runs)` — per (domain, tool)
  comparability: `comparable` (complete + tool run present in both sweeps) ·
  `first-baseline` (no prior observation) · `partial` (crawl capped /
  `status:'partial'` live-scan / `affectedComplete !== true` aggregate — observed
  findings shown, absence claims and deltas suppressed; per **tool**, not per
  domain: ADA can be comparable while SEO is partial) · `failed` (no completed
  audit or missing tool run at snapshot — prior rows go stale) (Codex #2/#4).
- `buildIssueGroups(...)` — one group per (clientId, domain, tool, findingType) from
  the sweep's member audits' findings runs, `severity in ('critical','warning')` =
  actionable, notices carried but flagged. Change state vocabulary (Codex #3):
  `new` · `worsened +n pages` · `fewer −n pages` · `detected n sweeps` (streak from
  prior snapshots' semantic keys) · `first-baseline` · `partial` · `stale`.
  Counts carry issue-specific units (pages / targets / groups) + `approximate`
  when `affectedComplete !== true` (renders "≥n") (Codex #9).

The **page headline numbers come from `snapshotJson`** once it exists (email and
page can never disagree, Codex #1); the row table is computed at read time from the
frozen membership. Before the Monday snapshot, the page shows the previous sweep
with a "sweep in progress" banner.

### 4.4 Digest (`sweep-digest` job + system schedule)

`system-sweep-digest` (`weekly:1@14:00`) fires `sweep-digest` (concurrency 1,
maxAttempts 3): load the newest `WeeklySweep`; if `snapshotJson` is null, compute
and persist it (first terminal write wins — the snapshot is immutable once
written); then the D7 marker flow: read `digestSentAt` → dark-gate
(`isNotifyEnabled()`; dark = permanent suppression, no catch-up — D5 precedent) →
build → send → conditional stamp. Recipient: new `SUPPORT_NOTIFY_EMAIL` env,
default `support@enrollmentresources.com`, deliberately separate from
`NOTIFY_ADMIN_EMAIL` (Codex #7, first consultation).

Content builder `lib/notify/sweep-digest-content.ts` (pure, HTML-escaped, D7
conventions): actionable count + delta "across N comparable domains", new/worsened
and no-longer-detected counts, coverage `27/30 scanned · 24 comparable · 1 partial
· 2 failed`, top-3 shortlist (severity × affected reach, **factual ranking lines
only** — no causal inference, Codex #6) with per-item deep links, and the nudge
line as a named constant `DIGEST_EFFORT_NUDGE` (retiring the 1-hour framing = one
line). Wording is observation-honest throughout: "no longer detected", never
"fixed"; a failed scan is reported as failed, never as improvement.

### 4.5 `/issues` page + API

- `GET /api/issues` (cookie-gated, `withRoute`): `{ sweep: {…header/tiles from
  snapshot}, shortlist, groups[], staleGroups[], notComparable[] }`.
- `app/(app)/issues/page.tsx` + client components per the approved mockup:
  header (sweep started / snapshot time / coverage), four tiles, "Start here"
  shortlist card, filter bar (Actionable | Critical | Warning | Notices ·
  ADA+SEO/ADA/SEO · Any change/New-worsened · client select · search), flat table
  (Codex #8: flat grain, default sort new/worsened → severity → reach → client),
  stale rows dimmed inline, not-comparable band, collapsed "No longer detected"
  section. Nav entry "Issues". Row links go to the audit results pages
  (`/ada-audit/site/[id]`, `/seo-audits/results/run/[liveScanRunId]`).

## 5. Data flow

```
Mon 01:00 UTC  (= Sun 6pm PDT) system-client-sweep → client-sweep job
                 → WeeklySweep row (membershipJson frozen as outcomes land)
                 → queueSiteAuditRequest × ~30 → normal queue drains overnight
                 → each audit: ada run at finalize, live-scan run post-terminal
Mon 14:00 UTC  system-sweep-digest → sweep-digest job
                 → compute + freeze snapshotJson (classify, aggregate, shortlist,
                   semantic keys) vs previous sweep's snapshot
                 → Mailgun email to SUPPORT_NOTIFY_EMAIL → stamp digestSentAt
Any time       /issues → GET /api/issues → snapshot headline + read-time rows
                 from frozen membership; pre-snapshot → previous sweep + banner
```

## 6. Retention & schema changes

- **Migration `20260716000000_weekly_sweep`:** `WeeklySweep` table (§4.1). No `SiteAudit`
  changes — membership lives on the sweep row.
- **Retention fix (prerequisite):** `pruneScheduledSiteAudits` keep-set becomes
  per **(scheduleId, domain)** — `KEEP_LATEST_COMPLETED = 2` per domain. Backward
  compatible: C2 schedules are single-domain, so their keep-set is unchanged.
  Sweep audits inherit the weekly class (90-day window) via the schedule cadence.
- **`WeeklySweep` retention:** keep 26 rows (~6 months of week-over-week history,
  bounded snapshots), pruned in `runCleanup()`. `digestSentAt`-less rows older than
  14 days are prunable too (dead sweeps).
- **Ops step at deploy:** delete existing client `scheduled-site-audit` Schedule
  rows (D5 ruling). Their historical audits SetNull to manual-class (existing C2
  DELETE semantics) and are never pruned — acceptable, bounded set.

## 7. Error handling & invariants

- Sweep enqueue failures record `enqueueOutcome:'error'` per domain and never abort
  the loop; job retry resumes from membership. Zero-domain clients are skipped.
- The digest job **never throws into the worker** (`logError` + rethrow only for
  retryable DB errors); a poisoned snapshot compute leaves `snapshotJson` null so
  the retry recomputes; `snapshotJson`, once written, is immutable.
- Corrupt/unparseable `snapshotJson` or `membershipJson` in a prior sweep → that
  sweep is treated as absent (domains become `first-baseline`), never a crash, and
  never a fake "resolved".
- Email honesty invariants: deltas only across comparable domains; absence claims
  suppressed for partial tools; "no longer detected", never "fixed"; coverage
  drop can never present as improvement.
- All new tables written with array-form `$transaction` only (repo invariant).
- The digest send is at-least-once with a narrow dup window (marker after send),
  identical to D7.

## 8. Out of scope / future work (breadcrumbed)

- Triage workflow (dismiss / accepted-risk / assignment / claimed state) — revisit
  when support actively maintains state; keyed on semantic issue identity, not
  Finding rows.
- Causal "why" analysis on shortlist items (template-change detection etc.).
- Notices in the digest email (page-only, behind the filter).
- Removing C2 machinery (routes/handler/UI code) — cleanup PR after the sweep has
  run for a few weeks.
- Per-client sweep opt-out flag (add if a slow/huge site becomes a problem).
- Sweep drain-time telemetry → stagger decision (measure first, §11).

## 9. Testing

- **Pure core:** `classifySweepDomains` (all five states, per-tool split, corrupt
  prior snapshot, first sweep ever) · `buildIssueGroups` (change vocabulary incl.
  streaks from semantic keys, unit labels, ≥-approximate, notices excluded from
  actionable) · `sweep-digest-content` (frozen-fixture email, escaping, nudge
  constant, empty/degraded states) — vitest, fixture-pinned.
- **Handlers:** `client-sweep` (membership idempotency on retry, duplicate-audit
  outcome, invalid-domain skip) · `sweep-digest` (snapshot immutability, marker
  idempotency, dark-gate no-stamp) — DB-backed per house conventions.
- **Retention:** per-(schedule, domain) keep-set proof: one schedule, two domains,
  five completed audits each → 2 kept per domain; C2 single-domain unchanged.
- **Route/page:** `GET /api/issues` shape + pre-snapshot fallback banner state.

## 10. Acceptance criteria

1. Monday 01:00 UTC (Sunday 6pm Pacific): one full audit enqueued per active-client domain; membership
   recorded; retry-safe; prospect scans still preempt.
2. Monday 14:00 UTC: snapshot frozen, digest sent once to `SUPPORT_NOTIFY_EMAIL`
   (dark env → no send, no stamp, no error), numbers match `/issues` exactly.
3. `/issues` renders the approved mockup states: tiles, shortlist with links,
   filters, flat grain, change chips (`NEW`/`WORSENED +n`/`FEWER −n`/`DETECTED n
   SWEEPS`/`FIRST BASELINE`/`PARTIAL`/`STALE`), stale-inline, not-comparable band.
4. A failed/capped/late domain never produces a resolution or a delta; reduced
   coverage never reads as improvement.
5. Existing C2 client schedules deleted at deploy; no new ones creatable from the
   client page (card removed); C14 prospect flows and manual audits unaffected.
6. `tsc --noEmit` + vitest green (the only type gates — in-build checks stay off).

## 11. Post-ship verification

First live sweep: measure wall-clock drain (enqueue → last live-scan run), confirm
the Monday snapshot found ≥90% of domains complete, and record drain time in the
tracker. If drain spills past Monday 14:00 UTC materially, revisit stagger
(out-of-scope hook, §8).
