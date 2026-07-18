# Viewbook ER Editing Mode — UI/UX Modernization Design

**Status:** Active · **Date:** 2026-07-17 · **Lane:** `feat/viewbook-edit-modernize`
**Author:** Codex (design pass, read-only) · **Reviewed by:** Claude (Opus 4.8)
**Scope:** Presentation-layer modernization of BOTH ER-employee viewbook editing surfaces
(operator inline overlay + admin dashboard). No data-flow, API-contract, or public-client-view changes.

---

## Claude review — decisions (read this first)

I reviewed Codex's proposal against the actual code and the test suite. **Accepted overall** — the
proposal is careful about every load-bearing seam (presentation gate, `#vb-operator-bar` sticky ID,
anonymous byte shape, autosave/live-sync, keeping panels mounted-while-collapsed). The following
named decisions/refinements apply on top of Codex's proposal and govern implementation:

1. **Test guardrails (correctness fix — Codex was too broad).** Codex wrote "tests asserting absence
   of `dark:` ... will need to be rewritten." That is only partly right. Two disjoint sets exist:
   - **KEEP GREEN (do not touch):** the *client-canvas* light-only guardrails — `SectionAccents.test.tsx`
     (`not.toContain('dark:')`), `ProgressNav.test.tsx` (`never emits a dark: class`), and the
     no-`<details>`/no-`dark:` assertions on `ViewbookShell`/`PcIntroSection`/`EarlierSteps`. These
     ENFORCE design principle #2 (never darken the client view). They must stay passing.
   - **UPDATE:** only the *operator/admin editing* tests that pin the old styling —
     `OperatorLayer/InlineEditors.test.tsx:306` (asserts `details[data-operator-inline-editor]` is
     `open`), plus admin `<details>`-interaction tests (`ContentTab.test.tsx`, `sections-data.test.tsx`
     locked-row `<details>`) that must migrate to the new controlled disclosure.
2. **Q1 disclosure default → collapsed-by-default. DEFER auto-opening the in-view section** (it couples
   disclosure state to scroll position; out of scope for a presentation pass).
3. **Q2 operator `ThemeToggle` in the bar → APPROVED** (low risk; the public route renders no app topbar).
4. **Q3 mixed light/dark composition → APPROVED in principle** (navy operator chrome around a light client
   canvas intentionally signals "editor vs. client output"). This is the one genuine visual-taste call —
   flagged for Kevin to eyeball on a real branded theme; NOT an implementation blocker.
5. **Q10 scope boundary → HELD.** Drag-and-drop milestone reordering, URL-addressable admin tabs, bulk
   field actions, and new search/filter are OUT of this pass. Presentation layer only.
6. **Sequencing within one worktree.** Codex's "lanes run in parallel" assumes separate agents/worktrees.
   In this single worktree, Claude drives Codex lane-by-lane with `tsc --noEmit` + vitest gates between
   lanes. Lane 1 (shared primitives) lands first; Lanes 2–3 (operator) are highest value and go next.

Everything below is Codex's verbatim proposal.

---

## Codex design proposal (verbatim)

# Viewbook ER Editing Modernization — Design Proposal

Read-only design pass complete. No files were changed. The proposal is grounded in the requested operator/admin components, the public rendering seam, `useViewbookSync`, and established patterns in `AuditIndexTabs`, `SiteAuditToolbar`, `StatusPill`, and other dark-mode-clean app components.

## 1. Design principles

