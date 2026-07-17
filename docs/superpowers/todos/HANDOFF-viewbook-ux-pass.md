# HANDOFF — Viewbook UX Pass

**Status (2026-07-17):** **WAVE 1 MERGED to local `main`** (not pushed/deployed).
Lane 1 (Claude, Reading Experience) + Lane 2 (Codex, Operator Editing UX) both
built, per-task + whole-branch reviewed, cross-reviewed, gate-green, and merged
(`7318e21` L1, `1aac182` L2). **Automated post-Wave-1 integration gate GREEN**
(tsc + lint + 6231 tests + build on merged main). **Remaining before Wave 2:**
(1) the MANUAL browser check below; (2) Kevin's push/deploy call; (3) cut the
Wave-2 plans (Lane 3 brief + Lane 4 plan) from MERGED code.

## Wave 1 — what landed
- **Lane 1:** sticky state-only section headers (kills the blink bug — observer removed), `StickyOffsetProbe` + `--vb-sticky-offset` chrome, `data-vb-theme-root` seam, TOC rail left/default-open/**hamburger-persistent**, nav scroll offset for section + nested anchors, footer-whitespace regression guard (root cause = the removed observer's doc-shrink), admin name → public page in new tab. Codex cross-review: 4 P2, all resolved (theme-preview collapse, revoked→404 link, nested-anchor offset, TOC hover→hamburger-persistent per Kevin).
- **Lane 2 (Codex):** save-less autosave (serialized in-flight + generation guard + `stale_version` retain-draft/explicit-resolve), live-theme store + `ThemeDraftWriter`, live-draft contrast, AA-only bands, searchable checked-in Google-Fonts manifest (keys-only), operator panels open by default. Claude opus cross-review: READY TO MERGE (2 Minor follow-ups: color-edit+upload race, an impure setter smell). Codex ran clean start→finish (never usage-out).
- Codex deficiencies + sandbox issues (for Kevin to resolve) logged at `.superpowers/sdd/codex-lane2-deficiencies.md`.

## MANUAL browser check (do before opening Wave 2 — jsdom can't verify these)
Run the dev app, open a viewbook (operator mode + a public/presentation view):
- [ ] (a) **Live theme colour** — drag an operator colour; `--vb-*` update live before save.
- [ ] (b) **Live font** — change a font in the searchable picker; the `<link>` swaps live.
- [ ] (c) **Presentation-mode offset** — toggle presentation (operator bar hidden); sticky section headers re-pin with no overlap/gap (the `--vb-operator-bar-height`→0 path).
- [ ] (d) **Sticky + no blink** — scroll the Data Source (tall) section: NO flicker; headers pin under the nav; next section pushes the previous header up.
- [ ] (e) **Footer whitespace** (Task 9 deferred) — advance to Now Building, return to Getting Started; no blank band below the footer (edit + presentation modes).
- [ ] (f) **Nested-anchor offset** (P2-1) — building-stage TOC child / search hit lands the target BELOW the sticky chrome, fully visible (not tucked under the header).
- [ ] (g) **Hamburger-persistent TOC** (P2-3) — rail starts open; only the hamburger collapses/expands it; mouse-leave no longer collapses it.

Worktrees `.claude/worktrees/viewbook-l1` + `viewbook-l2` are KEPT until this manual check passes (remove with `git worktree remove` after).

## Docs (read in this order)
- Spec: `docs/superpowers/specs/2026-07-17-viewbook-ux-pass-design.md`
- Program (coordination contract): `docs/superpowers/plans/2026-07-17-viewbook-ux-pass-program.md`
- Lane 1 plan (Claude): `docs/superpowers/plans/2026-07-17-viewbook-ux-pass-lane1.md`
- Lane 2 Codex brief: `docs/superpowers/plans/2026-07-17-viewbook-ux-pass-lane2-codex-brief.md`

## Shape
4 file-disjoint lanes, 2 tandem waves. **Wave 1 = Lane 1 (Claude) ∥ Lane 2 (Codex)**,
concurrent, separate worktrees. Wave 2 = Lane 4 (Claude) ∥ Lane 3 (Codex), plans cut
at Wave-1 merge. Version control is a SEPARATE later spec (spec §14).

## Next action (this session)
1. **Claude:** open Lane 1 worktree and execute the Lane 1 plan via subagent-driven-development.
   ```bash
   cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
   git worktree list      # a 2nd Claude session shares this checkout — NEVER edit feature files on main
   git worktree add .claude/worktrees/viewbook-l1 -b feat/viewbook-l1
   ```
2. **Kevin:** fire Codex on the Lane 2 brief concurrently (its own worktree `viewbook-l2`, branch `feat/viewbook-l2`). The brief is self-contained.

## Codex budget posture (THIS push — expires ~tonight)
- Codex runs **full strength (`gpt-5.6-sol`, high)** for ALL work — overriding the ≤25%-budget downgrade — **until usage runs out**. 5h was ~77% used at last check; Kevin holds a reset.
- **Out-of-usage protocol:** any Codex call that hits a usage/limit error → **PAUSE the lane, commit+push what's green, tell Kevin in one line** ("Codex out of usage — reset to resume Lane N"). NEVER downgrade the model or silently retry. Kevin resets; re-fire the same brief from the last green commit.

## Cross-lane seams (agreed constants — both lanes build against these, no merge-order dependency)
- **`data-vb-theme-root`** on the ViewbookShell themed root (L1 adds; L2's `ThemeDraftWriter` writes `--vb-*` onto it). `data-vb-theme-font` marker on ThemeStyle's font `<link>` (L2). Store keyed by `viewbookId`.
- **`--vb-sticky-offset`** (+ `--vb-progress-nav-height`, `--vb-operator-bar-height`) published by L1's single `StickyOffsetProbe`; ProgressNav pins at `top: var(--vb-operator-bar-height,0px)`, OperatorBar `top-0 z-50`, section headers `top: var(--vb-sticky-offset) z-30`.
- After BOTH Wave-1 branches merge: run the **post-Wave-1 integration gate** (program plan) — live theme, live font, presentation-mode offset, sticky/no-blink — before opening Wave 2.

## Gotchas (from Codex review)
- `SectionShell` is a **server component** → `SectionReveal` (client) owns `expanded` + the sticky-header button + region; SectionShell only passes serializable props.
- Task 1 keeps the old `section-display` exports; they're deleted in the atomic Task 2 (keeps every commit `tsc`-green).
- Autosave: locked-baseline "Record amendment" stays an EXPLICIT button (debouncing it mints duplicate proposals). `stale_version` → keep draft, pause retry, explicit resolve.
- Repo hard rules: array-form `$transaction` only; local `tsc --noEmit` + vitest are the ONLY type gate (in-build checks disabled); `git push` before any deploy.

## Handoff protocol
This viewbook UX pass is NOT the improvement-roadmap tracker — no tracker/roadmap-handoff update needed. This doc is the single handoff for this work.

---

## Paste this into a new chat

```
Viewbook UX pass — start Wave 1. Read these first, in order:
- docs/superpowers/specs/2026-07-17-viewbook-ux-pass-design.md
- docs/superpowers/plans/2026-07-17-viewbook-ux-pass-program.md
- docs/superpowers/plans/2026-07-17-viewbook-ux-pass-lane1.md
- docs/superpowers/todos/HANDOFF-viewbook-ux-pass.md

Then take the Lane 1 worktree and execute the Lane 1 plan (Reading Experience:
sticky-header scroll rewrite that kills the blink bug, TOC left/expanded/hamburger,
footer-whitespace fix, admin open-in-new-tab) via subagent-driven-development,
committing per task with gates green (tsc --noEmit + lint + vitest) in the worktree:

  git worktree list   # a 2nd Claude session may share this checkout — never edit feature files on main
  git worktree add .claude/worktrees/viewbook-l1 -b feat/viewbook-l1

I (Kevin) am firing Codex on the Lane 2 brief
(docs/superpowers/plans/2026-07-17-viewbook-ux-pass-lane2-codex-brief.md) in parallel
in its own worktree. Codex runs full strength (gpt-5.6-sol, high) until usage runs
out — if any Codex call I ask you to make hits a usage limit, STOP and tell me in one
line so I can reset. Cross-review before merge (my Codex branch → you review; your
branch → /codex-review). After BOTH Wave-1 branches merge, run the post-Wave-1
integration gate before we open Wave 2.
```
