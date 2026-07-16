# HANDOFF — Client Viewbook (5-PR tandem build)

**Updated:** 2026-07-16 (session 5 end: PR3 MERGED #191 + PR5 MERGED #192 — ALL FIVE PRs in main. Remaining = the DEPLOY checklist only.)

## Current state

- **CODE COMPLETE.** PR1 #185 (schema/admin) · PR2 #187 (public themed page) · PR4 #189 (feedback/activity/digest) · PR3 #191 (Data Source interactivity — Codex lane) · PR5 #192 (assessment section + SectionShell polish — Claude lane) all merged to main. PR5 was rebased onto PR3's merge and the COMBINED build was gate-proven (tsc · lint · 5,709 tests / 631 files · build) before its merge, satisfying the program plan's "second merger proves the combined boundary" requirement.
- Cross-reviews done both directions: Claude reviewed the PR3 diff (fencing/replay/cap semantics verified); Codex `exec review` on PR5 returned no findings; the PR5 plan itself was Codex-accepted with 8 fixes (applied pre-implementation).
- Spec + program plan + per-PR plans + both Codex briefs are archived under `docs/superpowers/archive/{specs,plans}/2026-07-15-client-viewbook-*`.
- **NOT deployed.** No deploy has shipped any viewbook PR to prod yet.

## Next step (the ONLY remaining item): deploy checklist (spec §13, archived)

1. **Before/with the first deploy:** set `VIEWBOOK_ASSETS_DIR=${DATA_HOME}/viewbook-assets` in the server env (repo `ecosystem.config.js` already carries it — verify the server copy), create the directory PM2-writable on the persistent data volume.
2. Add `viewbook-assets` to the server backup coverage alongside `uploads`/`reports`.
3. Deploy (`git push` is done — server pulls from GitHub): `ssh $PROD_SSH "~/deploy.sh"` (resolve `$PROD_SSH` from ops notes / `.claude/ops-secrets.local.sh`). The viewbook migrations apply automatically via `prisma migrate deploy`.
4. Post-deploy verify: create a viewbook on a test client, open `/viewbook/[token]` (theme + fonts render → CSP fonts origins working), submit an answer + a feedback row, confirm `Cache-Control: no-store`, confirm the assessment section renders (or shows "first scan coming soon"), confirm the `system-viewbook-digest` schedule seeded.
5. Then retire this handoff (delete it in the same PR as any post-deploy fixes) per the docs taxonomy.

## Gotchas

- The main checkout may be shared with another live Claude session — do any further work in a worktree.
- Mailgun env is prod-dark unless `MAILGUN_API_KEY`/`MAILGUN_DOMAIN` are set — the viewbook digest advances its cursor without stamping `digestSentAt` in dark env (by design, no catch-up flood when it lights up).
- `prisma migrate deploy` is idempotent — earlier deploys having applied predecessor migrations is fine.

## Paste this into a new chat

```
Deploy the client-viewbook program in er-seo-tools. Read
docs/superpowers/todos/HANDOFF-client-viewbook.md — all five PRs
(#185/#187/#189/#191/#192) are merged; only the deploy checklist remains:
VIEWBOOK_ASSETS_DIR on the server data volume + backup coverage, then
~/deploy.sh, then the post-deploy verify list, then retire the handoff.
```
