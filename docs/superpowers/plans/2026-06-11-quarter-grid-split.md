# Quarter Grid Monolith Split (B4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1,365-LOC `app/quarter-grid/page.tsx` into a `useQuarterPlan` data hook, pure `grid-ops` helpers, and focused components — zero behavior change, with the B3 persistence plumbing finally under unit test.

**Architecture:** Bottom-up extraction. Pure logic first (`lib/quarter-grid/grid-ops.ts`), then the data hook (`components/quarter-grid/useQuarterPlan.ts`) and keyboard hook, then presentational components, and only then the page rewrite. `page.tsx` keeps compiling and behaving identically at every intermediate commit because new files are unused until the final swap.

**Tech Stack:** Next.js 15 App Router (client components), TypeScript, vitest + @testing-library/react (jsdom per-file pragma, `globals:false` → `afterEach(cleanup)`), Papa Parse.

**Spec:** `docs/superpowers/specs/2026-06-11-quarter-grid-split-design.md` (Codex-reviewed ×8 fixes).

**Line-number convention:** all `page.tsx:N` references are against the file as of commit `eee6182` (unchanged since PR #62). Verify with `wc -l app/quarter-grid/page.tsx` → 1365 before starting; if it differs, re-locate by the quoted code, not the number.

**Cardinal rules (from the spec — do not drift):**
- Zero behavior change. Every fetch, debounce, guard, toast string, keyboard shortcut, and inline style moves verbatim.
- The persist effect's dependency array moves EXACTLY: `[clients, schedule, completed, slotsPerWeek, layouts, startDate, loaded, canPersist]`.
- In the init effect, `skipFirstPersistRef.current = true` is set BEFORE `setLoaded(true)`.
- Mere page-opens must never write (the production import window may still be armed).
- No interactive Prisma transactions anywhere (not touched here, but it's the house rule).
- Local dev DB: prefix vitest/prisma with `DATABASE_URL="file:./local-dev.db"`.

---

### Task 1: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
git checkout -b feat/quarter-grid-split
wc -l app/quarter-grid/page.tsx   # expect 1365
```

---

### Task 2: `lib/quarter-grid/grid-ops.ts` — pure helpers (TDD)

**Files:**
- Create: `lib/quarter-grid/grid-ops.ts`
- Create: `lib/quarter-grid/grid-ops.test.ts`

The logic is extracted from `page.tsx`: drop handler (708–728), Space-key frontier (229–257), auto-distribute (466–490), CSV merge (617–687), week range (594–604), pool sort (456–458), return-to-pool (494–498). `isoDate` (606–613) is dead code — it does NOT move; it dies with the page rewrite in Task 9.

- [ ] **Step 1: Write the failing tests**

Create `lib/quarter-grid/grid-ops.test.ts`:

```ts
// lib/quarter-grid/grid-ops.test.ts
import { describe, it, expect } from 'vitest'
import {
  removeFromSchedule, dropChipOnSlot, frontierWeek, placeInWeek,
  nextPoolChipId, sortPool, autoDistributeSchedule, applyCsvRows, getWeekRange,
  type GridClient,
} from './grid-ops'

const client = (id: number, name: string, priority = 3): GridClient =>
  ({ id, name, priority, status: 'not_started', note: '' })

describe('removeFromSchedule', () => {
  it('strips the id from every week without mutating input', () => {
    const input = { 1: [10, 20], 2: [10, 30] }
    const out = removeFromSchedule(input, 10)
    expect(out).toEqual({ 1: [20], 2: [30] })
    expect(input).toEqual({ 1: [10, 20], 2: [10, 30] })
  })
})

describe('dropChipOnSlot', () => {
  it('drops into an empty slot of an empty week', () => {
    expect(dropChipOnSlot({}, { id: 5, fromWeek: null }, 3, 0)).toEqual({ 3: [5] })
  })

  it('moves between weeks: removes from source week (emptied key survives as [])', () => {
    const out = dropChipOnSlot({ 1: [5], 2: [9] }, { id: 5, fromWeek: 1 }, 2, 1)
    expect(out).toEqual({ 1: [], 2: [9, 5] })
  })

  it('swap: dropping onto an occupied slot returns the displaced chip to the source week', () => {
    const out = dropChipOnSlot({ 1: [5], 2: [9] }, { id: 5, fromWeek: 1 }, 2, 0)
    expect(out[2]).toEqual([5])
    expect(out[1]).toEqual([9])
  })

  it('pool-sourced drop onto an occupied slot silently returns the displaced chip to the pool', () => {
    // fromWeek=null → the displaced chip is NOT re-placed anywhere (it falls
    // back to the pool because it no longer appears in any week). Verbatim
    // current behavior.
    const out = dropChipOnSlot({ 2: [9] }, { id: 5, fromWeek: null }, 2, 0)
    expect(out).toEqual({ 2: [5] })
  })

  it('drop beyond current row length appends (padding zeros are filtered)', () => {
    const out = dropChipOnSlot({ 2: [9] }, { id: 5, fromWeek: null }, 2, 2)
    expect(out[2]).toEqual([9, 5])
  })

  it('dropping a chip onto itself is a no-op placement', () => {
    const out = dropChipOnSlot({ 2: [5] }, { id: 5, fromWeek: 2 }, 2, 0)
    expect(out[2]).toEqual([5])
  })
})

describe('frontierWeek / placeInWeek', () => {
  it('empty schedule → week 1', () => {
    expect(frontierWeek({}, 2)).toBe(1)
  })
  it('last populated week has an open slot → that week', () => {
    expect(frontierWeek({ 1: [1, 2], 3: [4] }, 2)).toBe(3)
  })
  it('last populated week is full → next week', () => {
    expect(frontierWeek({ 3: [4, 5] }, 2)).toBe(4)
  })
  it('caps at week 13', () => {
    expect(frontierWeek({ 13: [1, 2] }, 2)).toBe(13)
  })
  it('placeInWeek removes prior placement and appends', () => {
    expect(placeInWeek({ 1: [7], 2: [8] }, 7, 2)).toEqual({ 1: [], 2: [8, 7] })
  })
})

describe('nextPoolChipId / sortPool', () => {
  const clients = [client(1, 'zeta', 1), client(2, 'alpha', 1), client(3, 'mid', 5)]
  it('sorts pool by priority then name', () => {
    expect(sortPool(clients, new Set()).map(c => c.id)).toEqual([2, 1, 3])
  })
  it('next chip excludes assigned ids and the just-assigned id', () => {
    expect(nextPoolChipId(clients, { 1: [2] }, 1)).toBe(3)
  })
  it('returns null when the pool empties', () => {
    expect(nextPoolChipId(clients, { 1: [2, 3] }, 1)).toBeNull()
  })
})

describe('autoDistributeSchedule', () => {
  it('3/wk fills weeks in chunks of 3 in priority-then-name order', () => {
    const cs = [client(1, 'b', 2), client(2, 'a', 2), client(3, 'c', 1), client(4, 'd', 3)]
    const out = autoDistributeSchedule(cs, 3)
    expect(out[1]).toEqual([3, 2, 1])
    expect(out[2]).toEqual([4])
  })
  it('2/wk gives heavy weeks (1,4,7,11) capacity 3, others 2', () => {
    const cs = Array.from({ length: 10 }, (_, i) => client(i + 1, `c${String(i + 1).padStart(2, '0')}`, 3))
    const out = autoDistributeSchedule(cs, 2)
    expect(out[1]).toHaveLength(3) // heavy
    expect(out[2]).toHaveLength(2)
    expect(out[3]).toHaveLength(2)
    expect(out[4]).toHaveLength(3) // heavy
    expect(out[5]).toBeUndefined() // 10 clients exhausted: 3+2+2+3
  })
})

describe('applyCsvRows', () => {
  const clients = [client(1, 'Acme College', 3), client(2, 'Beta School', 3)]
  it('matches names case-insensitively, assigns weeks, updates priority/status', () => {
    const rows = [
      { client_name: 'acme college', week: '2', priority: '1', status: 'In Progress' },
      { client: 'Beta School', week_assigned: '99' }, // week clamps to 13
    ]
    const out = applyCsvRows(rows, clients, {})
    expect(out.schedule[2]).toEqual([1])
    expect(out.schedule[13]).toEqual([2])
    expect(out.assignCount).toBe(2)
    expect(out.clientUpdates.get(1)).toEqual({ priority: 1, status: 'in_progress' })
    expect(out.clientUpdates.has(2)).toBe(false)
  })
  it('reassignment removes the prior week placement', () => {
    const out = applyCsvRows([{ client_name: 'Acme College', week: '5' }], clients, { 1: [1, 2] })
    expect(out.schedule[1]).toEqual([2])
    expect(out.schedule[5]).toEqual([1])
  })
  it('collects unrecognized names once each; blank names skipped', () => {
    const rows = [
      { client_name: 'Nope U' }, { client_name: 'Nope U' }, { client_name: '' },
    ]
    const out = applyCsvRows(rows, clients, {})
    expect(out.unrecognized).toEqual(['Nope U'])
    expect(out.assignCount).toBe(0)
  })
  it('invalid priority/status are ignored, row still assigns', () => {
    const out = applyCsvRows([{ client_name: 'Acme College', week: '1', priority: 'x', status: 'bogus' }], clients, {})
    expect(out.clientUpdates.size).toBe(0)
    expect(out.schedule[1]).toEqual([1])
  })
})

describe('getWeekRange', () => {
  it('formats Mon–Fri of the requested week', () => {
    expect(getWeekRange('2026-01-05', 1)).toBe('1/5–1/9')   // Mon Jan 5 2026
    expect(getWeekRange('2026-01-05', 2)).toBe('1/12–1/16')
  })
  it('crosses month boundaries', () => {
    expect(getWeekRange('2026-01-26', 1)).toBe('1/26–1/30')
    expect(getWeekRange('2026-01-26', 2)).toBe('2/2–2/6')
  })
  it('returns null for empty or garbage startDate', () => {
    expect(getWeekRange('', 1)).toBeNull()
    expect(getWeekRange('not-a-date', 1)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/quarter-grid/grid-ops.test.ts
```
Expected: FAIL — cannot resolve `./grid-ops`.

- [ ] **Step 3: Implement `lib/quarter-grid/grid-ops.ts`**

Each function body is the page.tsx code verbatim (cited), only re-parameterized:

```ts
// lib/quarter-grid/grid-ops.ts
// Pure, client-safe grid operations for the Quarter Grid (no React, no Prisma).
// Extracted verbatim from app/quarter-grid/page.tsx in the B4 split.

import { NUM_WEEKS, ALL_STATUSES, type ScheduleMap, type ClientStatus, type SnapshotClient } from './state'

// The working client-row shape used by the grid page, hook, and components.
// Structurally identical to a layout-snapshot client entry.
export type GridClient = SnapshotClient

// page.tsx:494-498 (returnToPool) / 573-584 (removeClient) shared shape
export function removeFromSchedule(schedule: ScheduleMap, id: number): ScheduleMap {
  const ns = { ...schedule }
  Object.keys(ns).forEach(w => { ns[+w] = (ns[+w] || []).filter(x => x !== id) })
  return ns
}

// page.tsx:708-728 (onDrop body)
export function dropChipOnSlot(
  schedule: ScheduleMap,
  drag: { id: number; fromWeek: number | null },
  targetWeek: number,
  targetSlot: number,
): ScheduleMap {
  const { id, fromWeek } = drag
  const ns: ScheduleMap = JSON.parse(JSON.stringify(schedule))
  if (!ns[targetWeek]) ns[targetWeek] = []
  const existing = ns[targetWeek][targetSlot]
  if (fromWeek !== null) ns[fromWeek] = (ns[fromWeek] || []).filter(x => x !== id)
  if (existing !== undefined && existing !== id) {
    if (fromWeek !== null) { if (!ns[fromWeek]) ns[fromWeek] = []; ns[fromWeek].push(existing) }
    ns[targetWeek][targetSlot] = id
  } else {
    while (ns[targetWeek].length < targetSlot) ns[targetWeek].push(0)
    if (targetSlot < ns[targetWeek].length) ns[targetWeek][targetSlot] = id
    else ns[targetWeek].push(id)
  }
  Object.keys(ns).forEach(w => { ns[+w] = ns[+w].filter(x => x !== null && x !== undefined && x !== 0) })
  return ns
}

// page.tsx:230-241 (Space key: pick the target week). Split from placement so
// the hook can compute the week from refs and place via a functional update,
// exactly mirroring the current effect's timing.
export function frontierWeek(schedule: ScheduleMap, slotsPerWeek: number): number {
  const weeksWithChips = Object.keys(schedule).map(Number).filter(w => (schedule[w] || []).length > 0)
  if (weeksWithChips.length === 0) return 1
  const lastWeek = Math.max(...weeksWithChips)
  return (schedule[lastWeek] || []).length < slotsPerWeek
    ? lastWeek
    : Math.min(lastWeek + 1, NUM_WEEKS)
}

// page.tsx:242-247 (Space key: the setSchedule updater body)
export function placeInWeek(schedule: ScheduleMap, id: number, targetWeek: number): ScheduleMap {
  const ns: ScheduleMap = JSON.parse(JSON.stringify(schedule))
  Object.keys(ns).forEach(wk => { ns[+wk] = (ns[+wk] || []).filter(x => x !== id) })
  if (!ns[targetWeek]) ns[targetWeek] = []
  ns[targetWeek] = [...ns[targetWeek], id]
  return ns
}

// page.tsx:456-458 (pool derivation) — also used by nextPoolChipId
export function sortPool(clients: GridClient[], assignedIds: Set<number>): GridClient[] {
  return clients
    .filter(c => !assignedIds.has(c.id))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
}

// page.tsx:249-255 (Space key: pre-select the next pool chip).
// `schedule` is the PRE-update schedule; justAssignedId is added on top,
// matching the current ref-based computation.
export function nextPoolChipId(clients: GridClient[], schedule: ScheduleMap, justAssignedId: number): number | null {
  const currentAssigned = new Set(Object.values(schedule).flat())
  currentAssigned.add(justAssignedId)
  const next = sortPool(clients, currentAssigned)[0]
  return next?.id ?? null
}

// page.tsx:466-490 (autoDistribute body, minus setState/flash)
export function autoDistributeSchedule(clients: GridClient[], slotsPerWeek: number): ScheduleMap {
  const sorted = [...clients].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  const total = sorted.length
  const ns: ScheduleMap = {}
  if (slotsPerWeek === 3) {
    let w = 1, s = 0
    for (const c of sorted) {
      if (!ns[w]) ns[w] = []
      ns[w].push(c.id)
      if (++s >= 3) { w++; s = 0 }
    }
  } else {
    const heavyWeeks = new Set([1, 4, 7, 11])
    const weekCaps = Array.from({ length: NUM_WEEKS }, (_, i) => heavyWeeks.has(i + 1) ? 3 : 2)
    let ci = 0
    for (let wi = 0; wi < NUM_WEEKS && ci < total; wi++) {
      ns[wi + 1] = []
      for (let s = 0; s < weekCaps[wi] && ci < total; s++) {
        ns[wi + 1].push(sorted[ci++].id)
      }
    }
  }
  return ns
}

export type CsvApplyResult = {
  schedule: ScheduleMap
  clientUpdates: Map<number, Partial<GridClient>>
  assignCount: number
  unrecognized: string[]
}

// page.tsx:629-677 (handleCsvFile body, minus FileReader/Papa/setState/flash)
export function applyCsvRows(
  rows: Record<string, string>[],
  clients: GridClient[],
  schedule: ScheduleMap,
): CsvApplyResult {
  const unrecognized: string[] = []
  let assignCount = 0
  const newSchedule: ScheduleMap = JSON.parse(JSON.stringify(schedule))
  const clientUpdates = new Map<number, Partial<GridClient>>()

  for (const row of rows) {
    const rawName = (row['client_name'] ?? row['client'] ?? '').trim()
    if (!rawName) continue

    const match = clients.find(c => c.name.toLowerCase() === rawName.toLowerCase())
    if (!match) {
      if (!unrecognized.includes(rawName)) unrecognized.push(rawName)
      continue
    }

    const weekRaw = parseInt(row['week_assigned'] ?? row['week'] ?? '', 10)
    const week = isNaN(weekRaw) ? null : Math.min(Math.max(weekRaw, 1), NUM_WEEKS)

    const priorityRaw = parseInt(row['priority'] ?? '', 10)
    const priority = isNaN(priorityRaw) ? null : Math.min(Math.max(priorityRaw, 1), 5)

    const statusRaw = (row['status'] ?? '').trim().toLowerCase().replace(/ /g, '_') as ClientStatus
    const validStatus: ClientStatus | null = ALL_STATUSES.includes(statusRaw) ? statusRaw : null

    const upd: Partial<GridClient> = {}
    if (priority !== null) upd.priority = priority
    if (validStatus !== null) upd.status = validStatus
    if (Object.keys(upd).length > 0) clientUpdates.set(match.id, upd)

    if (week !== null) {
      Object.keys(newSchedule).forEach(w => {
        newSchedule[+w] = (newSchedule[+w] || []).filter(x => x !== match.id)
      })
      if (!newSchedule[week]) newSchedule[week] = []
      newSchedule[week].push(match.id)
      assignCount++
    }
  }

  return { schedule: newSchedule, clientUpdates, assignCount, unrecognized }
}

// page.tsx:594-604
export function getWeekRange(startDate: string, weekNum: number): string | null {
  if (!startDate) return null
  const base = new Date(startDate + 'T00:00:00')
  if (isNaN(base.getTime())) return null
  const mon = new Date(base)
  mon.setDate(base.getDate() + (weekNum - 1) * 7)
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
  return `${fmt(mon)}–${fmt(fri)}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/quarter-grid/grid-ops.test.ts
```
Expected: all PASS. Note: the en-dash in `getWeekRange` expectations (`1/5–1/9`) must match the code's `–` (U+2013), not a hyphen.

- [ ] **Step 5: Commit**

```bash
git add lib/quarter-grid/grid-ops.ts lib/quarter-grid/grid-ops.test.ts
git commit -m "feat(quarter-grid): extract pure grid-ops helpers (B4)"
```

---

### Task 3: `theme.ts` + `Chip.tsx` (+ test)

**Files:**
- Create: `components/quarter-grid/theme.ts`
- Create: `components/quarter-grid/Chip.tsx`
- Create: `components/quarter-grid/Chip.test.tsx`

- [ ] **Step 1: Create `components/quarter-grid/theme.ts`**

Constants moved verbatim from page.tsx:26–53, plus the done-chip color object that appears inline twice (page.tsx:78–80 and 1226–1228):

```ts
// components/quarter-grid/theme.ts
// Visual constants for the Quarter Grid (moved verbatim from page.tsx in B4).
import type { ClientStatus } from '@/lib/quarter-grid/state'

export const PCOLORS: Record<number, { chip: string; border: string; text: string; badge: string; label: string }> = {
  1: { chip: "#fee2e2", border: "#f87171", text: "#991b1b", badge: "#ef4444", label: "P1 · High" },
  2: { chip: "#ffedd5", border: "#fb923c", text: "#9a3412", badge: "#f97316", label: "P2" },
  3: { chip: "#fef9c3", border: "#facc15", text: "#713f12", badge: "#eab308", label: "P3 · Med" },
  4: { chip: "#dbeafe", border: "#60a5fa", text: "#1e3a8a", badge: "#3b82f6", label: "P4" },
  5: { chip: "#f1f5f9", border: "#94a3b8", text: "#334155", badge: "#94a3b8", label: "P5 · Low" },
}

export const DONE_COLORS = { chip: "#dcfce7", border: "#4ade80", text: "#14532d", badge: "#22c55e" }

export const STATUS_COLORS: Record<ClientStatus, string> = {
  not_started: '#94a3b8',
  in_progress:  '#3b82f6',
  on_hold:      '#eab308',
  blocked:      '#ef4444',
  complete:     '#22c55e',
}

export const STATUS_LABELS: Record<ClientStatus, string> = {
  not_started: 'Not Started',
  in_progress:  'In Progress',
  on_hold:      'On Hold',
  blocked:      'Blocked',
  complete:     'Complete',
}

export const SLOT_LABELS = ["Mon", "Wed", "Fri"]
```

(`NUM_WEEKS`, `ALL_STATUSES` already live in `lib/quarter-grid/state.ts` — import from there, never redeclare.)

- [ ] **Step 2: Create `components/quarter-grid/Chip.tsx`**

Move page.tsx:56–155 verbatim. Only changes: imports, `Client` → `GridClient`, the two inline color objects → `DONE_COLORS`:

```tsx
// components/quarter-grid/Chip.tsx
'use client'

import { memo } from 'react'
import { ALL_STATUSES, type ClientStatus } from '@/lib/quarter-grid/state'
import type { GridClient } from '@/lib/quarter-grid/grid-ops'
import { PCOLORS, DONE_COLORS, STATUS_COLORS, STATUS_LABELS } from './theme'

interface ChipProps {
  id: number
  fromWeek: number | null
  client: GridClient
  done: boolean
  isDragging: boolean
  onDragStart: (e: React.DragEvent, id: number, fromWeek: number | null) => void
  onDragEnd: () => void
  onToggleDone: (id: number) => void
  onSetPriority: (id: number, p: number) => void
  onReturn: (id: number) => void
  onSetStatus: (id: number, status: ClientStatus) => void
  onOpenNote: (id: number, currentNote: string) => void
}

export const Chip = memo(function Chip({
  id, fromWeek, client: c, done, isDragging,
  onDragStart, onDragEnd, onToggleDone, onSetPriority, onReturn,
  onSetStatus, onOpenNote,
}: ChipProps) {
  const colors = done ? DONE_COLORS : PCOLORS[c.priority]
  const statusColor = STATUS_COLORS[c.status]
  const hasNote = c.note.trim().length > 0

  return (
    /* page.tsx:84-153 JSX VERBATIM — the draggable chip-row div with status
       dot, done checkbox, name span, note pencil, priority select, and the
       conditional return-to-pool × . Copy it exactly. */
  )
})
```

The JSX body (page.tsx:84–153) transplants without a single edit.

- [ ] **Step 3: Write `components/quarter-grid/Chip.test.tsx`**

```tsx
// @vitest-environment jsdom
// components/quarter-grid/Chip.test.tsx
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Chip } from './Chip'
import type { GridClient } from '@/lib/quarter-grid/grid-ops'

afterEach(cleanup) // globals:false → no auto-cleanup

const client = (over: Partial<GridClient> = {}): GridClient =>
  ({ id: 7, name: 'Acme College', priority: 2, status: 'not_started', note: '', ...over })

const handlers = () => ({
  onDragStart: vi.fn(), onDragEnd: vi.fn(), onToggleDone: vi.fn(),
  onSetPriority: vi.fn(), onReturn: vi.fn(), onSetStatus: vi.fn(), onOpenNote: vi.fn(),
})

describe('Chip', () => {
  it('cycles status in ALL_STATUSES order when the status dot is clicked', () => {
    const h = handlers()
    render(<Chip id={7} fromWeek={null} client={client()} done={false} isDragging={false} {...h} />)
    fireEvent.click(screen.getByTitle(/Status: Not Started/))
    expect(h.onSetStatus).toHaveBeenCalledWith(7, 'in_progress')
  })

  it('wraps status cycling from complete back to not_started', () => {
    const h = handlers()
    render(<Chip id={7} fromWeek={null} client={client({ status: 'complete' })} done={false} isDragging={false} {...h} />)
    fireEvent.click(screen.getByTitle(/Status: Complete/))
    expect(h.onSetStatus).toHaveBeenCalledWith(7, 'not_started')
  })

  it('checkbox toggles done', () => {
    const h = handlers()
    render(<Chip id={7} fromWeek={null} client={client()} done={false} isDragging={false} {...h} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(h.onToggleDone).toHaveBeenCalledWith(7)
  })

  it('priority select fires onSetPriority with a number', () => {
    const h = handlers()
    render(<Chip id={7} fromWeek={null} client={client()} done={false} isDragging={false} {...h} />)
    fireEvent.change(screen.getByTitle('Priority 1=High, 5=Low'), { target: { value: '5' } })
    expect(h.onSetPriority).toHaveBeenCalledWith(7, 5)
  })

  it('renders the return-× only when fromWeek != null, and it fires onReturn', () => {
    const h = handlers()
    const { rerender } = render(<Chip id={7} fromWeek={null} client={client()} done={false} isDragging={false} {...h} />)
    expect(screen.queryByTitle('Return to pool')).toBeNull()
    rerender(<Chip id={7} fromWeek={3} client={client()} done={false} isDragging={false} {...h} />)
    fireEvent.click(screen.getByTitle('Return to pool'))
    expect(h.onReturn).toHaveBeenCalledWith(7)
  })

  it('note pencil opens the note with the current text', () => {
    const h = handlers()
    render(<Chip id={7} fromWeek={null} client={client({ note: 'call them' })} done={false} isDragging={false} {...h} />)
    fireEvent.click(screen.getByTitle('Note: call them'))
    expect(h.onOpenNote).toHaveBeenCalledWith(7, 'call them')
  })
})
```

- [ ] **Step 4: Run the tests**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run components/quarter-grid/Chip.test.tsx
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add components/quarter-grid/theme.ts components/quarter-grid/Chip.tsx components/quarter-grid/Chip.test.tsx
git commit -m "feat(quarter-grid): extract theme constants + Chip component (B4)"
```

---

### Task 4: `useQuarterPlan` hook (TDD — the B3 plumbing under test)

**Files:**
- Create: `components/quarter-grid/useQuarterPlan.ts`
- Create: `components/quarter-grid/useQuarterPlan.test.tsx`

This is the highest-risk task. The init effect (page.tsx:269–385), persist effect (396–429), pagehide flush (431–451), refs (184–199), and unmount cleanup (201–207) move VERBATIM — same statement order, same comments, same eslint-disable lines. The only mechanical changes: `flash(...)` → `onToastRef.current(...)`, `Client` → `GridClient`, extracted pure helpers replace inline logic where Task 2 created them.

- [ ] **Step 1: Write the failing tests**

Create `components/quarter-grid/useQuarterPlan.test.tsx`:

```tsx
// @vitest-environment jsdom
// components/quarter-grid/useQuarterPlan.test.tsx
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useQuarterPlan } from './useQuarterPlan'
import type { QuarterPlanGetResponse } from '@/lib/quarter-grid/state'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear() })
beforeEach(() => { localStorage.clear() })

const DB_CLIENTS = [ { id: 1, name: 'Acme' }, { id: 2, name: 'Beta' } ]

const DB_PLAN: QuarterPlanGetResponse = {
  plan: { name: 'Quarter plan', startDate: '2026-01-05', slotsPerWeek: 2, layouts: {}, updatedAt: 'x' },
  assignments: [
    { clientId: 1, week: 1, position: 0, priority: 2, status: 'in_progress', note: 'hi', completed: false },
    { clientId: 2, week: null, position: null, priority: 3, status: 'not_started', note: '', completed: true },
  ],
}

const LOCAL_PAYLOAD = JSON.stringify({
  clientState: { 1: { priority: 1, status: 'on_hold', note: 'ls' } },
  schedule: { 2: [1] }, completed: [], slotsPerWeek: 3, layouts: {}, startDate: '2026-01-05',
})

type Routes = {
  clients?: { ok: boolean; json?: unknown }
  planGet?: { ok: boolean; json?: unknown }
  importPost?: { ok: boolean; status?: number; json?: unknown } | (() => Promise<Response>)
  put?: { ok: boolean } | (() => Promise<Response>)
}

// Records every call; routes by method+path. Unrouted calls throw so a test
// can never silently hit an endpoint it didn't declare.
function stubFetch(routes: Routes) {
  const calls: { url: string; method: string; body?: unknown }[] = []
  const res = (r: { ok: boolean; status?: number; json?: unknown }) =>
    ({ ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.json ?? {} }) as Response
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined })
    if (url === '/api/clients' && method === 'GET') {
      if (!routes.clients) throw new Error('unrouted /api/clients')
      return res(routes.clients)
    }
    if (url === '/api/quarter-plan' && method === 'GET') {
      if (!routes.planGet) throw new Error('unrouted GET /api/quarter-plan')
      return res(routes.planGet)
    }
    if (url === '/api/quarter-plan/import' && method === 'POST') {
      if (!routes.importPost) throw new Error('unrouted import POST')
      return typeof routes.importPost === 'function' ? routes.importPost() : res(routes.importPost)
    }
    if (url === '/api/quarter-plan' && method === 'PUT') {
      if (!routes.put) throw new Error('unrouted PUT /api/quarter-plan')
      return typeof routes.put === 'function' ? routes.put() : res(routes.put)
    }
    throw new Error(`unrouted fetch ${method} ${url}`)
  }))
  return {
    calls,
    puts: () => calls.filter(c => c.method === 'PUT' && c.url === '/api/quarter-plan'),
    imports: () => calls.filter(c => c.method === 'POST' && c.url === '/api/quarter-plan/import'),
  }
}

