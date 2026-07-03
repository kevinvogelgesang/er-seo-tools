# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-03 (C8 verified) · **Updated by:** C8 **COMPLETE** (merged PR #90 → deployed → prod-verified) + upload hotfix PR #91 (merged + deployed). **No feature is mid-flight.** The next move is a **roadmap choice**.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: C8 (configurable SEO scoring weights + score-explanation panel) is
COMPLETE — PR #90 merged (main 0f3225d) + deployed + prod-verified (structural +
behavioral eyeball; fixed-history proven in real data). An upload hotfix PR #91
(Next.js middleware 10MB body cap → >10MB CSV uploads 500'd) is also merged
(94dee70) + deployed. A2-f1 + D0 + C6 Phase 4 + C10 all COMPLETE + PROD-VERIFIED.
Work from main. A 16-skill operator library lives in .claude/skills/.

1. Load the skill er-seo-tools-change-control first (hard gates: no merge/
   deploy/server mutation without Kevin's explicit go IN THIS conversation; docs
   rituals mandatory; never scan non-client sites).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state +
   next item) and docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
   (full plan). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff.
3. THE NEXT MOVE IS A ROADMAP CHOICE. Confirm direction with Kevin, then run the
   full change-control pipeline (spec → Codex → plan → Codex → TDD → gates → PR →
   Kevin merges/deploys → prod-verify). Menu:
   - C-track: C7 (parser consolidation + streaming parse + per-file failure
     isolation), C9 (ADA scoring v2 + poller/results-view consolidation), or
     further C6 (SEO-only scan mode — spec §9 breadcrumb; external-link
     verification).
   - SF-retirement campaign Phase 1 (SF-vs-live parity) — a MEASUREMENT stream
     (analysts run SF + upload alongside seoIntent live scans over 2–3 cycles),
     not a one-session build. Load er-seo-tools-sf-retirement-campaign; parity
     script at .claude/skills/er-seo-tools-sf-retirement-campaign/scripts/
     sf-live-parity.ts.
4. Small open D0 follow-ups (not blocking): set ALERT_WEBHOOK_URL in the server
   .env once Slack admin approves; consider a BACKUP_DIR-unset warning in the
   manual scripts/db-backup.ts; two ~444 MB backups sit in
   /home/seo/data/seo-tools/backups/ (safe to rm the older one).
5. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **COMPLETE 2026-07-03: C8 — configurable SEO scoring weights + score-explanation
  panel.** PR #90 MERGED (main `0f3225d`) + DEPLOYED (plain `~/deploy.sh`, additive
  migration `20260703120000_configurable_scoring_weights` auto-applied) + PROD-VERIFIED.
  - **Structural verify** (read-only prisma `.mjs` on prod): `scoreBreakdown` column
    present; `ScoringWeights` empty → `resolveScoringWeights` returns `DEFAULT_WEIGHTS`
    (identical scoring to pre-C8); 0 historical runs carry a breakdown; new cookie-gated
    route 401s unauth (correctly non-public); clean boot, 0 restarts.
  - **Behavioral eyeball (real data):** scan run `de498917` (session `00429145`) persisted
    `score 82` with an `indexability` weight of **21** (Kevin's non-default edit); resetting
    weights to the default 20 afterward left that run's 82 + weight-21 snapshot UNCHANGED
    → fixed-history AND score/panel-reflects-weights both confirmed.
  - **Data model:** `ScoringWeights` singleton (id=1, 8 Float weights, defaults
    20/20/10/8/7/15/10/10); `CrawlRun.scoreBreakdown` nullable JSON
    (`{version,scorer,score,factors:[{key,label,weight,earned,possible}]}`).
  - **Scorers:** `computeHealthScore` (SF-upload) + `scoreLiveSeo` (live-scan) both take
    `weights`, return `{score,factors}`; `score` + `scoreBreakdown` from ONE call (dead
    `metadata.health_score` precedence removed). Module split: `lib/scoring/weights.ts`
    PURE (client-safe) / `resolve-weights.ts` server-only.
  - **UI:** `ScoringWeightsCard` on `/settings`; `ScoreExplanation` panel on SEO parser
    results + `OnPageSeoSection` (archived-safe; pre-C8 runs show "unavailable"; live
    null-score runs render nothing).
- **COMPLETE 2026-07-03: upload hotfix — PR #91** (merged `94dee70` + deployed). >10MB
  CSV uploads 500'd with "Failed to upload files". Root cause: `/api/upload` is matched by
  the middleware matcher (`/api/:path*`); Next.js 15 caps middleware-matched request bodies
  at **10MB by default** and TRUNCATES beyond it → severed multipart boundary →
  `request.formData()` throws. NOT a C8 regression (framework default). Fix:
  `experimental.middlewareClientMaxBodySize: '100mb'` in `next.config.ts` (matches the
  upload route's own 100MB `DEFAULT_MAX_UPLOAD_BODY_BYTES`) + `next.config.test.ts` guard.
  Config-only → plain deploy. Prod HEAD `94dee70`, cap deployed, clean boot.
- **COMPLETE 2026-07-02: A2-f1** (findings-rebuild pruned-ADA guard, PR #88) — merged +
  deployed + prod-verified (behavioral rebuild-refuses check deferred; 0 pruned targets
  until ~2026-08+).
- **COMPLETE 2026-07-02: D0** (DB backup + failure alert, PR #86) — deployed + prod-verified.
  Slack webhook still unset (alerts log-only).
- **PROD-VERIFIED 2026-07-02: C6 Phase 4** (PR #85). C6 stays `[~]`.
- **COMPLETE 2026-07-02: C10 — SEO Performance Reports** (PR #75, prod-verified).
- **16-skill operator library** under `.claude/skills/` (commit `57ae636`, on main).
- **A1, A2, A2-f1, B1–B5, C1–C5 DONE. C6 Phases 1–4 DONE. C8 DONE. C10 DONE. D0 DONE.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00` (noindex → broken-link findings only,
  null score — by design).
- **⚠ PENDING HUMAN STEPS (Kevin):**
  1. **D0:** set `ALERT_WEBHOOK_URL` once Slack admin approves; optional stray-backup rm
     (two ~444 MB files in `/home/seo/data/seo-tools/backups/` — safe to rm the older one).
  2. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan
     409-blocking the localStorage import — keep or delete + re-open).
  3. **First real qct_ push** not yet exercised.
  4. **Optional cleanup:** delete PillarAnalysis `cmr43gufj0001y200n9134fjp`
     (C6 Phase-4 pillar smoke artifact) if unwanted.
  5. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
- **Blocked / gated:** Anthropic API billing; sitemap miss-rate measurement not
  yet run; daily/nightly cadences still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups (not next items):** C8 diff.service.ts score-source
  migration (spec §9 — parity's score comparison assumes default weights); C8
  `/settings` draft-weights preview; D0 off-box backup replication; C6 SEO-only
  scan mode (spec §9), external-link verification, redirect/canonical/hreflang
  validation, content similarity, daily-cadence supersede-trimming; standalone
  single-page audit CSV/VPAT/report; public share-page export buttons; expandable
  rows on public ADA share view; logo for the PDF; `SessionPage` model drop
  (≥180 d after 2026-06-11); same-URL standalone-audit diffing; fleet
  instance-level diffing; B2 v1 multi-domain limitation; SF-retirement campaign
  Phase 1 (SF-vs-live parity — a MEASUREMENT stream).

## Next item

**A roadmap CHOICE.** No feature is mid-flight. Confirm direction with Kevin, then
run the full pipeline (spec → Codex → plan → Codex → TDD → gates → PR → Kevin
merges/deploys → prod-verify). Menu:

1. **C-track:** C7 (parser consolidation + streaming parse + per-file failure
   isolation), C9 (ADA scoring v2 + poller/results-view consolidation), or further
   C6 (SEO-only scan mode — spec §9 breadcrumb; external-link verification).
2. **SF-retirement campaign Phase 1 (SF-vs-live parity)** — a MEASUREMENT stream,
   not a one-session build. Load `er-seo-tools-sf-retirement-campaign`.

## Gotchas / decisions already made (don't relitigate)

- **How the SEO health score works (came up 2026-07-03):** it is a WEIGHTED COVERAGE
  RATIO across ~8 factors (indexability, error rate, missing title/meta/H1, crawl depth,
  thin content, schema), NOT a count of Screaming Frog issues. `score = round(Σearned /
  Σpossible × 100)`; a factor joins the denominator only when its input exists (so scores
  renormalize across different uploaded export sets), and `thin_content` DROPS OUT entirely
  when zero thin pages exist. This is why a scan with "4 errors / 42 warnings / 32 notices"
  can score 82 — the issue-severity taxonomy is a separate axis the score doesn't read.
  The "N% of issues have no affected URL" line is the COMPLETENESS verdict
  (`lib/services/completeness.ts`): >50% no-URL → "partial"; most no-URL issues are SF
  `issues_overview` count-only passthroughs (upload the per-issue export CSVs to populate
  URLs). Only missing title/meta/H1 + thin_content recover complete URL lists (page-index).
- **Upload body caps (PR #91):** `/api/upload` is middleware-matched, so Next.js's
  `experimental.middlewareClientMaxBodySize` (default 10MB) is the REAL gate — it truncates,
  it doesn't 413. It's now '100mb' to match the route's own `DEFAULT_MAX_UPLOAD_BODY_BYTES`.
  If large uploads break again, check this knob first, not the route's own limit.
- **C8 invariants (verified against code + real prod data 2026-07-03):**
  - Both SEO scorers share ONE global weight profile (`ScoringWeights` id=1); live SEO
    structurally ignores `crawlDepth`. Validation requires a positive live-eligible factor.
  - Scorers stay PURE — weights resolved in the DB layer (`writeSeoFindings`,
    `broken-link-verify`) and passed in. `score` + `scoreBreakdown` from ONE call.
  - `lib/scoring/weights.ts` must stay prisma-free (client card imports it); DB read lives
    ONLY in `resolve-weights.ts` (server).
  - `ScoreExplanation`: null/malformed → "unavailable"; empty factors (live null-score) →
    renders NOTHING; else the collapsible table. Reads only the scalar — archived-safe.
  - Fixed history: the persisted breakdown IS the weight snapshot; edits affect future
    scores only. (Proven in prod: run kept weight-21 snapshot after a reset to 20.)
  - `parity.ts` recomputes the expected score at DEFAULT weights → its `score:` diff line is
    only meaningful at default weights (structural parity is authoritative). A full fix
    (diff.service.ts → `CrawlRun.score`) is a deferred follow-up.
  - **GOTCHA:** `tsconfig.json` EXCLUDES `*.test.ts(x)` from `tsc`, so a test calling a
    changed signature won't fail `npm run lint` but WILL fail at runtime — after any
    signature change, grep ALL callers incl. tests and run the FULL suite
    (`DATABASE_URL="file:./local-dev.db" npm test`).
- **Deploy protocol:** code-only / config-only (incl. `next.config.ts`) → plain `~/deploy.sh`;
  `ecosystem.config.js`/env changes → `pm2 delete && pm2 start`. Prod has NO `sqlite3` CLI —
  drive read-only prod queries with a throwaway `.mjs` IN THE APP DIR (so `@prisma/client`
  resolves) using `new PrismaClient()` + inline `DATABASE_URL='file:/home/seo/data/seo-tools/db.sqlite'`.
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`); prod DB at
  `/home/seo/data/seo-tools/db.sqlite`; prod URL `https://seo.erstaging.site`.
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only.
- **Local dev quirk:** prefix prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`.
  `prisma migrate dev` is interactive-only — hand-write migration SQL, apply with
  `migrate deploy`. **vitest module mocks must use `vi.hoisted(() => ({...}))`.**
  **No global RTL auto-cleanup** — React render tests need `afterEach(cleanup)` +
  the `// @vitest-environment jsdom` pragma.
- **C6 Phase 4 invariants:** `seoIntent` is the freshness-gated canonical SEO signal;
  schedules operator-created (no self-healing); canonical selection is merge-state-sensitive;
  live score never displaces the sf-upload canonical score.
- **C10 invariants:** SERVICE-ACCOUNT auth; job group `seo-report:<id>` NEVER
  `site-audit:<id>`; monthly schedule is a NON-system operator row.
- **Handoff-token / public route gotcha (bit us THREE times):** any new token-authed or
  public route MUST get a `middleware.ts` `isPublicPath` entry + a `middleware.test.ts` case.
  (Cookie-gated routes like C8's stay OUT of isPublicPath but still get a middleware test.)
- Test gotchas: DB-backed tests use unique prefixes + scoped cleanup; a test that writes a
  score must reset the `ScoringWeights` singleton (`afterEach` delete id:1); CrawlRun-by-
  `siteAuditId` reads need compound `siteAuditId_tool`.
- Codex reviews: route new specs/plans through Codex per Kevin's standing instruction
  (small bugfixes with no spec/plan are exempt — PR #91 was such a bugfix).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, handoff created.
- 2026-06-10 — A1 Phases 0–4 (PRs #50–#54), prod-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), prod-verified. **A2 COMPLETE.**
- 2026-06-11 — B1–B5 (#60–#64 + middleware fix) shipped + prod-verified. **TRACK B COMPLETE.**
- 2026-06-11/12 — C1 (#65), C2 (#66), C3 (#67), C4 (#68), C5 (#69) SHIPPED.
- 2026-06-16/17 — C6 Phases 1–3 (#70, #71, #73) SHIPPED + prod-verified.
- 2026-06-22 — C10 (#75) + build-heap fix (#76), deployed, migration applied.
- 2026-06-30 — C6 Phase 4 BUILT.
- 2026-07-02 — Skill library SHIPPED (`57ae636`). C6 Phase 4 MERGED+DEPLOYED (#85)
  + PROD-VERIFIED. C10 PROD-VERIFIED (COMPLETE). D0 SHIPPED (#86)+DEPLOYED+VERIFIED (COMPLETE).
- 2026-07-02 — A2-f1 BUILT (#88) → MERGED+DEPLOYED+PROD-VERIFIED. **A2-f1 COMPLETE.**
- 2026-07-03 — **C8 BUILT+MERGED (#90)+DEPLOYED+PROD-VERIFIED = COMPLETE** (configurable SEO
  scoring weights + score-explanation panel; fixed-history proven in real prod data). Upload
  hotfix **PR #91** (Next.js middleware 10MB body-cap → '100mb') merged (`94dee70`)+deployed.
