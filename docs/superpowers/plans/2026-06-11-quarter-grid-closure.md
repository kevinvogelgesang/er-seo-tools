# B5 Quarter Grid Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the quarter grid to the tools (derived activity), to Teamwork (qct_ handoff push), protect clients from destructive deletes (soft-archive), and surface quarter context on the client dashboard.

**Architecture:** Four strands per the Codex-reviewed spec (`docs/superpowers/specs/2026-06-11-quarter-grid-closure-design.md`): (1) read-time activity derivation — zero writes to QuarterAssignment; (2) qct_ token + export/receipt routes + er-handoff-memo skill extension, mirroring the srt_ 3-file pattern; (3) `Client.archivedAt` with server-side enforcement in `persistPlan` and a sweep of active-client surfaces; (4) `QuarterContextCard` on `/clients/[id]`.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, jose (JWT), Vitest.

**Local-dev invariants (every task):** prefix prisma CLI and vitest with `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is interactive-only — write migration SQL by hand, apply with `prisma migrate deploy`. Array-form `$transaction` only. DB-backed test files use their own unique name/domain prefix. Quarter-plan-touching API tests stay in `app/api/quarter-plan/route.test.ts`. Component tests: `afterEach(cleanup)`; stub localStorage in-memory; advance-until-condition loops, never `waitFor` with fake timers.

**Branch:** `feat/quarter-grid-closure` off main.

---

### Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma` (Client + QuarterPlan models)
- Create: `prisma/migrations/20260611220000_b5_archive_push/migration.sql`

- [ ] **Step 1: Edit schema.** Add to `model Client` (after `teamworkTasklistId`): `archivedAt DateTime?`. Add to `model QuarterPlan` (after `layouts`):
```prisma
  teamworkPushedAt    DateTime? // set by the push-receipt route only — never by grid PUT
  teamworkPushSummary String?   // JSON {created, skippedExisting, skippedNoTasklist, skippedCompleted}
```
- [ ] **Step 2: Hand-write the migration** (folder name `20260611220000_b5_archive_push`):
```sql
ALTER TABLE "Client" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "QuarterPlan" ADD COLUMN "teamworkPushedAt" DATETIME;
ALTER TABLE "QuarterPlan" ADD COLUMN "teamworkPushSummary" TEXT;
```
- [ ] **Step 3: Apply + regenerate:** `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`. Expected: migration applied, client generated.
- [ ] **Step 4: Verify drift-free:** `DATABASE_URL="file:./local-dev.db" npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma` → "No difference detected".
- [ ] **Step 5: Commit** `feat(b5): schema — Client.archivedAt + QuarterPlan push metadata`.

### Task 2: `getWeekDates` ISO helper

**Files:**
- Modify: `lib/quarter-grid/grid-ops.ts` (beside `getWeekRange`, line ~166)
- Test: `lib/quarter-grid/grid-ops.test.ts`

- [ ] **Step 1: Failing tests** — `getWeekDates('2026-06-15', 1)` → `{ weekStart: '2026-06-15', weekEnd: '2026-06-19' }`; week 3 → `'2026-06-29'`/`'2026-07-03'`; `('', 1)` → null; `('garbage', 1)` → null; month/year rollover (`('2026-12-28', 2)` → `'2027-01-04'`/`'2027-01-08'`).
- [ ] **Step 2: Run** `DATABASE_URL="file:./local-dev.db" npx vitest run lib/quarter-grid/grid-ops.test.ts` → new tests FAIL (function not exported).
- [ ] **Step 3: Implement** (same date math as `getWeekRange` — Monday + 4 days):
```ts
/** ISO yyyy-mm-dd Monday/Friday bounds for a plan week; null when startDate is unset/invalid. */
export function getWeekDates(startDate: string, weekNum: number): { weekStart: string; weekEnd: string } | null {
  if (!startDate) return null
  const base = new Date(startDate + 'T00:00:00')
  if (isNaN(base.getTime())) return null
  const mon = new Date(base)
  mon.setDate(base.getDate() + (weekNum - 1) * 7)
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { weekStart: iso(mon), weekEnd: iso(fri) }
}
```
- [ ] **Step 4: Tests pass.** **Step 5: Commit** `feat(b5): getWeekDates ISO week bounds`.

### Task 3: Soft-archive — data layer + API

