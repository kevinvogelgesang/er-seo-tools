# PR3 — Relocate inline editors into inspector panes (detailed TDD plan)

> Lane: `feat/vb-lens-pr3` (Claude). Depends on: PR1 (merged, `0d68d12`). Parallel with PR2 ∥ PR5.
> Owns exclusively this phase: `inspector/InspectorPanes.tsx`, `InlineEditors.tsx`, `OperatorSectionWrapper.tsx` + their tests. Also **wires** `useSectionSelection` (currently exported-but-uncalled) inside `InspectorPanes` — PR3 provides the `[data-operator-section]` targets, so PR3 owns the scroll-spy call. PR2 must NOT wire scroll-spy.
> Program: `2026-07-18-viewbook-context-lens-program.md` (§PR3, §Interface freeze, Global Constraints C1–C6). Spec: `2026-07-18-viewbook-context-lens-design.md` §3.3.

## Goal

Move the six inline controllers out of the below-section sandwich (`OperatorSectionWrapper` → `InlineSectionEditors`) into `InspectorPanes`, **one visibility-flipped pane per section, all permanently mounted**. Controller internals (autosave / baseline-sync / stale-version / amendment) are **unchanged, verbatim**. Only *where they render* and *how selection reveals them* changes. Each controller additionally reports to the per-section activity registry; the section wrappers gain the scroll-spy target attribute and stop rendering the editors.

Net user-visible change after PR3: the docked inspector (desktop rail) shows the selected section's editors; the below-section form panels disappear from the canvas. `SectionQuickControls` rail STAYS on the canvas (PR4 removes it). No API/persistence/sync change.

## Frozen contracts consumed (do NOT modify)

- `useSelectionContext(): SelectionState` — read `selectedKey`; selection is driven by scroll-spy `observe()` + activity `select('focus')`.
- `useReportSectionActivity(sectionKey, editorId, snap: {dirty,busy,conflict,focused})` — call **exactly once per editor**, stable `editorId`, accurate booleans (a stuck-true field holds a hard pin open and fail-closes every other section). Reports on change, HARD-pins while aggregate active, `release('activity')` at zero, `remove()` on unmount.
- `useSectionSelection(orderedKeys: readonly SectionKey[])` — scroll-spy; reads `document.querySelectorAll('[data-operator-section]')` + `dataset.operatorSection`.
- `InspectorPanesProps = { viewbookId: number; operatorData: OperatorViewbookData }` (frozen; real `operatorData`, never `{}`).

## Architecture decisions (locked from the structural map)

1. **Each controller calls `useReportSectionActivity` itself** — it already holds `focus.focused`, `dirty`, `autosave.saving`, (`autosave.paused` for fields). Do NOT lift state via callbacks.
2. **sectionKey per controller:** `SectionTextInlineEditor` uses `section.sectionKey`. The five singletons hardcode their 1:1 literal (`WelcomeNote→'welcome'`, `Milestone→'milestones'`, `Theme→'brand'`, `Docs→'strategy'`, `DataSource→'data-source'`). No new required props → zero churn to direct-render tests.
3. **editorId per controller** = its existing autosave/activity id (already unique + mount-stable): `operator-section-text-${sectionKey}`, `operator-welcome-note`, `operator-theme`, `operator-docs`, and for the two aggregators a section-level id `operator-milestones-agg` / `operator-data-source-agg` (the aggregator reports the rolled-up `aggregate.activity` + its own pane-level focus). Per-row `useEditorActivity` ids (milestone/field) are untouched — those feed the SEPARATE `useEditorActivity` sync registry (C4), NOT the section-activity registry.
4. **snap mapping per controller:**
   - `SectionTextInlineEditor`: `{ dirty, busy: autosave.saving, conflict: false, focused: focus.focused }`
   - `WelcomeNoteInlineEditor`: `{ dirty, busy: autosave.saving, conflict: false, focused: focus.focused }`
   - `ThemeInlineEditor`: `{ dirty, busy: busy || autosave.saving, conflict: false, focused: focus.focused }`
   - `DocsInlineEditor`: `{ dirty, busy, conflict: false, focused: focus.focused }`
   - `MilestoneQuickEditor` (aggregator): add a pane-level `useFocusWithin` on the wrapper; report `{ dirty: aggregate.activity.dirty, busy: aggregate.activity.busy, conflict: !!aggregate.activity.conflict, focused }`
   - `DataSourceInlineEditor` (aggregator): same pattern; `conflict` = `!!aggregate.activity.conflict` (this is the only controller that surfaces the stale-version pause as `conflict` — it correctly holds the hard pin until retry)
