# Viewbook viewer polish — TWO features — SHIPPED

**Date:** 2026-07-21. **Owner:** Kevin. **Status:** ✅ SHIPPED to prod (both PRs merged + deployed + prod-verified). This doc is the done-state record; the spec + plan are archived (`docs/superpowers/archive/specs/2026-07-21-viewbook-viewer-polish-design.md` + `archive/plans/2026-07-21-viewbook-viewer-polish.md`).

## What shipped
- **PR #254 — Feature B (ToC hide toggle):** a floating circular hamburger (☰) on the desktop viewbook viewer that fully hides the ToC rail (unmounts the `<nav>`), replacing the dormant `DESKTOP_RAIL_COLLAPSIBLE` shrink path. Device-local (`vb:toc-hidden` localStorage), default expanded. Mobile FAB/bottom-sheet unchanged. New `components/viewbook/public/useTocHidden.ts`.
- **PR #257 — Feature A (section info-tooltips):** retired `SectionSummaryPanel`; the per-section "What this is / What we need" copy now surfaces in an ⓘ tooltip beside each section H2 (continuous hero, `tone="on-primary"`) / in the collapse `headerStrip` — always a sibling of the H2, never inside it or a button. Company-wide-editable (`/viewbooks/settings` → `SectionCopyEditor`) + per-viewbook overrides (viewbook `ContentTab` → `SectionCopyOverrides`). Content model reuses `ViewbookGlobalContent`/`ViewbookContentOverride` under a reserved `section-copy:<sectionKey>` namespace — **NO migration**. `StatusPill` relocated to its own file; `Tooltip` widened to a `ReactNode` label + `on-primary` tone.

## Key implementation homes
- `lib/viewbook/section-copy-content.ts` — validate / 3-layer resolve (per-viewbook override ← company-wide ← code default) / store (array-form `$transaction` + `syncVersion` bump; delete = EXISTS-fence + 404, no bump on 0 rows). Reused code default = `lib/viewbook/section-copy.ts` (`SECTION_COPY`, client-safe).
- `lib/viewbook/public-data.ts` `buildSectionCopyMap` + `getViewbookAdmin` (service.ts) both resolve the map (public viewer + admin editor).
- Operator routes: `PUT/DELETE /api/viewbooks/section-copy/[sectionKey]` (company-wide) + `/api/viewbooks/[id]/section-copy/[sectionKey]` (override) — cookie-gated by omission, `requireOperatorEmail` first.
- Admin editors reconcile drafts via `useBaselineSync` (idle-adopt of incoming resolved props) — the fix for the "Clear override left stale fields + silent re-create" review finding.

## Reviews / gotchas captured
- Every task got a per-task spec+quality review; Codex `--base main` + a whole-branch review before merge. Findings fixed: SectionCopyEditor await-then-reset ordering + `not_found` matcher (was a `/404/` regex that never matched); ContentTab override-row `useBaselineSync` reconcile; `ThemePreview` no longer imports the prisma-coupled resolver (kept Prisma out of the `/viewbooks/[id]` browser bundle — uses client-safe `SECTION_COPY`).
- Mid-session: `feat/anchor-text-capture` shipped to main; the shared symlinked Prisma client was regenerated to expect `anchorSummaryJson`, breaking the full test suite against the stale test template DB. Fixed by merging main + `prisma generate` + `rm -rf .test-dbs`. (Lesson: a worktree's symlinked node_modules Prisma client is shared across lanes.)

## Remaining (Kevin — browser eyeball only, no local/remote /verify for viewbook)
- Feature B: hamburger hides/shows the desktop rail; persisted-hidden reload shows a brief rail flash (acceptable, no CLS); mobile FAB unchanged.
- Feature A: ⓘ beside the section H2 shows What-this-is / What-we-need; a company-wide edit on `/viewbooks/settings` reflects in every viewbook; a per-viewbook override wins and "Clear override" reverts cleanly (fields update after the profile reload); the old panel is gone. Note: continuous-mode carried "earlier steps" sections (no hero) show no ⓘ by design (the full section with its ⓘ appears earlier in the same scroll; chapter header still shows the one-liner).
