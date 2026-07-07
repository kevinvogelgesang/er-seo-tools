# A8 PR 3 — Homepage Widget Editor — Implementation Plan

**Date:** 2026-07-07 · **Spec:** `docs/superpowers/specs/2026-07-07-app-shell-redesign-design.md` §3.3
**Tracker item:** A8 (app-shell redesign), PR 3 of the phasing in spec §8
**Branch:** `feat/app-shell-pr3` (worktree, based on `origin/main` @ `c7ee2d9`)
**Class:** Feature + UI change (dark-mode variants + no-hydration-mismatch required)
**Codex review:** applied — fixes 2–10 below (fix 1 was a sandbox-cwd artifact; the file
now lives in the worktree). Codex verdict: accept-with-named-fixes, not rewrite.

## What ships

PR 2 shipped a **fixed** dashboard: `app/(app)/page.tsx` renders `<DashboardGrid/>`
which maps a hard-coded `DEFAULT_LAYOUT` (registry) → `spanClass` → `WidgetErrorBoundary`
→ `WidgetFrame` → live `Component`. PR 3 makes the grid **stateful and editable**:

- A **"Customize"** button toggles edit mode.
- In edit mode each widget gets a **size stepper** (cycles that widget's supported
  sizes) and a **drag handle** (native HTML5 DnD, Quarter-Grid pattern); dropping onto
  another tile reorders the layout array; the CSS grid auto-flows the new order.
- **Keyboard fallback (Codex fix 8 / spec fix 8):** each widget also renders **move-up /
  move-down** buttons so reordering never requires a pointer.
- **"Reset layout"** restores `DEFAULT_LAYOUT`.
- Layout persists to `localStorage('er-home-layout')` =
  `{ version: 1, items: [{ id, size }] }` in display order.
- **Order + size only** — no free-form x/y. Grid auto-flow does the packing.
- **Desktop-only editing** in v1 (via CSS, not JS width checks — Codex fix 6); mobile
  inherits the chosen order/size of that browser.

PR 3 **does not** rebuild any widget, touch data sources, or add aggregate widgets
(KPI strip / Needs-attention are PR 3.5, gated on B1/B2 loader verification).

## Architecture

Three new units + one modified component. The **pure layout module is the spine**
(spec §7): everything stateful delegates to it, and it is fully unit-tested with no
React or DOM.

### 1. `lib/widgets/layout.ts` (pure — the spine)

No React, no `window`, **no import of `registry.tsx`** (that file imports live React
components — importing it would make this module impure and can break the non-jsdom
test env). Instead all helpers take a narrow metadata array (**Codex fix 3**):

