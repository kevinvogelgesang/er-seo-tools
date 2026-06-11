# Quarter Grid Monolith Split — Design (B4)

**Date:** 2026-06-11 · **Tracker:** B4 (roadmap doc `04-clients-and-quarter-grid.md` § Phase 3)
**Branch:** `feat/quarter-grid-split`

## Goal

Break the 1,365-LOC `app/quarter-grid/page.tsx` into a `useQuarterPlan` data
hook, pure grid-operation helpers, and focused components — **zero behavior
change**. This is pure structure: every fetch, debounce, guard, toast message,
keyboard shortcut, and pixel of inline styling stays identical. The payoff is
testability: B3's init/persist plumbing (`canPersist`, skip-first-persist,
one-time import) is currently untestable inside the monolith; after the split
the hook gets unit tests and the drag/distribute/CSV logic gets pure-function
tests.

## Non-goals

- No visual or behavioral changes (the inline-style dark theme stays as-is;
  no Tailwind conversion, no dark-mode-class migration — this page predates
  the app's theme system and converting it is not B4).
- No state-model rewrite (no `useReducer`, no context). The hook keeps the
  exact `useState`/`useRef`/`useEffect` shape B3 shipped, because the
  persist-effect semantics (deps array → debounced PUT, skip-first-persist
  ref handshake) are load-bearing and subtle.
- No API or schema changes. No changes to `lib/quarter-grid/state.ts` or
  `persist.ts` beyond re-exporting types if needed.
- v1/v2/v3 redirect routes untouched.

## Approaches considered

1. **Minimal split** — hook + 3 big components (Header, GridView, GanttView).
   Fewer files, but the header stays a 150-line prop-soup component and the
   drag/CSV logic stays untested inside the hook. Doesn't deliver the
   testability goal for drag logic.
2. **Full split (chosen)** — `useQuarterPlan` hook + pure `grid-ops.ts`
   helpers + ~8 focused components + a keyboard hook. Matches the roadmap
   wording ("grid/pool/chip/layout-manager components, and keyboard
   handling") and the B1/B2 component-granularity convention. Pure functions
   carry the trickiest logic (drop slot-swap, frontier assign,
   auto-distribute, CSV merge) so the highest-risk code gets the cheapest
   tests.
3. **Reducer rewrite** — `useReducer` with action types. Cleaner long-term but
   changes state-update timing/batching characteristics and would force
   re-verifying every B3 persistence invariant from scratch. Rejected:
   "no behavior change" is the contract.

## Target structure

```
lib/quarter-grid/
  state.ts            (unchanged)
  persist.ts          (unchanged)
  grid-ops.ts         NEW — pure, client-safe schedule/CSV/date helpers
  grid-ops.test.ts    NEW

components/quarter-grid/        NEW directory (mirrors components/ada-audit/)
  theme.ts            NEW — PCOLORS, STATUS_COLORS, STATUS_LABELS, SLOT_LABELS,
                      done-chip colors; pure constants, no React
  useQuarterPlan.ts   NEW — the data hook (load/save/derive + all mutations)
  useQuarterPlan.test.tsx NEW
  usePoolKeyboard.ts  NEW — pool-chip keyboard shortcuts (1–5, Space)
  Chip.tsx            NEW — moved verbatim from page.tsx
  Chip.test.tsx       NEW
  GridHeader.tsx      NEW — title/progress/save-indicator + controls + legend
  LayoutManager.tsx   NEW — layout select/apply/delete + save-as input
  WeekGrid.tsx        NEW — 13 week rows × slot drop-zones
  PoolSection.tsx     NEW — unassigned pool, add/remove client, hover wiring
  AssignedSection.tsx NEW — assigned-by-week chip recap
  GanttView.tsx       NEW — gantt rows + footer
  NoteModal.tsx       NEW

app/quarter-grid/
  page.tsx            SHRINKS to composition + UI-only state (~250–350 LOC)
```

Naming/conventions: hooks live beside their tool's components
(`components/ada-audit/useChecks.ts` precedent). Components define **local
prop interfaces** (B1/B2 convention) and reuse types from
`lib/quarter-grid/state.ts` (`ClientStatus`, `ScheduleMap`, `Snapshots`,
`ALL_STATUSES`, `NUM_WEEKS`) instead of redeclaring them. The page's local
`type Client`, `type Schedule`, `type Snapshots` duplicates collapse onto the
lib types; the page-level `Client` row shape (`{ id, name, priority, status,
note }`) moves to `grid-ops.ts` as `GridClient` (it's the working shape used
by ops, hook, and components — `SnapshotClient` in state.ts is the same shape
but semantically a snapshot record; `GridClient` aliases it).

## Module responsibilities

### `lib/quarter-grid/grid-ops.ts` (pure, no React)

Extracted verbatim from the page, each as a pure function returning new
objects (current code already treats state immutably):

- `removeFromSchedule(schedule, id): ScheduleMap` — strip an id from all weeks
  (shared by return-to-pool, drop, remove-client).
- `dropChipOnSlot(schedule, drag: {id, fromWeek}, targetWeek, targetSlot): ScheduleMap`
  — the `onDrop` body: occupied-slot swap (displaced chip returns to the
  drag's source week), pad-with-0/append semantics, final falsy-filter pass.
- `assignToFrontier(schedule, id, slotsPerWeek): { schedule: ScheduleMap; targetWeek: number }`
  — the Space-key logic: last week with chips → fill its open slot, else
  next week (capped at `NUM_WEEKS`).
- `nextPoolChipId(clients, schedule, justAssignedId): number | null` — the
  Space-key follow-up selection (priority then name sort, excluding assigned).
- `autoDistributeSchedule(clients, slotsPerWeek): ScheduleMap` — both branches
  (3/wk uniform; 2/wk with heavy weeks {1,4,7,11} capped at 3).
- `applyCsvRows(rows, clients, schedule): { schedule; clientUpdates: Map<number, Partial<GridClient>>; assignCount; unrecognized: string[] }`
  — the CSV merge: case-insensitive name match, week/priority clamps, status
  normalization, reassignment semantics. (Papa parsing + FileReader live in
  `GridHeader`, which calls `onCsvRows(parsedRows)`; this takes parsed rows
  and `useQuarterPlan.applyCsv` owns the state mutation.)
- `getWeekRange(startDate, weekNum): string | null` — `M/D–M/D` label.
- `sortPool(clients, assignedIds): GridClient[]` — priority-then-name sort of
  unassigned clients (used by pool render and `nextPoolChipId`).

The page's unused `isoDate()` helper (defined, never referenced) is **deleted**
— the only intentional code removal in B4.

### `components/quarter-grid/useQuarterPlan.ts`

Owns all persisted/derived state and every effect that touches the network.
Moves verbatim from the page: the init effect (clients fetch → plan GET →
one-time localStorage import with 409/failed-GET/failed-import branches),
`canPersist` + `skipFirstPersistRef` semantics, the debounced 800 ms PUT with
scheduling-time generation guard, the pagehide keepalive flush, the
`scheduleRef`/`clientsRef`/`slotsPerWeekRef` mirrors, and timer cleanup.

```ts
function useQuarterPlan(opts: { onToast: (msg: string) => void }): {
  // state (read)
  clients: GridClient[]; schedule: ScheduleMap; completed: Set<number>
  slotsPerWeek: number; layouts: Snapshots; startDate: string
  loaded: boolean; canPersist: boolean
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  // derived
  assignedIds: Set<number>; unassigned: GridClient[]
  doneCount: number; totalClients: number; pct: number
  getClient(id: number): GridClient | undefined
  // mutations (each is the page handler moved verbatim, incl. its flash())
  setSlotsPerWeek(n: number): void
  setStartDate(d: string): void
  setPriority(id: number, p: number): void
  setStatus(id: number, status: ClientStatus): void
  saveNote(id: number, note: string): void
  toggleDone(id: number): void
  returnToPool(id: number): void
  dropChip(drag: { id: number; fromWeek: number | null }, week: number, slot: number): void
  assignHoveredToFrontier(id: number): number | null // Space key: frontier
                                              // assign + flash; returns the next
                                              // pool chip id to pre-select
  autoDistribute(): void
  resetAll(): void
  saveLayout(name: string): void
  applyLayout(name: string): void
  deleteLayout(name: string): void
  addClient(name: string): Promise<boolean>   // true = created (page closes the form)
  removeClient(id: number): void
  applyCsv(rows: Record<string, string>[]): void
}
```

Toast plumbing: the hook receives `onToast` and calls it with the **exact
current strings** (`⚡ Auto-distributed across 13 weeks`,
`💾 Saved layout "…"`, `⬆ Imported quarter plan from this browser`,
`⚠ Save failed — will retry on next change`, etc.). The toast state +
auto-dismiss timer stay in the page.

Space-key next-chip pre-selection: `assignHoveredToFrontier` needs to hand
the *next* hovered id back to the page (hover state is page-owned). It takes
shape `assignHoveredToFrontier(id): number | null` — performs the schedule
update + flash, returns `nextPoolChipId(...)` computed against the
**pre-update** schedule refs plus the just-assigned id, exactly as today
(page.tsx:249–255); the keyboard hook assigns the return value to
`setHoveredPoolChipId`.

**Handler stability contract:** `setStatus` and `openNoteModal` keep their
`useCallback` wrappers (the memoized `Chip` depends on stable handler
identities; the rest stay plain functions re-created per render, same as
now). Additionally, `setPriority` and `assignHoveredToFrontier` become
stable `useCallback`s **because `usePoolKeyboard`'s effect depends only on
`[hoveredPoolChipId]`** (verbatim from today) — unstable function props
would be captured stale by that effect. `assignHoveredToFrontier` reads
`scheduleRef`/`clientsRef`/`slotsPerWeekRef` (not state) inside the
callback, matching the current effect's ref-based reads, so a stable
identity is safe.

`activeLayout` and `layoutName` are leaf UI state read only by the layout
controls — **both move into `LayoutManager` as local state**; the hook's
`saveLayout`/`applyLayout`/`deleteLayout` take the name as an argument.

### `usePoolKeyboard.ts`

The window `keydown` effect, verbatim: input/textarea/select guard, `1–5` →
`setPriority` + flash `P{n}`, Space → `assignHoveredToFrontier` + hover
hand-off. Signature:

```ts
usePoolKeyboard(opts: {
  hoveredPoolChipId: number | null
  setHoveredPoolChipId: (id: number | null) => void
  setPriority: (id: number, p: number) => void
  assignHoveredToFrontier: (id: number) => number | null
  onToast: (msg: string) => void
})
```

### Components

All presentational; state and handlers arrive as props. Inline styles move
with their JSX untouched. Local prop interfaces per convention.

- **`Chip.tsx`** — the existing `memo` component, verbatim (status-dot cycle,
  done checkbox, note pencil, priority select, return-×). Imports colors from
  `theme.ts`.
- **`GridHeader.tsx`** — header card: title + save-state indicator + progress
  bar, view toggle, slots toggle, Auto-Distribute, start-date input, Reset,
  Import CSV button (owns the hidden file input + `csvInputRef` + Papa parse
  → `onCsvRows` callback up), legend row. Embeds `LayoutManager`.
- **`LayoutManager.tsx`** — layout `<select>`, delete button, save-as input +
  button. `layoutName` and `activeLayout` move in as local state (see hook
  section — nothing outside the layout UI reads either). It receives
  `layouts` plus `saveLayout(name)`/`applyLayout(name)`/`deleteLayout(name)`
  props; toast strings come from the hook, so the component stays dumb.
  Delete clears the local `activeLayout` selection, as today.
- **`WeekGrid.tsx`** — column headers + 13 week rows with drop-zone cells;
  receives `schedule`, `completed`, `maxCols`, `dropTarget`, `dragging`,
  `getClient`, `getWeekRange` results, and the drag/chip handler bundle.
- **`PoolSection.tsx`** — unassigned header (count badge, keyboard hint,
  add-client form/button), pool chip grid with `data-pool-chip` pointer
  tracking and per-chip remove button. Owns `newClientName`/`addClientOpen`
  local state (UI-only, nothing else reads them); calls `addClient(name)`.
- **`AssignedSection.tsx`** — the assigned-by-week recap rows.
- **`GanttView.tsx`** — gantt header/rows/footer incl. the row-height /
  scroll constants.
- **`NoteModal.tsx`** — modal incl. the 120-char draft handling. Owns
  `noteDraft` local state; receives `{ id, note, clientName }` + `onSave`/
  `onClose`. (`noteModal` open-state stays in the page since `Chip` handlers
  open it.) Draft synchronization is explicit: the local draft
  initializes/re-syncs from props via `useEffect` on `[id, note]` — opening
  another chip's note while the modal is mounted must reset the draft,
  matching today's `openNoteModal` setting both states on every open.
  Clamps to 120 chars on save; closing without Save discards the draft.

### `app/quarter-grid/page.tsx` (after)

UI-only state: `view`, `dragging`, `dropTarget`, `toast` (+ timer + `flash`),
`noteModal`, `hoveredPoolChipId`. Calls `useQuarterPlan({ onToast: flash })`
and `usePoolKeyboard(...)`. Derivations used by exactly one component move
into that component: `maxCols` into `WeekGrid`; `ganttClients`,
`clientWeekMap`, and the row-height/scroll constants into `GanttView`.
Renders: global `<style>` block + toast + `GridHeader` + (`WeekGrid` +
`PoolSection` + `AssignedSection` | `GanttView`) + `NoteModal`.

Drag state stays in the page because grid, pool, and assigned sections all
participate (drop on pool = return; `isDragging` dims the chip everywhere).

## Testing

Conventions (per `vitest.config.mts`: node environment by default,
`globals: false`, `fileParallelism: false`): `@vitest-environment jsdom`
pragma for component/hook tests, `afterEach(cleanup)` (no auto-cleanup),
local mocks via `vi.stubGlobal('fetch', …)` + fake timers for the debounce.

1. **`grid-ops.test.ts`** (pure):
   - `dropChipOnSlot`: drop into empty slot / occupied slot (swap returns
     displaced chip to source week) / from pool onto occupied (displaced chip
     dropped from grid? — no: today a pool-sourced drag with `fromWeek=null`
     overwrites the slot and the displaced chip silently leaves the schedule
     back to the pool; assert exactly that) / slot index beyond current
     length (append) / padding-filter behavior.
   - `assignToFrontier`: empty schedule → week 1; open slot in last
     populated week; full last week → next week; week-13 cap.
   - `autoDistributeSchedule`: 3/wk chunking; 2/wk heavy-week caps; priority
     then name ordering.
   - `applyCsvRows`: name matching, clamps, status normalization,
     reassignment removes prior week, unrecognized accumulation, dedupe.
   - `getWeekRange`: valid date math incl. month boundary; empty/garbage
     startDate → null.
   - `nextPoolChipId` / `sortPool` ordering.
2. **`useQuarterPlan.test.tsx`** (renderHook) — the B3 plumbing finally under
   test:
   - init: DB plan exists → hydrated state, `canPersist` true, **no PUT
     fires after init** (skip-first-persist; advance timers, assert zero
     PUT calls).
   - init: **confirmed-empty DB + no localStorage → zero import POSTs and
     zero PUTs after advancing timers** (the armed-import-window case:
     mere page-opens never write).
   - init: empty DB + localStorage payload → exactly one import POST, toast
     string, hydrate from import response, `canPersist` true, **and zero
     PUTs after advancing timers** (import success must not echo-save).
   - import 409 → re-GET and hydrate from DB.
   - import non-409 failure → local data shown, `canPersist` false, no PUT
     on subsequent edits.
   - clients fetch fails → `canPersist` false even with plan GET ok.
   - plan GET fails → localStorage rendered read-only, no import attempted.
   - edit after load → exactly one PUT after 800 ms (fake timers), payload
     matches `buildPlanPayload`, `saveState` saving→saved.
   - PUT failure → `saveState` error + toast.
   - generation guard: edit A in flight, edit B before A resolves → A's
     response does not mark "saved".
   - `addClient` POST + sort; `removeClient` optimistic update + DELETE.
3. **`Chip.test.tsx`**: status dot cycles in `ALL_STATUSES` order, checkbox
   fires `onToggleDone`, priority select fires `onSetPriority`, `×` renders
   only when `fromWeek != null` and fires `onReturn`, note pencil fires
   `onOpenNote`.
4. **`LayoutManager.test.tsx`** (required — the state relocation is a
   deliberate change): save button disabled for blank name; select fires
   `applyLayout(name)` and shows the selected value; delete fires
   `deleteLayout(name)` and clears the local selection.
5. Optional (cheap): `NoteModal` 120-char clamp + draft re-sync when the
   target chip changes.

No quarter-plan **API** tests change; the singleton-file rule
(`app/api/quarter-plan/route.test.ts`) is untouched.

## Verification (no-behavior-change evidence)

- `npx tsc --noEmit`, full vitest suite, `npm run build` — all green.
- Implementation checks (Codex review): persist-effect deps moved exactly;
  `skipFirstPersistRef.current = true` set **before** `setLoaded(true)` in
  the hook init (ordering is the handshake); pagehide listener registered
  once with cleanup; Space-key next-chip computed against pre-update refs.
- Manual smoke on local dev (`DATABASE_URL="file:./local-dev.db"`): open
  with empty DB + no localStorage (no writes), open with a localStorage
  payload (import path), drag works incl. pool-drag onto an occupied slot,
  layout save/apply/delete, gantt toggle, note modal, CSV import, save
  indicator transitions, reload persistence.
- Post-deploy: `/quarter-grid` 200 authed; `GET /api/quarter-plan` payload
  unchanged before vs after a no-op page open (mere opens still never write).
- ⚠ B3's human step (Kevin's one-time browser import) may still be pending —
  the refactor preserves the import path byte-for-byte, and B4 must deploy
  without disturbing the armed import window (no writes on page open is the
  invariant to re-verify in production).

## Risks

- **Persist-effect deps drift.** The debounced-save effect's dependency list
  `[clients, schedule, completed, slotsPerWeek, layouts, startDate, loaded,
  canPersist]` must move into the hook unchanged; adding/removing a dep
  changes save timing. Mitigated by the hook test asserting one-PUT-per-edit
  and zero-PUT-on-open.
- **Handler identity.** `setStatus` and `openNoteModal` keep their
  `useCallback`s for `memo(Chip)` parity; `setPriority` and
  `assignHoveredToFrontier` gain stable `useCallback` identities because
  `usePoolKeyboard`'s effect (deps `[hoveredPoolChipId]` only, verbatim)
  would otherwise capture stale closures — see the handler stability
  contract in the hook section. Chip re-renders are a perf detail, not
  correctness, but we keep parity anyway.
- **State relocation (layoutName, noteDraft, newClientName → child
  components).** These are leaf UI states nothing else reads (verified by
  grep during implementation); relocation is observationally identical.
- **JSX transplant typos.** Inline styles move in large verbatim blocks;
  `git diff --color-moved` review + visual smoke catch transposition errors.
