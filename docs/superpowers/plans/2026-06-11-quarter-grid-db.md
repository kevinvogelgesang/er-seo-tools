# Quarter Grid State → DB (B3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Quarter Grid's planning state (assignments, priorities, statuses, notes, completion, layouts, settings) from one browser's localStorage into SQLite, with a guarded one-time importer.

**Architecture:** Two new tables (`QuarterPlan` singleton-in-practice + `QuarterAssignment` one-row-per-client), a pure client-safe state module shared by page and API, a server persist module (conditional raw-SQL plan creation + delete-and-recreate assignments in one array-form transaction), two API routes (GET/PUT singleton facade + guarded POST import), and minimal plumbing edits to the 1,215-LOC grid page (init/persist/applyLayout only — the component split is B4).

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, vitest. No new dependencies.

**Spec:** `../specs/2026-06-11-quarter-grid-db-design.md` (Codex-reviewed ×7 fixes — all reflected below).

**Branch:** `feat/quarter-grid-db` off `main`.

**Local-dev quirk (applies to every prisma/vitest command):** `.env` points at a path that doesn't exist on the Mac. Prefix every `npx prisma` / `npx vitest` command with `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is interactive-only — generate SQL via `prisma migrate diff`, write the migration folder by hand, apply with `prisma migrate deploy`.

---

### Task 1: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (add two models + `Client` back-relation)
- Create: `prisma/migrations/20260611190000_quarter_grid/migration.sql`

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/quarter-grid-db
```

- [ ] **Step 2: Add models to `prisma/schema.prisma`**

Append after the last model in the file:

```prisma
model QuarterPlan {
  id           Int       @id @default(autoincrement())
  name         String    @default("Quarter plan") // freeform label, e.g. "2026-Q3"
  startDate    String?   // "yyyy-mm-dd" date-only text — matches the <input type=date>, no TZ drift
  slotsPerWeek Int       @default(2)              // 2 | 3
  layouts      String    @default("{}")           // opaque JSON Snapshots blob (≤256 KB enforced in API)
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
  position    Int?         // slot index within the week; null when week is null
  priority    Int          @default(3)             // 1–5
  status      String       @default("not_started") // ClientStatus
  note        String       @default("")            // ≤120 chars
  completedAt DateTime?                            // non-null = "done"
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  @@unique([planId, clientId])
  @@index([clientId])
}
```

And inside `model Client`, after `crawlRuns CrawlRun[]`, add:

```prisma
  quarterAssignments    QuarterAssignment[]
```

- [ ] **Step 3: Generate the migration SQL (hand-written folder; migrate dev is interactive-only)**

```bash
mkdir -p prisma/migrations/20260611190000_quarter_grid
DATABASE_URL="file:./local-dev.db" npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "file:./shadow-quarter.db" \
  --script > prisma/migrations/20260611190000_quarter_grid/migration.sql
rm -f shadow-quarter.db
```

Expected: `migration.sql` contains `CREATE TABLE "QuarterPlan"`, `CREATE TABLE "QuarterAssignment"` (with `FOREIGN KEY ... ON DELETE CASCADE` for both FKs), `CREATE UNIQUE INDEX "QuarterAssignment_planId_clientId_key"`, `CREATE INDEX "QuarterAssignment_clientId_idx"`. Read the file to confirm; it must NOT touch any existing table.

- [ ] **Step 4: Apply + regenerate client**

```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy
DATABASE_URL="file:./local-dev.db" npx prisma generate
```

Expected: `1 migration found ... applied`, generate succeeds.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260611190000_quarter_grid
git commit -m "feat(quarter-grid): QuarterPlan + QuarterAssignment schema"
```

---

### Task 2: Pure state module `lib/quarter-grid/state.ts` (TDD)

**Files:**
- Create: `lib/quarter-grid/state.ts`
- Create: `lib/quarter-grid/state.test.ts`

This module is **client-safe** (no Prisma/server imports — same pattern as `lib/findings/normalize-url.ts`). It is the single source of truth for types, clamping, the localStorage parser, payload build/apply, the JS assignment sort (SQLite sorts NULL first, so ordering cannot be done in Prisma `orderBy`), and layout-snapshot sanitization.

- [ ] **Step 1: Write the failing tests**

