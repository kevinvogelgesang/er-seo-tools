# Reading-experience redesign vs. shipped viewer — overlap assessment

**Date:** 2026-07-20. **Decision owner:** Kevin. **Status:** HOLD — no merge, no deploy.

## TL;DR
`feat/vb-reading-experience` (PR #242, Wave 1 spine + Wave 2 lanes, all gate-green) was built on **`ff703b0` (PR #214)**. Main is now **`8a271c3` (PR #241), +148 commits — 70 of them viewbook**. In that window main shipped **three overlapping viewer feature-lines** that rebuilt the *same* surface this redesign targets. A dry-run merge = **23 conflicting files**, and the conflict is **semantic, not textual**: two competing viewer directions in one component tree.

**This is not a mechanical merge.** It needs a product call on which direction wins, then a re-plan against current main — done in a fresh worktree off `origin/main`, not by merging main into this stale branch.

## What shipped on main since the branch base (all in prod)
1. **Viewer collapse — local-only (PRs #215/#216).** New `CollapsibleSection` island, `CollapseAffordance` (bar/pill/chevron), `useCollapseState`, presentation-config. **Retired the `'collapsed'` state enum → `collapsedShared` (now a dormant column); `PublicSection.state` is `'active' | 'done'` only.** Viewer defaults to **collapsed-to-hero**, per-machine localStorage.
2. **Welcome auto-reveal + animated collapse + reveal pacing (PR #217).** Hero stage with cross-faded collapsed/expanded faces, animated body reveal (`grid-rows`, `--vb-reveal-scale`), bookends collapse, cinematic hero flourishes, per-viewbook `revealDurationScale` + `firstLoadDelayMs`.
3. **Hero morph (PRs #218–#221, #229, #230).** Collapsed card **spreads into the hero** (morph selector: spread/bloom/clip/pop), text pinning, scroll-sync with the morph.
4. Plus admin/preview polish (#222–#226): PresentationEditor, theme preview, feedback screenshots.

New schema columns (6 migrations): `collapsedShared`, `collapseAffordance`, `heroOverlayStrength`, `collapseMorph`, `revealDurationScale`, `firstLoadDelayMs`.
New files this branch has never seen: `CollapsibleSection`, `CollapseAffordance`, `useCollapseState`, `useWelcomeAutoReveal`, `lib/viewbook/collapse.ts`, `presentation-config.ts`, `section-display.ts`, `PresentationEditor`.

## The core UX collision
- **Main's viewer:** sections **default collapsed to hero cards**; click a card and it **morphs/spreads into a full hero**; welcome auto-reveals once per device; reveal is animation-paced.
- **This redesign's viewer:** **one continuous reading flow** — a full-hero *lead* per stage, ~220px chapter heroes, an "In this stage" overview, a hero-exit sticky label, a scroll-driven active rail, "Previous stages" rows.

These are two answers to the same question ("how does a section present and open?"). They can *combine* (reading layout + collapse as an option) but only by design decision — the code can't reconcile them automatically.

## File-by-file (the 23 conflicts, grouped)
| File | Main now does | This branch does | Nature |
|------|---------------|------------------|--------|
| `SectionShell.tsx` (479 vs 206 ln) | dual hero variants (expanded + collapsed-row), `section-display` modes, delegates to `CollapsibleSection`→`SectionReveal` | meta-driven hero sizing (full/chapter/none) + chapter header + `SectionSummaryPanel` | **hard** — two different shells |
| `SectionReveal.tsx` | state-only reveal + **reveal-pacing animation** (grid-rows / `--vb-reveal-scale`) | fixed-box sticky bar + inert `data-vb-sticky-label` + 68ch | **hard** — both rewrite reveal |
| `ViewbookShell.tsx` | mounts collapse/morph/welcome-auto-reveal orchestration | full-hero lead + StageOverview + PreviousStages + ReadingProgressController | **hard** — both own layout |
| `toc-index.ts` | main's evolution | + `TocEntry.status` | medium |
| `page.tsx` | main's render callbacks | meta-threaded callbacks | medium |
| 12 section components + tests | collapse/reveal adaptations | `meta` prop threading | medium (mechanical-ish) |
| `PcIntro/PcThanks` | bookend carve-out **retired** (all sections collapse-eligible) | my lead/bookend treatment | conflicting assumptions |

## Hard incompatibilities (beyond text conflicts)
1. **`state === 'collapsed'` is gone.** Lane D `PreviousStages` (compact-row branch) + `carriedStatus` + `computeSectionStatuses` all key off it; my test fixtures construct it. Dead/​type-invalid against main.
2. **`EarlierSteps.tsx` still exists on main** and is still wired in main's `ViewbookShell`. Lane D deletes it — main re-adds it. Must decide.
3. **Presentation-config system** (`collapseAffordance`/`collapseMorph`/overlay/pacing) — this redesign has no notion of it; the reading viewer would need to either honor or explicitly retire those operator controls.
4. **`ReadingProgressController` (scroll-driven `IntersectionObserver`)** vs main's deliberate removal of the observer for the documented "blink bug" — main's `SectionReveal` header comment explicitly says it *replaced* a self-oscillating observer. My controller is a *different* observer (writes only presentational attrs on heroes, never height), so it's not the same bug — but this needs a careful, explicit reconciliation, not a blind merge.

## Options
- **A — Reconcile both (combine).** Rebuild the reading-experience layout *on top of* main's collapse/morph/reveal viewer so both survive. Largest effort; needs a fresh spec deciding per-surface behavior (does a collapsed card morph into a *chapter* hero? does the lead auto-reveal?). ~all 23 files rewritten against new base.
- **B — Reading-experience supersedes.** Decide the continuous-reading viewer replaces collapse-first; take this branch's viewer, keep main's non-viewer changes + migrations, deliberately retire collapse/morph/reveal UX (+ its operator controls). Cleaner, but discards 3 shipped feature-lines — a real product reversal.
- **C — Shelve / re-scope.** Collapse+morph+reveal may already deliver much of what reading-experience aimed at (hierarchy, hero focus). Harvest only the non-conflicting wins from this branch (code-owned section copy, status derivation, `SectionSummaryPanel`, "In this stage" overview, Next-Steps CTA) as small additive PRs onto current main; drop the full-viewer rewrite.

## Recommendation
**C, leaning B-if-you-want-the-full-redesign.** Main has *already* shipped a strong hierarchy/hero/collapse viewer. The highest-value, lowest-risk path is to cherry-pick this branch's additive, non-conflicting pieces onto a fresh worktree off `origin/main` and ship them as small PRs, then decide separately whether the continuous-reading *layout* is still wanted over collapse-first. A full A-style reconciliation is a new spec+plan, not a merge.

**Whatever the choice: do it in a NEW worktree off current `origin/main`** (`git worktree add .claude/worktrees/<slug> -b feat/<slug> origin/main`), per `er-seo-tools-multi-agent-coordination`. Do not merge main into this stale branch.

## Process lesson
Wave 2 was built on a branch 148 commits behind main without a freshness check. When picking up an in-flight branch — especially with active parallel lanes on the same subsystem — run `git rev-list --count HEAD..origin/main` and rebase/re-cut off fresh main *before* building. PR #242 + this branch stay as reference for whichever option is chosen.
