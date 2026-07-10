# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-10 (C19 PR1 — ADA v4 deduction scoring — SHIPPED: PR #142 merged + deployed + prod replay evidence collected. C13 shipped earlier the same session, PR #141. ONE OPEN KEVIN RULING on v4 calibration; PR2/PR3 remain.) · **Updated by:** the C13+C19 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. CURRENT ITEM: C19 — ADA+SEO scoring overhaul,
IN PROGRESS (PR1 of 3 shipped 2026-07-10). Kevin's ask: aggressive logic pass (ADA and SEO) +
explanation features + weight levers; anchor = school-grade 70s–80s for visibly-flawed sites;
internal-first explanations.

STATE:
  • Spec (Codex ×7): docs/superpowers/specs/2026-07-09-c19-scoring-overhaul-design.md — READ FIRST.
  • PR1 SHIPPED (PR #142, main e2f089c, deployed + prod-verified): lib/scoring/ada-v4.ts pure
    scorer (prevalence deductions, caps 40/30/15/5/10, ADA_SCORE_VERSION=4) + calibration
    archetype suite (the band contract — never widen a band) + weights-hash.ts (server-only) +
    mapper flip (run.score = site-level v4, AdaSiteParent.pagesTotal threaded) +
    AdaScoreExplanation invoice panel (internal-only) + ada-v4-inputs.server.ts +
    scripts/score-replay.ts (read-only). Plan: docs/superpowers/plans/2026-07-09-c19-pr1-ada-v4.md.
  • PROD REPLAY (165 runs): 95+ band 94→127, <50 band 31→4. Mix of v1-artifact corrections
    (old v1 zeros → 90s for few-rule pages) and the intended prevalence-over-node-density shift
    (breadth-sites drop: innovatesalon 89→30; node-heavy few-rule sites rise: bellus 25→68).
  • KEVIN RULING (2026-07-10, in-session): ACCEPT v4 as calibrated — Bellus-class = D-grade 68,
    not broken; watch first real v4 scans; node-volume dial stays FUTURE. No recalibration.
  • NEXT BUILD: PR2 — SEO recalibration (write its plan first via writing-plans + Codex): shared
    curve core lib/scoring/seo-core.ts + typed SF/live adapters + contract tests; steeper curves;
    live broken-links factor (builder persists linkVerification snapshot {internalChecked,
    internalBroken,imagesChecked,imagesBroken,passComplete} — post-C19 runs only, disabled on
    partial/capped); PersistedBreakdown v2 + inputsSnapshot; SeoRunRow.scoreBreakdown threaded in
    client-fleet.ts + client-dashboard.ts; comparabilityBreak 'version'|'weights' in buildSeries
    (formulaChanged stays as alias); weightsHash stamped. Then PR3 — AdaScoringWeights schema
    (sum(caps)≤100, advisoryDiscount 0..1) + /settings cards + Score Lab (ADA any-run via
    ada-v4-inputs.server.ts; SEO post-C19 runs only via inputsSnapshot) + GET /api/scoring/lab-inputs.
  • PR1 follow-ups to fold into PR2/PR3: builder violation orderBy (determinism), parity
    score-diff noise on pre-C19 audits (document or version-gate), malformed-wcagTags test.

C13 (shipped same session, PR #141): axe no-passes reporter had stripped passes+incomplete from
every blob forever → incompletePenalty never fired pre-2026-07-09; readers prefer the passCount
scalar; ADA went v3 then v4 same day (v3 = C13 input repair, v4 = new model). Legacy blobs
legitimately show 0 passed. Real incomplete data accrues from post-2026-07-09 scans only.

⚠ DEPLOY RECIPE (unchanged until the build-OOM gated decision):
  git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"
then verify .next/BUILD_ID + health + boot log + schedules.

Kevin eyeballs outstanding (authed-UI): C15 Mine-filter · C16 Audits page · C17 seoOnly auto-flip ·
C18 results tabs · C14 /sales + real /sales/[token] report · NEW: re-scan Bellus (or any client) —
scorecard now shows real "rules passed"/"needs review", the v4 badge, AND the deduction-invoice
"How this score was calculated" panel; expect Bellus ≈68 not 25 (Kevin-accepted calibration).

STANDING GATE (2026-07-08): NO AI API — all AI stays the pat_/srt_/krt_/qct_ clipboard flow.

FIRST STEP — confirm main is clean and prod healthy (git log origin/main; then
ssh seo@144.126.213.242 "curl -s localhost:3000/api/health").

Read first: the C19 spec, then docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
(top status-log entry = C19 PR1 with the replay evidence). Load skill
er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): this prompt is standing
authorization to merge gate-green roadmap PRs (re-run gates in-session) and deploy with
post-deploy verify; destructive server ops stay Kevin-gated; spec→plan runs ungated (Codex each
artifact, notify Kevin one line + path, don't wait). Docs ritual in the same commit as any ship.
Trust ranking: code > plan/spec > tracker/handoff.

ENV NOTE: gates = npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run build.
Dev server: DATABASE_URL="file:./local-dev.db" NEXT_PUBLIC_APP_URL="http://localhost:3000"
APP_AUTH_PASSWORD="" npm run dev (+ CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/
MacOS/Google Chrome" on macOS; e2e audit of https://example.com is the proven verification path —
expect a v4 breakdown + invoice panel). lib/scoring/ stays pure+client-safe except *.server.ts /
weights-hash.ts. Injected-in-page code must be SWC-helper-free (no typeof/spread). Test gotchas:
act() not waitFor under fake timers; ONE stable mocked-router object; getAllBy* for repeated copy;
route files export only handlers+config; never git add -A (untracked pentest-results/ etc.).
Replay evidence JSON archived in the tracker entry; re-run read-only anytime:
ssh seo@144.126.213.242 "cd /home/seo/webapps/seo-tools && DATABASE_URL='file:/home/seo/data/
seo-tools/db.sqlite?mode=ro' npx tsx scripts/score-replay.ts"
```

---

## Current state (2026-07-10, post-C19-PR1)

- **Shipped + deployed through:** C13 (PR #141) + C19 PR1 (PR #142). Prod healthy.
- **Open:** PR2 (SEO recalibration) and PR3
  (levers + Score Lab) — each needs its own plan via writing-plans + Codex before build.
- **Menu after C19:** A8 visual-polish arc · C12 content auditing (zero-AI Tier-0) ·
  SF-retirement parity cycles 2–3 · Track A infra (A5/A7) · Track D.

## Gotchas carried forward

- `pentest-results/`, `googlefc472dc61896519a.html`, `SEO_Report_1st_Draft.pdf` untracked at
  repo root — NEVER `git add -A`. Deleted `.playwright-mcp/*` uncommitted deletions are harmless.
- Every new public/token route: middleware `isPublicPath` + `middleware.test.ts` case.
- Share/redirect URLs: `NEXT_PUBLIC_APP_URL`, never request origin.
- Array-form `$transaction([...])` only; raw SQL sets `updatedAt` manually.
- Codex consults: session UUID in `~/.claude/state/codex-consultations.json`; budget check
  before routing; run `codex exec` in background (10-min foreground timeout).
- SDD ledger for C19 PR1: `.superpowers/sdd/progress.md` (git-ignored).