Create `lib/quarter-grid/state.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  parseStoredQuarterState,
  buildPlanPayload,
  applyPlanResponse,
  sortAssignments,
  sanitizeSnapshotForApply,
  sanitizePlanPayload,
  NUM_WEEKS,
  NOTE_MAX,
  LAYOUTS_MAX_BYTES,
  type AssignmentPayload,
  type QuarterPlanGetResponse,
} from './state'

const currentFormat = JSON.stringify({
  clientState: {
    1: { priority: 1, status: 'in_progress', note: 'hello' },
    2: { priority: 5, status: 'complete', note: '' },
  },
  schedule: { 1: [1], 3: [2] },
  completed: [2],
  slotsPerWeek: 3,
  layouts: { snap: { schedule: { 1: [1] }, completed: [], clients: [{ id: 1, name: 'A', priority: 1, status: 'not_started', note: '' }] } },
  startDate: '2026-07-06',
})

const legacyFormat = JSON.stringify({
  clients: [
    { id: 1, name: 'A', priority: 2, status: 'on_hold', note: 'legacy' },
    { id: 2, name: 'B' }, // missing fields → defaults
  ],
  schedule: { 2: [1] },
  completed: [1],
  snapshots: { old: { schedule: {}, completed: [], clients: [] } },
})

describe('parseStoredQuarterState', () => {
  it('parses the current clientState format', () => {
    const s = parseStoredQuarterState(currentFormat)!
    expect(s.clientState[1]).toEqual({ priority: 1, status: 'in_progress', note: 'hello' })
    expect(s.schedule).toEqual({ 1: [1], 3: [2] })
    expect(s.completed).toEqual([2])
    expect(s.slotsPerWeek).toBe(3)
    expect(Object.keys(s.layouts)).toEqual(['snap'])
    expect(s.startDate).toBe('2026-07-06')
  })

  it('migrates the legacy clients[]/snapshots format', () => {
    const s = parseStoredQuarterState(legacyFormat)!
    expect(s.clientState[1]).toEqual({ priority: 2, status: 'on_hold', note: 'legacy' })
    expect(s.clientState[2]).toEqual({ priority: 3, status: 'not_started', note: '' })
    expect(Object.keys(s.layouts)).toEqual(['old'])
    expect(s.slotsPerWeek).toBe(2)
    expect(s.startDate).toBe('')
  })

  it('returns null for null/corrupt/empty input', () => {
    expect(parseStoredQuarterState(null)).toBeNull()
    expect(parseStoredQuarterState('not json {')).toBeNull()
    expect(parseStoredQuarterState('"a string"')).toBeNull()
    expect(parseStoredQuarterState(JSON.stringify({}))).toBeNull()
    expect(parseStoredQuarterState(JSON.stringify({ clientState: {}, schedule: {}, completed: [] }))).toBeNull()
  })

  it('drops invalid weeks and non-numeric ids', () => {
    const s = parseStoredQuarterState(JSON.stringify({
      clientState: { 1: { priority: 3, status: 'not_started', note: '' } },
      schedule: { 0: [1], 14: [1], 5: [1, 'x', null] },
      completed: [1, 'y'],
    }))!
    expect(s.schedule).toEqual({ 5: [1] })
    expect(s.completed).toEqual([1])
  })
})

describe('buildPlanPayload', () => {
  const input = {
    clientState: {
      1: { priority: 1, status: 'in_progress' as const, note: 'n1' },
      2: { priority: 2, status: 'not_started' as const, note: '' },
      99: { priority: 4, status: 'blocked' as const, note: 'deleted client' },
    },
    schedule: { 2: [2, 99], 1: [1] },
    completed: [2, 99],
    slotsPerWeek: 3,
    layouts: {},
    startDate: '2026-07-06',
  }

  it('flattens schedule into week/position, drops unknown ids, includes pool clients', () => {
    const p = buildPlanPayload(input, [1, 2, 3])
    const byId = new Map(p.assignments.map(a => [a.clientId, a]))
    expect(byId.get(1)).toMatchObject({ week: 1, position: 0, priority: 1, status: 'in_progress', note: 'n1', completed: false })
    expect(byId.get(2)).toMatchObject({ week: 2, position: 0, completed: true }) // 99 dropped → position re-derived from filtered array
    expect(byId.get(3)).toMatchObject({ week: null, position: null, priority: 3, status: 'not_started', note: '', completed: false }) // pool, defaults
    expect(byId.has(99)).toBe(false)
    expect(p.slotsPerWeek).toBe(3)
    expect(p.startDate).toBe('2026-07-06')
  })

  it('keeps first placement when a client appears in two weeks', () => {
    const p = buildPlanPayload({ ...input, schedule: { 1: [1], 2: [1] } }, [1])
    expect(p.assignments.find(a => a.clientId === 1)).toMatchObject({ week: 1, position: 0 })
  })

  it('normalizes bad startDate to null', () => {
    expect(buildPlanPayload({ ...input, startDate: '' }, [1]).startDate).toBeNull()
    expect(buildPlanPayload({ ...input, startDate: 'July 6' }, [1]).startDate).toBeNull()
  })
})

describe('sortAssignments', () => {
  it('orders assigned by week/position, pool last, clientId tie-break', () => {
    const rows = [
      { clientId: 5, week: null, position: null },
      { clientId: 2, week: 1, position: 1 },
      { clientId: 9, week: 1, position: 0 },
      { clientId: 1, week: null, position: null },
      { clientId: 4, week: 2, position: 0 },
    ]
    expect(sortAssignments(rows).map(r => r.clientId)).toEqual([9, 2, 4, 1, 5])
  })
})

describe('applyPlanResponse', () => {
  const resp: QuarterPlanGetResponse = {
    plan: { name: 'P', startDate: '2026-07-06', slotsPerWeek: 2, layouts: {}, updatedAt: '2026-06-11T00:00:00.000Z' },
    assignments: [
      { clientId: 2, week: 1, position: 1, priority: 2, status: 'not_started', note: '', completed: true },
      { clientId: 1, week: 1, position: 0, priority: 1, status: 'in_progress', note: 'n', completed: false },
      { clientId: 3, week: null, position: null, priority: 4, status: 'on_hold', note: '', completed: false },
      { clientId: 99, week: 2, position: 0, priority: 3, status: 'not_started', note: '', completed: true },
    ],
  }

  it('rebuilds schedule in position order, prunes unknown ids', () => {
    const a = applyPlanResponse(resp, [1, 2, 3])!
    expect(a.schedule).toEqual({ 1: [1, 2] })
    expect(a.completed).toEqual([2])
    expect(a.clientState[3]).toEqual({ priority: 4, status: 'on_hold', note: '' })
    expect(a.clientState[99]).toBeUndefined()
    expect(a.startDate).toBe('2026-07-06')
  })

  it('returns null when plan is null', () => {
    expect(applyPlanResponse({ plan: null }, [1])).toBeNull()
  })
})

describe('sanitizeSnapshotForApply', () => {
  it('patches only current clients, never resurrects deleted ones', () => {
    const snap = {
      schedule: { 1: [1, 99] },
      completed: [99, 2],
      clients: [
        { id: 1, name: 'Stale Name', priority: 5, status: 'blocked' as const, note: 'x' },
        { id: 99, name: 'Deleted', priority: 1, status: 'complete' as const, note: '' },
      ],
    }
    const r = sanitizeSnapshotForApply(snap, [1, 2])
    expect(r.clientPatches.get(1)).toEqual({ priority: 5, status: 'blocked', note: 'x' })
    expect(r.clientPatches.has(99)).toBe(false)
    expect(r.schedule).toEqual({ 1: [1] })
    expect(r.completed).toEqual([2])
  })

  it('returns an empty result for malformed snapshots instead of crashing', () => {
    for (const bad of ['garbage', null, 42, [1, 2], { clients: 'nope', schedule: 7, completed: 'x' }]) {
      const r = sanitizeSnapshotForApply(bad, [1])
      expect(r.clientPatches.size).toBe(0)
      expect(r.schedule).toEqual({})
      expect(r.completed).toEqual([])
    }
  })
})

describe('sanitizePlanPayload', () => {
  const valid = {
    name: 'Q3', startDate: '2026-07-06', slotsPerWeek: 2, layouts: {},
    assignments: [{ clientId: 1, week: 1, position: 0, priority: 1, status: 'in_progress', note: 'ok', completed: false }],
  }

  it('accepts a valid payload', () => {
    const r = sanitizePlanPayload(valid)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.assignments).toHaveLength(1)
  })

  it('clamps and coerces row fields', () => {
    const r = sanitizePlanPayload({
      ...valid,
      slotsPerWeek: 7,
      startDate: 'bogus',
      assignments: [
        { clientId: 1, week: 99, position: 2, priority: 9, status: 'nope', note: 'z'.repeat(500), completed: 'yes' },
        { clientId: 1, week: 2, position: 0, priority: 1, status: 'complete', note: '', completed: true }, // dup → keep-first
        { clientId: -4, week: 1, position: 0, priority: 1, status: 'complete', note: '', completed: true }, // bad id → dropped
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.slotsPerWeek).toBe(2)
    expect(r.payload.startDate).toBeNull()
    expect(r.payload.assignments).toHaveLength(1)
    const a = r.payload.assignments[0] as AssignmentPayload
    expect(a).toMatchObject({ clientId: 1, week: null, position: null, priority: 5, status: 'not_started', completed: false })
    expect(a.note).toHaveLength(NOTE_MAX)
  })

  it('rejects non-object bodies and oversized layouts', () => {
    expect(sanitizePlanPayload(null).ok).toBe(false)
    expect(sanitizePlanPayload([1]).ok).toBe(false)
    const big = { ...valid, layouts: { huge: { schedule: {}, completed: [], clients: [], pad: 'x'.repeat(LAYOUTS_MAX_BYTES) } } }
    expect(sanitizePlanPayload(big).ok).toBe(false)
  })

  it('forces position null when week is null', () => {
    const r = sanitizePlanPayload({ ...valid, assignments: [{ clientId: 1, week: null, position: 3, priority: 3, status: 'not_started', note: '', completed: false }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.assignments[0]).toMatchObject({ week: null, position: null })
  })

  it('week bounds are 1..NUM_WEEKS', () => {
    const r = sanitizePlanPayload({ ...valid, assignments: [{ clientId: 1, week: NUM_WEEKS, position: 0, priority: 3, status: 'not_started', note: '', completed: false }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.assignments[0].week).toBe(NUM_WEEKS)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/quarter-grid/state.test.ts
```

