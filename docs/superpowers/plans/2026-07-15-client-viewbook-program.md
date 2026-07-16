# Client Viewbook — Program Plan (5-PR lane split, rev 2)

> **For agentic workers:** this is the COORDINATION contract for the feature,
> not a task plan. Per-PR task plans are cut from this document when each lane
> opens: `2026-07-15-client-viewbook-pr1.md` exists now; PR2/PR5 plans and the
> PR4/PR3 Codex briefs are written when their lane opens.

**Spec:** `docs/superpowers/specs/2026-07-15-client-viewbook-design.md`
(Codex-reviewed, fixes 1–9 applied — read it BEFORE any per-PR plan).
**Rev 2** applies Codex plan-review fixes 1–7 + Kevin-confirmed decisions
(2026-07-16): PR2 merges before PR4's integration phase; PR3 opens only after
PR2 AND PR4 merge.

**Goal:** token-linked, per-client-themed viewbook hub (launch Q&A with
lock-in/amendments, brand guidelines, milestones + review feedback,
current-site assessment, SEO/GEO/E-E-A-T strategy) in 5 independently
deployable PRs.

## Lane map (Kevin's tandem test)

| PR | Scope | Owner | Opens when | Merges when |
|---|---|---|---|---|
| PR1 | Schema (all 11 models) + seeds + theme/assets + `route-auth.ts` + admin API + admin shell | **Claude** | now | gate-green + cross-review |
| PR2 | Public themed page (read-only) + assets route + its matchers | **Claude** | PR1 merged | **before PR4** |
| PR4 | Activity/digest/retention + public-write-guard + feedback/materials routes + admin feedback UI | **Codex** | PR1 merged (core phase, parallel with PR2) | after PR2 (integration phase rebased on PR2) |
| PR3 | Data Source interactivity (answers/version/lock/amendments/custom fields) | **Codex** | PR2 **and** PR4 merged | after cross-review |
| PR5 | Assessment + polish wrappers | **Claude** | PR2 merged (parallel with PR3) | after cross-review |

**PR4 is two-phase (Codex plan-fix 2/3):**
- *Core phase* (opens at PR1 merge, parallel with PR2): `lib/` modules, job
  handler, schedules, retention, public-write-guard, its OWN new leaf
  components — zero shared-file edits, compiles against PR1 alone
  (`requireViewbookToken` ships in PR1 for exactly this reason).
- *Integration phase* (opens at PR2 merge, PR2 lane closed): rebase on main,
  then — as the ONLY live editor of these files — add its two `middleware.ts`
  matchers + `middleware.test.ts` entries, wire `FeedbackThread`/
  `MaterialLinkForm` into PR2's milestone/materials section components, and add
  the Feedback/Activity tabs to PR1's `ViewbookEditor.tsx`.

## Coordination rules (er-seo-tools-multi-agent-coordination)

- One worktree per lane under `.claude/worktrees/`: Claude keeps
  `client-viewbook`; Codex lanes are `viewbook-pr4` / `viewbook-pr3` on
  branches `feat/viewbook-pr4` / `feat/viewbook-pr3`. Pre-flight
  `git worktree list` before opening any lane.
- **File ownership is the overlap contract** (map below): exact create/modify
  lists, no globs. A file appears in at most ONE live lane at any moment.
  `prisma/schema.prisma` is PR1-only — later PRs never touch it (fix: the
  full 11-model schema lands in PR1). `middleware.ts` + `middleware.test.ts`
  are owned by PR2 (its matchers), then PR4-integration (its matchers), then
  PR3 (its matcher) — strictly serialized by merge order, never concurrent.
- **Cross-review before every merge:** Codex branches → Claude reviews the
  diff; Claude branches → `/codex-review` (P1). Advisory; merge stays
  gate-green-only.
- **Gates per lane (inside its worktree):** `npx tsc --noEmit` ·
  `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` ·
  `npm run build` · `npm run audit:ci` when the lane touched upload/dependency
  surfaces.
