# HANDOFF — Client Viewbook (5-PR tandem build)

**Updated:** 2026-07-16 (session: PR1 built, PR #185 open)

## Current state

- **Spec** `docs/superpowers/specs/2026-07-15-client-viewbook-design.md` — Codex-accepted (2 review rounds, 9+6 fixes applied).
- **Plans** `docs/superpowers/plans/2026-07-15-client-viewbook-program.md` (lane split; READ THIS FIRST) + `…-pr1.md` — Codex-accepted.
- **PR1** (`feat/client-viewbook`, PR #185): schema (11 models, migration `20260716101640_client_viewbook` with hand-added partial unique index), seeds, theme validator, asset store, service layer, `route-auth.ts`, `operator.ts`, admin API + UI shell, client-DELETE asset snapshot, nav entry, `VIEWBOOK_ASSETS_DIR` in ecosystem.config.js. All gates green (5563 tests, build, audit:ci). `/codex-review` triage in progress at session end — check PR #185 for state.
- **Lane split (Kevin's tandem test):** Claude = PR1→PR2→PR5; Codex CLI = PR4 (two-phase) → PR3. Cross-review before every merge. Codex budget limit → PAUSE and tell Kevin (he holds a usage reset, expires ~2026-07-17); never take over Codex lanes.

## Next steps (in order)

1. Land `/codex-review` findings on PR1 → merge PR #185 (gate-green rule).
2. Open PR2 lane (Claude, same worktree rebased or fresh): public themed page — see program plan PR2 file list. PR2 merges BEFORE PR4's integration phase.
3. At PR1 merge, hand Kevin the PR4 core-phase brief (`docs/superpowers/plans/2026-07-15-client-viewbook-pr4-codex-brief.md`) to fire in Codex CLI in worktree `viewbook-pr4`.
4. PR3 brief only after PR2 AND PR4 merge.

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
.claude/worktrees/client-viewbook (branch feat/client-viewbook, PR #185),
then pick up at the "Next steps" list. Lane rules: Claude owns PR2/PR5,
Codex CLI owns PR4/PR3 via the saved briefs; cross-review before merge;
if Codex hits a usage limit, pause and tell me.
```