Expected: FAIL — `Cannot find module './state'` (or equivalent).

- [ ] **Step 3: Implement `lib/quarter-grid/state.ts`**

```ts
// Client-safe pure helpers for Quarter Grid state (no Prisma/server imports).
// Shared by app/quarter-grid/page.tsx, the /api/quarter-plan routes, and tests.

export type ClientStatus = 'not_started' | 'in_progress' | 'on_hold' | 'blocked' | 'complete'

export const ALL_STATUSES: ClientStatus[] = ['not_started', 'in_progress', 'on_hold', 'blocked', 'complete']
export const NUM_WEEKS = 13
export const NOTE_MAX = 120
export const NAME_MAX = 80
export const LAYOUTS_MAX_BYTES = 256 * 1024 // serialized-JSON length cap (chars ≈ bytes for this payload)

export type ScheduleMap = Record<number, number[]>
export type ClientPlanState = { priority: number; status: ClientStatus; note: string }
export type ClientStateMap = Record<number, ClientPlanState>

export type SnapshotClient = { id: number; name: string; priority: number; status: ClientStatus; note: string }
export type Snapshot = { schedule: ScheduleMap; completed: number[]; clients: SnapshotClient[] }
export type Snapshots = Record<string, Snapshot>

export type StoredQuarterState = {
  clientState: ClientStateMap
  schedule: ScheduleMap
  completed: number[]
  slotsPerWeek: number
  layouts: Snapshots
  startDate: string
}

export type AssignmentPayload = {
  clientId: number
  week: number | null
  position: number | null
  priority: number
  status: ClientStatus
  note: string
  completed: boolean
}

export type QuarterPlanScalars = {
  name: string
  startDate: string | null
  slotsPerWeek: number
  layouts: Snapshots
}

export type QuarterPlanPayload = QuarterPlanScalars & { assignments: AssignmentPayload[] }

export type QuarterPlanGetResponse =
  | { plan: null }
  | { plan: QuarterPlanScalars & { updatedAt: string }; assignments: AssignmentPayload[] }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function clampPriority(v: unknown): number {
  const n = typeof v === 'number' ? Math.round(v) : NaN
  if (!Number.isFinite(n)) return 3
  return Math.min(5, Math.max(1, n))
}

function coerceStatus(v: unknown): ClientStatus {
  return typeof v === 'string' && (ALL_STATUSES as string[]).includes(v) ? (v as ClientStatus) : 'not_started'
}

function coerceNote(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, NOTE_MAX) : ''
}

function isClientId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function parseScheduleMap(v: unknown): ScheduleMap {
  const schedule: ScheduleMap = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return schedule
  for (const [k, ids] of Object.entries(v as Record<string, unknown>)) {
    const wk = parseInt(k, 10)
    if (!Number.isInteger(wk) || wk < 1 || wk > NUM_WEEKS || !Array.isArray(ids)) continue
    const clean = ids.filter(isClientId)
    if (clean.length > 0) schedule[wk] = clean
  }
  return schedule
}

/**
 * Parse a raw `seo-quarter-v3` localStorage string. Handles both the current
 * format (clientState record) and the legacy one (clients[] + snapshots),
 * mirroring the migration the page used to do on read.
 * Returns null for missing, corrupt, or contentless input.
 */
export function parseStoredQuarterState(raw: string | null): StoredQuarterState | null {
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const d = parsed as Record<string, unknown>

  const clientState: ClientStateMap = {}
  if (d.clientState && typeof d.clientState === 'object' && !Array.isArray(d.clientState)) {
    for (const [k, v] of Object.entries(d.clientState as Record<string, unknown>)) {
      const id = parseInt(k, 10)
      if (!Number.isInteger(id) || id <= 0 || !v || typeof v !== 'object') continue
      const s = v as Record<string, unknown>
      clientState[id] = { priority: clampPriority(s.priority), status: coerceStatus(s.status), note: coerceNote(s.note) }
    }
  } else if (Array.isArray(d.clients)) {
    for (const c of d.clients as Array<Record<string, unknown> | null>) {
      if (!c || !isClientId(c.id)) continue
      clientState[c.id] = { priority: clampPriority(c.priority), status: coerceStatus(c.status), note: coerceNote(c.note) }
    }
  }

  const schedule = parseScheduleMap(d.schedule)
  const completed = Array.isArray(d.completed) ? d.completed.filter(isClientId) : []
  const slotsPerWeek = d.slotsPerWeek === 3 ? 3 : 2
  const layoutsRaw = d.layouts ?? d.snapshots
  const layouts: Snapshots =
    layoutsRaw && typeof layoutsRaw === 'object' && !Array.isArray(layoutsRaw) ? (layoutsRaw as Snapshots) : {}
  const startDate = typeof d.startDate === 'string' && DATE_RE.test(d.startDate) ? d.startDate : ''

  const hasContent =
    Object.keys(clientState).length > 0 ||
    Object.keys(schedule).length > 0 ||
    completed.length > 0 ||
    Object.keys(layouts).length > 0 ||
    startDate !== ''
  if (!hasContent) return null

  return { clientState, schedule, completed, slotsPerWeek, layouts, startDate }
}

export type GridStateInput = {
  clientState: ClientStateMap
  schedule: ScheduleMap
  completed: Iterable<number>
  slotsPerWeek: number
  layouts: Snapshots
  startDate: string
  name?: string
}

/**
 * Page/imported state → PUT/import body. Drops ids not in validClientIds
 * (old localStorage can reference deleted clients) and emits one row per
 * valid client (pool rows get week/position null).
 */
export function buildPlanPayload(input: GridStateInput, validClientIds: Iterable<number>): QuarterPlanPayload {
  const valid = new Set(validClientIds)
  const placement = new Map<number, { week: number; position: number }>()
  const weeks = Object.keys(input.schedule).map(Number)
    .filter((w) => Number.isInteger(w) && w >= 1 && w <= NUM_WEEKS)
    .sort((a, b) => a - b)
  for (const wk of weeks) {
    const ids = (input.schedule[wk] || []).filter((id) => valid.has(id))
    ids.forEach((id, i) => { if (!placement.has(id)) placement.set(id, { week: wk, position: i }) })
  }
  const completedSet = new Set([...input.completed].filter((id) => valid.has(id)))

  const assignments: AssignmentPayload[] = [...valid].sort((a, b) => a - b).map((id) => {
    const st = input.clientState[id]
    const place = placement.get(id) ?? null
    return {
      clientId: id,
      week: place ? place.week : null,
      position: place ? place.position : null,
      priority: st ? clampPriority(st.priority) : 3,
      status: st ? coerceStatus(st.status) : 'not_started',
      note: st ? coerceNote(st.note) : '',
      completed: completedSet.has(id),
    }
  })

  return {
    name: input.name?.trim() ? input.name.trim().slice(0, NAME_MAX) : 'Quarter plan',
    startDate: DATE_RE.test(input.startDate) ? input.startDate : null,
    slotsPerWeek: input.slotsPerWeek === 3 ? 3 : 2,
    layouts: input.layouts ?? {},
    assignments,
  }
}

/**
 * Deterministic assignment order: assigned rows by week/position, pool rows
 * last, clientId as the stable tie-break. Done in JS because SQLite sorts
 * NULL first in ascending orderBy — "pool last" is inexpressible in Prisma.
 */
export function sortAssignments<T extends { week: number | null; position: number | null; clientId: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aw = a.week ?? Number.POSITIVE_INFINITY
    const bw = b.week ?? Number.POSITIVE_INFINITY
    if (aw !== bw) return aw - bw
    const ap = a.position ?? Number.POSITIVE_INFINITY
    const bp = b.position ?? Number.POSITIVE_INFINITY
    if (ap !== bp) return ap - bp
    return a.clientId - b.clientId
  })
}

export type AppliedPlanState = {
  clientState: ClientStateMap
  schedule: ScheduleMap
  completed: number[]
  slotsPerWeek: number
  layouts: Snapshots
  startDate: string
}

/** GET/import response → page state pieces; ids not in validClientIds never enter page state. */
export function applyPlanResponse(resp: QuarterPlanGetResponse, validClientIds: Iterable<number>): AppliedPlanState | null {
  if (!resp.plan) return null
  const valid = new Set(validClientIds)
  const clientState: ClientStateMap = {}
  const schedule: ScheduleMap = {}
  const completed: number[] = []
  const rows = resp.assignments.filter((a) => valid.has(a.clientId))
  for (const a of sortAssignments(rows)) {
    clientState[a.clientId] = { priority: clampPriority(a.priority), status: coerceStatus(a.status), note: coerceNote(a.note) }
    if (a.week != null && a.week >= 1 && a.week <= NUM_WEEKS) {
      if (!schedule[a.week]) schedule[a.week] = []
      schedule[a.week].push(a.clientId)
    }
    if (a.completed) completed.push(a.clientId)
  }
  return {
    clientState,
    schedule,
    completed,
    slotsPerWeek: resp.plan.slotsPerWeek === 3 ? 3 : 2,
    layouts: resp.plan.layouts ?? {},
    startDate: resp.plan.startDate ?? '',
  }
}

export type SanitizedSnapshot = {
  clientPatches: Map<number, ClientPlanState>
  schedule: ScheduleMap
  completed: number[]
}

/**
 * Used by applyLayout: a stale snapshot must never resurrect deleted clients
 * or clobber current names. Patches (priority/status/note) apply only onto
 * clients in currentClientIds; schedule/completed are pruned to that set.
 * Accepts unknown — layouts blobs are opaque JSON and a malformed entry must
 * degrade to an empty result, never crash the apply.
 */
export function sanitizeSnapshotForApply(snapshot: unknown, currentClientIds: Iterable<number>): SanitizedSnapshot {
  const empty: SanitizedSnapshot = { clientPatches: new Map(), schedule: {}, completed: [] }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return empty
  const s = snapshot as Record<string, unknown>
  const valid = new Set(currentClientIds)
  const clientPatches = new Map<number, ClientPlanState>()
  const clientsArr = Array.isArray(s.clients) ? (s.clients as Array<Record<string, unknown> | null>) : []
  for (const c of clientsArr) {
    if (!c || typeof c !== 'object' || !isClientId(c.id) || !valid.has(c.id)) continue
    clientPatches.set(c.id, { priority: clampPriority(c.priority), status: coerceStatus(c.status), note: coerceNote(c.note) })
  }
  const schedule: ScheduleMap = {}
  for (const [k, ids] of Object.entries(parseScheduleMap(s.schedule))) {
    const clean = ids.filter((id) => valid.has(id))
    if (clean.length > 0) schedule[Number(k)] = clean
  }
  const completed = (Array.isArray(s.completed) ? s.completed : []).filter((id): id is number => isClientId(id) && valid.has(id))
  return { clientPatches, schedule, completed }
}

export type SanitizeResult = { ok: true; payload: QuarterPlanPayload } | { ok: false; error: string }

/** Server-side body validation/clamping for PUT and import. */
export function sanitizePlanPayload(body: unknown): SanitizeResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid payload' }
  const b = body as Record<string, unknown>

  const layoutsRaw = b.layouts ?? {}
  if (typeof layoutsRaw !== 'object' || Array.isArray(layoutsRaw)) return { ok: false, error: 'layouts must be an object' }
  let layoutsJson: string
  try { layoutsJson = JSON.stringify(layoutsRaw) } catch { return { ok: false, error: 'layouts is not serializable' } }
  if (layoutsJson.length > LAYOUTS_MAX_BYTES) return { ok: false, error: 'layouts too large' }
  const layouts = layoutsRaw as Snapshots

  const seen = new Set<number>()
  const assignments: AssignmentPayload[] = []
  const rows = Array.isArray(b.assignments) ? b.assignments : []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (!isClientId(r.clientId) || seen.has(r.clientId)) continue // bad id dropped; dup keep-first
    seen.add(r.clientId)
    const week = typeof r.week === 'number' && Number.isInteger(r.week) && r.week >= 1 && r.week <= NUM_WEEKS ? r.week : null
    const position = week != null && typeof r.position === 'number' && Number.isInteger(r.position) && r.position >= 0 ? r.position : null
    assignments.push({
      clientId: r.clientId,
      week,
      position,
      priority: clampPriority(r.priority),
      status: coerceStatus(r.status),
      note: coerceNote(r.note),
      completed: r.completed === true,
    })
  }

  return {
    ok: true,
    payload: {
      name: typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, NAME_MAX) : 'Quarter plan',
      startDate: typeof b.startDate === 'string' && DATE_RE.test(b.startDate) ? b.startDate : null,
      slotsPerWeek: b.slotsPerWeek === 3 ? 3 : 2,
      layouts,
      assignments,
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/quarter-grid/state.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/quarter-grid/state.ts lib/quarter-grid/state.test.ts
git commit -m "feat(quarter-grid): pure state module (parse/build/apply/sanitize)"
```

