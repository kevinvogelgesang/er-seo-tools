# Viewbook Reading-Experience Redesign — Wave 2 Handoff

**Date:** 2026-07-20. **Author:** Wave-1 session. **Status:** Wave 1 (spine) COMPLETE + reviewed + committed. Wave 2 (5 lanes) NOT started.

## What this feature is
Public viewbook viewer redesign into one continuous, hierarchy-driven reading experience: one full hero (55–65vh) for the current stage's lead section, ~220px chapter heroes, an "In this stage" overview, a hero-exit sticky label, a strong active-rail marker, "Previous stages" as compact rows, Welcome editorial cards, Next-Steps CTA, mobile "Sections" pill, ~68ch prose measure. **Light-only; NO schema/editor/API change; all new copy/status is code-owned.**

- **Spec:** `docs/superpowers/specs/2026-07-20-viewbook-reading-experience-design.md` (Codex-reviewed, 11 fixes applied)
- **Plan:** `docs/superpowers/plans/2026-07-20-viewbook-reading-experience.md` (Codex-reviewed, 10 fixes applied) — **read the "WAVE 2 — LANES" section + §4 contracts before starting a lane.**
- **Ledger (per-task history, commits, notes):** `.superpowers/sdd/progress.md` in the spine worktree.

## Branches & worktrees
- **Integration branch = `feat/vb-reading-experience`** @ `d140389` (worktree `.claude/worktrees/vb-reading-experience`). This is the SPINE. All lanes branch off it and merge back into it.
- **Codex lane worktree = `.claude/worktrees/vb-lanes-abc`** on branch `feat/vb-lanes-abc` (already created off the spine, node_modules symlinked, .env copied) — ready for Codex to build lanes A/B/C.
- My Lane D/E can be built in the spine worktree (or its own branch) — disjoint files, so no conflict with Codex's branch.

## Wave 1 spine — DONE (11 code commits, `9054f83`..`d140389`)
Every task TDD'd + task-reviewed clean; final opus whole-branch review = **MERGEABLE AS SPINE** (no Critical/Important; tsc clean; 76 spine tests green in isolation).
Shipped: `section-copy.ts`, `section-status.ts` (+`SectionRenderMeta`), `section-origin.ts`, `toc-index.ts` status, `SectionSummaryPanel.tsx` (+`StatusPill`), `ChapterCtaButton.tsx`, `SectionShell.tsx` (meta + chapter header + DOM contract) threaded through `page.tsx` + all 13 sections, `SectionReveal.tsx` (fixed-box sticky reveal label + measure), `StickyOffsetProbe.tsx` (emits `vb:sticky-offset-change`), `ViewbookShell.tsx` (full-hero lead + overview + PreviousStages + mounts controller). Stubs shipped for `ReadingProgressController` / `StageOverview` / `PreviousStages`.

### ⚠️ DEPLOY CAVEAT
The spine ALONE regresses the live page (StageOverview renders inert, collapsed carried sections render empty). **Do NOT merge-to-main + deploy until Wave-2 lanes A & D land.** Keep `feat/vb-reading-experience` as the integration base; one PR to main after ALL lanes.

## Frozen contracts the lanes consume (do NOT edit spine files from a lane)
- DOM: section root has `data-vb-section` / `data-vb-status` / `data-vb-hero-visible`; hero div has `data-vb-hero` (absent when heroSize='none'); sticky duplicate label `data-vb-sticky-label` (aria-hidden, text-only) fades via `[data-vb-hero-visible="true"] [data-vb-sticky-label]{opacity:0}`.
- Rail identity (Lane B EMITS, Lane A CONSUMES): top-level rail buttons must carry `data-vb-toc-section="{sectionKey}"`. Lane A sets `data-vb-active` + `aria-current="location"` on the live node.
- `vb:sticky-offset-change` window event (`detail:{offset}`) from StickyOffsetProbe → Lane A rebuilds its observer. **It fires on EVERY recompute (not deduped) — Lane A MUST dedup on `detail.offset`.**
- `SectionRenderMeta`/`SectionStatus`/`computeSectionStatuses`/`carriedStatus` from `lib/viewbook/section-status.ts`. `TocEntry.status` already populated.

