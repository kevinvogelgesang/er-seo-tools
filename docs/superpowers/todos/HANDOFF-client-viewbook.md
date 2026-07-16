# HANDOFF — Client Viewbook (5-PR tandem build)

**Updated:** 2026-07-16 (session 2 end: PR1 MERGED #185, PR4 Codex lane RUNNING)

## Current state

- **Spec** `docs/superpowers/specs/2026-07-15-client-viewbook-design.md` — Codex-accepted (2 review rounds, 9+6 fixes applied).
- **Plans** `docs/superpowers/plans/2026-07-15-client-viewbook-program.md` (lane split; READ THIS FIRST) + `…-pr1.md` — Codex-accepted.
- **PR1 MERGED** (#185, main @ 86a93f3): schema (11 models, migration `20260716101640_client_viewbook`), seeds, theme validator, asset store, service layer, `route-auth.ts`, `operator.ts`, admin API + UI shell, client-DELETE asset snapshot, nav entry, ecosystem env. `/codex-review` ran; all 5 P2 findings fixed pre-merge (single-owner asset references, fenced roster writes, `requireJsonObject`, milestone editing, kind control). 5,565 tests green at merge.
- **PR4 core phase (Codex lane): DONE + PUSHED** (`feat/viewbook-pr4` @ bb942d2, cross-reviewed by Claude, all gates green — 5,633 tests). NO PR opened yet: it opens after the integration phase (post-PR2). One cross-review fix applied: insert cores extracted to `lib/viewbook/public-writes.ts` (Next.js route modules may only export HTTP handlers). Codex thread `019f6a92-dc55-73c1-b601-de9b5bd0b59a` (resume it for follow-ups). **Sandbox lesson for the PR3 brief:** `codex exec --sandbox workspace-write` in a git WORKTREE cannot commit (the git metadata lives in the main repo's `.git/worktrees/…`, outside the writable root) and cannot run build/audit (network) — tell Codex to leave work uncommitted and have Claude run gates + commit, or add the git dir to its writable roots. One full-suite flake seen once (didn't reproduce twice) — unidentified, watch for it.
- **PR2 lane (Claude): branch `feat/viewbook-pr2` created** from merged main in worktree `client-viewbook`; no code yet.
- **Lane split (Kevin's tandem test):** Claude = PR2→PR5; Codex CLI = PR4 (two-phase) → PR3. Cross-review before every merge. Codex budget limit → PAUSE and tell Kevin (usage reset in hand, expires ~2026-07-17); never take over Codex lanes.

## Next steps (in order)

1. **Build PR2** (Claude, worktree `client-viewbook`, branch `feat/viewbook-pr2`): public themed page — program plan PR2 file list (public-data loader, `(public)/viewbook/[token]` page, themed shell + 7 read-only sections + `AssessmentPlaceholder`, token assets route + serving tests, `ThemePreview` adoption in admin, middleware page+assets matchers + `middleware.test.ts` entries, CSP fonts origins in `next.config.ts`). Cut a detailed PR2 task plan from the program plan first (writing-plans discipline), Codex-review it (P0), then implement.
2. After PR2 merges: cut the PR4 integration-phase addendum brief (rebase on main, middleware matchers + middleware.test.ts, mount FeedbackThread/MaterialLinkForm in PR2's sections, add Feedback/Activity tabs to ViewbookEditor), fire it on the existing worktree, cross-review, open + merge the PR4 PR.
3. PR3 brief only after PR2 AND PR4 merge. PR5 (Claude) parallel with PR3.

## Gotchas

- Worktrees share `node_modules` with the main checkout — the generated Prisma client is a superset (includes viewbook models). If another lane runs `prisma generate` from a branch without the viewbook schema, worktree `tsc` breaks until regenerated from this branch.
- The main checkout may be on `fix/verifier-memory-loop` (separate live lane) — never touch it; base everything on `main`.
- Worktree has no `.env`: prefix DB commands with `DATABASE_URL="file:./local-dev.db"`.
- Migration was created `--create-only`, partial index hand-added BEFORE first apply — never edit it now (checksum drift), never `migrate reset`.
- `ViewbookField.defKey` custom rows are `NULL` never `''`; address custom fields by `id`.
- Public-write hardening (same-site, throttle, clientMutationId) is PR4's `public-write-guard.ts` — PR2's read page and PR1's admin routes intentionally don't have it.

## Paste this into a new chat

```
Continue the client-viewbook build in er-seo-tools. Read
docs/superpowers/todos/HANDOFF-client-viewbook.md and
docs/superpowers/plans/2026-07-15-client-viewbook-program.md in worktree
.claude/worktrees/client-viewbook (branch feat/viewbook-pr2), then pick
up at the "Next steps" list — PR2 is yours to build; check whether the Codex
PR4 lane (feat/viewbook-pr4) has pushed and cross-review it. Lane rules: Claude owns PR2/PR5,
Codex CLI owns PR4/PR3 via the saved briefs; cross-review before merge;
if Codex hits a usage limit, pause and tell me.
```