- **App-owned chrome, client-owned canvas.** Operator controls should clearly belong to ER SEO Tools—Source Sans/Barlow, navy surfaces, teal actions—while the live viewbook remains visually identical to the client experience.
- **Dark-mode parity without darkening the viewbook.** The public `ViewbookShell` intentionally stays light and brand-driven. Only operator chrome responds to the global `.dark` class.
- **Progressive disclosure with visible state.** Editing controls should be easy to find but not compete with the live content. Panels collapse cleanly and expose dirty, saving, saved, conflict, and error states in their headers.
- **One interaction language.** Inputs, status pills, disclosures, secondary actions, destructive actions, focus rings, and save feedback should look and behave consistently in both operator and admin surfaces.
- **Preserve behavioral seams.** No changes to API contracts, read models, autosave serialization, live-sync registration, anonymous rendering, or presentation-mode gating.
- **Responsive by construction.** Toolbar actions, editor grids, disclosures, and fixed controls must work at mobile widths without colliding with the existing TOC FAB.

## 2. Surface 1 — Operator overlay

### Operator token recipe

The operator layer should explicitly apply the app font and colors because inline controls currently sit beneath the public viewbook’s `fontFamily: var(--vb-body-font)` scope.

| Element | Proposed direction |
|---|---|
| Primary chrome | `font-body bg-white/95 text-navy dark:bg-navy-deep/95 dark:text-white` |
| Editor card | `rounded-xl border border-gray-200 bg-white shadow-sm dark:border-navy-border dark:bg-navy-card` |
| Nested well | `bg-gray-50/70 dark:bg-navy-deep/40` |
| Muted text | `text-gray-500 dark:text-white/55` |
| Fields | `rounded-lg border-gray-300 bg-white text-navy placeholder:text-gray-400 dark:border-navy-border dark:bg-navy-light dark:text-white dark:placeholder:text-white/35 dark:[color-scheme:dark]` |
| Focus | `focus-visible:border-teal-600 focus-visible:ring-2 focus-visible:ring-teal-500/30` with an appropriate light/dark ring offset |
| Primary action | `bg-teal-600 text-white hover:bg-teal-700` |
| Secondary action | `border-gray-300 bg-white text-navy hover:bg-gray-50 dark:border-navy-border dark:bg-navy-card dark:text-white/80 dark:hover:bg-navy-light` |
| Warning | `bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300` |
| Error | `bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300` |

Keep the `max-w-5xl` inner alignment for section-level controls. That width is not arbitrary: `ProgressNav`, `SectionShell`, `SectionReveal`, and the public section headings all use it. Modernization should come from hierarchy and surface treatment, not misaligning edit controls from the content they affect.

### `OperatorViewbookLayer.tsx`

**Current problem:** The composition and presentation gate are sound, but there is no visual boundary defining which elements are app chrome versus public content.

**Proposal:**

- Preserve `PresentationModeProvider` and the exact `!initialized || presenting` branch.
- Keep the wrapper visually transparent. Do not put a background or font class on the outer layer, because that would cascade into the public view.
- Require each operator-owned child root to apply `font-body` explicitly.
- Do not move `HiddenSectionsList` or the toolbar inside `ViewbookShell`; the current server/client composition protects the anonymous byte shape.
- Leave `ThemeDraftWriter`, `theme-store`, `operator-api`, and operator read-model plumbing untouched.

### `OperatorBar.tsx`

**Current problems:** It resembles a generic white utility strip; stage, identity, navigation, and presentation actions have nearly equal weight. It also lacks a theme control even though the public route does not render the normal app topbar.

**Proposal:**

- Retain `id="vb-operator-bar"`, `sticky top-0`, and mounting/unmounting behavior. `StickyOffsetProbe` measures that exact ID.
- Use an app-style glass toolbar: `border-gray-200 bg-white/90 shadow-sm backdrop-blur-md dark:border-navy-border dark:bg-navy-deep/90`.
- Left cluster:

  - Small teal status dot or badge.
  - `ER editing` in `font-display font-bold`.
  - Stage via the existing `StatusPill` visual language.
  - Operator email as secondary metadata, truncating gracefully on small screens.

- Right cluster:

  - Roll back as a secondary button.
  - Advance as the only primary-filled action.
  - Presentation mode as a secondary mode button.
  - Reuse the existing `ThemeToggle` so an operator can change the chrome theme on this otherwise app-shell-less route.

