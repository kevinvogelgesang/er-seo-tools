# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-09 (C13 Bellus scorecard investigation ROOT-CAUSED + FIX SHIPPED — PR #141 merged + deployed + prod-verified behaviorally; ADA score bumped to v3. Kevin commissioned **C19: ADA+SEO scoring-system overhaul** mid-session and asked for it to be built in-session — that is the pre-decided next item.) · **Updated by:** the C13 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. NEXT ITEM (pre-decided, Kevin 2026-07-09): C19 —
the ADA + SEO scoring-system overhaul. Kevin's words: "a much larger and aggressive pass on the
logic (ADA and SEO), as well as the explanation features and the levers for adjusting the weights
— I don't fully understand how weighting works." Run the FULL feature pipeline:
superpowers:brainstorming (Kevin-interactive) → spec → Codex review → plan → Codex review → TDD
build → gates → PR → deploy → prod-verify.

C19 recon already done (2026-07-09, verify in code before trusting):
  • SEO: C8 already shipped weight levers (`ScoringWeights` DB singleton row id=1,
    `lib/scoring/weights.ts` DEFAULT_WEIGHTS/validateWeights, `/settings` ScoringWeightsCard,
    `app/api/settings/scoring-weights`) AND explanations (`components/scoring/ScoreExplanation.tsx`
    factor table reading persisted `scoreBreakdown` v1 {scorer:'health'|'live-seo', factors[]}).
    Formulas: `lib/services/scoring.service.ts` computeHealthScore (8 weighted factors, skipped
    factors renormalize) + `lib/findings/live-seo-score.ts` (fork minus crawlDepth/broken-links).
  • ADA: `lib/ada-audit/scoring-v2.ts` — saturating density model, ALL constants hardcoded
    (IMPACT_WEIGHT 10/6/3/1, K=14, INCOMPLETE_WEIGHT 0.5, ADVISORY_DISCOUNT 0.4, NODE_CAP 200,
    DOM_FLOOR 50). NO levers, and the AdaScoreV2Breakdown factors have NO reader UI (only the
    ScoreVersionBadge). Site score = unweighted mean of page scores.
  • C13 context (shipped 2026-07-09, PR #141): the axe 'no-passes' reporter had stripped
    passes+incomplete since forever → incompletePenalty NEVER fired pre-2026-07-09; version is
    now 3 (same formula, repaired input). Real incomplete/DOM calibration data only accrues from
    scans AFTER 2026-07-09 — capture a production sample before re-weighting (Codex note).
    Version-bump policy for input/weight changes belongs in the C19 spec.

⚠ DEPLOY RECIPE (unchanged until the build-OOM gated decision is resolved):
  git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"
then verify .next/BUILD_ID + health + boot log + schedules. (C13 deployed cleanly this way.)

Kevin eyeballs outstanding (accumulating, all authed-UI): fresh audit under "Mine" (C15), merged
Audits page + recents (C16), one real seoOnly scan auto-flipping to results (C17), C18 results
page (tabs, pattern cards, share view), C14 /sales intake + a real /sales/[token] report (first
real prospect scan is Kevin-initiated), and NEW: **re-scan Bellus (or any client domain) and see
real "rules passed"/"needs review" counts + the v3 badge** — the 2026-07-09 in-flight Bellus
audit is transitional (≤368 pages old-shape → partial counts); all pre-2026-07-09 audits
legitimately keep 0s (the data was never captured).

STANDING GATE (2026-07-08): NO AI API — never propose or build AI-API features; all AI stays the
pat_/srt_/krt_/qct_ clipboard flow. Only Kevin reopens this.

FIRST STEP — confirm main is clean and prod healthy (git log origin/main; then
ssh seo@144.126.213.242 "curl -s localhost:3000/api/health").

Read first: docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md (status log newest
first; top entry is the 2026-07-09 C13 ship with the full root cause) and CLAUDE.md.

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): THIS PASTED PROMPT is
standing authorization to merge gate-green roadmap PRs at session start (re-run lint/test/build
on the branch this session first) and to deploy when needed, ALWAYS followed by post-deploy
verify. Destructive server ops stay Kevin-gated. Brainstorm→spec→plan runs ungated (route each
artifact to Codex, notify Kevin one line + path, don't wait — but C19 BRAINSTORMING itself is
Kevin-interactive: he explicitly wants to understand/steer the weighting design). Docs ritual
mandatory: tracker status-log + rewrite this handoff in the SAME commit as the ship, ending your
final reply with this paste-in prompt. Trust ranking when docs disagree: code > plan/spec >
tracker/handoff.

