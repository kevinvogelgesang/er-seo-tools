# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-07 (**A8 PR 4 — seo-parser visual polish SHIPPED + DEPLOYED + PROD-VERIFIED (PR #120). First per-tool polish pass. Next action = A8 PR 5 — ada-audit visual polish (Kevin chose seo-parser + ada-audit back-to-back), same visual-only contract.**) · **Updated by:** the A8 PR 4 execution session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap: A8 PR 5 — ada-audit visual polish (the
second per-tool polish pass, spec §8 PR 4+). A8 PRs 1-3.5 (shell #112, dashboard #113,
widget editor #115, purge fix #116/#117, aggregate widgets #118) AND PR 4 (seo-parser
polish, #120) are all SHIPPED + DEPLOYED + PROD-VERIFIED. Kevin chose seo-parser +
ada-audit back-to-back, so ada-audit is the pre-decided next section — do NOT re-ask
which tool.

PR 4+ is the open-ended final A8 phase (spec §8 PR 4, §5): "one PR per tool section
adopting components/ui/ primitives + the deck visual language. Each independently
shippable; adjust per-section as Kevin reviews." VISUAL/primitive-adoption ONLY — DO NOT
alter tool behavior/data/API. Existing page tests must stay green (§7: the shell wraps
pages, it doesn't change them).

*** FIRST STEP for ada-audit: brainstorm→spec→plan for the ada-audit surface only, keep
it small + independently shippable. Scope it WITH Kevin (like PR 4 did for seo-parser):
the ada-audit surface is large — single-page + site-wide audit results, AuditPoller,
SiteAuditResultsView, exports, share views. Propose a tight slice (e.g. the results
header + score display via ScoreRing/StatusPill + wrapper reconciliation) rather than
the whole surface. WATCH: ada-audit has BOTH authed (app) pages AND public share views
(/ada-audit/share, /ada-audit/site/share) — public views render OUTSIDE the shell, so a
component shared between them CANNOT have its min-h-screen/bg wrapper stripped (PR 4
verified seo-parser's ResultsView was authed-only before reconciling it — do the same
ownership check here). SiteAuditResultsView renders in shareMode; check its importers. ***

PR-4 proven recipe (reuse it): (a) hex→Tailwind-token swap is pixel-safe — tokens
navy=#1c2d4a, orange=#f5a623, navy-deep=#0f1d30, orange-dark=#d4881a (orange-dark≠the old
#e8971a hover, negligible shade shift, OK); opacity uses the arbitrary form bg-navy/[0.08]
(NOT /8 — invalid step). (b) The shell <main> (components/shell/AppShell.tsx) already
supplies bg-[#f4f6f9] dark:bg-navy-deep, so in-shell page roots should DROP their own
min-h-screen bg-* (keep py/px + max-w/mx-auto); centered fallbacks → min-h-[60vh].
(c) ScoreRing takes score:number|null, size; keep any != null guard. (d) A test fixture
for ScoreExplanation MUST be a JSON PersistedBreakdown string (it only JSON.parses).

Design language + primitives: components/ui/ (StatusPill/ScoreRing/DropZone), navy/orange
+ Barlow (Tailwind config), dark: on every element. Reference: "Navy Command Deck" (Dir A).

1. Load skill er-seo-tools-change-control first. Gate policy (rules 1 & 4): THIS PASTED
   PROMPT is standing authorization to merge gate-green roadmap PRs at session start
   (re-run lint/test/build on the branch this session first) and to deploy when needed,
   ALWAYS followed by post-deploy verify. FOR UI PRs, post-deploy verify MUST drive the
   real authed tool page via Playwright and MEASURE layout (getComputedStyle / widths) —
   server-side health is NOT enough (PR 2 shipped a purged-CSS size bug caught only by a
   real-browser width measure). Prod URL: https://seo.erstaging.site (authed; the
   Playwright MCP profile holds a persisted session — navigate straight to a tool page).
   Destructive server ops stay Kevin-gated; docs rituals mandatory; never scan non-client
   sites. Brainstorm→spec→plan runs ungated (route each artifact to Codex, notify Kevin
   one line + path, don't wait).
2. Trust ranking when docs disagree: code > plan/spec > tracker/handoff.
3. Write the plan under docs/superpowers/plans/, per-task TDD. Notify Kevin (one line +
   path), route to Codex, apply named fixes, then execute (subagent-driven-development,
   worktree per house style).
4. Gates: npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run build.
   UI class: dark: on every element; no hydration mismatch; any NEW Tailwind class must be
   reachable by the content globs (include ./lib/**) — don't reintroduce purge. Then
   PR → merge → ~/deploy.sh → post-deploy verify (real authed browser, measure layout).
5. Docs ritual: tracker checkbox/status-log + rewrite this handoff in the same commit as
   the ship. A8 stays [~] while per-tool passes continue; when Kevin calls A8 done, mark
   A8 [x] and pick the next roadmap item.
```

## Current state (2026-07-07)

- **A8 (active, [~]) — homepage/shell system COMPLETE through PR 3.5; per-tool polish (PR 4+) in progress (seo-parser done, ada-audit next):**
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
  - **PR 4** (per-tool polish #1 — seo-parser): **SHIPPED + DEPLOYED + PROD-VERIFIED (PR #120).**
    - VISUAL-ONLY. Scope (chosen WITH Kevin) = upload page + results header. `ScoreRing`
      adopted on the results health-score card (was plain `NN/100` text; `!= null` guard +
      `ScoreExplanation` preserved); hex→token normalization; page-wrapper reconciliation
      with the shell (dropped redundant `min-h-screen bg-[#f4f6f9]` from the upload +
      ResultsView roots; fallbacks → `min-h-[60vh]`); deck card language on upload
      card/FileDropzone/HistoryList. MetricsBar limited to a value-preserving token swap
      (it is SHARED with the public seo-parser share view — ownership checked first).
    - **Latent-bug fix:** the client-name chip's `bg-[#1c2d4a]/8` used opacity step `8`
      (off Tailwind's scale → no bg); now `bg-navy/[0.08]` renders it.
    - Spec + plan Codex-reviewed (accept-with-fixes ×5 / ×3, applied). Subagent-driven
      (Task 1 ScoreRing+test; Tasks 2-6 swaps) + per-task reviews + opus whole-branch
      review (Ready-to-merge, 0 Critical/Important). Gates: tsc · **3645 tests / 410 files**
      (new `ResultsView.score.test.tsx`) · build. **Prod (Playwright, authed):** upload
      card 672 px (no purge collapse), h1 = `navy` exact, roots reconciled; results
      ScoreRing 80×80 `aria-label "score 90"`, breakdown intact; 0 errors / 0 hydration
      warnings. Spec + plan → `../archive/`.
  - **Gate/verify lesson (still applies to PR 5+):** server-side health checks are NOT
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
