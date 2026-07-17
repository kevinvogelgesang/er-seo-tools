# HANDOFF — Viewbook v2 Program (wave-per-session cadence)

**Updated:** 2026-07-17 (end of Wave 4 session)
**Cadence (Kevin, binding):** ONE session per wave. Finish the wave's PR(s),
merge, then rewrite this handoff and end the final reply with the paste-prompt
below. Never start the next wave's plans, briefs, worktrees, or dispatches in
the same session.

## Current state

- **Wave 1 MERGED** — PR #195 (`a7f6b53`): stage engine core (schema/migration
  `20260716212619_viewbook_v2_stages`, stage catalog, lineup rendering +
  Earlier-steps band, fenced stage-move route, admin stage chip).
- **Wave 2 MERGED** — PR #196 (`f533465`, live sync) + PR #197 (`1964ff7`,
  kickoff-next + strategy PDF docs, Codex lane).
- **Wave 3 MERGED** — PR #198 (`8672a98`, website-specifics) + PR #199
  (`5017128`, email infra + CSM, Codex lane).
- **Wave 4 MERGED** — PR #200 (`5d5348c`, post-contract stage, Claude lane) +
  PR #201 (`80fada9`, ER inline layer, Codex lane). NOT disjoint → PR5 merged
  FIRST, PR8 rebased onto it + owns the two-branch page/session integration.
  PR5 gates 6055 / PR8 gates 6083 + build. PR5 Codex 5×P2 fixed; **PR8 Codex
  exec review caught a P1 the (opus-substitute) whole-branch review missed —
  render closures passed across the Server→Client RSC boundary (runtime crash
  for every operator; tsc/build/tests do NOT enforce RSC serialization)** —
  fixed by server-composing the operator tree + passing it as `children`; + 3
  P2 fixed. The tandem cross-review earned its keep.
- **NOT DEPLOYED.** Deploy plan (program doc): minimum one deploy after Wave 5;
  Kevin may deploy earlier. All v2 migrations are already on `main`. `sharp` is
  NOT yet a dependency — it lands in **PR7**. No new env vars anywhere in the
  program.
- Docs of record: spec `docs/superpowers/specs/2026-07-16-viewbook-v2-stages-design.md`
  (Codex-reviewed ×12 + wave amendments), program
  `docs/superpowers/plans/2026-07-16-viewbook-v2-program.md` (waves, lane rules,
  cadence, file-ownership — Wave 4 box checked), PR plans/briefs
  `2026-07-16-viewbook-v2-pr1..pr8-*.md`. SDD ledger:
  `.superpowers/sdd/progress.md` (wave-by-wave detail incl. triaged findings).
- Codex consult session (registry, er-seo-tools workspace):
  `019f2b57-fde6-7cf2-93d1-8bb6d0cd43b6` — resume it for the PR7 plan review.
  **Budget at wave-4 end: weekly window ~62%+ used (several Sol High calls this
  wave); 5h window fresh.** Re-check the consulting-codex budget snapshot at the
  start of the next session; Sol High while the 5h window has >25% left; on
  exhaustion PAUSE Codex work and tell Kevin.
- **Tooling note:** Fable hit its 5h limit mid-Wave-4 — the whole-branch
  reviews fell back to **opus**. If Fable is still limited next session, use
  opus (most-capable available) for the PR7 whole-branch review. The Codex-lane
  exec review is what caught the Wave-4 P1, so keep the `codex exec review`
  pre-merge gate regardless.

## Next: Wave 5 = PR7 design pass (SOLO Claude lane — NO Codex lane)

Per the program doc's wave table, Wave 5 is a **single Claude-lane PR7**, no
concurrent Codex implementation lane (the visual pass restyles the FINAL
section set once, with no concurrent structural edits). Codex is used only for
(a) the PR7 plan review and (b) the pre-merge `codex exec review`.

