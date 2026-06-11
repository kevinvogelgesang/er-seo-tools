# B5 — Quarter Grid Closure: Tool Activity, Teamwork Push, Client Archive, Dashboard Quarter Card

**Date:** 2026-06-11 · **Status:** Spec (pre-Codex)
**Roadmap:** `docs/superpowers/nyi/improvement-roadmaps/04-clients-and-quarter-grid.md` § Phase 4 (tracker B5)
**Depends on:** B1 (client dashboard), B3 (grid state in DB), B4 (grid split)

---

## Problem

The grid says *plan*, the tools say *done* — nothing connects them:

1. Completing a scan/roadmap/memo for a client is invisible on the quarter grid.
2. The planned cycle lives only in the grid; the team works out of Teamwork.
   `Client.teamworkTasklistId` exists but nothing pushes the plan there.
3. Deleting a client cascade-deletes its `QuarterAssignment` and `Schedule`
   rows and SetNulls every run/session — one misclick destroys history.
4. The client dashboard (`/clients/[id]`) has no quarter context (parked B1
   follow-up, unblocked by B3's tables).

## Scope decisions (made at brainstorm time, per handoff)

| Question | Decision | Why |
|---|---|---|
| Which tool events count as "progress"? | Completed `CrawlRun`s (seo-parser + ada-audit), completed `SeoRoadmap`, completed `KeywordResearchSession`, `PillarAnalysis` (complete; narrative timestamp preferred) — within the current plan's cycle window | Every client-linked terminal state the DB already records; scalar/normalized reads only |
| How is progress marked? | **Derived at read time. No writes to `QuarterAssignment`.** | Grid persistence is full-state delete-and-recreate, last-write-wins (B3). Any server-written assignment column is clobbered by the next debounced PUT from a stale open browser. Deriving from existing tables has zero race surface and zero migration |
| Teamwork task shape | One top-level task per planned-week assignment, in that client's `teamworkTasklistId`; title `[SEO] Quarter Cycle — Week {n} ({M/D}–{M/D})`; due date = week's Friday, start date = week's Monday; description carries priority/status/note + idempotency marker; no time estimates, no priority flags | Mirrors the proven srt_ subtask contract (`er-handoff-memo` skill, `references/teamwork-push.md`) |
| One-way push vs sync | **One-way, idempotent push.** Re-push skips assignments whose marker already exists in the tasklist; moving a client to a new week creates a new task (old one is not auto-closed) | Same accepted limitation as the srt_ push; sync-back is a different product |
| Push mechanism | **Handoff token (`qct_`) + the `er-handoff-memo` skill doing the MCP push** — not a direct Teamwork REST client in the app | See Approaches below |
| Cascade protection | **Soft-archive (`Client.archivedAt`).** UI "Delete" becomes "Archive"; hard DELETE only allowed on already-archived clients | Reversible by default; the destructive path requires two deliberate steps |

## Approaches considered

### Teamwork push

- **A) Direct Teamwork REST API from the app** (server route + `TEAMWORK_API_KEY`).
  One-click UX, but: introduces a new server secret Kevin must provision, adds an
  external write dependency to the app, can't be production-verified without the
  key, and breaks the established architecture — every Teamwork/AI write in this
  system goes through a handoff token + external skill (pat_/srt_/krt_).
- **B) Handoff token (`qct_`) + skill push — CHOSEN.** Zero new app secrets;
  Teamwork auth stays in the already-connected MCP; the task-shape/idempotency
  contract is already proven by the srt_ flow; end-to-end verifiable today. Cost:
  pushing is a paste-into-Claude step, same as every memo flow the team already
  uses. (D1 later consolidates the four duplicated handoff flows; B5 deliberately
  follows the existing per-tool pattern rather than pre-building D1.)

### Progress marking

- **A) Write hooks** (tool completion flips `QuarterAssignment.status` to
  `in_progress` / stamps a progress column). Rejected: delete-and-recreate PUT
  clobbers server writes; auto-flipping `status` also fights the analyst's
  hand-set value (`on_hold`, `blocked`).
- **B) Derived read-time activity — CHOSEN.** A read service joins existing
  tables; the grid and dashboard *display* activity. `status`/`completed`
  remain 100 % human-owned.

### Cascade protection