async function renderPlan(expectLoaded = true) {
  const onToast = vi.fn()
  const hook = renderHook(() => useQuarterPlan({ onToast }))
  // The init chain is sequential fetches + state updates + a follow-up effect
  // pass — one timer tick is not guaranteed to settle it. Wait for `loaded`
  // so a test's first edit can never accidentally consume the
  // skip-first-persist guard mid-init. (waitFor works under fake timers in
  // @testing-library/react ≥14.1; it advances timers internally.)
  if (expectLoaded) {
    await waitFor(() => expect(hook.result.current.loaded).toBe(true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) }) // flush the post-load effect pass
  } else {
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  }
  return { ...hook, onToast }
}

describe('useQuarterPlan init', () => {
  beforeEach(() => vi.useFakeTimers())

  it('DB plan exists → hydrates state, canPersist true, and NO PUT fires after init', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: DB_PLAN } })
    const { result } = await renderPlan()
    expect(result.current.loaded).toBe(true)
    expect(result.current.canPersist).toBe(true)
    expect(result.current.schedule).toEqual({ 1: [1] })
    expect(result.current.completed.has(2)).toBe(true)
    expect(result.current.clients.find(c => c.id === 1)).toMatchObject({ priority: 2, status: 'in_progress', note: 'hi' })
    expect(result.current.startDate).toBe('2026-01-05')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(f.puts()).toHaveLength(0) // skip-first-persist: mere page-opens never write
  })

  it('confirmed-empty DB + no localStorage → zero imports and zero PUTs (armed import window)', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: { plan: null } } })
    const { result } = await renderPlan()
    expect(result.current.loaded).toBe(true)
    expect(result.current.canPersist).toBe(true) // saves allowed, but only on a real edit
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(f.imports()).toHaveLength(0)
    expect(f.puts()).toHaveLength(0)
  })

  it('empty DB + localStorage → exactly one import POST, toast, hydrate, and zero echo PUTs', async () => {
    localStorage.setItem('seo-quarter-v3', LOCAL_PAYLOAD)
    const importResponse = {
      plan: { name: 'Quarter plan', startDate: '2026-01-05', slotsPerWeek: 3, layouts: {}, updatedAt: 'x' },
      assignments: [{ clientId: 1, week: 2, position: 0, priority: 1, status: 'on_hold', note: 'ls', completed: false }],
    }
    const f = stubFetch({
      clients: { ok: true, json: DB_CLIENTS },
      planGet: { ok: true, json: { plan: null } },
      importPost: { ok: true, json: importResponse },
    })
    const { result, onToast } = await renderPlan()
    expect(f.imports()).toHaveLength(1)
    expect(onToast).toHaveBeenCalledWith('⬆ Imported quarter plan from this browser')
    expect(result.current.schedule).toEqual({ 2: [1] })
    expect(result.current.canPersist).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(f.puts()).toHaveLength(0) // import success must not echo-save
  })

  it('import 409 → re-GET, DB wins', async () => {
    localStorage.setItem('seo-quarter-v3', LOCAL_PAYLOAD)
    let getCount = 0
    const f = stubFetch({
      clients: { ok: true, json: DB_CLIENTS },
      planGet: { ok: true, json: { plan: null } },
      importPost: { ok: false, status: 409 },
    })
    // second GET (after 409) returns the DB plan
    const orig = global.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/quarter-plan' && (init?.method ?? 'GET') === 'GET') {
        getCount++
        if (getCount >= 2) return { ok: true, status: 200, json: async () => DB_PLAN } as Response
      }
      return (orig as typeof fetch)(url, init)
    }))
    const { result } = await renderPlan()
    expect(result.current.schedule).toEqual({ 1: [1] }) // DB plan, not localStorage
    expect(result.current.canPersist).toBe(true)
    expect(f.imports()).toHaveLength(1)
  })

  it('import non-409 failure → local data shown read-only, no PUT on later edits', async () => {
    localStorage.setItem('seo-quarter-v3', LOCAL_PAYLOAD)
    const f = stubFetch({
      clients: { ok: true, json: DB_CLIENTS },
      planGet: { ok: true, json: { plan: null } },
      importPost: { ok: false, status: 500 },
    })
    const { result } = await renderPlan()
    expect(result.current.schedule).toEqual({ 2: [1] }) // localStorage rendered
    expect(result.current.canPersist).toBe(false)
    expect(result.current.saveState).toBe('error')
    act(() => result.current.toggleDone(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(f.puts()).toHaveLength(0)
  })

  it('clients fetch fails → canPersist false even when plan GET succeeds', async () => {
    const f = stubFetch({ clients: { ok: false }, planGet: { ok: true, json: { plan: null } } })
    const { result } = await renderPlan()
    expect(result.current.canPersist).toBe(false)
    expect(result.current.clients).toEqual([])
    act(() => result.current.setStartDate('2026-02-02'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(f.puts()).toHaveLength(0)
  })

  it('plan GET fails → localStorage rendered read-only, no import attempted', async () => {
    localStorage.setItem('seo-quarter-v3', LOCAL_PAYLOAD)
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: false } })
    const { result } = await renderPlan()
    expect(result.current.schedule).toEqual({ 2: [1] })
    expect(result.current.canPersist).toBe(false)
    expect(f.imports()).toHaveLength(0)
  })
})

