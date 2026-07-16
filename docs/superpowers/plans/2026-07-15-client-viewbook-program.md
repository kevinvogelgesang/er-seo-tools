# Client Viewbook — Program Plan (5-PR lane split)

> **For agentic workers:** this is the COORDINATION contract for the feature,
> not a task plan. Per-PR task plans are cut from this document when each lane
> opens: `2026-07-15-client-viewbook-pr1.md` exists now; PR2/PR5 plans and the
> PR4/PR3 Codex briefs are written when their predecessor merges.

**Spec:** `docs/superpowers/specs/2026-07-15-client-viewbook-design.md`
(Codex-reviewed, fixes 1–9 applied — read it BEFORE any per-PR plan).

**Goal:** token-linked, per-client-themed viewbook hub (launch Q&A with
lock-in/amendments, brand guidelines, milestones + review feedback,
current-site assessment, SEO/GEO/E-E-A-T strategy) in 5 independently
deployable PRs.

## Lane map (Kevin's tandem test)

| PR | Scope (spec §14) | Owner | Opens when |
|---|---|---|---|
| PR1 | Schema + seeds + theme/assets + admin API + admin shell | **Claude** | now |
| PR2 | Public themed page, read-only + assets route + matchers | **Claude** | PR1 merged |
| PR4 | Activity + digest + feedback/review-links + materials writes + admin feedback UI | **Codex** | PR1 merged (parallel with PR2) |
| PR3 | Data Source interactivity (answers/version/lock/amendments/custom fields) | **Codex** | PR2 merged |
| PR5 | Assessment pull + new-build hiding + polish (done-states, tooltips, heroes) | **Claude** | PR2 merged (parallel with PR3) |

Merge order: PR1 → PR2 → (PR4 whenever green after PR1) → PR3 → PR5.
PR4 merging before PR2 is acceptable (its public UI seam is behind the PR2
shell); PR3 and PR5 must not merge before PR2.

## Coordination rules (er-seo-tools-multi-agent-coordination)

- One worktree per lane under `.claude/worktrees/`: Claude keeps
  `client-viewbook` (rebased per PR); Codex lanes are
  `viewbook-pr4` / `viewbook-pr3` on branches `feat/viewbook-pr4` /
  `feat/viewbook-pr3`. Pre-flight `git worktree list` before opening any lane.
- **File ownership is the overlap contract** (table below). A lane never edits
  a file owned by a live sibling lane. Shared files (`prisma/schema.prisma`,
  `middleware.ts`, `lib/jobs/**` registries, `system-schedules.ts`) are
  land-in-PR1-or-serialize: PR1 ships the FULL schema (all 10 models) so no
  later PR touches `schema.prisma` at all; `middleware.ts` matchers land in
  PR2 (page + assets) and PR3 (answers) and PR4 (feedback/materials) — those
  edits are 2-line anchored-regex additions, serialized by merge order, never
  concurrent (PR4's matcher edit happens at its END, rebased on whatever
  merged).
- **Cross-review before every merge:** Codex branches → Claude reviews the
  diff directly; Claude branches → `/codex-review` (P1). Review is advisory;
  merge stays gate-green-only.