- **Codex budget:** limit hit → PAUSE the lane, notify Kevin (usage reset in
  hand, expires ~2026-07-17). Claude does NOT take over Codex PRs.
- **Handoffs:** Claude lane maintains
  `docs/superpowers/todos/HANDOFF-client-viewbook.md`. Codex lanes get
  self-contained briefs (template below), saved as
  `docs/superpowers/plans/2026-07-15-client-viewbook-pr4-codex-brief.md` /
  `…-pr3-codex-brief.md` so Kevin can re-fire a dead session. PR4's brief is
  cut at PR1-merge (core phase) with an integration addendum cut at PR2-merge;
  PR3's brief is cut at PR4-merge with interface signatures copied from MERGED
  code, never from memory.

## File ownership map (exact; C=create, M=modify)

**PR1 (Claude)** — C: `prisma/schema.prisma` models + migration,
`lib/viewbook/catalog.ts`, `milestones.ts`, `theme.ts`, `assets.ts`,
`service.ts`, `global-content.ts`, `route-auth.ts` (fix 1 — PR4/PR3 compile
against it), `operator.ts` (re-review fix 3), all their `.test.ts`; `app/api/viewbooks/route.ts`, `[id]/route.ts`,
`[id]/token` (the lock route is PR3's, not PR1's), `[id]/sections/[sectionKey]`,
`[id]/milestones` + `[milestoneId]`, `[id]/assets` (attachment flows),
`[id]/sync-questions`, `[id]/overrides/[contentKey]`,
`app/api/viewbook-content/[key]/route.ts` + `…/team-photo/route.ts`;
`app/(app)/viewbooks/{page,._id_.page,settings/page}.tsx`,
`components/viewbook/admin/{ViewbookIndex,ViewbookEditor,ThemeEditor,ContentTab,MilestonesEditor,GlobalContentEditor,ViewbookCard}.tsx`.
M: `app/(app)/clients/[id]/page.tsx` (card), `app/api/clients/[id]/route.ts`
(client-delete asset snapshot), `lib/tools-registry.ts` + its test,
`ecosystem.config.js` (`VIEWBOOK_ASSETS_DIR`).

**PR2 (Claude)** — C: `lib/viewbook/public-data.ts`,
`lib/viewbook/public-types.ts` (client-safe payload types — PR2 plan Codex
fix 7), `app/(public)/viewbook/[token]/page.tsx`,
`components/viewbook/public/{ViewbookShell,SectionShell,ProgressNav,WelcomeSection,MilestonesSection,DataSourceSection,BrandSection,AssessmentPlaceholder,StrategySection,MaterialsSection,ThemeStyle}.tsx`,
`components/viewbook/public/section-titles.ts`,
`app/api/viewbook/[token]/assets/[filename]/route.ts` **+ its
curation/HTTP-serving tests** (re-review verify item — PR1 only asserts up to
`readViewbookAsset`), `components/PublicFooter.test.tsx`,
`next.config.test.ts`, preview adoption in admin
(`components/viewbook/admin/ThemePreview.tsx` + M `ThemeEditor.tsx`).
M: `middleware.ts` + `middleware.test.ts` (page + assets matchers),
`next.config.ts` (CSP fonts origins), `components/PublicFooter.tsx`
(anchored public-viewbook footer gate).
**CSS-var contract:** PR2's `--vb-*` names are canonical; PR4's integration
phase renames its leaves' `--viewbook-primary` references (PR2 plan Codex
fix 4).