## Wave 2 — the 5 lanes (disjoint files)
| Lane | File(s) | Owner |
|------|---------|-------|
| A. ReadingProgressController | `ReadingProgressController.tsx` (+test) | **Codex (Sol)** |
| B. TocRail active-state/glyphs/`data-vb-toc-section`/Sections pill | `TocRail.tsx` (+test) | **Codex (Sol)** |
| C. WelcomeSection editorial cards | `WelcomeSection.tsx` (+test) | **Codex (Sol)** |
| D. StageOverview + PreviousStages (real) + DELETE `EarlierSteps.tsx`(+test) | `StageOverview.tsx`, `PreviousStages.tsx` (+tests) | **Claude** |
| E. KickoffNextSection action summary + CTA (reuse `ChapterCtaButton`) | `KickoffNextSection.tsx` (+test) | **Claude** |

Each lane's full spec is in the plan's "Lane X — Task X" section. Build TDD, one commit/PR per lane onto the integration branch.

## Gotchas (learned in Wave 1)
- **NO jest-dom in this repo.** DOM-native assertions only (`container.querySelector(...).toBeTruthy()`, `.textContent`, `getAttribute`). NEVER `toBeInTheDocument`.
- **RTL test files need `// @vitest-environment jsdom`** at the top (project default env is node).
- **LIGHT-ONLY** — never emit `dark:`; color via `--vb-*` vars.
- **Lane B must backfill** `TocRail.test.tsx` — its hand-built `TocEntry` literals now lack the new `status` field (harmless to tsc since test files are excluded, but update for correctness).
- **Lane D:** `PreviousStages` stub hardcodes `status:'complete'` + its map lacks a React `key` — fix in the real impl. Collapsed carried sections (`state:'collapsed'`) must render as NON-expandable compact rows (spec §5 item 7 / §7 fix #8) — the stub currently yields an empty section.
- **ENV BASELINE (not a bug):** the shared `node_modules` Prisma client has a `collapseAffordance` column from the `hybrid-discovery-expansion` worktree's `prisma generate`. DB-backed tests fail on it in combined runs (~206). Per-suite isolation of viewbook component tests passes. **Do NOT run `prisma generate`** (would break the hybrid-discovery lane). Gate = each lane's own/affected suites in isolation + `tsc --noEmit`.
- **Deferred Minors for final feature review:** introNote has no ~68ch clamp (1-line SectionShell follow-up); SectionSummaryPanel eyebrow markup dup; ViewbookShell status recompute at 2 sites; section-copy cta untested.

## Codex budget
5h was at **83%**, weekly not captured in the snapshot. **Use Sol** for Codex (Kevin's standing instruction — overrides the budget-gated terra fallback). **Ping Kevin if Codex starts hitting rate limits / weekly gets eaten — he has a reset in reserve.** Tandem model: give Codex the `vb-lanes-abc` worktree (write sandbox), have it build A→B→C serially committing per lane; Claude builds D/E in parallel.

## Finish sequence (after all lanes land)
Merge lanes → `feat/vb-reading-experience`; `npx tsc --noEmit` + per-suite vitest green; integration pass fixes only merge/wiring (never repairs a shared contract inside a lane file); **browser eyeball** (animation feel, CLS, active-state, mobile sheet — no local `/verify` for viewbook); triage deferred Minors; ONE PR to main; deploy (`git push` then `ssh $PROD_SSH "~/deploy.sh"`); prod-verify a real viewbook page.

---

### Paste this into a new chat to run Wave 2

```
Continue the viewbook reading-experience redesign — run WAVE 2 (the 5 lanes). Read the handoff first: docs/superpowers/todos/2026-07-20-vb-reading-experience-wave2-handoff.md (in the feat/vb-reading-experience worktree). Wave 1 spine is DONE + reviewed + committed on feat/vb-reading-experience @ d140389; the plan is docs/superpowers/plans/2026-07-20-viewbook-reading-experience.md and the per-task ledger is .superpowers/sdd/progress.md.

Run it TANDEM: hand lanes A/B/C to Codex on Sol (its worktree .claude/worktrees/vb-lanes-abc is already set up, off the spine), Claude builds lanes D and E. Honor the frozen §4 contracts + the gotchas in the handoff (no jest-dom, jsdom pragma, light-only, the collapseAffordance env baseline — do NOT prisma generate, the Lane B TocRail test backfill, the Lane A sticky-offset dedup, Lane D collapsed-carried compact rows). Ping me if Codex hits rate limits (I have a weekly reset). Do NOT deploy the spine alone — integrate all lanes into feat/vb-reading-experience, then one PR to main + deploy, then browser-eyeball.
```
