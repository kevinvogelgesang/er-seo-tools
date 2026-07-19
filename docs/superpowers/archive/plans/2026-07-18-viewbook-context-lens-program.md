# Viewbook "Context Lens" Operator Editor — Program / Tandem Build Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` per PR. This is the ORCHESTRATION plan — it defines PR boundaries, ownership, sequencing, and the frozen-interface contract for a **two-agent tandem build (Claude + Codex)**. Each PR gets its own detailed bite-sized-TDD plan (`docs/superpowers/plans/2026-07-18-viewbook-context-lens-prN.md`); **PR1's is written (below-linked); PR2–PR6 detailed plans are expanded from this doc AFTER PR1 freezes the shared interfaces** (§Interface freeze).

**Goal:** Replace the inline "sandwich" operator editing motion on the live public viewbook page with the **Context Lens** paradigm — one persistent docked inspector beside the live canvas.

**Spec:** `docs/superpowers/specs/2026-07-18-viewbook-context-lens-design.md` (Codex-reviewed, all fixes applied). Research: `docs/superpowers/specs/2026-07-18-viewbook-operator-editor-codex-research.md`.

**Architecture:** A single `OperatorInspector` (right rail on `lg+`, bottom sheet below) owns a searchable `SectionOutline` + `InspectorPanes` (all sections' editors permanently mounted, visibility-flipped by selection). The existing editor controllers move into panes **verbatim** (autosave/baseline-sync/stale-version/amendment logic unchanged); only their location and chrome change. Selection = passive scroll-spy + click, pinned while a section's aggregate activity is non-zero.

**Tech stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind (class dark mode), Vitest + Testing Library.

## Global Constraints

Copied verbatim from spec §2 — every task's requirements implicitly include these:

- **C1 Presentation gate.** Keep the `!initialized || presenting` early return in `OperatorViewbookLayer` and each `OperatorSectionWrapper`. No operator chrome (bar, inspector, outline, selection outline, draft overlay) in preview-as-client or pre-init. Provider must be mounted OUTSIDE the visual early-return and `useSelectionContext()` must have a safe no-op default so hooks are called unconditionally (no hook-ordering violation).
- **C2 `#vb-operator-bar`.** Exactly one, kept mounted in edit mode, id unchanged, measured by `StickyOffsetProbe`. The probe must publish `--vb-sticky-offset` to BOTH `[data-vb-theme-root]` AND `document.documentElement` (the inspector is a sibling outside the theme root). No second measurement path, no hidden measured twin.
- **C3 Anonymous byte shape.** Anonymous branch returns plain `ViewbookShell`, never loads `loadOperatorViewbookData`, never renders/hydrates operator markers. **No `operatorMode` prop threaded into public components.** Inspector is a sidecar island in the verified-operator branch only. Existing guard `app/(public)/viewbook/[token]/page.test.tsx` stays green.
- **C4 No-clobber.** Every controller keeps a mount-stable `useEditorActivity` id; `useViewbookSync` refreshes only when that registry is idle. `useEditorActivity` is UNCHANGED. (The new per-section `useSectionActivity` registry is separate and drives only pinning.)
- **C5 Mounted-while-hidden.** Panes never conditionally rendered on selection; visibility flips via `hidden`/`inert`. Drafts, timers, upload/conflict state, and both activity registrations survive selection switches.
- **C6 Domain gates.** `pc-thanks` absent before `pcCompletedAt`; done-able/ack-able sets; hidden recovery without a canvas target; explicit ack reset + stage force-advance confirm; locked-baseline amendment + stale-version pause/retry; explicit upload/delete/create; `requestRefresh()` after structural/file changes; server authority.
- **Gates per PR:** `npx tsc --noEmit` + `npx vitest run <changed test globs>` green inside the lane's worktree before PR. Do NOT re-enable in-build type-check/lint. Each behavior PR migrates its OWN tests (no deferring failing tests to the final PR).
- **Change boundary:** presentation + client-interaction only. NO changes to operator API routes, request/response bodies, autosave debounce/flush, stale-version semantics, amendments, the sync protocol, or the public/anonymous render.

---

## Lane model (multi-agent coordination)

Per `er-seo-tools-multi-agent-coordination`: one agent, one worktree, one PR at a time; branches named `feat/vb-lens-prN`; announce the lane. Shared-file hazard set: `OperatorViewbookLayer.tsx`, `OperatorSectionWrapper.tsx`, `OperatorInspector.tsx`, `InspectorPanes.tsx`, `InlineEditors.tsx`, `HiddenSectionsList.tsx`, `SectionQuickControls.tsx`, `StickyOffsetProbe.tsx`. The sequence assigns **exactly one owner per file per phase** — no concurrent shared-file edits.

**Ordering:** `PR1 → (PR2 ∥ PR3 ∥ PR5) → PR4 (after BOTH PR2 and PR3) → PR6 (last)`.

| PR | Owner (suggested) | Depends on | Owns these files (exclusive within its phase) |
|----|----|----|----|
| PR1 Foundation | Claude (serial) | — | new `inspector/*` contracts+shells, `OperatorViewbookLayer.tsx`, `StickyOffsetProbe.tsx` |
| PR2 Outline+nav | Codex | PR1 | `inspector/SectionOutline.tsx` (+nav helper), its tests. `HiddenSectionsList` stays functional & untouched through PR2 (no adapter/stub). |
| PR3 Relocate editors | Claude | PR1 | `inspector/InspectorPanes.tsx`, `InlineEditors.tsx`, `OperatorSectionWrapper.tsx`, their tests |
| PR4 Status into panes + drop rail + retire old recovery | Claude | **PR2 AND PR3** | `InspectorPanes.tsx`, `SectionQuickControls.tsx`, finish `OperatorSectionWrapper.tsx`, **`HiddenSectionsList.tsx` + the `OperatorViewbookLayer.tsx` edit that removes its render**, their tests |
| PR5 Bar slim + shell polish | Codex | PR1 | `OperatorBar.tsx`, `OperatorInspector.tsx` shell polish, their tests |
| PR6 Integration + a11y + anon guard | Claude | all | integration/a11y tests, manual `/verify`; no behavior change |

PR4 depends on BOTH PR2 and PR3 (Codex fix #12): it activates the outline's single Status controller AND atomically removes the old `HiddenSectionsList` recovery surface — which cannot happen until the real outline (PR2) exists. There is thus exactly one owner for retiring the old recovery path; PR2 never stubs or adapts it.

Owner column is a suggestion — Kevin routes per task. The invariant is the *file ownership per phase*, not who holds the lane.

---

## Interface freeze (PR1 deliverable — the tandem contract)

PR1 MUST land these TypeScript interfaces and NOT change them afterward. PR2–PR6 build against them. If a parallel lane needs a change, it goes back through PR1's owner as a serial amendment, never edited concurrently in two lanes.

```ts
// inspector/SelectionContext.tsx
export type InspectorGroup = 'content' | 'status' | 'assets' | 'data' | 'documents'
export type PinReason = 'dirty' | 'focus' | 'manual-nav'
export type PinKind = 'activity' | 'manual-nav'   // 'activity' (from dirty/focus) = HARD; 'manual-nav' = SOFT
export interface SelectionState {
  selectedKey: SectionKey | null
  selectedGroup: InspectorGroup | null            // which intent group is focused (PR2 → PR4 Status seam)
  /** Returns false if a HARD pin on another section blocked the switch (fail-closed). */
  select: (key: SectionKey, reason?: PinReason, group?: InspectorGroup) => boolean
  observe: (key: SectionKey) => void              // scroll-spy entry; yields to ANY pin
  /** Scoped: releases the current pin ONLY if it matches key AND kind (stale releases no-op). */
  release: (key: SectionKey, kind: PinKind) => void
  isPinned: boolean
  pinnedKey: SectionKey | null
  pinnedKind: PinKind | null
}
export function useSelectionContext(): SelectionState   // safe no-op default outside a provider

// inspector/useSectionActivity.tsx
export interface SectionActivitySnapshot { dirty: boolean; busy: boolean; conflict: boolean; focused: boolean }
export interface SectionActivityApi {
  report: (sectionKey: SectionKey, editorId: string, snap: SectionActivitySnapshot) => void
  remove: (sectionKey: SectionKey, editorId: string) => void   // MUST be called on editor unmount (else selection can deadlock)
  aggregateFor: (sectionKey: SectionKey) => SectionActivitySnapshot   // OR-reduced across that section's editors
  anyActive: (sectionKey: SectionKey) => boolean                     // dirty||busy||conflict||focused
  version: number                                                    // bumped on every change → context consumers re-render
}
export function useSectionActivityContext(): SectionActivityApi   // safe no-op default outside a provider
// Lifecycle bridge each relocated controller (PR3) calls once:
export function useReportSectionActivity(sectionKey: SectionKey, editorId: string, snap: SectionActivitySnapshot): void
//   reports on change; HARD-pins that section while its aggregate is active;
//   release('activity') at aggregate zero; remove() on unmount.

// inspector/OperatorInspector.tsx
export interface OperatorInspectorProps {
  viewbookId: number
  operatorData: OperatorViewbookData
  pcCompletedAt: string | null
  stage: ViewbookStage
}

// inspector/SectionOutline.tsx  (PR2 fills the bodies; PR1 ships typed placeholders)
export type OutlineGroup = 'primary' | 'carried' | 'future'   // 'carried' is a first-class state (spec)
export interface OutlineRow {
  sectionKey: SectionKey
  title: string                 // from SECTION_TITLES
  state: 'active' | 'hidden' | 'done'
  acknowledged: boolean
  group: OutlineGroup
}
// The outline-data SEAM is frozen in PR1 so PR2 can own row-derivation while
// touching ONLY SectionOutline.tsx (the inspector calls this, not rows={[]}):
export function buildOutlineRows(operatorData: OperatorViewbookData, stage: ViewbookStage, pcCompletedAt: string | null): OutlineRow[]
export interface SectionOutlineProps {
  operatorData: OperatorViewbookData
  stage: ViewbookStage
  pcCompletedAt: string | null
  viewbookId: number
}

// inspector/InspectorPanes.tsx  (PR3 fills the body; PR1 ships a typed placeholder)
export interface InspectorPanesProps { viewbookId: number; operatorData: OperatorViewbookData }  // REAL operatorData, never {}
```

Selection/pin rules PR1 encodes (spec §3.2, Codex plan-review fixes #1–#4):
- scroll-spy calls `observe(key)`, which sets `selectedKey` ONLY when nothing is pinned; `SelectionContext` is the **authoritative** pin guard (scroll-spy must not itself decide based on the candidate's activity).
- `select(key,'dirty'|'focus')` sets a HARD ('activity') pin; a hard pin on another section **fails closed** — `select()` returns false and the visible pane is not swapped (a click may still navigate/highlight the canvas).
- `select(key,'manual-nav')` sets a SOFT pin, released when the target becomes the dominant in-view section OR a bounded timeout elapses.
- `release(key, kind)` is scoped — a stale effect releasing the wrong key/kind is a no-op.
- scroll-spy dominance uses **visible pixels** (`intersectionRect.height`), lineup-order tie-breaks, and a small **hysteresis** margin before replacing the current selection (raw `intersectionRatio` lets a tall section lose to a small sliver).

---

## PR1 — Foundation (serial, blocks all) → detailed plan: `2026-07-18-viewbook-context-lens-pr1.md`

**Deliverable:** the frozen contracts above + composed-but-inert inspector, wired behind the presentation gate, with the dual-scope sticky publish. Existing inline motion (`SectionQuickControls` + `InlineSectionEditors`) STILL renders — PR1 changes nothing user-visible except an empty docked inspector shell. This lets every later lane import stable modules.

**Files:**
- Create: `components/viewbook/public/OperatorLayer/inspector/SelectionContext.tsx`, `useSectionActivity.ts`, `useSectionSelection.ts`, `OperatorInspector.tsx`, `SectionOutline.tsx` (placeholder), `InspectorPanes.tsx` (placeholder), `inspector/index.ts`, colocated tests.
- Modify: `OperatorViewbookLayer.tsx` (mount provider OUTSIDE the gate; render `<OperatorInspector>` inside the operator branch), `StickyOffsetProbe.tsx` (dual-scope publish).

**Acceptance:** contracts exported & typed; provider mounted outside the visual gate; `useSelectionContext`/`useSectionActivityContext` return safe defaults outside a provider; inspector renders an empty responsive dock below the measured bar; `--vb-sticky-offset` present on `document.documentElement`; anonymous guard + presentation-gate tests green; `tsc --noEmit` clean.

---

## PR2 — Section outline + navigation (parallel, Track A)

**Owns:** `inspector/SectionOutline.tsx` + a small nav helper. Consumes frozen contracts; touches no pane/editor/wrapper file.

**Scope:**
- Build `OutlineRow[]` precisely (spec §3.2 / Codex fix #9): from the current stage's primary + carried lineups (`lib/viewbook/public-data.ts` ordering), reinsert hidden rows in lineup order, exclude `pc-thanks` before `pcCompletedAt`, future-stage rows in the `'future'` group.
- Search filter; each row: title, state pills (Visible/Hidden/Complete/Acknowledged), current-stage marker; click → `select(key,'manual-nav')` + `navigateToAnchor`.
- Fill `buildOutlineRows(operatorData, stage, pcCompletedAt)` (the seam PR1 froze) and the `SectionOutline` body reading it. Hidden rows are shown in-outline for orientation and select their section; the **actual** show/hide recovery mutation is NOT created here — the existing `HiddenSectionsList` stays functional and untouched until PR4 retires it. Deferred navigation: `navigateToAnchor` runs only once a target is mounted; calling it while hidden is a no-op.

**Tests:** `buildOutlineRows` ordering (primary+carried+hidden reinsertion, `pc-thanks` gate, future group); search; click selects (`select(key,'manual-nav')`) + navigates.

**Note:** PR2 does NOT touch `HiddenSectionsList.tsx` or any mutation controller — it owns only `SectionOutline.tsx` + a nav helper. The old recovery surface is retired atomically in PR4 (Codex fix #12), so there is never a moment with two show/hide owners.

---

## PR3 — Relocate inline editors into panes (parallel, Track B)

**Owns:** `inspector/InspectorPanes.tsx`, `InlineEditors.tsx`, `OperatorSectionWrapper.tsx` + their tests.

**Scope:**
- Move the six controllers from `InlineSectionEditors` (`SectionTextInlineEditor`, `WelcomeNoteInlineEditor`, `MilestoneQuickEditor`, `ThemeInlineEditor`, `DocsInlineEditor`, `DataSourceInlineEditor`) into `InspectorPanes`, one pane per section, **all mounted**, keyed by section identity; selected pane visible, rest `hidden`/`inert`. Controller internals (autosave/baseline-sync/stale/amendment) unchanged.
- Each controller additionally reports to `useSectionActivityContext().report(sectionKey, editorId, snap)` (keeps its existing `useEditorActivity` call too — the two are independent).
- `OperatorSectionWrapper` stops rendering `InlineSectionEditors` below the section (leaves `SectionQuickControls` in place for now — PR4 removes it) and gains a `data-operator-section` target the outline can scroll to + highlight.
- Group panes by intent (Content/Status/Assets/Data/Documents); "Status" group is a placeholder slot PR4 fills.

**Tests migrated:** `InlineEditors.test.tsx` (assert pane structure + mounted-while-hidden instead of below-section `<details>`), `OperatorSectionWrapper.test.tsx` (no panels below; target attribute present; presentation gate still bare).

---

## PR4 — Section status into panes + drop the rail + retire old recovery (serial, after BOTH PR2 and PR3)

**Owns:** `InspectorPanes.tsx` (re-touch), `SectionQuickControls.tsx`, finish `OperatorSectionWrapper.tsx`, **`HiddenSectionsList.tsx` + the `OperatorViewbookLayer.tsx` edit removing its render** + their tests.

**Scope:**
- Move `SectionQuickControls` status actions (Show/Hide, Mark done/Reopen, Reset ack, state pills, `pc-thanks` gate) into the inspector's per-section **Status** group as the single mutation owner. The outline (PR2) surfaces hidden sections and can expose a "Show" that renders a second *view* over this one controller/context — never a second controller.
- **Atomically retire the old recovery path:** remove `HiddenSectionsList` from `OperatorViewbookLayer` and delete/gut `HiddenSectionsList.tsx` in the SAME PR that lands the outline's Status controller, so recovery is never available in two places or zero places (Codex fix #12).
- `OperatorSectionWrapper` becomes boundary-only (drops the rail entirely).
- Reset-ack stays warning-toned + confirm; optimistic rollback + `requestRefresh()` preserved.

**Tests migrated:** `SectionQuickControls.test.tsx` (inspector Status-group placement + single owner; `pc-thanks`/ack gating; optimistic rollback); `HiddenSectionsList` recovery coverage moves to the outline/Status controller.

---

## PR5 — Bar slim + inspector shell polish (parallel with PR3/PR4, after PR1)

**Owns:** `OperatorBar.tsx`, `OperatorInspector.tsx` shell polish + their tests. Disjoint from PR3/PR4 files.

**Scope:**
- Slim `OperatorBar` to workflow/stage/preview/theme-toggle (keep the `#vb-operator-bar` id, sticky, measured). Section-level controls now live in the inspector, so the bar sheds them.
- Inspector shell polish: responsive right-rail↔bottom-sheet, collapse/expand, canvas-fit toggle clearly distinct from preview-as-client, docks below the published `--vb-sticky-offset`, presentation-gate absence.

**Tests:** bar keeps id + sticky + measured; slimmed content; inspector responsive/collapse; canvas-fit ≠ preview; gate absence.

---

## PR6 — Integration + a11y + anonymous verification (serial, last)

**Owns:** integration/a11y tests + manual verification only; no component behavior change.

**Scope:** cross-component selection↔outline↔panes integration; keyboard/focus order + screen-reader labels for the inspector, outline, and sheet; re-assert the anonymous-byte-shape guard end-to-end; run `/verify` driving the operator route on a real branded theme (desktop rail + mobile sheet + preview-as-client round-trip). Fold in any a11y fixes surfaced.

---

## Self-review (against spec)

- Spec §3.1 tree change → PR1 (wiring) + PR3/PR4 (wrapper reduction). ✓
- §3.2 SelectionContext/useSectionActivity/useSectionSelection/OperatorInspector/SectionOutline/InspectorPanes → PR1 contracts + PR2/PR3/PR4 bodies. ✓
- §3.2 sticky dual-publish → PR1. ✓  §3.2 outline inventory precision → PR2. ✓  §3.2 hidden single-owner → PR2+PR4 seam. ✓
- §3.3 editors relocated verbatim → PR3; status relocated → PR4. ✓
- §3.4 theme-only preview, text deferred, no preview PR → reflected (no PR5-preview). ✓
- §3.5 navigateToAnchor reuse → PR2. ✓
- §5 tests migrate per behavior PR → PR2/PR3/PR4 each migrate own; PR6 integration only. ✓
- §2 C1–C6 → Global Constraints, enforced per PR. ✓
- §7 ordering + single-owner-per-file-per-phase → Lane model. ✓

No spec requirement is left without a PR. PR2–PR6 detailed TDD steps are expanded from this doc after PR1 freezes the §Interface-freeze contract.