- On mobile, allow metadata to occupy the first row and actions the second; preserve a stable minimum control height.
- Render errors as a full-width tinted alert row beneath the controls instead of a loose red text line.
- Show a small `Updating stage…` live status while busy rather than changing only the Advance label.

### `OperatorSectionWrapper.tsx`

**Current behavior worth preserving:** Controls appear before the public section and editors after it, while the bare public child is returned during initialization, presentation mode, or anonymous use.

**Proposal:**

- Keep the wrapper layout-transparent; do not outline or recolor the client section itself.
- Continue placing quick controls above and editors below the section so operators see the client result between the two pieces of chrome.
- Optionally add only structural data/group classes on the wrapper for focus-within coordination.
- Preserve the early return exactly. No operator container, focus ring, spacing, or empty wrapper should survive presentation mode.

### `SectionQuickControls.tsx`

**Current problems:** The full-width teal strip is visually loud, displays machine keys, and does not clearly summarize current state. All actions look alike.

**Proposal:**

- Replace the teal-on-teal strip with a neutral app-owned control rail:

  - `border-y border-gray-200 bg-gray-50/95 dark:border-navy-border dark:bg-navy-deep/95`.
  - `font-body`, inner `max-w-5xl`.
  - Slightly larger `py-2.5` spacing.

- Import the existing client-safe `SECTION_TITLES` mapping rather than showing raw keys such as `pc-setup`.
- Lead with `Editing section` as muted eyebrow text and the readable title as the primary label.
- Add state pills:

  - Active → neutral “Visible”
  - Hidden → warning “Hidden”
  - Done → success “Complete”
  - Acknowledged → secondary success indicator where applicable

- Style Show/Hide and Done/Reopen as compact secondary buttons. Keep Reset acknowledgment visibly warning-toned.
- Add `aria-live` busy feedback; disable the action group while a mutation is in flight.
- Preserve `NOT_DONEABLE`, `ACKABLE`, `pc-thanks` gating, optimistic rollback, and all request bodies unchanged.
- Support an `embedded` visual variant for use in the hidden-section recovery list so it does not render a full nested rail.

### `HiddenSectionsList.tsx`

**Current problems:** The amber banner is large, machine-key-oriented, and nests the teal quick-controls band inside white cards.

**Proposal:**

- Keep this affordance highly visible because it is the only recovery path for sections excluded from public rendering.
- Use a compact warning card immediately below the operator bar:

  - Header: “Hidden sections” plus count pill.
  - Supporting text: “Hidden from the client view.”
  - Responsive list of compact rows showing readable section title, state, and a direct Show action.

- Use `bg-amber-50 dark:bg-amber-500/10`, subtle amber border, and neutral inner rows using app card tokens.
- Do not collapse the entire recovery list by default. Discoverability is more important than saving a small amount of vertical space.
- Avoid nesting the normal full-width `SectionQuickControls`; use its compact/embedded presentation or extract the shared state actions.

### `InlineEditors.tsx`

#### Shared `EditorPanel`

**Current problem:** Every editor uses an always-open native `<details>`, producing a long, visually undifferentiated editing tail. Native disclosure styling also differs by browser.

**Proposal:**

- Replace `<details open>` with a controlled, accessible disclosure card:

  - Real `<button>` header with `aria-expanded` and `aria-controls`.
  - Chevron SVG, title, optional description, and status area.
  - Rounded app card with a separated body well.
  - Independent panels, not a forced single-open accordion.

- Repeated panels should default collapsed. Their headers remain prominent enough to advertise “Edit section copy,” “Edit milestones,” and so on.
- Keep panel contents mounted while collapsed. Conditionally unmounting would destroy drafts, autosave timers, or editor-activity registration.
- Dirty, saving, paused/conflict, and error states should keep the panel open or prevent silent closure.
- Use `focus-within:border-teal-500/60 focus-within:ring-2 focus-within:ring-teal-500/15` for a restrained active-editor indication.

