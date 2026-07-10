# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-10 (C19 CLOSED — PR3 levers + Score Lab shipped as PR #144; all three C19 increments deployed + prod-verified. Next: pick the post-C19 item, default A8 continuation.) · **Updated by:** the C19 PR3 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: C19 — ADA+SEO scoring overhaul
is CLOSED (PR1 ADA v4 #142, PR2 SEO recalibration #143, PR3 levers + Score Lab #144 — all
shipped + deployed + prod-verified 2026-07-10; migration 20260710120000_ada_scoring_weights
applied; v4 calibration Kevin-ACCEPTED, Bellus-class = D-grade 68).

NEXT ITEM (default): continue the A8 app-shell/visual-polish arc — PRs 1, 2, 3, 3.5 and the
seo-parser polish PR are shipped; read the tracker's A8 entry (item [~] A8 near the top) +
spec docs/superpowers/specs/2026-07-07-app-shell-redesign-design.md §8 to scope the next
per-tool polish increment. ALTERNATES Kevin may redirect to: C12 content auditing (zero-AI
Tier-0) · SF-retirement parity cycles 2–3 · Track A infra (A5/A7) · Track D. If Kevin's first
message names a different item, that wins.

READ FIRST: docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md — the top
status-log entry (2026-07-10 C19 PR3) records what just shipped, the A8 entry records that
arc's exact sub-state. Trust ranking: code > plan/spec > tracker/handoff.

NEW SCORING SURFACES NOW LIVE (context for any scoring work):
  • AdaScoringWeights DB singleton (id=1; caps critical/serious/moderate/minor/needsReview +
    advisoryDiscount; validateAdaWeights enforces caps 0..100, sum≤100, ≥1>0, advisory 0..1).
    resolveAdaScoringWeights() threads into ALL ADA scoring writes (ada-write ×2 + the live
    finalizer with a defaults fallback). NO prod row exists yet → defaults 40/30/15/5/10/0.4.
  • ScoringWeights.brokenLinks is a real column (default 10); PERSISTABLE_WEIGHT_KEYS ×9.
  • /score-lab (hidden nav, cookie-gated; linked from /settings): pick a recent run →
    GET /api/scoring/lab-inputs → in-browser what-if recompute via the pure scorers
    (computeAdaScoreV4 / recomputeSeoScore over the v2 breakdown inputsSnapshot; ADA works
    on ANY run incl. 90-d-archived, SEO only post-C19 runs). Save-as-defaults → settings PUTs.
  • Weights saves change weightsHash → comparabilityBreak:'weights' suppression (PR2 wiring).
    FIRST real weights save: verify the next scan stamps a new hash + the trend delta
    suppresses (observe only, nothing to build).
  • Parity score diffs are version+default-hash gated (both comparators) — a custom weights
    profile or pre-C19 stored score no longer produces parity noise; structural diffs still
    unconditional.

Kevin eyeballs outstanding (authed-UI): C15 Mine-filter · C16 Audits page · C17 seoOnly
auto-flip · C18 results tabs · C14 /sales + real /sales/[token] report · re-scan Bellus
(v4 badge + deduction invoice; expect ≈68, Kevin-accepted) · post-PR3: /settings SEO card
(brokenLinks now visible) + ADA card + /score-lab.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/qct_ clipboard flow.

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh seo@144.126.213.242
"curl -s localhost:3000/api/health").

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): standing authorization
to merge gate-green roadmap PRs (re-run gates in-session) + deploy with post-deploy verify;
destructive server ops Kevin-gated; spec→plan ungated (Codex each artifact, notify Kevin one
line + path, don't wait). Docs ritual in the same commit as any ship.

ENV NOTE: gates = npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run build.
Migrations: hand-author SQL (migrate dev is interactive-only here), apply with
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate; SQLite: no ALTER
COLUMN nullability (PRAGMA rebuild). Dev e2e: DATABASE_URL="file:./local-dev.db"
NEXT_PUBLIC_APP_URL="http://localhost:3000" APP_AUTH_PASSWORD="" npm run dev +
CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome". Never
git add -A. Test gotchas: act() not waitFor under fake timers; getAllBy* for repeated copy;
route files export only handlers+config. lib/scoring/ stays pure+client-safe except
*.server.ts/weights-hash.ts. SDD ledger: .superpowers/sdd/progress.md (PR1+PR2+PR3 sections
complete — do not re-dispatch). ⚠ DEPLOY RECIPE: git push && ssh seo@144.126.213.242
"pm2 stop seo-tools && ~/deploy.sh" then verify .next/BUILD_ID + health + boot log. Prod
replay (read-only): ssh seo@144.126.213.242 "cd /home/seo/webapps/seo-tools &&
DATABASE_URL='file:/home/seo/data/seo-tools/db.sqlite?mode=ro' npx tsx scripts/score-replay.ts"
```

---

## Current state (2026-07-10, post-C19)

- **Shipped + deployed this arc:** C13 (#141), C19 PR1 (#142), PR2 (#143), PR3 (#144). Prod
  healthy; migration applied; no AdaScoringWeights prod row (defaults active).
- **Evidence on file (tracker status log):** ADA replay (165 runs, Kevin-accepted redistribution);
  SEO SF replay (15 baselines, Δ 0..−11); live v2 dev evidence; PR3 dev e2e (snapshot contract
  proven live: SEO run 67→67 under scored weights, 67→73 after a weight change).
- **Next:** A8 continuation (default) or Kevin redirects — see paste-in prompt.

## Gotchas carried forward

- `pentest-results/`, `googlefc472dc61896519a.html`, `SEO_Report_1st_Draft.pdf` untracked at repo
  root — NEVER `git add -A`. Deleted `.playwright-mcp/*` working-tree deletions are harmless.
- Every new public/token route: middleware `isPublicPath` + `middleware.test.ts` case. Score Lab
  + lab-inputs + ada-scoring-weights are cookie-gated — NO middleware entries, do not add any.
- Share/redirect URLs: `NEXT_PUBLIC_APP_URL`, never request origin.
- Array-form `$transaction([...])` only; raw SQL sets `updatedAt` manually.
- Codex consults: session UUID in `~/.claude/state/codex-consultations.json`; budget-check first;
  run `codex exec` in background (10-min foreground timeout).
- A stale `running` example.com SiteAudit can linger in local-dev.db from DB-backed test runs —
  recovery drains it on next dev boot; harmless.
- Lab cosmetic note (triaged ship-as-is): all 9 SEO sliders render regardless of per-source
  factor availability — recomputeSeoScore ignores unavailable factors so the score stays right.
