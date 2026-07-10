# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-10 (C20 KS-1 **spec + plan Codex-reviewed** — spec ×7, plan ×4,
all applied, committed to main. Next: KS-1 TDD build.) · **Updated by:** the KS-1 spec/plan session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: C20/KS-1 spec + plan,
both Codex-reviewed and committed to main (docs-only; no code shipped yet):
spec docs/superpowers/specs/2026-07-10-ks1-gsc-query-snapshot-design.md
(ACCEPT-WITH-NAMED-FIXES ×7, applied) + plan
docs/superpowers/plans/2026-07-10-ks1-gsc-query-snapshot.md (ACCEPT-WITH-NAMED-FIXES ×4,
applied). C20 is [~].

NEXT ITEM: KS-1 TDD BUILD from that plan, branch feat/ks1-gsc-snapshot, 8 tasks in
order: 1 schema (GscSnapshot model + hand-authored migration 20260710150000_gsc_snapshot)
· 2 provider fetchGscQueryPage in lib/analytics/google/gsc-provider.ts (OWN
GscQueryPageResult union — not_mapped ≠ access_denied; provider owns+exports the row
types, lib/keywords re-exports; assert the 30s timeout as the 2nd query() arg in tests)
· 3 lib/keywords/ pure window + derive (raw-decimal bands, position ≤0 discarded in
derive only; cannibalization share denominator = OBSERVED query×page impressions;
queryImpressions/observedPageCoverage nullable, NOT clamped ≤1) · 4 service
(single-flight Map installed SYNCHRONOUSLY before first await — deferred-promise test;
parse→validate→derive BEFORE create; reads filtered to current gscSiteUrl stamp,
fetchedAt DESC id DESC, corrupt-newest fallback; summary caps 50/50/50/20 at the
service boundary, counts stay full) · 5 routes GET/POST /api/clients/[id]/gsc-snapshot
(cookie-gated, NO middleware change) · 6 retention keep-latest-3 via tagged $executeRaw
correlated subquery, wired into runCleanup · 7 GscKeywordCard + dashboard wiring
(dark-mode variants, afterEach(cleanup)) · 8 gates → PR → merge → deploy → prod-verify
→ ritual + git mv spec/plan to archive/.

KS-1 IN ONE PARAGRAPH: durable client-scoped GSC keyword snapshot — raw [query]
(rowLimit 2500) + [query,page] (rowLimit 5000) rows over a trailing 91-day window
ending 3 days back, stored on a new GscSnapshot model (verbatim gscSiteUrl stamped;
at-limit flags mean "possibly truncated", never definite), derivations pure at read
time (wins ≤10 / opportunities >10–≤30 / quick wins >10–≤20 / cannibalization ≥2 pages
each ≥20% share + ≥10 impressions), operator-on-demand inline refresh (errors
ephemeral, prior snapshot never mutated), keep-latest-3 retention, dashboard card.
Hedged semantics everywhere: absence = "not observed in this GSC window", never "not
ranking". Zero site fetches (GSC API only), zero public surface, no new env vars.
Doubles as C12 Tier-0 Increment A.

AFTER KS-1 SHIPS: KS-2 spec (DataForSEO volume provider + durable cache — verify
pricing/endpoints at spec time, never from memory; dark behind
DATAFORSEO_LOGIN/PASSWORD). Umbrella:
docs/superpowers/specs/2026-07-10-keyword-strategy-capability-design.md (KS-1..6,
MVP = KS-1..5). Kevin §5 decisions (spend envelope, roster UX, token family, SEMRush
role, profile shape, GSC cadence, FAQ phrasing) — none block KS-1 build or KS-2 spec;
ask only if he engages.

READ FIRST: the KS-1 plan (it restates the invariants + exact commands), then the
spec. Trust ranking: code > plan/spec > tracker/handoff.

