# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-03 (C8 built) · **Updated by:** C8 **BUILT + PR #90** (`feat/c8-configurable-scoring-weights`). **Pending human step: Kevin merges → deploys → prod-verifies.** A2-f1 is COMPLETE (merged + deployed + prod-verified). After C8, next is a **roadmap choice** again.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

> **Docs-PR overlap note:** PR #90 (C8) also carries the A2-f1-verified
> tracker/handoff, so it **supersedes** the docs-only PR #89. Merge #90 and
> close #89, or merge #89 first and rebase #90 (trivial conflict on these two
> files only).

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: C8 (configurable SEO scoring weights + score-explanation panel) is BUILT
+ PR #90 open (feat/c8-configurable-scoring-weights), gate-green (tsc / 2919
vitest / build), NOT yet merged/deployed. Spec + plan both Codex-reviewed; built
subagent-driven (7 TDD tasks, per-task + final opus review = READY TO MERGE).
A2-f1 + D0 + C6 Phase 4 + C10 all COMPLETE + PROD-VERIFIED. Work from main.
A 16-skill operator library lives in .claude/skills/.

1. Load the skill er-seo-tools-change-control first (hard gates: no merge/
   deploy/server mutation without Kevin's explicit go IN THIS conversation; docs
   rituals mandatory; never scan non-client sites).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state +
   next item) and docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
   (full plan). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff.
3. PENDING VERIFICATION: PR #90 (C8) awaits Kevin merge → deploy → prod-verify.
   The migration is ADDITIVE (ScoringWeights table + CrawlRun.scoreBreakdown) and
   auto-applies via ~/deploy.sh; NO new env var; no isPublicPath change. Light
   prod-verify after deploy: on /settings set a non-default weight (e.g. drop
   crawlDepth to 0 or bump indexability), save, run ONE scan on a client site or
   a domain you control, and confirm (a) the live SEO score + the new
   score-explanation panel reflect the changed weights, (b) an EXISTING pre-edit
   audit's score/breakdown is unchanged (fixed history), (c) a fresh default DB
   would score identically to pre-C8. Also spot-check the SEO parser results page
   shows the health-score line + panel. Then reset weights to defaults if desired.
   Once verified: tracker [~]→[x] for C8 + status-log line + rewrite this handoff.
   ALSO: PR #90 carries the A2-f1-verified docs (supersedes docs-only PR #89) —
   merge #90 and close #89, or merge #89 first + rebase #90.
4. THEN the next move is a ROADMAP CHOICE. Confirm direction with Kevin, then run
   the full change-control pipeline (spec → Codex → plan → Codex → TDD → gates →
   PR → Kevin merges/deploys → prod-verify). Menu:
   - C-track: C7 (parser consolidation + streaming parse + per-file failure
     isolation), C9 (ADA scoring v2 + poller/results-view consolidation), or
     further C6 (SEO-only scan mode — spec §9 breadcrumb; external-link
     verification).
   - SF-retirement campaign Phase 1 (SF-vs-live parity) — a MEASUREMENT stream
     (analysts run SF + upload alongside seoIntent live scans over 2–3 cycles),
     not a one-session build. Load er-seo-tools-sf-retirement-campaign; parity
     script at .claude/skills/er-seo-tools-sf-retirement-campaign/scripts/
     sf-live-parity.ts.
5. Small open D0 follow-ups (not blocking): set ALERT_WEBHOOK_URL in the server
   .env once Slack admin approves; consider a BACKUP_DIR-unset warning in the
   manual scripts/db-backup.ts; a stray 444 MB backup may sit in
   /home/seo/webapps/seo-tools/data/backups/ (safe to rm).
6. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **BUILT (awaiting merge/deploy/prod-verify) 2026-07-03: C8 — configurable SEO
  scoring weights + score-explanation panel.** PR #90 (`feat/c8-configurable-scoring-weights`),
  gate-green (tsc / 2919 vitest / build). Feature pipeline: brainstorm → spec →
  Codex → plan → Codex → subagent-driven TDD (7 tasks) → final opus whole-branch
  review = READY TO MERGE (0 Critical/Important; 4 Minors all safe-to-defer).
  - **Data model:** `ScoringWeights` singleton table (id=1, 8 Float weights,
    defaults = the old inline literals 20/20/10/8/7/15/10/10); `CrawlRun.scoreBreakdown`
    nullable JSON (`{version,scorer,score,factors:[{key,label,weight,earned,possible}]}`).
    Additive migration `20260703120000_configurable_scoring_weights` (auto-applies on deploy).
  - **Scorers:** `computeHealthScore` (SF-upload) and `scoreLiveSeo` (live-scan)
    both take `weights` and return `{score, factors}`; callers resolve weights and
    persist `score` + `scoreBreakdown` from ONE call (the dead `metadata.health_score`
    precedence is removed — number and breakdown cannot disagree). Fresh DB scores
    identically to pre-C8.
  - **Module split:** `lib/scoring/weights.ts` is PURE (no prisma — client-safe);
    `lib/scoring/resolve-weights.ts` is server-only. The `/settings` card imports
    only the pure module (build-verified: no prisma in the client bundle).
  - **UI:** cookie-gated `GET/PUT /api/settings/scoring-weights` (NOT in
    `isPublicPath`; middleware-tested) + `ScoringWeightsCard` on `/settings`;
    `ScoreExplanation` panel on the SEO parser results pages (with a NEW
    health-score line — none existed before) + `OnPageSeoSection`. Archived-safe
    (reads only the breakdown scalar); pre-C8 runs show "unavailable"; live
    null-score runs render nothing.
  - **Fixed history:** a weight edit affects FUTURE scores only; existing audits
    keep their scored breakdown snapshot.
  - **Prod-verify (light, see paste-in §3):** additive migration, no env change.