```ts
import type { LayoutItem, WidgetSize, WidgetDef } from './types'

// Narrow view of the registry — only the fields layout logic needs. Proves at the
// type level that Component is never touched here.
export type WidgetMeta = Pick<WidgetDef, 'id' | 'sizes' | 'defaultSize'>

export const LAYOUT_STORAGE_KEY = 'er-home-layout'
export const LAYOUT_VERSION = 1
const ALL_SIZES: readonly WidgetSize[] = ['sm', 'wide', 'lg', 'xl']  // real-WidgetSize guard (Codex fix 9)

// Load-time reconciler. Registry is authoritative. Returns a NEW array; never
// mutates inputs (incl. DEFAULT_LAYOUT) (Codex fix 9):
//  - drop ids not in `widgets`                              (unknown-id drop)
//  - drop duplicate ids (keep first occurrence)
//  - drop items whose size is not a real WidgetSize          (garbage-size guard)
//  - clamp: an item whose size ∉ widget.sizes → widget.defaultSize
//  - append every registered widget missing from `items`, at defaultSize,
//    in `widgets` (registry) order
normalizeLayout(items: LayoutItem[], widgets: WidgetMeta[]): LayoutItem[]

// Parse a raw localStorage string into a clean layout.
//  - null / malformed JSON / wrong shape (items not array) → normalizeLayout(defaultLayout, …)
//  - parsed.version !== LAYOUT_VERSION → normalizeLayout(defaultLayout, …)  (version-bump reset)
//  - else → normalizeLayout(parsed.items, widgets)
loadLayout(raw: string | null, widgets: WidgetMeta[], defaultLayout: LayoutItem[]): LayoutItem[]

serializeLayout(items: LayoutItem[]): string   // JSON.stringify({ version: LAYOUT_VERSION, items })

// Pure ops used by the reducer (each returns a NEW array, never mutates).
// reorder semantics enumerated per Codex fix 4:
reorderLayout(items, draggedId, targetId: string | null): LayoutItem[]
//  - draggedId missing → unchanged
//  - targetId null → append dragged to end
//  - targetId not found → unchanged (NOT append)
//  - draggedId === targetId → unchanged
//  - dragged already immediately before target → unchanged
//  - otherwise: remove dragged, compute target index IN THE REDUCED array, insert before it

moveItem(items, id, dir: 'up' | 'down'): LayoutItem[]   // swap with neighbor; clamp at ends; unknown id → unchanged
cycleSize(items, id, widgets): LayoutItem[]             // next size in widget.sizes wrapping; single-size → unchanged; current ∉ sizes → defaultSize; unknown id → unchanged

// The reducer the hook drives. Factory binds registry meta + default so actions
// stay data-only. All state transitions go through here (incl. hydrate).
type LayoutAction =
  | { type: 'hydrate'; items: LayoutItem[] }
  | { type: 'reorder'; draggedId: string; targetId: string | null }
  | { type: 'move'; id: string; dir: 'up' | 'down' }
  | { type: 'resize'; id: string }
  | { type: 'reset' }
createLayoutReducer(widgets: WidgetMeta[], defaultLayout: LayoutItem[]):
  (state: LayoutItem[], action: LayoutAction) => LayoutItem[]
```

`createLayoutReducer` delegates: `hydrate`→`normalizeLayout(action.items, widgets)`,
`reorder`→`reorderLayout`, `move`→`moveItem`, `resize`→`cycleSize`,
`reset`→`normalizeLayout(defaultLayout, widgets)` (defensive normalize keeps reset honest
if the registry drifts), unknown action → state unchanged.

### 2. `lib/widgets/use-home-layout.ts` (client hook — hydration-safe)

Owns the layout state + persistence. Hydration contract (per prompt + spec §9):
**server and first client paint render `DEFAULT_LAYOUT`**; localStorage is read only in
an effect, so server markup === first client markup (no mismatch). **Persistence is armed
only after hydration completes (Codex fix 2)** so the initial default can never overwrite a
stored layout — including under React StrictMode's double-invoked effects (the post-hydrate
persist is an idempotent rewrite of the just-read value).

```ts
const reducer = createLayoutReducer(WIDGETS, DEFAULT_LAYOUT)   // WIDGETS satisfies WidgetMeta[]

export function useHomeLayout() {
  const [layout, dispatch] = useReducer(reducer, DEFAULT_LAYOUT)
  const [hydrated, setHydrated] = useState(false)

  // 1. Post-mount: read + reconcile from localStorage (try/catch → keep default).
  useEffect(() => {
    let raw: string | null = null
    try { raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY) } catch { /* private mode / disabled */ }
    dispatch({ type: 'hydrate', items: loadLayout(raw, WIDGETS, DEFAULT_LAYOUT) })
    setHydrated(true)
  }, [])

  // 2. Persist ONLY after hydration (Codex fix 2). try/catch → quota/security safe.
  useEffect(() => {
    if (!hydrated) return
    try { window.localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(layout)) } catch { /* ignore */ }
  }, [layout, hydrated])

  return { layout, hydrated, dispatch }
}
```

`WIDGETS` (full `WidgetDef[]`) is assignable to `WidgetMeta[]` structurally, so the hook
passes the real registry without duplicating metadata.

### 3. `components/widgets/EditableWidgetTile.tsx` (edit-mode tile chrome)

