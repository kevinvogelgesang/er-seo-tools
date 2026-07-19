# Viewbook Inline Operator Editor — Interaction Paradigm Research

**Status:** Research recommendation, not an implementation spec  
**Date:** 2026-07-18  
**Scope:** The ER-staff operator layer rendered on the live public viewbook page (`components/viewbook/public/OperatorLayer/`)  
**Change boundary:** Analysis only. No code, API, persistence, or anonymous/client-render changes are proposed here.

## 1. Executive finding

The presentation modernization shipped on 2026-07-17 made the operator layer more coherent, accessible, and app-like, but deliberately preserved its original interaction model. The operator still edits through a sequence of control rails and collapsed form panels placed around the public page:

1. A section action rail appears before each visible public section.
2. The client result renders in the middle.
3. One or more collapsed editor panels appear after the section.
4. Hidden sections are recovered from a separate list near the top of the page.
5. Global workflow controls remain in the sticky operator bar.

That motion explains all four stated pains. The editor is physically on the live page, but the editable object and its control are usually separated by an entire section; control location follows implementation ownership rather than the operator's immediate intent; and the repeated rails/cards still behave like a generic form system.

The three strongest genuinely different replacement paradigms are:

| Paradigm | Editing motion | Best quality | Effort |
|---|---|---|---|
| **1. Edit the Page** | Click the visible content itself and edit it in place | Tightest WYSIWYG loop and most bespoke feel | L |
| **2. Context Lens** | Keep the live page as the canvas while one persistent inspector follows or pins to the selected section | Best balance of usability, constraint safety, and buildability | M |
| **3. Command Deck** | Search for an editing intent, jump to its target, and edit in a compact command workspace | Fastest findability for experienced operators | L |

**Recommendation:** prototype **Context Lens** first. It changes the editing motion substantially without requiring the public section components to become operator-aware. It can reuse the existing editors, autosave state machines, API contracts, and in-page navigation primitive while centralizing findability and keeping the result continuously visible. This is a code-informed recommendation, not a validated usability result; a short staff task test should decide whether it advances to a design spec.

## 2. What the operator does today

### 2.1 Verified composition

The public route first loads the public read model and verifies whether the session belongs to an operator. The anonymous branch returns the plain `ViewbookShell` and never calls `loadOperatorViewbookData` (`app/(public)/viewbook/[token]/page.tsx:76-94`). The operator branch loads the separate operator read model, server-composes each public section inside an `OperatorSectionWrapper`, then passes the complete server-rendered shell as `children` to `OperatorViewbookLayer` (`page.tsx:94-135`). No render function crosses the server/client boundary.

Within the operator branch:

- `OperatorViewbookLayer` owns the presentation provider, sticky bar, hidden-section recovery list, and public tree.
- `OperatorSectionWrapper` renders `SectionQuickControls`, then the unmodified public section, then `InlineSectionEditors` (`OperatorSectionWrapper.tsx:34-41`).
- `InlineSectionEditors` always offers section copy, then adds section-specific editors: welcome note, milestones, theme, strategy PDFs, or Data Source (`InlineEditors.tsx:1009-1023`).
- The panels default collapsed, but their children remain mounted using a `hidden` region rather than conditional rendering (`ViewbookEditorPanel.tsx:48-58`; regression coverage in `InlineEditors.test.tsx:363-379`). A dirty, errored, or conflicted panel forces itself open.
- `HiddenSectionsList` is the only visible recovery path for a hidden section because hidden sections do not enter the public `primarySections` or `carriedSections` arrays (`lib/viewbook/public-data.ts:55-74`).
- `ViewbookSyncClient` is the page's one refresher. It polls the token-scoped sync version and refreshes only when the editor-activity registry is idle.

### 2.2 Current persistence semantics

The UI currently has three different mutation classes. A redesign must express them clearly rather than making every action look equally immediate.

