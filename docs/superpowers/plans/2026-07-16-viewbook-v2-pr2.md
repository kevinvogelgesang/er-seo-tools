# Viewbook v2 PR2 — Live Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mutation of rendered viewbook data bumps `Viewbook.syncVersion` inside its own fenced transaction; public + admin pages poll a cheap version endpoint and refresh through ONE coordinated refresher that never clobbers in-progress edits.

**Architecture:** A `lib/viewbook/sync.ts` statement factory produces pre-state-predicated raw bump statements that ride INSIDE the existing array-form transactions (the same companion-statement pattern the activity inserts already use — bump first, domain statement after, predicates mirrored so a failed/replayed domain write bumps nothing). Two version endpoints (`GET /api/viewbook/[token]/sync` public, `GET /api/viewbooks/[id]/sync` admin). One `useViewbookSync` hook owns polling + refresh; editing islands register with a module-level editor registry that suspends refresh while any editor is focused/dirty/saving.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite (raw `$executeRaw`/`Prisma.sql` fragments), vitest.

## Global Constraints

- Array-form `$transaction([...])` ONLY. Raw SQL sets `updatedAt` manually (integer ms: `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)` in SQL, or `Date.now()` when bound as a parameter).
- **Fence-sharing rule (spec §6, Codex fix 5):** a bump commits IFF its domain write commits. Three mechanisms, chosen per path: (a) txns whose domain statement is a compound-where `.update()` (P2025 throws → whole array rolls back) take an UNCONDITIONAL bump statement; (b) raw guarded INSERT/UPDATE paths take a bump whose SQL predicate MIRRORS the path's existing activity-insert predicate (pre-state-conditioned, placed BEFORE the domain statement — replays and no-ops bump nothing); (c) bare `updateMany`/`deleteMany`-then-check-count paths become two-statement arrays `[predicated bump, domain]` where the bump carries the SAME pre-state predicate as the domain `where`.
- **Bump-excluded metadata (spec §6):** digest cursor/`digestSentAt`, token rotate/revoke, delivery-row stamps, and `notifyEmail`-only settings patches. `updateViewbookSettings` is MIXED — bump only when `welcomeNote` or `kind` is in the patch.
- The public sync endpoint returns `{ v: number }` ONLY, `Cache-Control: no-store`, behind `requireViewbookToken` with the standard indistinguishable-404 contract.
- New public middleware matcher: exactly `^/api/viewbook/[^/]+/sync$` — anchored, added beside the existing five with positive + deeper-path-negative matcher tests.
- The hook is the SINGLE refresher: the v1 mutation-side `router.refresh()` calls are removed. Poll cadence ~3.5 s while `document.visibilityState === 'visible'`, paused hidden, exponential backoff to ~30 s max on errors.
- Gates before merge: `npx tsc --noEmit`, `npm run lint`, `DATABASE_URL="file:./local-dev.db" npm test`, `npm run build`. Work in worktree branch `feat/viewbook-v2-pr2`.
- Program-wide contract this PR creates: `syncVersionBumpStatement()` is exported for PR3/PR4/PR5/PR7 to adopt (merge gate in the program doc).

## Write-path inventory (authoritative bump map)

