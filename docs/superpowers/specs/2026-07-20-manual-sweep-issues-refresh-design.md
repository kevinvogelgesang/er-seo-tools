# Manual full-cohort sweep → /issues refresh (origin-tagged snapshots)

**Status:** design · **Date:** 2026-07-20 · **Branch:** `feat/manual-sweep`
**Author:** Claude (Opus 4.8) with Kevin
**Roadmap:** improvement-roadmap — "manual queue-all takes precedence on /issues" (next after sweep-error-triage)

---

## 1. Problem & goal

Today `/issues` is refreshed **only** by the Sunday scheduled weekly sweep
(`system-client-sweep` fan-out → `system-sweep-digest` compute/publish). Between
Sundays there is no way to make `/issues` reflect mid-week fixes.

**Goal.** A completed **manual full-cohort client scan** ("Queue all clients")
updates `/issues` **silently (no email)**, and takes precedence over the most
recent scheduled sweep **if it completed after that sweep**. The Monday support
email always stays the **Sunday scheduled sweep's** digest.

Kevin's scenario (the acceptance narrative):

> Sun sweep → Mon email = Sun sweep. Wed queue-all → /issues updates (no email).
> Fri queue-all → /issues updates (no email). Sun sweep → Mon email = that Sun sweep.

**Approved decisions (2026-07-20, via brainstorm):**

- **D1 — Repurpose "Queue all clients".** The existing bulk-queue button becomes
  a true full-cohort manual sweep. Confirmed by Kevin: *"I definitely want the
  queue all to do an SEO scan."* → it runs the **full sweep profile**
  (`SWEEP_SCAN_PROFILE` = `wcag21aa` + `seoIntent` + `¬seoOnly` = full **ADA and
  SEO**) over **every registered domain** (not first-domain-only).
- **D2 — Manual baseline = most recent SCHEDULED sweep.** On `/issues`, a manual
  snapshot's change-state/streaks diff against the most recent *scheduled* sweep.
  Multiple mid-week manual runs each diff against that **same** Sunday (fixes read
  as "resolved since Sunday"). The **email keeps strict Sunday-to-Sunday**.

### Why today's bulk-queue can't just get a snapshot bolted on

`app/api/site-audit/bulk-queue/route.ts` today enqueues **one audit per active
client, first domain only** (`c.firstDomain`), with **no `seoIntent`** (defaults
false). Two axes make those audits **not comparable** to a Sunday sweep audit:

1. **First-domain-only cohort.** A multi-domain client's other domains would be
   *out of cohort* → `issue-groups.ts` drops their prior keys/groups entirely
   (never stale, never resolved) → those domains' issues **vanish** from `/issues`.
2. **No `seoIntent`.** `seoIntent` gates hybrid discovery
   (`site-audit-discover.ts:158` `hybrid = audit.seoIntent && …`). Without it the
   scan uses sitemap/shallow discovery only → **shallower page coverage** →
   different (lower) SEO `affectedCount` → **false "fewer"/"resolved" claims**
   when diffed against a seoIntent Sunday sweep. (On-page harvest itself runs
   regardless — `persistPageSeo` is unconditional in the page job — but the *page
   set* differs.)

So the manual run must be a **true sweep-equivalent**: full cohort +
`SWEEP_SCAN_PROFILE`, reusing the existing sweep/findings snapshot layer. This
also satisfies Kevin's **hard constraint**: *reuse the findings/sweep snapshot
layer — NO separate handoff/token/export path.*

---

## 2. Non-goals

- No new export/handoff/token path. Reuse `computeSweepSnapshot` /
  `WeeklySweep` / `read.ts` verbatim.
- No change to the Monday email content, cadence, or recipient. The digest
  already resolves the Sunday sweep by **exact-slot lookup**, so it ignores
  manual snapshots *by construction* (see §7 — we additionally harden it).
- No change to `buildIssueGroups` (the pure diff): the manual-vs-scheduled
  baseline is a **predecessor-resolution** change at the call site only.
- No per-client manual sweep (v1 is all-active-clients only, mirroring the
  weekly cohort). A subset/single-client "refresh" is out of scope.
- Manual sweeps do **not** feed the scheduled-sweep streak history. `/issues`
  streak semantics for a manual snapshot are defined by D2 (diff vs the Sunday
  scheduled sweep); manual snapshots are never a *predecessor* for anything.

---

## 3. Architecture overview

The scheduled sweep is two jobs: **fan-out** (`client-sweep`) freezes a cohort
and enqueues audits; **digest** (`sweep-digest`) computes + publishes the
snapshot **and** sends the email, at a fixed Monday 14:00 slot.