| Mutation class | Current examples | Required behavior |
|---|---|---|
| Autosaved value edits | Welcome note, section intro/narrative, milestone fields, theme values, unlocked Data Source answers | Serialized 600 ms trailing debounce, blur flush, stable editor registration, refresh only after the queue drains |
| Explicit structural or file actions | Stage movement, section show/hide/done/reopen, acknowledgment reset, asset upload, PDF upload/delete, custom-field creation | Deliberate action with busy/error feedback; no accidental autosave conversion |
| Explicit concurrency-sensitive edits | Locked-baseline amendments and stale-version retry | Preserve amendment mode, `clientMutationId`, the local draft on conflict, and the explicit retry/record action |

Theme editing is the one existing truly immediate preview path. `theme-store.ts` keeps committed and draft theme state separately, while `ThemeDraftWriter` writes draft CSS variables and the font URL into the live theme root before persistence completes. That is a useful precedent for a broader operator-only preview bridge, but it is not permission to bypass `useAutosave` or server authority.

### 2.3 Why the four pains survive the modernization

| Pain | Current mechanism that creates it |
|---|---|
| **1. The interaction model feels wrong** | Editing is location-driven through repeated rails and disclosures. The operator must interpret the system's section/component boundaries before acting. |
| **2. Editing is disconnected from the result** | Quick controls sit above the result and forms sit below it. A long public section can put the field and its rendered output more than a viewport apart. Only theme drafts currently preview per keystroke. |
| **3. IA and findability are weak** | Controls are split among the top bar, hidden-section list, every section rail, and section-specific panels. The operator must remember both the owning section and whether the action lives above or below it. Carried sections can also sit inside closed Earlier Steps disclosures. |
| **4. The visual/feel remains generic** | The interaction vocabulary is still toolbar + status pills + buttons + form cards. Better styling cannot make that motion feel like editing a client artifact directly. |

## 3. Non-negotiable redesign constraints

These constraints are architectural behavior, not preferences.

### C1. Presentation mode is a hard operator-chrome gate

`OperatorViewbookLayer` must retain the semantic equivalent of the exact `if (!initialized || presenting)` early return (`OperatorViewbookLayer.tsx:48`). Before local storage initializes and while previewing as the client, the pre-composed public tree renders without the operator bar, section wrappers, hidden-section recovery, editor targets, inspector, command UI, selection outlines, or preview overlays. `PresentationToggle`'s “Return to editing” control remains the sole operator affordance while presenting.

Every new operator surface must therefore live below the gate or independently read the same presentation context and return no chrome.

### C2. `#vb-operator-bar` remains mounted in edit mode

The sticky operator bar must keep `id="vb-operator-bar"` (`OperatorBar.tsx:68`). `StickyOffsetProbe` queries that exact ID, measures its live height with `ResizeObserver`, observes its presentation-mode mount/unmount, and publishes the cumulative sticky offset. A redesign may simplify the bar or move controls out of it; it may not rename the ID, create multiple instances, or leave a visually hidden measured duplicate.

### C3. Anonymous byte shape remains operator-free

The anonymous route must continue to return plain `ViewbookShell` before the operator loader runs. It must not serialize the operator email/read model and must not render or hydrate operator components, markers, hit targets, command registries, draft stores, or control labels. Existing regression coverage checks both the branch type and the absence of operator markers (`app/(public)/viewbook/[token]/page.test.tsx:38-95`).

The safest design rule is: **public section components render the client artifact; the verified operator branch composes separate client islands around or alongside it.** Adding an `operatorMode` prop throughout public components would weaken this boundary and needs a much stronger justification than interaction convenience.

### C4. An active editor must block background replacement

Every editing controller must keep a mount-stable ID registered through `useEditorActivity`. Dirty, focused, saving, uploading, conflict, and other in-progress states must remain active as they do today. `useViewbookSync` may coalesce pending changes, but it must not call `router.refresh()` until the registry is genuinely idle (`useViewbookSync.ts:1-115`, `250-403`, `439-689`).

This matters especially for paradigms that move an editor between visual targets. Reparenting, changing a keyed ID, or conditionally replacing the active controller can briefly unregister it and release a held background refresh into an in-progress draft.

### C5. Collapsed, off-context, or inactive editors stay mounted

