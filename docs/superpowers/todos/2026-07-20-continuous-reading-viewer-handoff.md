# Continuous-reading viewer — build handoff (run straight through to deploy)

**Date:** 2026-07-20. **Decision owner:** Kevin (decided). **Mode:** autonomous — spec → Codex-review → plan → Codex-review → TDD build → deploy, no pings until deployed. Codex consults capped at 5 min; if longer, use a subagent.

## The decision (locked by Kevin)
Make the public viewbook viewer read as **one continuous, hierarchy-driven reading experience** — and make the current **collapse-first viewer DORMANT** (kept in code, not the active path).
- **Default experience = continuous-reading** for viewbooks.
- **Collapse-first (collapse/morph/reveal) goes dormant** — do NOT delete it; gate it off the active path (same spirit as prior dormant reversals: `collapsedShared` column, retired client schedules).
- **STRETCH (do if clean): a per-viewbook style toggle** — an operator picks `continuous` vs `collapse` per viewbook. If the toggle balloons, ship continuous-as-default FIRST and make the toggle a clearly-separable second phase so core value ships regardless.

## What "continuous-reading" means (design intent)
Full-hero lead per stage (55–65vh), ~220px chapter heroes, an "In this stage" overview, a hero-exit sticky label, a strong scroll-driven active-rail marker, "Previous stages" as compact/expandable rows, ~68ch prose measure, a Next-Steps action summary + CTA, a labeled mobile "Sections" pill. Light-only; no new copy that isn't code-owned.

