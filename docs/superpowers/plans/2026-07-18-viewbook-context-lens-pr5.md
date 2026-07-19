# PR5 — Bar slim + inspector shell polish (detailed TDD plan)

> Lane: `feat/vb-lens-pr5` (Codex). Depends on: PR1 (merged, `0d68d12`). Parallel with PR3 ∥ PR4 (disjoint files).
> Owns exclusively this phase: `OperatorBar.tsx`, `inspector/OperatorInspector.tsx` (shell only — NOT SectionOutline/InspectorPanes bodies) + their tests.
> Program: `2026-07-18-viewbook-context-lens-program.md` (§PR5). Spec: `…-design.md` §3.2 (OperatorInspector shell), §6 risk 2.

## Goal

(a) Slim `OperatorBar` to workflow/stage/preview/theme-toggle — section-level controls now live in the inspector, so the bar sheds them — while **keeping the `#vb-operator-bar` id, sticky positioning, and `ResizeObserver` measurement intact** (C2). (b) Promote `OperatorInspector` from PR1's desktop-only inert rail to a polished responsive shell: right rail on `lg+`, collapsible bottom sheet below, collapse/expand affordance, and a **canvas-fit toggle explicitly distinct from preview-as-client**. Docks below the published `--vb-sticky-offset`.

## Frozen contracts consumed (do NOT modify)

- `OperatorInspectorProps = { viewbookId; operatorData; pcCompletedAt; stage }` (frozen — do not change the signature; PR5 changes only the shell markup/behavior around the `<SectionOutline>` + `<InspectorPanes>` children).
- `StickyOffsetProbe` already publishes `--vb-sticky-offset` to BOTH `[data-vb-theme-root]` and `document.documentElement` (PR1). The inspector reads `var(--vb-sticky-offset)` — do NOT add a second measurement path or a hidden measured twin.
- The `#vb-operator-bar` id is measured by the probe — never rename/duplicate.

## Scope detail

### OperatorBar slim
- Keep: the single `#vb-operator-bar` sticky container, workflow/stage controls, `PresentationToggle` (preview-as-client), theme-toggle, and whatever global stage/workflow affordances it renders today that are NOT per-section.
- Remove/relocate: nothing per-section is added or moved here in PR5 (section controls were never in the bar — they were rail/panels). PR5's bar change is trimming to the intended slim set + ensuring the id/sticky/measurement survive. If the current bar already renders only global controls, PR5 is mostly re-asserting invariants + any layout polish — keep the diff minimal and do NOT touch section state.