Changing section selection, closing a popover, collapsing an inspector group, or dismissing a command sheet must hide the editor without destroying its draft, timer, upload state, conflict state, or registry ownership. Use mounted hidden/inert regions or a persistent state host. Do not render only the currently selected editor.

If an active draft makes a context switch unsafe, the UI should pin that editor or flush/resolve it before switching; it should not unmount it as a side effect of navigation.

### C6. Existing domain gates remain visible and enforceable

Any new interaction language must preserve:

- `pc-thanks` absence before `pcCompletedAt`;
- the current done-able and acknowledgment-able section sets;
- hidden-section recovery even though the section has no public canvas target;
- explicit acknowledgment reset and stage force-advance confirmation;
- locked Data Source amendment semantics and stale-version pause/retry;
- explicit upload/delete/create operations;
- `requestRefresh()` after successful structural/file changes;
- server authority over persisted values.

## 4. Candidate field and selection

The research considered direct content editing, floating per-section toolbars, a contextual inspector, a command/omnibar editor, a guided linear workflow, and split-screen edit/preview.

- **Floating per-section toolbars** are an affordance within direct manipulation, not a distinct paradigm. On their own they preserve the current “find the section control strip” model.
- **Split-screen edit/preview** is the fixed-layout version of a contextual inspector. The inspector is stronger for this route because it can collapse on narrow screens and leave preview-as-client as the exact full-canvas check.
- **Guided linear step-through** is valuable for first-time setup or QA, but it is weak as the primary mid-workflow editor. Experienced staff making one change would have to traverse an imposed sequence. It is better considered later as a mode built on top of an editor, not the editor's base motion.

The remaining three change the unit of interaction in materially different ways:

- object-first: click the artifact;
- context-first: select a section and inspect it;
- intent-first: search for an action.

## 5. Paradigm 1 — Edit the Page

### Core interaction

The operator enters edit mode and works directly on the client canvas. Editable text and objects reveal restrained hover/focus affordances. Clicking a welcome note, intro paragraph, milestone, logo, hero image, or section heading transforms that exact object into an in-place editor or opens an anchored object popover. A compact contextual toolbar near the selected section owns structural actions such as Hide, Mark done, and Reset acknowledgment.

The visible artifact is the editing surface:

1. Hover or keyboard-focus reveals editable targets.
2. Click/Enter selects the object and exposes the smallest viable control.
3. Typing changes the object in place immediately.
4. Existing autosave persists in the background and exposes local saving/error state beside the object.
5. Escape exits object editing without destroying a dirty controller; structural actions remain explicit.

Complex collections do not become raw `contenteditable` blobs. A milestone can edit its simple text in place but use an anchored popover for status/date. Locked Data Source answers open an anchored amendment composer because the baseline itself is not directly mutable. PDF and asset operations use object-specific popovers.

### How it addresses the four pains

| Pain | Response |
|---|---|
| **Interaction model** | Replaces “find a panel representing the object” with “select the object.” The artifact, not the component hierarchy, becomes the primary noun. |
| **Live/WYSIWYG loop** | Strongest possible loop: draft and result occupy the same pixels. Autosave state is secondary feedback rather than a separate working surface. |
| **IA/findability** | Local actions appear where their object lives. A lightweight global outline still handles hidden sections and global stage/theme actions that have no visible target. |
| **Visual/feel** | Feels like an editorial/design tool tailored to viewbooks rather than an internal CRUD form. Operator chrome can nearly disappear until intent is expressed. |

### What changes from the current approach

- Remove the always-present full-width `SectionQuickControls` rails from the document flow.
- Remove the post-section panel stack as the primary editor surface.
- Add operator-only object selection, focus, target geometry, and anchored controls.
- Keep a compact global outline for hidden sections and controls with no on-canvas object.
- Move save/conflict feedback from panel headers to the selected object or its popover.
- Treat the current editor components as persistent controllers/state hosts rather than visible cards.

### Constraint stress and compatibility

This paradigm most stresses **anonymous byte shape, hydration, and mounted editor lifetime**.

