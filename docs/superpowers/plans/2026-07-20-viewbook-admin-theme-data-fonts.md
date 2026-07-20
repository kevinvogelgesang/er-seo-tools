# Viewbook admin theme, data-source, and font-catalog implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with your harness's plan-execution loop — Claude: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans; Codex: er-seo-tools-workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the three coordinated admin UI improvements while preserving the public bundle boundary around the full Google Fonts snapshot.

**Architecture:** A lazy admin catalog module plus a server-only theme-resolution layer feed existing client-safe theme primitives through explicit resolved metadata. Data Source and Theme layout changes stay local to their admin components.

**Tech stack:** Next.js 15 App Router, React, TypeScript, Tailwind CSS, Vitest and Testing Library.

## Resolved decisions

- D1: Preview is the final, full-width `ThemeEditor` block.
- D2: Categories follow catalog order, unknowns alphabetically, mapped labels, default-collapsed shared panels.
- D3: Full catalog is dynamically imported by admin and statically imported only by server modules.
- D4: The off-limits service is supported through a permanent, idempotent, concurrency-safe server registration seam in client-safe validation code; no unregister/reset path exists and conflicting registration throws.

## Global constraints

- Do not edit any coordinator-listed forbidden file.
- Keep public components light-only and admin additions dark-mode complete.
- Add no dependencies and make no Prisma changes.
- Keep `ThemeStyle.tsx` statically limited to `FONT_MANIFEST`; no public client component may transitively import the full catalog JSON.
- Do not commit; the coordinator owns gates and commits.
- Forbidden paths (hard guard): `components/viewbook/admin/ViewbookEditor.tsx`, `components/viewbook/admin/FeedbackTab.tsx` and test, `components/viewbook/public/FeedbackThread.tsx` and test, `components/viewbook/public/ProgressNav.tsx` and test, `lib/viewbook/csm-chip.ts`, `lib/viewbook/stage-progress.ts`, `lib/viewbook/public-writes.ts`, `lib/viewbook/service.ts`, `prisma/**`, `app/api/viewbook/[token]/feedback/**`, and `middleware.ts`.

## File structure

- Provided inputs: `lib/viewbook/font-catalog.json`, `scripts/generate-font-catalog.ts`.
- Create: `lib/viewbook/font-catalog.ts`, `lib/viewbook/font-catalog.test.ts`, `lib/viewbook/theme-server.ts`.
- Admin: modify `ThemeEditor.tsx`/test, `ThemePreview.tsx`/test, `PresentationEditor.tsx`/test if structural assertions are needed, and `DataSourceTab.tsx`/test.
- Public/client-safe font flow: modify `lib/viewbook/theme.ts`/test, `components/viewbook/public/ThemeStyle.tsx`/test, `ViewbookShell.tsx`/test, `BrandSection.tsx`/test, `OperatorLayer/ThemeDraftWriter.tsx`/test, `OperatorLayer/InlineEditors.tsx`/test, and `OperatorLayer/OperatorViewbookLayer.tsx`/test as required to thread serializable resolved metadata without catalog imports.
- Server resolution/parsing: modify `app/(public)/viewbook/[token]/page.tsx`/test, `lib/viewbook/public-data.ts`/test, `lib/viewbook/operator-data.ts`/test, `lib/viewbook/retention.ts`/test, `app/api/viewbook/[token]/assets/[filename]/route.ts` and its test, `app/api/viewbooks/[id]/route.ts` plus existing route tests, `app/api/viewbooks/[id]/assets/route.ts` plus its test, and `app/api/clients/[id]/route.ts` plus its test.

## Task 1: Specify catalog and validation behavior

- [ ] Add failing pure tests for manifest superset, preference-selected then numerically sorted capped weights, search, JSON size, catalog-only validation, junk rejection, and conflicting process registration.
- [ ] Run the new tests and confirm failure for missing modules/behavior.
- [ ] Implement catalog accessors and the server validation/resolution seam.
- [ ] Re-run the tests to green.

## Task 2: Specify and build the real font combobox

- [ ] Replace the obsolete select-filter test with failing lazy search, visible listbox, cap hint, keyboard/click selection, catalog-only initial value, stylesheet deduplication, sample assertions, full ARIA wiring, ArrowUp/ArrowDown/Home/End/Enter/Escape behavior, blur containment, and announced loading/error/no-results states.
- [ ] Run `ThemeEditor.test.tsx` and confirm the intended failures.
- [ ] Implement the lazy combobox and deduplicated font stylesheet loader.
- [ ] Re-run component tests to green.

## Task 3: Specify and build public catalog-font rendering

- [ ] Add failing server/public tests for catalog font href, variables, displayed family names, operator draft write/restore, and preservation of a catalog-only operator-picker value.
- [ ] Add resolved-font props through the server page, shell, theme primitives, brand section, operator layer/draft writer, and admin preview.
- [ ] Switch `public-data.ts`, `operator-data.ts`, `retention.ts`, and token asset serving to the wide parser; enable permanent catalog validation before service calls in the admin viewbook, admin assets, and client-delete routes.
- [ ] Add focused regressions showing catalog-only themes survive public/operator/admin reads, PATCH/attachment, token asset authorization, deletion snapshots, and retention.
- [ ] Verify with `rg` that public client code has no catalog import; after build, inspect public route initial chunks/manifests for a catalog-only sentinel and verify it occurs only in a lazy admin chunk.

## Task 4: Specify and build Theme/Data Source layout behavior

- [ ] Update tests first for single-column preview placement, preview height/overflow, and catalog-ordered, label-mapped, collapsed category panels, including alphabetized unknowns and exact non-null/non-empty answered counts (whitespace-only strings count as answered).
- [ ] Run the affected tests and confirm failures.
- [ ] Implement the Theme stack and Data Source panels while preserving `AdminFieldCard` behavior.
- [ ] Re-run affected tests to green.

## Task 5: Overflow pass and verification

- [ ] Apply surgical width/wrapping fixes to the four owned admin components.
- [ ] Run targeted Vitest over all changed test files.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run build` and inspect emitted route/client chunks for bundle safety.
- [ ] Inspect `git diff --check`, assert no forbidden path appears in the lane diff/status, and list final changed files.
