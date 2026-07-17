# Viewbook v2 PR8 — ER Inline Editing Layer — Codex Brief

Self-contained brief for the Codex lane (v1 tandem model). Everything you need is in this file + the repo at your worktree HEAD. Claude runs gates and commits; leave your work UNCOMMITTED in the worktree.

**Branch/worktree:** `feat/viewbook-v2-pr8` at `.claude/worktrees/viewbook-v2-pr8`
**Spec:** `docs/superpowers/specs/2026-07-16-viewbook-v2-stages-design.md` §10 (ER inline layer), §12 (security), §6 (live sync)
**Program:** `docs/superpowers/plans/2026-07-16-viewbook-v2-program.md` (wave 4)

## The wave-4 coordination rule (read FIRST — this is not disjoint)

Wave 4 runs two lanes concurrently: PR5 (post-contract stage, Claude) and PR8 (this). **They both touch the public page + section rendering, so they are NOT disjoint.** The rule (program file-ownership map, wave 2's PR2→PR4 shape):

- **PR5 merges FIRST.** It owns `lib/viewbook/stages.ts`, the pc-* section components, the three new public routes, the ack-reset route, `service.ts` creation flip + stage-move `force`, and the `app/(public)/viewbook/[token]/page.tsx` `renderSection` pc-* cases.
- **PR8 stays on LEAF files while implementing** — build everything under `components/viewbook/public/OperatorLayer/**` (new dir) and `components/viewbook/public/PresentationToggle.tsx` (new) as standalone, unit-tested components. Do NOT edit `app/(public)/viewbook/[token]/page.tsx`, `ViewbookShell.tsx`, `SectionShell.tsx`, or ANY section component (pc-* or otherwise) during implementation.
- **The page/session integration is done at REBASE time** (after PR5 merges), by Claude, from your documented "rebase markers." So: implement the operator components + presentation toggle as leaf units now; describe EXACTLY how page.tsx should compose them (which prop, which wrapper, where the operator bar mounts) in your handoff. Claude performs the page.tsx edit during the rebase and wires it up. **You never edit pc-* files** (spec + program rule) — affordance slots are injected by a WRAPPER that composes around the section render output, never by editing the sections.

## Repo rules that bind every change

- **The public token surface gains NOTHING (spec §10, §12).** Every inline control calls an EXISTING cookie-gated `/api/viewbooks/[id]/*` route (stage, sections/[sectionKey], milestones, fields, overrides, docs, csm, lock, review-links, and PR5's `ack/[sectionKey]` DELETE). PR8 adds **NO** new API route, **NO** new public matcher, **NO** `middleware.ts` change, and **NO** new MUTATION of viewbook data → the program-wide **sync-bump merge gate is vacuously satisfied** (you introduce no new write path; the existing cookie-gated routes already bump). The ONE permitted server addition is the **read-only** operator read-model loader `loadOperatorViewbookData` (Unit B point 5) — a `SELECT`-only lib function, no route, no write, invoked server-side only on the verified-operator page branch. Confirm this explicitly in your handoff. If you find yourself adding a write path or a route, STOP — you've left scope.
- **Server-side gate — zero operator data to anonymous viewers (spec §12).** The operator layer renders ONLY when a verified-email session is present. Non-ER viewers must receive NO operator markup, control, or session data in the HTML/RSC payload. The gate is server-side: the page already computes `operatorEmail` and only renders operator components when it is non-null. Presentation mode is cosmetic (client-side) and guards nothing.
- **Public surface is LIGHT-ONLY** — `ViewbookShell`/`SectionShell` use NO `dark:` variants (spec §6; their header comments state it). The operator layer renders on the public page, so its components are **light-only too** — do NOT use `dark:` variants (Codex caught this as a P2 in PR6). It's a distinct operator chrome (a subtle bar/overlay) but still on the light themed surface.
- **No jest-dom** — setupFiles is only `./test/setup-worker.ts`. Component tests use DOM-native assertions (`toBeTruthy`, `.textContent`, `querySelector`, `.not.toBeNull`, `fireEvent`) — never `toBeInTheDocument`/`toHaveTextContent`.
- **Live-sync edit guard (spec §6, PR2 contract).** Any operator editing island that holds focus / a dirty draft / an in-flight save MUST register via `useEditorActivity` (`components/viewbook/public/useEditorActivity.ts` — read it) so the `useViewbookSync` poller does not `router.refresh()` and clobber the draft. A mutation through a cookie-gated route bumps `syncVersion`; the public poller then refreshes for everyone. Follow how the existing public editing islands (`FieldEditor`, `AmendmentForm`, feedback, materials) register.
- Plain text everywhere; escape at render; no `dangerouslySetInnerHTML`.
- Tests: vitest + @testing-library/react (jsdom), `DATABASE_URL="file:./local-dev.db"` from the worktree root; follow each suite's existing fixture conventions (read a sibling test before writing). TDD per unit: failing test → implement → green.
- Array-form `$transaction([...])` only if you touch server code — but you should NOT be writing server mutations at all (see the first rule).

## What already exists (grounded in merged main @ 9dd3a30 — verify at your HEAD)

- **`lib/viewbook/public-session.ts`** (PR4) — the session helper you consume:
  ```ts
  export async function getOperatorEmailForPublicPage(): Promise<string | null> {
    if (isAuthBypassedInDev()) return 'dev@localhost'
    const cookieStore = await cookies()
    const session = await getAuthSession(cookieStore.get(AUTH_COOKIE_NAME)?.value)
    return session?.email ?? null   // verified-email only; break-glass has email null
  }
  ```
  It is **already called** in `app/(public)/viewbook/[token]/page.tsx` (parallel with `loadViewbookPublicData`) and currently collapsed to a boolean at ONE call site: `case 'kickoff-next': return <KickoffNextSection {...props} isOperator={operatorEmail != null} />`. The raw `operatorEmail` string is available; PR8's rebase widens its use.
- **`getAuthSession(value)`** (`lib/auth.ts:159`) takes the cookie VALUE (spec fix 9 — satisfied); `AUTH_COOKIE_NAME='er_auth'`; `requireOperatorEmail(request)` (`lib/viewbook/operator.ts:23`) is the route-side verified-email bar (throws 401). Do not re-implement session logic — reuse `getOperatorEmailForPublicPage`.
- **Cookie-gated routes the inline controls call** (all under `app/api/viewbooks/[id]/`): `stage` (POST `{direction, expectedStage, force?}` — PR5 adds `force`), `sections/[sectionKey]` (PATCH — hide/show/mark-done/intro/narrative; read it for the exact body), `ack/[sectionKey]` (DELETE — PR5's ack-reset), `milestones` (+ `[milestoneId]`), `fields`, `overrides`, `docs`, `csm` (PATCH), `lock`. Read each route's body contract before wiring a control to it.
- **Admin mutation pattern to mirror:** `jsonFetch<T>(url, init)` (`components/viewbook/admin/viewbook-admin-shared.ts:13-18`) throws `Error(body.error||…)` on non-2xx; callers do optimistic set + busy/error + `onChanged()` refresh (`CsmPicker.assign`, `GlobalContentEditor.tsx:231-249`). The public stage caller `KickoffNextButton.tsx:15-22` shows the public-side fetch + `requestRefresh()` seam. **Reuse `jsonFetch`** (it's not admin-only — it's a plain fetch wrapper) or mirror it in a small OperatorLayer fetch helper.
- **Existing admin editor components** (`components/viewbook/admin/**`) already implement the heavy editors (theme editor, content/intro/narrative, milestones editor, docs, fields/data-source, settings). The back-office `/viewbooks/[id]` editor **remains the sanctioned fallback for heavy ops** (spec §10). You do NOT need to rebuild these — see the scope split below.
- **`useViewbookSync`** (`components/viewbook/public/useViewbookSync.ts`) + the editor registry / `useEditorActivity` are the PR2 live-sync layer already mounted on the public page.

## Scope (exactly this)

### Unit A — Presentation-mode toggle (`components/viewbook/public/PresentationToggle.tsx`) [LEAF]

A `'use client'` floating control that hides the ENTIRE operator layer for screen-shares (spec §10):
- State persisted in `localStorage` per browser (a stable key, e.g. `vb-presentation-mode`); read on mount (guard SSR — no `window` at module scope; initialize in `useEffect`).
- **No persisted-mode flash (Codex fix 5):** do NOT render the full operator chrome before `localStorage` has been read. Use a `mounted`/`initialized` state (the `ThemeToggle`/`ThemeProvider` `mounted` pattern) so a browser whose last session was in presentation mode never briefly flashes the operator controls during hydration. Until initialized, render nothing (or the presenting state), never the full bar.
- When presentation mode is ON, the operator layer is hidden and a small unobtrusive re-enable affordance remains (a tiny corner button). When OFF, the full operator chrome shows.
- Keyboard-accessible: focusable button(s), visible focus ring, `aria-pressed`, and a keyboard shortcut is optional (if added, document it; ensure it doesn't collide with inputs).
- Expose the mode via a tiny context or a prop-drilled boolean so the operator wrapper (Unit B) reads it. Simplest: a `usePresentationMode()` hook returning `{ presenting, toggle }` backed by localStorage + a React context provider `PresentationModeProvider`. Light-only styling.
- Tests: default OFF (or last-persisted); toggle flips + persists to localStorage; re-enable affordance restores; `aria-pressed` reflects state.

### Unit B — Operator layer (`components/viewbook/public/OperatorLayer/**`) [LEAF]

A `'use client'` control set that renders operator affordances by calling EXISTING cookie-gated routes. Structure it as small components under `OperatorLayer/`:

1. **`OperatorBar`** — a slim top/inline bar shown when an operator session is present (and presentation mode is OFF): shows the current stage + `Advance` / `Roll back` buttons (calls `POST /api/viewbooks/[id]/stage` `{direction, expectedStage: currentStage, force?}`). Advancing forward out of `post-contract` when `pcCompletedAt` is null must confirm ("acknowledgments incomplete — advance anyway?") and re-POST with `force:true` (PR5 added `force` + the `409 ack_incomplete` contract — handle that error by offering the force confirm). Reuse `KickoffNextButton`'s fetch+`requestRefresh()`/error-surfacing shape. Include the presentation toggle affordance here.
2. **`SectionQuickControls`** — a per-section control strip (the affordance slot content): `Hide`/`Show` + `Mark done`/`Reopen` (via `PATCH /api/viewbooks/[id]/sections/[sectionKey]` — read its body contract) and, for ackable sections (`pc-setup`,`pc-invite`,`data-source`) that are acknowledged, a `Reset ack` (via PR5's `DELETE /api/viewbooks/[id]/ack/[sectionKey]`). Each control: optimistic/busy/error + `requestRefresh()` on success.
3. **`OperatorSectionWrapper`** — the affordance-slot mechanism. A component that takes `{ sectionKey, viewbookId, section, children }` and renders `children` (the real section) PLUS the `SectionQuickControls` for that section as an overlay/adjacent strip — WITHOUT editing the section component. This is what page.tsx composes around each `renderSection(section)` output at rebase time. It must be a pure wrapper: no operator markup leaks when the operator is absent (page.tsx only wraps when `operatorEmail != null`).
4. **Inline editors — ALL spec-§10 surfaces are REQUIRED inline (Codex fix 1 — do NOT downgrade to deep links).** §10 explicitly lists inline theme editing, strategy-doc management, and Data Source custom-field/answer affordances alongside the lighter ones — the back-office is the fallback for OTHER heavy ops (token rotate/revoke, delete, activity feed, feedback triage, sync-questions), NOT for these. Implement each inline by REUSING or thin-light-surface-ADAPTING the existing admin editor component (the admin editors already exist for every one of these); do NOT rebuild them, and do NOT settle for an "Edit in editor →" deep link for these surfaces:
   - **Welcome note** — inline edit of `welcomeNote` (reuse the admin welcome/SettingsTab write route).
   - **Section intro / narrative** — via `PATCH /api/viewbooks/[id]/sections/[sectionKey]` (narrative only where admin `ContentTab` exposes it — brand/assessment).
   - **Milestone quick edit** — status/title/date via the milestones route(s).
   - **Theme editor** (brand section) — reuse/adapt the admin theme editor inline (calls the existing theme write route).
   - **Doc management** (strategy) — reuse/adapt the admin docs editor inline (existing docs CRUD routes).
   - **Data Source custom-field + answer editing** — operator mode of the existing field/answer editors (existing fields routes).
   Each registers with `useEditorActivity` while dirty/focused/saving. All are LIGHT-ONLY (the admin components use `dark:` — when reusing on the public surface, strip/override `dark:` or wrap so the public render stays light-only; Codex caught the `dark:`-on-public regression in PR6). A deep-link to the back-office is acceptable ONLY for the genuinely-heavy ops listed above, never for these six.

5. **Operator-only read model (Codex fix 2 — required).** `loadViewbookPublicData` EXCLUDES hidden sections, so a wrapper around the rendered (visible) sections can never offer "Show" for a hidden one, and the inline editors above need editor-shaped data (all section states incl. hidden, theme, docs, fields, milestones) the public payload doesn't carry. Add a NEW server-side loader (a leaf file, e.g. `lib/viewbook/operator-data.ts`) `loadOperatorViewbookData(viewbookId)` that reads the existing tables (NO new write, NO new route) and returns the operator read model: all section states (incl. hidden — with a restore list), theme, docs, fields, milestones, `pcCompletedAt`, `clientNotifyJson`, team members. **It is invoked at REBASE time by page.tsx ONLY on the verified-operator branch, after `operatorEmail` is established — NEVER on the anonymous branch, and NEVER serialized into the anonymous payload.** Build + unit-test the loader on your leaf branch; the page wiring is Unit C.

All OperatorLayer components: light-only (no `dark:`), escape dynamic strings, reuse `jsonFetch` (or a mirrored helper) + `requestRefresh()` (the public single-refresher seam), register editing state via `useEditorActivity`. Hidden entirely when presentation mode is ON.

**Capability rules per section (Codex fix 6) — the quick-controls/editors must respect section semantics:**
- Hidden sections come only from the operator read model (Unit B point 5), rendered as a separate "hidden sections — Show" restore list (not as wrappers around visible sections).
- `pc-intro` and `pc-thanks` are NOT ackable and NOT "done"-able — expose NO ack/reset/mark-done controls on them; `pc-thanks` shows no state controls before completion.
- `Reset ack` appears ONLY on an ackable section (`pc-setup`,`pc-invite`,`data-source`) that is currently acknowledged.
- `Mark done`/`Reopen` only where the section supports a done state (mirror the admin section-state control's allowed set).

6. **Top-level integration API (Codex fix 3 — define the contract NOW, not at rebase).** Export ONE component `OperatorViewbookLayer` with EXACT props so the rebase is pure wiring, not interface design: `{ viewbookId: number; operatorEmail: string; stage: ViewbookStage; pcCompletedAt: string | null; operatorData: OperatorViewbookData; renderSection: (section) => ReactNode; children? }` (or the minimal superset you actually need — pin it precisely and document it). It composes: `PresentationModeProvider` → `OperatorBar` → the section flow where each section render is wrapped by `OperatorSectionWrapper` + the hidden-sections restore list. Add a **leaf integration test** that mounts `OperatorViewbookLayer` with a fixture `operatorData` and asserts the bar + a section's quick controls + a hidden-section restore entry all render. This is the single seam page.tsx consumes at rebase.

Tests (per component, DOM-native): OperatorBar renders stage + advance/rollback, advance-from-post-contract-incomplete triggers the confirm→force path (mock `jsonFetch`; simulate a `409 ack_incomplete` first response then success on force); SectionQuickControls hide/show/mark-done/reset-ack each POST/PATCH/DELETE the right URL+body (spy on fetch/`jsonFetch`) AND respect the capability rules (no ack control on pc-intro, reset-ack only when acknowledged); OperatorSectionWrapper renders children + controls, and renders children-only markup when told it's non-operator (belt-and-suspenders); every required inline editor (incl. theme/docs/data-source) saves via the right route and registers `useEditorActivity`; the hidden-sections restore list renders from the operator read model; `OperatorViewbookLayer` integration test; presentation-mode ON hides the layer.

### Unit C — Rebase-time integration markers (documented, NOT implemented by you)

You do NOT edit `page.tsx`. Instead, write PRECISE instructions in your handoff for Claude to apply during the rebase onto PR5's merge. **Make the two server branches explicit (Codex fix 4):**
- **Anonymous branch (`operatorEmail == null`):** render the EXISTING `ViewbookShell` directly, exactly as today. Do NOT load `loadOperatorViewbookData`, do NOT instantiate the presentation provider / operator bar / wrappers, and serialize NO operator data. This branch's output must be byte-unchanged from pre-PR8.
- **Operator branch (`operatorEmail != null`):** `await loadOperatorViewbookData(viewbookId)` (server-side, Unit B point 5), then render `OperatorViewbookLayer` (Unit B point 6) with `operatorEmail` (the string) + the operator data + the same `renderSection` closure. `OperatorViewbookLayer` composes the provider + bar + per-section `OperatorSectionWrapper` (wrapping each `renderSection(section)` output — NEVER editing a section file, incl. PR5's pc-*) + the hidden-sections restore list.
- Add an RSC/HTML assertion (spec §13) that the ANONYMOUS render output contains NO operator control markers AND no operator email / operator-data payload — the operator read model must not leak to non-ER viewers.

## Tests (write with the code, per unit)

- `PresentationToggle.test.tsx` / `usePresentationMode` — persist + restore + a11y.
- `OperatorLayer/OperatorBar.test.tsx` — stage controls incl. the force-confirm path on `409 ack_incomplete`.
- `OperatorLayer/SectionQuickControls.test.tsx` — each control hits the correct route/verb/body.
- `OperatorLayer/OperatorSectionWrapper.test.tsx` — wraps children + injects controls; no leak without operator.
- `OperatorLayer/OperatorViewbookLayer.test.tsx` — leaf integration: bar + a section's quick controls + a hidden-section restore entry all render from a fixture `operatorData`.
- `lib/viewbook/operator-data.test.ts` — the operator read model returns hidden sections + editor data; DB-backed.
- Inline-editor tests for ALL six required surfaces (welcome note, intro/narrative, milestone quick edit, theme, docs, data-source) — save via the right route + `useEditorActivity` registration; light-only render (no `dark:`).
- Capability-rule tests: no ack/reset on pc-intro/pc-thanks; reset-ack only when acknowledged.
- PresentationToggle: no operator-chrome flash before init.
- (rebase, applied by Claude) anonymous-payload snapshot: no operator markup AND no operator data/email for non-ER viewers.

## Out of scope (do NOT touch)

`app/(public)/viewbook/[token]/page.tsx` / `ViewbookShell.tsx` / `SectionShell.tsx` / ANY section component incl. pc-* (PR5 owns these; page/shell wiring is the REBASE step, applied by Claude from your markers) · `lib/viewbook/stages.ts` / `service.ts` / the public routes / ack-reset route / `middleware.ts` / `prisma/schema.prisma` (PR5 + prior waves) · any NEW API route or WRITE path (the token surface gains nothing — the read-only `loadOperatorViewbookData` loader is the one permitted server addition) · `lib/notify/**` · rebuilding the admin editors from scratch (REUSE/adapt them inline — do NOT deep-link the six required §10 surfaces) · SectionShell v2 / image pipeline / TOC / search (PR7).

## Definition of done

Units A + B (incl. the operator read-model loader + `OperatorViewbookLayer` contract + all six inline editors) implemented with tests; Unit C integration markers written precisely in `.superpowers/sdd/pr8-codex-handoff.md` (what you built, how each of the six §10 inline editors reuses/adapts its admin component, the exact `OperatorViewbookLayer` prop contract + page.tsx two-branch rebase instructions, confirmation of NO new route/matcher/write-path/bump — only the read-only loader, any decisions). Work left UNCOMMITTED in the worktree. Claude then: verifies gates (`npx tsc --noEmit`, `DATABASE_URL="file:./local-dev.db" npm test`, `npm run build`), commits, cross-reviews, **rebases onto PR5's merge**, applies the Unit-C two-branch integration, re-gates, fable + `codex exec review`, and merges PR8 second.
