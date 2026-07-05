# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-04 (Streaming parse concurrency — C7 Phase-3 payoff — MERGED+DEPLOYED+PROD-VERIFIED) · **Updated by:** the streaming-concurrency session (PR #99, main `47c5f87`). Next is a roadmap-menu choice (no single mandated item).
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: Streaming parse concurrency (the C7 Phase-3 payoff) is now MERGED +
DEPLOYED + PROD-VERIFIED (2026-07-04, PR #99, main `47c5f87`). It parallelizes
the SEO-parser CSV parse loop — unblocked by C7 pt3 streaming (bounded per-file
memory was the precondition: the roadmap said "don't parallelize parsing before
streaming it"). A near-behavior-preserving change: identical aggregated output,
only faster on multi-big-file crawls.
- What shipped: `lib/parsers/parse-limit.ts` (new) — a `Semaphore` FIFO counting
  primitive, `parseConcurrencyFromEnv` (clamps bad/0/negative/NaN → 2),
  `PARSE_CONCURRENCY` (default 2), and `mapWithConcurrency<T,R>(items, fn)` = a
  per-call worker pool over a SINGLE process-wide `Semaphore(PARSE_CONCURRENCY)`
  (results in INPUT order; caps total concurrent parses across ALL simultaneous
  uploads — global, not per-request, so two analysts uploading at once can't
  stack 2N big-file streams against the 2400M ceiling). `app/api/parse/[sessionId]
  /route.ts`: the sequential `for...of await parseOne(...)` loop swapped for
  `mapWithConcurrency(sessionFiles, parseOne)` + an ordered collection over the
  input-ordered `outcomes`. EVERYTHING from aggregator ingestion onward is
  byte-unchanged (the load-bearing ordering invariant — `mergeParserData` has
  order-sensitive latest-wins / domain-tally branches, so ingestion must stay in
  `sessionFiles` order → identical output).
- Decisions locked (don't relitigate): cap 2 env-tunable; GLOBAL/module-scoped
  semaphore (not per-request); EXCLUDED — two-tier small/big pool, memory-aware
  dynamic cap, job-queue move, new runtime dependency.
- Process caught 2 real defects mid-build: (1) plan's release-on-throw test had a
  bare `throw` in try/finally with no catch → unconditional fail (implementer
  added the catch); (2) reviewer found CRITICAL — `Math.max(1, Math.floor(NaN))
  === NaN` → `new Semaphore(NaN)` deadlocks; fixed to `Number.isFinite(size) &&
  size >= 1 ? Math.floor(size) : 1` + a clamp test. Reviewers MUTATION-TESTED the
  two load-bearing mapWithConcurrency tests (both made the right test fail).
- NO migration → deploy was plain ~/deploy.sh ("No pending migrations").
Pipeline: brainstorm (2 decisions) → spec (Codex accept-with-fixes ×8) → plan
(Codex accept-with-fixes ×8) → subagent TDD (4 tasks, every per-task review
Approved, 0 Critical/Important) → final opus whole-branch review READY TO MERGE
(0 Critical/0 Important, 2 non-blocking Minors, all 7 invariants verified vs
code). Gates: tsc · 3157 tests (334 files, +16) · build. Prod: online 0
restarts 554MB, HTTP 307, no migration, parse-limit bundled into the deployed
parse route (PARSE_CONCURRENCY env-string literal present; function names
minified — harmless, no runtime name lookup).
A2/B1–B5/C1–C10/C9(A+B)/D0 all COMPLETE + PROD-VERIFIED. C7 fully complete incl.
its Phase-3 concurrency payoff. A 16-skill operator library lives in .claude/skills/.

1. Load the skill er-seo-tools-change-control first. Gate policy (2026-07-03
   ruling, rules 1 & 4): THIS PASTED PROMPT is standing authorization to merge
   pending roadmap PRs at session start — re-run the gates (lint/test/build) on
   the PR branch in this session first — and to deploy when needed, ALWAYS
   followed immediately by post-deploy verification. Destructive server ops
   (prod data deletion, server .env edits, DB restore) stay Kevin-gated; docs
   rituals mandatory; never scan non-client sites. Brainstorm→spec→plan runs
   ungated — Kevin reviews after both artifacts are complete. Route design
   questions to Codex, not Kevin (his standing instruction this session).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state +
   next item) and docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
   (full plan). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff. Always re-map the actual code before writing a spec — the
   handoff's forward-looking scope drifts.
3. THE IMMEDIATE NEXT STEP: roadmap-menu choice (no single mandated item). Ask
   Kevin which, or pick and proceed via the full pipeline (brainstorm → spec →
   Codex → plan → Codex → subagent TDD → gates → PR → merge → deploy → verify →
   docs ritual):
   - Further C6 (SF-retirement §5 sequence): external-link verification (finish
     Phase 1 — externals harvested but not checked in v1) · hybrid discovery
     (Phase 2, the big architectural one) · reachability graph + true depth (3b)
     · content similarity (Phase 5). Load er-seo-tools-sf-retirement-campaign.
   - SF-retirement campaign Phase 1 (SF-vs-live PARITY MEASUREMENT stream).
   - Track A infra (A3 withRoute()+route tests · A4 observability floor · A5 SSE
     hook · A6 shared UI primitives · A7 auth hardening+Playwright).
   - Track D (D1 handoff-engine consolidation · D3 shared lib/seo-fetch/ · D4
     client robots/sitemap checks · D6 RankMath redirect generator).
   - Optional C9-B second pass: shared `AuditHeaderCard` slot component (deferred
     — only if a layout-only slot provably stays small; prop-bag risk).
   - Reusable real crawl for any fixture/parity need:
     /Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25
     (all exports; manhattanschool.edu is an existing client). Never scan non-client sites.
4. LIGHT PENDING behavioral verify (not blocking, all inert-until-first-case):
   - Streaming concurrency: actual concurrent-parse WALL-CLOCK on a real
     multi-big-file crawl upload (Manhattan 49-CSV export is ideal) — confirm the
     report is byte-identical to the pre-change output and parse time drops. UI is
     unchanged (parse stays synchronous). Covered by the 16 new tests.
   - C9-A: v2-SCALE on a REAL client audit — ada run carries
     `scoreBreakdown.version===2`, detail badge shows v2, an OLDER audit still
     shows its v1 number, a boundary-spanning trend renders the formula-change
     marker not a bogus delta. Weekly canary client 31 / analyst scan.
   - C9-B: UI-render check on a real ADA audit — live poller progress bar +
     elapsed/ETA (single) and pages/pdfs/lighthouse phases (site); triage toggle
     read/write; archived banner render light+dark.
   - C6-validation finding-emission on a real audit; C7 pt1 multi-file
     File-processing-panel render check.
5. Small open D0 follow-ups (not blocking): set ALERT_WEBHOOK_URL in the server
   .env once Slack admin approves; consider a BACKUP_DIR-unset warning in the
   manual scripts/db-backup.ts; two ~444 MB backups sit in
   /home/seo/data/seo-tools/backups/ (safe to rm the older one).
6. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **MERGED + DEPLOYED + PROD-VERIFIED 2026-07-04: Streaming parse concurrency (C7 Phase-3 payoff).**
  PR #99 (`47c5f87`) merged to main + deployed via plain `~/deploy.sh` (code-only,
  no migration — "No pending migrations to apply").
  - **What shipped (near-behavior-preserving — identical output, only faster):**
    - `lib/parsers/parse-limit.ts` (new) — `Semaphore` FIFO counting primitive
      (constructor clamps NaN/0/negative → 1), `parseConcurrencyFromEnv`,
      `PARSE_CONCURRENCY` (default 2), `mapWithConcurrency<T,R>(items, fn)` = a
      per-call worker pool over ONE process-wide `Semaphore(PARSE_CONCURRENCY)`;
      results in input order; `Promise.allSettled` → settle-before-reject.
    - `app/api/parse/[sessionId]/route.ts` — sequential loop → `mapWithConcurrency`
      + ordered collection; aggregator ingestion onward byte-unchanged.
    - `PARSE_CONCURRENCY` documented in the config-and-flags skill.
  - **Key invariants (verified by the final opus whole-branch review + prod):**
    - Ordering: parse execution concurrent, aggregator ingestion in `sessionFiles`
      order → byte-identical aggregated output (mapWithConcurrency returns
      input-ordered results; nothing after the ingestion loop changed).
    - Process-wide cap: exactly one module-level Semaphore shared across all
      requests (sound only under single-PM2-process — documented).
    - Semaphore/worker-pool correct (no leak/lost-wakeup/skip/double-process);
      no behavior change beyond parallelism; no minification/`Class.name` risk.
  - **This session:** full pipeline start→ship. Spec Codex-reviewed (accept-with-
    fixes ×8), plan Codex-reviewed (accept-with-fixes ×8). Subagent-driven build
    (4 tasks, every per-task review Approved; sonnet impl/review, opus final).
    Process caught 2 real defects (bare-throw test; `Math.max(1,NaN)` deadlock).
  - **Gate-green in-session:** tsc clean · **3157 tests (334 files, +16)** · build clean.
  - **Post-deploy verification:** app online, 0 restarts, 554 MB, HTTP 307, "No
    pending migrations", deployed commit `47c5f87`, parse-limit bundled into the
    deployed parse route. Behavioral wall-clock check pends the next real
    multi-file upload — inert-until-exercised, covered by tests.
  - Spec: `docs/superpowers/archive/specs/2026-07-04-streaming-parse-concurrency-design.md` ·
    Plan: `docs/superpowers/archive/plans/2026-07-04-streaming-parse-concurrency.md` (both archived).
- **A1, A2, A2-f1, B1–B5, C1–C10, C9(A+B), D0 all COMPLETE + PROD-VERIFIED.**
  C7 fully complete including its Phase-3 concurrency payoff.
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. Where the C9-A v2-scale + C9-B UI-render
  + C6-validation behavioral prod-verifies will naturally land.
- **⚠ PENDING HUMAN STEPS (Kevin), none blocking:**
  1. **Streaming-concurrency wall-clock check (light):** upload a real multi-big-file
     crawl (Manhattan 49-CSV) → confirm byte-identical report + faster parse.
  2. **C9-A v2-scale check (light):** next real client audit — `scoreBreakdown.version===2`,
     v2 badge, older audit still v1, boundary trend shows formula-change marker not a delta.
  3. **C9-B UI-render check (light):** live poller progress, triage toggle, archived banner light+dark.
  4. **C6 validation behavioral prod-verify (light):** canonical/redirect/hreflang findings
     on a real audit's live-scan run.
  5. **C7 pt1 functional panel-render check (light):** multi-file crawl upload → File-processing
     panel buckets render (light+dark) + backward-compat.
  6. **D0:** set `ALERT_WEBHOOK_URL` once Slack admin approves; optional stray-backup rm.
  7. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan 409-blocking the
     localStorage import — keep or delete + re-open).
  8. **First real qct_ push** not yet exercised.
  9. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
