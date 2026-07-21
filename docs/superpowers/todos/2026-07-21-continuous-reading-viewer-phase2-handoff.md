# Continuous-reading viewer — Phase 2 (viewerMode toggle) build handoff

**Date:** 2026-07-21. **Owner:** Kevin. **Mode:** autonomous — execute the plan's P2 tasks straight through to deploy (the spec + plan are already written and Codex-reviewed; no new spec/plan needed).

## Where things stand
- **Phase 1 (continuous-reading as the DEFAULT viewer) SHIPPED + prod-verified 2026-07-21** — PR #245, main `6e2e5291`, deployed, health 200, live `/viewbook/<token>` renders continuous (collapse markers absent). Docs archived (PR #246).
- The collapse-first viewer (CollapsibleSection morph + welcome-auto-reveal + EarlierSteps) is **preserved in code, dormant**, reached today only via `ThemePreview` and — once Phase 2 ships — the operator toggle.

## The Phase 2 decision (locked)
Add a **per-viewbook `viewerMode` toggle** (`'continuous' | 'collapse'`, default `'continuous'`) so an operator can switch a single viewbook back to the collapse-first viewer. **Separate follow-up PR** (Phase 1 already shipped). Build it **only if it stays clean**; if it balloons, stop and report.

## The read side is ALREADY wired (Phase 1) — do NOT redo it
- `presentation-config.ts` exports `VIEWER_MODES`/`ViewerMode`; `PRESENTATION_DEFAULTS.viewerMode='continuous'`; `readPresentationConfig` resolves `row.viewerMode` (absent/invalid → `'continuous'`).
- `ViewbookPublicData.viewerMode` exists; `public-data.ts` already spreads it via `readPresentationConfig(vb)` (the public loader gets the full Viewbook row, so it picks up the DB column automatically once it exists).
- `SectionShell`/`ViewbookShell` already branch on `viewerMode` (continuous vs the dormant collapse path). `ThemePreview` already passes `viewerMode="collapse"`.
- So Phase 2 is purely the **write/persist/operator-control lifecycle + the DB column**.

## READ FIRST (all on main after PR #245/#246)
- Plan tasks **P2-1 … P2-4**: `docs/superpowers/archive/plans/2026-07-21-continuous-reading-viewer.md` (the "PHASE 2" section — has the exact steps/code).
- Spec §4 (mode-gating), §7 (Phase-2 file list), §11 (dormant-path assurance), §14: `docs/superpowers/archive/specs/2026-07-21-continuous-reading-viewer-design.md`.
- Memory `project_viewbook_reading_experience` (shipped state) + `reference_prod_ssh_access` (deploy; the deploy-key blocker from 07-21 is RESOLVED).