describe('useQuarterPlan persistence', () => {
  beforeEach(() => vi.useFakeTimers())

  it('an edit after load → exactly one PUT after 800ms; saveState saving→saved', async () => {
    const f = stubFetch({
      clients: { ok: true, json: DB_CLIENTS },
      planGet: { ok: true, json: DB_PLAN },
      put: { ok: true },
    })
    const { result } = await renderPlan()
    act(() => result.current.toggleDone(1))
    expect(result.current.saveState).toBe('saving')
    expect(f.puts()).toHaveLength(0) // debounce pending
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(f.puts()).toHaveLength(1)
    expect(result.current.saveState).toBe('saved')
    const body = f.puts()[0].body as { assignments: { clientId: number; completed: boolean }[] }
    expect(body.assignments.find(a => a.clientId === 1)?.completed).toBe(true)
  })

  it('rapid edits collapse into one PUT (debounce restarts)', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: DB_PLAN }, put: { ok: true } })
    const { result } = await renderPlan()
    act(() => result.current.toggleDone(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    act(() => result.current.setPriority(1, 5))
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(f.puts()).toHaveLength(1)
  })

  it('PUT failure → saveState error + retry toast', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: DB_PLAN }, put: { ok: false } })
    const { result, onToast } = await renderPlan()
    act(() => result.current.toggleDone(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(result.current.saveState).toBe('error')
    expect(onToast).toHaveBeenCalledWith('⚠ Save failed — will retry on next change')
    expect(f.puts()).toHaveLength(1)
  })

  it('pagehide flushes a pending debounced save with keepalive, and the timer does not double-PUT', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: DB_PLAN }, put: { ok: true } })
    const keepaliveFlags: (boolean | undefined)[] = []
    const orig = global.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') keepaliveFlags.push(init.keepalive)
      return (orig as typeof fetch)(url, init)
    }))
    const { result } = await renderPlan()
    act(() => result.current.toggleDone(1))      // debounce pending, no PUT yet
    expect(f.puts()).toHaveLength(0)
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(f.puts()).toHaveLength(1)
    expect(keepaliveFlags).toEqual([true])
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(f.puts()).toHaveLength(1)             // timer was cleared — no second PUT
  })

  it('generation guard: in-flight save A cannot mark "saved" while edit B is pending', async () => {
    let resolveA!: (r: Response) => void
    let putCount = 0
    const f = stubFetch({
      clients: { ok: true, json: DB_CLIENTS },
      planGet: { ok: true, json: DB_PLAN },
      put: () => {
        putCount++
        if (putCount === 1) return new Promise<Response>(r => { resolveA = r })
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
      },
    })
    const { result } = await renderPlan()
    act(() => result.current.toggleDone(1))                       // edit A
    await act(async () => { await vi.advanceTimersByTimeAsync(800) }) // PUT A in flight
    act(() => result.current.setPriority(1, 4))                   // edit B schedules → seq bumps
    await act(async () => { resolveA({ ok: true, status: 200, json: async () => ({}) } as Response) })
    expect(result.current.saveState).toBe('saving')               // A may not claim "saved"
    await act(async () => { await vi.advanceTimersByTimeAsync(800) }) // PUT B fires + resolves
    expect(result.current.saveState).toBe('saved')
    expect(f.puts()).toHaveLength(2)
  })
})

