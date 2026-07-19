# Viewbook Operator Editor — "Context Lens" Design

**Status:** Active · **Date:** 2026-07-18
**Scope:** Replace the inline operator editing motion on the live public viewbook page (`components/viewbook/public/OperatorLayer/`) with a **Context Lens** paradigm — one persistent inspector docked beside the live canvas.
**Authors:** Claude (Opus 4.8) + Codex (research: `docs/superpowers/specs/2026-07-18-viewbook-operator-editor-codex-research.md`).
**Change boundary:** Presentation + client-side interaction only. **No API-contract, persistence-semantics, read-model, or anonymous/client-render changes.**

---

## 1. Problem & decision

The 2026-07-17 modernization polished the operator layer but kept its motion: a **control rail above** every section, the **live section** in the middle, and **collapsed form panels below** it, with hidden-section recovery and global stage controls elsewhere. Kevin's four confirmed pains all trace to that motion:

1. **Interaction model** — editing is location-driven; you interpret the section/component layout before acting.
2. **Disconnected from result** — the control and the thing it changes are often a viewport apart; only theme currently previews live.
3. **IA / findability** — a section's controls are split (rail above + panels below), plus the bar and the hidden-section list; you must know which section owns a control and whether it's above or below.
4. **Visual / feel** — toolbar + status pills + form cards interleaved with client content; reads as an internal tool bolted onto the page.

**Chosen paradigm (Kevin, 2026-07-18): Context Lens.** The live viewbook stays the canvas; a single persistent operator **inspector** docks beside it (right rail on desktop, bottom sheet on mobile). It carries a searchable **section outline** and a **contextual pane** of the selected section's controls, grouped by intent. Scroll tracks context; focusing/dirtying a field pins it; high-value fields preview live on the canvas via the theme-store draft precedent.

Rejected: **Edit the Page** (direct manipulation — highest ceiling, but rebuilds the text primitive, stresses the anonymous byte-shape boundary, still needs a panel for invisible actions, hard on mobile/a11y) and **Command Deck** (Kevin ruled out). Context Lens is not a dead end for either: object click-to-edit and a command trigger can later layer on the same selection/registry foundation.

**Non-goals:** any change to operator API routes, request/response bodies, autosave debounce/flush, stale-version semantics, locked-baseline amendments, the sync/refresh protocol, or the public/anonymous render. No drag-reorder, no new create/delete scope, no ER-staff usability test gate (Kevin chose to build).

---

## 2. Non-negotiable constraints (carried from research §3)

Any implementation MUST preserve these — they are architectural behavior with existing regression coverage, not preferences:

- **C1 — Presentation gate.** `OperatorViewbookLayer` keeps the semantic `if (!initialized || presenting)` early return (`OperatorViewbookLayer.tsx:48`) and each `OperatorSectionWrapper` keeps its own gate (`OperatorSectionWrapper.tsx:34`). In preview-as-client and pre-init, the bare public tree renders — no bar, no inspector, no outline, no selection outline, no draft overlay. `PresentationToggle`'s "Return to editing" pill is the sole operator affordance while presenting.
- **C2 — `#vb-operator-bar` stays mounted & singular in edit mode.** `StickyOffsetProbe` measures that exact ID via `ResizeObserver` (`OperatorBar.tsx:68`). The bar may be slimmed; it may **not** be renamed, duplicated, or replaced by a hidden measured twin. The inspector must not break the sticky-offset chain.
- **C3 — Anonymous byte shape stays operator-free.** The anonymous branch returns plain `ViewbookShell` and never loads `loadOperatorViewbookData` (`page.tsx:76-94`; test `page.test.tsx:38-95`). Public section components render the client artifact ONLY; operator surfaces compose as **separate client islands** in the verified operator branch. **No `operatorMode` prop is threaded into public components.** The inspector is a sidecar, not an intrusion.
- **C4 — Active editor blocks background replacement.** Every controller keeps a mount-stable `useEditorActivity` ID; dirty/focused/saving/uploading/conflict states stay active; `useViewbookSync` refreshes only when the registry is idle. Moving an editor between visual targets must never unregister it.
- **C5 — Off-context editors stay mounted.** Changing selection, closing the sheet, or collapsing a group hides an editor via `hidden`/`inert` — it never unmounts, so drafts, timers, upload state, conflict state, and registry ownership survive. **No "render only the selected editor."**
- **C6 — Domain gates stay visible & enforced.** `pc-thanks` absent before `pcCompletedAt`; done-able / ack-able section sets; hidden-section recovery even without a canvas target; explicit ack reset + stage force-advance confirm; locked amendment + stale-version pause/retry; explicit upload/delete/create; `requestRefresh()` after structural/file changes; server authority over persisted values.