---

### Task 3: Server persist module `lib/quarter-grid/persist.ts`

**Files:**
- Create: `lib/quarter-grid/persist.ts`

Server-only (imports Prisma). Tested through the route tests in Task 4 — no separate test file.

- [ ] **Step 1: Implement `lib/quarter-grid/persist.ts`**

```ts
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import {
  sortAssignments,
  type ClientStatus,
  type QuarterPlanGetResponse,
  type QuarterPlanPayload,
  type Snapshots,
} from './state'

/** GET shape for the latest plan, or { plan: null }. Assignment order: assigned by week/position, pool last (JS sort — SQLite puts NULLs first). */
export async function loadPlanResponse(): Promise<QuarterPlanGetResponse> {
  const plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' } })
  if (!plan) return { plan: null }
  const rows = await prisma.quarterAssignment.findMany({ where: { planId: plan.id } })
  let layouts: Snapshots = {}
  try { layouts = JSON.parse(plan.layouts) } catch { console.error(`[quarter-grid] corrupt layouts JSON on plan ${plan.id}`) }
  return {
    plan: {
      name: plan.name,
      startDate: plan.startDate,
      slotsPerWeek: plan.slotsPerWeek,
      layouts,
      updatedAt: plan.updatedAt.toISOString(),
    },
    assignments: sortAssignments(rows).map((r) => ({
      clientId: r.clientId,
      week: r.week,
      position: r.position,
      priority: r.priority,
      status: r.status as ClientStatus,
      note: r.note,
      completed: r.completedAt != null,
    })),
  }
}

export type PersistResult = { status: 'ok' } | { status: 'conflict' }

/**
 * Last-write-wins full-state persist against the singleton latest plan.
 * - createOnly (import): refuses with 'conflict' if any plan exists.
 * - Plan creation is a conditional raw INSERT ... WHERE NOT EXISTS so two
 *   racing creators can never produce two plans. Raw SQL bypasses
 *   @default/@updatedAt, so createdAt/updatedAt are set to Date.now() ms.
 * - Assignments are delete-and-recreate in ONE array-form transaction
 *   (never the interactive form — CLAUDE.md "Do not").
 */
export async function persistPlan(payload: QuarterPlanPayload, opts: { createOnly?: boolean } = {}): Promise<PersistResult> {
  let plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' }, select: { id: true } })
  if (plan && opts.createOnly) return { status: 'conflict' }

  if (!plan) {
    const now = Date.now()
    const inserted = await prisma.$executeRaw`
      INSERT INTO "QuarterPlan" ("name", "startDate", "slotsPerWeek", "layouts", "createdAt", "updatedAt")
      SELECT ${payload.name}, ${payload.startDate}, ${payload.slotsPerWeek}, ${JSON.stringify(payload.layouts)}, ${now}, ${now}
      WHERE NOT EXISTS (SELECT 1 FROM "QuarterPlan")`
    if (inserted === 0 && opts.createOnly) return { status: 'conflict' } // lost the import race
    plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' }, select: { id: true } })
    if (!plan) throw new Error('QuarterPlan creation failed')
  }
  const planId = plan.id

  // Pre-reads (outside the transaction): completedAt preservation + valid client ids.
  const [existingRows, clientRows] = await Promise.all([
    prisma.quarterAssignment.findMany({ where: { planId }, select: { clientId: true, completedAt: true } }),
    prisma.client.findMany({ select: { id: true } }),
  ])
  const validIds = new Set(clientRows.map((c) => c.id))
  const prevCompleted = new Map(existingRows.map((r) => [r.clientId, r.completedAt]))
  const now = new Date()

  // Rows whose client no longer exists are dropped silently — failing the
  // whole save on an FK violation would lose the analyst's edit.
  const rows = payload.assignments
    .filter((a) => validIds.has(a.clientId))
    .map((a) => ({
      planId,
      clientId: a.clientId,
      week: a.week,
      position: a.position,
      priority: a.priority,
      status: a.status,
      note: a.note,
      completedAt: a.completed ? (prevCompleted.get(a.clientId) ?? now) : null,
    }))

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.quarterPlan.update({
      where: { id: planId },
      data: {
        name: payload.name,
        startDate: payload.startDate,
        slotsPerWeek: payload.slotsPerWeek,
        layouts: JSON.stringify(payload.layouts),
      },
    }),
    prisma.quarterAssignment.deleteMany({ where: { planId } }),
  ]
  if (rows.length > 0) ops.push(prisma.quarterAssignment.createMany({ data: rows }))
  await prisma.$transaction(ops)
  return { status: 'ok' }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean (route tests come next task).

- [ ] **Step 3: Commit**

```bash
git add lib/quarter-grid/persist.ts
git commit -m "feat(quarter-grid): server persist module (singleton plan, array-form txn)"
```

---

### Task 4: API routes + DB-backed tests (TDD)

**Files:**
- Create: `app/api/quarter-plan/route.ts`
- Create: `app/api/quarter-plan/import/route.ts`
- Create: `app/api/quarter-plan/route.test.ts` (single file for ALL quarter-plan API tests — the plan is a global singleton over the shared dev DB, and vitest runs test FILES in parallel; one file keeps them serial)

- [ ] **Step 1: Write the failing tests**

Create `app/api/quarter-plan/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET, PUT } from './route'
import { POST as IMPORT } from './import/route'
import type { AssignmentPayload } from '@/lib/quarter-grid/state'