Renders ONE widget in edit mode. **Reuses `WidgetFrame`** with the same `title`, grid span
(the parent's `spanClass` div is unchanged), height, and dark-mode treatment (**Codex fix
7**) so the editor reflects real packing. It **suppresses the live widget body** and shows a
lightweight placeholder (size label) instead — rationale: (a) no queue-poll / fetch churn
(live `useQueueStatus` subscribers correctly unsubscribe while editing), (b) no accidental
quick-start form submits, (c) clean drag surface. Size is communicated by the tile's grid
span regardless, so a live body adds nothing during editing.

Uses `WidgetFrame`'s existing `action` slot for the per-widget controls:

- **Drag handle** (Codex fix 5): a small grip element in the `action` slot with
  `draggable`, `aria-label={`Reorder ${widget.title}`}`, `cursor-move` — **only the handle
  is draggable, not the whole tile**, so the size/move buttons never initiate a drag.
  `onDragStart` sets `dataTransfer.setData('text/plain', item.id)` +
  `dataTransfer.effectAllowed = 'move'`.
- **Size stepper** (Codex fix 10): button showing current size, `aria-label` announcing
  current + next size (e.g. `"Size: wide. Change to large"`); calls `onResize`. Rendered
  only when `widget.sizes.length > 1`.
- **Move buttons** (Codex fixes 8 + 10): **↑** (`onMove('up')`, `disabled={index===0}`,
  `aria-label={`Move ${widget.title} earlier`}`) and **↓** (`onMove('down')`,
  `disabled={index===total-1}`, `aria-label={`Move ${widget.title} later`}`).
- Drop-target ring when `isDropTarget`; full `dark:` variants.

Props: `{ item, widget, index, total, isDropTarget, onDragStart, onDragOver, onDrop,
onDragEnd, onDragLeave, onResize, onMove }`.

### 4. `components/widgets/DashboardGrid.tsx` (MODIFIED — becomes stateful)

- Calls `useHomeLayout()`.
- Owns `const [editing, setEditing] = useState(false)` and DnD transient state
  (`draggingId`, `dropTargetId`) — page-owned like Quarter Grid's `page.tsx`.
- **Control row** above the grid:
  - View mode: a single **"Customize"** button, right-aligned, `aria-pressed={editing}`
    (**Codex fix 10**), `className="hidden md:inline-flex …"` so it is **CSS-hidden on
    mobile** — no `window.innerWidth` read at render (**Codex fix 6**).
  - Edit mode: **"Reset layout"** (left) + **"Done"** (right), same `hidden md:*` gating.
- Grid container unchanged (`grid grid-cols-1 … lg:grid-cols-4 auto-rows-…`).
- Per item, inside the same `spanClass` div:
  - **View mode:** exactly the PR-2 render (`WidgetErrorBoundary` → `WidgetFrame` → live
    `Component`) — unchanged, so existing behavior/tests hold.
  - **Edit mode:** `<EditableWidgetTile … />`.
- DnD handlers mirror Quarter Grid (Codex fix 5): `onDragStart` sets `draggingId` +
  `setData` + `effectAllowed`; `onDragOver` `preventDefault()` + `dropEffect='move'` +
  `setDropTargetId`; `onDrop` `preventDefault()` + `dispatch({type:'reorder', draggedId,
  targetId})` + clear; `onDragEnd`/`onDragLeave` clear all transient state.
- **Trailing drop zone (edit mode only):** a thin "move to end" drop target after the last
  tile so DnD can reach the final position; dispatches `reorder` with `targetId: null`.
  (Keyboard already reaches the end via ↓.)
- `editing` starts `false` on both server and first paint; controls are static-labelled →
  no hydration mismatch.

No change to `app/(app)/page.tsx` — the grid stays self-contained.

## Hydration / persistence proof sketch

- **Server render:** `useHomeLayout` returns `DEFAULT_LAYOUT`, `hydrated=false`;
  `editing=false` → grid renders the 7 default tiles in view mode → identical to PR 2.
- **First client paint:** same (reducer initial state = `DEFAULT_LAYOUT`, effects not yet
  run) → markup matches server → no hydration warning.