- **COMPLETE 2026-07-02: A2-f1 — findings-rebuild pruned-ADA guard.** MERGED
  (PR #88, main `92d10e3`) + DEPLOYED + PROD-VERIFIED to the extent possible
  (deployed guard source present; clean boot). Behavioral rebuild-refuses check
  DEFERRED — 0 pruned targets in prod (oldest complete ADA audit 41 d old, prune
  at 90 d); guard inert until first pruned-audit rebuild (~2026-08+); covered by
  the 2 gate-green DB tests.
- **COMPLETE 2026-07-02: D0 — minimal ops safety (DB backup + failure alert).**
  PR #86 + deployed + PROD-VERIFIED. Slack webhook still unset (alerts log-only).
- **PROD-VERIFIED 2026-07-02: C6 Phase 4** (autonomous live SEO source + native
  link graph, PR #85, migration `20260630120000_live_seo_source`). C6 stays `[~]`.
- **COMPLETE 2026-07-02: C10 — SEO Performance Reports** (PR #75, PROD-VERIFIED).
- **16-skill operator library** under `.claude/skills/` (commit `57ae636`, on main).
- **A1, A2, A2-f1, B1–B5, C1–C5 DONE. C6 Phases 1–4 DONE. C10 DONE. D0 DONE. C8 BUILT.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00` (noindex → broken-link findings only,
  null score — by design).
- **⚠ PENDING HUMAN STEPS (Kevin):**
  1. **C8:** merge PR #90 → deploy → light prod-verify (see paste-in §3). Close PR
     #89 (subsumed) or merge it first + rebase #90.
  2. **D0:** set `ALERT_WEBHOOK_URL` once Slack admin approves; optional stray-backup rm.
  3. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan
     409-blocking the localStorage import — keep or delete + re-open).
  4. **First real qct_ push** not yet exercised.
  5. **Optional cleanup:** delete PillarAnalysis `cmr43gufj0001y200n9134fjp`
     (C6 Phase-4 pillar smoke artifact) if unwanted.
  6. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
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

**PENDING: PR #90 (C8) → Kevin merge/deploy/prod-verify** (light verify — additive
migration, no env change; see paste-in §3). Once verified, flip the C8 tracker
`[~]`→`[x]`, add a status-log line, rewrite this handoff.

**THEN a roadmap CHOICE.** Confirm direction with Kevin, then the full pipeline
(spec → Codex → plan → Codex → TDD → gates → PR → Kevin merges/deploys →
prod-verify). Menu:

1. **C-track:** C7 (parser consolidation + streaming parse + per-file failure
   isolation), C9 (ADA scoring v2 + poller/results-view consolidation), or further
   C6 (SEO-only scan mode — spec §9 breadcrumb; external-link verification).
2. **SF-retirement campaign Phase 1 (SF-vs-live parity)** — a MEASUREMENT stream,
   not a one-session build. Load `er-seo-tools-sf-retirement-campaign`.

## Gotchas / decisions already made (don't relitigate)

- **C8 invariants (verified against code + final opus review 2026-07-03):**
  - **Both SEO scorers share ONE global weight profile** (`ScoringWeights` id=1);
    live SEO structurally ignores `crawlDepth` (never in its denominator). Validation
    requires a positive live-eligible (non-crawlDepth) factor.
  - **Scorers stay PURE** — weights are resolved in the DB layer (`writeSeoFindings`,
    `broken-link-verify`) and passed in. `score` + `scoreBreakdown` come from ONE
    `compute*` call → cannot disagree. The `metadata.health_score` precedence is GONE.
  - **`lib/scoring/weights.ts` must stay prisma-free** (client card imports it);
    the DB read lives ONLY in `resolve-weights.ts` (server).
  - **`ScoreExplanation`:** null/malformed breakdown → "unavailable" line; empty
    factors (live null-score) → renders NOTHING; else the collapsible table. Reads
    only the scalar — archived-safe, no recompute.
  - **Fixed history:** the persisted breakdown IS the weight snapshot; edits affect
    future scores only. Historical scores are NOT recomputed.
  - **`parity.ts`** recomputes the expected score at DEFAULT weights → its `score:`
    diff line is only meaningful at default weights (structural parity is
    authoritative). Documented; a full fix (diff.service.ts moving to `CrawlRun.score`)
    is a deferred follow-up.
  - **GOTCHA (bit us twice this feature):** `tsconfig.json` EXCLUDES `*.test.ts(x)`
    from `tsc`, so a test file calling a changed signature won't fail `npm run lint`
    but WILL fail at runtime — after any signature change, grep ALL callers incl.
    tests and run the FULL vitest suite (`DATABASE_URL="file:./local-dev.db" npm test`).
- **A2-f1 invariants:** pruned signature = `status='complete'` + null `result`;
  guard in `lib/findings/ada-write.ts` (defends rebuild script + live standalone
  hook); errored/redirected audits stay ungated; behavioral prod-verify deferred
  (no pruned target until ~2026-08+).
- **Deploy protocol:** code-only changes → plain `~/deploy.sh`; ecosystem/env
  changes → `pm2 delete && pm2 start`. Prod has NO `sqlite3` CLI — drive read-only
  prod queries with a throwaway `.mjs` in the app dir using `new PrismaClient()` +
  inline `DATABASE_URL='file:/home/seo/data/seo-tools/db.sqlite'`. C8 has an
  additive migration → the deploy's `prisma migrate deploy` applies it automatically.
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`). Prod DB at
  `/home/seo/data/seo-tools/db.sqlite`.
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only.
- **Local dev quirk:** prefix prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`.
  `prisma migrate dev` is interactive-only — hand-write migration SQL, apply with
  `migrate deploy`. **vitest module mocks must use `vi.hoisted(() => ({...}))`.**
  **No global RTL auto-cleanup** — React render tests need `afterEach(cleanup)` +
  the `// @vitest-environment jsdom` pragma.
- **C6 Phase 4 invariants:** `seoIntent` is the freshness-gated canonical SEO
  signal; schedules operator-created (no self-healing); canonical selection is
  merge-state-sensitive; live score never displaces the sf-upload canonical score.
- **C10 invariants:** SERVICE-ACCOUNT auth; job group `seo-report:<id>` NEVER
  `site-audit:<id>`; monthly schedule is a NON-system operator row.
- **Handoff-token / public route gotcha (bit us THREE times):** any new
  token-authed or public route MUST get a `middleware.ts` `isPublicPath` entry +
  a `middleware.test.ts` case. (Cookie-gated routes like C8's stay OUT of
  isPublicPath but still get a middleware test asserting they're non-public.)
- Test gotchas: DB-backed tests use unique prefixes + scoped cleanup; a test that
  writes a score must reset the `ScoringWeights` singleton (`afterEach` delete id:1);
  CrawlRun-by-`siteAuditId` reads need compound `siteAuditId_tool`.
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (small bugfixes with no spec/plan are exempt).

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
- 2026-07-03 — **C8 BUILT + PR #90** (`feat/c8-configurable-scoring-weights`) —
  configurable SEO scoring weights + score-explanation panel. Spec+plan Codex-reviewed;
  subagent-driven 7-task TDD build; final opus review READY TO MERGE; gate-green
  (tsc + 2919 tests + build). Awaiting Kevin merge/deploy/prod-verify.