From the merged main tree (post-#195). "Mechanism" letters refer to the fence-sharing rule above.

| # | Path | file:line | Mechanism | Notes |
|---|---|---|---|---|
| 1 | `applyAnswerEdit` | `lib/viewbook/answers.ts:170` (tx :183) | b | Mirror the activity INSERT's predicate (value-unchanged no-op path at :222 returns before the tx — bump-free already; the raw UPDATE's own fence `editableWhere` guards the rest) |
| 2 | `proposeAmendment` | `answers.ts:253` (tx :267) | b | Activity INSERT already carries `NOT EXISTS clientMutationId` — mirror it; replay (`:293`) bumps nothing |
| 3 | `lockViewbook` | `answers.ts:321` (tx :327) | c | Bump predicated `EXISTS(Viewbook {id, dataLockedAt IS NULL})`; `alreadyLocked` path bump-free |
| 4 | `insertClientFeedback` | `lib/viewbook/public-writes.ts:38` (tx :47) | b | Mirror activity predicate (token/revoked/active/section/link-ownership/cap + NOT EXISTS mutId) |
| 5 | `insertClientMaterial` | `public-writes.ts:114` (tx :123) | b | Same |
| 6 | `updateViewbookTheme` | `lib/viewbook/service.ts:133` (`mustUpdateViewbook` :461) | c | `[bump EXISTS(Viewbook id), updateMany]`; see Task 3 for the shared helper |
| 7 | `updateViewbookSettings` | `service.ts:146` | c (conditional) | Bump ONLY when patch has `welcomeNote`/`kind`; notifyEmail-only = no bump |
| 8 | `setSectionState` | `service.ts:181` | a | `.update()` on compound unique throws P2025 → unconditional bump in the array |
| 9 | `updateSectionText` | `service.ts:205` | a | Convert the single `.update()` to `$transaction([bump, update])` — update still throws P2025, rolling the bump back |
| 10 | `moveViewbookStage` | `service.ts:238` (tx :252) | a | Unconditional bump joins the existing array |
| 11 | `createMilestone` | `service.ts:271` | a/c | `current` variant: bump joins the array (create throws on failure); plain create: wrap `[bump EXISTS(Viewbook id), create]` |
| 12 | `updateMilestone` | `service.ts:296` | a | Both variants end in a P2025-throwing `.update({id, viewbookId})` |
| 13 | `deleteMilestone` | `service.ts:331` | c | `[bump EXISTS(Milestone {id, viewbookId}), deleteMany]` |
| 14 | `syncCatalogQuestions` | `service.ts:340` | a (per-row) | Each admitted insert becomes `$transaction([syncVersionBumpStatement(id), create])` — P2002 rolls the bump back with the skipped row (Codex wave-2 fix 1: no post-loop crash window; multiple bumps for one sync are fine, atomicity beats increment-exactness) |
| 15 | `attachThemeAsset` | `service.ts:390` (stamp :410) | c | `[bump EXISTS(Viewbook {id, themeJson: loaded}), updateMany same fence]` — both hit or both miss |
| 16 | fields POST (raw INSERT…SELECT) | `app/api/viewbooks/[id]/fields/route.ts:35` | b | Bump predicated on the same `WHERE v.id=? AND c.archivedAt IS NULL` guard, in one array with the INSERT (convert `$queryRaw` single call to `$transaction([bump, insert])` — keep RETURNING semantics by re-reading after, or fetch the row post-tx by unique) |
| 17 | field label PATCH | `app/api/viewbooks/[id]/fields/[fieldId]/route.ts:75` | c | Bump `EXISTS(Field {id, viewbookId, defKey NULL, archivedAt NULL})` |
| 18 | field archive DELETE | same file :103 | c | Bump `EXISTS(Field {id, viewbookId, archivedAt NULL})` |
| 19 | resolve feedback | `app/api/viewbooks/[id]/feedback/[feedbackId]/resolve/route.ts:18` | c | Bump `EXISTS(Feedback join chain to viewbookId)` |
| 20 | review-link POST (raw) | `app/api/viewbooks/[id]/milestones/[milestoneId]/review-links/route.ts:36` | b | Bump shares the `EXISTS milestone {id, viewbookId}` guard |
| 21 | review-link DELETE | `app/api/viewbooks/[id]/review-links/[reviewLinkId]/route.ts:17` | c | Bump `EXISTS(ReviewLink {id, milestone.viewbookId})` |
| 22 | `putContentOverride` / `deleteContentOverride` | `lib/viewbook/global-content.ts:201/:220` | c | Scoped bump (this viewbook only): `[bump EXISTS(Viewbook id), upsert]` / `[bump EXISTS(Override {viewbookId, contentKey}), deleteMany]` |
| 23 | `putGlobalContent` (non-team) | `global-content.ts:74` (upsert :83) | unscoped | `$transaction([upsert, bumpAll])` |
| 24 | `putTeamRoster` | `global-content.ts:96` (:111/:114) | unscoped | create variant: `[create, bumpAll]`; fenced variant: `[bumpAll predicated EXISTS(GlobalContent {key:'team', bodyJson: loaded}), updateMany same fence]` |
| 25 | `attachTeamPhoto` | `global-content.ts:154` (stamp :183) | unscoped | Same fenced-pair shape as 24; orphan-file cleanup flow unchanged |