- **Blocked / gated:** Anthropic API billing; sitemap miss-rate measurement not yet run;
  daily/nightly cadences still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups:** C9-B optional second pass (shared `AuditHeaderCard` slot component —
  only if it provably stays small); C9-A's deferred site-level v2-compliance rollup + a
  per-row list/recents v2 badge; C6 content similarity (Phase 5) / external-link verification
  (finish Phase 1) / hybrid discovery (Phase 2) / reachability graph + true depth (3b) /
  daily-cadence supersede-trimming; C7 pt1 "corrupt-but-parseable core" detection;
  `trackDomain` per-row `findColumn` micro-opt; C8 diff.service.ts score-source migration +
  draft-weights preview; D0 off-box backup replication; standalone single-page audit
  CSV/VPAT/report; public share-page export buttons; expandable rows on public ADA share view;
  logo for the PDF; `SessionPage` model drop (≥180 d after 2026-06-11); same-URL standalone-audit
  diffing; fleet instance-level diffing; B2 v1 multi-domain limitation; SF-retirement campaign
  Phase 1; A3–A7 infra track; D1–D6 workflow-polish track.

## Next item

**No single mandated item — the streaming-concurrency follow-up is fully shipped.**
Pick from the roadmap menu (ask Kevin or choose) and run the full pipeline:
- **Further C6** — external-link verification (finish Phase 1) / hybrid discovery
  (Phase 2, the big architectural one) / reachability graph (3b) / content similarity (Phase 5).