- Keep the anonymous page branch unchanged. Operator target discovery and overlays must be loaded only in the verified operator branch.
- Reuse stable public anchors where they already exist: section IDs and field/milestone/document anchors. Exact text targets that lack stable anchors require an explicit operator-only composition design; do not quietly add operator markers or client editor dependencies to anonymous section output.
- Mount a persistent operator editing-state host keyed by stable editor IDs. Object popovers are views onto those controllers, not the controllers themselves.
- Keep the entire overlay beneath the presentation gate. The selected outline and all target affordances must disappear in preview-as-client mode.
- Keep `#vb-operator-bar`, likely reduced to workflow status, global navigation, and preview controls.
- Use the existing autosave and activity registration unchanged. Direct draft rendering is optimistic presentation; persistence remains server-authoritative.

### Effort

**L.** This requires a target model, operator-only hit testing/anchoring, keyboard and screen-reader semantics, persistent controller hosting, and special handling for text, collections, files, locked data, hidden sections, and responsive touch interaction.

### Top risks

1. **Contenteditable and hydration correctness.** Pasting, IME input, selection retention, browser normalization, and React reconciliation can corrupt or jump plaintext edits unless the editable primitive is very narrowly controlled.
2. **Operator targeting leaks into the public surface.** The easiest implementation path is to make public components operator-aware; that is also the path most likely to weaken the anonymous byte-shape boundary.
3. **Mobile and accessibility complexity.** Hover does not exist on touch, anchored controls can obscure their target, and object-level keyboard navigation needs a deliberate, testable model.

## 6. Paradigm 2 — Context Lens

### Core interaction

The live viewbook remains the main canvas. A persistent operator inspector sits at the right edge on wide screens and becomes a bottom sheet on narrow screens. It has two coupled layers:

1. A searchable section outline showing visible, hidden, complete, acknowledged, current-stage, and Earlier Steps sections.
2. A contextual inspector showing the controls for the selected section, organized by operator intent: Content, Status, Assets, Data, and Documents as applicable.

Scrolling updates the current section using passive intersection tracking; clicking a section or object selects it directly. Once an operator focuses or dirties a field, the inspector pins to that section until the edit is saved, resolved, or deliberately released. The canvas highlights the selected target and stays visible beside the controls.

For the tight result loop, the inspector uses an operator-only draft preview bridge. Simple copy and milestone drafts update the selected rendered target immediately, following the theme store's committed-versus-draft precedent. Existing autosave still owns persistence; errors restore or retain the draft according to the current editor's semantics. Preview-as-client remains the exact unmodified rendering check.

### How it addresses the four pains

| Pain | Response |
|---|---|
| **Interaction model** | Replaces repeated local rails/panels with one stable “select context, inspect it” motion familiar from professional design and CMS tools. |
| **Live/WYSIWYG loop** | The target stays visible while its control remains in a fixed location. Draft preview makes the canvas respond immediately without asking the operator to scroll below the section. |
| **IA/findability** | One searchable outline inventories every section, including hidden and carried sections. Within a section, controls are grouped by intent rather than by component file. |
| **Visual/feel** | A quiet canvas plus a purpose-built inspector reads as an authoring studio, not a chain of internal-tool cards inserted into client content. |

### What changes from the current approach

- `OperatorSectionWrapper` stops rendering a rail before and panels after every public section; it becomes a selection/target boundary only.
- `OperatorViewbookLayer` owns one centralized inspector and receives `operatorData` once.
- `HiddenSectionsList` becomes part of the persistent section outline rather than a separate warning block at the top.
- `InlineSectionEditors` are reorganized into mounted inspector panes. All panes remain in the DOM; selection controls visibility with `hidden`/`inert` rather than conditional rendering.
- Stage actions can remain in the bar; section state, copy, theme, documents, and Data Source controls live in the inspector.
- The current `navigateToAnchor` primitive can open Earlier Steps/details ancestors, dispatch `vb:navigate`, scroll, and flash a selected target instead of inventing a second navigation path.

### Constraint stress and compatibility

This paradigm most stresses **selection tracking, mounted pane management, and draft-preview reconciliation**, but it is the cleanest fit with the anonymous composition boundary.