#### Welcome and section copy

- Give fields explicit labels plus short helper text explaining where copy appears.
- Use readable section titles in panel names.
- Place save-state feedback in the panel header/status line rather than adding vertical “Saving…” text beneath every textarea.
- Preserve current autosave debounce and blur flush.

#### Milestone quick editor

- Replace naked three-column inputs with milestone subcards.
- Card header: milestone title and semantic status pill.
- Edit grid: labeled Title, Status, Target date; Description spans the full width.
- Use `upcoming/current/done` values unchanged, but display human-readable labels.
- Keep operator scope unchanged: edit existing milestones only; creation, deletion, and reordering remain admin concerns.

#### Theme editor

- Divide the body into Colors, Typography, and Assets.
- Make color swatches larger and pair them with readable hex values.
- Keep search and font selection grouped per heading/body font.
- Replace the nested “Section hero images” `<details>` with the same controlled disclosure pattern.
- Render asset rows with section title, uploaded/not-uploaded status, and a styled file affordance.
- Add a quiet note that theme changes preview directly on the live viewbook.
- Preserve `ThemeDraftWriter`, draft-store behavior, asset endpoints, and autosave.

#### Strategy PDFs

- Separate “Global playbooks” from “This viewbook” so ownership is obvious.
- Present existing documents as compact file rows with title, optional blurb, source badge, and a restrained destructive button.
- Place the upload form in a nested well with Title, optional Blurb, and File labels.
- Use the existing DropZone visual language as reference, but do not modify its multiple-file behavior merely to reuse it.
- Keep upload and deletion explicit rather than autosaved.

#### Data Source

- Add a visible Open/Locked context callout at the top.
- Present the custom-field creator as a secondary “Add custom field” panel rather than the first dominant form.
- Field cards should show label, type, category, and version as metadata.
- Visually distinguish:

  - Editable baseline answer
  - Locked baseline value
  - Operator amendment draft
  - Recorded amendment history
  - Stale-version conflict

- Convert the stale-version message into an amber conflict panel with “Your draft was kept” and a clear Retry action.
- Preserve version checks, amendment mode, `clientMutationId`, pause/resume behavior, and current list parsing.

### `PresentationToggle.tsx`

**Current problems:** “Edit” is ambiguous, its styling is disconnected from the toolbar, and the fixed bottom-right button collides with the mobile TOC FAB, which also uses that position and `z-50`.

**Proposal:**

- Keep provider initialization, localStorage key, safe default, and toggle semantics unchanged.
- In edit mode, render the control as part of the operator toolbar: “Preview as client” or “Presentation mode.”
- In presentation mode, render a higher-contrast floating pill labeled “Return to editing.”
- Move that restore control to `bottom-4 left-4`, including safe-area spacing. The existing TOC FAB owns bottom-right on mobile.
- Use a strong shadow, backdrop blur, full focus ring, and light/dark app tokens so it remains legible over arbitrary client colors.
- It must remain the only operator affordance rendered while presenting.

## 3. Surface 2 — Admin dashboard refinement

### Priority 1 — Editor shell and tabs

In `ViewbookEditor.tsx`:

- Turn the loose header into a compact editor masthead with client name, kind pill, stage pill, link state, and grouped public-view actions.
- Use “Open public view” as the main outbound action; keep Copy link secondary.
- Convert tabs to a proper `role="tablist"`/`role="tab"` pattern with `aria-selected`.
- Use an app-style segmented or contained tab bar based on `AuditIndexTabs`:

  - `bg-gray-100 dark:bg-navy-light`
  - Active tab: `bg-white shadow-sm dark:bg-navy-card`
  - Horizontal overflow on narrow screens instead of wrapping seven labels into uneven rows.

- Add a Feedback count badge using already-loaded thread data.
- Separate Settings visually from the content-authoring tabs, particularly its destructive section.

### Priority 1 — Milestone ergonomics