- **SF-retirement Phase 1** — SF-vs-live PARITY MEASUREMENT (load `er-seo-tools-sf-retirement-campaign`).
- **Track A infra** — A3 withRoute()+route tests / A4 observability floor / A5 SSE / A6 UI primitives / A7 auth+Playwright.
- **Track D** — D1 handoff-engine consolidation / D3 shared lib/seo-fetch/ / D4 client robots-sitemap checks / D6 RankMath generator.
- **C9-B second pass (optional)** — shared `AuditHeaderCard` slot; only if it stays small.

## Gotchas / decisions already made (don't relitigate)

- **Streaming-concurrency decisions (locked 2026-07-04):** cap 2, env `PARSE_CONCURRENCY`,
  clamped ≥ 1 (bad/0/negative/NaN → 2); **GLOBAL/module-scoped** semaphore (one per process,
  shared across all uploads — NOT per-request); worker-pool driver (NOT enqueue-all — avoids
  cross-request head-of-line starvation); `Promise.allSettled` settle-before-reject contract
  (moot in practice — `parseOne` never rejects, funnels errors into `FileOutcome`); the
  **ordering invariant is load-bearing** (aggregator ingestion must stay in `sessionFiles`
  order — `mergeParserData` has order-sensitive latest-wins/domain-tally branches); EXCLUDED —
  two-tier small/big pool, memory-aware dynamic cap, job-queue move, new runtime dependency.