Excluded (NO bump): digest stamps (`lib/viewbook/digest.ts:55/:72`), `rotateViewbookToken`/`revokeViewbook` (`service.ts:171/:177`), notifyEmail-only settings patches, `createViewbook`/`deleteViewbook` (no live viewers / row gone).

---

### Task 1: Bump statement factory (`lib/viewbook/sync.ts`)

**Files:**
- Create: `lib/viewbook/sync.ts`, `lib/viewbook/sync.test.ts`

**Interfaces:**
- Produces (all return `Prisma.PrismaPromise<number>` from `prisma.$executeRaw`, composable into array transactions):
  - `syncVersionBumpStatement(viewbookId: number)` — unconditional scoped bump (mechanism a).
  - `syncVersionBumpWhere(viewbookId: number, predicate: Prisma.Sql)` — scoped bump with an appended `AND (<predicate>)` pre-state guard (mechanisms b/c). **The predicate MUST be a self-contained expression** — typically a complete `EXISTS (SELECT 1 FROM … JOIN … WHERE …)` with its own aliases (Codex wave-2 fix 2: the activity fragments like `editableWhere()` reference `f/v/c/s` aliases that do not exist in the bump's outer UPDATE — callers wrap them in a full EXISTS subquery that re-declares those joins, never paste a bare WHERE fragment).
  - `syncVersionBumpAllStatement()` — unscoped all-viewbooks bump (global content).
- Consumes: `Prisma.sql` from `@prisma/client`, `prisma` from `@/lib/db`.

- [ ] **Step 1: Write failing tests** — `sync.test.ts` (DB-backed, service-suite conventions):

```ts
import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { syncVersionBumpStatement, syncVersionBumpWhere, syncVersionBumpAllStatement } from './sync'
// reuse the service suite's client-creation pattern (mkClient equivalent) inline

describe('syncVersion bump statements', () => {
  it('unconditional bump increments and stamps updatedAt', async () => {
    const { id } = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    const before = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    await prisma.$transaction([syncVersionBumpStatement(id)])
    const after = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(after.syncVersion).toBe(before.syncVersion + 1)
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime())
  })
  it('predicated bump is a no-op when the predicate is false', async () => {
    const { id } = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    await prisma.$transaction([
      syncVersionBumpWhere(id, Prisma.sql`EXISTS (SELECT 1 FROM "Viewbook" WHERE "id" = ${id} AND "dataLockedAt" IS NOT NULL)`),
    ])
    const after = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(after.syncVersion).toBe(0)
  })
  it('predicated bump fires when the predicate is true', async () => {
    const { id } = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    await prisma.$transaction([
      syncVersionBumpWhere(id, Prisma.sql`EXISTS (SELECT 1 FROM "Viewbook" WHERE "id" = ${id} AND "dataLockedAt" IS NULL)`),
    ])
    const after = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(after.syncVersion).toBe(1)
  })
  it('bump rolls back when a later statement in the array throws (P2025)', async () => {
    const { id } = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    await expect(prisma.$transaction([
      syncVersionBumpStatement(id),
      prisma.viewbook.update({ where: { id, stage: 'kickoff' }, data: { stage: 'building' } }), // stage is 'building' → P2025
    ])).rejects.toThrow()
    const after = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(after.syncVersion).toBe(0)
  })
  it('bumpAll touches every viewbook', async () => {
    const a = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    const b = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    await prisma.$transaction([syncVersionBumpAllStatement()])
    const rows = await prisma.viewbook.findMany({ where: { id: { in: [a.id, b.id] } } })
    expect(rows.map((r) => r.syncVersion)).toEqual([1, 1])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/sync.test.ts` → module not found.

- [ ] **Step 3: Implement `lib/viewbook/sync.ts`**

```ts
// v2 PR2: syncVersion bump statement factory (spec §6). Bumps ride INSIDE the
// existing array-form transactions. Fence-sharing: predicated variants carry
// the SAME pre-state predicate as the domain statement they accompany and are
// placed BEFORE it (the activity-insert companion pattern) — a failed or
// replayed domain write bumps nothing. Raw SQL sets updatedAt manually.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export function syncVersionBumpStatement(viewbookId: number) {
  return prisma.$executeRaw`UPDATE "Viewbook" SET "syncVersion" = "syncVersion" + 1, "updatedAt" = ${Date.now()} WHERE "id" = ${viewbookId}`
}

export function syncVersionBumpWhere(viewbookId: number, predicate: Prisma.Sql) {
  return prisma.$executeRaw`UPDATE "Viewbook" SET "syncVersion" = "syncVersion" + 1, "updatedAt" = ${Date.now()} WHERE "id" = ${viewbookId} AND (${predicate})`
}

export function syncVersionBumpAllStatement() {
  return prisma.$executeRaw`UPDATE "Viewbook" SET "syncVersion" = "syncVersion" + 1, "updatedAt" = ${Date.now()}`
}
```

- [ ] **Step 4: Green** — same command, 5/5 pass.
- [ ] **Step 5: Commit** — `feat(viewbook): syncVersion bump statement factory`

---

### Task 2: Public-write adoption (answers + public-writes)

**Files:**
- Modify: `lib/viewbook/answers.ts` (rows 1–3 of the inventory), `lib/viewbook/public-writes.ts` (rows 4–5)
- Test: `lib/viewbook/answers.test.ts`, `lib/viewbook/public-writes.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's three factories.
- Produces: every public write bumps exactly once on success; replays/no-ops/conflicts bump zero times. (No signature changes.)

- [ ] **Step 1: Write failing tests** — for each path, three assertions in the existing suites (reuse their arrange helpers):
  (i) successful write → `syncVersion` +1; (ii) `clientMutationId` replay (amendment/feedback/material) → +0 versus post-first-write value; (iii) fenced failure (stale `expectedVersion` edit → `stale_version`; feedback on a hidden section → 404 path) → +0. For `applyAnswerEdit` also: value-unchanged no-op save → +0. For `lockViewbook`: first lock +1, `alreadyLocked` re-lock +0.
- [ ] **Step 2: Verify failures** (bumps currently never happen — the +1 assertions fail).
- [ ] **Step 3: Implement** — in each transaction array, add the bump BEFORE the domain statements. The bump's predicate is a SELF-CONTAINED `EXISTS (SELECT 1 FROM … WHERE …)` expression that re-declares the same joins/conditions the adjacent activity statement uses (rows 1, 2, 4, 5 — same semantics, own aliases; keep parameters identical) or mirrors the fenced `updateMany` where (row 3). Never paste a bare alias-dependent WHERE fragment into the bump (Codex wave-2 fix 2). Do not touch any early-return no-op path.
- [ ] **Step 4: Green** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/answers.test.ts lib/viewbook/public-writes.test.ts`.
- [ ] **Step 5: Commit** — `feat(viewbook): syncVersion bumps on public writes (fence-shared)`

---

### Task 3: Service + admin-route adoption

**Files:**
- Modify: `lib/viewbook/service.ts` (rows 6–15), `app/api/viewbooks/[id]/fields/route.ts` (row 16), `app/api/viewbooks/[id]/fields/[fieldId]/route.ts` (rows 17–18), `app/api/viewbooks/[id]/feedback/[feedbackId]/resolve/route.ts` (row 19), `app/api/viewbooks/[id]/milestones/[milestoneId]/review-links/route.ts` (row 20), `app/api/viewbooks/[id]/review-links/[reviewLinkId]/route.ts` (row 21)
- Test: `lib/viewbook/service.test.ts` + the existing admin route suites (extend)

**Interfaces:** consumes Task 1; no signature changes. `mustUpdateViewbook` gains an optional variant or call-sites are converted per the inventory — implementer's choice, but rows 6–7's bump must ride in the same `$transaction` as the `updateMany`.

- [ ] **Step 1: Failing tests** — per inventory row: success → +1; fenced failure (cross-viewbook milestone id, stale themeJson conflict 409, unknown section key) → +0; row 7 mixed: `{welcomeNote}` patch +1, `{notifyEmail}`-only patch +0; row 10 stage-move loser (stale expectedStage) → +0; row 14: sync with nothing missing → +0, with missing defKeys → +1 (exactly one bump, not per-row); metadata exclusions: rotate/revoke → +0.
- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Implement per the inventory's mechanism column.** Row 16: `$transaction([bump-with-same-guard, $queryRaw INSERT…RETURNING])` with the RETURNING query as the LAST array member and its returned id used for the response — a post-transaction `findFirst({label, createdBy})` is FORBIDDEN (duplicate custom labels are legal; ambiguous under concurrency — Codex wave-2 fix 3). Row 14 per its updated inventory row (per-row `[bump, create]` pairs).
- [ ] **Step 4: Green** — service + the four route suites.
- [ ] **Step 5: Commit** — `feat(viewbook): syncVersion bumps across service + admin routes`

---

### Task 4: Global-content transaction-ification + unscoped bumps

**Files:**
- Modify: `lib/viewbook/global-content.ts` (rows 22–25)
- Test: `lib/viewbook/global-content.test.ts` (extend)

- [ ] **Step 1: Failing tests** — `putGlobalContent('process', …)` bumps EVERY viewbook (+1 on two independently created viewbooks); `putTeamRoster` conflict (`roster_conflict` 409 via stale loaded bodyJson) bumps nothing anywhere; `attachTeamPhoto` success bumps all + keeps the orphan-cleanup behavior (failed stamp deletes the new file AND bumps nothing); `putContentOverride` bumps ONLY its own viewbook.
- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Implement** — wrap each write in an array `$transaction` per inventory rows 22–25, preserving the loaded-`bodyJson` fences verbatim; the fenced pairs put `syncVersionBumpAllStatement`… CAREFUL: the fenced variants need the PREDICATED all-bump — add a fourth factory `syncVersionBumpAllWhere(predicate: Prisma.Sql)` to `sync.ts` (same shape, no id clause) with a unit test in `sync.test.ts` (mirror Task 1's predicated tests).
- [ ] **Step 4: Green.**
- [ ] **Step 5: Commit** — `feat(viewbook): global-content writes transactional + unscoped bumps`

---

### Task 5: Version endpoints + payload + middleware matcher

**Files:**
- Create: `app/api/viewbook/[token]/sync/route.ts`, `app/api/viewbooks/[id]/sync/route.ts`
- Modify: `middleware.ts` (~line 78: add `^/api/viewbook/[^/]+/sync$`), `lib/viewbook/public-data.ts` + `lib/viewbook/public-types.ts` (payload gains `syncVersion: number`)
- Test: `middleware.test.ts` (extend the PR2 matcher describe at :135), new `app/api/viewbook/sync-route.test.ts`, `lib/viewbook/public-data.test.ts` (payload assertion)

**Interfaces:**
- Produces: public `GET /api/viewbook/[token]/sync` → `200 {v}` + `Cache-Control: no-store` (invalid/revoked/archived → 404, same body as other token failures); admin `GET /api/viewbooks/[id]/sync` → `{v}` (404 unknown id, cookie-gated by default middleware). `ViewbookPublicData.syncVersion`.

- [ ] **Step 1: Failing tests** — matcher: positive `/api/viewbook/tok/sync`, negatives `/api/viewbook/tok/syncx`, `/api/viewbook/tok/sync/extra`, `/api/viewbooks/3/sync` (NOT public). Route: 200 `{v}` with no-store header for a live token; 404 invalid + revoked token; v reflects a bump (write, poll again, +1). Admin route: 200 `{v}`, 404 unknown. Payload: `loadViewbookPublicData` returns `syncVersion`.
- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Implement** — public route via `requireViewbookToken(token)` then `NextResponse.json({ v: vb.syncVersion }, { headers: { 'Cache-Control': 'no-store' } })` (re-select if the validator's row shape lacks syncVersion — extend its select). Admin route mirrors the lock route's shell with `parseId` + `findUnique select {syncVersion}` → 404 on null. Middleware line + comment beside the five.
- [ ] **Step 4: Green** (matcher + route + payload suites) and `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(viewbook): version endpoints + public matcher + payload syncVersion`

---

### Task 6: `useViewbookSync` + editor registry + single-refresher migration

**Files:**
- Create: `components/viewbook/public/useViewbookSync.ts` (hook + module-level editor registry), `components/viewbook/public/ViewbookSyncClient.tsx` (mounts the hook; rendered by `ViewbookShell`), `components/viewbook/public/useViewbookSync.test.ts`
- Modify: `components/viewbook/public/ViewbookShell.tsx` (render `<ViewbookSyncClient token={…} initialVersion={…} />`), `app/(public)/viewbook/[token]/page.tsx` (thread token + syncVersion), `FieldEditor.tsx` (drop `RefreshAfterSave`/`router.refresh` at :106; register editor activity; on save success call the registry's `requestRefresh()`), `AmendmentForm.tsx` (same at :80), `MaterialLinkForm.tsx` (same at :40), `FeedbackThread.tsx` (register editor activity only — it keeps its optimistic append, no refresh call), `components/viewbook/admin/ViewbookEditor.tsx` (poll `/api/viewbooks/[id]/sync` every 3.5 s visible → on change `void load()`; suspend while any editor-registry entry is active)
- Test: hook unit tests (fake timers), updated island tests

**Interfaces:**
- Produces (module `useViewbookSync.ts`):
  - `registerEditorActivity(id: string, active: boolean): void` — module registry; islands call it on focus/dirty/save-in-flight transitions (dispose on unmount).
  - `requestRefresh(): void` — marks a pending refresh; the hook (single owner) executes it when no editor is active.
  - `useViewbookSync(opts: { url: string; initialVersion: number; intervalMs?: number; onChange: () => void; onGone?: () => void })` — polls `url` (`{v}`) while visible; on `v !== last` OR a pending `requestRefresh`, when registry is idle → calls `onChange` exactly once (coalesced) and clears pending; error backoff doubles to 30 s max; pauses hidden; resumes with an immediate check. **Refresh latch (Codex wave-2 fix 5):** the hook records the observed remote `v` BEFORE calling `onChange` and suppresses further onChange calls until the `initialVersion` prop advances to (or past) that recorded value (the RSC refresh completing re-renders the client with the new prop; the internal ref re-syncs from the prop on change) — a slow refresh can never trigger repeated refreshes on every poll. **Terminal 404 (fix 4):** a 404 from the sync endpoint means the token was revoked/rotated (or the viewbook deleted) — call `onGone ?? onChange` EXACTLY ONCE and stop polling permanently (the server re-render resolves to `notFound()`); only network/5xx errors get backoff.
- Consumes: Task 5's endpoints; the public `onChange` is `router.refresh()` (inside `ViewbookSyncClient`), the admin `onChange` is `load()`.

- [ ] **Step 1: Failing hook tests** (jsdom + `vi.useFakeTimers`, fetch mocked): fires `onChange` once when v changes; latch — v changes but `initialVersion` prop has not advanced → NO second onChange on the next poll, and the prop advancing re-arms it; coalesces poll-change + requestRefresh into ONE onChange; suppresses while an editor is registered active and flushes ONE refresh on release; 404 → exactly one `onGone` then polling stops permanently; backs off on fetch error (5xx/network) and recovers; does nothing while `document.visibilityState === 'hidden'` (mock) and checks immediately on visibilitychange; a fetch resolving AFTER unmount is ignored (no state update, no onChange); polls never overlap (recursive timeout, not setInterval); registry reset seam clears state between tests.
- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Implement hook + registry** with the lifecycle rules (Codex wave-2 fix 7): registry entries keyed by instance-unique ids (`useId()` or a module counter) and unregistered on unmount; a test-only `__resetSyncRegistry()` export; stale fetch completions ignored via an aborted/epoch check; recursive `setTimeout` scheduling (never `setInterval`); the single-mount guard tolerates React Strict Mode's dev double-mount (warn only when TWO LIVE instances coexist after effects settle).
- [ ] **Step 4: Migrate the islands** — FieldEditor: `registerEditorActivity(fieldKey, focused || busy || draftDirty)`; replace the `RefreshAfterSave` mechanism with `requestRefresh()` on save success (delete the dead component); AmendmentForm/MaterialLinkForm: same pattern at their former refresh sites; FeedbackThread: registration only. Update each island's tests: assert `requestRefresh` (spy on the module) replaces `router.refresh`, and no island imports `useRouter` for refresh purposes anymore.
- [ ] **Step 5: Wire the page + shell + admin editor** per Files. **Admin dirty protection lands NOW, not PR8 (Codex wave-2 fix 6):** a focused-control check alone is insufficient — `ThemeEditor`, `ContentTab`, `DataSourceTab`, `MilestonesEditor`, and the inline `SettingsTab` hold unsaved local drafts after blur. Each of those admin islands adopts `registerEditorActivity` (active while any of its draft state differs from the loaded value OR a save is in flight OR one of its controls has focus); the editor's poll `onChange` (`void load()`) only fires while the registry is idle — same rule as the public page. Files list for this step grows accordingly: `components/viewbook/admin/ThemeEditor.tsx`, `ContentTab.tsx`, `DataSourceTab.tsx`, `MilestonesEditor.tsx`, `ViewbookEditor.tsx` (SettingsTab). If an island's dirty detection is genuinely ambiguous, err on registering active while ANY of its inputs differ from their initial props.
- [ ] **Step 6: Green** — full viewbook scope: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook components/viewbook app/api/viewbook app/api/viewbooks middleware.test.ts` + `npx tsc --noEmit`.
- [ ] **Step 7: Commit** — `feat(viewbook): live sync hook, editor registry, single refresher`

---

### Task 7: Gates, cross-review, merge

- [ ] **Step 1:** Full gates in the worktree: `npx tsc --noEmit` && `npm run lint` && `DATABASE_URL="file:./local-dev.db" npm test` && `npm run build`.
- [ ] **Step 2:** Final whole-branch review (most capable model) + `/codex-review --base main`; fix Critical/Important + valid findings, re-gate.
- [ ] **Step 3:** PR `Viewbook v2 PR2 — live sync`, merge on green, tick Wave-2/PR2 in the program doc, tracker status line. PR4 (Codex lane) rebases onto the merge and adopts the factories before its own merge.
