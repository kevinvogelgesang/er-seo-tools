# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-10 (A8 closed `[x]` by Kevin at 7 shipped PRs; **C20 Keyword
Strategy capability opened** — umbrella gap analysis written + Codex-reviewed
(accept-with-named-fixes ×7, applied). Next: KS-1 spec.) · **Updated by:** the C20-opening session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: A8 marked [x] (Kevin,
2026-07-10 — 7 shipped PRs; /robots-validator + /quarter-grid declined-for-now) and C20
Keyword Strategy capability OPENED: umbrella gap analysis
docs/superpowers/specs/2026-07-10-keyword-strategy-capability-design.md written from a
code-verified recon and Codex-reviewed (ACCEPT-WITH-NAMED-FIXES ×7, all applied). Docs-only
session — no code shipped.

C20 IN ONE PARAGRAPH: make Kevin's Claude-project "Keyword Research for Educational
Institutions" workflow (8-section per-client strategy memo) runnable from the app.
Generation STAYS the krt_ clipboard flow (NO-AI-API gate) — the app assembles the data
package. 6 increments; MVP = KS-1..5 (~2 wks): KS-1 GSC query×page client snapshot
(wins 1-10 / opportunities 11-30 / quick wins 11-20 + cannibalization — doubles as C12
Tier-0 Increment A; hedged "not observed in this GSC window ≠ not ranking" semantics +
window/truncation/threshold metadata) · KS-2 DataForSEO volume provider + durable cache
(dark behind DATAFORSEO_LOGIN/PASSWORD; Kevin confirmed access exists; verify
pricing/endpoints at spec time, never from memory) · KS-3 client institution profile +
STRUCTURED program roster ({name,url?,aliases?,credentialLevel?,confirmed},
auto-suggest from pillar page-typing, operator-confirm) + keyword locale codes · KS-4
FAQ tri-state detection (present|not-detected|unknown; parse-seo-dom is
string-injected — SWC-helper-free, no typeof) + page inventory in export · KS-5
client-scoped krt_-v2 export + volume-lookup endpoint (BILLABLE capability: dedicated
volume-lookup scope, anchored single-route middleware regex + middleware.test.ts case,
persisted per-session usage ledger via conditional array-form update) + er-handoff-memo
skill upgrade (~/.claude/skills/er-handoff-memo gets Kevin's instructions + 4 reference
docs). KS-6 later/optional.

NEXT ITEM: KS-1 spec (docs/superpowers/specs/, then Codex, then plan, then TDD build per
ritual). Key code seams for KS-1: lib/analytics/google/gsc-provider.ts (fetches
totals/date/query-only today, report-scoped, only caller is seo-report-render),
Client.gscSiteUrl exists, C10 service-account auth prod-verified. Spec must decide the
snapshot home (new model vs JSON), carry window/rowLimit/truncation/min-impression/
fetchedAt metadata, and name the refresh owner. Kevin's §5 decisions (spend envelope,
roster UX, token family, SEMRush role, profile shape, GSC cadence, FAQ phrasing) —
none block KS-1; ask only if he engages.

READ FIRST: the C20 umbrella doc + the tracker's top status-log entry (2026-07-10 A8
closed + C20 opened). Trust ranking: code > plan/spec > tracker/handoff.

Kevin eyeballs outstanding (authed-UI): C15 Mine-filter · C16 Audits page · C17 seoOnly
auto-flip · C18 results tabs · C14 /sales + real /sales/[token] report · re-scan Bellus
(v4 badge + deduction invoice; expect ≈68, Kevin-accepted) · post-C19: /settings SEO card
(brokenLinks visible) + ADA card + /score-lab · post-A8-PR7: /clients fleet + client
dashboard (5 canonicalizations in PR #145's body; first real ScoringWeights save should
verify weightsHash suppression — observe only).

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
COLUMN nullability (PRAGMA rebuild). Never git add -A. Test gotchas: vitest globals:false →
add afterEach(cleanup) to component tests rendering repeated text; act() not waitFor under
fake timers; getAllBy* for repeated copy; route files export only handlers+config.
⚠ DEPLOY RECIPE: git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"
then verify .next/BUILD_ID + health + boot log.
```

---

## Current state (2026-07-10, post-A8-close / C20-open)

- **This session (docs-only):** A8 marked `[x]` (Kevin's call; 7 shipped PRs — shell,
  dashboard, widget editor, aggregates, and per-tool passes over seo-parser/ada-audit/
  reports/clients). C20 opened with the Codex-reviewed umbrella doc
  `../specs/2026-07-10-keyword-strategy-capability-design.md`. A8 umbrella spec +
  app-shell PR 2 plan moved to `../archive/`.
- **C20 source material:** Kevin pasted his full Claude-project instructions + 4 reference
  docs (program categories, BOFU patterns, intent definitions I/C/T/N, compliance
  exclusions) in the 2026-07-10 session — reproduced in condensed form in the umbrella
  doc §1; the full text lives in that chat and moves into the er-handoff-memo skill at
  KS-5. DataForSEO API access confirmed by Kevin (access half of the tracker's
  third-party data-API question resolved; spend envelope still open).
- **Current keyword-research code (verified):** krt_ flow = session-bound, SEMRush-CSV-fed
  (`lib/parsers/keyword-research-export.ts`, `app/api/keyword-memo/`); volumes ONLY from
  SEMRush CSV columns; GSC provider report-scoped, no query×page anywhere; CrawlPage
  already stores url/title/h1/wordCount/indexable (the §7 inventory); no client
  program/vertical metadata; `HarvestedPageSeo.contentText` transient (1-h retention
  direction approved but unbuilt); no DataForSEO client.
- **Prod:** healthy on `c54e7e2` + this session's docs commit; no code deployed since A8 PR 7.

## Gotchas carried forward

- `pentest-results/`, `googlefc472dc61896519a.html`, `SEO_Report_1st_Draft.pdf` untracked at repo
  root — NEVER `git add -A`. Deleted `.playwright-mcp/*` working-tree deletions are harmless.
- vitest `globals:false` → NO testing-library auto-cleanup; component tests rendering the same
  text twice need explicit `afterEach(cleanup)`.
- Every new public/token route: middleware `isPublicPath` + `middleware.test.ts` case — this
  bit prod THREE times; KS-5's volume-lookup route will need exactly one anchored regex.
- Share/redirect URLs: `NEXT_PUBLIC_APP_URL`, never request origin.
- Array-form `$transaction([...])` only; raw SQL sets `updatedAt` manually. The KS-5 usage
  ledger MUST be a conditional update / EXISTS predicate, never an interactive transaction.
- `parse-seo-dom.ts` is `.toString()`-injected: KS-4's FAQ detection must be self-contained,
  no module scope, no `typeof` (SWC helper escape → in-page ReferenceError; `cc8d1c1` class).
- GSC data is sampled/row-limited; never phrase absence as "not ranking" — "not observed in
  this GSC window". Codex flagged this as memo-integrity-critical.
- Codex consults: session UUID in `~/.claude/state/codex-consultations.json`; budget-check
  first; the er-seo-tools session is at turn ~52 and healthy.
- ScoreRing bands (≥80/≥50) ≠ Scorecard bands (≥90/≥70) — product decision, do not unify.
- A stale `running` example.com SiteAudit can linger in local-dev.db from DB-backed test
  runs — recovery drains it on next dev boot; harmless.