- **`Math.max(1, NaN) === NaN`** — a clamp that must guard against NaN needs
  `Number.isFinite(x) && x >= 1 ? … : 1`, not `Math.max`. (Cost us a CRITICAL review finding
  on the Semaphore constructor; fixed.)
- **The handoff's forward-looking scope drifts — re-map the code first.** Before writing any
  spec, dispatch an Explore/read pass over the actual code; trust code > handoff.
- **C9-A/C9-B/streaming-concurrency all changed NO injected-into-page code** → no
  minification-survival check needed. `parseSeoFromDocument` is `.toString()`-injected and MUST
  stay SWC-helper-free (no `typeof`); verify at es2017 on the BUILT bundle only when you touch it.
- **Never rely on `Class.name`/function names at runtime** (SWC minifies them). Streaming
  concurrency uses zero runtime name lookups (imports resolve by binding) — that's why its
  minified bundle is fine even though `mapWithConcurrency` doesn't appear by name.
- **How the SEO health score works:** WEIGHTED COVERAGE RATIO across ~8 factors, NOT a
  count of SF issues. (ADA score is separate — v1 in `scoring.ts`, v2 in `scoring-v2.ts`.)
- **Deploy protocol:** code-only / config-only (incl. `next.config.ts`) → plain `~/deploy.sh`;
  `ecosystem.config.js`/env changes → `pm2 delete && pm2 start`. Prod has NO `sqlite3` CLI —
  drive read-only prod queries with a throwaway `.mjs` IN THE APP DIR using `new PrismaClient()`
  + inline `DATABASE_URL='file:/home/seo/data/seo-tools/db.sqlite'`.
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`); prod DB `/home/seo/data/seo-tools/db.sqlite`;
  prod URL `https://seo.erstaging.site`.
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ. (The
  streaming-concurrency process-wide cap ASSUMES this single-process model.)
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only.
- **Never `git add -A` at repo root** — `pentest-results/`, `googlefc472dc61896519a.html`,
  `SEO_Report_1st_Draft.pdf` are untracked + not gitignored. Add specific paths only.