- **A) `SetNull` + denormalized `clientName` snapshot on `QuarterAssignment`.**
  Rejected: the grid's sanitize/prune logic drops unknown-client rows on the
  next save anyway, so the snapshot dies in hours; adds payload complexity.
- **B) Soft-archive the Client — CHOSEN.** Protects *everything* (sessions,
  runs, audits, schedules, grid row survive untouched); restore is trivial.
  Known consequence (documented, accepted): an archived client disappears from
  `/api/clients`, so the grid prunes its chip on next load and its assignment
  row on the next save — restoring before the next grid save preserves it.

---

## Design

### 1. Schema (one migration)

```prisma
model Client {
  archivedAt DateTime?   // null = active; non-null = archived (hidden from lists/matching)
}
model QuarterPlan {
  teamworkPushedAt    DateTime? // set by the push-receipt route
  teamworkPushSummary String?   // JSON {created, skippedExisting, skippedNoTasklist}
}
```

Both additive + nullable. `persistPlan()`'s plan update writes only
`name/startDate/slotsPerWeek/layouts` (verified `lib/quarter-grid/persist.ts:91-99`),
so grid saves can never clobber the push columns. No FK changes —
`QuarterAssignment` cascades stay; archive prevents the destructive path.

### 2. Derived tool activity

**Service `lib/services/quarter-activity.ts`** (new, pure read):

```ts
type ActivityKind = 'seo-parse' | 'ada-audit' | 'seo-roadmap' | 'keyword-memo' | 'pillar-analysis'
type ClientActivity = { latest: { kind: ActivityKind; at: Date }; kinds: Partial<Record<ActivityKind, Date>> }
getQuarterActivity(clientIds: number[], since: Date): Promise<Map<number, ClientActivity>>
```

Batched scalar `findMany`s (dashboard read-service invariant: no blob readers):

- `CrawlRun`: `clientId in ids, completedAt >= since, status in ('complete','partial')`
  → kind `seo-parse` (tool `seo-parser`) or `ada-audit` (tool `ada-audit`, any source).
  Keyword-research parses produce a `seo-parse` CrawlRun; that is fine — the
  parse *is* activity (the memo is tracked separately below).
- `SeoRoadmap`: `status 'complete', roadmapUpdatedAt >= since`, client via
  `session.clientId in ids` → `seo-roadmap`.
- `KeywordResearchSession`: `status 'complete', memoUpdatedAt >= since,
  clientId in ids` (direct FK) → `keyword-memo`.
- `PillarAnalysis`: `status 'complete'`, client via `session.clientId in ids`,
  timestamp `narrativeUpdatedAt ?? createdAt >= since` → `pillar-analysis`.

**Cycle window:** `since = plan.startDate` (parsed `yyyy-mm-dd`, local
midnight, same parsing as `getWeekRange`) when set, else `plan.createdAt`.
No upper bound (the plan is "current" until replaced/reset).

**API `GET /api/quarter-plan/activity`** (auth, new file): loads the latest
plan; `{ activity: {} }` when no plan; else
`{ activity: Record<clientId, { latest: { kind, at }, kinds }> }` for the
plan's assignment clientIds. Dates serialize ISO.

**Grid UI:** `useQuarterPlan` fetches activity once after init settles
(fire-and-forget; failure logs and leaves activity empty — it must never touch
`canPersist`/`saveState`). Exposes `activity: Record<number, string>` —
clientId → preformatted tooltip line, e.g. `ADA audit · Jun 9` (latest only;
primitive string keeps `memo(Chip)` cheap). `Chip` gains an optional
`activity?: string` prop: when present, render a small ⚡ glyph (theme-colored,
`title={activity}`) between the status dot and the name. Passed through
`WeekGrid`/`PoolSection`/`AssignedSection` via the existing chip-props plumbing.

### 3. Teamwork push (qct_ handoff)

Mirrors the srt_ 3-file pattern (`lib/seo-roadmap-token.ts` /
`mint-token/route.ts` / `lib/seo-roadmap-prompt.ts`):

- **`lib/quarter-push-token.ts`** — HS256 JWT via `jose`; prefix `qct_`; env
  `QUARTER_PUSH_TOKEN_SECRET` (dev fallback string like the others); issuer
  `er-seo-tools`, audience `quarter-cycle-push`, subject `String(planId)`,
  scopes `['read','receipt-write']`, 1 h expiry. `mintQuarterPushToken(planId)`
  / `verifyQuarterPushToken(token, expectedPlanId)`.
