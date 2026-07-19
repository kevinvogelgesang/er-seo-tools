# PR6 — Integration + a11y + anonymous verification (detailed plan)

> Lane: `feat/vb-lens-pr6` (Claude). Depends on: ALL of PR2–PR5 merged. SERIAL, last. **No component behavior change** — tests + a11y fixes + manual verification only.
> Owns exclusively this phase: integration/a11y tests + manual `/verify`. May apply small a11y fixes surfaced (labels, focus order) but no functional change.
> Program: `2026-07-18-viewbook-context-lens-program.md` (§PR6). Spec: `…-design.md` §5.

## Goal

Prove the assembled Context Lens works end-to-end: selection ↔ outline ↔ panes wiring, keyboard/focus/screen-reader coverage for the inspector/outline/sheet, the anonymous byte-shape guard re-asserted end-to-end, and a manual `/verify` pass driving the operator route on a real branded theme (desktop rail + mobile sheet + preview-as-client round-trip).

## Bite-sized steps

### Step 1 — cross-component selection integration test (new)
- Render the full operator layer (OperatorViewbookLayer with a multi-section operatorData, providers, inspector, wrapped canvas sections). Assert (Codex fix #16 — align with hard-pin/focus reality):
  - scroll-spy `observe()` (simulate IntersectionObserver entries) sets `selectedKey` → the matching pane becomes visible;
  - focusing an editor HARD-pins its section; an outline `select(other,'manual-nav')` FAILS to swap while the pinned section is dirty/busy — assert the SAME visible pane + its mounted controller remain (not "the dirty pane hides"); after save/blur releases activity, a subsequent selection SUCCEEDS without remounting the previously-visible controller;
  - clicking an outline row navigates the canvas (`vb:navigate` dispatched) and selects the pane;
  - a CLEAN selection change does not unmount the prior pane's controller (C4/C5 end-to-end).

### Step 2 — a11y coverage (new)
- Inspector `aside` has an accessible label; outline is a labeled `nav` with rows as buttons in a sensible tab order; the mobile sheet handle is a labeled control with `aria-expanded`; keyboard: Tab reaches outline → panes in DOM order (inspector is AFTER the bar, BEFORE children — Codex fix #8). **Tabbability (fix #16):** assert the CONTROLS inside the active pane are tabbable and controls inside hidden/`inert` panes are NOT — do NOT require the pane container itself to be tabbable (only add `tabIndex={-1}` to a container if PR6 deliberately introduces a roving-focus target). Screen-reader labels on Status actions. Fold in fixes for anything failing.

### Step 3 — anonymous byte-shape guard re-assert
- `app/(public)/viewbook/[token]/page.test.tsx` stays green: anonymous branch returns plain `ViewbookShell`, no operator markers, no `loadOperatorViewbookData`, no `operatorMode` prop threaded. Add an assertion that no `data-vb-inspector` / `data-vb-section-outline` / `data-operator-section` leaks into the anonymous render.

### Step 4 — presentation gate end-to-end
- In preview-as-client and pre-init: no bar, no inspector, no outline, no selection outline, no draft overlay. `PresentationToggle` "Return to editing" is the only operator affordance while presenting.

### Step 5 — manual `/verify`
- Drive the operator route on a branded theme: desktop rail selection + edit + autosave; mobile sheet open/collapse; canvas-fit vs preview-as-client round-trip (preview shows the exact client render, no chrome); theme live-preview still works (unchanged); text edits reflect on next idle refresh (text live-preview intentionally deferred — §3.4). Capture evidence.

### Step 6 — gate
- `npx tsc --noEmit` + the FULL `npx vitest run` suite (not just globs — this is the integration PR) → log + Monitor + **`npm run build`** (Codex fix #17). GREEN. Then `/verify` evidence before merge.

## Constraints
- No component behavior change — only tests, a11y labels/focus, and verification.
- C1–C6 all re-asserted end-to-end here.

## Gotchas
- Inspector DOM order: AFTER the bar, BEFORE children (keyboard order — Codex fix #8). Verify not regressed by PR5's shell polish.
- `useSectionSelection` reads the live DOM (`[data-operator-section]`) — integration tests must render the wrapped canvas sections (not just the inspector) for scroll-spy to have targets.
