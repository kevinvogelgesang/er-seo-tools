# PR4 — Section status into panes + drop the rail + retire old recovery (detailed TDD plan)

> Lane: `feat/vb-lens-pr4` (Claude). Depends on: **BOTH PR2 AND PR3** merged. SERIAL (re-touches `InspectorPanes.tsx` after PR3; needs PR2's outline to exist before retiring `HiddenSectionsList`).
> Owns exclusively this phase: `InspectorPanes.tsx` (re-touch), `SectionQuickControls.tsx`, finish `OperatorSectionWrapper.tsx`, **`HiddenSectionsList.tsx` + the `OperatorViewbookLayer.tsx` edit removing its render**, **`app/(public)/viewbook/[token]/page.tsx` + its RSC guard test `page.test.tsx`** (Codex fix #12 — Task 2 changes wrapper props there) + their tests. `OperatorViewbookLayer.test.tsx`: PR4 owns the assertion that `HiddenSectionsList` no longer renders; the presentation-gate portion is a no-edit regression gate PR5 must not concurrently edit (Codex fix #15).
> Program: `2026-07-18-viewbook-context-lens-program.md` (§PR4, Codex fix #12). Spec: `…-design.md` §3.2 (single mutation owner), §3.3.

## Goal

Move `SectionQuickControls`' status actions (Show/Hide, Mark done/Reopen, Reset ack, state pills, `pc-thanks` gate) into each section's **Status** group inside `InspectorPanes` as the SINGLE mutation owner. Atomically retire the old recovery surface: remove `HiddenSectionsList` from `OperatorViewbookLayer` and delete/gut `HiddenSectionsList.tsx` in the SAME PR — so hidden-recovery is never available in two places or zero places. `OperatorSectionWrapper` becomes boundary-only (drops the rail entirely).

## Preconditions to re-verify at lane start
- PR2 landed: `SectionOutline` surfaces hidden sections (orientation) and selects them — but renders NO mutation. PR4 provides the one Show/Hide controller the outline points at.
- PR3 landed: `InspectorPanes` mounts per-section panes with a Status placeholder slot; `OperatorSectionWrapper` has `data-operator-section` + still renders `SectionQuickControls` (rail). PR4 removes that rail render.

## Bite-sized TDD steps

### Step 1 — Status controls in the pane (single owner) + activity reporting + real ack confirm
- **Test** (`SectionQuickControls.test.tsx` migrate + `InspectorPanes.test.tsx`): the Status actions render inside the selected section's pane `data-vb-inspector-group="status"` region; Show/Hide/Mark-done/Reopen/Reset-ack behave as before (optimistic set + rollback on failure + `requestRefresh()`); `pc-thanks` before `pcCompletedAt` renders no actionable Status (no inert Hide); ack/done gating by section set unchanged.
- **Reset-ack confirmation (Codex fix #12 — currently NOT implemented):** add a confirm step before the optimistic reset. Test the CANCEL path proves NO `DELETE /api/viewbooks/[id]/ack/[key]` fires; the confirm path proceeds. Keep it warning-toned.
- **Status-controller activity (Codex fix #10):** `SectionQuickControls` currently reports only to the page-global registry (`SectionQuickControls.tsx:38`). Add `useReportSectionActivity(section.sectionKey, 'operator-section-controls-'+section.sectionKey, {dirty:false, busy, conflict:false, focused})` so a status mutation / focus pins the correct section. Test: clicking Hide flips `busy` → section pins → releases at idle.
- **Impl:** render the status actions inside the pane's Status group as the ONE mutation owner. The outline (PR2) is selection-only and points at THIS controller via `select(key,'manual-nav','status')`.

### Step 2 — OperatorSectionWrapper boundary-only
- **Test** (`OperatorSectionWrapper.test.tsx` migrate): operator render is now just `<div data-operator-section={key}>{children}</div>` — no `SectionQuickControls`, no editors; `data-operator-section` present; presentation-gate render still bare. Drop the now-unused `operatorData`/`pcCompletedAt` props from the type (and from `page.tsx` pass-through) if fully unused.
- **Impl:** remove the `<SectionQuickControls>` render. Clean the props type; update `page.tsx` composition accordingly (guard: keep the anonymous byte-shape guard `page.test.tsx` green).

### Step 3 — atomically retire HiddenSectionsList + define the ONE recovery flow (Codex fix #11)
- **The single concrete hidden-recovery flow** (replaces the vague "second view over one controller/context"): outline row (hidden) → `select(key,'manual-nav','status')` focuses that section's pane Status group → operator clicks **Show** on the ONE `SectionQuickControls` there → optimistic `state:'active'` + `requestRefresh()` → once refreshed `section.state` is `active` AND the canvas target mounts, issue `navigateToAnchor(key, '#'+key)` **once** (this is the deferred navigation PR2 intentionally left to PR4). There is no second controller and no second view — just select → Show → refresh → navigate.
- **Test:** the select → Show → refresh → navigate sequence (assert `navigateToAnchor` fires only AFTER `state` flips active, not while hidden). Remove `HiddenSectionsList.test.tsx`; recovery coverage now lives in this flow. `OperatorViewbookLayer.test.tsx` asserts no `[data-operator-hidden-sections]` renders.
- **Impl:** delete the `<HiddenSectionsList>` render + import in `OperatorViewbookLayer`; delete `HiddenSectionsList.tsx` (+ its test). Add the post-Show `navigateToAnchor` (guarded on the refreshed active state). Do this in the SAME commit as Step 1 so recovery is never in two/zero places (Codex fix #12).

### Step 4 — gate
- Per-task: `npx tsc --noEmit` + `npx vitest run "components/viewbook/public/OperatorLayer" "app/(public)/viewbook"` → log + Monitor.
- **Pre-PR full gate (Codex fix #17):** `npx tsc --noEmit`, full `npx vitest run`, `npm run build` GREEN.

## Constraints
- **C6** hidden-recovery has exactly ONE mutation owner at all times; `pc-thanks` gate + ack/done sets + optimistic rollback + `requestRefresh()` preserved; force-advance/ack-reset confirms preserved.
- **C1/C3** presentation gate + anonymous byte shape unchanged (re-run `page.test.tsx`).
- Retirement is ATOMIC (Step 1 + Step 3 same PR).

## Gotchas
- Never a moment with two Show/Hide owners OR zero — Step 1 and Step 3 land together.
- The outline (PR2) may expose a "Show" affordance — it must dispatch into the ONE Status controller/context, not instantiate its own.
- Re-touching `InspectorPanes.tsx` after PR3 — rebase on the merged PR3 first; this is why PR4 is serial.