- **`POST /api/quarter-plan/push/mint-token`** (cookie-auth like other mint
  routes): loads the latest plan; 409 `no_plan` when none, 409
  `nothing_planned` when no assignment has `week != null`; returns
  `{ token, expiresAt, planId }`.
- **`GET /api/quarter-plan/push/[planId]`** (Bearer `qct_`, scope `read`):
  verifies token subject === route planId; 404 if the plan no longer exists or
  is no longer the latest (singleton facade — only the current plan is
  exportable). Response:

  ```jsonc
  {
    "planId": 1, "planName": "Quarter plan", "startDate": "2026-06-15",
    "assignments": [ // week != null only, ordered week then position
      { "clientId": 30, "clientName": "Glow College", "week": 3,
        "weekStart": "2026-06-29", "weekEnd": "2026-07-03",  // null when startDate null
        "priority": 2, "status": "in_progress", "note": "…",
        "completed": false, "tasklistId": "123456" }          // null → skill reports skipped
    ],
    "teamwork": {
      "taskType": "task",                                      // top-level task, not subtask
      "rules": { "addTimeEstimates": false, "usePriorityFlags": false },
      "titleFormat": "[SEO] Quarter Cycle — Week {week} ({range})",
      "markerFormat": "quarter-cycle:{planId}:{clientId}:{week}"
    }
  }
  ```

  `weekStart`/`weekEnd` = Monday/Friday of the assigned week, computed from
  `startDate` with the same date math as `grid-ops.getWeekRange` (new exported
  ISO-date helper beside it so the two can't drift).
- **`POST /api/quarter-plan/push/[planId]/receipt`** (Bearer `qct_`, scope
  `receipt-write`): body `{ created, skippedExisting, skippedNoTasklist,
  skippedCompleted }` (non-negative ints, clamped); sets `teamworkPushedAt = now`,
  `teamworkPushSummary = JSON`. 200 `{ ok: true }`.
- **`lib/quarter-push-prompt.ts`** — `composeQuarterPushPayload({ webappUrl, planId, token })`:

  ```
  Push the current quarter cycle to Teamwork.

  Webapp: {webappUrl}
  Plan ID: {planId}
  Access token: {token}
  (Expires in 1h)

  Fetch the cycle export, create the planned-week tasks in each client's
  Teamwork tasklist, and post the push receipt back to the dashboard.
  ```

- **UI:** `components/quarter-grid/PushToTeamworkButton.tsx` (states
  idle/minting/copied/mint-failed, clipboard + `window.prompt` fallback —
  GenerateRoadmapButton's pattern) rendered in `GridHeader`'s controls row.
  `loadPlanResponse` additionally returns `teamworkPushedAt`/`teamworkPushSummary`
  (server-generated scalars, not part of the PUT payload); GridHeader shows
  `Last pushed {date} · {created} tasks` under the button when present.
- **Skill update** (`~/.claude/skills/er-handoff-memo`, versioned outside this
  repo): add the `qct_` prefix flow — fetch export; for each assignment with a
  `tasklistId`, paginate the tasklist's tasks, skip when any description
  contains the marker; create top-level tasks (title/description per export
  contract; description = priority label, status label, note, then the marker
  as last line; `startDate`/`dueDate` from `weekStart`/`weekEnd` when present;
  never set estimates/priority flags); collect counts; POST the receipt; report
  a summary table to the user. New `references/quarter-push.md` documents the
  contract; SKILL.md description gains the `qct_` trigger. Completed
  (`completed: true`) assignments are never pushed (decision: a done cycle
  doesn't need a fresh task) — counted as `skippedCompleted` in the receipt.

### 4. Client soft-archive

- **`PATCH /api/clients/[id]`** accepts `{ archived: boolean }` (alongside the
  existing editable fields): archiving sets `archivedAt = now` **and disables
  the client's enabled `Schedule` rows** in one array-form `$transaction`
  (an archived client must not keep running scheduled scans); restoring nulls
  `archivedAt` only (schedules stay disabled — deliberate, re-enable manually).
- **`DELETE /api/clients/[id]`**: 409 `{ error: 'archive_first' }` unless the
  client is already archived. The cascade behavior itself is unchanged.
- **`GET /api/clients`**: excludes archived by default; `?includeArchived=1`
  returns all with `archivedAt`. The quarter grid's validIds fetch uses the
  default → archived clients prune from the grid (documented above).
- **Sweep of active-client surfaces** (add `archivedAt: null`):
  `lib/services/client-fleet.ts` (fleet table), domain auto-match scans in
  `app/api/parse/[sessionId]/route.ts`, `app/api/ada-audit/route.ts`, and the
  site-audit enqueue path (`lib/ada-audit/queue-manager.ts` /
  `app/api/site-audit/route.ts` — exact sites enumerated at plan time via a
  `client.findMany` grep). `/clients/[id]` dashboard still loads archived
  clients and shows an "Archived" badge in `ClientHeader`.
- **Manage page (`/clients/manage`)**: active rows get **Archive** (with the
  existing confirm pattern) instead of Delete; a "Show archived" toggle reveals
  archived rows with **Restore** and **Delete** (confirm) actions.

### 5. Dashboard quarter-context card

- **Service** `getClientQuarterContext(clientId)` (new
  `lib/services/client-quarter.ts`): latest plan → this client's assignment →
  `null` (no plan or no assignment row) or `{ planName, startDate, week,
  weekRange (via getWeekRange), priority, status, note, completed, completedAt,
  latestActivity }` — `latestActivity` reuses `getQuarterActivity` for this one
  client. `week: null` = "in pool".
- **Component** `components/clients/QuarterContextCard.tsx`: card matching the
  scorecard styling — "This quarter: Week 5 (7/6–7/10)", priority badge
  (P-colors from `components/quarter-grid/theme.ts`), status label + dot,
  note, ✓ done state, latest-activity line, link to `/quarter-grid`. Empty
  states: "In pool — not scheduled" / "Not in the current quarter plan".
- **Page** `app/clients/[id]/page.tsx`: card rendered in the scorecards
  region (4th card in the grid row).

## Error handling

- Activity fetch failure in the hook: logged, empty activity, **never** touches
  `canPersist`/`saveState`.
- Export/receipt routes follow the srt_ route's token-error mapping
  (401 codes for expired/mismatch/signature; 404 not_found; 409 conflicts).
- Receipt route validates and clamps counts; malformed JSON → 400 (existing
  invariant: JSON.parse wrapped in try-catch).
- Archive PATCH on missing client → 404; DELETE on active client → 409.

## Testing

- `grid-ops`: new ISO week-date helper unit tests (incl. null startDate).
- `quarter-activity` + `client-quarter` services: DB-backed tests (unique
  client-name prefixes per file, per the test gotchas).
- Token lib: mint/verify/expiry/wrong-plan tests (mirror seo-roadmap-token tests).
- Push routes + activity route + archive-aware quarter-grid behavior: **added
  to `app/api/quarter-plan/route.test.ts`** — the singleton `QuarterPlan`
  table means all tests touching it stay in one file (B3/B4 gotcha). Clients
  API archive tests live in the clients route test file (own prefix).
- Components: `PushToTeamworkButton` (mint→copy flow, failure states),
  `QuarterContextCard` (full/pool/absent states), `Chip` activity glyph,
  manage-page archive/restore actions. `afterEach(cleanup)`; in-memory
  localStorage stub where the hook is involved; advance-until-condition loops
  instead of `waitFor` with fake timers (B4 gotchas).
- Hook: activity fetch failure tolerated; activity exposure doesn't break the
  persist-effect dep list (deps unchanged — activity is separate state).

## Out of scope (explicit)

- Multi-plan/quarter history; the singleton facade stays.
- Teamwork sync-back, auto-closing moved-week tasks, task updates on re-push.
- Direct Teamwork REST integration in the app.
- D1 handoff-engine consolidation (qct_ deliberately follows the existing
  duplicated per-tool pattern; D1 collapses all four later).
- Auto re-enabling schedules on restore.
- Backfilling `SessionPage`/blob data — untouched.

## Invariants honored (B3/B4/A2 — do not relitigate)

Singleton plan facade; PUT never creates a second plan; import 409s; mere
page-opens never write; persist-effect deps unchanged; skip-first-persist
untouched; localStorage `seo-quarter-v3` read-only; stable callbacks for
`usePoolKeyboard`; array-form transactions only; scalar-only read services;
quarter-plan API tests in one file.