**PR7 — Design pass** (spec §7 composition/design + §9 images/PDFs/tester):
- **SectionShell v2** — every section gets a *summary face* (headline, one-line
  status, key number/visual — legible while scrolling) + a *detail body*.
  Bodies auto-expand (animated) on entering the viewport, contract on leaving,
  UNLESS the section is acknowledged/done (stays collapsed until deliberately
  opened) or the user manually toggled it (manual wins for the pageview).
  `IntersectionObserver` + CSS transitions. **Motion rules (spec §7 / Codex fix
  12):** `prefers-reduced-motion: reduce` disables transitions/auto-behavior
  only — acknowledged/done stay collapsed, everything else renders expanded +
  static. A section containing focus or unsaved edits is NEVER auto-collapsed.
- **Matured sticky header** — client logo, stage name + stage progress, CSM
  chip (photo + name + mailto).
- **Floating right-edge TOC rail** — collapsed to dots; expands on
  hover/focus/tap with section labels + ack/done checkmarks; click scrolls;
  keyboard-accessible (focusable, arrow nav); collapses to a bottom-sheet
  toggle on small screens. In `building` the rail is verbose (Q&A categories as
  sub-entries) and gains **search**: client-side fuzzy filter over a
  server-serialized index (section titles, Q&A labels/values, milestone titles,
  material labels, doc titles) — select a hit → scroll + flash-highlight. No
  server round-trip; index holds only already-rendered data.
- **SVG accents** — code-owned decorative accents tinted via the existing
  `--vb-*` CSS vars.
- **sharp/webp upload pipeline (spec §9)** — add `sharp` as a **DIRECT**
  dependency (currently transitive) and verify Next production bundling
  (`serverExternalPackages`). Both asset routes: reject on `Content-Length` AND
  `File.size` BEFORE `arrayBuffer()` → magic-byte sniff (png/jpg/webp allowlist,
  **SVG rejected**) → sharp decode (catch decode errors → 400) → re-encode to
  server webp (strips EXIF/metadata). PDFs stay magic-byte-sniffed + size-capped
  + served through the ownership+allowlist asset route with `nosniff` + `inline`.
  **Deploy prereq (program §Deploy):** profile a sharp decode at max dimensions
  on the prod box before merge.

Use the **frontend-design skill** to drive the concrete visual language (the
spec pins behaviors, not pixels). LIGHT-ONLY public surface throughout.

### PR7 must compose with what Waves 4–5 already shipped (don't regress)
- **PR8's operator layer wraps sections** via `OperatorSectionWrapper` (a client
  island composed server-side around each `renderSection` output) and the
  operator branch passes the composed `ViewbookShell` tree as `children` to the
  client `OperatorViewbookLayer`. SectionShell v2's summary-face/scroll behavior
  must work whether or not a section is wrapped by the operator layer, and the
  per-section operator controls must stay reachable. Do NOT reintroduce function
  props across the Server→Client boundary (the Wave-4 P1) — `page.tsx` composes
  server-side, `OperatorViewbookLayer` takes only serializable props + children.
- **PR5's acknowledged-collapse:** `SectionShell` currently collapses a section
  when `state==='done'` OR `section.acknowledgedAt != null`. Wave-4 review noted
  this collapse applies in EVERY stage, whereas spec §4 says later stages render
  the carried ack sections "regardless of ack state" (it bites `building`, where
  `data-source` is primary — an acked data-source renders collapsed in the main
  flow). **PR7 decides this deliberately:** gate the ack-collapse on
  stage/lineup, OR amend the spec sentence. Fold it into the SectionShell v2
  redesign.
- **ProgressNav dots** currently reflect only `state==='done'`, not
  `acknowledgedAt` — the TOC-rail redesign is the place to add ack/done
  checkmarks (spec §7).
- **presentation mode** (PR8) hides the ER layer client-side; SectionShell v2's
  auto-expand/collapse is orthogonal (public behavior) — verify they coexist.

### Sync-bump gate for PR7
Spec §7/§9 asset writes ARE rendered-data mutations (theme/logo/hero/doc). Any
NEW write path PR7 adds must adopt `syncVersionBumpStatement()`/
`syncVersionBumpWhere()` from `lib/viewbook/sync.ts` inside the same fenced
array txn with relative-delta bump/no-bump tests. The existing asset/theme/doc
routes already bump — reuse them; only genuinely-new write paths need new bumps.