// NOTE: QuarterPlan is a singleton over the shared dev DB — these tests
// delete ALL plan rows in beforeEach. Keep every quarter-plan API test in
// THIS file so vitest's parallel file execution can't interleave them.

const PREFIX = '__qpt__'

function jsonReq(method: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/quarter-plan', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function makeClient(name: string): Promise<number> {
  const c = await prisma.client.create({ data: { name: `${PREFIX}${name}` } })
  return c.id
}

function payload(assignments: Partial<AssignmentPayload>[], extra: Record<string, unknown> = {}) {
  return {
    name: 'Test plan',
    startDate: '2026-07-06',
    slotsPerWeek: 2,
    layouts: {},
    assignments,
    ...extra,
  }
}

async function cleanup() {
  await prisma.quarterPlan.deleteMany({}) // global singleton — assignments cascade
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

beforeEach(cleanup)
afterAll(cleanup)

describe('GET /api/quarter-plan', () => {
  it('returns { plan: null } when no plan exists', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ plan: null })
  })

  it('orders assignments: assigned by week/position, pool last', async () => {
    const [a, b, c] = await Promise.all([makeClient('a'), makeClient('b'), makeClient('c')])
    await PUT(jsonReq('PUT', payload([
      { clientId: c, week: null, position: null, priority: 3, status: 'not_started', note: '', completed: false },
      { clientId: b, week: 1, position: 1, priority: 3, status: 'not_started', note: '', completed: false },
      { clientId: a, week: 1, position: 0, priority: 3, status: 'not_started', note: '', completed: false },
    ])))
    const json = await (await GET()).json()
    expect(json.assignments.map((r: AssignmentPayload) => r.clientId)).toEqual([a, b, c])
  })
})

