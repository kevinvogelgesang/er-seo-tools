# HANDOFF — Viewbook v2 Program (wave-per-session cadence)

**Updated:** 2026-07-16 (end of Wave 3 session)
**Cadence (Kevin, binding):** ONE session per wave. Finish the Claude-lane PR,
wait for the Codex-lane PR, merge both, then rewrite this handoff and end the
final reply with the paste-prompt below. Never start the next wave's plans,
briefs, worktrees, or dispatches in the same session.

## Current state

- **Wave 1 MERGED** — PR #195 (`a7f6b53`): stage engine core (schema/migration
  `20260716212619_viewbook_v2_stages`, stage catalog, lineup rendering +
  Earlier-steps band, fenced stage-move route, admin stage chip).
- **Wave 2 MERGED** — PR #196 (`f533465`, live sync) + PR #197 (`1964ff7`,
  kickoff-next + strategy PDF docs, Codex lane).
- **Wave 3 MERGED** — PR #198 (`8672a98`, website-specifics, Claude lane) +
  PR #199 (`5017128`, email infra + CSM, Codex lane). Disjoint lanes (no shared
  files → no rebase-integration duty). Final gates: PR6 5852 / PR3 5885 tests +
  build. Both branch-reviewed (fable + codex exec) with all findings fixed.
- **NOT DEPLOYED.** Deploy plan (program doc): minimum one deploy after wave 5;
  Kevin may deploy earlier. `sharp` is NOT yet a dependency (PR7). No new env
  vars so far. When it deploys, the migration is already on `main`.
- Docs of record: spec `docs/superpowers/specs/2026-07-16-viewbook-v2-stages-design.md`
  (Codex-reviewed ×12 + wave amendments), program
  `docs/superpowers/plans/2026-07-16-viewbook-v2-program.md` (waves, lane rules,
  session cadence, file-ownership — wave-4 map is filled in), PR plans/briefs
  `2026-07-16-viewbook-v2-pr1/pr2/pr3/pr4/pr6-*.md`. SDD ledger:
  `.superpowers/sdd/progress.md` (wave-by-wave detail incl. triaged findings).
- Codex consult session (registry, er-seo-tools workspace):
  `019f2b57-fde6-7cf2-93d1-8bb6d0cd43b6` — resume it for spec/plan reviews.
  **Budget at wave-3 end: 5h window ~60% used (Sol High still OK, >25%
  remaining).** Kevin's earlier reset window was noted as expiring 2026-07-17 —
  re-check the 5h/weekly snapshot at the start of the next session (consulting-codex
  budget guard); on exhaustion PAUSE the Codex lane and tell Kevin.

## Next: Wave 4 = PR5 (Claude) ∥ PR8 (Codex)

