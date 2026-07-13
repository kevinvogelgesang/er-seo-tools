# D5 — Scheduled robots/sitemap monitoring with change-only alerts

**Date:** 2026-07-13
**Status:** Reviewed — Codex 2026-07-13 verdict "accept with named fixes"; all 8 fixes applied in place (annotated "Codex #N" below)
**Roadmap:** `docs/superpowers/nyi/improvement-roadmaps/05-small-tools.md` step 3 (3–4 days)
**Builds on:** D4 (`lib/robots-check/` — client-attached checks + history, PR #166), A1 (durable job queue), D7 (Mailgun notify layer, dark-gated), C2 (scheduled-site-audit wrapper precedent)

## Problem

D4 gave every client on-demand robots.txt + sitemap checks with history and a
read-time `changed` flag. Nothing runs them unattended. A silently-broken
robots.txt or a sitemap that loses half its URLs costs a client rankings for
weeks before anyone notices. D5 closes the loop: a weekly job re-checks every
registered client domain, and raises an alert ONLY when the observed state
CHANGED since the previous check — a byte-identical fetch is silence;
re-observing a known broken state is silence.

## Decisions (the handoff's open design questions, settled)

1. **Alert channel = D7 Mailgun email to `notifyAdminEmail()` + the existing
   in-app card.** The email is the push channel; the D4 card's `changed`
   badge + a new "what changed" detail section are the pull channel. When the
   notify env is dark (`isNotifyEnabled()` false), the scheduled checks still
   run and history still accrues — the email step no-ops with a log line.
   The D0 ops webhook (`ALERT_WEBHOOK_URL`) is NOT used: that channel is
   infra-health, this is client-SEO state; one channel per audience.
2. **Enablement = one system schedule, automatic for all active clients.**
   `system-robots-monitor`, cadence `weekly:1@06:30` (Monday 06:30
   server-local — clear of `system-db-backup` daily@08:00 and
   `system-cleanup` daily@09:00). No per-client schedule rows, no opt-in UI:
   monitoring that must be opted into is monitoring that's off when the
   regression lands. The check is lightweight (robots + ≤5 sitemaps + ≤20
   children, 60s budget) and only ever touches client-registered domains
   (owner rule 3). C2-style per-client `Schedule` rows were considered and
   rejected for v1 (see Alternatives).
3. **Issue-set-only changes do NOT alert.** The alert predicate is D4's
   read-time evidence — `robotsStatus` + robots `contentHash` + ordered
   sitemap `(url, contentHash, childrenHash)` triples — which is derived
   purely from FETCHED state. A parser upgrade that reclassifies issues over
   unchanged content changes no hash and stays silent (the Codex-flagged
   deferral from D4 stays deferred; revisit only if a real regression is
   missed because of it).
4. **D4 quirks vs alert counts:** the `'unrecognized'` convention-probe
   double-count lives in `totals.errors`, which is NOT part of the alert
   predicate — no impact, left as-is. `childrenExcluded` (stored, unrendered)
   gets rendered in the card's detail view as part of this work (recorded
   follow-up #2 — one line).

## Approaches considered

- **A (chosen): system sweep schedule + per-domain fan-out jobs.** One
  `system-*` Schedule row → a `robots-monitor-sweep` job that enqueues one
  durable `robots-monitor` job per (active client, registered domain).
  Per-domain retry granularity, per-domain timeout, dedup via the queue's
  `(type, dedupKey)` active-window uniqueness, zero management UI.
- **B: C2-style client-owned Schedule rows** (`jobType:
  'robots-monitor'`, one row per (client, domain), pause/delete UI like
  `ScheduledScansCard`). Right shape for expensive, per-client-configurable
  work (site audits); wrong weight for a cheap check that should simply
  always be on. Adds routes, UI, disable-on-rot machinery, and an opt-in gap
  for every new client. Rejected for v1; the fan-out job's payload shape
  keeps this door open (a client-owned schedule could later enqueue the same
  `robots-monitor` job).
- **C: one serial sweep job that runs all checks inline.** ~40 domains ×
  worst-case ~75s each ≈ 50 min inside a single job: one flaky domain's
  retry re-runs everything, and the job timeout has to cover the whole
  fleet. Rejected.

## Architecture

```
Schedule 'system-robots-monitor' (weekly:1@06:30)
  └─ job: robots-monitor-sweep            (fan-out, enqueue-only)
       └─ job: robots-monitor  × (client, domain)
            ├─ re-validate client + domain      (C2 precedent: rot → no-op)
            ├─ runAndStoreRobotsCheck(..., {source:'scheduled'})  (D4, unchanged)
            ├─ changed !== true → done          (change-only gate)
            └─ alert: read marker → build email → send → stamp alertSentAt
```

### New job type: `robots-monitor-sweep`

- Handler for the system schedule. Loads clients with `archivedAt: null`,
  parses each `domains` JSON (same tolerant parse as
  `scheduled-site-audit.ts` — malformed → treated as no domains), runs every
  entry through `normalizeClientDomain` (`lib/security/domain-validation` —
  the SAME normalizer the D4 routes use), SKIPS entries that throw
  `InvalidDomainError` (malformed legacy values must not kill the sweep or
  produce junk rows), and `Set`-dedupes the normalized results per client
  (Codex #5). For each surviving (clientId, domain) it enqueues a
  `robots-monitor` job with payload `{clientId, domain}` and `dedupKey:
  robots-monitor:<clientId>:<domain>`. No groupKey (nothing ever cancels
  these as a group).
- `concurrency: 1, maxAttempts: 3, timeoutMs: 30_000` (it only enqueues; a
  partial failure retried is safe — dedupKey makes re-enqueues no-ops for
  jobs still active).
- No `onExhausted` domain state to clean — log-only (health-alert precedent).

### New job type: `robots-monitor`

- `concurrency: 1` (politeness — one client site fetched at a time),
  `maxAttempts: 2`, `timeoutMs: 120_000` (worst-case check ≈ 75s: 60s soft
  budget + one 15s in-flight fetch overshoot, plus DB writes + email).
- Handler flow (all service/transport/clock access through an injectable
  `deps` seam with a `realDeps` default, `notify-email.ts` precedent —
  tests run fully transport-free; Codex #3):
  1. **Payload guard** — integer `clientId`, non-empty `domain` string;
     malformed → log + complete (no schedule to disable — the sweep owns
     cadence).
  2. **Re-validate FIRST, on every path** (before reuse, before any fresh
     run, therefore always before an alert; Codex #1) — client exists, not
     archived, payload domain still normalizes via `normalizeClientDomain`
     AND is still in the client's `domains` list (C2 precedent; same
     normalizer as the sweep, Codex #5). Config rot → log + complete (never
     destructive; there is no per-domain schedule to disable). DB errors →
     throw (worker retries). A row can no longer be reused or emailed after
     the client was archived or the domain delisted.
  3. **Slot idempotency (job-scoped reuse; Codex #1)** — load this job's
     own `Job.createdAt` via `ctx.jobId`; if a `source: 'scheduled'`
     `RobotsCheck` row for (clientId, domain) exists with `createdAt >=
     job.createdAt`, REUSE the newest such row instead of re-running the
     fetch. The job row is the durable slot boundary: a retry finds attempt
     1's row no matter how long a restart gap was (a wall-clock window
     cannot promise that), so the crash-between-store-and-alert path always
     completes; and a row from a PREVIOUS weekly slot can never be reused
     (its `createdAt` predates this job).
  4. **Fresh run** — `runAndStoreRobotsCheck(clientId, domain, {source:
     'scheduled'})` (D4 service, unchanged — single-flight, predecessor
     comparison). **Source fence (Codex #2):** the D4 single-flight is
     keyed `clientId:domain` and a joiner receives the FIRST caller's row —
     if a concurrent manual POST won, the returned row has `source:
     'manual'`; the handler then completes silently with no alert (the
     documented manual-absorption rule, now enforced in code, not just
     assumed).
  5. **Stored-row resolution (Codex #3)** — with the check row's id in hand
     (from reuse or fresh run), call the extended
     `getRobotsCheck(clientId, checkId)` and use ITS recomputed
     `summary.changed` and `changeSummary` — the one service seam that owns
     the exact total-order predecessor and the raw robots bodies. The
     handler never re-derives comparison evidence itself.
  6. **Change gate** — `changed !== true` → done. `null` (first check ever,
     or corrupt/unreadable predecessor detail) never alerts.
  7. **Alert step** (only when `changed === true` and the row's source is
     `'scheduled'`):
     - Dark gate: `!isNotifyEnabled()` → log `[robots-monitor] change
       detected for <domain> but notify env dark` and complete. No stamp
       (the marker means "email sent", D7 semantics). **Durable meaning
       (Codex #6): dark = PERMANENT suppression of that change's email, not
       pending delivery.** The next weekly row compares against the changed
       row and reads unchanged, so a later un-darkening never back-sends
       old changes — by design (dark = feature off, matching every other
       D7 surface). If catch-up delivery is ever wanted, `alertSentAt`
       alone cannot express it; that would be a new disposition field or a
       durable notify job — explicitly out of scope.
     - Idempotency: read `alertSentAt` on the check row; already stamped →
       done (retry after a sent-but-crashed attempt sends nothing).
     - Build content from the change summary (below) + client name; send via
       `sendEmail({to: notifyAdminEmail(), content})`; then conditional
       stamp `updateMany({where: {id, alertSentAt: null}, data:
       {alertSentAt: now}})`. At-least-once with a narrow duplicate window —
       same trade as D7, priced in.
     - Send failure → throw → worker retry (reuse guard makes the retry
       cheap); exhaustion → log-only `onExhausted` (the next weekly slot
       will NOT re-alert this change — its predecessor will then be the
       changed row — accepted: one lost email requires two consecutive
       failures of a 10s HTTP call, and the in-app badge still shows it).
- **Manual checks never alert.** Alerting lives only in this handler;
  the POST route path is untouched. A manual check that observes a change
  first "absorbs" it (the next scheduled run compares against it and sees no
  change, so no email) — accepted: Kevin was looking at the card when he ran
  it.

### Schema change (one nullable column)

```prisma
model RobotsCheck {
  ...
  alertSentAt DateTime?   // D5: change-alert email sent for this row (idempotency marker)
}
```

Hand-authored migration (`migrate dev` is interactive-only here), applied
with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy`. Additive
nullable column — no table rebuild, no backfill.

### Change summary (shared by email + card)

New pure, client-safe `lib/robots-check/change-summary.ts`:

```ts
buildChangeSummary(prev: PrevInput, curr: CurrInput): RobotsChangeSummary
// inputs: each side's RobotsCheckDetail + robotsContent (string|null)
```

`RobotsChangeSummary` (all fields bounded):
- `robotsStatus: { prev, curr } | null` — null when unchanged
- `robotsContentChanged: boolean` — the two robots content hashes differ
  (Codex #4). This is the honest fallback flag: the D4 alert predicate is
  ORDER- and byte-sensitive while the line diff below is a multiset — a
  reorder or whitespace-only edit alerts with an empty diff, and this flag
  is what lets the email/card say "robots.txt changed (reordering or
  formatting only)" instead of showing a contentless alert.
- `robotsDiff: { added: string[], removed: string[], truncated: boolean } | null`
  — line-level multiset diff of the two robots bodies (trimmed lines,
  comparison keyed on content; caps `ROBOTS_DIFF_MAX_LINES` = 50 per side).
  Multiset (not LCS) is deliberate: robots.txt is line-oriented and largely
  order-insensitive; added/removed lines ARE the story ("GPTBot now
  blocked"). Null when either body is unavailable (robots not ok on that
  side) or when identical.
- `blockedBots: { added: string[], removed: string[] } | null`
- `sitemaps: { added: string[], removed: string[], changed: Array<{url,
  urlCountPrev, urlCountCurr, childrenChanged: boolean}>, orderChanged:
  boolean } | null` — sitemap occurrences identified by **(url, ordinal)**,
  not url alone, so duplicate declared URLs never collapse and a pure
  reorder is reported as `orderChanged: true` rather than vanishing
  (Codex #4). `changed` = same (url, ordinal) with differing contentHash or
  childrenHash.
- `sitemapUrlTotal: { prev: number|null, curr: number|null } | null`
- `counts: { errorsPrev, errorsCurr, warningsPrev, warningsCurr } | null`

**Completeness invariant (Codex #4, tested):** whenever the D4 evidence
strings of the two rows differ (i.e. the alert predicate fires), the summary
carries at least one non-null / non-empty explanatory field — an alert can
never render as "changed, but nothing to show".

Pure function, no imports beyond types — usable by the card (client
component) and the email builder (server). The raw robots bodies stay
server-side; only capped diff LINES cross the API (the D4 rule
"robotsContent MUST be HTML-escaped when rendered" is honored by React's
default escaping in the card and by `escapeHtml` in the email builder).

### Email content

New pure `lib/notify/robots-change-content.ts`:
`buildRobotsChangeEmail({clientName, clientId, domain, summary, appUrl})` →
`EmailContent` (subject/html/text — D7 `content.ts` conventions: every
dynamic string HTML-escaped, tables not floats, no external assets).
Subject: `Robots/sitemap change: <domain>`. Body: status transition, robots
added/removed lines (mono block), sitemap adds/removes/changes with URL-count
deltas, error/warning count movement, link to `/clients/<id>` when
`NEXT_PUBLIC_APP_URL` is set (omitted when unset — unlike D7's notifier the
email's value is its content, not its link, so an unset app URL does not
suppress the send).

**Transport-honest wording (Codex #7):** D4 records fetch failures as
OBSERVATIONS (`unreachable` carries the runner's failure taxonomy — dns /
timeout / policy / invalid-response), so one transient timeout IS a state
change and will alert, and the recovery next run alerts again. v1 accepts
one-observation alerts — the whole point is a human looking within the week
— but the email must phrase status transitions as observations of the
monitor, never as site-configuration claims: "robots.txt could not be
fetched (timeout)" / "robots.txt is reachable again", NOT "robots.txt was
removed". If flapping domains prove noisy in practice, a
confirmation-refetch-before-alert is the recorded follow-up (deliberately
not built now).

### Service + API surface (no new routes, no middleware change)

`getRobotsCheck(clientId, checkId)` grows a third field:
`changeSummary: RobotsChangeSummary | null` — computed at read time against
the same exact total-order predecessor it already loads (non-null only when
the predecessor exists and both details parse). `GET
/api/clients/[id]/robots-checks/[checkId]` (cookie-gated, existing) returns
it verbatim. `listRobotsChecks` unchanged.

### Card rendering

`RobotsCheckCard` detail view adds:
- **"Changed vs previous"** section, rendered only when the loaded detail's
  summary has `changed === true` and `changeSummary` is non-null: robots
  added/removed lines (green/red mono rows), sitemap deltas, count movement.
  Dark-mode variants on every element; no new fetches (rides the existing
  detail GET).
- `childrenExcluded` line in the per-sitemap detail (D4 follow-up #2).

### Registration & config

- `SYSTEM_SCHEDULES` += `{name: 'system-robots-monitor', jobType:
  ROBOTS_MONITOR_SWEEP_JOB_TYPE, cadence: 'weekly:1@06:30', immediate:
  false}` (seeded idempotently at boot; `system-` reserved namespace).
- `register.ts` += both handlers.
- New constants in `lib/robots-check/types.ts` (client-safe):
  `ROBOTS_DIFF_MAX_LINES = 50`. (The reuse boundary is the job row's own
  `createdAt` — no window constant exists; Codex #1.)
- No new env vars. No changes to `lib/seo-fetch` (FROZEN) or to the D4
  runner/retention.

### Retention interplay

Unchanged. Weekly scheduled rows flow into the same keep-LIMIT+1 per
(client, domain) retention (≈5 months of weekly history at LIMIT 20; manual
checks shorten that window — acceptable). `alertSentAt` dies with its row.
The D4 invariant that the oldest VISIBLE row keeps a stable `changed` flag
is untouched.

## Error handling summary

| Failure | Behavior |
|---|---|
| Client archived / domain delisted between sweep and job (or between attempts — revalidation runs before reuse too) | log + complete (no alert, no new row) |
| Concurrent manual check wins the single-flight | scheduled handler completes silently — manual rows never alert (source fence) |
| Malformed / duplicate domain entries in `Client.domains` | sweep normalizes, skips invalid, dedupes — never enqueues junk |
| `runRobotsCheck` throws (network chaos beyond the runner's own taxonomy) | job retry → next weekly slot is the durable fallback |
| Email send fails | throw → retry (reuse guard skips the refetch); exhausted → log, in-app badge still shows the change |
| Notify env dark | checks run, history accrues, changed badges render; email step logs + skips — permanent suppression for that change, never back-sent (Codex #6) |
| Corrupt predecessor detail | `changed: null` → silence (never a false alert) |
| Worker crash between row insert and alert | retry's reuse guard finds the row and completes the alert step |

## Testing

- `change-summary.test.ts` — pure: identical → all-null;
  robots line add/remove; caps + truncated flag; sitemap
  add/remove/changed (contentHash vs childrenHash); null bodies;
  corrupt-shaped inputs; **reorder-only robots change →
  `robotsContentChanged: true` with empty diff; sitemap reorder →
  `orderChanged: true`; duplicate sitemap URLs survive via (url, ordinal);
  completeness invariant — evidence differs ⇒ ≥1 non-null field (Codex
  #4/#8)**.
- `robots-change-content.test.ts` — escaping (`<script>` in a robots line
  never appears raw), subject, link presence/absence by appUrl,
  **transport-honest unreachable wording (Codex #7)**.
- `robots-monitor.test.ts` (handler, DB-backed, injectable deps seam —
  fully transport-free; Codex #3) — change-gate silence on `false`/`null`;
  alert on `true`; marker fencing (second run sends nothing); dark gate =
  permanent suppression (un-darkened later run does NOT back-send; Codex
  #6); **job-scoped reuse: retry finds attempt 1's row even with a
  simulated long gap (row createdAt >= job createdAt is the only
  boundary), and a PRIOR slot's row is never reused (Codex #1/#8)**;
  config-rot no-op **on the reuse path too (archived/delisted after the
  row landed; Codex #1)**; **manual-first single-flight collision → silent
  complete (Codex #2)**; send-failure → throw.
- `robots-monitor-sweep.test.ts` — fan-out per (client, domain); archived
  client excluded; malformed domains JSON tolerated; **malformed /
  duplicate / mixed-validity domain entries normalized-skipped-deduped
  (Codex #5)**; dedupKey shape; **partial-failure retry re-enqueues only
  the missing jobs (dedup no-ops the live ones; Codex #8)**.
- `service.test.ts` additions — `getRobotsCheck` returns `changeSummary`
  against the exact predecessor; null on first check.
- `system-schedules.test.ts` — new row seeded, exact cadence
  `weekly:1@06:30`, `immediate: false` (Codex #8).
- `register.test.ts` — both new job types registered (Codex #8).
- Component test — changed section renders added/removed lines;
  reorder-only renders the formatting-only notice; `childrenExcluded` line
  renders.
- Migration applied to the per-worker test DBs automatically (tests
  self-provision).

## Flags for Kevin (Codex verify list — none block implementation)

- **One-observation alerts:** a single transient fetch timeout emails (with
  transport-honest wording), and the recovery emails again. Accepted for
  v1; say the word if you'd rather have confirmation-refetch-before-alert
  and it becomes a follow-up.
- **Dark notify env = permanent suppression** of a change's email (in-app
  badge still shows it). No catch-up on un-darkening.
- **`weekly:1@06:30` is server-local** — the prod host runs UTC, so this is
  Monday 06:30 UTC (Sunday ~22:30 Pacific). Deliberate: overnight,
  clear of the 08:00 backup / 09:00 cleanup.
- Mailgun send (10s timeout) + DB work sits far below the 120s job timeout.

## Out of scope

- Client command center / findings-layer surfacing of robots alerts
  (roadmap step 4 — separate item).
- Issue-set-diff alerts under unchanged hashes (deferred, decision #3).
- Per-client cadence/pause controls (Alternative B, door left open).
- Any change to `lib/seo-fetch` (frozen) or the D4 runner semantics.
- The D6 RankMath generator (separate Kevin decision).
