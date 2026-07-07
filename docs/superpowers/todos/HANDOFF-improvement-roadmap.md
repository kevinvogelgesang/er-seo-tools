# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-07 (**A8 PR 3 — homepage widget editor SHIPPED + DEPLOYED + PROD-VERIFIED (PR #115), plus a follow-up Tailwind-purge fix SHIPPED + DEPLOYED + PROD-VERIFIED (PR #116). Next action = A8 PR 3.5 aggregate widgets, GATED on first verifying/building the B1/B2 fleet loaders.**) · **Updated by:** the A8 PR 3 execution session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap: A8 PR 3.5 — the aggregate homepage
widgets (KPI strip + Needs-attention).

State: A8 PR 1 (left-sidebar shell, PR #112), PR 2 (fixed-layout dashboard, PR #113),
and PR 3 (widget EDITOR — sizes + drag/keyboard reorder + localStorage persistence +
reset, PR #115) are all SHIPPED + DEPLOYED + PROD-VERIFIED. A follow-up fix (PR #116,
main e04a05b) added ./lib/** to Tailwind's content globs — spanClass() in
lib/widgets/grid.ts emits col-span-*/md:col-span-2/lg:row-span-2/lg:col-span-4, which
were being PURGED (lib/ wasn't scanned) so widget tiles rendered 1-column since PR 2.
Now fixed + guard test (tailwind.config.test.ts). Live homepage: app/(app)/page.tsx →
<DashboardGrid/> which is now STATEFUL (useHomeLayout hook + edit mode). Widget model
in lib/widgets/ (types/grid/layout/use-home-layout/queue-poll/registry);
components/widgets/ has DashboardGrid + EditableWidgetTile + WidgetFrame + 7 widgets.
Layout persists to localStorage('er-home-layout') = {version:1,items:[{id,size}]}.
Spec (covers all A8 PRs, active through PR 4):
docs/superpowers/specs/2026-07-07-app-shell-redesign-design.md (§3.3 widget system;
the deferred aggregate widgets are the table rows marked "PR 3.5"). PR 3 plan archived
at docs/superpowers/archive/plans/2026-07-07-app-shell-pr3.md.

PR 3.5 = two AGGREGATE widgets deferred from PR 2 because their server-side data
loaders were unverified (spec §3.3 fixes 4+9, the "3.5" table rows):
  - KPI strip (active scans, avg ADA, avg SEO, open criticals) — sizes wide, xl.
  - Needs attention (worst movers) — sizes sm, lg.
*** HARD GATE (spec §3.3 + §8): DO NOT build either widget until you have first
VERIFIED (read the code) or BUILT the server-side loaders they need — the B1
client-fleet services and the B2 findings/action-center services. The spec names
them as "reusing the B1 client-fleet services" and "B2 findings/action-center
services". Confirm those loaders actually exist and return the shape you need BEFORE
writing widget UI; if they don't exist, building those loaders IS the first task.
Widgets are server components (per spec) — verify the data path end to end. ***

1. Load skill er-seo-tools-change-control first. Gate policy (rules 1 & 4): THIS
   PASTED PROMPT is standing authorization to merge gate-green roadmap PRs at session
   start (re-run lint/test/build on the branch this session first) and to deploy when
   needed, ALWAYS followed by post-deploy verify (drive the real authed homepage via
   Playwright — Kevin can log the browser in; DON'T just check server-side health,
   the PR 3 session shipped a size bug that only a real-browser measure caught).
   Destructive server ops stay Kevin-gated; docs rituals mandatory; never scan
   non-client sites. Brainstorm→spec→plan runs ungated (route design to Codex, notify
   Kevin one line per artifact, don't wait).
2. Trust ranking when docs disagree: code > plan/spec > tracker/handoff. Reuse the
   PR 2/3 widget model — a widget is {id,title,sizes,defaultSize,Component} in
   lib/widgets/registry.tsx; add the two new entries + their default-layout slots
   there. Study how the existing 7 widgets fetch/fault-isolate (WidgetErrorBoundary),
   and how B1/B2 already surface fleet + findings data elsewhere in the app.
3. Write the PR 3.5 plan: docs/superpowers/plans/2026-07-07-app-shell-pr3.5.md,
   per-task TDD, LEADING with a loader-verification task (prove the B1/B2 services
   exist + shape). Notify Kevin (one line + path), route to Codex, apply named fixes,
   then execute (subagent-driven-development, worktree per house style).
4. Gates: npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run
   build. UI class: dark: on every element; no hydration mismatch. NOTE: any NEW
   Tailwind class must be reachable by the content globs (now include ./lib/**) —
   don't reintroduce purge. Then PR → merge → ~/deploy.sh → post-deploy verify
   (real authed browser: KPI numbers + Needs-attention render with live data, 0
   console/hydration warnings, degraded-state fault isolation works).
5. Docs ritual: tracker checkbox/status-log + rewrite this handoff (next item after
   3.5 = A8 PR 4+ per-tool polish passes) in the same commit as the ship.
```

## Current state (2026-07-07)

- **A8 (active, [~]) — PR 1 + PR 2 + PR 3 (+ purge fix) DONE:**
  - **PR 1** (shell): SHIPPED + PROD-VERIFIED (PR #112). `components/shell/`
    (SidebarNav/Topbar/AppShell), `(app)`/`(public)` route groups, tools registry
    `lib/tools-registry.ts`, hydration-safe CSS collapse.
  - **PR 2** (dashboard v1, fixed): SHIPPED + DEPLOYED (PR #113, `acbf96e`). Widget
    model + `components/ui/` primitives + `components/widgets/` framework + 7
    verified-source widgets; brochure homepage deleted. (Its tile SIZING was silently
    broken by the Tailwind purge below — fixed in PR #116.)
  - **PR 3** (widget editor): SHIPPED + DEPLOYED + PROD-VERIFIED (PR #115, `229e901`).
    Pure reducer `lib/widgets/layout.ts` (51 tests) + hydration-safe
    `lib/widgets/use-home-layout.ts` (11 tests) + `components/widgets/EditableWidgetTile.tsx`
    (9 tests) + stateful `DashboardGrid` (Customize/Done/Reset, native HTML5 DnD +
    trailing drop zone, ↑/↓ keyboard reorder, size stepper, CSS-gated desktop-only).
    `localStorage('er-home-layout')` = `{version:1,items:[{id,size}]}`; unknown ids
    dropped / missing appended / malformed / version-bump → default. Plan
    Codex-reviewed (fixes 2–10 applied); per-task + final opus review clean.
  - **Purge fix** (PR #116, `e04a05b`): added `./lib/**` to Tailwind `content` globs +
    `tailwind.config.test.ts` guard. Root cause: `spanClass()` classes lived only in
    `lib/widgets/grid.ts`, which Tailwind wasn't scanning → span classes purged → all
    tiles 1-column since PR 2. Re-verified live: wide=444px, lg=444×538, sm=214px,
    live size-toggle works, 0 console/hydration warnings.
  - **Gate/verify lesson for next session:** server-side health checks are NOT enough
    for these UI PRs — the size bug passed tsc/tests/build and a clean prod boot, and
    only a real-browser `getComputedStyle`/width measurement caught it. Drive the
    authed homepage in Playwright and MEASURE, don't just snapshot.
  - **Next:** PR 3.5 aggregate widgets (KPI strip + Needs-attention) — **GATED** on
    first verifying/building the B1/B2 fleet + findings loaders (see paste prompt).
    Then PR 4+ per-tool polish. Spec stays in `specs/` (active through PR 4).

- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports): unchanged from the
  PR 2 handoff — see the tracker (`2026-06-10-improvement-roadmap-tracker.md`) for the
  authoritative per-item status and the full status log.