describe('PUT /api/quarter-plan', () => {
  it('creates exactly one plan, second PUT updates it', async () => {
    const id = await makeClient('one')
    const res1 = await PUT(jsonReq('PUT', payload([{ clientId: id, week: 2, position: 0, priority: 1, status: 'in_progress', note: 'n', completed: false }])))
    expect(res1.status).toBe(200)
    const res2 = await PUT(jsonReq('PUT', payload([], { name: 'Renamed' })))
    expect(res2.status).toBe(200)
    expect(await prisma.quarterPlan.count()).toBe(1)
    const json = await res2.json()
    expect(json.plan.name).toBe('Renamed')
    expect(json.assignments).toHaveLength(0) // replace-all: empty save wipes rows
  })

  it('preserves completedAt across re-saves, stamps new, nulls uncompleted', async () => {
    const id = await makeClient('done')
    const row = { clientId: id, week: null, position: null, priority: 3, status: 'not_started' as const, note: '', completed: true }
    await PUT(jsonReq('PUT', payload([row])))
    const first = (await prisma.quarterAssignment.findFirst({ where: { clientId: id } }))!.completedAt!
    await new Promise((r) => setTimeout(r, 5))
    await PUT(jsonReq('PUT', payload([row]))) // still completed → timestamp preserved
    const second = (await prisma.quarterAssignment.findFirst({ where: { clientId: id } }))!.completedAt!
    expect(second.getTime()).toBe(first.getTime())
    await PUT(jsonReq('PUT', payload([{ ...row, completed: false }])))
    expect((await prisma.quarterAssignment.findFirst({ where: { clientId: id } }))!.completedAt).toBeNull()
  })

  it('drops rows for nonexistent clients without failing the save', async () => {
    const id = await makeClient('real')
    const res = await PUT(jsonReq('PUT', payload([
      { clientId: id, week: 1, position: 0, priority: 3, status: 'not_started', note: '', completed: false },
      { clientId: 99999999, week: 1, position: 1, priority: 3, status: 'not_started', note: '', completed: false },
    ])))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.assignments).toHaveLength(1)
    expect(json.assignments[0].clientId).toBe(id)
  })

  it('accepts a payload with zero assignments (no empty createMany)', async () => {
    const res = await PUT(jsonReq('PUT', payload([])))
    expect(res.status).toBe(200)
    expect(await prisma.quarterPlan.count()).toBe(1)
    expect(await prisma.quarterAssignment.count()).toBe(0)
  })

  it('clamps row fields server-side', async () => {
    const id = await makeClient('clamp')
    await PUT(jsonReq('PUT', payload([{ clientId: id, week: 99 as number, position: 0, priority: 9, status: 'bogus' as never, note: 'x'.repeat(400), completed: false }])))
    const row = (await prisma.quarterAssignment.findFirst({ where: { clientId: id } }))!
    expect(row.week).toBeNull()
    expect(row.position).toBeNull()
    expect(row.priority).toBe(5)
    expect(row.status).toBe('not_started')
    expect(row.note).toHaveLength(120)
  })

  it('rejects invalid JSON and oversized layouts with 400', async () => {
    const bad = new NextRequest('http://localhost/api/quarter-plan', { method: 'PUT', body: 'nope{' })
    expect((await PUT(bad)).status).toBe(400)
    const big = payload([], { layouts: { l: { schedule: {}, completed: [], clients: [], pad: 'x'.repeat(300 * 1024) } } })
    expect((await PUT(jsonReq('PUT', big))).status).toBe(400)
  })
})

describe('POST /api/quarter-plan/import', () => {
  it('imports onto an empty DB', async () => {
    const id = await makeClient('imp')
    const res = await IMPORT(jsonReq('POST', payload([{ clientId: id, week: 3, position: 0, priority: 2, status: 'on_hold', note: 'memo', completed: true }])))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.plan.startDate).toBe('2026-07-06')
    expect(json.assignments[0]).toMatchObject({ clientId: id, week: 3, priority: 2, status: 'on_hold', note: 'memo', completed: true })
  })

  it('409s when a plan already exists', async () => {
    await PUT(jsonReq('PUT', payload([])))
    const res = await IMPORT(jsonReq('POST', payload([])))
    expect(res.status).toBe(409)
  })
})

