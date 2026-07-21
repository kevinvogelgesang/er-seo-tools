# Viewbook viewer polish — TWO features — IMPLEMENTATION handoff

**Date:** 2026-07-21. **Owner:** Kevin. **Status:** SPEC + PLAN COMPLETE & Codex-reviewed (both accept-with-named-fixes, all fixes applied). **NOT YET IMPLEMENTED** — next step is TDD build off the committed plan. Paused at Kevin's request after spec→Codex→plan→Codex.

Two light-only public-viewer features, independently shippable, **2 PRs**:
- **Feature A** — retire `SectionSummaryPanel`, surface `purpose`/`whatThis`/`whatWeNeed` in an ⓘ tooltip beside each section H2; company-wide-editable + per-viewbook overrides (reuses `ViewbookGlobalContent`/`ViewbookContentOverride` via a `section-copy:<sectionKey>` key namespace — NO migration).
- **Feature B** — floating hamburger that fully hides the desktop ToC rail; device-local (`vb:toc-hidden`), default expanded.

## Where things stand
- **Worktree/branch:** `.claude/worktrees/vb-viewer-polish` on `feat/vb-viewer-polish` (cut off `origin/main`; `node_modules` symlinked, `.env` copied). **NOT pushed, no PR yet.**
- **Spec:** `docs/superpowers/specs/2026-07-21-viewbook-viewer-polish-design.md` — Codex-reviewed, 6 named fixes applied (commit `9e53593`).
- **Plan:** `docs/superpowers/plans/2026-07-21-viewbook-viewer-polish.md` — 11 TDD tasks / 2 PRs, Codex-reviewed, 6 named fixes applied (commit `2271c1b`).
- Branch commits: `1779ad1` spec → `9e53593` spec-fixes+tracker → `d5b1199` plan → `2271c1b` plan-fixes.

## Locked decisions (Kevin)
- Tooltip carries **all three** fields (`purpose` + `whatThis` + `whatWeNeed`), all editable.
- ⓘ sits **beside the hero H2** (continuous viewer). Collapse viewer (dormant): ⓘ in `headerStrip` (never inside the `<h2>` or the collapse `<button>`).
- Feature B persistence = **device-global** localStorage, default **expanded**.

## PR split & ordering
- **PR 1 = Feature B** (Tasks 1–2): client-only, no schema, no content-write. Ship first. `/codex-review` optional.
- **PR 2 = Feature A** (Tasks 3–11): content model + editing surfaces. **P1 → `/codex-review` before merge** (content-write path).

## Key implementation facts (from the Codex-reviewed plan)
- Content model reuses the two existing tables under `section-copy:<sectionKey>`; **NO migration**. New module `lib/viewbook/section-copy-content.ts` (validate/resolve/store). Queries use `in: SECTION_KEYS.map(sectionCopyKey)` (never `startsWith`); writes mirror `global-content.ts` (array-form `$transaction` + sync bump; global=bumpAll, override=bump-one; delete = EXISTS-fence + 404 on 0 rows).
- Resolution is **whole-object per layer** (override ← company-wide ← code default); `whatWeNeed` empty→`null`; invalid layer falls through, not straight to code default.
- `SectionShell` gets a **required** `sectionCopy` prop → tsc enumerates all ~13 caller sites; `ThemePreview` passes `resolveSectionCopy(key, null, null)`. `StatusPill` relocated to its own file first (Task 5), panel deleted in Task 7.
- **Feature A admin data-flow (the subtle one):** `ContentTab` is fed by the CLIENT `ViewbookEditor` via `GET /api/viewbooks/:id` → `getViewbookAdmin` (`lib/viewbook/service.ts`) → `ViewbookDetail` (`viewbook-admin-shared.ts`). The resolved per-viewbook map rides that response — there's no server component to load it directly (Task 11 Step 0).
- **Feature B:** retire `DESKTOP_RAIL_COLLAPSIBLE` + its 40px branch + `open`/`collapse` orphans; hamburger omits `aria-controls` while the rail nav is unmounted; focus-on-reshow guarded against initial-mount theft; `max-md:hidden` guard; persisted-hidden flash is a browser-eyeball check (no CLS — fixed positioning).

## Guardrails (every step)
- Coordination pre-flight already done; keep working IN the worktree (another session is live in the main checkout).
- Light-only public viewer (no `dark:` in `components/viewbook/public/*`); jsdom pragma line 1 + NO jest-dom on RTL tests; array-form `$transaction` only.
- Gate each task: `npx tsc --noEmit` + scoped `npx vitest run`. Before each PR: full `npx vitest run` + `npm run build`.
- Deploy: `git push` (merge) → `source .claude/ops-secrets.local.sh && ssh $PROD_SSH "~/deploy.sh"` → prod-verify (health 200, deployed HEAD; NO migration). Browser-eyeball on a viewbook Kevin designates (ⓘ render + a company-wide edit + a per-viewbook override; Feature B hide/show + persisted-hidden flash).
- On ship: update memory `project_viewbook_reading_experience`, move THIS handoff to done.

## Tooling note (logged, work later)
Recurring: `codex exec` as a background Bash job hangs on `Reading additional input from stdin...` unless `< /dev/null` is appended. Captured in memory `reference_codex_background_lanes` + roadmap tracker; fix = patch the consulting-codex skill command shapes.

## Paste this into a new chat
```
Implement the Codex-reviewed plan for two viewbook viewer features. Do NOT re-brainstorm — spec + plan are done and Codex-reviewed. Use superpowers:subagent-driven-development (or executing-plans) to build task-by-task, TDD, gate each task (tsc --noEmit + scoped vitest), full vitest + npm run build before each PR.

WORKTREE: .claude/worktrees/vb-viewer-polish on branch feat/vb-viewer-polish (already cut off origin/main; node_modules symlinked, .env copied). Work IN the worktree — another session may be live in the main checkout (run the er-seo-tools-multi-agent-coordination pre-flight).

READ FIRST:
- docs/superpowers/plans/2026-07-21-viewbook-viewer-polish.md   ← the plan (11 tasks / 2 PRs)
- docs/superpowers/specs/2026-07-21-viewbook-viewer-polish-design.md   ← the spec
- docs/superpowers/todos/2026-07-21-section-info-tooltips-handoff.md   ← this handoff (state, decisions, gotchas)
- memory: project_viewbook_reading_experience, project_viewbook_viewer_collapse (sticky/overflow), reference_prod_ssh_access (deploy), reference_codex_background_lanes (codex background: append `< /dev/null`)

PR 1 = Feature B (Tasks 1–2, client-only, no schema) — ship first, /codex-review optional.
PR 2 = Feature A (Tasks 3–11, content model + editors) — P1, /codex-review before merge.

GUARDRAILS: light-only public viewer (no dark: in components/viewbook/public/*); jsdom pragma line 1 + NO jest-dom; array-form $transaction only; NO migration (Feature A reuses existing tables via a section-copy:<key> namespace); deploy via ~/deploy.sh + prod-verify (health 200, deployed HEAD); browser-eyeball on a viewbook Kevin designates. On ship: update memory project_viewbook_reading_experience + move this handoff to done.
```