The manual sweep reuses the fan-out core and the snapshot compute, but:

- it is **triggered on demand** (button → route → durable job), not by a schedule;
- its snapshot is computed **on drain** (when the cohort's audits finish),
  driven by an advancer folded into the existing `stale-audit-reset` job —
  **not** at a fixed time;
- it **never sends an email**;
- its predecessor for the diff is the **most recent scheduled snapshot**.

```
Operator clicks "Queue all clients"
        │
        ▼
POST /api/site-audit/bulk-queue         (repurposed; cookie-gated)
  • guard: at most ONE in-flight manual sweep (partial unique index) → else 409
  • create WeeklySweep{ origin:'manual', scheduledFor: now, startedAt: now }
  • enqueue durable job  type='manual-sweep'  payload={ scheduledFor }
        │
        ▼
manual-sweep job  (concurrency 1)
  • runSweepFanout({ slot, origin:'manual', requestedBy:'manual-sweep',
                     scheduleId: null }, deps)   ← SHARED with client-sweep
      – freeze cohort (buildCohort over active clients' registered domains)
      – fan out one SWEEP_SCAN_PROFILE audit per member
      – stamp fanoutCompletedAt
  (NO email job, NO snapshot compute here — drain hasn't happened yet)
        │
        ▼  (audits run through the normal site-audit queue, finalize, live-scan builds)
        │
stale-audit-reset job (every 10m)  → advanceManualSweeps(now)
  • for each WeeklySweep origin='manual', snapshotJson=null, fanoutCompletedAt set:
      – drained?  every member settled (terminal + live-scan run present) OR
                  max-wait exceeded
      – if drained: previous = loadPreviousScheduledSnapshot(before = scheduledFor)
                    snapshot = computeSweepSnapshot(sweep, previous, now)
                    publishSweepSnapshot(sweep.id, snapshot)   ← NO email
        │
        ▼
/issues  (read.ts: newest snapshot by scheduledFor, origin-agnostic)
  → serves the manual snapshot (its scheduledFor > last Sunday's)
```

---

## 4. Data model

### 4.1 Schema change

Add one column to `WeeklySweep`:

```prisma
model WeeklySweep {
  id                Int       @id @default(autoincrement())
  scheduledFor      DateTime  @unique
  origin            String    @default("scheduled")   // 'scheduled' | 'manual'
  startedAt         DateTime?
  membershipJson    String?
  fanoutCompletedAt DateTime?
  snapshotJson      String?
  snapshotAt        DateTime?
  digestSentAt      DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}
```

- `origin` defaults to `'scheduled'` → **all existing rows read as scheduled**
  (correct — they are). No backfill needed.
- `scheduledFor` stays `@unique`. A manual row's `scheduledFor` = the trigger
  timestamp (`now`, ms precision). Collision with a Monday 01:00:00.000 slot is
  astronomically unlikely (human click); §7 hardens the two exact-slot lookups
  with an `origin` filter so a stray collision could never be *mistaken* for a
  scheduled sweep.

### 4.2 In-flight guard — partial unique index

Hand-authored SQL (raw), added in the same migration:

```sql
CREATE UNIQUE INDEX "weekly_sweep_one_inflight_manual"
  ON "WeeklySweep"("origin")
  WHERE "origin" = 'manual' AND "snapshotJson" IS NULL;
```

Because every row the index covers has `origin='manual'` (a constant), a unique
index on `origin` permits **at most one** in-flight manual sweep. Once the
snapshot publishes (`snapshotJson` set) the row exits the partial index, freeing
the slot. Scheduled rows are excluded by the predicate. This is the **hard**
guard; the route also returns a friendly `409 manual_sweep_in_progress`.

> Prisma cannot express a partial index in `schema.prisma`; it is created in the
> migration SQL and lives only in the DB. Documented here so it isn't "lost."

### 4.3 Types

`lib/sweep/types.ts`: add
`export type SweepOrigin = 'scheduled' | 'manual'` and a narrow parser/guard
`asSweepOrigin(s: string): SweepOrigin` (unknown → `'scheduled'`, fail-safe).
No change to `SweepMembership` / `SweepSnapshot` JSON contracts — `origin` lives
on the row, not in the frozen JSON.

---

## 5. Components / units

Each unit has one purpose, a defined interface, and is testable in isolation.

### 5.1 `runSweepFanout(...)` — shared fan-out core (extracted)

**Where:** extracted from `lib/jobs/handlers/client-sweep.ts` into a shared
function (in `client-sweep.ts` or a new `lib/sweep/fanout.ts` — planning call;
keep the ONE home).

**Signature (sketch):**
```ts
runSweepFanout(
  input: { slot: Date; origin: SweepOrigin; requestedBy: string; scheduleId: string | null },
  deps: SweepFanoutDeps,   // { queue, now, ... } — same injectable seam client-sweep uses
): Promise<void>
```

**Behavior (unchanged from today's client-sweep, parametrized):**
1. `upsert` the `WeeklySweep` row by `scheduledFor: slot`
   (`create: { scheduledFor, origin, startedAt: now }`, `update: {}` — origin
   set only on create; idempotent whether or not the route pre-created it).
   **[Codex F1] After the upsert, assert `sweep.origin === input.origin`** and
   throw on mismatch. `update: {}` would otherwise let a scheduled fan-out
   silently adopt a pre-created manual row that shares the same `scheduledFor`
   (and vice-versa). Origin is never overwritten; a cross-origin slot collision
   is a hard error, not a merge.
2. Freeze cohort if `membershipJson` null (`buildCohort` over
   `client.findMany({ archivedAt: null })`; fenced first publish
   `updateMany({ where: { membershipJson: null } })`; corrupt-non-null → throw).
3. Process `pending`/`error` members: revalidate (archived→skipped-archived,
   delisted→skipped-delisted), collapse shared domains, else
   `deps.queue({ ...SWEEP_SCAN_PROFILE, requestedBy, scheduleId })`; persist
   membership after each outcome.
4. Stamp `fanoutCompletedAt` iff zero `error` members, else throw to retry.

**Callers:**
- `client-sweep` handler: `{ slot: job.scheduledFor, origin:'scheduled',
  requestedBy:'sweep', scheduleId: <system-client-sweep id> }` — **behavior
  byte-identical to today** (this is a pure extraction; the scheduled path must
  not change). **[Codex F2]** the `system-client-sweep` lookup + missing-schedule
  throw stay in the **scheduled wrapper** (`client-sweep.ts:30`), which resolves
  the id and passes it in; `runSweepFanout` never does schedule resolution. A
  characterization test pins the scheduled queue args + membership JSON.
- `manual-sweep` handler: `{ slot: payload.scheduledFor, origin:'manual',
  requestedBy:'manual-sweep', scheduleId: null }`.

### 5.2 `manual-sweep` job handler (new)

**Where:** `lib/jobs/handlers/manual-sweep.ts`.
- Reads `scheduledFor` from **payload** (not from `job.scheduledFor`; a manual
  job carries no schedule slot).
- Calls `runSweepFanout({ slot, origin:'manual', requestedBy:'manual-sweep',
  scheduleId: null }, deps)`.
- Registration: `type: 'manual-sweep'`, concurrency 1, maxAttempts 3, timeout
  120s (mirrors `client-sweep`). Idempotent via the cohort-freeze fence + the
  membership `pending/error`-only reprocessing.
- **No** snapshot compute, **no** email, **no** poll enqueue here. Drain
  detection is the advancer's job (§5.3).

### 5.3 `advanceManualSweeps(now)` — compute-on-drain (new)

**Where:** `lib/sweep/advance.ts` (pure-ish; touches prisma via injectable deps
for testability). **Called from** the existing `stale-audit-reset` scheduled job
(every 10 min) — no new permanent schedule; crash-safe because the schedule
always runs.

**Behavior:**
1. Load candidate rows: `origin='manual' AND snapshotJson IS NULL AND
   fanoutCompletedAt IS NOT NULL` (bounded; normally 0 or 1).
2. For each: parse membership; compute **drained** = *every non-skipped member is
   settled*. A member is **settled** when:
   - **[Codex D1]** its `siteAudit.status` is terminal — one of
     `complete | error | cancelled`. (`SiteAudit` has **no `failed`** status —
     verified against `schema.prisma`; the finalizer/recovery flip to
     `complete`/`error`. `pending`/`running`/`pdfs-running`/`lighthouse-running`
     are non-terminal → not settled.) **AND**
   - **[Codex D2]** if `complete` **and the audit is a full profile (`¬seoOnly`,
     which every manual-sweep audit is)**, **BOTH** `CrawlRun{tool:'ada-audit'}`
     **and** `CrawlRun{tool:'seo-parser'}` exist for it. The ADA findings write
     **and** the live-scan (`seo-parser`) build are BOTH fire-and-forget *after*
     the parent flips `complete`; requiring the SEO run alone would let the
     advancer publish **false failed/stale ADA coverage** during the ADA
     dual-write window. An exhausted `seo-parser` placeholder counts as the SEO
     run (→ correct `partial` SEO coverage, never a false resolved claim).
   - **[Codex D3]** members with `siteAuditId: null`: `skipped-archived` /
     `skipped-delisted` are **out of cohort** (never block drain, emit no
     coverage — matches `computeSweepSnapshot`'s member handling);
     `invalid-domain` / `skipped-conflict` / sealed-`error` settle as
     **failed** (they will never produce a run). A residual **`pending`** member
     after `fanoutCompletedAt` is an **invariant violation** → it blocks drain
     and is `logError`-logged, until the max-wait cap forces a compute.
3. **[Codex D4] Max-wait cap:** anchor to `fanoutCompletedAt` (not `startedAt`):
   if not drained but `now − fanoutCompletedAt > MANUAL_SWEEP_MAX_WAIT_MS`
   (default **13h**, matching the scheduled fan-out→digest window; env-overridable
   — 6h was too short for a globally serialized full cohort), compute **anyway**
   with whatever exists (mirrors the digest snapshotting whatever's there at its
   fixed slot). `logError` when this fires (ops signal: a manual cohort didn't
   fully drain).
4. When (drained || max-wait): `previous =
   loadPreviousScheduledSnapshot(sweep.scheduledFor)`;
   `snapshot = computeSweepSnapshot(sweep, previous, now)`;
   `publishSweepSnapshot(sweep.id, snapshot)`. **Never** send email.
   `publishSweepSnapshot` is already race-safe (fenced `updateMany where
   snapshotJson null`) — safe to call from a scheduled advancer that could tick
   while other audits still finalize, **but only because D2 closes the ADA
   dual-write race** (an early publish before both runs exist would freeze wrong
   coverage; D2 prevents the advancer from declaring drain until both runs land).
5. **[Codex D5]** Batch/deduplicate the status + run-existence reads **by
   `siteAuditId`** (shared-domain members collapse to one audit — read each once).
6. Fault isolation: one bad candidate row is caught + logged; it must not stop
   the others. The advancer is invoked from `stale-audit-reset` through a
   **caught dynamic import** so an advancement failure never fails audit recovery.

> **[Codex D5] Why fold into `stale-audit-reset` rather than a self-chaining poll
> job.** Confirmed the maintenance-advancer is preferable. `runAfter` self-poll
> needs a crash-window recovery re-seed and careful dedup (a same-`dedupKey`
> re-enqueue is swallowed while the current poll is `running`). A bounded, guarded
> indexed query in the existing 10-min job needs **no** new schedule and is
> crash-safe by construction. ≤10 min added latency after the *last* audit
> finishes is negligible for a multi-minute full-cohort scan.

### 5.4 `loadPreviousScheduledSnapshot(before: Date)` — manual baseline (new)

**Where:** `lib/sweep/snapshot.ts`, beside `loadPreviousSnapshot`.

```ts
export async function loadPreviousScheduledSnapshot(before: Date): Promise<SweepSnapshot | null> {
  // [Codex B1] bounded ordered scan, return the newest VALID parsed scheduled
  // snapshot — mirror read.ts's corrupt-newest fall-through, don't discard a
  // valid conservative baseline just because the newest row is corrupt.
  const rows = await prisma.weeklySweep.findMany({
    where: { origin: 'scheduled', snapshotJson: { not: null }, scheduledFor: { lt: before } },
    orderBy: { scheduledFor: 'desc' },
    take: SCAN_LIMIT,               // same bound read.ts uses
    select: { snapshotJson: true },
  })
  for (const r of rows) {
    const parsed = parseSnapshot(r.snapshotJson)
    if (parsed) return parsed
  }
  return null
}
```

- Implements **D2**: the most recent *scheduled* snapshot strictly before the
  manual run's `scheduledFor`. Multiple mid-week manual runs (Wed, Fri) both
  resolve to the **same** last Sunday → consistent "resolved since Sunday".
- **[Codex B1]** corrupt-newest → fall through to the next-older valid scheduled
  snapshot (bounded scan), matching `read.ts`. Null only when no valid scheduled
  snapshot exists before `before` → the manual snapshot renders first-baseline
  (no false diff).
- **[Codex B2] Streak semantics.** `computeSweepSnapshot` threads `previous`
  consistently through `baselinePairs`, `buildIssueGroups`, AND the totals delta
  — so coverage/new/resolved/delta are all correct against the scheduled
  baseline. BUT `buildIssueGroups` **increments** the predecessor streak for
  `detected`/unchanged groups (`streak = priorKey.streak + 1`), which on a
  Wednesday manual snapshot would read as "another consecutive **week**" — false.
  Because a manual snapshot is **never a predecessor** for anything (non-goal
  §2), the streak value is only ever *displayed*, never consumed as a baseline.
  **Fix: suppress the consecutive-week streak label on `/issues` when
  `origin='manual'`** (the streak count across a mid-week diff is meaningless).
  This keeps `buildIssueGroups` untouched (still the ONE home) and is honest.
  *(Alternative recorded: a `streakMode:'carry'` param on `buildIssueGroups` that
  carries `priorKey.streak` instead of +1 for manual — heavier, deferred unless
  the UI needs a non-zero streak value.)*
- **`loadPreviousSnapshot` (the −7d scheduled/email resolver) is untouched**
  except the E1 `origin:'scheduled'` filter (§7).

### 5.5 Route: repurposed `POST /api/site-audit/bulk-queue`

- Cookie-gated (unchanged). `withRoute` wrapper.
- **Remove** the first-domain iteration and the `missing_domains` hard-400.
  Domainless active clients are simply **skipped** by `buildCohort` (mirrors the
  scheduled sweep). Note this behavior change in the PR.
- Steps:
  1. Guard: if an in-flight manual sweep exists
     (`origin='manual', snapshotJson=null`) → `409 manual_sweep_in_progress`
     (the partial unique index is the hard backstop for the race).
  2. `create WeeklySweep{ origin:'manual', scheduledFor: now, startedAt: now }`
     (gives the immediate in-progress banner). **[Codex U2] Map P2002 precisely:**
     on a create failure, re-query the in-flight manual predicate — if an
     in-flight manual row exists → `409 manual_sweep_in_progress`; if instead the
     violation is a bare `scheduledFor` collision (astronomically rare
     same-ms double-fire) → retry with a fresh `now`; any other unique violation
     → propagate (never mislabel as `manual_sweep_in_progress`).
  3. `enqueueJob({ type:'manual-sweep', payload:{ scheduledFor: now.toISOString() },
     dedupKey:'manual-sweep:'+now, groupKey:'manual-sweep:'+now })`.
     If enqueue fails, delete the just-created row (or leave it — the advancer's
     `fanoutCompletedAt IS NOT NULL` filter means an un-fanned-out row is never
     computed; but a stranded `snapshotJson=null` row would block future manual
     sweeps via the partial index → **delete on enqueue failure**).
  4. Return `{ started: true, scheduledFor }` (or the row id).
- **Recovery:** a `manual-sweep` job stranded by a crash after row-create is
  covered by the durable job (it retries) and the fanout fence. A row created but
  whose enqueue never landed is prevented in step 3 (delete-on-failure). Add a
  belt-and-suspenders sweep in `recoverQueue()` / `stale-audit-reset`: a manual
  row with `membershipJson=null` and no active `manual-sweep` job older than N
  min → re-enqueue the fanout (or delete). (Planning detail.)

### 5.6 UI: `components/ada-audit/BulkQueueModal.tsx`

- Update copy: the confirm dialog explains it runs a **full ADA + SEO scan of
  every client domain** and **refreshes /issues** (no email). Keep the label
  "Queue all clients" (Kevin's term) or refine to "Scan all clients & refresh
  Issues" — copy call, non-blocking.
- Handle `409 manual_sweep_in_progress` → friendly "a manual refresh is already
  running" message instead of a generic error.
- Optional: on success, link to `/issues`. Client component → dark: variants +
  the mounted-guard hydration pattern already in place.

### 5.7 `/issues` origin label (small, additive)

- `read.ts`: `select` `origin` too; add `origin: SweepOrigin` and keep
  `snapshotAt`/`scheduledFor` in `IssuesPayload.sweep`. So the page can label
  "Weekly sweep · <date>" vs "Manual refresh · <date>". Purely presentational;
  the served-snapshot selection (newest by `scheduledFor`) is unchanged and
  already origin-agnostic → precedence "manual after Sunday wins" works for free.
- `app/(app)/issues/page.tsx` + `components/issues/*`: show the label + an
  "in progress" note already exists (`inProgress`) — a manual row with
  `snapshotJson=null` and `scheduledFor` > last Sunday sets `inProgress=true`,
  so `/issues` shows the banner during the manual scan while still serving the
  last valid (Sunday) snapshot. **Reuses existing behavior; no new banner logic.**
- **[Codex B2] Suppress the consecutive-week streak label** on `/issues` when
  the served snapshot's `origin='manual'` (a streak counted against the Sunday
  baseline is not a "week"). Origin-aware render only; the underlying
  `IssueGroup.streak` value is left as-is in the JSON (never consumed as a
  baseline since manual snapshots are not predecessors).

### 5.8 Retention: manual-sweep audits + rows

- **[Codex R1] Manual-sweep audits** (`requestedBy:'manual-sweep'`,
  `scheduleId: null`). `scheduleId: null` deliberately keeps them **out of the
  scheduled-sweep keep-latest-2-per-(schedule,domain) pool**
  (`pruneScheduledSiteAudits`) — otherwise frequent manual sweeps could prune a
  Sunday audit before the Monday digest reads it and corrupt the Sunday snapshot.
  New pass **`pruneManualSweepAudits()`** in `runCleanup`: keep the latest 2
  completed per (client,domain) among `requestedBy='manual-sweep'` audits, delete
  older past TTL, **guarded** so it never deletes an audit ID referenced by any
  manual `WeeklySweep` whose `snapshotJson` is null (unsnapshotted membership).
  (Findings survive via `CrawlRun` SetNull; `/issues` reads frozen
  `snapshotJson`.)
- **[Codex R3] Reuse the artifact-cleanup seam.** `pruneManualSweepAudits` must
  delete the audit's report PDF + hero screenshot through the SAME cleanup path
  `pruneScheduledSiteAudits` uses (report/hero file removal), not a bare row
  delete — else it orphans files.
- **[Codex R2] Partition `pruneWeeklySweeps` retention by origin.** The current
  global newest-26-snapshotted rule (`retention.ts:30`) would let frequent
  **manual** snapshots evict the **scheduled** Sunday rows — which
  `loadPreviousScheduledSnapshot` (§5.4) AND the −7d email baseline (§7) both
  depend on. Fix: keep **newest 26 *scheduled*** snapshotted rows as an
  independent pool, PLUS a separately-bounded manual-snapshot history (e.g.
  `WEEKLY_SWEEP_MANUAL_SNAPSHOT_KEEP`, default a small number — manual snapshots
  are transient refreshes, not long-term history). At minimum the newest ~2
  scheduled rows must be protected from manual eviction. The dead-row rule
  (snapshot AND `digestSentAt` both null, 14d) is **correct as-is** for manual: a
  healthy manual row has non-null `snapshotJson` (safe); only a genuinely-dead
  manual row (never snapshotted, never sent) matches → swept at 14d. Add tests
  for both the origin-partitioned keep and the dead-manual-row sweep.

---

### 5.9 Recovery, exhaustion & attribution (Codex-flagged omissions)

- **[Codex] Orphan recovery (mandatory).** A crash between the route's row-create
  and the `manual-sweep` enqueue bypasses the route's `try/catch` (§5.5 step 3
  delete-on-failure only covers a *caught* enqueue failure). Add a real recovery
  pass — in `recoverQueue()` (boot) **and** the `stale-audit-reset` job (10 min):
  a manual `WeeklySweep` with `membershipJson = null` (fan-out never ran) **and**
  no active `manual-sweep` job for its slot, older than a small threshold →
  **re-enqueue** the `manual-sweep` job for that slot (idempotent — the fan-out
  fence handles a double). This is the same self-healing pattern as
  `recoverBrokenLinkVerifies`.
- **[Codex] `manual-sweep.onExhausted`.** Without it, a row with non-null
  membership + enqueue errors + null `fanoutCompletedAt` (fan-out exhausted all
  attempts) would sit `snapshotJson=null` forever → the **partial unique index
  blocks ALL future manual sweeps** until the 14-day dead-row sweep. Add an
  `onExhausted` hook that **seals the row for partial advancement**: stamp
  `fanoutCompletedAt` (so the advancer computes a snapshot from whatever members
  *did* enqueue — failed members settle as `failed` coverage per D3) OR, if no
  member enqueued at all, **delete the row** to free the in-flight slot. Log
  either way. This mirrors the `broken-link-verify` `onExhausted` →
  `ensureExhaustedPlaceholder` terminality discipline.
- **[Codex] In-progress banner recovery.** The two failures above also leave
  `/issues` showing `inProgress` indefinitely (a newer manual row with null
  snapshot). The recovery + `onExhausted` above clear it (row gets a snapshot or
  is deleted). Add a test asserting recovery clears the stuck `inProgress`.
- **[Codex] `requestedBy` attribution.** `requestedBy:'manual-sweep'` is a
  **machine-origin marker** (like the scheduled sweep's `'sweep'`): these audits
  display as the machine actor and are **excluded from any operator's "Mine"
  recents filter**. This is intentional and consistent with the weekly sweep —
  a manual sweep is a global system artifact, not a personal scan. **Documented
  choice** (not preserving per-operator attribution in v1; the operator who
  triggered it is not surfaced on the individual audits). Revisit only if Kevin
  wants "who ran the manual refresh" visible.

## 6. Config / env

| Env | Default | Purpose |
|---|---|---|
| `MANUAL_SWEEP_MAX_WAIT_MS` | `46800000` (**13h**) | Cap (anchored to `fanoutCompletedAt`, [Codex D4]) after which the advancer computes a manual snapshot even if the cohort hasn't fully drained — matches the scheduled fan-out→digest window; mirrors the digest's compute-whatever-exists behavior. |
| `MANUAL_SWEEP_AUDIT_KEEP` | `2` | Per-(client,domain) keep count for `pruneManualSweepAudits`. |
| `MANUAL_SWEEP_AUDIT_TTL_MS` | `1209600000` (14d) | TTL before older manual-sweep audits are pruned. |
| `WEEKLY_SWEEP_MANUAL_SNAPSHOT_KEEP` | `4` | [Codex R2] Independent keep count for manual `WeeklySweep` snapshot rows, so manual refreshes never evict the scheduled-Sunday history the baselines depend on. |

All optional-with-default (call-time reads, never boot fail-fast). Follow the
`lib/*-config` env-home convention if a config module is warranted, else read
inline with documented defaults.

---

## 7. Email isolation (verify + harden)

- `sweep-digest.ts` derives the sweep slot as `digestSlot.setHours(1,0,0,0)` and
  `findUnique({ where: { scheduledFor: sweepSlot } })`. A manual row's
  `scheduledFor` is the trigger `now`, which is not a Monday-01:00 slot → the
  digest never matches a manual row. **Confirmed by construction.**
- **[Codex E1] Harden BOTH scheduled lookups:** the digest's exact-slot row
  → `findFirst({ where: { scheduledFor: sweepSlot, origin: 'scheduled' } })`, AND
  `loadPreviousSnapshot` (the −7d email baseline) → filter `origin: 'scheduled'`.
  Together with **never enqueuing `sweep-digest` for a manual row** (manual has no
  digest job — §3), this fully isolates the Monday email. Defensive one-liners;
  the scheduled path stays behaviorally identical for all real inputs.
- **[Codex E2] Retention dependency:** origin filters alone don't help if
  frequent manual snapshots have already **evicted** the scheduled row the email
  baseline needs — this is exactly why `pruneWeeklySweeps` must be
  origin-partitioned (§5.8 R2). Email isolation = origin filters **+**
  origin-partitioned retention, together.

---

## 8. Testing strategy

House conventions: per-worker SQLite DBs, parallel, save/restore any env a suite
sets; array-form `$transaction` only; DateTime = INTEGER ms in raw SQL.

- **`loadPreviousScheduledSnapshot`** (unit): picks newest *scheduled*
  snapshotted row before `before`; ignores manual rows; ignores unsnapshotted;
  corrupt-newest → null (or fall-through, per §5.4 decision).
- **`advanceManualSweeps`** (integration, DB): (a) not-drained → no publish;
  (b) drained (all members `complete` + **both** ada-audit AND seo-parser runs
  [D2]) → publishes with the scheduled baseline, no email; (b2) a `complete`
  member with only the seo-parser run (ADA run not yet written) → **not** drained
  [D2]; (c) max-wait (anchored to `fanoutCompletedAt` [D4]) exceeded while not
  drained → publishes anyway + logs; (d) already-snapshotted candidate → no-op;
  (e) skipped-archived/delisted members don't block drain; (e2) `invalid-domain`/
  `skipped-conflict`/`error` members settle failed, a residual `pending` blocks
  until max-wait [D3]; (f) fault isolation (one corrupt row doesn't stop others);
  (g) terminal set is `complete|error|cancelled` — a `running` member is not
  settled [D1]; (h) shared-domain members read the same audit once [D5]; (i) an
  exhausted seo-parser placeholder counts as the SEO run → partial coverage.
- **`manual-sweep.onExhausted`** (integration): a fan-out that exhausts attempts
  seals the row (`fanoutCompletedAt` stamped for partial advancement) or deletes
  it when nothing enqueued — the in-flight slot is freed, no 14-day block.
- **Orphan recovery** (integration): a manual row with `membershipJson=null` and
  no active `manual-sweep` job → recovery re-enqueues the fan-out; a stuck
  `inProgress` on `/issues` is cleared after recovery/onExhausted.
- **`pruneWeeklySweeps` origin partition** [R2] (DB): many manual snapshots do
  NOT evict the newest scheduled rows; scheduled keep-26 + manual keep-N are
  independent; a dead manual row (snapshot+digest null) swept at 14d.
- **Streak suppression** [B2] (unit/component): a manual-origin snapshot's
  `/issues` render hides the consecutive-week streak label.
- **`runSweepFanout` extraction** (characterization): the **scheduled** path
  produces byte-identical membership/fan-out to pre-refactor `client-sweep`
  (freeze once, revalidate, shared-domain collapse, `fanoutCompletedAt` gate).
  Add a manual-origin case asserting `origin='manual'`, `requestedBy='manual-sweep'`,
  `scheduleId=null` on the queued audits.
- **Route** (integration): repurposed bulk-queue creates a manual `WeeklySweep`
  + enqueues `manual-sweep`; second concurrent call → 409; domainless clients
  skipped (no 400); enqueue-failure deletes the row.
- **Partial unique index** (DB): two in-flight manual rows rejected at the DB
  layer.
- **Email isolation** (integration): a manual snapshot newer than the Sunday
  sweep is served on `/issues` but the digest still resolves + sends the Sunday
  sweep; `origin` filters on both exact-slot lookups.
- **`read.ts`** (unit/integration): newest-by-`scheduledFor` serves the manual
  snapshot when it post-dates the Sunday; `inProgress` true while a newer manual
  row has null snapshot; `origin` surfaced in the payload.
- **`pruneManualSweepAudits`** (DB): keeps latest 2 per (client,domain); never
  deletes an audit referenced by an in-flight (`snapshotJson=null`) manual sweep.
- **`pruneWeeklySweeps`** (DB): a dead manual row (snapshot+digest null) swept at
  14d; a snapshotted manual row counts toward keep-26.
- Full gate: `tsc --noEmit` + `vitest` + `next build`. No in-build type-check.

---

## 9. Migration

- Hand-authored SQL migration, timestamp **later than `20260720160000`** and
  later than any viewbook-lane migration merged before this ships (**[Codex]
  re-check at build time**; use e.g. `20260721000000_manual_sweep_origin`).
- Contents: `ALTER TABLE "WeeklySweep" ADD COLUMN "origin" TEXT NOT NULL DEFAULT
  'scheduled';` + the partial unique index (§4.2). SQLite: `ADD COLUMN` with a
  constant default is safe; existing rows get `'scheduled'`.
- **[Codex] After editing `schema.prisma` (add `origin`), regenerate the Prisma
  client** (`npx prisma generate` / the `migrate dev` flow does this locally) so
  the typed client knows the column. Test: existing rows default to `'scheduled'`;
  BOTH unique constraints (`scheduledFor` @unique + the partial in-flight index)
  are exercised.
- Applied in prod via `prisma migrate deploy` in the deploy command.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Refactor of `client-sweep` changes scheduled behavior | Pure extraction + characterization test pinning the scheduled path byte-identical. |
| Manual sweep prunes a Sunday audit before the Monday digest reads it | Manual audits carry `scheduleId: null` → separate retention pool (§5.8); `pruneManualSweepAudits` guards in-flight references. |
| A manual cohort never fully drains (an audit hangs) | `MANUAL_SWEEP_MAX_WAIT_MS` cap → compute with whatever's there + log (mirrors digest). |
| Double-click / concurrent manual sweeps | Partial unique index (hard) + 409 (friendly). |
| Manual snapshot leaks into the Monday email | Digest resolves by exact Sunday slot **and** `origin='scheduled'`; −7d baseline `origin='scheduled'`; no digest job for manual (§7 E1). |
| Manual snapshots evict the scheduled Sunday rows the email/baseline need [E2/R2] | `pruneWeeklySweeps` partitioned by origin — scheduled keep-26 + manual keep-N independent (§5.8). |
| Advancer publishes false ADA coverage before the ADA run lands [D2] | Drain requires BOTH ada-audit AND seo-parser runs on a complete full audit before publish (§5.3). |
| Stranded manual row blocks all future manual sweeps (partial index) | Delete row on caught enqueue failure; `manual-sweep.onExhausted` seals/deletes; recovery re-enqueue for `membershipJson=null` orphans; dead-row sweep at 14d (§5.9). |
| Cost: full ADA+SEO cohort on demand (heavy) | It's operator-initiated + one-in-flight; same cost profile as the weekly sweep. Copy warns it's a full scan. |

---

## 11. Acceptance criteria (Kevin's scenario)

1. Sunday scheduled sweep runs → Monday email = that Sunday's digest. `/issues`
   shows the Sunday snapshot.
2. Wed: operator clicks "Queue all clients" → full ADA+SEO cohort scan → on drain
   `/issues` shows the Wed snapshot, diffed vs the Sunday sweep (mid-week fixes
   read "resolved"). **No email.**
3. Fri: same → `/issues` shows the Fri snapshot, again diffed vs the **same**
   Sunday sweep. **No email.**
4. Next Sunday sweep → Monday email = that Sunday's digest (unaffected by the two
   manual runs). `/issues` then shows the new Sunday snapshot.
5. A second "Queue all" while one is in flight → 409, no second cohort.