**Files:**
- Modify: `lib/quarter-grid/persist.ts:71` (validIds pre-read), `app/api/clients/route.ts` (GET), `app/api/clients/[id]/route.ts` (PATCH + DELETE), `lib/services/client-fleet.ts:42` (client query), `app/api/parse/[sessionId]/route.ts:209` (match scan), `app/api/ada-audit/route.ts:139` (match scan), site-audit match path (grep `client.findMany` in `app/api/site-audit/` + `lib/ada-audit/queue-manager.ts`), plus every other active-client surface found by `grep -rn "client\.findMany\|client\.findUnique" app lib --include="*.ts" --include="*.tsx" | grep -v test` — for each hit decide: matching/list surface → add `archivedAt: null`; dashboard/detail read → leave (archived stays readable).
- Test: `app/api/quarter-plan/route.test.ts` (persistPlan regression), `lib/services/client-fleet.test.ts` (filter), clients route test file (archive semantics).

- [ ] **Step 1: Failing test — archived client dropped by persistPlan** (in `app/api/quarter-plan/route.test.ts`, using that file's existing helpers/prefix):
```ts
it('drops assignments for archived clients on PUT (server-side enforcement)', async () => {
  const active = await prisma.client.create({ data: { name: 'qp-b5-active' } })
  const archived = await prisma.client.create({ data: { name: 'qp-b5-archived', archivedAt: new Date() } })
  await persistPlan(payloadWith([{ clientId: active.id, week: 1, position: 0 }, { clientId: archived.id, week: 1, position: 1 }]))
  const rows = await prisma.quarterAssignment.findMany({})
  expect(rows.map(r => r.clientId)).toContain(active.id)
  expect(rows.map(r => r.clientId)).not.toContain(archived.id)
})
```
(`payloadWith` = build a full `QuarterPlanPayload` with defaults; follow the file's existing payload builder.)
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** — in `persistPlan` change the clients pre-read to `prisma.client.findMany({ where: { archivedAt: null }, select: { id: true } })`. Update the comment above the filter: rows whose client no longer exists **or is archived** are dropped silently.
- [ ] **Step 4: GET /api/clients** — default `where: { archivedAt: null }`; `request.nextUrl.searchParams.get('includeArchived') === '1'` removes the filter and the response rows include `archivedAt` (ISO string or null) either way.
- [ ] **Step 5: PATCH archive/restore** — in `app/api/clients/[id]/route.ts`, handle `'archived' in body` (boolean). Archiving runs ONE array-form transaction:
```ts
if ('archived' in body) {
  if (typeof body.archived !== 'boolean') return NextResponse.json({ error: 'archived must be boolean' }, { status: 400 });
  if (body.archived) {
    await prisma.$transaction([
      prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } }),
      prisma.schedule.updateMany({ where: { clientId, enabled: true }, data: { enabled: false } }),
    ]);
  } else {
    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: null } }); // schedules stay disabled — manual re-enable
  }
  const fresh = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, domains: true, seedUrls: true, seedUrlsUpdatedAt: true, teamworkTasklistId: true, archivedAt: true, createdAt: true } });
  if (!fresh) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  return NextResponse.json({ ...fresh, domains: safeParse(fresh.domains, []), seedUrls: fresh.seedUrls ? safeParse(fresh.seedUrls, null) : null });
}
```
(P2025 from the update → 404, matching the existing handler. `archived` is exclusive of other fields in one request — return 400 `archived cannot be combined with other updates` if `Object.keys(body).length > 1`.)
- [ ] **Step 6: DELETE gate** — before `prisma.client.delete`, load `archivedAt`; if null → `409 { error: 'archive_first' }`.
- [ ] **Step 7: Sweep** — run the grep from Files above; add `archivedAt: null` to: client-fleet client query, parse-route match scan, ada-route match scan, site-audit match path, BulkQueueModal's client source (it consumes `/api/clients` GET — verify it gets the default filter for free), any client-selector fetches. `getClientDashboard`/`getClientQuarterContext` keep loading archived clients. List each touched site in the commit body.
- [ ] **Step 8: Tests** — clients-route test file: archive PATCH disables enabled schedules + sets archivedAt; restore nulls archivedAt and leaves schedules disabled; DELETE active → 409; DELETE archived → cascades as before; GET excludes archived by default, includes with `?includeArchived=1`. Fleet test: archived client absent. Run targeted files → PASS.
- [ ] **Step 9: Commit** `feat(b5): client soft-archive — archivedAt, schedule disable, DELETE gate, active-surface sweep`.

### Task 4: Manage-page UI for archive/restore

**Files:**
- Modify: `app/clients/manage/page.tsx` (fetch with `?includeArchived=1`, "Show archived" toggle state, per-row actions)
- Test: existing manage-page component test file (or create `app/clients/manage/page.test.tsx` following B-series component-test patterns)

- [ ] **Step 1:** Read the page; it currently confirm-deletes via `DELETE /api/clients/{id}` (lines ~245–253, 525–553). Change: fetch list with `includeArchived=1`; add `showArchived` boolean state (default false) filtering rendered rows by `archivedAt`; active rows replace the Delete/trash action with **Archive** (same confirm pattern, calls `PATCH { archived: true }`, on success update the row's `archivedAt` in local state); archived rows (visible when toggled) render an "Archived {date}" badge + **Restore** (`PATCH { archived: false }`) + **Delete** (existing confirm → DELETE, now allowed).
- [ ] **Step 2: Component tests** — archive button issues PATCH and row moves out of the active list; show-archived reveals it with Restore/Delete; restore PATCHes false. (jsdom fetch mocked; `afterEach(cleanup)`.) Run → PASS.
- [ ] **Step 3:** `npx tsc --noEmit` clean. **Step 4: Commit** `feat(b5): manage page archive/restore UI`.

### Task 5: Quarter-activity read service + API route

**Files:**
- Create: `lib/services/quarter-activity.ts`
- Create: `app/api/quarter-plan/activity/route.ts`
- Test: `lib/services/quarter-activity.test.ts` (DB-backed, prefix `qact-b5-`), route tests in `app/api/quarter-plan/route.test.ts`

- [ ] **Step 1: Failing service tests** — seed one client + rows: a `CrawlRun` (tool `seo-parser`, status `complete`, completedAt in-window, session with workflow `technical`) → `seo-parse` kind; a keyword-workflow CrawlRun (session.workflow `keyword-research`) → EXCLUDED; an `ada-audit` CrawlRun → `ada-audit`; `SeoRoadmap` complete via session → `seo-roadmap`; `KeywordResearchSession` complete (direct clientId) → `keyword-memo`; `PillarAnalysis` complete with `narrativeUpdatedAt` → `pillar-analysis`; out-of-window rows excluded; `latest` is the max across kinds; clients with nothing absent from the map.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement:**
```ts
// lib/services/quarter-activity.ts — derived read-time activity for the quarter grid.
// NO writes anywhere: grid persistence is full-state delete-and-recreate, so any
// server-written assignment column would be clobbered by the next browser PUT.
import { prisma } from '@/lib/db'

export type ActivityKind = 'seo-parse' | 'ada-audit' | 'seo-roadmap' | 'keyword-memo' | 'pillar-analysis'
export type ClientActivity = { latest: { kind: ActivityKind; at: Date }; kinds: Partial<Record<ActivityKind, Date>> }

export async function getQuarterActivity(clientIds: number[], since: Date): Promise<Map<number, ClientActivity>> {
  const kindsByClient = new Map<number, Partial<Record<ActivityKind, Date>>>()
  if (clientIds.length === 0) return new Map()
  const record = (clientId: number | null, kind: ActivityKind, at: Date | null) => {
    if (clientId == null || !at || at < since) return
    const kinds = kindsByClient.get(clientId) ?? {}
    const prev = kinds[kind]
    if (!prev || at > prev) kinds[kind] = at
    kindsByClient.set(clientId, kinds)
  }
  const [runs, roadmaps, memos, pillars] = await Promise.all([
    prisma.crawlRun.findMany({
      where: { clientId: { in: clientIds }, completedAt: { gte: since }, status: { in: ['complete', 'partial'] } },
      select: { clientId: true, tool: true, completedAt: true, session: { select: { workflow: true } } },
    }),
    prisma.seoRoadmap.findMany({
      where: { status: 'complete', roadmapUpdatedAt: { gte: since }, session: { clientId: { in: clientIds } } },
      select: { roadmapUpdatedAt: true, session: { select: { clientId: true } } },
    }),
    prisma.keywordResearchSession.findMany({
      where: { status: 'complete', memoUpdatedAt: { gte: since }, clientId: { in: clientIds } },
      select: { clientId: true, memoUpdatedAt: true },
    }),
    prisma.pillarAnalysis.findMany({
      where: { status: 'complete', session: { clientId: { in: clientIds } } },
      select: { createdAt: true, narrativeUpdatedAt: true, session: { select: { clientId: true } } },
    }),
  ])
  for (const r of runs) {
    if (r.tool === 'seo-parser' && r.session?.workflow === 'keyword-research') continue // Codex fix #6: a SEMrush upload is not a technical parse
    record(r.clientId, r.tool === 'ada-audit' ? 'ada-audit' : 'seo-parse', r.completedAt)
  }
  for (const r of roadmaps) record(r.session.clientId, 'seo-roadmap', r.roadmapUpdatedAt)
  for (const m of memos) record(m.clientId, 'keyword-memo', m.memoUpdatedAt)
  for (const p of pillars) record(p.session.clientId, 'pillar-analysis', p.narrativeUpdatedAt ?? p.createdAt)
  // Derive latest from kinds at the end — single source of truth, no incremental-compare bugs.
  const map = new Map<number, ClientActivity>()
  for (const [clientId, kinds] of kindsByClient) {
    let latest: { kind: ActivityKind; at: Date } | null = null
    for (const [kind, at] of Object.entries(kinds) as [ActivityKind, Date][]) {
      if (!latest || at > latest.at) latest = { kind, at }
    }
    if (latest) map.set(clientId, { latest, kinds })
  }
  return map
}

/** Cycle window start for a plan: parsed startDate (local midnight) else createdAt. */
export function activityWindowStart(plan: { startDate: string | null; createdAt: Date }): Date {
  if (plan.startDate) {
    const d = new Date(plan.startDate + 'T00:00:00')
    if (!isNaN(d.getTime())) return d
  }
  return plan.createdAt
}
```
(Test the latest-derivation with two kinds in both insertion orders.)
- [ ] **Step 4: Route** `app/api/quarter-plan/activity/route.ts` (`force-dynamic`): latest plan via `prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' } })`; no plan → `{ activity: {} }`; else assignments' clientIds → `getQuarterActivity(ids, activityWindowStart(plan))` → `{ activity: { [clientId]: { latest: { kind, at: iso }, kinds: { [kind]: iso } } } }`. Try/catch → 500 (pattern of `app/api/quarter-plan/route.ts`).
- [ ] **Step 5: Route tests** in `app/api/quarter-plan/route.test.ts`: no plan → `{}`; plan + seeded run → keyed entry. Run → PASS. **Step 6: Commit** `feat(b5): derived quarter activity service + route`.

### Task 6: Grid surfaces activity (+ push metadata exposure)

**Files:**
- Modify: `lib/quarter-grid/state.ts` (GET-response plan type), `lib/quarter-grid/persist.ts` (loadPlanResponse), `components/quarter-grid/useQuarterPlan.ts`, `components/quarter-grid/Chip.tsx`, the chip-props plumbing (`app/quarter-grid/page.tsx` chipHandlers consumers: `WeekGrid.tsx`, `PoolSection.tsx`, `AssignedSection.tsx`)
- Test: `components/quarter-grid/useQuarterPlan.test.tsx`, `components/quarter-grid/Chip.test.tsx`, `app/api/quarter-plan/route.test.ts` (push-metadata preservation)

- [ ] **Step 1: GET shape.** In `state.ts` extend ONLY the response plan object (NOT `QuarterPlanScalars`/`QuarterPlanPayload` — Codex fix #8):
```ts
export type PushSummary = { created: number; skippedExisting: number; skippedNoTasklist: number; skippedCompleted: number }
export type QuarterPlanGetResponse =
  | { plan: null }
  | { plan: QuarterPlanScalars & { updatedAt: string; teamworkPushedAt: string | null; teamworkPushSummary: PushSummary | null }; assignments: AssignmentPayload[] }
```
`loadPlanResponse` maps the two columns (`teamworkPushSummary` JSON.parse in try-catch → null). `sanitizePlanPayload` and `persistPlan` remain untouched by these fields.
- [ ] **Step 2: Failing regression test** (route.test.ts): set `teamworkPushedAt`/`teamworkPushSummary` directly via prisma on the plan; issue a normal PUT; reload → fields unchanged. Run (fails until Step 1's loadPlanResponse change lands; then passes — this test pins the invariant).
- [ ] **Step 3: Hook.** Add state `const [activity, setActivity] = useState<Record<number, string>>({})` and `const [pushMeta, setPushMeta] = useState<{ pushedAt: string; summary: PushSummary | null } | null>(null)`. In `hydrate()` capture pushMeta from `resp.plan` (`teamworkPushedAt` non-null → set). New init-decoupled effect (does NOT touch canPersist/saveState/persist deps):
```ts
useEffect(() => {
  if (!loaded) return
  fetch('/api/quarter-plan/activity')
    .then(r => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || !data.activity) return
      const fmt: Record<number, string> = {}
      for (const [id, a] of Object.entries(data.activity as Record<string, { latest: { kind: string; at: string } }>)) {
        const d = new Date(a.latest.at)
        fmt[Number(id)] = `${ACTIVITY_LABELS[a.latest.kind] ?? a.latest.kind} · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      }
      setActivity(fmt)
    })
    .catch(() => { /* best-effort — activity is decorative */ })
}, [loaded])
```
with `ACTIVITY_LABELS` defined and exported from `lib/quarter-grid/state.ts` (client-safe, no server imports — the server-rendered QuarterContextCard also imports it; it must NOT live in the `'use client'` hook or the prisma-importing service): `export const ACTIVITY_LABELS: Record<string, string> = { 'seo-parse': 'SEO parse', 'ada-audit': 'ADA audit', 'seo-roadmap': 'Roadmap', 'keyword-memo': 'Keyword memo', 'pillar-analysis': 'Pillar analysis' }`. Return `activity` and `pushMeta` from the hook. **Persist-effect dep list stays byte-identical.**
- [ ] **Step 4: Chip.** Optional prop `activity?: string`; when set, render after the name span:
```tsx
{activity && (
  <span title={`This cycle: ${activity}`} style={{ flexShrink: 0, fontSize: 9, lineHeight: 1, opacity: 0.8 }}>⚡</span>
)}
```
Thread `activity={activity[id]}` through WeekGrid/PoolSection/AssignedSection (each already receives chip props from page.tsx — pass the `activity` record down and index per chip; keep `memo(Chip)` happy: the prop is a primitive string/undefined).
- [ ] **Step 5: Tests.** Hook test: activity endpoint mocked OK → `activity` populated, and a mocked failure leaves `{}` with `canPersist`/`saveState` unaffected and NO PUT issued (use the file's existing fetch-mock + advance-loop patterns). Chip test: glyph renders with prop, absent without. Run targeted → PASS.
- [ ] **Step 6:** `npx tsc --noEmit` clean. **Step 7: Commit** `feat(b5): activity in grid UI + read-only push metadata exposure`.

### Task 7: qct_ token lib

**Files:**
- Create: `lib/quarter-push-token.ts`
- Test: `lib/quarter-push-token.test.ts`

- [ ] **Step 1: Failing tests** — mint returns `qct_`-prefixed token + ISO expiresAt; verify round-trips and returns payload with scopes `['read','receipt-write']`; wrong planId → throws `QuarterPushTokenError` (message contains "does not match"); missing prefix → throws; tampered token → throws.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** — copy `lib/seo-roadmap-token.ts` verbatim, renaming: `ISSUER 'er-seo-tools'` (same), `AUDIENCE 'quarter-cycle-push'`, `TOKEN_PREFIX 'qct_'`, env `QUARTER_PUSH_TOKEN_SECRET`, dev fallback `'dev-quarter-push-secret-do-not-use-in-prod'`, class `QuarterPushTokenError`, functions `mintQuarterPushToken(planId: string)` / `verifyQuarterPushToken(token, expectedPlanId: string)`, scope claim `['read', 'receipt-write']`. (Callers pass `String(plan.id)`.) Same production-throw-on-missing-secret behavior.
- [ ] **Step 4: Tests pass.** **Step 5: Commit** `feat(b5): qct_ quarter-push token lib`.

### Task 8: Push routes (mint / export / receipt)

**Files:**
- Create: `app/api/quarter-plan/push/mint-token/route.ts`, `app/api/quarter-plan/push/[planId]/route.ts`, `app/api/quarter-plan/push/[planId]/receipt/route.ts`
- Test: `app/api/quarter-plan/route.test.ts`

All three `force-dynamic`. "Pushable" assignment = `week != null` AND `completedAt == null` AND client `archivedAt: null` AND client `teamworkTasklistId != null`.

- [ ] **Step 1: Failing tests** (quarter-plan test file, its prefix/helpers):
  - mint: no plan → 409 `no_plan`; plan whose only planned row is completed / archived-client / null-tasklist → 409 `nothing_planned`; one pushable row → 200 `{ token: /^qct_/, planId }`.
  - export: no/garbage Bearer → 401; token for plan A on plan B's id → 401; valid → 200 with ONLY week!=null + active-client rows (archived excluded — Codex fix #2), completed rows present with `completed: true` (fix #3), `weekStart/weekEnd` ISO when startDate set / null when not, `teamwork.markerFormat === 'quarter-cycle:{planId}:{clientId}:{week}'`; plan deleted after mint → 404.
  - receipt: scope enforced (mint a read-only token by hand via jose in-test if cheap, else skip), valid → 200 and plan row has `teamworkPushedAt` set + parsed summary matching the clamped body; negative/garbage counts → clamped to 0; malformed JSON → 400.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement mint** (auth: same cookie-check helper the seo-roadmap mint route uses — read `app/api/seo-roadmap/by-session/[sessionId]/mint-token/route.ts` and mirror):
```ts
const plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' } })
if (!plan) return NextResponse.json({ error: 'no_plan' }, { status: 409 })
const pushable = await prisma.quarterAssignment.findFirst({
  where: { planId: plan.id, week: { not: null }, completedAt: null,
    client: { archivedAt: null, teamworkTasklistId: { not: null } } },
  select: { id: true },
})
if (!pushable) return NextResponse.json({ error: 'nothing_planned' }, { status: 409 })
const { token, expiresAt } = await mintQuarterPushToken(String(plan.id))
return NextResponse.json({ token, expiresAt, planId: plan.id })
```
- [ ] **Step 4: Implement export** — Bearer regex `/^Bearer\s+(qct_\S+)$/`, `verifyQuarterPushToken(match[1], planIdParam)`, token-error mapping copied from `app/api/seo-roadmap/[id]/route.ts:7-13` (qct variants), require `read` scope. Load latest plan; 404 unless `String(plan.id) === planIdParam`. Load assignments `where: { planId: plan.id, week: { not: null }, client: { archivedAt: null } }, include: { client: { select: { name: true, teamworkTasklistId: true } } }`, sort with `sortAssignments`, map:
```ts
const dates = plan.startDate ? getWeekDates(plan.startDate, a.week!) : null
return { clientId: a.clientId, clientName: a.client.name, week: a.week, weekStart: dates?.weekStart ?? null, weekEnd: dates?.weekEnd ?? null, priority: a.priority, status: a.status, note: a.note, completed: a.completedAt != null, tasklistId: a.client.teamworkTasklistId }
```
plus envelope `{ planId: plan.id, planName: plan.name, startDate: plan.startDate, generatedAt: new Date().toISOString(), assignments, teamwork: { taskType: 'task', rules: { addTimeEstimates: false, usePriorityFlags: false }, titleFormat: plan.startDate ? '[SEO] Quarter Cycle — Week {week} ({range})' : '[SEO] Quarter Cycle — Week {week}', markerFormat: 'quarter-cycle:{planId}:{clientId}:{week}' } }`.
- [ ] **Step 5: Implement receipt** — same Bearer/verify with `receipt-write` scope; body JSON try-catch → 400; `const clamp = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0`; update ONLY the two metadata columns; 404 on P2025/stale plan. Return `{ ok: true }`.
- [ ] **Step 6: Tests pass.** **Step 7: Commit** `feat(b5): qct_ push mint/export/receipt routes`.

### Task 9: Push button + GridHeader wiring

**Files:**
- Create: `lib/quarter-push-prompt.ts`, `components/quarter-grid/PushToTeamworkButton.tsx`
- Modify: `components/quarter-grid/GridHeader.tsx` (props + controls row), `app/quarter-grid/page.tsx` (pass `pushMeta` through)
- Test: `components/quarter-grid/PushToTeamworkButton.test.tsx`

- [ ] **Step 1: Prompt composer** (mirror `lib/seo-roadmap-prompt.ts`):
```ts
export function composeQuarterPushPayload({ webappUrl, planId, token }: { webappUrl: string; planId: number; token: string }): string {
  return [
    'Push the current quarter cycle to Teamwork.', '',
    `Webapp: ${webappUrl}`, `Plan ID: ${planId}`, `Access token: ${token}`, '(Expires in 1h)', '',
    "Fetch the cycle export, create the planned-week tasks in each client's Teamwork tasklist, and post the push receipt back to the dashboard.",
  ].join('\n')
}
```
- [ ] **Step 2: Button** — copy `GenerateRoadmapButton.tsx` structurally: states `idle|minting|copied|mint-failed|nothing-planned|service-error`; POST `/api/quarter-plan/push/mint-token`; 409 → `nothing-planned` ("Nothing to push", 3 s reset); 500 → `service-error`; success → compose + clipboard with `window.prompt` fallback (no MemoPollerTrigger — there is no poller for this flow). Styling: match GridHeader's inline-style buttons (e.g. the Import CSV outline-button look, color `#38bdf8`), label `⇪ Push to Teamwork`.
- [ ] **Step 3: GridHeader** — new props `pushMeta: { pushedAt: string; summary: PushSummary | null } | null`; render the button in the controls row after Import CSV, and when `pushMeta` is set a 10px muted line under the legend: `Last pushed {new Date(pushedAt).toLocaleDateString()}{summary ? \` · ${summary.created} tasks\` : ''}`. Page passes `pushMeta={plan.pushMeta}`.
- [ ] **Step 4: Component tests** — mint OK → clipboard called with payload containing `Access token: qct_`; 409 → "Nothing to push"; failure → retry label. Run → PASS.
- [ ] **Step 5:** tsc clean; **Commit** `feat(b5): Push-to-Teamwork button + last-pushed indicator`.

