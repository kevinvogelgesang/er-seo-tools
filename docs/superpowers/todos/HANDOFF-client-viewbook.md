# HANDOFF — Client Viewbook (5-PR tandem build)

**Updated:** 2026-07-16 (session 4 end: PR4 MERGED #189; next = PR3 brief + PR5 lane, parallel)

## Current state

- **Spec** `docs/superpowers/specs/2026-07-15-client-viewbook-design.md` — Codex-accepted (2 review rounds, 9+6 fixes applied).
- **Plans** `docs/superpowers/plans/2026-07-15-client-viewbook-program.md` (lane split; READ THIS FIRST) + `…-pr1.md` + `…-pr2.md` — all Codex-accepted.
- **PR1 MERGED** (#185): schema (11 models), seeds, theme validator, asset store, service layer, `route-auth.ts`, admin API + UI shell.
- **PR2 MERGED** (#187): public themed page — `public-data.ts`/`public-types.ts`, `(public)/viewbook/[token]` page, 11 public components, token assets route, 2 anchored matchers, `--vb-*` canonical CSS vars, render-side https-only guard.
- **PR4 MERGED** (#189, main @ 35c8c9a — Codex lane, both phases): activity feed (`lib/viewbook/activity.ts`, composable `appendActivityStatements`), spec-§9 high-water digest (`viewbook-digest` job + `system-viewbook-digest` every:15m; dark env advances cursor WITHOUT stamping `digestSentAt`), 180-d activity retention in `runCleanup`, `lib/viewbook/public-write-guard.ts` (same-site · JSON content-type · 10/min token throttle · bounded body reader · clientMutationId — **PR3 MUST reuse this**), `lib/viewbook/public-writes.ts` transactional cores (ONE array-form txn, commit-time EXISTS fencing incl. caps 200 feedback/link · 100 materials/viewbook, `ON CONFLICT(clientMutationId)` replay, activity row in the same txn — **the pattern PR3's answers write follows**), public `POST /api/viewbook/[token]/feedback|materials` + anchored matchers, operator review-link CRUD / feedback resolve / activity routes, `FeedbackThread` mounted per review-link card in `MilestonesSection`, `MaterialLinkForm` in `MaterialsSection` (+ `router.refresh()` on success), Feedback/Activity tabs in `ViewbookEditor` (threads derived from the existing `GET /api/viewbooks/:id` subtree — `getViewbookAdmin` already included reviewLinks+feedback; no new route), `--viewbook-primary`→`--vb-primary` rename done (paired with `text-[var(--vb-on-primary)]`). `setSectionState` now takes `actor` and writes section-done activity in the same txn. Gates: tsc/lint green, 5,672 tests / 623 files, build green. Integration brief = ADDENDUM section of `…-pr4-codex-brief.md`. Codex thread `019f6a92-dc55-73c1-b601-de9b5bd0b59a` (~413k tokens used at last run).
- **Lane split (remaining):** Claude = PR5; Codex CLI = PR3 — they run in PARALLEL (program plan: PR3 opens when PR2 AND PR4 merged — both are). Cross-review before every merge. Codex budget limit → PAUSE and tell Kevin (usage reset in hand, expires ~2026-07-17); never take over Codex lanes.

## Next steps (parallel lanes)

1. **Cut + fire the PR3 Codex brief** (`docs/superpowers/plans/2026-07-15-client-viewbook-pr3-codex-brief.md`), interfaces copied from MERGED main: Data Source interactivity — C: `lib/viewbook/answers.ts` (version/lock/amendment state machine over `PublicField.version` = the `expectedVersion` optimistic-concurrency contract), `app/api/viewbook/[token]/answers/route.ts` (MUST reuse `public-write-guard.ts` exports — `requireSameSite`/`requireJsonContentType`/`checkWriteThrottle`/`readBoundedJson`/`validateClientMutationId` — and follow the `public-writes.ts` fenced-txn pattern), `app/api/viewbooks/[id]/lock/route.ts`, `app/api/viewbooks/[id]/fields/**` (custom-field CRUD + soft-archive), `components/viewbook/admin/DataSourceTab.tsx`, tests. M: `components/viewbook/public/DataSourceSection.tsx`, `components/viewbook/admin/ViewbookEditor.tsx` (tab), `middleware.ts` + `middleware.test.ts` — main still asserts `/api/viewbook/tok/answers` NOT public; PR3 flips exactly that. New worktree `viewbook-pr3` / branch `feat/viewbook-pr3` from origin/main; fresh Codex thread is fine (brief is self-contained). Include the sandbox rules below in the brief.
2. **PR5 (Claude lane, parallel with PR3):** branch from origin/main (the `client-viewbook` worktree ends session 4 on `docs/viewbook-pr4-handoff`). C: `lib/viewbook/assessment.ts`, `components/viewbook/public/AssessmentSection.tsx` (same props as `AssessmentPlaceholder`, swapped at the page mount point), `Tooltip.tsx`. M: `SectionShell.tsx` (done-state animation + hero polish — the ONE shared polish surface), `app/(public)/viewbook/[token]/page.tsx` (component swap). NOT touched: `DataSourceSection`/`MilestonesSection`/`MaterialsSection` (PR3/PR4 territory). Write the PR5 plan first (writing-plans → Codex review per user CLAUDE.md).
3. After both merge: program definition-of-done — deploy checklist (`VIEWBOOK_ASSETS_DIR` on the data volume + in `ecosystem.config.js` + server backup coverage per spec §13; CSP fonts origins verified; migration applied), move spec/plans/briefs to `archive/`, retire this handoff.

## Gotchas

- **Codex sandbox in worktrees:** `codex exec` in a git WORKTREE cannot commit (git metadata lives in the main repo's `.git/worktrees/…`) and cannot run build/audit (network) — tell Codex to leave work uncommitted; Claude runs gates + commits. `codex exec resume` does NOT accept `--sandbox`; pass `-c sandbox_mode="workspace-write"` instead.
- The main checkout may be shared with another live Claude session (the lane-check hook warns) — do docs/PR5 work in worktrees, never edit the main checkout's working tree.
- Worktrees share `node_modules` with the main checkout — regenerate the Prisma client from a viewbook branch if another lane ran `prisma generate` without the viewbook models.
- Worktree has no `.env`: prefix DB commands with `DATABASE_URL="file:./local-dev.db"`.
- `local main` refs in worktrees go stale — always diff/branch against `origin/main` after a merge.
- Prod-mode local smoke needs env: `PILLAR_TOKEN_SECRET`, `KEYWORD_MEMO_TOKEN_SECRET`, `APP_AUTH_PASSWORD`, `APP_AUTH_SECRET`, `CHROMIUM_NETWORK_ISOLATED=true`.
- One unreproduced full-suite flake seen in the PR4 lane — a red run is a red run; re-run only to collect evidence.
- Deploy of the merged viewbook work has NOT happened yet — `VIEWBOOK_ASSETS_DIR` must be set on the server (data volume) before/with the first deploy that includes PR1+.

## Paste this into a new chat

```
Continue the client-viewbook build in er-seo-tools. Read
docs/superpowers/todos/HANDOFF-client-viewbook.md and
docs/superpowers/plans/2026-07-15-client-viewbook-program.md. PR1/PR2/PR4
are merged (#185/#187/#189); the two remaining lanes run in PARALLEL:
(1) cut + fire the PR3 Codex brief (Data Source interactivity — new
worktree viewbook-pr3 from origin/main, interfaces from MERGED main,
reuse lib/viewbook/public-write-guard.ts + follow the public-writes.ts
fenced-txn pattern, flip ONLY the answers matcher in middleware), and
(2) PR5 (Claude lane): assessment section + SectionShell polish — write
the PR5 plan first, Codex-review it, then implement in the
client-viewbook worktree branched from origin/main. Lane rules: Claude
owns PR5, Codex CLI owns PR3; cross-review before merge; if Codex hits a
usage limit, pause and tell me.
```