### OperatorInspector shell (replace PR1's desktop-only rail)
- **ONE inspector subtree (Codex fix #14 — critical):** render exactly ONE `<SectionOutline>` + ONE `<InspectorPanes>` inside a single responsive shell. Do NOT render separate desktop-rail and mobile-sheet copies — two copies would duplicate every autosave controller, `useEditorActivity`/`useSectionActivity` id, and in-flight request (double PATCHes, id collisions). The rail-vs-sheet difference is CSS/layout on the one shell (responsive classes + a container that reflows), not a second mount. Test: exactly one `[data-vb-inspector-panes]` and one `[data-vb-section-outline]` exist at every breakpoint.
- `lg+`: the shell is a fixed right rail (`lg:w-96` family retained), `top: var(--vb-sticky-offset)`, scrollable, `data-vb-inspector` retained.
- `<lg`: the SAME shell reflows to a collapsible **bottom sheet** with a visible handle (bottom-left/centered — the TOC FAB owns bottom-right on mobile, spec §8). Collapsed shows only the handle, never an empty viewport block.
- **Collapse/expand** affordance (accessible button, `aria-expanded`); collapse hides the body via `hidden`/CSS — never unmounts the outline/panes (C5).
- **Canvas-fit toggle (Codex fix #13 — the inspector cannot restyle its parent canvas directly):** canvas-fit toggles an operator-only attribute on `document.documentElement` (e.g. `data-vb-canvas-fit`), with cleanup removing it on unmount; a scoped GLOBAL CSS rule narrows `[data-vb-theme-root]` ONLY at `lg+` when that attribute is present. It is clearly LABELED canvas-fit and semantically DISTINCT from preview-as-client (which stays the exact unmodified full render — the only trustworthy client check). Test: the two are separate controls with distinct labels; toggling canvas-fit does NOT enter presentation mode; the attribute is cleaned up on unmount AND absent in presentation mode.
- The inspector must render nothing in preview-as-client / pre-init (already gated by `OperatorViewbookLayer` returning the bare tree — PR5 must not add any inspector markup OUTSIDE that gate).

## Bite-sized TDD steps

Run gates via log-file + Monitor (never inline vitest).

### Step 1 — OperatorBar invariants (`OperatorBar.test.tsx`)
- **Tests (keep/strengthen):** the bar renders exactly one `#vb-operator-bar`; it is sticky; `StickyOffsetProbe` still measures it (existing test stays green); the slimmed content set is present (workflow/stage/preview/theme) and no per-section control leaked in.
- **Impl:** trim as needed; preserve id + sticky + probe wiring.

### Step 2 — inspector responsive shell, ONE subtree (`OperatorInspector.test.tsx`)
- **Tests:** exactly ONE `[data-vb-section-outline]` and ONE `[data-vb-inspector-panes]` render at all breakpoints (fix #14 — no desktop/mobile duplication); on desktop the aside is the right rail with `top: var(--vb-sticky-offset,…)`; a collapse button toggles `aria-expanded` and hides the body while keeping the handle; the sheet handle renders; SectionOutline + InspectorPanes are STILL mounted on collapse (hide via `hidden`/CSS, never unmount — C5). Extend PR1's existing `OperatorInspector.test.tsx` rather than replacing it.
- **Impl:** build the single responsive shell around one outline + one panes instance; collapse hides body via `hidden`, not unmount.

### Step 3 — canvas-fit ≠ preview (via documentElement attr)
- **Tests:** the canvas-fit toggle and the preview-as-client toggle are DISTINCT controls with distinct accessible names; toggling canvas-fit sets `document.documentElement[data-vb-canvas-fit]` and does NOT enter presentation mode (spy `usePresentationMode`/toggle — canvas-fit never calls it); unmounting the inspector removes the attribute; presentation mode leaves no attribute.
- **Impl (fix #13):** canvas-fit toggles the `data-vb-canvas-fit` attribute on `document.documentElement` (cleanup on unmount) + a scoped global CSS rule narrows `[data-vb-theme-root]` at `lg+` when present — NOT a local class on the inspector (it can't restyle its parent canvas).

### Step 4 — presentation-gate absence
- **Tests:** when presenting / pre-init, no `data-vb-inspector` and no bar in the tree. Assert via the OperatorInspector/OperatorBar surfaces PR5 owns. Treat `OperatorViewbookLayer.test.tsx` as a NO-EDIT regression gate (PR4 owns edits to it — Codex fix #15); do not modify it in PR5.

### Step 5 — gate
- Per-task: `npx tsc --noEmit` + `npx vitest run "components/viewbook/public/OperatorLayer/OperatorBar" "components/viewbook/public/OperatorLayer/inspector/OperatorInspector"` → log + Monitor.
- **Pre-PR full gate (Codex fix #17):** `npx tsc --noEmit`, full `npx vitest run`, `npm run build` GREEN.

## Constraints
- **C1** inspector/bar absent in preview-as-client + pre-init.
- **C2** exactly one `#vb-operator-bar`, id unchanged, sticky, measured by the single probe. No second measurement path, no hidden twin.
- **C5** collapse/canvas-fit hide via CSS/`hidden` — never conditionally unmount `SectionOutline`/`InspectorPanes` (their state must survive).
- Do NOT change `OperatorInspectorProps`, `SectionOutline`, or `InspectorPanes` (other lanes own those). PR5 touches only the shell wrapper + the bar.

## Gotchas
- Don't conditionally unmount InspectorPanes on collapse (C5) — hide with CSS.
- The dock reads `var(--vb-sticky-offset)` which `StickyOffsetProbe` publishes to `document.documentElement` too (PR1) — the inspector is a sibling outside the theme root, so it inherits from `documentElement`. Do not re-measure.
- Keep the bar diff minimal — it's easy to accidentally drop a global control or the probe wiring. Re-run `OperatorBar.test.tsx` after every edit.
