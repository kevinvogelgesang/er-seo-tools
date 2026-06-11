# Quarter Grid State → Database (B3) — Design

**Date:** 2026-06-11 · **Status:** spec
**Roadmap:** `../nyi/improvement-roadmaps/04-clients-and-quarter-grid.md` § Phase 2
**Tracker item:** B3 — Quarter Grid state localStorage → DB

## Problem

The Quarter Grid's real business state — per-client priority, status, notes,
week assignments, completion, saved layouts, start date, slots-per-week —
lives in one browser's localStorage under the key `seo-quarter-v3`. Clear the
browser and the quarter plan is gone; a second analyst opens the page and
sees nothing. The client list itself already comes from the DB
(`/api/clients`); only the planning state is browser-local.

## Goals

- Quarter Grid state persists in SQLite and is shared across browsers/users.
- A one-time importer moves the analyst's existing `seo-quarter-v3` payload
  into the DB with no manual steps beyond opening the page.
- Last-write-wins semantics (single-team tool, per roadmap decision).
- Minimal edits to `app/quarter-grid/page.tsx` — the 1,215-LOC monolith split
  is B4, not this item. Only the load/persist plumbing changes.

## Non-goals (explicitly out of scope)

- Component/hook split of the page (B4).
- Multi-plan UI, quarter switching, plan history views. The **schema**
  supports multiple `QuarterPlan` rows for future quarter-over-quarter
  history, but the v1 API and UI operate on a single plan (see "Singleton
  plan" below).
- Client-dashboard "quarter context" card (doc 04 Phase 1's deferred bullet)
  — now unblocked by this schema, but lands with B5 (grid ↔ tools closure)
  or a later polish PR.
- Conflict detection / updatedAt warnings — add only if simultaneous editing
  actually happens (roadmap decision).
- Offline editing. localStorage is read once by the importer and never
  written again; the old key stays untouched in the analyst's browser as a
  natural backup.

## Current state shape (verified from `page.tsx`)

localStorage `seo-quarter-v3` (current format):

```ts
{
  clientState: Record<clientId, { priority: 1–5, status: ClientStatus, note: string }>,
  schedule: Record<weekNumber, clientId[]>,   // 1–13; array order = slot order
  completed: number[],                        // clientIds marked done (pool or assigned)
  slotsPerWeek: 2 | 3,
  layouts: Record<name, { schedule, completed: number[], clients: Client[] }>, // named snapshots
  startDate: string                           // "yyyy-mm-dd" or ""
}
```

An **older format** stores `clients` as an array (with id/priority/status/
note) instead of `clientState`, and `snapshots` instead of `layouts`; the
page already migrates both on read. The importer must accept both formats
(reuse the same migration logic).

Notes are capped at 120 chars in the UI. `ClientStatus` is one of
`not_started | in_progress | on_hold | blocked | complete`. Per-client state
exists for **unassigned** (pool) clients too — week assignment and
priority/status/note/completed are independent.

## Approaches considered

**A. Full-state save (recommended, chosen).** One `PUT` carries the whole
grid state; the server replaces all assignments for the plan in one
array-form transaction. Matches the page's existing "persist everything on
any change" effect, matches the findings-writer delete-and-recreate pattern,
~30 rows per save is trivial for SQLite, and last-write-wins falls out
naturally.

**B. Granular mutation API** (`PATCH /assignments/:id`, move/reorder
endpoints). Smaller writes, but many more endpoints, client-side ordering
races between debounced calls, and far more code touched in the monolith —
exactly what B3 is supposed to avoid. Rejected.

**C. Keep localStorage primary, periodic background sync.** Doesn't fix
multi-user visibility or browser-loss durability; two sources of truth.
Rejected.

## Schema

```prisma
model QuarterPlan {
  id           Int       @id @default(autoincrement())
  name         String    @default("Quarter plan")  // freeform label, e.g. "2026-Q3"
  startDate    String?   // "yyyy-mm-dd" (date-only, TZ-free — matches the <input type=date>)
  slotsPerWeek Int       @default(2)               // 2 | 3
  layouts      String    @default("{}")            // JSON Snapshots blob (opaque, see below)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  assignments  QuarterAssignment[]
}

model QuarterAssignment {
  id          Int          @id @default(autoincrement())
  planId      Int
  plan        QuarterPlan  @relation(fields: [planId], references: [id], onDelete: Cascade)
  clientId    Int
  client      Client       @relation(fields: [clientId], references: [id], onDelete: Cascade)
  week        Int?         // 1–13; null = unassigned pool
  position    Int?         // slot index within the week (preserves Mon/Wed/Fri order); null when week is null
  priority    Int          @default(3)              // 1–5
  status      String       @default("not_started")  // ClientStatus
  note        String       @default("")             // ≤120 chars
  completedAt DateTime?                             // non-null = "done" checkbox
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  @@unique([planId, clientId])
  @@index([clientId])
}
```

Decisions:

- **One row per client per plan**, whether assigned or pooled. The save
  writes a row for every client currently in the page's client list (~30).
  No "only non-default state" filtering — simpler, and dashboard/B5 readers
  can rely on a row existing after the first save.
- **`completedAt` instead of a boolean.** The page only knows a boolean; the
  server preserves the first-completion timestamp: on save, if the incoming
  row says completed and the existing row already has `completedAt`, keep
  it; if newly completed, stamp now; if un-completed, null it.
- **`layouts` stays an opaque JSON string.** Layout snapshots embed full
  client-state copies and are load/apply-only blobs in the UI; normalizing
  them buys nothing. They are NOT origin blobs in the A2 sense (no findings
  derive from them; no retention concern at this size). Size-capped at
  256 KB on write.
- **`startDate` as a string**, not DateTime — the UI round-trips a
  `yyyy-mm-dd` value from `<input type=date>`; storing date-only text avoids
  timezone drift entirely.
- **`onDelete: Cascade` on both FKs.** Deleting a client removes its
  assignment rows (the page already drops it from local state optimistically;
  next save would otherwise FK-fail). Archive-not-orphan semantics are the
  roadmap's Phase 4 concern.
- `Client` gains the back-relation `quarterAssignments QuarterAssignment[]`.

### Singleton plan (v1 semantics)

The schema permits many `QuarterPlan` rows; v1 enforces **at most one** in
practice:

- `GET` returns the most recent plan (`orderBy id desc, take 1`) or `null`.
- `PUT` updates the most recent plan if one exists, otherwise creates it via
  a conditional raw insert (below). It never creates a second plan.
- Import refuses (409) when any plan exists.

When a future item needs "new quarter" semantics, it adds explicit
archive/create endpoints; nothing here blocks that.

## API

All under `app/api/quarter-plan/route.ts` + `app/api/quarter-plan/import/route.ts`.
`export const dynamic = 'force-dynamic'` like the other client routes.
Hand-rolled validation (repo has no zod); `JSON.parse`/body reads wrapped in
try-catch per repo convention.

### `GET /api/quarter-plan`

Returns `{ plan: null }` when no plan exists, else:

```ts
{
  plan: {
    name: string, startDate: string | null, slotsPerWeek: number,
    layouts: Snapshots,            // parsed JSON; {} on parse failure
    updatedAt: string,
  },
  assignments: Array<{
    clientId: number, week: number | null, position: number | null,
    priority: number, status: ClientStatus, note: string, completed: boolean,
  }>,
}
```

No plan id in the payload — the API is a singleton facade (see above).
Assignments are sorted **in JS after fetch** — SQLite sorts `NULL` first in
ascending `orderBy`, so Prisma ordering can't express "pool rows last".
Order: assigned rows by `week asc, position asc`, then pool rows; `clientId`
asc as the stable tie-breaker throughout.

### `PUT /api/quarter-plan`

Body = the same shape as GET's response value (`plan` scalars + `layouts` +
`assignments`). Server steps:

1. Validate + clamp (see Validation).
2. Read the latest plan id. If none, conditional-create:
   `INSERT INTO "QuarterPlan" (...) SELECT ... WHERE NOT EXISTS (SELECT 1 FROM "QuarterPlan")`
   via `$executeRaw` — table names **quoted** (Prisma-style identifiers),
   and BOTH `createdAt` and `updatedAt` set explicitly to `Date.now()`
   integer ms (raw SQL bypasses `@default(now())`/`@updatedAt`; storage is
   integer ms). If the insert reports 0 rows (lost a creation race), re-read
   the latest plan id and proceed — last write still wins.
3. Pre-reads (outside the transaction): existing `completedAt` per clientId
   for timestamp preservation; the set of existing `Client.id`s — incoming
   assignments whose `clientId` no longer exists are **dropped silently**
   (client deleted between page load and save; failing the whole save on an
   FK violation would lose the analyst's edit).
4. One array-form `$transaction([...])`: `update` plan scalars + layouts,
   `deleteMany` assignments for the plan, `createMany` the new rows — the
   `createMany` entry is included **only when ≥1 row survives sanitization**
   (zero clients / all rows pruned must not produce an invalid empty
   createMany). (**Never** the interactive `$transaction(async tx => ...)`
   form — CLAUDE.md "Do not", 2026-06-10 incident.)
5. Return the same shape as GET (echo of persisted state).

Last-write-wins: no version/etag checks, by design.

### `POST /api/quarter-plan/import`

Same body shape as PUT. Guard: refuse with `409 { error }` if **any**
`QuarterPlan` row exists. Creation itself uses the same conditional raw
insert; 0 rows affected → 409 (handles two analysts importing in the same
instant — exactly one wins). Then the same delete/createMany transaction
path as PUT. Returns the GET shape on success.

The import payload is produced **client-side** (the server cannot read the
analyst's localStorage) by a pure transform in `lib/quarter-grid/state.ts`.

## Shared module: `lib/quarter-grid/state.ts`

Client-safe pure TS (no Prisma imports — same pattern as
`lib/findings/normalize-url.ts`), so the page, the importer, and the API
routes share one source of truth and it's unit-testable without the
monolith:

- Types: `ClientStatus`, `ScheduleMap`, `Snapshots`, `QuarterPlanPayload`
  (the PUT/import body), `QuarterPlanResponse` (GET shape).
- `ALL_STATUSES`, `NUM_WEEKS = 13`, `NOTE_MAX = 120`, `LAYOUTS_MAX_BYTES`.
- `parseStoredQuarterState(raw: string)` — parses a `seo-quarter-v3`
  localStorage string, handling **both** formats (current `clientState` +
  legacy `clients[]`/`snapshots`) with the exact migration semantics the
  page uses today; returns `null` for corrupt/empty input.
- `buildPlanPayload(state, validClientIds)` — page/local state →
  `QuarterPlanPayload` (flattens `schedule` into `(week, position)` pairs,
  `completed` Set into booleans, includes pool clients). Takes the current
  DB client-id set and **drops unknown ids** everywhere (schedule, completed,
  clientState) — old localStorage payloads can reference deleted clients.
- `applyPlanResponse(resp, validClientIds)` — GET shape → the page's state
  pieces (`clientState` record, `schedule`, `completed` set, scalars), also
  pruning ids not in the current client list so unknown ids never enter
  page state.
- `sanitizeSnapshotForApply(snapshot, currentClients)` — used by
  `applyLayout`: applies a snapshot's per-client priority/status/note onto
  the **current DB client list only** (no `setClients(s.clients)` wholesale —
  a stale snapshot must not resurrect deleted clients or stale names), and
  prunes schedule/completed ids not in the current set.
- `sanitizePlanPayload(body: unknown)` — validation/clamping used by both
  routes; returns a normalized payload or a string error.

The page keeps its own local `Client`/`Schedule` types (client components
define local interfaces — B1/B2 convention) but they're structurally
identical to the module's.

## Validation / clamping (server-side, in `sanitizePlanPayload`)

- `week`: integer 1–13, else `null` (treat as pool rather than reject).
- `position`: integer ≥ 0, else null; forced null when `week` is null.
- `priority`: integer clamped to 1–5; default 3.
- `status`: must be in `ALL_STATUSES`, else `not_started`.
- `note`: string, sliced to 120 chars; default `""`.
- `completed`: coerced boolean.
- `clientId`: positive integer, else the row is dropped.
- Duplicate `clientId`s in one payload: keep-first (mirrors the
  `@@unique([planId, clientId])` constraint instead of tripping it).
- `slotsPerWeek`: 2 or 3, else 2.
- `startDate`: must match `/^\d{4}-\d{2}-\d{2}$/`, else `null` (empty string
  → null).
- `name`: non-empty string ≤ 80 chars, else default `"Quarter plan"`.
- `layouts`: object; re-serialized JSON must be ≤ `LAYOUTS_MAX_BYTES`
  (256 KB), else `400` (the only hard reject besides unparseable body — an
  oversized layouts blob means something is wrong, and silently dropping
  saved layouts would destroy user data).

## Page changes (`app/quarter-grid/page.tsx`, minimal)

**Init effect** (replaces the current localStorage restore):

1. Fetch `/api/clients` and `GET /api/quarter-plan` in parallel.
2. If the GET returns a plan → hydrate via `applyPlanResponse`.
3. Else, if `localStorage['seo-quarter-v3']` parses via
   `parseStoredQuarterState` → `POST /api/quarter-plan/import` and hydrate
   from the response; toast "Imported quarter plan from this browser". On
   409 (someone else imported first) → re-GET and hydrate from the DB.
   On other import failure → hydrate from the localStorage payload anyway
   (read-only session; the save path will retry persisting) and surface the
   save-status indicator's error state.
4. Else → fresh empty state (as today with no localStorage).
5. Merge DB client list with per-client state exactly as today (defaults
   priority 3 / not_started / empty note for clients without rows).
6. **`loaded` flips to `true` only after the whole init sequence —
   including the import decision — resolves.** If the persist effect could
   fire earlier, a debounced empty save would create an empty plan and make
   the real localStorage import 409.

**Persist effect** (replaces `persist()`):

- Same dependency list and `loaded` gate as today, but now builds
  `buildPlanPayload(...)` and `PUT`s it, **debounced ~800 ms trailing**
  (drag sequences and keyboard bursts collapse into one save).
- A `pagehide` listener flushes a pending debounce via
  `fetch(..., { keepalive: true })` so closing the tab right after an edit
  doesn't lose the last change. **Best-effort only:** browsers cap keepalive
  bodies at ~64 KB, so a payload with a large `layouts` blob may exceed it
  and be dropped — the debounced save path is the real persistence
  mechanism; the flush just narrows the close-the-tab-instantly window.
- **No more `localStorage.setItem`.** The old key is never written or
  removed — it remains a frozen pre-migration backup in the analyst's
  browser.
- In-flight ordering: a monotonically increasing save sequence number;
  stale responses (an earlier save resolving after a later one) never
  overwrite the status indicator's state.

**Save-status indicator:** a small text element in the header — `saving…` /
`saved` / `⚠ not saved — retrying on next change`. On failed PUT, also
`flash()` a toast. Failed saves are not queued/retried on a timer; the next
state change (or page reload) tries again. This is the v1 failure story for
an internal tool, stated plainly.

Everything else in the page — drag/drop, chips, gantt, CSV import, layouts
UI, add/remove client, reset — is untouched; those handlers keep mutating
the same React state, and the persist effect picks the changes up.

`saveLayout`/`deleteLayout` keep operating on the in-memory `layouts`
object, which now persists through the same PUT (it's part of the payload)
instead of localStorage. **`applyLayout` changes:** instead of
`setClients(s.clients)` wholesale, it goes through
`sanitizeSnapshotForApply` — snapshot priority/status/note apply only onto
clients that still exist in the current DB list, and schedule/completed ids
not in the current set are pruned. A stale snapshot must never resurrect a
deleted client or overwrite a renamed one.

## Error handling

- GET/PUT/import wrap body parsing and Prisma calls in try-catch → `500
  { error }` with `console.error`, per repo convention.
- The page treats a failed initial GET as "no plan" but **suppresses the
  importer** (cannot risk importing over an existing-but-unreachable plan)
  and shows the error save-state; it hydrates from localStorage read-only if
  present so the analyst can at least see their grid.
- Corrupt `layouts` JSON in the DB row: GET returns `{}` for layouts and
  logs; never 500s over a blob.

## Testing

- **`lib/quarter-grid/state.test.ts`** (pure, no DB): both localStorage
  formats parse; corrupt/empty input → null; round-trip
  `buildPlanPayload` ↔ `applyPlanResponse` preserves schedule order, pool
  membership, completed set; unknown-id pruning in both directions;
  `sanitizeSnapshotForApply` (stale snapshot doesn't resurrect deleted
  clients, doesn't clobber current names, prunes schedule/completed);
  `sanitizePlanPayload` clamping table (week out-of-range, bad status, long
  note, dup clientIds keep-first, oversized layouts reject, startDate
  regex).
- **`app/api/quarter-plan/route.test.ts` + `import/route.test.ts`**
  (DB-backed, repo conventions: unique name prefix per file, clean up own
  rows, `DATABASE_URL=file:./local-dev.db` quirk):
  - GET with no plan → `{ plan: null }`.
  - PUT with no plan creates exactly one (conditional insert); second PUT
    updates the same row (no second plan).
  - PUT with zero surviving assignment rows succeeds (no empty createMany).
  - PUT replaces assignments (delete-and-recreate), preserves existing
    `completedAt`, stamps new completions, nulls un-completions.
  - PUT drops rows for deleted clients without failing the save.
  - Import succeeds on empty DB, 409s when a plan exists.
  - Client delete cascades its assignment rows.
- **No page-component tests in B3.** The monolith is untestable by design
  until B4 extracts the hook; the logic that moved (parse/build/apply/
  sanitize) is fully covered in the pure module. Manual + production
  verification covers the wiring.

## Production rollout / verification

1. Migration via deploy (`prisma migrate deploy` runs automatically).
2. After deploy, Kevin (or the owning analyst) opens `/quarter-grid` in the
   browser that holds the real `seo-quarter-v3` state → auto-import fires.
3. Verify: assignments/priorities/notes/layouts render identically; a second
   browser (or incognito) shows the same grid; a drag in one browser appears
   in the other after reload; node+Prisma spot-check of `QuarterPlan` /
   `QuarterAssignment` rows on the server (no sqlite3 CLI).
4. Restart-safety: nothing here touches the job queue; saves are plain
   request/response.

## Risks

- **Analyst's localStorage lives in one specific browser** — the import
  only happens when that browser opens the page while the DB is empty. If a
  different browser opens it first and saves, the guard blocks the real
  import. Mitigation: deploy + have Kevin open it in the right browser
  first; if it goes wrong, delete the plan rows and re-open (the localStorage
  backup is never destroyed).
- **Last-write-wins whole-state saves** can clobber concurrent edits from a
  second analyst. Accepted by roadmap decision; revisit only if it bites.
- **Layouts blob growth** — bounded by the 256 KB cap; snapshots of ~30
  clients are a few KB each.