5. **InspectorPanes** mounts one pane per **ELIGIBLE** section (Codex fix #5): all `operatorData.sections` EXCEPT `pc-thanks` while `operatorData.pcCompletedAt === null` (mirror the domain gate — an inert thanks pane must not exist pre-completion). Hidden sections ARE eligible/editable (no canvas node needed). Each pane `hidden`/`inert` unless active.
   - **Active-pane seeding (Codex fix #4 — NOT `sections[0]`):** `operator-data.ts` loads section rows by DB id, so index-0 could be hidden/out-of-stage, and the empty-section fixture would crash on `[0]`. Instead: when `selectedKey` is set, that's active. When null, seed from the FIRST `[data-operator-section]` in **canvas DOM order** (the first visible lineup section). If no canvas target exists yet (or no eligible panes), render a neutral "Select a section" empty state — never index `[0]`.
   - **Scroll-spy orderedKeys (Codex fix #6):** derive the ordered keys from the live canvas DOM (`[data-operator-section]` in document order), not `operatorData.sections` (DB order). Read them in an effect after commit, store in state with a signature compare (join('|')) to avoid churn, and pass that stable list to `useSectionSelection`. This preserves the landed visible-pixel + lineup-order tie-break contract.
   - Pane content = the existing `InlineSectionEditors` (relocated, unchanged dispatch), wrapped per intent group (see #6 below).
6. **Intent-group DOM contract (Codex fix #7):** inside each pane, wrap controllers in stable `data-vb-inspector-group="<group>"` regions, ALL mounted: section-text/welcome/milestones → `content`, theme → `assets`, docs → `documents`, data-source → `data`, plus a mounted empty `status` placeholder region (PR4 fills it; PR2's hidden-row `select(key,'manual-nav','status')` targets it). This is the shared seam for PR2 + PR4.
7. **OperatorSectionWrapper**: add `data-operator-section={sectionKey}` to the wrapper div (scroll-spy target); remove the `<InlineSectionEditors>` render + its `operatorData` destructure (keep `operatorData` in the props type — `page.tsx` still passes it; PR4 removes from type). Keep `<SectionQuickControls>`.

## Bite-sized TDD steps

Each step: write/adjust the failing test first, then implement to green. Run gates only via the log-file + Monitor pattern (never inline vitest — 120s tool timeout vs ~2min cold prisma globalSetup).

### Step 1 — `useReportSectionActivity` inside each singleton controller
- **Test** (`InlineEditors.test.tsx`, new `describe('section-activity reporting')`): render each singleton wrapped in `SelectionProvider`+`SectionActivityProvider`; spy the registry via a test consumer that reads `aggregateFor(key)`. Assert: focusing a field flips `focused` true; typing flips `dirty` true; idle → all false. For `DataSourceInlineEditor`, a 409 stale_version flips `conflict` true and holds until retry.
- **Impl:** add the `useReportSectionActivity(...)` call to `SectionTextInlineEditor`, `WelcomeNoteInlineEditor`, `ThemeInlineEditor`, `DocsInlineEditor` with the snap mapping above.

### Step 2 — aggregators report section-level activity + FIX the stale-entry leak (Codex fix #8)
- **The bug:** `useAggregatePanelActivity` (`InlineEditors.tsx:56`) has `report(key, activity)` but NO removal. When a dirty/paused child row unmounts during a refresh, its entry lingers → the section aggregate stays `dirty`/`conflict` true forever → a permanent HARD pin that fail-closes every other section (exactly the "stuck-true" failure the contract warns about). This MUST be fixed as part of PR3, or relocation makes it reachable.
- **Test (write first):** mount an aggregator with two child rows; dirty one; unmount that child (simulate refresh dropping it); assert the section aggregate returns to idle (pin released). Also: dirtying a child flips aggregate `dirty`; focusing the pane flips `focused`; a paused field flips `conflict` and holds until retry.
- **Impl:**
  1. Add an idempotent `remove(key: string)` to `useAggregatePanelActivity` (delete the entry + recompute). Call it from each child's unmount cleanup: `MilestoneRow`, `OperatorFieldRow`, and `CustomFieldForm` (`reportActivity` counterparts). Use the same latest-ref cleanup discipline as `useReportSectionActivity` so cleanup doesn't churn on every activity bump.
  2. Add pane-level `useFocusWithin` on each aggregator's outer wrapper (`onFocus`/`onBlur`) + `useReportSectionActivity('milestones'|'data-source', 'operator-milestones-agg'|'operator-data-source-agg', {dirty: aggregate.activity.dirty, busy: aggregate.activity.busy, conflict: !!aggregate.activity.conflict, focused})`.

### Step 3 — `InspectorPanes` mounts eligible panes, visibility-flipped
- **Test** (`InspectorPanes.test.tsx`, new): render inside `SelectionProvider`+`SectionActivityProvider` with a multi-section `operatorData`, AND render the wrapped canvas sections (so `[data-operator-section]` targets exist for seeding + scroll-spy). Assert:
  - (a) a `[data-vb-inspector-pane="<key>"]` exists for every ELIGIBLE section; `pc-thanks` pane ABSENT when `pcCompletedAt===null`, PRESENT when set (fix #5).
  - (b) with `selectedKey` null, exactly one pane is visible = the section matching the FIRST `[data-operator-section]` in DOM order (fix #4); with an empty/target-less fixture, a neutral "Select a section" state renders and NOTHING indexes `[0]` (no crash).
  - (c) each pane contains the intent-group regions `data-vb-inspector-group` (content + the section-specific group + a mounted `status` placeholder) (fix #7).
  - (d) **selection changes (Codex fix #9 — split, no impossible assertion):** a CLEAN `select(other,'manual-nav')` flips `hidden` and the previous pane's input is STILL in the DOM (not unmounted, C5); SEPARATELY, when the active section is dirty/conflicted (report activity), `select(other,'manual-nav')` does NOT swap the visible pane (hard pin fail-closed) — assert the SAME pane stays visible until the section reports idle. Do NOT assert a dirty active pane becomes hidden.
  - (e) scroll-spy `orderedKeys` come from canvas DOM order, not `operatorData.sections` order (fix #6) — assert via a fixture whose DB order ≠ lineup/DOM order.
- **Impl:** build `InspectorPanes` per Architecture #5/#6. `inert={!isActive}` (React 19 native) + `hidden={!isActive}`. Derive canvas-DOM `orderedKeys` in a post-commit effect (signature-compared), pass to `useSectionSelection`. Pane content = `<InlineSectionEditors viewbookId section operatorData/>` inside the intent-group wrappers. Guard every array access against empty.

### Step 4 — `OperatorSectionWrapper` gains scroll-spy target, drops editors
- **Test** (`OperatorSectionWrapper.test.tsx`, migrate): the operator render now has `[data-operator-section="welcome"]` present; `[data-operator-inline-editor]` (the editor chrome) is ABSENT below the section; `SectionQuickControls` ("Hide" button) still present; presentation-gate render still bare (`{children}` only). Update the existing assertion that expected a `welcome note` button below the section (that button now lives in the inspector, tested in InspectorPanes).
- **Impl:** add `data-operator-section={sectionKey}` to the wrapper `<div>`; remove `<InlineSectionEditors>` + the `operatorData` destructure (leave it in the props type).

### Step 5 — migrate `InlineEditors.test.tsx` structure expectations
- The 17 behavior `it`s (autosave/no-save-button/dark-tokens/disclosure/stale-version/amend/etc.) stay GREEN unchanged where they render controllers directly — those behaviors are unchanged. Only add the new activity-reporting describe (Steps 1–2). Do NOT assert below-section placement anywhere (that was OperatorSectionWrapper's concern, handled in Step 4). Confirm `document.querySelector('details')` null assertions still hold (unchanged).

### Step 6 — gate
- Per-task: `npx tsc --noEmit` (0 errors) + `npx vitest run "components/viewbook/public/OperatorLayer"` to a log file, wait via Monitor (`until grep -q EXIT= /tmp/pr3.log`).
- **Pre-PR full gate (Codex fix #17):** `npx tsc --noEmit`, full `npx vitest run`, and **`npm run build`** all GREEN (local dev box — repo disables in-build tsc/lint, so these are the only net; `npm run build` catches client/server-boundary + Next issues relocation can introduce).

## Constraints checklist (must hold)
- **C1** presentation gate: wrapper still returns bare `{children}` pre-init/presenting; InspectorPanes only renders in the operator branch (already gated by OperatorViewbookLayer). No pane markup in anon/preview.
- **C3** no `operatorMode` prop into public components; InspectorPanes is a sidecar island.
- **C4** every controller KEEPS its existing `useEditorActivity`/`useAutosave` id (sync no-clobber registry) — the new `useReportSectionActivity` is additive and independent.
- **C5** panes never conditionally unmounted on selection — `hidden`/`inert` only. Drafts/timers/upload/conflict + both registrations survive.
- **C6** domain gates unchanged (editors moved verbatim).

## Gotchas (from PR1 review + memory)
- `useReportSectionActivity` snap object may be a fresh literal each render (effect keys on the 4 booleans) — fine. Booleans MUST be accurate/idle-reachable or the hard pin sticks and fail-closes every other section.
- Do NOT add a competing pin/selection guard in InspectorPanes — pin policy lives solely in `SelectionContext`. Panes only READ `selectedKey`.
- `inert` on an ancestor makes descendants unfocusable — good for hidden panes, but ensure the ACTIVE pane is never inert.
- Keep `useEditorActivity` and `useViewbookSync` (sync registry) SEPARATE from the section-activity registry.