- **After mount:** read effect dispatches `hydrate` (layout → stored) + `setHydrated(true)`
  → React re-renders (a normal post-hydration state update, not a render-time divergence).
  The persist effect fires with `hydrated=true` and idempotently rewrites the just-read
  value. **A stored layout is never overwritten by the default** because persist is gated
  on `hydrated`, which only flips true *after* the read (Codex fix 2 — guards StrictMode too).

## Testing (TDD, reducer-first)

Env conventions (verified against PR-2 tests): pure modules → plain vitest; hooks/components
→ `// @vitest-environment jsdom` + `@testing-library/react` (`render`/`renderHook`/`screen`/
`waitFor`/`cleanup`), `afterEach(cleanup)`. **localStorage mock:** reuse the in-memory
`Map`-backed `localStorageMock` + `vi.stubGlobal('localStorage', …)` pattern from
`components/shell/AppShell.test.tsx` (Codex fix 8 — jsdom here exposes no working
localStorage). Run with `DATABASE_URL="file:./local-dev.db" npm test` (house convention).

## Tasks (each: failing test → implement → green)

### Task 1 — Pure layout module (`lib/widgets/layout.ts` + `layout.test.ts`) — THE SPINE
Write `layout.test.ts` first, covering every branch:
- `normalizeLayout`: drops unknown id; drops duplicate id (keeps first); drops a
  non-`WidgetSize` garbage size; clamps a size ∉ `widget.sizes` to `defaultSize`; appends a
  missing registered widget at `defaultSize` in registry order; a valid layout returns
  unchanged (order preserved); **does not mutate the input array or `DEFAULT_LAYOUT`**
  (assert referential newness + input untouched).
- **Registry-evolution (Codex fix 9):** a stored layout predating a newly-registered widget
  appends the new widget at its default size.
- `loadLayout`: `null` → default; malformed JSON → default; wrong shape (`items` missing /
  not array) → default; `version` mismatch → default (version-bump reset); valid
  current-version payload → normalized items; unknown ids inside a valid payload dropped.
- `serializeLayout`: round-trips (`loadLayout(serializeLayout(x), …)` deep-equals
  `normalizeLayout(x, …)`); always stamps `version: LAYOUT_VERSION`.
- `reorderLayout` (Codex fix 4): move forward; move backward; `draggedId` missing → no-op;
  `targetId` null → append; `targetId` not found → no-op (not append); `draggedId ===
  targetId` → no-op; dragged already immediately before target → no-op.
- `moveItem`: up; down; up at index 0 → no-op; down at last → no-op; unknown id → no-op.
- `cycleSize`: next supported size; wrap last→first; single-size widget → no-op; current ∉
  sizes → `defaultSize`; unknown id → no-op.
- `createLayoutReducer`: each action routes to the right op; `hydrate` normalizes incoming
  items; `reset` returns a normalized copy of `defaultLayout`; unknown action → state unchanged.
Then implement `layout.ts` to green. **Gate: `npm run lint` + this file's tests.**

### Task 2 — Hook (`lib/widgets/use-home-layout.ts` + `use-home-layout.test.tsx`)
`renderHook` tests (localStorage mock per AppShell pattern):
- Empty localStorage → after hydration, `layout` === normalized `DEFAULT_LAYOUT`,
  `hydrated=true`.
- Pre-seeded valid localStorage (a reordered/resized layout) → hydrates to that layout.
- Malformed localStorage string → hydrates to default, no throw.
- `localStorage.getItem` throwing (stub to throw) → hydrates to default, no throw.
- Dispatching `resize`/`move`/`reorder`/`reset` after hydration writes a serialized layout
  to localStorage (parse it back, assert new layout).
- `setItem` throwing (quota) → dispatch still updates in-memory layout, no throw.
- **No pre-hydration overwrite (Codex fix 2):** seed a custom stored layout; assert the
  stored value is not replaced by the default before hydration completes (the persisted
  value after mount equals the seeded custom layout, not the default).
