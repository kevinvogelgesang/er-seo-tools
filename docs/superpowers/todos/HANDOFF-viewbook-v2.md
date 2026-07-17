# HANDOFF — Viewbook v2 Program (FINAL STEP: prod deploy + spec-§13 verification)

**Updated:** 2026-07-17 (end of Wave 5 / PR7 session)
**Status:** The BUILD PHASE IS COMPLETE. All 8 v2 PRs are merged to `main`. The
program has exactly ONE step left: **deploy to prod + run the spec-§13
verification pass.** No more waves, no more feature PRs.

## Current state

- **All 8 v2 PRs merged, NONE deployed.** Waves 1–5:
  - Wave 1 — PR #195 (`a7f6b53`) stage engine core + migration `20260716212619_viewbook_v2_stages`.
  - Wave 2 — PR #196 (`f533465`) live sync + PR #197 (`1964ff7`) kickoff/docs.
  - Wave 3 — PR #198 (`8672a98`) website-specifics + PR #199 (`5017128`) email+CSM.
  - Wave 4 — PR #200 (`5d5348c`) post-contract stage + PR #201 (`80fada9`) ER inline layer.
  - **Wave 5 — PR #202 (`8d4322e`) design pass** (SectionShell v2, matured header,
    TOC rail + search, SVG accents, sharp/webp). Merge commit is current `main`.
- **All v2 migrations are already on `main`** (they landed in PR1). `prisma migrate
  deploy` in the deploy command applies them; the prod smoke viewbook (id 1) was
  migrated to stage `building`.
- **`sharp` is now a direct dependency** (PR7). Prod `npm install` pulls the
  prebuilt Linux binary (the box already has sharp 0.34.5 transitively). **No new
  env vars anywhere in the entire program.**
- Docs of record: spec `docs/superpowers/specs/2026-07-16-viewbook-v2-stages-design.md`;
  program `docs/superpowers/plans/2026-07-16-viewbook-v2-program.md` (all 5 wave
  boxes checked; deploy box unchecked); PR plans `2026-07-16-viewbook-v2-pr1..pr8-*.md`
  + `…-pr7.md`. Roadmap tracker has a status-log line per wave (Wave 5 is the last).

## THE FINAL STEP: prod deploy + spec-§13 verification

### 1. Deploy
`main` is already pushed. Resolve `$PROD_SSH` from ops notes (`docs/SERVER_SETUP.md`
legend; `.claude/ops-secrets.local.sh` is the gitignored source — `source` it), then:
```bash
ssh $PROD_SSH "~/deploy.sh"
```
`deploy.sh` pulls `main`, `npm install` (sharp binary), `prisma migrate deploy`
(no-op — migrations already applied), builds, PM2 restart. In-build type-check/lint
are DISABLED on the box (deploy-OOM fix) — the local gates already passed (tsc/lint
clean, 6183/6183 tests, build OK), so that's fine.

### 2. Verify (spec §13 + the deploy notes)
- **Prod smoke viewbook (id 1, stage `building`) renders.** Load its public page;
  confirm the SEO/design pass renders (summary faces, scroll reveal, the matured
  header with stage stepper, the floating TOC rail). Program deploy note: verify it
  is render-equivalent to v1 content (no missing sections).
- **SectionShell v2 behaviors:** scroll the page — sections auto-expand on enter /
  collapse on leave; a section you manually toggle stays put; a section you're
  editing (focus / active edit) does NOT auto-collapse; `prefers-reduced-motion`
  (toggle OS setting) → everything static, done/ack collapsed. Confirm collapsed
  regions are NOT keyboard-reachable (the PR7 P1 `inert` fix) — Tab should skip
  clipped content.
- **TOC rail:** dots expand on hover/focus; ack/done glyphs correct; arrow-key nav;
  in `building`, the Q&A category sub-entries + the search box work (a search hit
  inside a closed "Earlier steps" `<details>` or a collapsed category should OPEN
  the ancestor and flash the target — the PR7 P2 fix); mobile → bottom-sheet FAB.
- **Operator layer coexists:** log in as an ER operator (verified-email session),
  load the public page — the inline controls render, presentation-mode toggle hides
  them, and the scroll-reveal still works. Confirm NO RSC serialization crash for
  operators (the Wave-4 P1 class — the PR7 wiring kept the guard green, but verify
  live).
- **sharp/webp upload:** in the admin/operator theme editor, upload a logo (png/jpg)
  — it should store as `.webp` and serve; try an SVG (rejected 400) and an oversize
  file (rejected 413). The prod-profile already proved the decode is bounded
  (1059ms / 159MB peak at 36MP→4000px).
- **Anonymous payload has no operator data** (spec §13 — already unit-asserted, but
  spot-check the public HTML source contains no operator markers).