ENV NOTE (main checkout or fresh worktree): if node_modules/Prisma client are stale, run
`npm install` then `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … prisma
generate`. Prisma resolves relative SQLite URLs against prisma/ — dev DB is prisma/local-dev.db
as DATABASE_URL="file:./local-dev.db". Gates: npx tsc --noEmit + DATABASE_URL="file:./local-dev.db"
npm test + npm run build (vitest WITHOUT the DATABASE_URL prefix fails DB-backed tests with
"Error code 14"). Dev server without a login wall: DATABASE_URL="file:./local-dev.db"
NEXT_PUBLIC_APP_URL="http://localhost:3000" APP_AUTH_PASSWORD="" npm run dev — add
CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" on macOS if
running real audits (dev end-to-end audit against https://example.com is the C13-proven
verification path). UI class: dark: on every element, no hydration mismatch. Test gotchas:
waitFor hangs under vitest fake timers (use act() + direct asserts); mocked routers must be ONE
stable object; getByText/getByRole THROW on multiple matches — use getAllBy*. Next.js App Router
route files may export ONLY HTTP handlers + route config. Injected-in-page code (axe-trim,
parse-seo-dom) MUST be module-scope-free and SWC-helper-free (no typeof/spread) — verify the
compiled chunk.
```

---

## Current state (2026-07-09, post-C13)

- **Shipped + deployed through:** C13 (PR #141) — see the tracker status log's top
  entry for the full root cause (axe `no-passes` reporter stripped passes+incomplete
  fleet-wide; incompletePenalty never fired; ADA score now v3).
- **Prod:** healthy post-deploy (BUILD_ID fresh, 0 unstable restarts, schedules
  ticking). The 2026-07-09 Bellus 407-page audit resumed across the deploy and is
  transitional (mixed blob shapes); its fresh children prove the fix in prod
  (`passCount: 31`, incomplete 3–4 rules/page).
- **Next:** C19 scoring overhaul (above). Kevin wants it Kevin-interactive at the
  brainstorm stage. If this session's context is lost mid-C19, check
  `docs/superpowers/specs/` and `docs/superpowers/plans/` for partial C19 artifacts
  before restarting the brainstorm.
- **Menu after C19:** A8 visual-polish arc ([~], open-ended) · C12 content auditing
  (zero-AI Tier-0 only) · SF-retirement parity cycles 2–3 · Track A infra (A5 SSE,
  A6→A8, A7 auth/Playwright) · Track D polish.

## Gotchas carried forward

- `pentest-results/`, `googlefc472dc61896519a.html`, `SEO_Report_1st_Draft.pdf` are
  untracked at repo root — NEVER `git add -A`.
- Deleted `.playwright-mcp/*` files sit in the working tree (uncommitted deletions)
  — harmless, ignore them.
- Every new public/token route: middleware `isPublicPath` + `middleware.test.ts`
  case (three prior 401 incidents).
- Share/redirect URLs: `NEXT_PUBLIC_APP_URL`, never request origin.
- Array-form `$transaction([...])` only; raw SQL sets `updatedAt` manually.
- Codex consults: session UUID in `~/.claude/state/codex-consultations.json`
  (workspace key `/Users/kevin/enrollment-resources/Claude/er-seo-tools`); budget
  check before routing; 10-min foreground timeout — run `codex exec` in background
  for big reviews.