describe('useQuarterPlan client mutations', () => {
  beforeEach(() => vi.useFakeTimers())

  it('addClient POSTs, inserts sorted, toasts, returns true', async () => {
    const calls = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: { plan: null } }, put: { ok: true } })
    const orig = global.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/clients' && init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 9, name: 'Aardvark U' }) } as Response
      }
      return (orig as typeof fetch)(url, init)
    }))
    const { result, onToast } = await renderPlan()
    let ok = false
    await act(async () => { ok = await result.current.addClient('Aardvark U') })
    expect(ok).toBe(true)
    expect(result.current.clients[0]).toMatchObject({ id: 9, name: 'Aardvark U', priority: 3, status: 'not_started', note: '' })
    expect(onToast).toHaveBeenCalledWith('+ Added "Aardvark U"')
    void calls
  })

  it('removeClient optimistically drops the client from clients/schedule/completed and DELETEs', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: DB_PLAN }, put: { ok: true } })
    const orig = global.fetch
    const deletes: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') { deletes.push(url); return { ok: true, status: 200, json: async () => ({}) } as Response }
      return (orig as typeof fetch)(url, init)
    }))
    const { result } = await renderPlan()
    act(() => result.current.removeClient(1))
    expect(result.current.clients.find(c => c.id === 1)).toBeUndefined()
    expect(result.current.schedule[1] ?? []).not.toContain(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(deletes).toEqual(['/api/clients/1'])
    void f
  })

  it('assignHoveredToFrontier places the chip, toasts the week, returns the next pool id', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: { plan: null } }, put: { ok: true } })
    const { result, onToast } = await renderPlan()
    let next: number | null = null
    act(() => { next = result.current.assignHoveredToFrontier(1) })
    expect(result.current.schedule[1]).toContain(1)
    expect(onToast).toHaveBeenCalledWith('→ Wk 1')
    expect(next).toBe(2)
    void f
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run components/quarter-grid/useQuarterPlan.test.tsx
```
Expected: FAIL — cannot resolve `./useQuarterPlan`.

- [ ] **Step 3: Implement `components/quarter-grid/useQuarterPlan.ts`**

```ts
// components/quarter-grid/useQuarterPlan.ts
'use client'

// Quarter Grid data hook (B4 split). The init effect, persist effect, and
// pagehide flush are MOVED VERBATIM from app/quarter-grid/page.tsx — every
// comment, guard, and eslint-disable with them. Do not "improve" them; the
// skip-first-persist handshake and canPersist gate are production-load-bearing
// (the one-time localStorage import window).

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  parseStoredQuarterState, buildPlanPayload, applyPlanResponse, sanitizeSnapshotForApply,
  type QuarterPlanGetResponse, type QuarterPlanPayload, type ClientStateMap,
  type ScheduleMap, type Snapshots, type ClientStatus,
} from '@/lib/quarter-grid/state'
import {
  removeFromSchedule, dropChipOnSlot, frontierWeek, placeInWeek, nextPoolChipId,
  sortPool, autoDistributeSchedule, applyCsvRows, type GridClient,
} from '@/lib/quarter-grid/grid-ops'