describe('cascades', () => {
  it('deleting a client cascades its assignment rows', async () => {
    const id = await makeClient('gone')
    await PUT(jsonReq('PUT', payload([{ clientId: id, week: 1, position: 0, priority: 3, status: 'not_started', note: '', completed: false }])))
    await prisma.client.delete({ where: { id } })
    expect(await prisma.quarterAssignment.count({ where: { clientId: id } })).toBe(0)
    expect(await prisma.quarterPlan.count()).toBe(1) // plan survives
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run app/api/quarter-plan/route.test.ts
```

Expected: FAIL — cannot find `./route` / `./import/route`.

- [ ] **Step 3: Implement `app/api/quarter-plan/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { sanitizePlanPayload } from '@/lib/quarter-grid/state'
import { loadPlanResponse, persistPlan } from '@/lib/quarter-grid/persist'

export const dynamic = 'force-dynamic'

/** GET /api/quarter-plan — the latest plan + assignments, or { plan: null } */
export async function GET() {
  try {
    return NextResponse.json(await loadPlanResponse())
  } catch (error) {
    console.error('GET /api/quarter-plan error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** PUT /api/quarter-plan — full-state save, last-write-wins (creates the singleton plan if none exists) */
export async function PUT(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const result = sanitizePlanPayload(body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    await persistPlan(result.payload)
    return NextResponse.json(await loadPlanResponse())
  } catch (error) {
    console.error('PUT /api/quarter-plan error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Implement `app/api/quarter-plan/import/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { sanitizePlanPayload } from '@/lib/quarter-grid/state'
import { loadPlanResponse, persistPlan } from '@/lib/quarter-grid/persist'

export const dynamic = 'force-dynamic'

/**
 * POST /api/quarter-plan/import — one-time localStorage import.
 * Refuses with 409 when any plan exists (including losing a creation race),
 * so a second browser can never clobber an already-imported plan.
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const result = sanitizePlanPayload(body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    const persisted = await persistPlan(result.payload, { createOnly: true })
    if (persisted.status === 'conflict') {
      return NextResponse.json({ error: 'A quarter plan already exists' }, { status: 409 })
    }
    return NextResponse.json(await loadPlanResponse(), { status: 201 })
  } catch (error) {
    console.error('POST /api/quarter-plan/import error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run app/api/quarter-plan/route.test.ts lib/quarter-grid/state.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/quarter-plan
git commit -m "feat(quarter-grid): GET/PUT quarter-plan API + guarded one-time import"
```

---

### Task 5: Rewire `app/quarter-grid/page.tsx`

**Files:**
- Modify: `app/quarter-grid/page.tsx` (plumbing only — drag/drop, chips, gantt, CSV import, layout save/delete, add/remove client, reset all stay untouched)

Five edits. The page keeps its LOCAL `Client`/`ClientStatus`/`Schedule`/`Snapshots` types (B1/B2 convention); they're structurally identical to the module's, so calls type-check without casts.

- [ ] **Step 1: Add imports + save-state machinery**

Below `import Papa from 'papaparse'` add:

```ts
import {
  parseStoredQuarterState,
  buildPlanPayload,
  applyPlanResponse,
  sanitizeSnapshotForApply,
  type QuarterPlanGetResponse,
  type QuarterPlanPayload,
  type ClientStateMap,
} from '@/lib/quarter-grid/state'
```

Inside `QuarterGridV3()`, next to the other `useState` declarations, add:

```ts
const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
// Persistence is enabled ONLY once we positively know the DB state: plan
// loaded, import settled, or confirmed-empty DB. A failed /api/clients or
// /api/quarter-plan fetch leaves this false so a debounced PUT can never
// clobber (or pre-empt the import of) a plan we couldn't see.
const [canPersist, setCanPersist] = useState(false)
```

and next to the other refs:

```ts
const saveSeqRef = useRef(0)
const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const pendingPayloadRef = useRef<QuarterPlanPayload | null>(null)
```

- [ ] **Step 2: Replace the init effect**

Replace the entire `useEffect(() => { const init = async () => { ... }; init() }, [])` block (the one commented `─── Init: fetch clients from DB + restore localStorage ───`) with:

```ts
  // ─── Init: fetch clients + plan from DB; one-time localStorage import ────

  useEffect(() => {
    const init = async () => {
      // Canonical client list from DB
      let dbClients: { id: number; name: string }[] = []
      let clientsOk = false
      try {
        const res = await fetch('/api/clients')
        if (res.ok) { dbClients = await res.json(); clientsOk = true }
      } catch { /* ignore — show empty list */ }
      const validIds = dbClients.map((c) => c.id)

      let clientState: ClientStateMap = {}
      const hydrate = (resp: QuarterPlanGetResponse): boolean => {
        const applied = applyPlanResponse(resp, validIds)
        if (!applied) return false
        clientState = applied.clientState
        setSchedule(applied.schedule)
        setCompleted(new Set(applied.completed))
        setSlots(applied.slotsPerWeek)
        setLayouts(applied.layouts)
        setStartDate(applied.startDate)
        return true
      }

      let resp: QuarterPlanGetResponse | null = null
      let getFailed = false
      try {
        const res = await fetch('/api/quarter-plan')
        if (res.ok) resp = await res.json()
        else getFailed = true
      } catch { getFailed = true }

      // Persistence stays disabled unless we positively know the DB state.
      // A failed clients fetch also disables it: with an empty validIds set,
      // a save/import would write (and 409-arm) an EMPTY plan.
      let persistAllowed = clientsOk && !getFailed

      if (resp && resp.plan) {
        hydrate(resp)
      } else if (!getFailed) {
        // Confirmed no DB plan: try the one-time localStorage import.
        const stored = parseStoredQuarterState(
          typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
        )
        if (stored && clientsOk) {
          const payload = buildPlanPayload(stored, validIds)
          const localResp: QuarterPlanGetResponse = {
            plan: { name: payload.name, startDate: payload.startDate, slotsPerWeek: payload.slotsPerWeek, layouts: payload.layouts, updatedAt: '' },
            assignments: payload.assignments,
          }
          try {
            const res = await fetch('/api/quarter-plan/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
            if (res.ok) {
              hydrate(await res.json())
              flash('⬆ Imported quarter plan from this browser')
            } else if (res.status === 409) {
              // Someone imported first — the DB wins.
              const again = await fetch('/api/quarter-plan')
              if (again.ok) {
                if (!hydrate(await again.json())) hydrate(localResp)
              } else {
                hydrate(localResp)
                persistAllowed = false
              }
            } else {
              // Import failed with the DB confirmed empty — show local data
              // but do NOT enable saves: a later PUT would create the plan
              // and permanently 409-block re-running this import.
              hydrate(localResp)
              persistAllowed = false
            }
          } catch {
            hydrate(localResp)
            persistAllowed = false
          }
        }
        // No stored payload: fresh empty grid; saves allowed (first PUT
        // creates the singleton plan).
      } else {
        // GET failed — can't tell whether a plan exists. Show localStorage
        // data read-only if present; never import or save blind.
        const stored = parseStoredQuarterState(
          typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
        )
        if (stored) {
          const payload = buildPlanPayload(stored, validIds)
          hydrate({
            plan: { name: payload.name, startDate: payload.startDate, slotsPerWeek: payload.slotsPerWeek, layouts: payload.layouts, updatedAt: '' },
            assignments: payload.assignments,
          })
        }
      }

      // Merge DB clients with per-client plan state
      const merged: Client[] = dbClients.map((c) => ({
        id: c.id,
        name: c.name,
        priority: clientState[c.id]?.priority ?? 3,
        status: (clientState[c.id]?.status ?? 'not_started') as ClientStatus,
        note: clientState[c.id]?.note ?? '',
      }))
      setClients(merged)
      setCanPersist(persistAllowed)
      if (!persistAllowed) setSaveState('error')
      // Only now may the persist effect fire — flipping earlier would let a
      // debounced empty save create a plan and 409-block the real import.
      setLoaded(true)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Replace `persist()` + its effect with the debounced PUT + pagehide flush**

Delete the `const persist = (overrides = {}) => { ... }` function and the `useEffect(() => { if (loaded) persist() }, [...])` line. In their place:

```ts
  const buildCurrentPayload = (): QuarterPlanPayload => {
    const clientState: ClientStateMap = {}
    for (const c of clients) clientState[c.id] = { priority: c.priority, status: c.status, note: c.note }
    return buildPlanPayload(
      { clientState, schedule, completed, slotsPerWeek, layouts, startDate },
      clients.map((c) => c.id)
    )
  }

  // Debounced full-state save — last write wins. localStorage is no longer
  // written; the old seo-quarter-v3 key stays frozen as a pre-DB backup.
  // The generation (saveSeqRef) increments at SCHEDULING time, not when the
  // timer fires: if save A is in flight when edit B schedules, A's response
  // sees a newer generation and can't mark the indicator "saved" while B's
  // changes are still pending.
  useEffect(() => {
    if (!loaded || !canPersist) return
    const seq = ++saveSeqRef.current
    const payload = buildCurrentPayload()
    pendingPayloadRef.current = payload
    setSaveState('saving')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      pendingPayloadRef.current = null
      fetch('/api/quarter-plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then((res) => {
          if (seq !== saveSeqRef.current) return // newer changes pending — leave the indicator to them
          if (res.ok) setSaveState('saved')
          else { setSaveState('error'); flash('⚠ Save failed — will retry on next change') }
        })
        .catch(() => {
          if (seq !== saveSeqRef.current) return
          setSaveState('error')
          flash('⚠ Save failed — will retry on next change')
        })
    }, 800)
  }, [clients, schedule, completed, slotsPerWeek, layouts, startDate, loaded, canPersist]) // eslint-disable-line react-hooks/exhaustive-deps

  // Best-effort flush when the tab closes mid-debounce. keepalive bodies are
  // capped (~64 KB) so a large layouts blob may not make it — the debounced
  // save above is the real persistence path.
  useEffect(() => {
    const onPageHide = () => {
      if (saveTimerRef.current && pendingPayloadRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        try {
          fetch('/api/quarter-plan', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pendingPayloadRef.current),
            keepalive: true,
          })
        } catch { /* best-effort */ }
      }
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])
```

Also clear the save debounce in the existing unmount-cleanup effect (the one clearing `toastTimer`): add `if (saveTimerRef.current) clearTimeout(saveTimerRef.current)` inside its cleanup function.

- [ ] **Step 4: Sanitize `applyLayout`**

Replace the existing `applyLayout` function with:

```ts
  const applyLayout = (name: string) => {
    if (!name || !layouts[name]) return
    // A stale snapshot must not resurrect deleted clients or clobber current
    // names — patch state onto the current DB client list only.
    const sanitized = sanitizeSnapshotForApply(layouts[name], clients.map((c) => c.id))
    setSchedule(sanitized.schedule)
    setCompleted(new Set(sanitized.completed))
    setClients((prev) => prev.map((c) => {
      const patch = sanitized.clientPatches.get(c.id)
      return patch ? { ...c, priority: patch.priority, status: patch.status as ClientStatus, note: patch.note } : c
    }))
    setActiveLayout(name)
    flash(`📂 Loaded "${name}"`)
  }
```

- [ ] **Step 5: Save-status indicator in the header**

In the title row, immediately after the `<span style={{ fontSize: 11, color: "#64748b" }}>{totalClients} clients · 13 wks · {pct}%</span>` element, add:

```tsx
              <span style={{ fontSize: 10, color: saveState === 'error' ? '#f87171' : '#475569' }}>
                {loaded && !canPersist ? '⚠ not saved — reload to reconnect'
                  : saveState === 'saving' ? '● saving…'
                  : saveState === 'saved' ? '✓ saved'
                  : saveState === 'error' ? '⚠ not saved — retrying on next change' : ''}
              </span>
```

(When `canPersist` is false no save will ever fire this session, so the
message says "reload", not "retrying on next change".)

- [ ] **Step 6: Verify nothing else references the old persistence**

```bash
grep -n "localStorage" app/quarter-grid/page.tsx
```

Expected: exactly ONE hit — the `localStorage.getItem(STORAGE_KEY)` read inside the init effect. No `setItem` anywhere.

- [ ] **Step 7: Type-check + build**

```bash
npx tsc --noEmit && npm run build
```

Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add app/quarter-grid/page.tsx
git commit -m "feat(quarter-grid): DB-backed persistence — debounced PUT, one-time import, sanitized layout apply"
```

---

### Task 6: Full verification

- [ ] **Step 1: Full test suite**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run
```

Expected: everything green (1,881 before this work + ~30 new). If unrelated DB-backed tests flake on shared-dev-DB state, rerun the failing file once before investigating.

- [ ] **Step 2: tsc + build**

```bash
npx tsc --noEmit && npm run build
```

Expected: clean.

- [ ] **Step 3: Manual smoke (local)**

```bash
DATABASE_URL="file:./local-dev.db" npm run dev
```

In a browser: open `/quarter-grid` → fresh empty grid; drag a client into Wk 1 → indicator shows `● saving…` then `✓ saved`; reload → assignment persists; open a second browser/incognito → same grid. Then `curl -s localhost:3000/api/quarter-plan | head -c 400` shows the plan JSON.

Failure-path check (Codex plan-review fix #1): with the dev server STOPPED mid-session is awkward to simulate, so instead use devtools → Network → block `/api/quarter-plan` requests, reload: the page must show `⚠ not saved — reload to reconnect`, and NO PUT/import may fire while blocked (Network tab stays empty of quarter-plan writes when dragging).

- [ ] **Step 4: Commit any fixes; do NOT merge yet**

Ship flow (PR → deploy → production verification with the analyst's real localStorage browser → tracker/handoff) happens after plan execution per the B3 close-out checklist.

---

## Production verification checklist (post-deploy, for the close-out)

1. Deploy (`git push` then `ssh seo@144.126.213.242 "~/deploy.sh"`); migration auto-applies.
2. **Before anyone else opens the page**, Kevin opens `/quarter-grid` in the browser that holds the real `seo-quarter-v3` state → expect the "Imported quarter plan from this browser" toast and an identical-looking grid (assignments, priorities, statuses, notes, layouts dropdown, start date, slots/week).
3. Second browser (incognito) shows the same grid; a drag in one appears in the other after reload.
4. Server spot-check via node + Prisma from `/home/seo/webapps/seo-tools` (no sqlite3 CLI): one `QuarterPlan` row, ~30 `QuarterAssignment` rows, week/position populated.
5. `POST /api/quarter-plan/import` against the live DB returns 409 (guard armed).