- **Local dev quirk:** prefix prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`.
  React render tests need `afterEach(cleanup)` + `// @vitest-environment jsdom`; parser/node
  tests use `// @vitest-environment node`. `tsc --noEmit` (= `npm run lint`) has NO
  `noUnusedLocals`, so unused imports don't fail lint (but it DOES error on use-of-undefined).
- **Handoff-token / public route gotcha (bit us THREE times):** any new token-authed or public
  route MUST get a `middleware.ts` `isPublicPath` entry + a `middleware.test.ts` case.
  (Streaming concurrency added no routes.)
- **Codex session for this workspace:** `019f2b57-...` (registry `~/.claude/state/codex-consultations.json`).
  If a resumed Codex answer looks off-topic, `--fresh`.
- **SDD progress ledger** (`.superpowers/sdd/progress.md`) is git-ignored scratch and is
  OVERWRITTEN each feature; per-task report files (`.superpowers/sdd/task-N-report.md`) get
  REUSED across cycles — tell implementers to OVERWRITE, not append, and don't trust a report
  file's provenance without checking.

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, handoff created.
- 2026-06-10 — A1 Phases 0–4 (PRs #50–#54), prod-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), prod-verified. **A2 COMPLETE.**
- 2026-06-11 — B1–B5 (#60–#64 + middleware fix) shipped + prod-verified. **TRACK B COMPLETE.**
- 2026-06-11/12 — C1 (#65), C2 (#66), C3 (#67), C4 (#68), C5 (#69) SHIPPED.
- 2026-06-16/17 — C6 Phases 1–3 (#70, #71, #73) SHIPPED + prod-verified.
- 2026-06-22 — C10 (#75) + build-heap fix (#76), deployed, migration applied.
- 2026-06-30 — C6 Phase 4 (autonomous live SEO source) BUILT.
- 2026-07-02 — Skill library SHIPPED (`57ae636`). C6 Phase 4 MERGED+DEPLOYED (#85)+VERIFIED.
  C10 PROD-VERIFIED (COMPLETE). D0 SHIPPED (#86)+DEPLOYED+VERIFIED (COMPLETE).
  A2-f1 MERGED+DEPLOYED+PROD-VERIFIED. **A2-f1 COMPLETE.**
- 2026-07-03 — **C8 BUILT+MERGED (#90)+DEPLOYED+PROD-VERIFIED = COMPLETE.** Upload hotfix **PR #91**.
- 2026-07-03 — **C7 (all 3 parts) MERGED (#93/#94/#95) + DEPLOYED + PROD-VERIFIED = COMPLETE.**
- 2026-07-03 — **C6 SF-retirement Phase 4 (redirect/canonical/hreflang validation) MERGED (#96, `270b81f`)
  + DEPLOYED + PROD-VERIFIED.**
- 2026-07-04 — **C9-A (ADA Scoring v2) MERGED (#97, `6e9bb55`) + DEPLOYED + PROD-VERIFIED.**
- 2026-07-04 — **C9-B (ADA-audit frontend consolidation) MERGED (#98, `c082868`) + DEPLOYED +
  PROD-VERIFIED. C9 COMPLETE (both halves).**
- 2026-07-04 — **Streaming parse concurrency (C7 Phase-3 payoff) MERGED (#99, `47c5f87`) + DEPLOYED +
  PROD-VERIFIED.** `lib/parsers/parse-limit.ts` (`Semaphore` + `mapWithConcurrency` worker-pool over
  ONE process-wide semaphore); parse route loop parallelized, aggregator ingestion stays file-ordered
  (byte-identical output). Spec+plan Codex-reviewed (8 fixes each); subagent-TDD (4 tasks); final opus
  review READY TO MERGE (0 Critical/Important, all 7 invariants verified). Process caught 2 real defects
  (bare-throw test; `Math.max(1,NaN)` deadlock). Gates: tsc + 3157 tests (+16) + build. No migration.
  Next: roadmap menu (further C6 / SF-retirement Phase 1 / A- or D-track infra).
```