## CRITICAL process guardrails (the last attempt failed on these)
1. **Build in a FRESH worktree off current `origin/main`.** `git fetch && git rev-list --count HEAD..origin/main` must be 0 before you build. `git worktree add .claude/worktrees/<slug> -b feat/<slug> origin/main`, then symlink `node_modules` + copy `.env` (NOT `.env.local`) — see memory `reference_worktree_smoke_node_modules`. Do NOT `prisma generate` unless you add a migration (then it's fine — you're on main's schema).
2. **The old redesign branch is a DESIGN REFERENCE, not a merge source.** `feat/vb-reading-experience` (PR #242, shelved/annotated do-not-merge) was built against an OLD viewer; main's viewer is now a different codebase. Re-spec against CURRENT main. Reachable refs (read via `git show origin/feat/vb-reading-experience:<path>`):
   - Old spec: `docs/superpowers/specs/2026-07-20-viewbook-reading-experience-design.md`
   - Old plan: `docs/superpowers/plans/2026-07-20-viewbook-reading-experience.md`
   - Overlap/collision map + file-by-file: `docs/superpowers/todos/2026-07-20-vb-reading-experience-vs-shipped-viewer-overlap.md`
3. **Reuse what already shipped to main (PR #243)** — don't re-harvest: `lib/viewbook/section-copy.ts`, `components/viewbook/public/SectionSummaryPanel.tsx` (guidance panel, already rendered in `SectionShell` body), `components/viewbook/public/ChapterCtaButton.tsx`, and the `KickoffNextSection` action summary. Harvest + ADAPT from the shelved branch (re-fit to main's current types): `StageOverview.tsx`, `PreviousStages.tsx`, `ReadingProgressController.tsx`, `StickyOffsetProbe` event seam, `lib/viewbook/section-status.ts` (+`section-origin.ts`) — but note main's state enum is now `'active' | 'done'` (the `'collapsed'` value is RETIRED → `collapsedShared` dormant column); any `carriedStatus`/status logic keying on `'collapsed'` must be reworked.

## Current main viewer (what you're modifying / making dormant)
- `SectionShell.tsx` (~487 ln): builds BOTH hero variants (expanded hero + collapsed compact row), computes display mode via `lib/viewbook/section-display.ts`, delegates the interactive collapse to the `CollapsibleSection` client island → `SectionReveal`. My PR #243 panel renders at the top of the `detailBody` (inside `SectionReveal`).
- `CollapsibleSection.tsx` (client): the collapse/morph island — body region ALWAYS rendered, collapse toggles a `grid-rows: 1fr↔0fr` reveal animation; default collapsed (per-machine `useCollapseState`); welcome auto-reveals once/device (`useWelcomeAutoReveal`).
- `SectionReveal.tsx`: state-only reveal (deliberately NO IntersectionObserver — the old blink bug).
- `ViewbookShell.tsx`: renders `ProgressNav` (4-stage stepper) + primary sections + one outer `EarlierSteps` band for carried sections + mounts `TocRail`.
- Presentation-config: `collapseAffordance`/`collapseMorph`/`heroOverlayStrength`/`revealDurationScale`/`firstLoadDelayMs` columns + `PresentationEditor` admin + `lib/viewbook/presentation-config.ts`. New `Viewbook.viewerMode` column would join these for the toggle.

## How dormant + continuous should compose (approach sketch — refine in the spec)
- Continuous-reading is the ACTIVE render path in `SectionShell`/`ViewbookShell`: sections render expanded in a continuous flow with full-hero lead + chapter heroes; `ReadingProgressController` drives the active-rail marker + hero-exit sticky label (writes ONLY presentational attrs — never collapse/height; the documented blink-bug rule).
- The collapse-first path (`CollapsibleSection`/morph/auto-reveal) stays in the tree but is gated OFF by default (a mode check). Toggle (stretch) flips per viewbook via `viewerMode` (default `'continuous'`).
- Reconcile the two reveal systems: continuous mode must NOT mount the collapse grid-rows animation; the active-rail observer replaces it. Keep `SectionReveal`'s state-only body for continuous mode (expanded).
- The already-shipped guidance panel + Next-Steps CTA stay; place them well in the continuous body.

## Toggle (stretch) specifics if you build it
- Migration: `Viewbook.viewerMode TEXT NOT NULL DEFAULT 'continuous'` (values `'continuous' | 'collapse'`). Existing rows default to continuous (Kevin wants continuous to be THE experience). Sanitize strict / degrade read, mirroring `presentation-config.ts`.
- Operator control in `PresentationEditor` (single atomic PATCH + sync bump, like the other presentation fields). Thread through public-data/operator-data/service/admin-shared (grep how `collapseAffordance` threads).
- Viewer branches on `viewerMode`: `'collapse'` re-activates the dormant collapse-first path (so dormant = reachable via the toggle).

## Gotchas (carry forward)
- NO jest-dom (DOM-native asserts only); RTL test files need `// @vitest-environment jsdom` line 1; LIGHT-ONLY (no `dark:`, color via `--vb-*`).
- Array-form `$transaction` only; raw-SQL sets `updatedAt` manually. RSC boundaries: a `'use client'` component may not receive a function prop (`PreviousStages` takes `renderSection` → must be a server component; `StageOverview`/controller/rail are client leaves w/ serializable props).
- On the main base the full viewbook suite is green (≈906 tests). Gate every merge: `npx tsc --noEmit` && `npx vitest run` (viewbook scope at least). The `collapseAffordance` "drift" from before is GONE on main (it was main's real shipped column).
- Deploy: `git push` FIRST, then `ssh $PROD_SSH "~/deploy.sh"` (source `.claude/ops-secrets.local.sh` for `$PROD_SSH`). Prod-verify: app health 200, deployed HEAD = your merge; to eyeball the viewer, pull a live token on the server via `node -e` + prisma (`viewbook.findFirst({where:{revokedAt:null}})`) and fetch `http://localhost:3000/viewbook/<token>` — there is NO local `/verify` for viewbook; the animation/CLS/active-rail feel is a browser eyeball (Kevin's, post-deploy).
- Per Kevin's global CLAUDE.md: route the spec AND the plan through Codex (`consulting-codex`) — notify, apply named fixes, proceed; don't gate on Kevin. Codex on Sol; consults capped at 5 min, subagent if longer.

## Sequence
1. Fresh worktree off `origin/main` (freshness check first).
2. Spec (continuous-reading default + collapse dormant + optional toggle, against current main) → `docs/superpowers/specs/2026-07-21-continuous-reading-viewer-design.md` → Codex review → apply fixes.
3. Plan → `docs/superpowers/plans/2026-07-21-continuous-reading-viewer.md` → Codex review → apply fixes.
4. TDD implement (core continuous-reading first; toggle as a separable later phase). Gate green each step.
5. ONE PR → main → deploy → prod-verify. Update memory `project_viewbook_reading_experience` + this todos folder on ship.
