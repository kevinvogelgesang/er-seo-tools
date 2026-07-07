# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-07 (**A8 PR 3.5 — aggregate homepage widgets (KPI strip + Needs-attention) SHIPPED + DEPLOYED + PROD-VERIFIED (PR #118, main `0c13cb6`). Next action = A8 PR 4+ per-tool polish passes (spec §8 PR 4) — open-ended by design, one PR per tool section.**) · **Updated by:** the A8 PR 3.5 execution session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap: A8 PR 4 — the first per-tool polish
pass (spec §8 PR 4+). PR 1 (left-sidebar shell, #112), PR 2 (fixed dashboard, #113),
PR 3 (widget editor, #115), the Tailwind purge fix (#116/#117), and PR 3.5 (aggregate
widgets — KPI strip + Needs-attention, #118) are all SHIPPED + DEPLOYED + PROD-VERIFIED.
The homepage widget system is DONE (spec §3.3 fully built through PR 3.5).

PR 4+ is the LAST A8 phase and is open-ended by design (spec §8 PR 4, §5): "one PR per
tool section (seo-parser, ada-audit, clients, reports, …) adopting components/ui/
primitives and the deck visual language. Each independently shippable; adjust
per-section as Kevin reviews (his stated preference)." So PR 4 is NOT a single fixed
deliverable — it's a series of small, per-tool visual/UX polish PRs.

*** FIRST STEP: pick the tool section with Kevin (don't guess). Ask which tool page to
polish first (seo-parser / ada-audit / clients / reports / robots / quarter-grid). Then
brainstorm→spec→plan for THAT section only, keep it small + independently shippable, and
DO NOT alter tool behavior/data — this is a visual/primitive-adoption pass. Existing page
tests must stay green (§7: the shell wraps pages, doesn't change them). ***

Design language + primitives already exist: components/ui/ (StatusPill/ScoreRing/DropZone),
navy #1c2d4a + orange #f5a623 + Barlow (Tailwind config), dark: on every element. Reuse
them; don't reinvent. Reference shells: PostHog home, VirtualAdviser 6, HubSpot ("Navy
Command Deck", Direction A).

1. Load skill er-seo-tools-change-control first. Gate policy (rules 1 & 4): THIS PASTED
   PROMPT is standing authorization to merge gate-green roadmap PRs at session start
   (re-run lint/test/build on the branch this session first) and to deploy when needed,
   ALWAYS followed by post-deploy verify. FOR UI PRs, post-deploy verify MUST drive the
   real authed homepage/tool page via Playwright and MEASURE layout (getComputedStyle /
   widths) — server-side health is NOT enough (PR 2 shipped a purged-CSS size bug that
   only a real-browser width measure caught in PR 3). Destructive server ops stay
   Kevin-gated; docs rituals mandatory; never scan non-client sites. Brainstorm→spec→plan
   runs ungated (route each artifact to Codex, notify Kevin one line + path, don't wait).
2. Trust ranking when docs disagree: code > plan/spec > tracker/handoff.
3. Write the plan under docs/superpowers/plans/, per-task TDD. Notify Kevin (one line +
   path), route to Codex, apply named fixes, then execute (subagent-driven-development,
   worktree per house style).
4. Gates: npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run build.
   UI class: dark: on every element; no hydration mismatch; any NEW Tailwind class must be
   reachable by the content globs (include ./lib/**) — don't reintroduce purge. Then
   PR → merge → ~/deploy.sh → post-deploy verify (real authed browser, measure layout).
5. Docs ritual: tracker checkbox/status-log + rewrite this handoff in the same commit as
   the ship. If A8 is fully done after your PR, mark A8 [x] and pick the next roadmap item.
```

## Current state (2026-07-07)

- **A8 (active, [~]) — homepage/shell system COMPLETE through PR 3.5; only PR 4+ polish remains:**
  - **PR 1** (shell): SHIPPED + PROD-VERIFIED (PR #112). `components/shell/`
    (SidebarNav/Topbar/AppShell), `(app)`/`(public)` route groups, tools registry
    `lib/tools-registry.ts`, hydration-safe CSS collapse.
  - **PR 2** (dashboard v1, fixed): SHIPPED + DEPLOYED (PR #113, `acbf96e`). Widget
    model + `components/ui/` primitives + `components/widgets/` framework + 7
    verified-source widgets; brochure homepage deleted. (Its tile SIZING was silently
    broken by the Tailwind purge below — fixed in PR #116/#117.)
  - **PR 3** (widget editor): SHIPPED + DEPLOYED + PROD-VERIFIED (PR #115, `229e901`).
    Pure reducer `lib/widgets/layout.ts` + hydration-safe `lib/widgets/use-home-layout.ts`
    + `EditableWidgetTile` + stateful `DashboardGrid` (Customize/Done/Reset, native HTML5
    DnD + trailing drop zone, ↑/↓ keyboard reorder, size stepper, CSS-gated desktop-only).
    `localStorage('er-home-layout')` = `{version:1,items:[{id,size}]}`.
  - **Purge fix** (PR #116/#117, main `e6a4387`): added `./lib/**` to Tailwind `content`
    globs + `tailwind.config.test.ts` guard. `spanClass()` classes lived only in
    `lib/widgets/grid.ts` (unscanned) → span classes purged → all tiles 1-column since PR 2.
  - **PR 3.5** (aggregate widgets): **SHIPPED + DEPLOYED + PROD-VERIFIED (PR #118, `0c13cb6`).**
    - **Loader gate PASSED first** (spec §3.3 + §8): `getClientFleet()` (B1,
      `lib/services/client-fleet.ts`) already returns per-client `FleetRow`
      (`seo/ada.delta`, `openCritical`, `alerts`) from canonical `CrawlRun.score`;
      `getQueueStatus()` gives active+queued. No fleet-wide aggregator / worst-movers
      ranker existed → built two PURE reductions (`lib/services/fleet-aggregates.ts`:
      `computeFleetKpi` + `rankNeedsAttention`). **No new DB queries / blob reads / schema.**
    - **Widgets are `'use client'` + two cookie-gated GET routes** (`app/api/fleet/{kpi,
      needs-attention}`, `withRoute`, `force-dynamic`, `isPublicPath`-omitted). The spec's
      "server component" wording is superseded by the client-bundle registry — **code > spec**
      (registry.tsx is imported into the client graph; a server component can't live there).
    - `registry.tsx` +2 entries (kpi-strip `wide`/`xl`; needs-attention `sm`/`lg`) +
      default-layout slots. **Additive — no `LAYOUT_VERSION` bump**; existing browsers get
      the new ids appended at defaultSize until "Reset layout" (observed in prod — Kevin's
      stored layout showed them at the end, not the top).
    - Codex ACCEPT-WITH-FIXES ×7 (all applied). Gates: tsc · **3643 tests / 409 files** ·
      build. Prod (Playwright, authed): KPI = Active 0 / Avg ADA 80 / Avg SEO 79 / Open
      criticals 128; Needs-attention = 8 ranked rows (a real score-drop mover ranks above
      criticals-only rows, by design) → `/clients/[id]`; **KPI cell measured 904 px = full
      4-col grid width** (no purge regression); 0 console errors / 0 hydration warnings.
  - **Gate/verify lesson (still applies to PR 4+):** server-side health checks are NOT
    enough for UI PRs — drive the authed page in Playwright and MEASURE widths
    (`getComputedStyle` / `getBoundingClientRect`), don't just snapshot.
  - **Test-infra gotcha found in PR 3.5:** `beforeEach(() => mock.mockReset())` implicitly
    RETURNS the mock; vitest treats a returned function as a teardown callback and invokes
    it — if the mock's impl throws, you get a phantom failure in an unrelated test. Use a
    block body: `beforeEach(() => { mock.mockReset() })`.
  - **Next:** **PR 4+ per-tool polish passes** (spec §8 PR 4, §5) — open-ended by design,
    one small independently-shippable PR per tool section adopting `components/ui/`
    primitives + the deck visual language; NO tool behavior/data changes; existing page
    tests stay green. Pick the first tool section WITH Kevin. Spec stays in `specs/`
    (active through PR 4).

- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports): unchanged — see the
  tracker (`2026-06-10-improvement-roadmap-tracker.md`) for authoritative per-item status
  and the full status log.
