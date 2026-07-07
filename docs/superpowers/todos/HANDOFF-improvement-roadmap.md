# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-07 (**A8 PR 2 — fixed-layout quick-start dashboard SHIPPED + DEPLOYED. Next action = write + execute the A8 PR 3 plan (widget editor: sizes + drag/keyboard reorder + localStorage persistence + reset).**) · **Updated by:** the A8 PR 2 execution session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap: A8 PR 3 — the homepage widget editor.

State: A8 PR 1 (left-sidebar app shell) SHIPPED + PROD-VERIFIED (PR #112). A8 PR 2
(fixed-layout quick-start dashboard) SHIPPED + DEPLOYED 2026-07-07 (PR #113, main
acbf96e). Live now: app/(app)/page.tsx renders <DashboardGrid/> from a fixed
DEFAULT_LAYOUT in lib/widgets/registry.tsx — 7 widgets (live-now, quick-site-audit,
quick-parser, quick-report, quarter-week, recent-parses, quick-robots) at fixed
sizes, each wrapped in WidgetErrorBoundary → spanClass div → WidgetFrame → Component.
The widget model (WidgetSize 'sm'|'wide'|'lg'|'xl', LayoutItem {id,size}, WidgetDef)
is in lib/widgets/types.ts; spanClass in lib/widgets/grid.ts; a shared ref-counted
queue poller in lib/widgets/queue-poll.ts. Spec (covers all A8 PRs, active through
PR 4): docs/superpowers/specs/2026-07-07-app-shell-redesign-design.md (§3.3 widget
system incl. edit mode). PR 2 plan archived at docs/superpowers/archive/plans/. NO
PR 3 plan yet — writing it is the first step.

PR 3 = the widget editor (spec §3.3 "Edit mode" + "Persistence"): a "Customize"
button toggles edit mode; each widget gets a size stepper (cycles its supported
sizes) and becomes draggable (native HTML5 DnD, same pattern as Quarter Grid
chips); drop reorders the layout array; grid auto-flows. Codex fix 8: ALSO render
move-up/move-down buttons per widget so reorder never requires a pointer (keyboard
a11y). "Reset layout" restores DEFAULT_LAYOUT. Persist to
localStorage('er-home-layout') = {version:1, items:[{id,size}]} in display order:
unknown ids dropped on load, missing registered widgets appended at defaultSize
(registry authoritative), malformed JSON → default, version bump resets. Order +
size ONLY (no free-form x/y). Desktop-only editing in v1; mobile inherits the
chosen order/size of that browser. A pure layout reducer (reorder/resize/reset/
unknown-id-drop/version-bump) with unit tests is the spine (spec §7).

1. Load the skill er-seo-tools-change-control first. Gate policy (2026-07-03 ruling,
   rules 1 & 4): THIS PASTED PROMPT is standing authorization to merge pending
   roadmap PRs at session start (re-run gates lint/test/build on the branch this
   session first) and to deploy when needed, ALWAYS followed by post-deploy verify.
   Destructive server ops stay Kevin-gated; docs rituals mandatory; never scan
   non-client sites. Brainstorm->spec->plan runs ungated (route design questions to
   Codex, not Kevin; notify Kevin one line per artifact, don't wait).
2. Read the spec §3.3 (edit mode + persistence). Trust ranking when docs disagree:
   code > plan/spec > tracker/handoff. Reuse the existing widget model + registry +
   DashboardGrid from PR 2 — PR 3 makes the grid stateful (layout state + editor),
   it does NOT rebuild the widgets. Study Quarter Grid's native HTML5 DnD for the
   drag pattern (grep quarter-grid for draggable/onDragStart/onDrop).
3. Write the PR 3 plan: docs/superpowers/plans/2026-07-07-app-shell-pr3.md, per-task
   TDD (lead with the pure layout reducer + its unit tests). Notify Kevin (one line
   + path), route to Codex review, apply named fixes in place, then execute
   (superpowers:subagent-driven-development, worktree per house style).
4. Gates: npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run
   build (UI-class change: dark: on every element; no hydration-mismatch — read the
   layout from localStorage in useEffect/useSyncExternalStore, render DEFAULT_LAYOUT
   on the server + first client paint). Then PR -> merge -> plain ~/deploy.sh (no
   migration) -> post-deploy verify.
5. Docs ritual: tracker checkbox/status-log + rewrite this handoff (next item = A8
   PR 3.5 aggregate widgets — KPI strip + Needs-attention, GATED on verifying/
   building the B1/B2 fleet loaders first) in the same commit as the ship.
```

## Current state (2026-07-07)

- **A8 (active, [~]) — PR 1 + PR 2 DONE:**
  - **PR 1** (shell): SHIPPED + PROD-VERIFIED (PR #112). `components/shell/`
    (SidebarNav/Topbar/AppShell), `(app)`/`(public)` route groups, tools registry
    `lib/tools-registry.ts`, hydration-safe CSS collapse.
  - **PR 2** (dashboard v1, fixed): SHIPPED + DEPLOYED (PR #113, main `acbf96e`).
    Widget model `lib/widgets/` (types/grid/queue-poll/registry) + `components/ui/`
    primitives (StatusPill/ScoreRing/DropZone) + `components/widgets/` (WidgetFrame
    + WidgetErrorBoundary + DashboardGrid) + 7 verified-source widgets; robots
    `?url=` auto-run (Suspense); brochure homepage deleted; `/` static 7.91 kB.
    Gates green (tsc · 3534 tests / 400 files · build); final opus review clean.
    Authed dashboard render pending a Kevin eyeball (cookie-gated — automated checks
    confirmed server on `acbf96e`, health ok, `/`→`/login`).
- **A8 next — PR 3 (widget editor):** make the fixed grid stateful — size stepper,
  native HTML5 drag + keyboard move-up/down reorder, `localStorage('er-home-layout')`
  persistence, reset-to-default. Pure layout reducer is the spine. Reuse PR 2's
  model/registry/widgets; don't rebuild them.
- **A8 after PR 3 — PR 3.5 (aggregate widgets):** KPI strip + Needs-attention,
  each GATED on verifying/building its server-side loader from the B1/B2 services
  first (Codex fix 4/9 — this is why they were deferred out of PR 2). Then PR 4+
  per-tool polish (one PR per tool section adopting `components/ui/` primitives).
- **Remaining roadmap after A8:** A5 (SSE), A7 (auth/test hardening), D1–D6, and
  gated items (Anthropic billing). See tracker.

## Gotchas for the next session (A8 PR 3)

- **Reuse, don't rebuild.** PR 2 already ships the widget model (`lib/widgets/types.ts`),
  `spanClass` (`lib/widgets/grid.ts`), the registry + `DEFAULT_LAYOUT`
  (`lib/widgets/registry.tsx`), and `DashboardGrid` (`components/widgets/`). PR 3
  turns the grid stateful (layout state driven by localStorage, editor controls);
  the 7 widget components are unchanged.
- **No hydration mismatch (same discipline as PR 2).** The persisted layout is a
  client-only value — render `DEFAULT_LAYOUT` on the server + first client paint,
  then adopt the stored layout after mount (useEffect / useSyncExternalStore). A
  render-time `localStorage.getItem` would diverge and warn. `components/ThemeToggle.tsx`
  and PR 2's `queue-poll.ts` are the reference patterns.
- **Native HTML5 DnD only** (spec §2 "no new drag-and-drop dependency") — mirror
  Quarter Grid's chips (`grep -rn "draggable\|onDragStart\|onDrop" components/quarter-grid`).
- **Keyboard reorder is REQUIRED** (Codex spec-fix 8): move-up/move-down buttons per
  widget in edit mode, so reordering never needs a pointer. Native DnD alone regresses
  keyboard a11y.
- **Persistence contract (spec §3.3):** `localStorage('er-home-layout')` =
  `{version:1, items:[{id,size}]}` in display order. On load: drop unknown ids,
  append missing registered widgets at their `defaultSize` (registry is
  authoritative), malformed JSON → `DEFAULT_LAYOUT`, a `version` bump resets. Wrap
  load/save in try-catch (quota/malformed). DB persistence is deferred to A7.
- **Order + size ONLY** — no free-form x/y placement; grid auto-flow does the packing.
- **Build gate catches the real risks:** `tsc --noEmit` + full vitest + `npm run
  build`. The dominant repo failure mode is prod-only (minification/hydration), so
  the build + an authed prod eyeball matter more than green unit tests alone.
- **Local `main` divergence (informational):** as of this ship, the local `main`
  in the primary worktree has 3 UNPUSHED, non-A8 docs commits (an "onboarding doc
  set": `c840145`, `44829d5`, `9cf5c0b`) that are NOT on `origin/main`. This
  session deliberately based its docs-ritual commit on `origin/main` (via a
  `docs/a8-pr2-ship` branch) so as NOT to publish that in-progress work. Next
  session: reconcile local `main` with `origin/main` before branching (e.g.
  `git fetch && git rebase origin/main` on `main`, or work from a fresh branch off
  `origin/main`). Do not force-lose those 3 commits — they're Kevin's local work.