## Session flow (solo Claude lane — simpler than a tandem wave)
1. Cut the PR7 plan JUST-IN-TIME from merged main
   (`git fetch origin main && git merge --ff-only origin/main` first). Use the
   **frontend-design** skill for the visual language + **superpowers:writing-plans**
   for structure; dispatch Explore agents for current-state facts first
   (SectionShell v2 seam + PR8's OperatorSectionWrapper composition, the header/
   ProgressNav/EarlierSteps components, both asset routes + their caps, the
   theme/hero/logo/doc write paths + their existing bumps, whether `sharp` is a
   dep). Save to `docs/superpowers/plans/2026-07-16-viewbook-v2-pr7.md`.
2. Route the plan through Codex review (consulting-codex, resume registry
   session `019f2b57…`, model per the budget snapshot — Sol High while the 5h
   window has >25% left); apply named fixes; commit on main (docs-only OK;
   fast-forward local main to origin first, then push).
3. ONE worktree: `git worktree add .claude/worktrees/viewbook-v2-pr7 -b feat/viewbook-v2-pr7`;
   bootstrap `npm install` + `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy`.
   (No Codex lane / no second worktree this wave.)
4. Execute PR7 via superpowers:subagent-driven-development (per-task briefs via
   the skill's `scripts/task-brief`; review every task with
   `scripts/review-package BASE HEAD`; BASE = the recorded pre-dispatch branch
   HEAD, never a later main commit). Record `.superpowers/sdd/base-pr7.txt`.
5. Before merge: full gates (`npx tsc --noEmit`, `DATABASE_URL="file:./local-dev.db" npm test`,
   `npm run build`) + a whole-branch review (opus if Fable still limited) + a
   `codex exec review --base main` (P1). Fix Critical/Important/valid-P2, re-gate.
   Profile the sharp max-dimension decode on the prod box (deploy prereq).
6. Merge PR7. Then close the wave: roadmap-tracker status-log line, program-doc
   Wave-5 checkbox, rewrite this handoff for the **prod deploy + spec-§13
   verification pass** (the final program step), end with the new paste-prompt.
   STOP — do not start the deploy in the same session unless Kevin says so.

## Gotchas (earned across the program)

- **The public viewbook is LIGHT-ONLY.** `ViewbookShell`/`SectionShell` use NO
  `dark:` variants (their header comments say so). Do NOT tell implementers to
  "match sibling dark-mode variants" for PUBLIC viewbook components — that's the
  ADMIN convention. Codex caught this as a P2 twice (PR6 ContrastTester, PR8
  operator layer). Admin components (`components/viewbook/admin/**`) DO use `dark:`.
- **RSC Server→Client boundary (Wave-4 P1).** `page.tsx` + `ViewbookShell` are
  SERVER components (server→server closures like `renderSection` are fine);
  `OperatorViewbookLayer`/`OperatorSectionWrapper`/most `components/viewbook/public/*`
  islands are `'use client'`. NEVER pass a function prop from a Server Component
  into a Client Component (Next cannot serialize it → runtime crash;
  tsc/build/vitest do NOT catch it). Pass server-rendered nodes as `children`,
  and only serializable data as props. `usePresentationMode()` has a safe
  no-provider default — keep it that way (the anonymous branch renders
  presentation-aware components with no provider).
- **This repo has NO jest-dom.** setupFiles is only `./test/setup-worker.ts`.
  Component tests use DOM-native assertions (`toBeTruthy`, `.textContent`,
  `querySelector`, `.not.toBeNull`) — never `toBeInTheDocument`/`toHaveTextContent`.
- **Array-form `$transaction([...])` only**; it can't consume a prior
  statement's autoincrement id (key downstream rows off app-generated UUIDs).
  Raw SQL sets `updatedAt`/timestamps manually (integer ms `Date.now()`).
- `codex exec review` supports `-m`/`-c`/`--base`/`--output-last-message`/`--json`
  but NOT `--cd` — run it via `cd <worktree>`. Its output is huge (echoes the
  files it reads) — the verdict is the final `codex` message block; grep/tail it.
  Use `--base <PR-base-sha>` when local `main` is stale (it defaults to the local
  `main` ref, which lags behind `origin/main` until you ff it).