### 3. Close out
Once verified: check the program-doc "Prod deploy + spec-§13 verification pass" box,
add a roadmap-tracker status-log line (deployed + what was verified), and **retire
this handoff** (the v1 viewbook handoff was deleted on ship — do the same; `git rm`
it, or leave a one-line "program complete, deployed <date>" tombstone). The program
is then fully done.

## Deferred fast-follows (NOT blocking deploy — triage after)
None are correctness blockers; all were logged during PR7 review and deliberately deferred:
- **`toc-index.ts` `fuzzyScore` index-0 over-credit** — a haystack match at index 0
  is spuriously credited as a run (`lastMatchIndex` starts -1). Search-ranking
  wobble only; one-line fix (`qi>0` guard or seed `lastMatchIndex` to `-2`).
- **`TocRail.tsx` `moveFocus`** focuses inside a `setActiveIndex` updater (side-effect
  in reducer) — harmless, cleaner to compute-then-focus.
- **`summary-metrics.ts` `docCount`** param typed `unknown[]` vs `PublicDocRow[]`
  (cosmetic); generic `SummaryStat` eyebrow duplicates the section h2 title (visual
  redundancy — a distinct eyebrow label would read better).
- **Visual, for Kevin's eye post-deploy:** done sections render taller than v1's slim
  `<details>` (SectionShell v2 gives every section the full brand header band);
  below-the-fold normal sections do a brief post-mount collapse settle on
  content-heavy pages.
- **CLAUDE.md drift:** the prod box runs **Node 24.14.1**, but CLAUDE.md's "Stack
  constraints" says "Node 22 on production." Correct the doc (sharp 0.34.5 has Node
  24 prebuilts, so nothing broke — but the constraint line is stale).

## Gotchas (earned across the program — still apply for the deploy session)
- **The public viewbook is LIGHT-ONLY** (no `dark:` in `components/viewbook/public/**`).
- **RSC boundary:** `page.tsx`/`ViewbookShell`/`SectionShell`/`ProgressNav`/
  `EarlierSteps`/section components are SERVER; `SectionReveal`/`TocRail`/
  `OperatorLayer/*`/`PresentationToggle` are `'use client'`. Never a function prop
  server→client. The Wave-4 P1 (render closures crossing the boundary) is the
  cautionary tale; PR7 kept `page.test.tsx`'s guard green.
- **Always `git push` before SSHing** — the server pulls from GitHub (main is pushed).
- **In-build type-check/lint are DISABLED on the box** — local gates are the only
  gate; never re-enable them without solving server build memory (3.9 GB box OOM'd).
- Sharp runs at UPLOAD time only (request path), single-flight serialized; prod
  profile confirmed bounded RSS.

## Paste this into a new chat

```
Deploy the viewbook-v2 program to production and run the spec-§13 verification pass — this is the FINAL step (all 8 v2 PRs are merged to main, none deployed). Read docs/superpowers/todos/HANDOFF-viewbook-v2.md first, then the program doc (docs/superpowers/plans/2026-07-16-viewbook-v2-program.md) and spec §13 (docs/superpowers/specs/2026-07-16-viewbook-v2-stages-design.md). Fast-forward local main to origin/main first. Deploy via `ssh $PROD_SSH "~/deploy.sh"` (resolve $PROD_SSH by sourcing .claude/ops-secrets.local.sh; deploy.sh pulls main + npm install [sharp prebuilt binary] + prisma migrate deploy [no-op, migrations already on main] + build + PM2 restart; in-build checks are disabled on the box — local gates already pass 6183/6183 + build). Then run the spec-§13 verification on the live site: prod smoke viewbook id 1 (stage building) renders v1-equivalent; SectionShell v2 scroll reveal + manual-wins + never-collapse-on-focus/edit + reduced-motion static + collapsed-region NOT keyboard-reachable (the inert fix); matured header (stage stepper + CSM mailto); TOC rail (ack/done glyphs, arrow nav, building-verbose + search that opens closed <details> ancestors on a hit, mobile bottom-sheet); operator layer coexistence + presentation toggle + NO RSC crash for operators; sharp/webp logo upload stores .webp, SVG→400, oversize→413; anonymous public HTML has no operator markers. When verified: check the program-doc deploy box, add a roadmap-tracker status-log line, and RETIRE this handoff (git rm it or leave a one-line deployed tombstone — the v1 handoff was deleted on ship). Deferred fast-follows (non-blocking, in the handoff): fuzzyScore index-0 over-credit, docCount typing, generic-eyebrow redundancy, done-sections-taller visual, and the CLAUDE.md Node-22→Node-24 drift to correct. Do NOT start new feature work — this closes the program.
```