const STORAGE_KEY = 'seo-quarter-v3'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function useQuarterPlan({ onToast }: { onToast: (msg: string) => void }) {
  const [clients, setClients]     = useState<GridClient[]>([])
  const [schedule, setSchedule]   = useState<ScheduleMap>({})
  const [completed, setCompleted] = useState<Set<number>>(new Set())
  const [slotsPerWeek, setSlots]  = useState(2)
  const [layouts, setLayouts]     = useState<Snapshots>({})
  const [startDate, setStartDate] = useState('')
  const [loaded, setLoaded]       = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // ⬇ page.tsx:179-183 comment + state, verbatim
  const [canPersist, setCanPersist] = useState(false)

  // Toast callback behind a ref so the stable useCallbacks below never go stale.
  const onToastRef = useRef(onToast)
  useEffect(() => { onToastRef.current = onToast }, [onToast])

  // ⬇ page.tsx:185-199 refs, verbatim (toastTimer stays in the page)
  const saveSeqRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPayloadRef = useRef<QuarterPlanPayload | null>(null)
  const skipFirstPersistRef = useRef(false) // incl. its page.tsx:188-192 comment
  const scheduleRef     = useRef(schedule)
  const clientsRef      = useRef(clients)
  const slotsPerWeekRef = useRef(slotsPerWeek)
  useEffect(() => { scheduleRef.current = schedule }, [schedule])
  useEffect(() => { clientsRef.current = clients }, [clients])
  useEffect(() => { slotsPerWeekRef.current = slotsPerWeek }, [slotsPerWeek])

  // Clear pending save timer on unmount (page.tsx:201-207, minus toastTimer)
  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [])

  // ─── Init: page.tsx:269-385 VERBATIM ────────────────────────────────────
  // The whole `init` async fn + `init()` call move unchanged, including all
  // comments, the hydrate closure, the 409/failed-GET/failed-import branches,
  // and the closing order:
  //     skipFirstPersistRef.current = true   // BEFORE setLoaded
  //     setLoaded(true)
  // Only mechanical change: flash('⬆ Imported quarter plan from this browser')
  // becomes onToastRef.current('⬆ Imported quarter plan from this browser').
  useEffect(() => {
    /* …page.tsx:271-384 here… */
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // page.tsx:387-394 verbatim
  const buildCurrentPayload = (): QuarterPlanPayload => {
    const clientState: ClientStateMap = {}
    for (const c of clients) clientState[c.id] = { priority: c.priority, status: c.status, note: c.note }
    return buildPlanPayload(
      { clientState, schedule, completed, slotsPerWeek, layouts, startDate },
      clients.map((c) => c.id)
    )
  }

  // ─── Debounced save: page.tsx:396-429 VERBATIM ──────────────────────────
  // Deps array must remain EXACTLY:
  //   [clients, schedule, completed, slotsPerWeek, layouts, startDate, loaded, canPersist]
  // flash(...) → onToastRef.current(...).
  useEffect(() => {
    /* …page.tsx:402-428 here… */
  }, [clients, schedule, completed, slotsPerWeek, layouts, startDate, loaded, canPersist]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── pagehide keepalive flush: page.tsx:431-451 VERBATIM ────────────────
  useEffect(() => {
    /* …page.tsx:435-450 here… */
  }, [])

  // ─── Derived (page.tsx:453-462) ──────────────────────────────────────────
  const assignedIds  = new Set(Object.values(schedule).flat())
  const unassigned   = sortPool(clients, assignedIds)
  const getClient    = (id: number) => clients.find(c => c.id === id)
  const doneCount    = completed.size
  const totalClients = clients.length
  const pct          = totalClients > 0 ? Math.round((doneCount / totalClients) * 100) : 0

  // ─── Mutations (page.tsx:464-592, 615-735) ──────────────────────────────

  // Stable: usePoolKeyboard's effect deps are [hoveredPoolChipId] only.
  const setPriority = useCallback((id: number, p: number) => {
    setClients(prev => prev.map(c => c.id === id ? { ...c, priority: p } : c))
  }, [])

  const toggleDone   = (id: number) => setCompleted(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const returnToPool = (id: number) => setSchedule(prev => removeFromSchedule(prev, id))

  const setStatus = useCallback((id: number, status: ClientStatus) => {
    setClients(prev => prev.map(c => c.id === id ? { ...c, status } : c))
  }, [])

  const saveNote = (id: number, note: string) => {
    setClients(prev => prev.map(c => c.id === id ? { ...c, note } : c))
  }

  const dropChip = (drag: { id: number; fromWeek: number | null }, week: number, slot: number) => {
    setSchedule(prev => dropChipOnSlot(prev, drag, week, slot))
  }

  // Stable for usePoolKeyboard; reads refs exactly like the old keyboard
  // effect (page.tsx:229-256): targetWeek + next-chip from the PRE-update
  // schedule, placement via functional update.
  const assignHoveredToFrontier = useCallback((id: number): number | null => {
    const targetWeek = frontierWeek(scheduleRef.current, slotsPerWeekRef.current)
    setSchedule(prev => placeInWeek(prev, id, targetWeek))
    const next = nextPoolChipId(clientsRef.current, scheduleRef.current, id)
    onToastRef.current(`→ Wk ${targetWeek}`)
    return next
  }, [])

  const autoDistribute = () => {
    setSchedule(autoDistributeSchedule(clients, slotsPerWeek))
    onToastRef.current('⚡ Auto-distributed across 13 weeks')
  }

  const resetAll = () => {
    setSchedule({})
    setCompleted(new Set())
    setClients(prev => prev.map(c => ({ ...c, priority: 3, status: 'not_started' as ClientStatus, note: '' })))
    onToastRef.current('🔄 Reset — all clients returned to pool')
  }

  const saveLayout = (name: string) => {
    if (!name.trim()) return
    const snap = {
      schedule:  JSON.parse(JSON.stringify(schedule)),
      completed: Array.from(completed),
      clients:   JSON.parse(JSON.stringify(clients)),
    }
    setLayouts(prev => ({ ...prev, [name.trim()]: snap }))
    onToastRef.current(`💾 Saved layout "${name.trim()}"`)
  }

  const applyLayout = (name: string) => {
    if (!name || !layouts[name]) return
    // page.tsx:533-544 verbatim (sanitize → setSchedule/setCompleted/patch clients)
    const sanitized = sanitizeSnapshotForApply(layouts[name], clients.map((c) => c.id))
    setSchedule(sanitized.schedule)
    setCompleted(new Set(sanitized.completed))
    setClients((prev) => prev.map((c) => {
      const patch = sanitized.clientPatches.get(c.id)
      return patch ? { ...c, priority: patch.priority, status: patch.status as ClientStatus, note: patch.note } : c
    }))
    onToastRef.current(`📂 Loaded "${name}"`)
  }

  const deleteLayout = (name: string) => {
    if (!name) return
    setLayouts(prev => { const n = { ...prev }; delete n[name]; return n })
    onToastRef.current(`🗑 Deleted layout "${name}"`)
  }

  const addClient = async (name: string): Promise<boolean> => {
    if (!name.trim()) return false
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) return false
      const nc = await res.json()
      const newClient: GridClient = { id: nc.id, name: nc.name, priority: 3, status: 'not_started', note: '' }
      setClients(prev => [...prev, newClient].sort((a, b) => a.name.localeCompare(b.name)))
      onToastRef.current(`+ Added "${newClient.name}"`)
      return true
    } catch { return false }
  }

  const removeClient = (id: number) => {
    // page.tsx:573-584 verbatim (optimistic update + background DELETE)
    setClients(prev => prev.filter(c => c.id !== id))
    setSchedule(prev => removeFromSchedule(prev, id))
    setCompleted(prev => { const n = new Set(prev); n.delete(id); return n })
    fetch(`/api/clients/${id}`, { method: 'DELETE' }).catch(() => { /* ignore */ })
  }

  const applyCsv = (rows: Record<string, string>[]) => {
    const result = applyCsvRows(rows, clients, schedule)
    if (result.clientUpdates.size > 0) {
      setClients(prev => prev.map(c => {
        const upd = result.clientUpdates.get(c.id)
        return upd ? { ...c, ...upd } : c
      }))
    }
    setSchedule(result.schedule)
    const msgs: string[] = []
    if (result.assignCount > 0) msgs.push(`Imported ${result.assignCount} assignment${result.assignCount !== 1 ? 's' : ''}`)
    if (result.unrecognized.length > 0) {
      msgs.push(`Unrecognized: ${result.unrecognized.slice(0, 3).join(', ')}${result.unrecognized.length > 3 ? ` +${result.unrecognized.length - 3} more` : ''}`)
    }
    onToastRef.current(msgs.join(' · ') || 'No data found in CSV')
  }

  return {
    clients, schedule, completed, slotsPerWeek, layouts, startDate,
    loaded, canPersist, saveState,
    assignedIds, unassigned, getClient, doneCount, totalClients, pct,
    setSlotsPerWeek: setSlots, setStartDate,
    setPriority, setStatus, saveNote, toggleDone,
    returnToPool, dropChip, assignHoveredToFrontier,
    autoDistribute, resetAll,
    saveLayout, applyLayout, deleteLayout,
    addClient, removeClient, applyCsv,
  }
}
```

The two `/* …page.tsx:N-M here… */` blocks are literal transplants — open the old file, copy the lines, replace `flash(` with `onToastRef.current(`. Nothing else changes inside them. The init effect references `STORAGE_KEY`, `parseStoredQuarterState`, `buildPlanPayload`, `applyPlanResponse`, `ClientStateMap`, `QuarterPlanGetResponse` — all imported above — and ends with the merged-clients block (`const merged: Client[]` → `const merged: GridClient[]`), `setCanPersist(persistAllowed)`, the `if (!persistAllowed) setSaveState('error')` line, then `skipFirstPersistRef.current = true` **before** `setLoaded(true)`.

- [ ] **Step 4: Run the hook tests**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run components/quarter-grid/useQuarterPlan.test.tsx
```
Expected: all PASS. If the generation-guard test flakes, the bug is in the transplant (seq must increment at scheduling time, page.tsx:405) — fix the transplant, not the test.

- [ ] **Step 5: Commit**

```bash
git add components/quarter-grid/useQuarterPlan.ts components/quarter-grid/useQuarterPlan.test.tsx
git commit -m "feat(quarter-grid): useQuarterPlan data hook — B3 init/persist plumbing under test (B4)"
```

---

### Task 5: `usePoolKeyboard`

**Files:**
- Create: `components/quarter-grid/usePoolKeyboard.ts`

- [ ] **Step 1: Implement (the page.tsx:209–261 effect, re-wired to hook actions)**

```ts
// components/quarter-grid/usePoolKeyboard.ts
'use client'

// Pool-chip keyboard shortcuts (page.tsx:209-261 moved in B4):
//   1–5    → set priority (chip stays in pool)
//   Space  → assign to the next open frontier slot, pre-select the next chip
// Deps are [hoveredPoolChipId] ONLY, verbatim — setPriority and
// assignHoveredToFrontier MUST be stable useCallbacks (they are, in
// useQuarterPlan) or this effect captures stale closures.

import { useEffect } from 'react'

export function usePoolKeyboard(opts: {
  hoveredPoolChipId: number | null
  setHoveredPoolChipId: (id: number | null) => void
  setPriority: (id: number, p: number) => void
  assignHoveredToFrontier: (id: number) => number | null
  onToast: (msg: string) => void
}) {
  const { hoveredPoolChipId, setHoveredPoolChipId, setPriority, assignHoveredToFrontier, onToast } = opts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!hoveredPoolChipId) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return

      // 1–5: set priority
      if (/^[1-5]$/.test(e.key)) {
        e.preventDefault()
        const priority = parseInt(e.key, 10)
        setPriority(hoveredPoolChipId, priority)
        onToast(`P${priority}`)
        return
      }

      // Space: assign to frontier; pre-select next chip so the user can keep going
      if (e.key === ' ') {
        e.preventDefault()
        const next = assignHoveredToFrontier(hoveredPoolChipId)
        setHoveredPoolChipId(next)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [hoveredPoolChipId]) // eslint-disable-line react-hooks/exhaustive-deps
}
```

(The `→ Wk N` toast now fires inside `assignHoveredToFrontier`; same message, same tick. `P{n}` fires here because the old handler flashed it inline.)

- [ ] **Step 2: Write `components/quarter-grid/usePoolKeyboard.test.tsx`** (stale-closure guard)

```tsx
// @vitest-environment jsdom
// components/quarter-grid/usePoolKeyboard.test.tsx
import { renderHook, cleanup } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { usePoolKeyboard } from './usePoolKeyboard'

afterEach(cleanup)

const opts = (hoveredPoolChipId: number | null) => ({
  hoveredPoolChipId,
  setHoveredPoolChipId: vi.fn(),
  setPriority: vi.fn(),
  assignHoveredToFrontier: vi.fn(() => 42),
  onToast: vi.fn(),
})

describe('usePoolKeyboard', () => {
  it('1–5 sets priority on the hovered chip and toasts', () => {
    const o = opts(7)
    renderHook(() => usePoolKeyboard(o))
    fireEvent.keyDown(window, { key: '3' })
    expect(o.setPriority).toHaveBeenCalledWith(7, 3)
    expect(o.onToast).toHaveBeenCalledWith('P3')
  })

  it('Space assigns to frontier and hands the next id to setHoveredPoolChipId', () => {
    const o = opts(7)
    renderHook(() => usePoolKeyboard(o))
    fireEvent.keyDown(window, { key: ' ' })
    expect(o.assignHoveredToFrontier).toHaveBeenCalledWith(7)
    expect(o.setHoveredPoolChipId).toHaveBeenCalledWith(42)
  })

  it('does nothing when no chip is hovered or focus is in a form field', () => {
    const o = opts(null)
    renderHook(() => usePoolKeyboard(o))
    fireEvent.keyDown(window, { key: '3' })
    expect(o.setPriority).not.toHaveBeenCalled()

    const o2 = opts(7)
    renderHook(() => usePoolKeyboard(o2))
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: '3' })
    expect(o2.setPriority).not.toHaveBeenCalled()
    input.remove()
  })
})
```

- [ ] **Step 3: Run, typecheck, commit**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run components/quarter-grid/usePoolKeyboard.test.tsx
npx tsc --noEmit
git add components/quarter-grid/usePoolKeyboard.ts components/quarter-grid/usePoolKeyboard.test.tsx
git commit -m "feat(quarter-grid): usePoolKeyboard hook + tests (B4)"
```

---

### Task 6: `NoteModal` + `LayoutManager` (+ tests)

**Files:**
- Create: `components/quarter-grid/NoteModal.tsx`
- Create: `components/quarter-grid/LayoutManager.tsx`
- Create: `components/quarter-grid/LayoutManager.test.tsx`
- Create: `components/quarter-grid/NoteModal.test.tsx`

- [ ] **Step 1: Implement `NoteModal.tsx`**

JSX from page.tsx:1314–1361 verbatim; `noteDraft` becomes local state synced from props (Codex fix #6):

```tsx
// components/quarter-grid/NoteModal.tsx
'use client'

import { useState, useEffect } from 'react'

interface NoteModalProps {
  id: number
  note: string
  clientName: string
  onSave: (id: number, note: string) => void
  onClose: () => void
}

export function NoteModal({ id, note, clientName, onSave, onClose }: NoteModalProps) {
  const [noteDraft, setNoteDraft] = useState(note)
  // Re-sync when another chip's note opens while the modal is mounted —
  // mirrors the old openNoteModal setting both states on every open.
  useEffect(() => { setNoteDraft(note) }, [id, note])

  const handleSave = () => { onSave(id, noteDraft.slice(0, 120)); onClose() }

  return (
    /* page.tsx:1315-1360 JSX verbatim, with these substitutions:
       - {clients.find(cl => cl.id === noteModal.id)?.name ?? 'Client'} → {clientName}
       - setNoteModal(null) (backdrop, ✕, Cancel) → onClose()
       - handleNoteSave → handleSave
       - textarea value/onChange stay on the local noteDraft */
  )
}
```

The page renders it as `{noteModal && <NoteModal id={noteModal.id} note={noteModal.note} clientName={getClient(noteModal.id)?.name ?? 'Client'} onSave={saveNote} onClose={() => setNoteModal(null)} />}` — same conditional-mount semantics as today.

- [ ] **Step 2: Implement `LayoutManager.tsx`**

JSX from page.tsx:868–905; `layoutName` + `activeLayout` move in as local state (Codex fix #1):

```tsx
// components/quarter-grid/LayoutManager.tsx
'use client'

import { useState } from 'react'
import type { Snapshots } from '@/lib/quarter-grid/state'

interface LayoutManagerProps {
  layouts: Snapshots
  saveLayout: (name: string) => void
  applyLayout: (name: string) => void
  deleteLayout: (name: string) => void
}

export function LayoutManager({ layouts, saveLayout, applyLayout, deleteLayout }: LayoutManagerProps) {
  const [layoutName, setLayoutName] = useState('')
  const [activeLayout, setActiveLayout] = useState('')

  const handleApply = (name: string) => {
    if (!name || !layouts[name]) return   // mirrors the hook's guard; '' = "— select —"
    applyLayout(name)
    setActiveLayout(name)
  }
  const handleDelete = () => {
    if (!activeLayout) return
    deleteLayout(activeLayout)
    setActiveLayout('')
  }
  const handleSave = () => {
    if (!layoutName.trim()) return
    saveLayout(layoutName)
    setLayoutName('')
  }

  return (
    /* page.tsx:869-905 JSX verbatim:
       - select value={activeLayout} onChange={e => handleApply(e.target.value)}
       - delete button onClick={handleDelete}
       - input value={layoutName} onChange / onKeyDown Enter → handleSave()
       - save button onClick={handleSave} disabled={!layoutName.trim()} */
  )
}
```

- [ ] **Step 3: Write the component tests**

`components/quarter-grid/LayoutManager.test.tsx` (required — deliberate state relocation):

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { LayoutManager } from './LayoutManager'

afterEach(cleanup)

const layouts = { plana: { schedule: {}, completed: [], clients: [] } }

describe('LayoutManager', () => {
  it('save button is disabled for a blank name and enabled otherwise; save clears the input', () => {
    const saveLayout = vi.fn()
    render(<LayoutManager layouts={{}} saveLayout={saveLayout} applyLayout={vi.fn()} deleteLayout={vi.fn()} />)
    const btn = screen.getByText('💾') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    const input = screen.getByPlaceholderText('save as layout…') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'q3' } })
    expect((screen.getByText('💾') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByText('💾'))
    expect(saveLayout).toHaveBeenCalledWith('q3')
    expect(input.value).toBe('')
  })

  it('selecting a layout calls applyLayout and shows the selection; delete clears it', () => {
    const applyLayout = vi.fn(), deleteLayout = vi.fn()
    render(<LayoutManager layouts={layouts} saveLayout={vi.fn()} applyLayout={applyLayout} deleteLayout={deleteLayout} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'plana' } })
    expect(applyLayout).toHaveBeenCalledWith('plana')
    expect(select.value).toBe('plana')
    fireEvent.click(screen.getByTitle('Delete this layout'))
    expect(deleteLayout).toHaveBeenCalledWith('plana')
    expect(select.value).toBe('')
  })

  it('selecting an unknown/empty option does not call applyLayout', () => {
    const applyLayout = vi.fn()
    render(<LayoutManager layouts={layouts} saveLayout={vi.fn()} applyLayout={applyLayout} deleteLayout={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    expect(applyLayout).not.toHaveBeenCalled()
  })
})
```

`components/quarter-grid/NoteModal.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NoteModal } from './NoteModal'

afterEach(cleanup)

describe('NoteModal', () => {
  it('saves the clamped draft and closes; close without save discards', () => {
    const onSave = vi.fn(), onClose = vi.fn()
    render(<NoteModal id={7} note="hello" clientName="Acme" onSave={onSave} onClose={onClose} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x'.repeat(200) } })
    fireEvent.click(screen.getByText('Save Note'))
    expect(onSave).toHaveBeenCalledWith(7, 'x'.repeat(120))
    expect(onClose).toHaveBeenCalled()
  })

  it('re-syncs the draft when the target chip changes while mounted', () => {
    const { rerender } = render(<NoteModal id={7} note="first" clientName="A" onSave={vi.fn()} onClose={vi.fn()} />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('first')
    rerender(<NoteModal id={8} note="second" clientName="B" onSave={vi.fn()} onClose={vi.fn()} />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('second')
  })
})
```

- [ ] **Step 4: Run, then commit**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run components/quarter-grid/LayoutManager.test.tsx components/quarter-grid/NoteModal.test.tsx
git add components/quarter-grid/NoteModal.tsx components/quarter-grid/LayoutManager.tsx components/quarter-grid/LayoutManager.test.tsx components/quarter-grid/NoteModal.test.tsx
git commit -m "feat(quarter-grid): NoteModal + LayoutManager components (B4)"
```

---### Task 7: `GridHeader` (controls + legend + CSV input)

**Files:**
- Create: `components/quarter-grid/GridHeader.tsx`

- [ ] **Step 1: Implement**

JSX from page.tsx:782–927 verbatim. Owns the hidden CSV input + FileReader + Papa parse (Codex fix #2); embeds `LayoutManager`:

```tsx
// components/quarter-grid/GridHeader.tsx
'use client'

import { useRef } from 'react'
import Papa from 'papaparse'
import { ALL_STATUSES, type Snapshots } from '@/lib/quarter-grid/state'
import type { SaveState } from './useQuarterPlan'
import { PCOLORS, STATUS_COLORS, STATUS_LABELS } from './theme'
import { LayoutManager } from './LayoutManager'

interface GridHeaderProps {
  totalClients: number
  doneCount: number
  unassignedCount: number
  pct: number
  loaded: boolean
  canPersist: boolean
  saveState: SaveState
  view: 'grid' | 'gantt'
  setView: (v: 'grid' | 'gantt') => void
  slotsPerWeek: number
  setSlotsPerWeek: (n: number) => void
  startDate: string
  setStartDate: (d: string) => void
  onAutoDistribute: () => void
  onReset: () => void
  onCsvRows: (rows: Record<string, string>[]) => void
  layouts: Snapshots
  saveLayout: (name: string) => void
  applyLayout: (name: string) => void
  deleteLayout: (name: string) => void
}

export function GridHeader(props: GridHeaderProps) {
  const csvInputRef = useRef<HTMLInputElement | null>(null)

  // page.tsx:617-627 + 689-693, minus the merge logic (now in the hook)
  const handleCsvFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result
      if (typeof text !== 'string') return
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim().toLowerCase(),
      })
      props.onCsvRows(parsed.data)
    }
    reader.readAsText(file)
  }
  const onCsvInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleCsvFile(file)
    e.target.value = '' // reset so same file can be re-imported
  }

  return (
    /* page.tsx:783-927 JSX verbatim with these substitutions:
       - state reads → props (totalClients, pct, doneCount, unassigned.length →
         props.unassignedCount, saveState, loaded, canPersist, view, slotsPerWeek,
         startDate, layouts)
       - setView(v) → props.setView(v); setSlots(n) → props.setSlotsPerWeek(n)
       - autoDistribute → props.onAutoDistribute; resetAll → props.onReset
       - setStartDate(e.target.value) → props.setStartDate(e.target.value)
       - the layouts <div>s (page.tsx:868-905) are REPLACED by
         <LayoutManager layouts={props.layouts} saveLayout={props.saveLayout}
           applyLayout={props.applyLayout} deleteLayout={props.deleteLayout} />
       - the hidden file input + Import CSV button (854-866) stay, wired to the
         local csvInputRef/onCsvInputChange above
       - legend block (909-926) verbatim */
  )
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/quarter-grid/GridHeader.tsx
git commit -m "feat(quarter-grid): GridHeader component (B4)"
```

---

### Task 8: `WeekGrid`, `PoolSection`, `AssignedSection`, `GanttView`

**Files:**
- Create: `components/quarter-grid/WeekGrid.tsx`
- Create: `components/quarter-grid/PoolSection.tsx`
- Create: `components/quarter-grid/AssignedSection.tsx`
- Create: `components/quarter-grid/GanttView.tsx`

All four are dumb JSX transplants. Shared prop bundles (declared per-file as local interfaces, per convention):

```ts
// Chip interaction props — identical names in all sections that render Chips:
//   onDragStart(e, id, fromWeek) / onDragEnd()
//   onToggleDone(id) / onSetPriority(id, p) / onReturn(id) / onSetStatus(id, status) / onOpenNote(id, note)
// Drag-state props: dragging: { id: number; fromWeek: number | null } | null
```

- [ ] **Step 1: `WeekGrid.tsx`** — page.tsx:932–1008

```tsx
interface WeekGridProps {
  schedule: ScheduleMap
  completed: Set<number>
  slotsPerWeek: number
  startDate: string
  dragging: { id: number; fromWeek: number | null } | null
  dropTarget: { week: number | string; slot: number } | null
  getClient: (id: number) => GridClient | undefined
  onDragOver: (e: React.DragEvent, week: number, slot: number) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, week: number, slot: number) => void
  /* + the Chip interaction props listed above */
}
```

`maxCols` moves in (page.tsx:737): `const maxCols = Math.max(slotsPerWeek, ...Array.from({ length: NUM_WEEKS }, (_, i) => (schedule[i + 1] || []).length))`. Week-range labels call `getWeekRange(startDate, week)` from grid-ops. JSX verbatim; `SLOT_LABELS` from theme.

- [ ] **Step 2: `PoolSection.tsx`** — page.tsx:1011–1128

```tsx
interface PoolSectionProps {
  unassigned: GridClient[]
  completed: Set<number>
  dragging: { id: number; fromWeek: number | null } | null
  hoveredPoolChipId: number | null
  setHoveredPoolChipId: (id: number | null) => void
  onPoolDragOver: (e: React.DragEvent) => void
  onPoolDrop: (e: React.DragEvent) => void
  onPoolDragLeave: () => void
  addClient: (name: string) => Promise<boolean>
  removeClient: (id: number) => void
  /* + the Chip interaction props */
}
```

`newClientName`/`addClientOpen` become local state. The submit handler becomes:
```tsx
const submit = async (e: React.FormEvent) => {
  e.preventDefault()
  if (await addClient(newClientName)) { setNewClientName(''); setAddClientOpen(false) }
}
```
(Today the form clears/closes only on POST success inside `addClient` — `addClient` returning `true` on success preserves that.) Pointer-move hover tracking (1074–1080), per-chip remove button (1111–1122), keyboard hint (1031–1035) all verbatim.

- [ ] **Step 3: `AssignedSection.tsx`** — page.tsx:1131–1175

```tsx
interface AssignedSectionProps {
  schedule: ScheduleMap
  clients: GridClient[]
  completed: Set<number>
  startDate: string
  assignedCount: number
  dragging: { id: number; fromWeek: number | null } | null
  /* + the Chip interaction props */
}
```
Renders `null` when `assignedCount === 0` (the page currently guards with `{assignedIds.size > 0 && …}` — keep the guard in the page OR inside the component; pick inside the component and pass `assignedCount`, page renders it unconditionally). Week-range via `getWeekRange(startDate, week)`.

- [ ] **Step 4: `GanttView.tsx`** — page.tsx:1181–1311 plus the gantt derivations (739–755)

```tsx
interface GanttViewProps {
  clients: GridClient[]
  schedule: ScheduleMap
  completed: Set<number>
  startDate: string
  unassignedCount: number
}
```
Internal (moved from page): `assignedIds` from schedule, `ganttClients` sort, `clientWeekMap`, `ROW_HEIGHT`/`GANTT_HEADER_H`/`GANTT_MAX_SCROLL_ROWS`. Colors from theme (`DONE_COLORS`, `PCOLORS`, `STATUS_COLORS`, `STATUS_LABELS`). JSX verbatim.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/quarter-grid/WeekGrid.tsx components/quarter-grid/PoolSection.tsx components/quarter-grid/AssignedSection.tsx components/quarter-grid/GanttView.tsx
git commit -m "feat(quarter-grid): WeekGrid, PoolSection, AssignedSection, GanttView components (B4)"
```

