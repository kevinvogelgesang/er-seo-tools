# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-03 (C7 pt1 built) · **Updated by:** Roadmap choice = **C7**, decomposed into 3 PRs; **part 1 (per-file parse reporting) BUILT + PR #93**, awaiting Kevin merge/deploy/prod-verify. C8 + upload hotfix + A2-f1 + D0 + C6 Phase 4 + C10 all COMPLETE + prod-verified.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: Roadmap choice = C7 (parser consolidation + streaming + per-file failure
isolation), DECOMPOSED into 3 independent PRs, order: isolation → consolidation →
streaming. PART 1 (per-file parse reporting) is BUILT + PR #93
(feat/c7-parse-file-reporting), gate-green (tsc + 2932 tests + build), spec+plan
Codex-reviewed, subagent-built, final opus review = READY TO MERGE. NOT yet
merged/deployed/prod-verified. C8 + upload hotfix (PR #90/#91) + A2-f1 + D0 + C6
Phase 4 + C10 all COMPLETE + PROD-VERIFIED. Work from main (once #93 merges).
A 16-skill operator library lives in .claude/skills/.

1. Load the skill er-seo-tools-change-control first (hard gates: no merge/
   deploy/server mutation without Kevin's explicit go IN THIS conversation; docs
   rituals mandatory; never scan non-client sites).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state +
   next item) and docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
   (full plan). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff.
3. THE IMMEDIATE NEXT STEP depends on PR #93:
   - If PR #93 is NOT yet merged: Kevin merges → deploys (plain ~/deploy.sh,
     code-only, no migration/env) → prod-verify (upload a small crawl to a
     CLIENT/STAGING site with one deliberately-corrupt CSV + one mis-named CSV;
     confirm the File-processing panel buckets + the core-failure banner; confirm
     a pre-PR session still renders = backward-compat). Then tick C7-pt1 in the
     tracker + rewrite this handoff.
   - Once pt1 is verified: START C7 PART 2 (parser consolidation) via the full
     pipeline (spec → Codex → plan → Codex → subagent-driven TDD → gates → PR).
     Then part 3 (streaming parse — the memory/OOM piece; roadmap warns: do NOT
     parallelize parsing before streaming it).
4. Other menu items if Kevin redirects: C9 (ADA scoring v2 + poller/results-view
   consolidation), further C6 (SEO-only scan mode — spec §9; external-link
   verification), or SF-retirement campaign Phase 1 (SF-vs-live parity — a
   MEASUREMENT stream; load er-seo-tools-sf-retirement-campaign).
5. Small open D0 follow-ups (not blocking): set ALERT_WEBHOOK_URL in the server
   .env once Slack admin approves; consider a BACKUP_DIR-unset warning in the
   manual scripts/db-backup.ts; two ~444 MB backups sit in
   /home/seo/data/seo-tools/backups/ (safe to rm the older one).
6. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **BUILT (awaiting merge) 2026-07-03: C7 part 1 — per-file parse reporting.** PR #93
  (`feat/c7-parse-file-reporting`). C7 is DECOMPOSED into 3 independent PRs (Kevin's call):
  (1) failure-isolation surfacing [THIS PR], (2) parser consolidation, (3) streaming parse.
  Order rationale: consolidation shrinks streaming's blast radius; streaming last on the clean
  base (no active OOM — latent risk only from the 100MB upload cap).
  - **The gap this closes:** per-file isolation ALREADY worked (a bad CSV never fails the batch),
    but the errors were written to `result.parsing_errors` and NEVER rendered — dead data. Unmatched
    CSVs / .txt were dropped silently. Worst case: a present-but-corrupt CORE export (internal_all.csv)
    silently produced a degraded result + misleading health score with zero warning.
  - **What shipped:** `FileReport` types + optional `metadata.file_reports` (`lib/types/index.ts`);
    `isCoreExport()` severity helper (`lib/parsers/expected-exports.ts` — core iff matches a core
    expected-export AND no non-core, so a failed `response_codes` redirect variant is `normal` not
    `core`); parse route (`app/api/parse/[sessionId]/route.ts`) emits ONE report per manifest file
    (parsed/failed/unmatched/skipped) + drops `parsing_errors`; `file_reports` stripped from the
    Claude memo export (`claude-export-builder.ts`) but kept in raw JSON; new `FileProcessingPanel`
    (`components/seo-parser/FileProcessingPanel.tsx`, dark-mode) with a core-failure banner, wired
    into `ResultsView` (debug footer removed).
  - **Safety:** NO schema migration, NO new env var, NO middleware/isPublicPath change. Public share
    page unaffected (doesn't import ResultsView). Backward-compat (pre-C7 sessions → legacy summary)
    + archived-safe (pruned blob → panel hidden). Gate-green: tsc + **2932 tests** (303 files) + build.
  - **Reviews:** spec + plan Codex-reviewed (fixes applied in place); 5 per-task spec+quality reviews
    (all Approved); final opus whole-branch review = READY TO MERGE, 0 Critical/Important, all 9
    cross-task invariants HOLD. 2 Minors deferred (panel key=filename cosmetic; "skipped" folds into
    "not recognized" — spec-sanctioned).
  - Spec: `docs/superpowers/specs/2026-07-03-parse-file-reporting-design.md` ·
    Plan: `docs/superpowers/plans/2026-07-03-parse-file-reporting.md` (both stay in active folders
    until C7 fully ships; move to archive/ only when all 3 parts are done).
- **COMPLETE 2026-07-03: C8** — configurable SEO scoring weights + score-explanation panel (PR #90,
  merged `0f3225d` + deployed + prod-verified, fixed-history proven in real data).
- **COMPLETE 2026-07-03: upload hotfix PR #91** (`94dee70`) — Next.js middleware 10MB body cap →
  `experimental.middlewareClientMaxBodySize: '100mb'` so >10MB CSV uploads stop 500ing.
- **COMPLETE 2026-07-02: A2-f1** (PR #88), **D0** (PR #86), **C6 Phase 4** (PR #85), **C10** (PR #75) —
  all merged + deployed + prod-verified.
- **A1, A2, A2-f1, B1–B5, C1–C5 DONE. C6 Phases 1–4 DONE. C8 DONE. C10 DONE. D0 DONE.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00` (noindex → broken-link findings only, null score).
- **⚠ PENDING HUMAN STEPS (Kevin):**
  1. **PR #93:** merge → deploy → prod-verify (see the paste-in prompt step 3).
  2. **D0:** set `ALERT_WEBHOOK_URL` once Slack admin approves; optional stray-backup rm.
  3. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan 409-blocking the
     localStorage import — keep or delete + re-open).
  4. **First real qct_ push** not yet exercised.
  5. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
- **Blocked / gated:** Anthropic API billing; sitemap miss-rate measurement not yet run;
  daily/nightly cadences still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups:** C7 parts 2 (consolidation) + 3 (streaming); C8 diff.service.ts score-source
  migration + draft-weights preview; D0 off-box backup replication; C6 SEO-only scan mode / external-link
  verification / redirect-canonical-hreflang validation / content similarity / daily-cadence
  supersede-trimming; standalone single-page audit CSV/VPAT/report; public share-page export buttons;
  expandable rows on public ADA share view; logo for the PDF; `SessionPage` model drop (≥180 d after
  2026-06-11); same-URL standalone-audit diffing; fleet instance-level diffing; B2 v1 multi-domain
  limitation; SF-retirement campaign Phase 1.

## Next item

**Gated on PR #93.** Immediate: Kevin merges/deploys/prod-verifies C7 part 1 (per-file
parse reporting). Once verified, START **C7 part 2 (parser consolidation)** via the full
pipeline. Then C7 part 3 (streaming parse). If Kevin redirects: C9, further C6, or
SF-retirement Phase 1.

## Gotchas / decisions already made (don't relitigate)

- **C7 is decomposed into 3 PRs, order isolation→consolidation→streaming** (Kevin 2026-07-03).
  Rationale: per-file isolation already works — part 1 is pure VISIBILITY. Consolidation before
  streaming so streaming touches a smaller (~15 vs ~40) parser set. Streaming last: no active OOM,
  only a latent risk from the 100MB cap; the roadmap (`nyi/.../01-seo-parser.md` Phase 3) warns
  **do NOT parallelize parsing before streaming it** (concurrent whole-file loads worsen memory).
- **C7 pt1 invariants (verified against code + final opus review 2026-07-03):**
  - `file_reports` is a DISPLAY-ONLY projection on `metadata`; aggregation + primary-domain tally
    read a SEPARATE `successes[]` list — never reconstruct data inputs from `file_reports`.
  - `isCoreExport(filename)` = matches ≥1 tier:'core' expected export AND 0 non-core — narrower than
    the presence-tolerant `missingCoreExports` gate on purpose (severity precision).
  - `skipped` = `path.extname(filename).toLowerCase() !== '.csv'` (in practice only .txt survives upload).
  - Backward-compat: no `file_reports` → panel shows legacy "N files · M/T parsers matched"; archived
    (`result.archived`) → panel returns null (findings-fallback never sets `file_reports`).
  - `parsing_errors` fully removed (grep-confirmed zero readers). `file_reports` stripped from the
    Claude memo export (`buildTechnicalAuditExport`) but kept in the raw JSON export.
  - **Test gotcha (bit us in build):** the parse route.test.ts gate block's `afterEach(vi.restoreAllMocks())`
    STRIPS `.mockResolvedValue()` off inline `vi.fn()` mocks in a `vi.mock` factory → the pillar-trigger
    mock must be a NAMED handle reconfigured in `beforeEach`, else `triggerPillarAnalysis(...).catch()`
    (not awaited) throws on undefined → the success test 500s.
- **How the SEO health score works (came up 2026-07-03):** WEIGHTED COVERAGE RATIO across ~8 factors
  (indexability, error rate, missing title/meta/H1, crawl depth, thin content, schema), NOT a count of
  SF issues. A factor joins the denominator only when its input exists; `thin_content` DROPS OUT when
  zero thin pages. The "N% of issues have no affected URL" line is the COMPLETENESS verdict, a separate
  axis. This is why C7 pt1's core-failure banner matters: a corrupt internal_all.csv silently degrades
  the coverage ratio.
- **Upload body caps (PR #91):** `/api/upload` is middleware-matched, so Next.js's
  `experimental.middlewareClientMaxBodySize` (now '100mb') is the REAL gate — it truncates, doesn't 413.
  Check this knob first if large uploads break again.
- **C8 invariants:** both SEO scorers share ONE `ScoringWeights` id=1; scorers stay PURE (weights resolved
  in the DB layer); `lib/scoring/weights.ts` must stay prisma-free (client card imports it); persisted
  `CrawlRun.scoreBreakdown` IS the weight snapshot (fixed history); `parity.ts` recomputes at DEFAULT weights.
- **Deploy protocol:** code-only / config-only (incl. `next.config.ts`) → plain `~/deploy.sh`;
  `ecosystem.config.js`/env changes → `pm2 delete && pm2 start`. Prod has NO `sqlite3` CLI — drive
  read-only prod queries with a throwaway `.mjs` IN THE APP DIR using `new PrismaClient()` + inline
  `DATABASE_URL='file:/home/seo/data/seo-tools/db.sqlite'`.
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`); prod DB `/home/seo/data/seo-tools/db.sqlite`;
  prod URL `https://seo.erstaging.site`.
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only.
- **Local dev quirk:** prefix prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`.
  `prisma migrate dev` is interactive-only — hand-write migration SQL, apply with `migrate deploy`.
  **vitest module mocks:** the `const mock = vi.fn()` + lambda-indirection pattern (`fn: (...a) => mock(...a)`)
  works WITHOUT `vi.hoisted` (handle dereferenced only at call time). **No global RTL auto-cleanup** —
  React render tests need `afterEach(cleanup)` + the `// @vitest-environment jsdom` pragma.
- **C6 Phase 4 invariants:** `seoIntent` is the freshness-gated canonical SEO signal; schedules
  operator-created (no self-healing); canonical selection is merge-state-sensitive; live score never
  displaces the sf-upload canonical score.
- **C10 invariants:** SERVICE-ACCOUNT auth; job group `seo-report:<id>` NEVER `site-audit:<id>`;
  monthly schedule is a NON-system operator row.
- **Handoff-token / public route gotcha (bit us THREE times):** any new token-authed or public route
  MUST get a `middleware.ts` `isPublicPath` entry + a `middleware.test.ts` case. (C7 pt1 added no routes.)
- Codex reviews: route new specs/plans through Codex per Kevin's standing instruction (small bugfixes
  with no spec/plan are exempt).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, handoff created.
- 2026-06-10 — A1 Phases 0–4 (PRs #50–#54), prod-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), prod-verified. **A2 COMPLETE.**
- 2026-06-11 — B1–B5 (#60–#64 + middleware fix) shipped + prod-verified. **TRACK B COMPLETE.**
- 2026-06-11/12 — C1 (#65), C2 (#66), C3 (#67), C4 (#68), C5 (#69) SHIPPED.
- 2026-06-16/17 — C6 Phases 1–3 (#70, #71, #73) SHIPPED + prod-verified.
- 2026-06-22 — C10 (#75) + build-heap fix (#76), deployed, migration applied.
- 2026-06-30 — C6 Phase 4 BUILT.
- 2026-07-02 — Skill library SHIPPED (`57ae636`). C6 Phase 4 MERGED+DEPLOYED (#85)+VERIFIED.
  C10 PROD-VERIFIED (COMPLETE). D0 SHIPPED (#86)+DEPLOYED+VERIFIED (COMPLETE).
  A2-f1 BUILT (#88) → MERGED+DEPLOYED+PROD-VERIFIED. **A2-f1 COMPLETE.**
- 2026-07-03 — **C8 BUILT+MERGED (#90)+DEPLOYED+PROD-VERIFIED = COMPLETE.** Upload hotfix **PR #91**
  (`94dee70`) merged+deployed.
- 2026-07-03 — **C7 DECOMPOSED (3 PRs); part 1 (per-file parse reporting) BUILT + PR #93.** Spec+plan
  Codex-reviewed, subagent-built (5 tasks), final opus review = READY TO MERGE. Gate-green (tsc + 2932
  tests + build). Awaiting Kevin merge/deploy/prod-verify.