Kevin eyeballs outstanding (authed-UI): C15 Mine-filter · C16 Audits page · C17 seoOnly
auto-flip · C18 results tabs · C14 /sales + real /sales/[token] report · re-scan Bellus
(v4 badge + deduction invoice; expect ≈68, Kevin-accepted) · post-C19: /settings SEO card
(brokenLinks visible) + ADA card + /score-lab · post-A8-PR7: /clients fleet + client
dashboard (5 canonicalizations in PR #145's body; first real ScoringWeights save should
verify weightsHash suppression — observe only). NEW after KS-1 ships: GscKeywordCard on
a GSC-mapped client dashboard.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/qct_ clipboard flow.

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh
seo@144.126.213.242 "curl -s localhost:3000/api/health").

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): standing
authorization to merge gate-green roadmap PRs (re-run gates in-session) + deploy with
post-deploy verify; destructive server ops Kevin-gated; spec→plan ungated (Codex each
artifact, notify Kevin one line + path, don't wait). Docs ritual in the same commit as
any ship.

ENV NOTE: gates = npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm
run build. Migrations: hand-author SQL (migrate dev is interactive-only here), apply
with DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate;
SQLite: no ALTER COLUMN nullability (PRAGMA rebuild). Never git add -A. Test gotchas:
vitest globals:false → add afterEach(cleanup) to component tests rendering repeated
text; act() not waitFor under fake timers; getAllBy* for repeated copy; route files
export only handlers+config.
⚠ DEPLOY RECIPE: git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"
then verify .next/BUILD_ID + health + boot log.
```

---

## Current state (2026-07-10, post-KS-1-spec/plan)

- **Main** @ `4bad3b6` (KS-1 spec `da26742` + plan/fixes `4bad3b6` on top of the
  C20-open commit `2a0a1b4`). Prod healthy on the A8-PR7 deploy (`c54e7e2`) — docs-only
  since; no deploy owed.
- **C20 `[~]`** — umbrella (Codex ×7) + KS-1 spec (Codex ×7) + KS-1 plan (Codex ×4),
  all 2026-07-10. KS-1 build next; then KS-2..5 each run spec→Codex→plan→Codex→build.
- **KS-1 design essence:** new `GscSnapshot` model (raw rows JSON + metadata columns,
  derivations pure at read time — never persisted); `fetchGscQueryPage` provider fn
  with its OWN result union; inline single-flight refresh; mapping-stamped reads;
  keep-latest-3 retention; `GscKeywordCard`. The Codex tags in spec/plan mark every
  load-bearing subtlety.
- All other tracker state unchanged from the 2026-07-10 A8-close entry.

## The single next item

**KS-1 TDD build** — `../plans/2026-07-10-ks1-gsc-query-snapshot.md` (8 tasks, exact
failing-test assertions + commit commands inline). Branch `feat/ks1-gsc-snapshot`.
Additive migration only; no new env vars; no middleware change; no public surface.
Prod verification = Refresh on a GSC-mapped client dashboard (GSC API only — gate 3
satisfied, no site fetch).

## Gotchas (builder-facing first, then carried forward)

- `gscSiteUrl` is VERBATIM everywhere — never normalize; stamp the exact fetch string
  on the snapshot row; reads filter on the CURRENT client mapping (Codex #1).
- Position-0 rows are the provider's numeric fallback — validator KEEPS them at
  storage, `derive` discards them (Codex #2 / plan #3). Bands are raw-decimal
  comparisons, no rounding.
- Single-flight Map entry installed before the first `await` or the deferred-promise
  test correctly fails (plan #4). Summary caps live in the service, never in derive.
- Retention delete: tagged `$executeRaw` template, never `$executeRawUnsafe`.
- GSC data is sampled/row-limited; never phrase absence as "not ranking" — "not
  observed in this GSC window". Codex flagged this as memo-integrity-critical.
- `pentest-results/`, `googlefc472dc61896519a.html`, `SEO_Report_1st_Draft.pdf`
  untracked at repo root — NEVER `git add -A`. Deleted `.playwright-mcp/*`
  working-tree deletions are harmless.
- vitest `globals:false` → NO testing-library auto-cleanup; component tests rendering
  the same text twice need explicit `afterEach(cleanup)`.
- Every new public/token route: middleware `isPublicPath` + `middleware.test.ts` case —
  bit prod THREE times. KS-1 adds NO public route; KS-5's volume-lookup will need
  exactly one anchored regex.
- Array-form `$transaction([...])` only; raw SQL sets `updatedAt` manually (GscSnapshot
  has none). The KS-5 usage ledger MUST be a conditional update / EXISTS predicate.
- `parse-seo-dom.ts` is `.toString()`-injected: KS-4's FAQ detection must be
  self-contained, no module scope, no `typeof` (`cc8d1c1` class).
- Codex consults: session UUID in `~/.claude/state/codex-consultations.json`;
  budget-check first; the er-seo-tools session is at turn ~54 and healthy.
- ScoreRing bands (≥80/≥50) ≠ Scorecard bands (≥90/≥70) — product decision, do not unify.
- A stale `running` example.com SiteAudit can linger in local-dev.db from DB-backed
  test runs — recovery drains it on next dev boot; harmless.
- Prod deploy uses the interim OOM recipe (`pm2 stop seo-tools && ~/deploy.sh`).