---

## 3. Architecture

### 3.1 Component-tree change

**Today:**
```
OperatorViewbookLayer
  OperatorBar (sticky #vb-operator-bar)
  HiddenSectionsList
  children = [ OperatorSectionWrapper(section)  for each section ]
                 SectionQuickControls  (rail above)
                 <live public section>
                 InlineSectionEditors  (panels below)
```

**Context Lens:**
```
OperatorViewbookLayer  (owns selection context + inspector)
  OperatorBar (sticky #vb-operator-bar, slimmed → workflow/stage/preview/theme-toggle)
  children = [ OperatorSectionWrapper(section) for each section ]   ← selection/target boundary ONLY
                 <live public section>        (no rail, no panels in the flow)
  OperatorInspector  (single, docked; right rail ≥lg, bottom sheet <lg)
     ├─ SectionOutline   (searchable; visible + hidden + carried + status)
     └─ InspectorPanes   (ALL sections' editors mounted; selection toggles hidden/inert)
            per selected section, grouped by intent: Content · Status · Assets · Data · Documents
  OperatorDraftOverlay   (operator-only client-side live preview; below the gate)
```

### 3.2 New modules (under `components/viewbook/public/OperatorLayer/inspector/`)

- **`SelectionContext.tsx`** — React context holding `{ selectedKey, setSelected, pinState, pin(reason), release() }`. **Presentation-safe (Codex fix #5):** the `Provider` is mounted in `OperatorViewbookLayerContent` **outside** the visual early-return so it exists whether or not chrome renders, AND `useSelectionContext()` returns a safe no-op default when called outside a provider. Every wrapper calls the hook **unconditionally, before** its presentation gate — hooks must never be called only after a conditional return. Single source of truth for which section the inspector shows.
- **`useSectionActivity.ts`** — a **per-section activity registry** keyed by `(sectionKey, stableEditorId)` (Codex fix #2). Each relocated controller reports its own dirty/focused/saving/uploading/conflict state under its stable id; the registry aggregates per section. This is what selection pinning reads — the existing page-global `useEditorActivity` exposes only whole-page idle state and CANNOT say *which* section is busy, so it stays **unchanged** and keeps guarding `router.refresh()`. The two registries are independent: `useSectionActivity` drives pinning; `useEditorActivity` drives the sync no-clobber.
- **`useSectionSelection.ts`** — passive `IntersectionObserver` scroll-spy that sets `selectedKey` to the section most in view **only when not pinned**. **Observes; never mutates section height, collapse, or `<details>` open state** (avoids the prior observer-driven "blink" incident, research §6). Selection-vs-pin resolution (Codex fix #3):
  - **Dirty / saving / conflicted section → hard pin.** Another outline click may navigate/highlight the canvas but must NOT replace the visible inspector pane until that section's aggregate activity resolves.
  - **Focus-only section → soft.** A new selection blurs/flushes the current field, then switches once its activity clears.
  - **Manual clean selection → temporary navigation pin,** released after the target becomes the dominant in-view section or a bounded timeout elapses.
  - Release is driven by a section's **aggregate** activity (from `useSectionActivity`) reaching zero — never by a single editor reporting "saved."
- **`OperatorInspector.tsx`** — the dock shell: responsive frame (fixed right rail on `lg+`, collapsible bottom sheet below), collapse/expand affordance, and a "canvas-fit" toggle explicitly **distinct** from preview-as-client (fit narrows the edit canvas; preview-as-client remains the exact unmodified full render — the only trustworthy client check). **Sticky offset (Codex fix #1):** `StickyOffsetProbe` today writes `--vb-sticky-offset` onto `[data-vb-theme-root]`, but the inspector is a sibling *outside* that root. The probe is amended to publish the measured variable to **both** `[data-vb-theme-root]` and `document.documentElement`, so the inspector inherits it — still **one** probe and **one** `#vb-operator-bar`, no second measurement path.
- **`SectionOutline.tsx`** — searchable inventory built precisely (Codex fix #9): from the **current stage's primary + carried lineups**, with hidden rows **reinserted in lineup order**, excluding `pc-thanks` before `pcCompletedAt`; any future-stage sections shown live in an explicitly **non-current** group, never presented as current work. Each row shows state pills (Visible/Hidden/Complete/Acknowledged) + current-stage marker. **Absorbs `HiddenSectionsList`** into the one findability surface. **Single mutation owner (Codex fix #6):** an outline row does NOT render its own `SectionQuickControls`; it *selects/focuses* the pane's single Status controller. If one-click "Show" from the outline is kept, the show/hide mutation lives in **one** controller/context with two views rendered over it — never two independent controllers. After a Show + refresh mounts the (previously hidden) canvas target, THEN `navigateToAnchor` runs; calling it while the section is still hidden is a no-op, so navigation is deferred until the target exists.
- **`InspectorPanes.tsx`** — hosts the relocated editors for ALL sections, every pane permanently mounted and keyed by section/editor identity; the selected section's pane is visible, the rest are `hidden`/`inert`. This is the **persistent state host** satisfying C5 — panes are **never conditionally rendered** on selection change (only their visibility flips), so `useEditorActivity`/`useSectionActivity` registration and autosave timers survive selection switches. Panes are grouped by intent (Content / Status / Assets / Data / Documents) rather than by component file.

### 3.3 Editors: relocated, not rewritten

The existing controllers in `InlineEditors.tsx` (`SectionTextInlineEditor`, `WelcomeNoteInlineEditor`, `MilestoneQuickEditor`, `ThemeInlineEditor`, `DocsInlineEditor`, `DataSourceInlineEditor`) keep their autosave/baseline-sync/stale-version/amendment logic **verbatim**. The refactor only changes *where they render* (into inspector panes) and *how they're chromed* (grouped, no `<details>` sandwich). `SectionQuickControls`' status/hide/done/reopen/ack actions move into each section's **Status** group in the inspector; `OperatorSectionWrapper` stops rendering the rail and the panel stack and becomes a selection/target boundary (a `data-operator-section` wrapper the outline can scroll to + highlight).

### 3.4 Live preview — theme only (text preview deferred)

**Codex fix #4 (important correction):** the theme live-preview precedent works *because* theme values are CSS variables on a stable root (`[data-vb-theme-root]`) — `ThemeDraftWriter` writes draft vars there before persistence, cleanly and reversibly. Section intro/narrative, welcome note, and milestone text are **server-rendered React-owned text nodes with no operator-only replacement seam.** An external overlay could only change them via imperative `textContent` mutation or portals into React-owned nodes — brittle, prone to duplicate visible values, and it would push operator concerns into the public/anonymous markup (violating C3). So:

- **Keep** theme live preview exactly as it works today (`theme-store.ts` / `ThemeDraftWriter`).
- **Defer** copy/milestone live text preview out of this pass. The tight-result loop for text comes instead from the inspector keeping the target section **visible beside** its control plus **highlight-on-select** via `navigateToAnchor` — not per-keystroke text mutation.
- If live text preview is later deemed required, it needs its own spec: explicit **server-composed preview slots** with stable operator-only targets, and an amendment to C3/non-goals. It is out of scope here and there is **no dedicated preview PR** in §7.

Persistence, autosave, and conflict semantics are unchanged; the operator still sees saved text on the next idle `requestRefresh()`, exactly as today.

### 3.5 Navigation & highlight

Reuse the existing `navigateToAnchor` / `vb:navigate` primitive (already opens Earlier-Steps/`<details>` ancestors, scrolls, and flashes a target) for outline→canvas navigation and for pin-jump. No second navigation path.

---

## 4. Data flow (unchanged)

`operatorData` (the full `OperatorViewbookData`) is loaded once server-side and passed to `OperatorViewbookLayer`, which now hands it to the single inspector instead of scattering slices to per-section wrappers. All mutations continue to hit the existing operator API routes with unchanged bodies; `requestRefresh()` still fires after structural/file changes; `ViewbookSyncClient` polling/refresh gating is untouched.

---

## 5. Testing strategy

**Keep green (do not touch):**
- Anonymous byte-shape guard (`app/(public)/viewbook/[token]/page.test.tsx`) — no operator markers, no operator read-model in the anonymous branch.
- Client-canvas light-only guardrails (`SectionAccents.test.tsx`, `ProgressNav.test.tsx`, `ViewbookShell`/`PcIntroSection`/`EarlierSteps` no-`dark:` assertions).
- Autosave/baseline-sync/stale-version unit behavior in the relocated editors (assert unchanged).

**Update (migrate expectations — with the PR that changes the behavior, Codex fix #8):**
- Tests pinning the per-section rail + below-section panel layout (`SectionQuickControls.test.tsx`, `InlineEditors.test.tsx`, `OperatorSectionWrapper.test.tsx`) migrate to assert the inspector-pane structure and mounted-while-hidden behavior **in the same PR that relocates that file** — not deferred to a final test PR. Each behavior PR (PR2–PR4) must land independently gate-green, which is impossible if its obsolete tests are left failing for a later lane.

**Add:**
- Selection model: scroll-spy selects context but never mutates layout/collapse; click selection is authoritative; pin engages on focus/dirty and blocks scroll re-selection; release on save.
- Panes stay mounted across selection changes (extend the existing mounted-while-collapsed regression); stable `useEditorActivity` IDs survive selection switches.
- Outline inventories visible + hidden + carried; hidden Show action works; `pc-thanks` gating honored.
- Draft-overlay reconciliation: live preview updates on type; commit reconciles to server value; conflict retains draft + shows retry.
- Presentation gate: inspector, outline, draft overlay all absent in preview-as-client and pre-init.
- `#vb-operator-bar` still measured; inspector docks below the measured offset without a second sticky instance.

Gates: `tsc --noEmit` + vitest per lane (multi-agent skill), plus a manual verify pass (`/verify`) driving the operator route on a branded theme before merge.

---

## 6. Risks & mitigations

1. **Context jitter** — scroll-spy selecting the wrong section near boundaries. → Click selection authoritative; pin during active edits; hysteresis/threshold in the observer; never re-select while pinned.
2. **Canvas occlusion / unrepresentative breakpoint** — a dock covering content or implying a false client width. → Collapsible dock + bottom sheet on mobile; canvas-fit clearly labeled and separate from preview-as-client (the exact full render stays one toggle away).
3. **Two visible values during reconciliation** — largely avoided this pass: text live preview is deferred (§3.4), so only theme preview mutates the canvas, and its committed/draft lifecycle already exists and is proven. → No new text-overlay reconciliation surface is introduced.
4. **Registry release on relocation** — moving a controller could briefly unregister it and let a queued refresh clobber a draft (C4). → Persistent pane host; stable keyed IDs; panes never conditionally rendered on selection change (visibility flips only), so both `useEditorActivity` and `useSectionActivity` registrations survive.
5. **Sticky-offset regression (C2)** — inspector interfering with the measured bar. → Keep a single `#vb-operator-bar`; inspector reads the published offset; responsive tests.

---

## 7. Tandem PR decomposition (Codex fix #7)

Two agents (Claude + Codex), disjoint file sets after a shared foundation, mirroring the last modernization's lane model. The full shared-file hazard set is: `OperatorViewbookLayer.tsx`, `OperatorSectionWrapper.tsx`, `OperatorInspector.tsx`, `InspectorPanes.tsx`, `InlineEditors.tsx`, `HiddenSectionsList.tsx`, `SectionQuickControls.tsx`. The sequence below assigns **exactly one owner** per file per phase so no two lanes edit the same file concurrently. Each behavior PR migrates its own tests (fix #8); the final PR holds only cross-component/a11y/anonymous/manual coverage.

- **PR1 — Foundation (SERIAL, blocks everything; freezes all shared props/interfaces).** Selection + per-section-activity contracts (`SelectionContext`, `useSectionActivity`, `useSectionSelection`), **placeholder** `SectionOutline` + `InspectorPanes` (typed shells, no editors yet), composed `OperatorInspector` shell, `OperatorViewbookLayer` wiring behind the presentation gate, and the **dual-scope sticky-offset publication** in `StickyOffsetProbe`. Existing inline motion still renders; nothing functional changes yet. The frozen component props are the contract both parallel lanes build against and must not revise.
- **PR2 — Section outline + navigation (parallel, Track A).** Owns **only** `SectionOutline` + navigation/highlight (`navigateToAnchor` reuse, deferred-navigation-after-Show). Consumes the frozen contracts; touches no pane/editor/wrapper file.
- **PR3 — Relocate inline editors into panes (parallel, Track B).** Owns `InspectorPanes` + `InlineEditors` + `OperatorSectionWrapper` (stops rendering the below-section panel stack; becomes a selection/target boundary). All panes mounted, visibility-flipped. Migrates `InlineEditors.test.tsx` + `OperatorSectionWrapper.test.tsx`.
- **PR4 — Section status into panes + drop the rail (SERIAL, after PR3).** Owns `InspectorPanes` + `SectionQuickControls` (status/hide/done/ack move into the Status group; single mutation owner for hidden-recovery per fix #6); `OperatorSectionWrapper` finishes as boundary-only. Migrates `SectionQuickControls.test.tsx`. Serial because it re-touches `InspectorPanes` after PR3.
- **PR5 — Bar slim + responsive/presentation polish (after PR1; can run parallel to PR3/PR4 — disjoint files).** Owns `OperatorBar` (slim; keep `#vb-operator-bar` id) + `OperatorInspector` shell polish (canvas-fit vs preview escape hatch, mobile sheet ergonomics, presentation-gate integration).
- **PR6 — Integration + a11y + anonymous-byte-shape verification (SERIAL, last).** Cross-component integration, focus order/keyboard/screen-reader, the anonymous-branch guard, and a manual `/verify` pass on a branded theme. No component behavior changes here.

**No dedicated draft-preview PR** — text live preview is deferred (§3.4); theme preview is unchanged.

Ordering summary: **PR1 → (PR2 ∥ PR3 ∥ PR5) → PR4 (after BOTH PR2 and PR3) → PR6 (last).** Every shared file has a single owner within each phase. PR4 also owns retiring `HiddenSectionsList` (its recovery can't be removed until the outline exists).

---

## 8. Open taste calls (flagged, not blocking — default chosen)

- **Dock side:** right rail on desktop (default) vs left. → Right (matches inspector conventions; TOC FAB owns bottom-right on mobile, so the sheet handle sits bottom-left/− centered).
- **Live-preview scope:** RESOLVED by Codex fix #4 — theme only this pass; text preview deferred to its own spec.
- **Default selection on entry:** first visible section (default) vs. current-stage section. → First visible.