- **Gates per lane (run inside the lane's worktree):** `npx tsc --noEmit` ·
  `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` ·
  `npm run build`.
- **Codex budget:** if a Codex lane hits a usage limit → PAUSE the lane and
  notify Kevin (he holds a full usage reset, expires ~2026-07-17). Claude does
  NOT take over Codex PRs on this feature.
- **Handoffs:** Claude lane keeps `docs/superpowers/todos/HANDOFF-client-viewbook.md`
  current per repo protocol. Codex lanes get no handoffs — each Codex PR is
  driven by ONE self-contained brief (template below) pasted into a fresh
  `codex exec` session (workspace = its worktree, sandbox `workspace-write`).

## File ownership map

**PR1 (Claude)** — creates: `prisma/schema.prisma` models + migration,
`lib/viewbook/{catalog,milestones,theme,assets,service,global-content}.ts`
(+tests), `app/api/viewbooks/**` (admin CRUD/token/sections/milestones/assets),
`app/api/viewbook-content/[key]/route.ts`, `app/(app)/viewbooks/**` (index,
editor shell, settings), `components/viewbook/admin/**`, clients-page card.

**PR2 (Claude)** — creates: `lib/viewbook/route-auth.ts`,
`lib/viewbook/public-data.ts` (per-section fault-isolated loader),
`app/(public)/viewbook/[token]/page.tsx`, `components/viewbook/public/**`
(themed shell + 7 read-only sections + shared preview renderer adopted by the
PR1 admin Theme tab), `app/api/viewbook/[token]/assets/[filename]/route.ts`.
Modifies: `middleware.ts` (page + assets matchers), `next.config.ts` (CSP
fonts origins).

**PR4 (Codex)** — creates: `lib/viewbook/activity.ts`, `lib/viewbook/digest.ts`,
`lib/jobs/handlers/viewbook-digest.ts`, `lib/notify/viewbook-digest-content.ts`,
`app/api/viewbook/[token]/feedback/route.ts`, `…/materials/route.ts`,
`app/api/viewbooks/[id]/milestones/[milestoneId]/review-links/**`,
`…/feedback/[feedbackId]/resolve`, `…/activity/route.ts`,
`components/viewbook/admin/{FeedbackTab,ActivityFeed}.tsx`, public
`components/viewbook/public/FeedbackThread.tsx` (fills PR2's stub seam).
Modifies: `lib/jobs/{handlers/index,types}` registry, `system-schedules.ts`
(+`system-viewbook-digest`), `lib/findings/retention.ts`-adjacent cleanup home
(`runCleanup` wiring), `middleware.ts` (feedback+materials matchers, at lane
end, rebased).

**PR3 (Codex)** — creates: `app/api/viewbook/[token]/answers/route.ts`,
`lib/viewbook/answers.ts` (version/lock/amendment state machine + throttle),
`app/api/viewbooks/[id]/fields/**` (custom-field CRUD + archive),
`app/api/viewbooks/[id]/lock/route.ts`,
`components/viewbook/public/DataSourceSection.tsx` interactivity (replaces
PR2's read-only rendering INSIDE that one file — Codex owns the file in PR3),
`components/viewbook/admin/DataSourceTab.tsx`. Modifies: `middleware.ts`
(answers matcher).

**PR5 (Claude)** — creates: `lib/viewbook/assessment.ts` (client-wide
reportable-audit loader), `components/viewbook/public/AssessmentSection.tsx`
(replaces PR2 placeholder), polish across `components/viewbook/public/**`
(done-state animation, tooltips, section heroes). No shared-file edits.

## Codex brief template (per Codex PR)

Each brief is one prompt containing: (1) lane + worktree + branch setup
commands; (2) the spec sections verbatim that the PR implements; (3) the file
ownership list (create/modify — nothing else); (4) exact interface contracts
consumed from merged PRs (signatures copied from actual merged code at
brief-cut time, never from memory); (5) repo invariants (array-form
transactions only, withRoute + parseJsonBody, anchored matchers, D7 notify
rules, gates); (6) the gate commands + "commit per task, push branch, do not
merge". Briefs are cut by Claude at lane-open and saved as
`docs/superpowers/plans/2026-07-15-client-viewbook-pr4-codex-brief.md` (and
`…-pr3-codex-brief.md`) so Kevin can re-fire them if a Codex session dies.

## Definition of done (program)

All five PRs merged gate-green + cross-reviewed; spec §12 test matrix covered
(each item names its owning PR in the per-PR plans); deploy checklist run
(`VIEWBOOK_ASSETS_DIR` on data volume, CSP fonts origins verified, migration
applied); docs moved to `archive/` per superpowers taxonomy; handoff doc
retired.
