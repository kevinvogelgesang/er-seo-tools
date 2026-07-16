# HANDOFF — Client Viewbook (5-PR tandem build)

**Updated:** 2026-07-16 (session 3 end: PR2 MERGED #187; next = PR4 integration brief)

## Current state

- **Spec** `docs/superpowers/specs/2026-07-15-client-viewbook-design.md` — Codex-accepted (2 review rounds, 9+6 fixes applied).
- **Plans** `docs/superpowers/plans/2026-07-15-client-viewbook-program.md` (lane split; READ THIS FIRST) + `…-pr1.md` + `…-pr2.md` — all Codex-accepted.
- **PR1 MERGED** (#185): schema (11 models), seeds, theme validator, asset store, service layer, `route-auth.ts`, admin API + UI shell.
- **PR2 MERGED** (#187, main @ f4e8e7f): public themed page. `lib/viewbook/public-data.ts` (fault-isolated loader) + `public-types.ts` (client-safe payload — carries field `version`/`createdAt`/amendment-`id` for PR3 and feedback/material rows for PR4, so NEITHER later lane touches these files), `(public)/viewbook/[token]` page (`force-dynamic`, noindex, no-referrer), 11 public components (presentational, no `'use client'`), token assets route (themeJson ∪ roster allowlists), 2 anchored matchers, CSP fonts origins, `ThemePreview` in admin, render-side https-only guard on `<a href>` sinks. Plan was Codex-P0-reviewed (8 fixes pre-implementation); `/security-review` clean (1 advisory, mitigated); Codex native review "no actionable defects"; 5,638 tests green; prod smoke PROVED `Cache-Control: no-store` (no middleware fallback needed).
- **PR4 core phase (Codex lane): DONE + PUSHED** (`feat/viewbook-pr4` @ bb942d2, cross-reviewed). NO PR opened — integration phase first. Codex thread `019f6a92-dc55-73c1-b601-de9b5bd0b59a`.
- **Lane split:** Claude = PR2→PR5; Codex CLI = PR4 (two-phase) → PR3. Cross-review before every merge. Codex budget limit → PAUSE and tell Kevin (usage reset in hand, expires ~2026-07-17); never take over Codex lanes.

## Next steps (in order)

1. **Cut + fire the PR4 integration-phase addendum brief** (Codex lane, worktree `viewbook-pr4`): rebase `feat/viewbook-pr4` on main (now has PR1+PR2), then as the ONLY live editor: add feedback+materials matchers to `middleware.ts` + `middleware.test.ts`, mount `FeedbackThread` into `components/viewbook/public/MilestonesSection.tsx` (mount-point comment inside each review-link card) and `MaterialLinkForm` into `MaterialsSection.tsx` (comment before `</SectionShell>`), add Feedback/Activity tabs to `ViewbookEditor.tsx`. **MUST also rename `var(--viewbook-primary)` → `var(--vb-primary)` in `FeedbackThread.tsx:75` + `MaterialLinkForm.tsx:59`** (PR2 plan Codex fix 4 — `--vb-*` is canonical; data comes via `PublicReviewLink.feedback` / `PublicMaterialLink` props from PR2's payload). Brief template in the program plan; copy interface signatures from MERGED main, never memory. Include the sandbox lesson below. Then cross-review, open + merge the PR4 PR.
2. PR3 brief only after PR4 merges (interfaces from merged code). PR5 (Claude) parallel with PR3 — PR5 modifies `SectionShell.tsx` (its `summary` prop + done-state animation is the stable API) and swaps `AssessmentPlaceholder` → `AssessmentSection` (same props signature) at the page mount point.

## Gotchas

- **Codex sandbox in worktrees:** `codex exec --sandbox workspace-write` in a git WORKTREE cannot commit (git metadata lives in the main repo's `.git/worktrees/…`) and cannot run build/audit (network) — tell Codex to leave work uncommitted; Claude runs gates + commits.
- Worktrees share `node_modules` with the main checkout — regenerate the Prisma client from a viewbook branch if another lane ran `prisma generate` without the viewbook models.
- Worktree has no `.env`: prefix DB commands with `DATABASE_URL="file:./local-dev.db"`.
- `local main` refs in worktrees go stale — always diff/branch against `origin/main` after a merge.
- Public-write hardening (same-site, throttle, clientMutationId) is PR4's `public-write-guard.ts` — PR2's read surfaces intentionally don't have it; PR2 added a render-side https-only guard (`isHttpsUrl` in `MaterialsSection.tsx`) that PR4's write validation complements.
- Prod-mode local smoke needs env: `PILLAR_TOKEN_SECRET`, `KEYWORD_MEMO_TOKEN_SECRET`, `APP_AUTH_PASSWORD`, `APP_AUTH_SECRET`, `CHROMIUM_NETWORK_ISOLATED=true`.
- The `client-viewbook` worktree is on `docs/viewbook-pr2-handoff` after session 3 — branch PR5 from `origin/main` when its lane opens.
- One unreproduced full-suite flake seen in the PR4 lane — a red run is a red run; re-run only to collect evidence.

## Paste this into a new chat

```
Continue the client-viewbook build in er-seo-tools. Read
docs/superpowers/todos/HANDOFF-client-viewbook.md and
docs/superpowers/plans/2026-07-15-client-viewbook-program.md (repo root is
fine — PR2 is merged). Pick up at "Next steps" item 1: cut the PR4
integration-phase addendum brief from MERGED main code and fire it on the
existing viewbook-pr4 worktree (Codex thread
019f6a92-dc55-73c1-b601-de9b5bd0b59a), including the --vb-* CSS-var rename;
cross-review, then open + merge the PR4 PR. Lane rules: Claude owns PR2/PR5
(PR2 merged #187), Codex CLI owns PR4/PR3; cross-review before merge; if
Codex hits a usage limit, pause and tell me.
```