In `MilestonesEditor.tsx`:

- Replace the current flex row and inline `<span>` edit form with stacked milestone cards.
- Summary row: order number, title, status pill, due date, secondary blurb, actions.
- Expanded edit area: labeled grid, with Description full width and explicit Save/Cancel footer.
- Preserve numeric ordering in this pass; style Order as a real labeled field. Up/down controls can be a later behavior change if desired.
- Demote status-transition actions to compact secondary buttons; keep Edit primary within the row.
- Require confirmation before Delete.
- Add a clear empty state and place “Add milestone” in its own bordered creation row.

### Priority 1 — Data Source clarity

In `DataSourceTab.tsx`:

- Keep the lock banner first, but strengthen its hierarchy with an icon/status pill and separate consequence text.
- Show computed summary metadata: active fields, categories, amendments, and locked/open state.
- Make category groups into card sections with readable titles and field counts.
- Separate archived fields into a subdued “Archived fields” disclosure rather than interleaving opacity-reduced cards with active work.
- In locked field cards, present the baseline as read-only content and amendments as a small timeline beneath it.
- Make “Add custom field” a contained secondary panel.
- Normalize all buttons, messages, field focus states, and dark-mode native controls.

### Priority 2 — Theme and content

In `ThemeEditor.tsx` and `ThemePreview.tsx`:

- Use a responsive two-column layout: controls on the left, sticky bounded preview on the right at desktop widths.
- Group colors, typography, logo, and hero assets into separate cards.
- Keep the preview’s client canvas explicitly light and brand-driven; only its enclosing admin frame changes in dark mode.
- Replace the hero-image `<details>` with the shared controlled disclosure.

In `ContentTab.tsx` and `StrategyDocsCard.tsx`:

- Establish ordered sections: Strategy PDFs, Welcome, Section copy, Client overrides.
- Use the shared editor panel for section copy and overrides.
- Clearly distinguish inherited global content from per-client overrides.
- Show override state in panel headers: “Using global content” versus “Client override.”
- Keep existing explicit Save and Remove actions.

### Priority 3 — Supporting surfaces

- **Feedback:** Split Open and Resolved feedback visually, add counts, stronger resolve feedback, and a handled error state.
- **Activity:** Render `createdAt`, kind badge, actor, and summary as a compact timeline rather than generic cards.
- **Settings:** Divide Project workflow, Assignment, Notifications, Section visibility, Link management, and Danger zone into cards. Advance should use teal primary styling; revoke remains amber; delete remains red.
- **Global content:** Add a visible “Affects every viewbook” notice, strengthen section cards, and make team-member rows responsive.
- **Viewbook index:** Improve row hover, status pills, revoked/archived differentiation, and primary editor action. Keep the table for desktop with responsive overflow.
- **Viewbook card:** Turn the existing inline metadata into a clearer status summary with one primary “Open editor” action.
- **Strategy docs:** Use the same document-row and upload treatment as the operator editor.

## 4. Cross-cutting editing patterns

Create narrowly scoped viewbook primitives rather than a general app-wide component library:

- `ViewbookEditorPanel`: controlled disclosure, title, description, status slot, accessible expand/collapse, mounted content.
- `ViewbookEditorStatus`: visual states for Dirty, Saving, Saved, Conflict, and Error. It consumes state already available in each editor; it must not alter `useAutosave`.
- Shared field and action recipes: either small local primitives or exported class constants for labels, inputs, textareas, primary buttons, secondary buttons, and destructive buttons.
- Reuse existing `StatusPill` for stages, visibility, milestone status, locked state, and counts.
- Reuse `ThemeToggle` in the operator toolbar.
- Use `focus-within` for local visual focus and existing `useEditorActivity` for sync protection. Do not conflate the two.
- Show dirty state with a small amber dot or “Unsaved” label, saving with teal progress, saved with a brief green confirmation, and conflicts/errors with persistent semantic panels.
- Keep structural and destructive mutations explicit. Continue autosaving only fields already using `useAutosave`.