- Render the inspector only inside the verified operator branch and beneath the existing presentation gate. Public section components remain unchanged.
- Keep all section panes mounted. A selected-pane switch changes hidden/inert state, not component identity. Dirty/focused/saving panes pin selection and keep their stable `useEditorActivity` IDs.
- Intersection tracking selects context only; it must never mutate section height or collapse state. This avoids repeating the prior observer-driven section “blink” failure.
- Preserve `#vb-operator-bar`. The bar can become slimmer because section controls move into the inspector, but its real measured height remains authoritative.
- Use overlay docking or an explicit canvas-fit mode carefully. The exact client viewport remains available through Preview as client; the edit canvas must not pretend a narrowed responsive breakpoint is the final client result.
- Treat the draft preview bridge as operator-only presentation state. `useAutosave`, stale-version pause/resume, structural request bodies, and `requestRefresh()` remain unchanged.

### Effort

**M.** The bulk of the form and mutation logic already exists. The primary work is centralizing ownership, building the outline/selection model, keeping all panes mounted, adding responsive inspector behavior, and introducing a narrow draft-preview bridge for the highest-value fields.

### Top risks

1. **Context jitter or surprise switching.** Scroll tracking can select the wrong section near boundaries. Pinning during active edits and making click selection authoritative are essential.
2. **Canvas occlusion and responsive distortion.** A dock can cover content or force an unrepresentative breakpoint. The inspector needs a collapsible overlay strategy and an explicit exact-preview escape hatch.
3. **Two visible values during preview reconciliation.** A local draft overlay and refreshed server tree can disagree after errors or external edits. The committed/draft lifecycle must be specified as carefully as the existing theme store.

## 7. Paradigm 3 — Command Deck

### Core interaction

The operator works from an intent-first command surface opened with a visible “Edit…” button or `Cmd/Ctrl+K`. The deck searches human language and current context:

- “welcome note”
- “hide assessment”
- “milestone target date”
- “brand primary color”
- “show strategy”
- “record amendment for school motto”
- “preview as client”

Choosing a command first navigates to and highlights its target using the existing in-page navigation primitive. The deck then becomes a compact command workspace containing only the fields and actions required for that intent while the target remains visible. Recent commands and context-sensitive suggestions reduce repeat work. Hidden-section commands remain searchable even though they have no canvas target.

This is not a chat or AI layer. It is a deterministic command registry with labels, aliases, availability predicates, target anchors, and renderers backed by the existing operator APIs and editors.

### How it addresses the four pains

| Pain | Response |
|---|---|
| **Interaction model** | Replaces browsing the interface with stating the intended operation. The operator need not know which section or panel owns a control. |
| **Live/WYSIWYG loop** | Selection scrolls to and highlights the result before the field opens. Draft changes preview on that target while the compact workspace stays out of the document flow. |
| **IA/findability** | Search spans global workflow, every section, hidden sections, objects, and actions. Synonyms and recent commands absorb differences between staff vocabulary and code terminology. |
| **Visual/feel** | A fast, editorial command surface feels purpose-built and expert-oriented; the client canvas remains dominant instead of being surrounded by persistent form chrome. |

### What changes from the current approach

- Remove per-section rails and panel stacks from the default document flow.
- Add a deterministic operator command registry that inventories every editable capability and its availability rules.
- Convert current editor UIs into persistent command workspaces addressable by stable command IDs.
- Use the bar for command entry, workflow status, and presentation mode; keep a visible non-keyboard entry point.
- Navigate and highlight before opening a command so the operator sees what will change.
- Keep a small section/status outline as a fallback for orientation, but not as the primary control browser.

### Constraint stress and compatibility

This paradigm most stresses **complete capability indexing, stable mounted command state, and discoverability**.

