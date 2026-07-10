# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-10 (A8 PR 7 shipped — /clients visual polish + the SeverityBadge primitive, PR #145, deployed + prod-verified. A8's per-tool candidate list is now nearly exhausted; next is the A8-done decision or a different roadmap item.) · **Updated by:** the A8 PR 7 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: A8 PR 7 — /clients visual
polish (PR #145, merged c54e7e2, deployed + prod-verified 2026-07-10). It extracted the
twice-punted components/ui/SeverityBadge primitive (color-named tones red/orange/amber/blue/
purple/gray; semantics→tone maps live in adopters — see clients/alert-tone.ts), adopted it +
StatusPill across /clients, swept ~81 hex classes to tokens, and dropped the two redundant
page wrappers. Visual-only; 4128 tests green.

NEXT ITEM (decision first): the A8 per-tool arc is nearly exhausted — remaining candidates
are LOW-VALUE (/robots-validator: already tokenized, pill swaps would be visible restyles;
/quarter-grid: inline-hex non-Tailwind, a standalone Tailwind-ization project, not a polish
slice). Default = ask Kevin whether to mark A8 [x] and pick the next item. ALTERNATES Kevin
may redirect to: C12 content auditing (zero-AI Tier-0) · SF-retirement parity cycles 2–3 ·
Track A infra (A5 SSE / A7 auth+Playwright) · Track D. If Kevin's first message names an
item, that wins — build it.

READ FIRST: docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md — the top
status-log entry (2026-07-10 A8 PR 7) records what just shipped; the A8 entry near the top
records the arc's exact state. Trust ranking: code > plan/spec > tracker/handoff.

UI-PRIMITIVES STATE (context for any visual work): components/ui/ = StatusPill (rounded-full
LIFECYCLE pill, 5 tones incl. warning=amber) + SeverityBadge (compact square-rounded PALETTE
badge, 6 color-named tones, shrink-0 contract, uppercase/title props) + ScoreRing (bands
≥80 green / ≥50 amber — NOT the same as Scorecard's ≥90/≥70; that band reconciliation is a
deliberately-deferred product decision, see A8 PR 7 spec §6) + DropZone. Adoption pattern:
per-tool tone helpers (ada-audit/status-tone.ts, reports/status-tone.ts, clients/alert-tone.ts).
Known future SeverityBadge consumers (NOT yet migrated, one tool per pass): ada-audit impact
chips (4-level), reports GA4/GSC source badges.

Kevin eyeballs outstanding (authed-UI): C15 Mine-filter · C16 Audits page · C17 seoOnly
auto-flip · C18 results tabs · C14 /sales + real /sales/[token] report · re-scan Bellus
(v4 badge + deduction invoice; expect ≈68, Kevin-accepted) · post-C19: /settings SEO card
(brokenLinks visible) + ADA card + /score-lab · NEW post-PR7: /clients fleet + client
dashboard (5 documented canonicalizations listed in PR #145's body; first real
ScoringWeights save should also verify weightsHash suppression — observe only).

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
COLUMN nullability (PRAGMA rebuild). Never git add -A. Test gotchas: repo runs vitest with
globals:false → testing-library auto-cleanup is OFF; add afterEach(cleanup) to any component
test that renders repeated text (bit 3 files in PR 7); act() not waitFor under fake timers;
getAllBy* for repeated copy; route files export only handlers+config. ⚠ DEPLOY RECIPE:
git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh" then verify
.next/BUILD_ID + health + boot log + (for CSS work) tone classes present in
.next/static/css/*.css.
```

---

## Current state (2026-07-10, post-A8-PR7)

- **Shipped + deployed this session:** A8 PR 7 (#145) — /clients visual polish. Prod on
  `c54e7e2`, healthy, clean boot, new tone classes confirmed in shipped CSS.
- **A8 arc state:** PRs 1/2/3/3.5 (shell + dashboard + editor + aggregates) and per-tool
  passes 4 (seo-parser #120), 5 (ada-audit #130), 6 (/reports #134), 7 (/clients #145) all
  shipped. Remaining per-tool candidates are low-value (robots) or a separate project
  (quarter-grid) — the tracker's A8 entry now says it's likely time to mark A8 `[x]`;
  that call is Kevin's.
- **C19 (scoring overhaul) is CLOSED** — see the 2026-07-10 C19 status-log entries; no
  AdaScoringWeights prod row yet (defaults 40/30/15/5/10/0.4 active).
- **Next:** the A8-done decision, then C12 / SF parity cycles / A5 / A7 / Track D.

## Gotchas carried forward

- `pentest-results/`, `googlefc472dc61896519a.html`, `SEO_Report_1st_Draft.pdf` untracked at repo
  root — NEVER `git add -A`. Deleted `.playwright-mcp/*` working-tree deletions are harmless.
- vitest `globals:false` → NO testing-library auto-cleanup; component tests rendering the same
  text twice need explicit `afterEach(cleanup)` (FleetTable/Scorecard/ActivityTimeline got it
  in PR 7; other older files may still lack it).
- Every new public/token route: middleware `isPublicPath` + `middleware.test.ts` case. Score Lab
  + lab-inputs + ada-scoring-weights are cookie-gated — NO middleware entries, do not add any.
- Share/redirect URLs: `NEXT_PUBLIC_APP_URL`, never request origin.
- Array-form `$transaction([...])` only; raw SQL sets `updatedAt` manually.
- Codex consults: session UUID in `~/.claude/state/codex-consultations.json`; budget-check first;
  the er-seo-tools session is at turn ~51 and healthy.
- Recharts/SVG colors are props, not classes — `Sparkline.tsx:10` keeps its `#f5a623` default by
  design; the PR 7 hex-guard grep expects exactly that one residual in clients scope.
- ScoreRing bands (≥80/≥50) ≠ Scorecard bands (≥90/≥70) — do NOT "unify" them in a polish pass;
  it's a product decision (A8 PR 7 spec §6).
- A stale `running` example.com SiteAudit can linger in local-dev.db from DB-backed test runs —
  recovery drains it on next dev boot; harmless.