Per the program doc's wave table:
- **PR5 — Post-contract stage** (Claude lane): the `pc-intro`/`pc-setup`/
  `pc-invite`/`pc-thanks` section components; `ViewbookTeamMember` + invite flow;
  the three NEW public routes (ack, team-members, setup) + their anchored
  middleware matchers; ack completion stamping (`pcCompletedAt`) + the
  **pc-complete** email trigger; the **team-invite** email trigger (member add /
  re-send); the ack-to-stage fence (forward-out-of-post-contract requires
  `pcCompletedAt` or `force`); creation default **flips to `post-contract`**;
  and the **admin stage-move buttons** deferred from PR1 (so the UI never
  exposes a move into a stage whose components didn't exist yet — now they do).
  Spec §4 (ack/completion/stage moves), §5, §7 (pc-* sections), §8 (pc-complete
  + team-invite triggers), §11 (routes/matchers). Activate the pc-* keys into
  `STAGE_LINEUPS['post-contract']` (they're currently dormant) + the carried
  `pc-setup`/`pc-invite` additions to later stages' lineups (final spec §4
  table).
- **PR8 — ER inline layer** (Codex lane): the public page reads the auth cookie
  VALUE → `getAuthSession` (reuse PR4's `getOperatorEmailForPublicPage` in
  `lib/viewbook/public-session.ts`); a verified-email session renders the
  operator layer (stage controls, per-section quick controls, inline editors)
  calling the EXISTING cookie-gated `/api/viewbooks/[id]/*` routes (public token
  surface gains nothing); + a **presentation-mode toggle** (floating,
  keyboard-accessible, `localStorage`-persisted). Spec §10.

**Wave 4 is NOT disjoint** (program file-ownership map): both touch the public
page + section components. **Merge order: PR5 FIRST; PR8 rebases onto PR5's
merge and OWNS the final page/session integration** (affordance slots via a
wrapper only — PR8 never edits pc-* files). Same shape as wave 2's PR2→PR4.

### PR5 must reuse PR3's shipped machinery (don't reinvent)
- `enqueueViewbookEmail(deliveryId)` + the delivery-row creation pattern
  (`lib/viewbook/email.ts`) for the pc-complete + team-invite triggers.
  team-invite deliveries key `dedupKey` off **`memberKey`** (the app-generated
  UUID) exactly as stage-change keys off `eventKey`; leave `memberId` null
  (array-form txns can't consume the autoincrement id).
- The shared `canonicalMailbox(raw)` + **`PRIMARY_CONTACT_EMAIL_DEFKEY`**
  (= `'school-contact-email'`) constants in `lib/viewbook/global-content-keys.ts`
  — PR5's setup route writes the primary-contact answer under THIS defKey and
  writes `clientNotifyJson`; **import the const, never redefine the string**
  (PR3's stage-change recipient resolver already reads it — they must agree).
- `recoverViewbookEmailDeliveries` already backstops enqueue loss; the
  `viewbook-email` job already handles all three kinds' templates
  (`lib/notify/viewbook-email-content.ts`).
- `pc-complete` completion path: the fenced ack txn that satisfies the predicate
  also stamps `pcCompletedAt` (conditional-on-null, first-writer-wins) and
  creates the pc-complete delivery (recipient = assigned CSM's roster email ??
  `notifyAdminEmail()`); the `force`-advance path stamps it too (spec §4).

### PR5 sync-bump gate (NOT vacuous — unlike PR6)
Every new rendered-data mutation (ack writes, team-member add/remove, setup
answer writes, `clientNotifyJson` write, creation seeding) MUST adopt
`syncVersionBumpStatement()`/`syncVersionBumpWhere()` from `lib/viewbook/sync.ts`
inside the same fenced array txn, with **relative-delta** bump/no-bump tests
(0-row fenced write and idempotent replay bump NOTHING). Setup answers go
through the EXISTING answers PATCH (already bump-adopting) — don't add a second
write path. PR8's inline layer calls existing routes (spec §10 — "the public
token surface gains nothing"), so it should introduce NO new write path/bump;
if it does, same rule applies.

## Session flow (repeat the wave-3 shape)
1. Cut the PR5 plan + PR8 Codex brief JUST-IN-TIME from merged main
   (superpowers:writing-plans; dispatch Explore agents for current-state facts
   first — pc-* lineup/section state, the ack/team/setup route conventions,
   PR4's `public-session.ts` helper, PR3's delivery/recipient/CSM code, the
   admin stage-move-button deferral). Save to
   `docs/superpowers/plans/2026-07-16-viewbook-v2-pr5.md` + `…-pr8-codex-brief.md`.
2. Batch-route BOTH docs through Codex review (consulting-codex, resume registry
   session `019f2b57…`, Sol High while the 5h window has >25% left); apply named
   fixes; commit on main (docs-only OK; fast-forward local main to origin first).
3. Worktrees: `git worktree add .claude/worktrees/viewbook-v2-pr5 -b feat/viewbook-v2-pr5`
   (same for pr8). Bootstrap each: `npm install` +
   `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy`.
4. Launch the Codex lane detached in its worktree:
   `codex exec --cd <pr8-worktree> --sandbox workspace-write --skip-git-repo-check -m gpt-5.6-sol -c model_reasoning_effort='"high"' "<point at the brief; TDD; NO commits/network; handoff to .superpowers/sdd/pr8-codex-handoff.md>"`
   (run_in_background). Codex CANNOT commit/network — Claude verifies gates +
   commits, then cross-reviews.
5. Execute PR5 via superpowers:subagent-driven-development (per-task briefs via
   `scripts/task-brief`; review every task with `scripts/review-package BASE HEAD`;
   BASE = the pre-dispatch branch HEAD, never a later main commit).
6. **Merge order: PR5 first** (it owns the page/route/lineup integration), then
   PR8 rebases onto PR5's merge + owns the final page/session wiring. Both PRs
   get a fable whole-branch review + a `codex exec review --base main` (P1)
   before merge. Fix Critical/Important/valid-P2 findings, re-gate.
7. Close the wave: tracker status-log line, program-doc checkbox, rewrite this
   handoff for **Wave 5 (PR7 design pass — SectionShell v2, header, TOC rail,
   search, SVG accents, sharp/webp; via the frontend-design skill; solo Claude
   lane, no Codex lane)**, end with the new paste-prompt. STOP — no wave-5 work.

## Gotchas (earned across the program)

- **The public viewbook is LIGHT-ONLY.** `ViewbookShell` is the single
  rendering owner and uses NO `dark:` variants (its header comment says so).
  Do NOT tell implementers to "match sibling dark-mode variants" for PUBLIC
  viewbook components — that's the ADMIN convention. Codex caught this as a P2
  in PR6 (ContrastTester shipped with `dark:` and had to be stripped). Admin
  components (`components/viewbook/admin/**`) DO use `dark:`.
- **This repo has NO jest-dom.** setupFiles is only `./test/setup-worker.ts`.
  Component tests use DOM-native assertions (`toBeTruthy`, `textContent`,
  `querySelector`, `.not.toBeNull`) — never `toBeInTheDocument`/`toHaveTextContent`.
- **Array-form `$transaction([...])` can't consume a prior statement's
  autoincrement id.** Downstream rows key off app-generated UUIDs (`eventKey`,
  `memberKey`); leave the `Int?` id columns null and correlate by dedupKey.
- `codex exec review` supports `-m`/`-c`/`--base`/`--output-last-message`/`--json`
  but NOT `--cd` — run it via `cd <worktree>`. It DOES accept a prompt arg
  (the old "no prompt" note was wrong), but a base-diff review needs none.
- **Never run two vitest suites concurrently in ONE worktree** (shared
  `.test-dbs/` per-worker files → phantom failures). Different worktrees are
  fine (separate `.test-dbs`). Reviewer subagents rerun suites too — sequence
  within a worktree.
- The Bash session cwd PERSISTS across commands — always `cd` explicitly. The
  `task-brief`/`review-package` scripts write relative to cwd.
- Review-package BASE must be an ancestor of HEAD (use the recorded pre-dispatch
  branch HEAD, never a later main commit).
- Two OTHER Claude sessions may run in the main checkout — feature work only in
  worktrees; docs-only commits on main are OK, but **fast-forward local main to
  `origin/main` first** (`git fetch origin main && git merge --ff-only origin/main`)
  so the docs commit lands on the merged code, then push.
- `.superpowers/` is git-ignored; per-PR report/brief files can reuse the
  `task-N-brief.md` / `pr6-task-N-report.md` naming (distinct per task/PR).
- The prod smoke viewbook (id 1) is stage `building` post-migration — verify
  render-equivalence after any deploy.

## Paste this into a new chat

```
Continue the viewbook-v2 program in ~/enrollment-resources/Claude/er-seo-tools — execute WAVE 4 (PR5 post-contract stage on my lane, PR8 ER inline layer on the Codex lane), per the handoff at docs/superpowers/todos/HANDOFF-viewbook-v2.md. Read that handoff, the program doc (docs/superpowers/plans/2026-07-16-viewbook-v2-program.md), spec §4/§5/§7/§8/§10/§11, and the SDD ledger (.superpowers/sdd/progress.md) first. Cut the PR5 plan + PR8 Codex brief from merged main (fast-forward local main to origin first; ground both in real code via Explore agents — pc-* lineup/section state, the ack/team/setup route conventions, PR4's public-session.ts helper, PR3's delivery/recipient/CSM code + shared canonicalMailbox/PRIMARY_CONTACT_EMAIL_DEFKEY, the admin stage-move-button deferral). Codex-review both (resume registry session 019f2b57-fde6-7cf2-93d1-8bb6d0cd43b6, Sol High while the 5h window has >25% left — re-check the budget snapshot first; pause that lane and tell me if it runs out). Then run both lanes in worktrees exactly like wave 3 (SDD per task for PR5; detached codex exec for PR8; cross-review both directions + fable whole-branch + codex exec review before each merge). WAVE 4 IS NOT DISJOINT: merge PR5 FIRST, then PR8 rebases onto it and owns the final public-page/session integration (affordance slots via a wrapper, never editing pc-* files). Every new rendered-data mutation (PR5 ack/team/setup/clientNotifyJson/creation-seeding) adopts the lib/viewbook/sync.ts bump factories with relative-delta tests; PR5 reuses PR3's enqueueViewbookEmail/delivery pattern + shared mailbox helpers for the pc-complete + team-invite triggers (team-invite dedupKey keys off memberKey). When BOTH PRs are merged: tracker line, program checkbox, rewrite the handoff for wave 5 (PR7 design pass, solo Claude lane), and end with the new paste-prompt. Do not start wave 5.
```