**PR4 (Codex) — core phase** — C: `lib/viewbook/activity.ts`,
`lib/viewbook/digest.ts`, `lib/viewbook/retention.ts`,
`lib/viewbook/public-write-guard.ts` (fix 6 — same-site check, JSON
content-type enforcement, token throttle, bounded body parse, clientMutationId
validation — PR3 consumes it), `lib/jobs/handlers/viewbook-digest.ts`,
`lib/notify/viewbook-digest-content.ts`,
`app/api/viewbook/[token]/feedback/route.ts`, `…/materials/route.ts`,
`app/api/viewbooks/[id]/milestones/[milestoneId]/review-links/**`,
`app/api/viewbooks/[id]/feedback/[feedbackId]/resolve/route.ts`,
`app/api/viewbooks/[id]/activity/route.ts`,
`components/viewbook/public/{FeedbackThread,MaterialLinkForm}.tsx` (new leaf
files — NOT edits to PR2 files),
`components/viewbook/admin/{FeedbackTab,ActivityFeed}.tsx`, tests for all.
M: `lib/jobs/handlers/register.ts` + test, `lib/jobs/types.ts` (job type),
`lib/jobs/system-schedules.ts` + test, `lib/cleanup.ts` + wiring test
(activity/retention wiring lives in `lib/viewbook/retention.ts`, NOT
`lib/findings/retention.ts` — fix 5), **`lib/viewbook/service.ts` +
`service.test.ts` + `app/api/viewbooks/[id]/sections/[sectionKey]/route.ts`**
(re-review fix 5 — section-done activity: `setSectionState` gains operator
identity + writes the transition AND its `ViewbookActivity` row in one
array-form transaction; PR1 is merged before PR4-core opens, so this modify
never overlaps a live lane).
**Integration phase (post-PR2-merge, rebased):** M: `middleware.ts` +
`middleware.test.ts` (feedback + materials matchers),
`components/viewbook/public/MilestonesSection.tsx` (mount FeedbackThread),
`components/viewbook/public/MaterialsSection.tsx` (mount MaterialLinkForm),
`components/viewbook/admin/ViewbookEditor.tsx` (Feedback/Activity tabs).

**PR3 (Codex)** — C: `lib/viewbook/answers.ts` (version/lock/amendment state
machine), `app/api/viewbook/[token]/answers/route.ts`,
`app/api/viewbooks/[id]/lock/route.ts`, `app/api/viewbooks/[id]/fields/**`
(custom-field CRUD + soft-archive),
`components/viewbook/admin/DataSourceTab.tsx`, tests.
M: `components/viewbook/public/DataSourceSection.tsx` (interactivity —
excluded from PR5), `components/viewbook/admin/ViewbookEditor.tsx` (tab),
`middleware.ts` + `middleware.test.ts` (answers matcher).

**PR5 (Claude)** — C: `lib/viewbook/assessment.ts`,
`components/viewbook/public/AssessmentSection.tsx` (replaces the PLACEHOLDER
component at its mount point), `components/viewbook/public/Tooltip.tsx`.
M: `components/viewbook/public/SectionShell.tsx` (done-state animation +
section hero rendering — the ONE shared polish surface, fix 4),
`app/(public)/viewbook/[token]/page.tsx` (swap AssessmentPlaceholder →
AssessmentSection).
D: `components/viewbook/public/AssessmentPlaceholder.tsx` (PR5 Codex review
fix 8 — its only consumer is the page mount being swapped; recorded here
because this map is exact). Explicitly NOT touched: `DataSourceSection.tsx`,
`MilestonesSection.tsx`, `MaterialsSection.tsx` (PR3/PR4 territory).

## Codex brief template (per Codex PR)

One prompt containing: (1) worktree/branch setup commands; (2) the spec
sections verbatim the PR implements; (3) the exact C/M file list above —
nothing else; (4) interface contracts copied from merged code at brief-cut
time; (5) repo invariants (array-form transactions only, withRoute +
parseJsonBody, anchored matchers, D7 notify rules, per-worker test DBs,
gates); (6) gate commands + "commit per task, push branch, do not merge".

## Definition of done (program)

All five PRs merged gate-green + cross-reviewed; spec §12 test matrix covered;
deploy checklist (`VIEWBOOK_ASSETS_DIR` on the data volume + in
`ecosystem.config.js` **+ added to the server backup coverage alongside
uploads/reports — spec §13**, CSP fonts origins verified, migration applied);
docs moved to `archive/` per superpowers taxonomy; handoff doc retired.