### Task 10: Quarter-context card on /clients/[id]

**Files:**
- Create: `lib/services/client-quarter.ts`, `components/clients/QuarterContextCard.tsx`
- Modify: `app/clients/[id]/page.tsx` (scorecards region), `components/clients/ClientHeader.tsx` (archived badge — pass `archivedAt`)
- Test: `lib/services/client-quarter.test.ts` (DB-backed, prefix `cq-b5-`), `components/clients/QuarterContextCard.test.tsx`

- [ ] **Step 1: Failing service tests** — no plan → null; plan without this client's row → null; pool row (week null) → context with `week: null`; scheduled row → full context incl. `weekRange` from `getWeekRange` and latestActivity from a seeded CrawlRun.
- [ ] **Step 2: Implement:**
```ts
// lib/services/client-quarter.ts
import { prisma } from '@/lib/db'
import { getWeekRange } from '@/lib/quarter-grid/grid-ops'
import { getQuarterActivity, activityWindowStart, type ActivityKind } from './quarter-activity'
import type { ClientStatus } from '@/lib/quarter-grid/state'

export type QuarterContext = {
  planName: string; startDate: string | null
  week: number | null; weekRange: string | null
  priority: number; status: ClientStatus; note: string
  completed: boolean; completedAt: string | null
  latestActivity: { kind: ActivityKind; at: string } | null
}

export async function getClientQuarterContext(clientId: number): Promise<QuarterContext | null> {
  const plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' } })
  if (!plan) return null
  const a = await prisma.quarterAssignment.findUnique({ where: { planId_clientId: { planId: plan.id, clientId } } })
  if (!a) return null
  const activity = await getQuarterActivity([clientId], activityWindowStart(plan))
  const latest = activity.get(clientId)?.latest ?? null
  return {
    planName: plan.name, startDate: plan.startDate,
    week: a.week, weekRange: a.week != null && plan.startDate ? getWeekRange(plan.startDate, a.week) : null,
    priority: a.priority, status: a.status as ClientStatus, note: a.note,
    completed: a.completedAt != null, completedAt: a.completedAt?.toISOString() ?? null,
    latestActivity: latest ? { kind: latest.kind, at: latest.at.toISOString() } : null,
  }
}
```
- [ ] **Step 3: Card component** — server-component-friendly presentational card (props = `QuarterContext | null`), styled like the existing Scorecard cards (read `components/clients/Scorecard.tsx` for the container classes incl. `dark:` variants). Content: title "Quarter plan"; if null → "Not in the current quarter plan"; week null → "In pool — not scheduled"; else `Week {n}{weekRange ? \` (${weekRange})\` : ''}` + P-badge (PCOLORS from `components/quarter-grid/theme.ts`), status dot+label (STATUS_COLORS/STATUS_LABELS), note when non-empty, "✓ Done {date}" when completed, latest-activity line via `ACTIVITY_LABELS`, footer link `View grid →` to `/quarter-grid`.
- [ ] **Step 4: Page wiring** — `/clients/[id]/page.tsx`: call `getClientQuarterContext(clientId)` alongside the dashboard load (Promise.all), render the card as the 4th item in the scorecards grid (read the page first; adjust the grid cols class, e.g. `lg:grid-cols-3` → `lg:grid-cols-4`, or place in an adjacent row if the layout fights). ClientHeader: accept `archivedAt` and render an "Archived" pill when set (the dashboard service must select archivedAt — extend its client select).
- [ ] **Step 5: Component tests** — null/pool/scheduled/completed variants render the right strings. Run → PASS.
- [ ] **Step 6:** tsc clean; **Commit** `feat(b5): quarter-context card on client dashboard + archived badge`.