## The 4 tasks (TDD each; gate `npx tsc --noEmit` && `npx vitest run <scope>` green per step)
1. **P2-1 — migration + strict write validation.** Add `Viewbook.viewerMode String @default("continuous")` to `prisma/schema.prisma`; `npx prisma migrate dev --name viewbook_viewer_mode` (fallback: hand-author `ALTER TABLE "Viewbook" ADD COLUMN "viewerMode" TEXT NOT NULL DEFAULT 'continuous';` + `migrate deploy` + `generate`). Add `viewerMode` validation to `parsePresentationPatch` — **add it to BOTH the return-type annotation AND the local `patch` var type** (`400 invalid_viewer_mode` on a non-member; reuse the existing `isViewerMode`). Tests in `presentation-config.test.ts`.
2. **P2-2 — persist path + operator read model.** `lib/viewbook/service.ts` `updateViewbookPresentation` must accept + write `viewerMode` and bump `syncVersion` (grep how `collapseMorph` threads). `lib/viewbook/operator-data.ts`: add `viewerMode` to the explicit Prisma `select` AND the operator read-model interface (the public loader needs no select change; operator-data uses an explicit select and DOES). **Test the FULL chain by extending `app/api/viewbooks/routes.test.ts`'s presentation-PATCH test** (route→parse→writer→DB persists the column + one syncVersion bump + 400 on bad value) — a service-only test does not prove the chain. Plus `operator-data.test.ts` exposes it.
3. **P2-3 — operator control in `PresentationEditor`.** Add a 2-option Continuous/Collapse control to `components/viewbook/admin/PresentationEditor.tsx` (+ `viewbook-admin-shared.ts` config), single atomic PATCH + sync bump like the other presentation fields. `app/api/viewbooks/[id]/route.ts` already routes presentation patches through `parsePresentationPatch` — verify the PATCH persists via `updateViewbookPresentation`. Test in `PresentationEditor.test.tsx`.
4. **P2-4 — dormant-path assurance (spec §11).** Before relying on the toggle: an integration test that renders `ViewbookShell` with `data.viewerMode:'collapse'` and asserts the `CollapsibleSection` island (`button[aria-expanded]`) + `EarlierSteps` render, and a `vb:navigate` deep-link force-opens the target. (Note: `ViewbookShell.test.tsx` already has a collapse-wiring test from Phase 1 — extend, don't duplicate.)

## Guardrails / gotchas
- **Fresh worktree off `origin/main`** — `git fetch && git rev-list --count HEAD..origin/main` MUST be 0 before building; `git worktree add .claude/worktrees/<slug> -b feat/<slug> origin/main`, symlink `node_modules`, copy `.env` (NOT `.env.local`). Adding a migration → `npx prisma generate` is expected.
- **Schema change → this diff is P1-risky** (Prisma column + write path): run `/codex-review` on the branch diff before merge (per the budget guard).
- Array-form `$transaction` only; the PATCH goes through the existing route kit (no new transaction). NO jest-dom; RTL tests `// @vitest-environment jsdom` line 1; light-only.
- Gate before PR: `npx tsc --noEmit` && full `npx vitest run` green; `npm run build` (use the repo `build` script for the heap setting).
- **Deploy:** `git push` FIRST → `source .claude/ops-secrets.local.sh && ssh $PROD_SSH "~/deploy.sh"` (this deploy DOES apply a migration via `prisma migrate deploy`). Prod-verify: health 200, deployed HEAD == merge, migration applied.
- **After deploy:** flip ONE real viewbook to `collapse` via the new control and **browser-eyeball** the collapse-first render (spec §11 assurance) before trusting the toggle — there's no local `/verify` for viewbook.
- On ship: update memory `project_viewbook_reading_experience` + move this handoff's spec/plan refs are already archived; archive nothing new unless you add docs.

## Paste this into a new chat
```
Build Phase 2 of the continuous-reading viewer: the per-viewbook `viewerMode` toggle (operator can switch a viewbook back to the dormant collapse-first viewer; values 'continuous'|'collapse', default 'continuous'). Phase 1 (continuous as default) already SHIPPED (PR #245, main 6e2e5291, deployed + prod-verified). This is a SEPARATE follow-up PR.

Autonomous: execute the plan's Phase 2 tasks (P2-1..P2-4) straight through to deploy — the spec + plan are already written and Codex-reviewed, no new spec/plan needed. Build only if it stays clean; if it balloons, stop and report.

READ FIRST:
- docs/superpowers/todos/2026-07-21-continuous-reading-viewer-phase2-handoff.md  ← this handoff (guardrails, the 4 tasks, gotchas)
- docs/superpowers/archive/plans/2026-07-21-continuous-reading-viewer.md  ← the "PHASE 2" section = exact steps/code for P2-1..P2-4
- docs/superpowers/archive/specs/2026-07-21-continuous-reading-viewer-design.md  ← §4/§7/§11/§14
- memory project_viewbook_reading_experience + reference_prod_ssh_access

KEY: the READ side is already wired in Phase 1 (VIEWER_MODES/ViewerMode + readPresentationConfig default 'continuous' + ViewbookPublicData.viewerMode + SectionShell/ViewbookShell branch + ThemePreview viewerMode='collapse'). Phase 2 = ONLY the write/persist/operator-control lifecycle + the DB column: (P2-1) Viewbook.viewerMode migration + parsePresentationPatch validation (add to BOTH typings); (P2-2) service.ts updateViewbookPresentation persist + syncVersion bump + operator-data.ts select/interface, tested via extending app/api/viewbooks/routes.test.ts (full route chain, not service-only); (P2-3) PresentationEditor 2-option control; (P2-4) dormant-path assurance test (extend ViewbookShell.test.tsx collapse-wiring).

GUARDRAILS: fresh worktree off origin/main (freshness check first; symlink node_modules + copy .env not .env.local); schema-change diff is P1-risky → /codex-review before merge; array-form $transaction only; NO jest-dom, jsdom pragma on RTL tests, light-only; gate every step (tsc --noEmit && vitest) + npm run build before PR; deploy applies the migration (prisma migrate deploy) so prod-verify the migration + health 200 + deployed HEAD; after deploy flip one real viewbook to 'collapse' and browser-eyeball the collapse render (no local /verify for viewbook). Per Kevin's global CLAUDE.md the spec/plan are already Codex-reviewed; still /codex-review the final diff given the schema change. Update memory + move this handoff to done on ship.
```