---

### Task 9: Rewrite `app/quarter-grid/page.tsx`

**Files:**
- Modify: `app/quarter-grid/page.tsx` (1365 LOC → ~220 LOC)

- [ ] **Step 1: Rewrite the page as composition**

```tsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuarterPlan } from '@/components/quarter-grid/useQuarterPlan'
import { usePoolKeyboard } from '@/components/quarter-grid/usePoolKeyboard'
import { GridHeader } from '@/components/quarter-grid/GridHeader'
import { WeekGrid } from '@/components/quarter-grid/WeekGrid'
import { PoolSection } from '@/components/quarter-grid/PoolSection'
import { AssignedSection } from '@/components/quarter-grid/AssignedSection'
import { GanttView } from '@/components/quarter-grid/GanttView'
import { NoteModal } from '@/components/quarter-grid/NoteModal'

export default function QuarterGridV3() {
  // UI-only state
  const [view, setView]             = useState<'grid' | 'gantt'>('grid')
  const [dragging, setDragging]     = useState<{ id: number; fromWeek: number | null } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ week: number | string; slot: number } | null>(null)
  const [toast, setToast]           = useState<string | null>(null)
  const [noteModal, setNoteModal]   = useState<{ id: number; note: string } | null>(null)
  const [hoveredPoolChipId, setHoveredPoolChipId] = useState<number | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = (msg: string) => {           // page.tsx:263-267 verbatim
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const plan = useQuarterPlan({ onToast: flash })

  usePoolKeyboard({
    hoveredPoolChipId, setHoveredPoolChipId,
    setPriority: plan.setPriority,
    assignHoveredToFrontier: plan.assignHoveredToFrontier,
    onToast: flash,
  })

  // Drag handlers (page.tsx:697-735) — drag state is page-owned; schedule
  // mutation goes through the hook.
  const onDragStart = (e: React.DragEvent, id: number, fromWeek: number | null) => {
    setDragging({ id, fromWeek })
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (e: React.DragEvent, week: number, slot: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget({ week, slot })
  }
  const onDragEnd = () => { setDragging(null); setDropTarget(null) }
  const onDrop = (e: React.DragEvent, targetWeek: number, targetSlot: number) => {
    e.preventDefault()
    if (!dragging) return
    plan.dropChip(dragging, targetWeek, targetSlot)
    setDragging(null)
    setDropTarget(null)
  }
  const onPoolDragOver = (e: React.DragEvent) => { e.preventDefault(); setDropTarget({ week: 'pool', slot: 0 }) }
  const onPoolDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (dragging?.fromWeek !== null && dragging) plan.returnToPool(dragging.id)
    setDragging(null)
    setDropTarget(null)
  }
  const onPoolDragLeave = () => setDropTarget(null)
  const onDragLeave = () => setDropTarget(null)

  const openNoteModal = useCallback((id: number, currentNote: string) => {
    setNoteModal({ id, note: currentNote })
  }, [])

  const chipHandlers = {
    onDragStart, onDragEnd,
    onToggleDone: plan.toggleDone,
    onSetPriority: plan.setPriority,
    onReturn: plan.returnToPool,
    onSetStatus: plan.setStatus,
    onOpenNote: openNoteModal,
  }

  return (
    <div style={{ /* page.tsx:760 wrapper style verbatim */ }}>
      <style>{` /* page.tsx:761-770 global CSS verbatim */ `}</style>
      {toast && ( /* page.tsx:773-780 toast div verbatim */ )}
      <GridHeader
        totalClients={plan.totalClients} doneCount={plan.doneCount}
        unassignedCount={plan.unassigned.length} pct={plan.pct}
        loaded={plan.loaded} canPersist={plan.canPersist} saveState={plan.saveState}
        view={view} setView={setView}
        slotsPerWeek={plan.slotsPerWeek} setSlotsPerWeek={plan.setSlotsPerWeek}
        startDate={plan.startDate} setStartDate={plan.setStartDate}
        onAutoDistribute={plan.autoDistribute} onReset={plan.resetAll}
        onCsvRows={plan.applyCsv}
        layouts={plan.layouts} saveLayout={plan.saveLayout}
        applyLayout={plan.applyLayout} deleteLayout={plan.deleteLayout}
      />
      {view === 'grid' && (
        <>
          <WeekGrid
            schedule={plan.schedule} completed={plan.completed}
            slotsPerWeek={plan.slotsPerWeek} startDate={plan.startDate}
            dragging={dragging} dropTarget={dropTarget} getClient={plan.getClient}
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
            {...chipHandlers}
          />
          <PoolSection
            unassigned={plan.unassigned} completed={plan.completed} dragging={dragging}
            hoveredPoolChipId={hoveredPoolChipId} setHoveredPoolChipId={setHoveredPoolChipId}
            onPoolDragOver={onPoolDragOver} onPoolDrop={onPoolDrop} onPoolDragLeave={onPoolDragLeave}
            addClient={plan.addClient} removeClient={plan.removeClient}
            {...chipHandlers}
          />
          <AssignedSection
            schedule={plan.schedule} clients={plan.clients} completed={plan.completed}
            startDate={plan.startDate} assignedCount={plan.assignedIds.size}
            dragging={dragging} {...chipHandlers}
          />
        </>
      )}
      {view === 'gantt' && (
        <GanttView
          clients={plan.clients} schedule={plan.schedule} completed={plan.completed}
          startDate={plan.startDate} unassignedCount={plan.unassigned.length}
        />
      )}
      {noteModal && (
        <NoteModal
          id={noteModal.id} note={noteModal.note}
          clientName={plan.getClient(noteModal.id)?.name ?? 'Client'}
          onSave={plan.saveNote} onClose={() => setNoteModal(null)}
        />
      )}
    </div>
  )
}
```