Implement to green. **Gate: lint + tests.**

### Task 3 — Editable tile (`components/widgets/EditableWidgetTile.tsx` + test)
jsdom render tests:
- Renders the widget title (via `WidgetFrame`) and a size label; does NOT mount the live
  widget body (assert an identifying element of, e.g., `QuickSiteAuditWidget` is absent).
- Only the **drag handle** has `draggable=true` (not the whole tile); dragStart on the
  handle fires `onDragStart` and the handler sets `dataTransfer` (assert via a mock event).
- Size stepper calls `onResize` on click; hidden when `widget.sizes.length === 1`
  (e.g. `quick-robots`); its `aria-label` names current + next size.
- ↑ disabled at `index===0`; ↓ disabled at `index===total-1`; enabled otherwise; each
  calls `onMove` with the right dir; both carry `aria-label`s.
- Tile surface has `dark:` classes (assert class substrings, matching PR-2 test pragmatism).
Implement to green. **Gate: lint + tests.**

### Task 4 — Stateful grid (`components/widgets/DashboardGrid.tsx` — extend test)
jsdom render/interaction tests (extend `DashboardGrid.test.tsx`; mock `next/navigation` +
`queue-poll` as PR 2 does; localStorage mock per AppShell):
- View mode (default): still renders live frames for the fixed widget set (PR-2 test stays
  green) + a "Customize" button present with `aria-pressed="false"`.
- Clicking "Customize" enters edit mode: editable tiles render (size steppers + move buttons
  visible), live bodies gone, "Reset layout" + "Done" present, Customize `aria-pressed`
  reflects state.
- Clicking a widget's ↓ then reading DOM order shows the two tiles swapped (drives
  `dispatch move` end-to-end through the real hook + reducer + localStorage).
- "Reset layout" after a reorder restores default order.
- "Done" returns to view mode.
- **Persistence:** after a move, a fresh `render(<DashboardGrid/>)` (same jsdom
  localStorage) hydrates to the reordered layout.
Implement grid changes to green. **Gate: lint + tests.**

### Task 5 — Integration + full gates
- `npx tsc --noEmit`
- `DATABASE_URL="file:./local-dev.db" npm test` (whole suite green; existing page/shell
  tests unaffected)
- `npm run build`
- Manual smoke in dev (`npm run dev`): Customize → drag-handle reorder → size stepper →
  reload persists → Reset → dark-mode toggle → mobile width hides the editor + renders a
  single column. (Dev only, no external site scans — hard gate 3.)

## Risks / notes

- **Hydration** is the single most likely regression. Mitigated by rendering
  `DEFAULT_LAYOUT` on server + first paint, reading storage only in an effect, and arming
  persist only post-hydration (Codex fix 2). Task 2's no-overwrite case + Task 4's
  fresh-render persistence case + a manual reload check all guard it.
- **DnD is pointer-only** → the ↑/↓ buttons (Codex fix 8) are the keyboard a11y path and
  are required, not optional. The drag handle (Codex fix 5) keeps controls clickable.
- **Suppressing live bodies in edit mode** is deliberate (Codex fix 7 endorses it) — the
  placeholder keeps the same frame/span/height/dark treatment so packing is faithful. If
  Kevin later wants live previews during edit, that's a scoped follow-up that does not touch
  the reducer/persistence spine.
- **`layout.ts` stays pure** (Codex fix 3): it imports only types, never `registry.tsx`.
- **No new deps** (spec §2) — native HTML5 DnD only, matching Quarter Grid.
- **Scope discipline:** no aggregate widgets, no data-source changes, no page-file change.

## Definition of done

Gate-green (lint + test + build), dev smoke passing (reorder + resize + persist + reset +
dark + mobile single-column + editor hidden on mobile), PR opened. Then merge (gate-green,
rule 1) → `~/deploy.sh` (no migration) → post-deploy prod verification (Customize / reorder
/ persist on the live homepage) → tracker checkbox + status-log line + rewritten handoff in
the ship commit.