### Task 11: er-handoff-memo skill — qct_ flow (outside repo)

**Files:**
- Modify: `~/.claude/skills/er-handoff-memo/SKILL.md` (description + new §: quarter push flow)
- Create: `~/.claude/skills/er-handoff-memo/references/quarter-push.md`

- [ ] **Step 1: references/quarter-push.md** — contract doc mirroring `references/teamwork-push.md`: trigger (payload `Access token: qct_...` + "Plan ID:" line — push is the *purpose*, not opt-in like srt_'s offer); fetch `GET {webapp}/api/quarter-plan/push/{planId}` with Bearer; task shape (top-level task in `tasklistId`, title from `teamwork.titleFormat` with `{week}`/`{range}` substituted — range rendered `M/D–M/D` from weekStart/weekEnd; description = `**Priority:** P{n}`, `**Status:** {label}`, note paragraph when non-empty, last line the marker `quarter-cycle:{planId}:{clientId}:{week}`; startDate/dueDate from weekStart/weekEnd when non-null; never estimates/priority flags); skip rules (`completed: true` → skippedCompleted; `tasklistId: null` → skippedNoTasklist; marker found in existing tasklist tasks (paginate fully) → skippedExisting); after pushing POST `{webapp}/api/quarter-plan/push/{planId}/receipt` with the four counts; report a summary table. Known limitations: moved week → new task, old not closed; deleted tasks recreated.
- [ ] **Step 2: SKILL.md** — add `qct_` to the prefix table/description ("qct_ (quarter cycle Teamwork push)") and a section pointing at the reference doc.
- [ ] **Step 3:** No repo commit (skill lives outside). Note the edit in the tracker status line at close-out.

### Task 12: Full verification

- [ ] **Step 1:** `DATABASE_URL="file:./local-dev.db" npx vitest run` → full suite green (expect ≈2,020+ tests).
- [ ] **Step 2:** `npx tsc --noEmit` → clean. **Step 3:** `npm run build` → clean.
- [ ] **Step 4:** Local Playwright smoke (dev server, auth-free local): grid loads; ⚡ glyph appears for a client with seeded activity; Push button mints + copies (or 409s "Nothing to push" on an empty plan); manage page archive → client leaves fleet + grid pool after reload; restore brings it back; `/clients/[id]` shows the quarter card.
- [ ] **Step 5:** Commit any stragglers; open PR `feat(b5): quarter grid closure`; merge after review; deploy `ssh seo@144.126.213.242 "~/deploy.sh"`; production-verify: migration applied, boot clean, `/api/quarter-plan/activity` 200 authed, mint → export round-trip with a real token, archive PATCH on a throwaway test client, dashboard card renders. Then run a REAL qct_ push end-to-end via the updated skill (Teamwork MCP) against a test tasklist if Kevin designates one — otherwise leave as the documented next human step.