- The command registry and deck exist only in the operator branch below the presentation gate. The anonymous branch remains the plain shell.
- `#vb-operator-bar` is a natural home for the command trigger and stays measured normally.
- Commands must encode the same availability rules as the underlying UI: `pc-thanks`, done-able/acknowledgment-able sets, hidden status, lock state, and stage transitions. The server remains the final enforcement layer.
- Command workspaces stay mounted in a persistent host. Closing the deck hides it; it does not discard an active draft or unregister its stable editor ID.
- Reuse `navigateToAnchor` for visible/carried targets and provide explicit no-target handling for hidden sections and global actions.
- Keyboard shortcuts enhance the visible UI; they cannot be the only route. The deck needs full focus management, mobile behavior, and screen-reader labeling.

### Effort

**L.** The mutation logic is reusable, but a reliable command registry must cover every capability, alias, permission/gate, target, status, and responsive/accessibility behavior. The draft-preview and navigation integration are also new.

### Top risks

1. **Weak discoverability for occasional users.** An omnibar can optimize recall while hurting recognition. Visible suggested actions, categories, and a non-keyboard trigger are mandatory.
2. **Registry drift.** A command can appear available when the underlying domain gate says otherwise, or a new capability can ship without a command. The registry needs shared predicates and coverage tests rather than duplicated strings.
3. **Modal context switching.** If the deck grows into a large floating form, it recreates the disconnected-panel problem in a modal. Each command must remain narrow and keep the highlighted target visible.

## 8. Comparative assessment

Scores are directional hypotheses based on the verified code and Kevin's four stated pains, not user-test results.

| Criterion | Edit the Page | Context Lens | Command Deck |
|---|---:|---:|---:|
| Interaction-model change | 5/5 | 4/5 | 5/5 |
| Tight live/result loop | 5/5 | 4/5 | 3/5 |
| IA and findability | 4/5 | 5/5 | 5/5 |
| Bespoke viewbook-editor feel | 5/5 | 4/5 | 5/5 |
| Compatibility with anonymous composition | 2/5 | 5/5 | 5/5 |
| Reuse of current editor logic | 2/5 | 5/5 | 3/5 |
| Mobile/accessibility tractability | 2/5 | 4/5 | 3/5 |
| Delivery risk | High | Medium | High |

### Why Context Lens is the best first prototype

Context Lens attacks the wrong motion directly: operators stop traversing rails and panels embedded throughout the document and instead keep one control surface beside the live result. It solves findability without requiring command recall, and it substantially improves result connection without making public section markup own operator behavior.

It also has the clearest migration path:

- existing APIs and persistence semantics stay intact;
- existing editor components can move into mounted inspector panes before being redesigned internally;
- hidden sections naturally join the outline;
- `navigateToAnchor` already handles carried sections and closed `<details>` ancestors;
- the theme draft store provides a proven local-preview pattern to study;
- the public route's anonymous/operator split remains structurally unchanged.

The first prototype should remain a pure Context Lens test rather than immediately blending all three paradigms. Direct object shortcuts and a command deck could later sit on the same selection/registry foundation, but adding them during the prototype would make it impossible to learn which motion actually helped staff.

## 9. Suggested prototype test

Before a design spec, test a low-fidelity Context Lens prototype with ER staff on six representative tasks:

1. Change a section intro and confirm where it appears.
2. Update a milestone title and target date.
3. Hide a visible section, then restore it.
4. Change a brand color and verify the live effect.
5. Record an amendment to a locked Data Source field.
6. Enter Preview as client and return to the same editing context.

Measure time to first correct control, unnecessary scroll distance, wrong-panel openings, lost context after save/refresh, and operator confidence that the client will see the intended result. Compare against the shipped section-rail/panel-stack editor. A successful prototype should reduce search and context-switching without causing draft loss, accidental structural actions, or confusion about edit-mode versus client-mode rendering.

## 10. Concise summary of the three paradigms

- **Edit the Page:** select and edit the visible object itself. Best WYSIWYG experience and strongest bespoke feel, but highest risk to targeting, hydration, accessibility, and anonymous composition.
- **Context Lens:** select or scroll to a section while one persistent inspector follows and stays pinned during edits. Best overall balance and the recommended first prototype.
- **Command Deck:** search for an editing intent, jump to the target, and work in a narrow command workspace. Best expert findability, but it must overcome discoverability and registry-drift risk.