## 5. Implementation sequencing

After the shared foundation lands, most lanes can proceed in parallel without editing the same files.

| Order | PR/lane | Files | Rationale |
|---|---|---|---|
| 1 | Shared viewbook editor primitives | New files under `components/viewbook/editor/` plus tests | Establishes disclosure/status/token contracts without touching current behavior. |
| 2 | Operator frame and controls | `OperatorBar`, `OperatorViewbookLayer`, `OperatorSectionWrapper`, `SectionQuickControls`, `HiddenSectionsList`, `PresentationToggle`, colocated tests | Highest-visibility dark-mode correction; file-disjoint from the large form editor. |
| 3 | Operator inline editors | `InlineEditors.tsx`, `InlineEditors.test.tsx` | Modernizes all forms while leaving operator chrome and shared sync untouched. Can run parallel with Lane 2 after Lane 1. |
| 4 | Admin shell and milestones | `ViewbookEditor.tsx`, `MilestonesEditor.tsx`, their tests | Fixes navigation hierarchy and the weakest admin editing ergonomics. |
| 5 | Admin Data Source and content | `DataSourceTab.tsx`, `ContentTab.tsx`, `StrategyDocsCard.tsx`, their tests | Cohesive information-architecture pass across baseline/amendment and inherited/override concepts. |
| 6 | Admin theme | `ThemeEditor.tsx`, `ThemePreview.tsx`, tests | Self-contained controls/preview layout lane. |
| 7 | Supporting admin polish | `FeedbackTab`, `ActivityFeed`, `GlobalContentEditor`, `ViewbookIndex`, `ViewbookCard`, tests | Lower-risk consistency work after the main editing surfaces settle. |
| 8 | Integration/accessibility verification | Presentation/public route tests and visual QA only | Verifies anonymous byte shape, presentation hiding, dark mode, responsive behavior, focus order, and sticky offsets. |

No lane should modify `useViewbookSync.ts`, `operator-data.ts`, the public page composition, or public section rendering. Existing tests that explicitly assert the absence of `dark:` classes and the always-open `<details>` element will need to be rewritten as modernization expectations.

## 6. Risks and open questions

1. **Disclosure default:** I recommend collapsed-by-default inline panels. Kevin should confirm whether the primary section-copy panel should instead open automatically for the section currently in view.
2. **Operator theme control:** I recommend adding the existing `ThemeToggle` to the operator bar. It changes only ER chrome; the client canvas remains intentionally light.
3. **Mixed light/dark composition:** In dark mode, navy operator islands will sit around a light client viewbook. That contrast is intentional and communicates “editor versus client output,” but should be visually reviewed on real branded themes.
4. **Sticky measurement:** `#vb-operator-bar` must remain mounted only in edit mode and retain its ID. Toolbar wrapping is safe because `StickyOffsetProbe` uses `ResizeObserver`, but responsive testing is required.
5. **Collapsed editors and sync:** Controlled panels must hide without unmounting. Unmounting a dirty editor could discard a draft or temporarily release its live-sync registration.
6. **Presentation mode:** Every new piece of operator chrome—including theme toggle, status indicators, alerts, and hidden-section recovery—must remain below the existing presentation gate. The fixed restore button is the sole exception.
7. **Mobile fixed-control collision:** Move “Return to editing” to bottom-left. Bottom-right is already occupied by the mobile TOC FAB.
8. **Readable section names:** Use the existing `SECTION_TITLES` mapping rather than introducing a second label map or changing the operator read model.
9. **Save-state consistency:** A shared visual status component can consume existing local state, but extending `useAutosave` solely for presentation should be avoided unless separately approved.
10. **Scope boundary:** Drag-and-drop milestone ordering, URL-addressable admin tabs, bulk field actions, and new search/filter behavior would improve usability but are interaction/features beyond this presentation-layer pass.