(`isoDate` and the page's local `Client`/`Schedule`/`Snapshots` type aliases die here — nothing imports them.)

- [ ] **Step 2: Confirm no placeholder comments remain in compiled files**

```bash
grep -rn "page.tsx:.*here…\|VERBATIM —\|JSX verbatim" components/quarter-grid lib/quarter-grid app/quarter-grid --include="*.ts" --include="*.tsx" | grep -v test
```
Expected: only descriptive comments that reference completed moves — no `/* …page.tsx:N-M here… */` placeholder blocks left unexpanded. If any remain, the transplant is incomplete.

- [ ] **Step 3: Verify everything**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npx vitest run
npm run build
git diff --color-moved=dimmed-zebra HEAD~6 -- app/quarter-grid/page.tsx components/quarter-grid lib/quarter-grid | less -R   # eyeball the moves
```
Expected: tsc clean, full suite green (1,909 + the new files' tests), build clean.

- [ ] **Step 4: Commit**

```bash
git add app/quarter-grid/page.tsx
git commit -m "refactor(quarter-grid): page becomes composition over useQuarterPlan + components — no behavior change (B4)"
```

---

### Task 10: Manual smoke (local dev)

- [ ] **Step 1: Start dev with the local DB and walk the spec's smoke list**

```bash
DATABASE_URL="file:./local-dev.db" npm run dev
```

In a browser (or via Playwright MCP) on `http://localhost:3000/quarter-grid`:
1. **Empty DB + no localStorage:** open the page, wait 5 s → network tab shows GET `/api/clients` + GET `/api/quarter-plan` and NOTHING else (no PUT, no import POST).
2. Seed `localStorage['seo-quarter-v3']` with a small payload (devtools), clear the `QuarterPlan` rows in `local-dev.db`, reload → import toast fires once; reload again → no second import (DB now has the plan).
3. Drag a chip from the pool onto an occupied week slot → swap works; displaced chip back in pool.
4. Layout save → apply → delete; toasts match the old strings.
5. Gantt toggle renders; footer pool count right.
6. Note modal: open, type >120 chars (clamped), Save; open another chip's note → draft re-syncs.
7. CSV import with a 2-row file (one matching, one unknown name) → toast `Imported 1 assignment · Unrecognized: …`.
8. Edit something → `● saving…` → `✓ saved`; reload → state persisted.
9. Hover a pool chip → press `3` (priority badge updates, toast `P3`), press Space (chip jumps to frontier week, next chip outlined).

- [ ] **Step 2: Fix anything found, re-run the suite, commit fixes**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run && npx tsc --noEmit
git add -A && git commit -m "fix(quarter-grid): smoke-test fixes (B4)"   # only if needed
```

---

### Task 11: PR, merge, deploy, production verification, docs close-out

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/quarter-grid-split
gh pr create --title "refactor(quarter-grid): B4 monolith split — useQuarterPlan hook + grid-ops + components" --body "$(cat <<'EOF'
## Summary
- Splits the 1,365-LOC quarter-grid page into `useQuarterPlan` (data hook), `usePoolKeyboard`, pure `lib/quarter-grid/grid-ops.ts`, and 8 focused components — **zero behavior change**.
- B3's persistence plumbing (canPersist gate, skip-first-persist, one-time import, debounced PUT + generation guard) is now unit-tested at the hook level, including the armed-import-window case (mere page-opens never write).
- Deletes dead `isoDate()`; no API/schema changes; localStorage still never written.

Spec: docs/superpowers/specs/2026-06-11-quarter-grid-split-design.md (Codex ×8)
Plan: docs/superpowers/plans/2026-06-11-quarter-grid-split.md

## Test plan
- [ ] grid-ops pure tests (drop swap, frontier, auto-distribute, CSV, week ranges)
- [ ] useQuarterPlan hook tests (init branches, import 409/failure, debounce, generation guard)
- [ ] Chip / LayoutManager / NoteModal component tests
- [ ] Full suite + tsc + build green
- [ ] Manual smoke per plan Task 10

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Merge after CI, deploy**

```bash
gh pr merge --squash --delete-branch    # or Kevin's preferred merge mode
git checkout main && git pull
ssh seo@144.126.213.242 "~/deploy.sh"
```

- [ ] **Step 3: Production verification**

```bash
# Boot clean
ssh seo@144.126.213.242 "pm2 logs seo-tools --lines 50 --nostream"
# Authed page + API checks. Do NOT extract APP_AUTH_PASSWORD into a shell
# argument (process-args/history leak). Run the login server-side via a
# script that reads the env itself:
ssh seo@144.126.213.242 'cd /home/seo/webapps/seo-tools && bash -s' <<'EOF'
set -a; source .env >/dev/null 2>&1; set +a
curl -s -c /tmp/b4jar -o /dev/null -X POST localhost:3000/api/auth/login -F password="$APP_AUTH_PASSWORD"
curl -s -b /tmp/b4jar -o /dev/null -w "quarter-grid %{http_code}\n" localhost:3000/quarter-grid
curl -s -b /tmp/b4jar localhost:3000/api/quarter-plan | head -c 300; echo
rm -f /tmp/b4jar
EOF
```
Record the `GET /api/quarter-plan` body BEFORE deploy and compare after a no-op page open: **identical** (mere opens still never write; if the import hasn't fired yet it must still be `{"plan":null}`).

- [ ] **Step 4: Docs close-out (improvement-roadmap handoff protocol)**

```bash
git mv docs/superpowers/specs/2026-06-11-quarter-grid-split-design.md docs/superpowers/archive/specs/
git mv docs/superpowers/plans/2026-06-11-quarter-grid-split.md docs/superpowers/archive/plans/
# Update tracker checkbox + status log; rewrite HANDOFF-improvement-roadmap.md for B5
git add -A && git commit -m "docs: B4 shipped — tracker [x] + status log, handoff → B5, B4 docs archived" && git push
```
End the session reply with the handoff doc's paste-in prompt in a code block.

---

## Self-review notes

- **Spec coverage:** every spec module (grid-ops, theme, useQuarterPlan, usePoolKeyboard, 8 components, page rewrite, isoDate deletion) has a task; all 8 Codex fixes are embodied (LayoutManager local state T6, GridHeader CSV ownership T7, armed-window + echo-save hook tests T4, keyboard stability contract T4/T5, NoteModal sync T6, vitest.config.mts conventions, LayoutManager tests required T6).
- **Type consistency:** `GridClient` defined once in grid-ops (alias of `SnapshotClient`); `SaveState` exported from useQuarterPlan; `ScheduleMap`/`Snapshots`/`ClientStatus` always from `lib/quarter-grid/state`.
- **JSX transplants** are specified by exact line ranges + substitution tables rather than re-printed (1,100 lines of inline styles); the engineer works with the old file open. `git diff --color-moved` is the review tool for those moves.