- **Never run two vitest suites concurrently in ONE worktree** (shared
  `.test-dbs/` → phantom failures). Sequence runs; reviewer subagents rerun too.
- The Bash session cwd PERSISTS across commands — always `cd` explicitly. The
  SDD `task-brief`/`review-package` scripts (in the superpowers plugin dir, not
  repo `scripts/`) write relative to `git rev-parse --show-toplevel`.
- Review-package BASE must be an ancestor of HEAD (the recorded pre-dispatch
  branch HEAD, never a later main commit).
- Other Claude sessions may run in the main checkout — feature work only in
  worktrees; docs-only commits on main are OK, but **fast-forward local main to
  `origin/main` first**, then push.
- `.superpowers/` is git-ignored; per-PR report/brief files reuse the
  `task-N-brief.md` / `pr7-task-N-report.md` naming.
- The prod smoke viewbook (id 1) is stage `building` post-migration — verify
  render-equivalence after the eventual deploy.

## Paste this into a new chat

```
Continue the viewbook-v2 program in ~/enrollment-resources/Claude/er-seo-tools — execute WAVE 5 = PR7 design pass (SOLO Claude lane, NO Codex implementation lane), per the handoff at docs/superpowers/todos/HANDOFF-viewbook-v2.md. Read that handoff, the program doc (docs/superpowers/plans/2026-07-16-viewbook-v2-program.md), spec §7 (composition + design pass) and §9 (images/PDFs/sharp-webp/WCAG tester), and the SDD ledger (.superpowers/sdd/progress.md) first. PR7 ships: SectionShell v2 (summary face + IntersectionObserver scroll expand/collapse + prefers-reduced-motion rules + the never-auto-collapse-focus/edits rule), matured sticky header (logo + stage progress + CSM chip), floating right-edge TOC rail (dots→hover/focus/tap expand, ack/done checkmarks, keyboard/arrow nav, bottom-sheet on mobile) with building-stage verbose categories + client-side fuzzy search over a server-serialized index, code-owned SVG accents tinted via --vb-* vars, and the sharp/webp upload pipeline (sharp as a DIRECT dep + serverExternalPackages verify; both asset routes: size-reject-before-buffer → magic-byte png/jpg/webp allowlist, SVG rejected → sharp decode catch→400 → webp re-encode stripping EXIF; PDFs stay sniffed+capped+nosniff+inline). Cut the PR7 plan from merged main (fast-forward local main to origin first; drive the visual language via the frontend-design skill + superpowers:writing-plans; ground in real code via Explore agents — SectionShell v2 seam + PR8's OperatorSectionWrapper composition + PR5's acknowledged-collapse, the header/ProgressNav/EarlierSteps components, both asset routes + caps, the theme/hero/logo/doc write paths + their existing sync bumps, whether sharp is already a dep). PR7 MUST compose with PR8's operator layer (never pass function props across the Server→Client RSC boundary — page.tsx composes server-side, OperatorViewbookLayer takes serializable props + children) and DECIDE the acked-collapse-in-later-stages question (gate on stage/lineup or amend spec §4). Public surface LIGHT-ONLY (no dark:); no jest-dom (DOM-native assertions). Codex-review the plan (resume registry session 019f2b57-fde6-7cf2-93d1-8bb6d0cd43b6, model per the consulting-codex budget snapshot — Sol High while the 5h window has >25% left; re-check first; if Fable is still 5h-limited, use opus for the whole-branch review). Then ONE worktree (viewbook-v2-pr7), execute via superpowers:subagent-driven-development (per-task briefs + review-package per task, BASE = pre-dispatch branch HEAD), profile the sharp max-dimension decode on the prod box before merge, whole-branch review + codex exec review --base main, fix Critical/Important/valid-P2, re-gate, merge PR7. When merged: roadmap-tracker status-log line, program-doc Wave-5 checkbox, rewrite the handoff for the FINAL step (prod deploy + spec-§13 verification pass), end with the new paste-prompt. Do not start the deploy.
```
