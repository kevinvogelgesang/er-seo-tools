# HANDOFF — Viewbook v2 Program (wave-per-session cadence)

**Updated:** 2026-07-16 (end of Wave 2 session)
**Cadence (Kevin, binding):** ONE session per wave. Finish the Claude-lane PR,
wait for the Codex-lane PR, merge both, then rewrite this handoff and end the
final reply with the paste-prompt below. Never start the next wave's plans,
briefs, worktrees, or dispatches in the same session.

## Current state

- **Wave 1 MERGED** — PR #195 (`a7f6b53`): stage engine core (schema/migration
  `20260716212619_viewbook_v2_stages`, stage catalog, lineup rendering +
  Earlier-steps band, fenced stage-move route, admin stage chip).
- **Wave 2 MERGED** — PR #196 (`f533465`, live sync) + PR #197 (`1964ff7`,
  kickoff-next + strategy PDF docs, Codex lane). Final gates 647 files /
  5832 tests + build OK.
- **NOT DEPLOYED.** Deploy plan (program doc): minimum one deploy now that
  wave 2 is merged (schema + sync live for smoke) and one after wave 5.
  `sharp` is NOT yet a dependency (PR7). No new env vars so far.
- Docs of record: spec `docs/superpowers/specs/2026-07-16-viewbook-v2-stages-design.md`
  (Codex-reviewed ×12 + 3 wave-2 amendments), program
  `docs/superpowers/plans/2026-07-16-viewbook-v2-program.md` (waves, lane
  rules, session cadence, file-ownership), PR plans/briefs
  `2026-07-16-viewbook-v2-pr1/pr2/pr4-*.md`. SDD ledger:
  `.superpowers/sdd/progress.md` (wave-by-wave detail incl. triaged minors).
- Codex consult session (registry, er-seo-tools workspace):
  `019f2b57-fde6-7cf2-93d1-8bb6d0cd43b6` — resume it for spec/plan reviews.
  Budget at session end: 5h window 50% used (Sol High still OK; Kevin's
  reset expires 2026-07-17 — on exhaustion PAUSE the Codex lane and tell him).

## Next: Wave 3 = PR6 (Claude) ∥ PR3 (Codex)

Per the program doc's wave table:
- **PR6 — Website-specifics** (Claude lane): `ws-intro` section,
  brand-section WCAG contrast tester + `lib/viewbook/contrast.ts` (becomes the
  ONE shared luminance impl — refactor `theme.ts`'s derived on-primary text
  onto it, 0.04045 threshold, AA 4.5/3.0 + AAA 7.0/4.5 bands), assessment
  placement, ws lineup activation. Spec §7/§9.
- **PR3 — Email infra + CSM** (Codex lane): `viewbook-email` durable job +
  `ViewbookEmailDelivery` fencing (rows exist since PR1; dedupKeys use
  `eventKey`/`memberKey` app-generated UUIDs), templates
  (`lib/notify/viewbook-*`), roster `isCsm`/`email` validator extension +
  CSM assignment + featured card, stage-change delivery creation wired into
  `moveViewbookStage`. Spec §8 + §5. NOTE: stage-change recipients =
  `clientNotifyJson`, which is EMPTY until PR5 ships the setup route — PR3
  ships the machinery; sends will no-op on empty recipient lists.

Session flow (repeat the wave-2 shape):
1. Cut the PR6 plan + PR3 Codex brief JUST-IN-TIME from merged main
   (superpowers:writing-plans; ground in actual code — dispatch an Explore
   agent for write-path/current-state facts first). Save to
   `docs/superpowers/plans/2026-07-16-viewbook-v2-pr6.md` + `…-pr3-codex-brief.md`.
2. Batch-route BOTH docs through Codex review (consulting-codex, resume the
   registry session, Sol High while 5h < 75% used); apply named fixes; commit.
3. Worktrees: `git worktree add .claude/worktrees/viewbook-v2-pr6 -b feat/viewbook-v2-pr6`
   (same for pr4→pr3). Bootstrap each: `npm install` +
   `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy` (the URL
   resolves to `prisma/local-dev.db`; worktrees start with none).
4. Launch the Codex lane detached in its worktree:
   `codex exec --cd <pr3-worktree> --sandbox workspace-write --skip-git-repo-check -m gpt-5.6-sol -c model_reasoning_effort='"high"' "<point it at the brief; TDD; no commits; handoff to .superpowers/sdd/pr3-codex-handoff.md>"`
   (nohup + background; Codex CANNOT commit or network — Claude verifies
   gates and commits its work, then Claude cross-reviews the branch).
5. Execute PR6 via superpowers:subagent-driven-development (per-task briefs
   via the skill's task-brief script; review every task; record BASE = the
   branch HEAD before each dispatch — never a later main commit).
6. Merge order: whichever lane finishes first waits for cross-review; both
   PRs get a Codex `exec review` (P1) + fable whole-branch review before
   merge. **Program-wide merge gate:** every rendered-data mutation PR3/PR6
   introduces must adopt `syncVersionBumpStatement()`/variants from
   `lib/viewbook/sync.ts` inside the same fenced transaction + bump/no-bump
   tests (relative-delta assertions ONLY — bumpAll tests sweep the shared DB).
7. Close the wave: tracker status-log line, program-doc checkbox, rewrite
   this handoff for wave 4 (PR5 post-contract ∥ PR8 ER inline layer — PR5
   also picks up the admin stage-move buttons deferred from PR1), end with
   the new paste-prompt. STOP — no wave-4 work.

## Gotchas (earned this session)

- **Never run two vitest suites concurrently in one worktree** (shared
  `.test-dbs/` per-worker files → phantom file-level failures). Gates run
  exclusively; reviewer subagents rerun suites too — sequence them.
- The Bash session cwd PERSISTS across commands — always `cd` explicitly
  before worktree-relative commands (a gates run silently ran against the
  wrong checkout this session; caught by pwd).
- `codex exec review --base <branch>` accepts NO prompt argument.
- Review-package BASE must be an ancestor of HEAD (use the recorded
  pre-dispatch branch HEAD, never a later main commit — bf57abd burned us).
- Two OTHER Claude sessions may run in the main checkout — feature work only
  in worktrees; docs-only commits on main are OK.
- `.superpowers/` is git-ignored; per-PR report files need distinct names
  (pr2-task-N-report.md convention) — task-brief/scripts write wherever cwd is.
- The public smoke viewbook (id 1) is stage `building` post-migration —
  verify render-equivalence after deploy.

## Paste this into a new chat

```
Continue the viewbook-v2 program in ~/enrollment-resources/Claude/er-seo-tools — execute WAVE 3 (PR6 website-specifics on my lane, PR3 email+CSM on the Codex lane), per the handoff at docs/superpowers/todos/HANDOFF-viewbook-v2.md. Read that handoff, the program doc (docs/superpowers/plans/2026-07-16-viewbook-v2-program.md), spec §5/§7/§8/§9, and the SDD ledger (.superpowers/sdd/progress.md) first. Cut the PR6 plan + PR3 Codex brief from merged main, Codex-review both (resume registry session, Sol High until the 5h window runs out — then pause that lane and tell me), then run both lanes in worktrees exactly like wave 2 (SDD per task for PR6; detached codex exec for PR3; cross-review both directions + fable whole-branch + codex exec review before each merge; every new rendered-data write adopts the lib/viewbook/sync.ts bump factories with relative-delta tests). When BOTH PRs are merged: tracker line, program checkbox, rewrite the handoff for wave 4, and end with the new paste-prompt. Do not start wave 4.
```
