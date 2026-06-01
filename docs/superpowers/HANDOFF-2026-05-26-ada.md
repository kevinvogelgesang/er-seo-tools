# Handoff — ADA Audit work (2026-05-26)

Read this cold before starting the next ADA PRs. It captures where the last batch of work landed and the non-obvious context that isn't visible from the code or git log.

## Current state

**PR #33 is open and NOT merged:** https://github.com/kevinvogelgesang/er-seo-tools/pull/33
- Branch: `worktree-ada-ux-screenshots`
- Worktree (still alive for PR iteration): `.claude/worktrees/ada-ux-screenshots`
- 20 commits. tsc clean, `vitest run` = 1344 pass / 1 pre-existing unrelated failure, `next build` green, UI verified in-browser.
- **The ADA changes are on the PR branch, NOT on `main`.** If you work from a `main` checkout, none of this is present — check out the branch or the worktree.

PR #33 implements the full May 26 request (all 6 items):
1. Nav dropdown (ADA Audit / Audit Queue / Recents) + mobile `V1/V2` bug fix
2. Recents shows all team audits + Mine toggle + Operator column
3. Shared `RecentsTable` on home + full recents page
4. Batch rows expand-on-click + pencil rename + operator inline
5. Timezone → rendered in viewer's **browser TZ** (chosen over hardcoding Vancouver)
6. Per-node screenshots (cap 50/page), always-on, 24h retention sweeper, silent expiry

## Where the specs/plans live (committed to `main` and the branch)
- `docs/superpowers/specs/2026-05-26-ada-ux-bundle-design.md`
- `docs/superpowers/specs/2026-05-26-ada-screenshots-design.md`
- `docs/superpowers/plans/2026-05-26-ada-ux-bundle.md`
- `docs/superpowers/plans/2026-05-26-ada-screenshots.md`

## Outstanding (before merge / follow-up)
- **Manual, needs a box with Chrome:** run a real single-page AND site audit; confirm per-node screenshots land in `screenshots/<auditId>/`, the issue-card thumbnail grid renders, and a swept/expired file hides silently. (Couldn't verify headlessly — axe needs Chrome at `/usr/bin/google-chrome`.)
- **Manual:** capture wall-clock on a violation-heavy page — confirm 50 sequential element screenshots don't bloat site-audit run time. The per-page cap (50) is the tuning knob.
- **Review attention:** PR adds `@vitejs/plugin-react` and renames `vitest.config.ts → vitest.config.mts` (needed for jsdom `.test.tsx`). Also untracks `prisma/local-dev.db*` (closed a gitignore gap).
- **Pre-existing failure (not ours):** `lib/ada-audit/site-audit-helpers.test.ts > buildSiteAuditSummary` fails on `main` too (a `pdfsAggregate.skipped` field mismatch). Worth fixing in a separate PR but unrelated to #33.

## Non-obvious gotchas (carry into future ADA work)
- **`score` column is never written.** `AdaAudit.score` / `SiteAudit.score` are dead columns — nothing in the runner/queue writes them. Always DERIVE: page audits from `result` JSON via `computeScore(violations, wcagLevel)`; site audits from `summary.aggregate` via `computeScoreFromCounts(aggregate, wcagLevel)`. Guard for `NaN` (malformed older `aggregate` data) and gate on `status === 'complete'`.
- **Screenshot serving cache must stay short.** `app/api/ada-audit/screenshots/[auditId]/[filename]/route.ts` uses `Cache-Control: private, max-age=3600`. Do NOT revert to `immutable`/long TTL — a cached image won't 404 after the 24h sweep, which silently defeats the whole expiry + `onError`-hide design.
- **Screenshot capture is always-on** in the runner (`captureScreenshots !== false`, dir derived from `auditId`). Both single-page and site audits capture; there is no checkbox. A capture failure (disk full, mkdir) is swallowed so it never fails the audit.
- **Retention:** `SCREENSHOT_RETENTION_HOURS` env (default 24); sweeper runs every 30 min via `instrumentation.ts`. Parse is hardened (empty/NaN → 24).
- **Browser-TZ dates:** use `ClientDate` (component) for JSX and `formatInBrowserTZ` from `lib/ada-audit/format-date.ts` (server-safe, NOT the `'use client'` `ClientDate.tsx`) for `title=`/attribute contexts. `duration.ts` imports the server-safe one.
- **Test infra:** React component tests are `.test.tsx`, need a `// @vitest-environment jsdom` header line; vitest config is now `vitest.config.mts`; `tsconfig` excludes `.test.tsx`.
- **Worktree DB setup (if recreating a worktree):** copy `.env`/`.env.local` and `prisma/local-dev.db*` from the main checkout, set the worktree `.env` `DATABASE_URL=file:./local-dev.db` (Prisma auto-loads `.env`, not `.env.local`), then `npx prisma generate`. Tests need a real SQLite DB.
- **Deploy (do not run on unmerged work):** `git push`, then `ssh seo@144.126.213.242 "~/deploy.sh"`.

## Next PRs
To be defined by Kevin in the next session. This doc captures the prior batch's landing state — tell the next session the new scope and it can run brainstorm → spec → (Codex) → plan → (Codex) → subagent-driven TDD, same as this batch.
