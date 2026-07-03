# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-03 (C7 pt2 built) · **Updated by:** C7 pt1 MERGED (#93) + DEPLOYED (prod-verify pending Kevin); **C7 part 2 (parser consolidation) BUILT + PR #94** (`feat/c7-parser-consolidation`), gate-green, all reviews passed = READY TO MERGE. Part 3 (streaming) NOT started.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: Roadmap choice = C7 (parser consolidation + streaming + per-file failure
isolation), DECOMPOSED into 3 independent PRs, order: isolation → consolidation →
streaming.
- PART 1 (per-file parse reporting): MERGED (PR #93) + DEPLOYED. Prod-verify still
  PENDING Kevin (fixtures + checklist were provided). KEY FINDING: the corrupt-CSV
  core-failure banner is NOT reachable by uploading a corrupt CSV — Papa.parse +
  the parsers tolerate corruption and DEGRADE (land in "parsed"), never throw; the
  banner/failed bucket is unit-test-covered only. So pt1's "worst case" (corrupt
  core export → silently bad score) is only closed for the throwing subset. The
  achievable prod-verify = parsed/unmatched/skipped buckets render (light+dark) +
  backward-compat (a pre-C7 session still renders).
- PART 2 (parser consolidation): BUILT + PR #94 (feat/c7-parser-consolidation).
  Behavior-preserving refactor: two declarative bases — LengthValidatorParser
  (pageTitles/meta/h1/h2) + ResourceFileParser (css/js/pdf) — as thin config-bearing
  subclasses; images/links stay bespoke. Golden characterization suite written FIRST
  (full toEqual, all 7 incl. h2/css/js/pdf which had NO tests) stays green through the
  refactor; explicit literal parserKey per subclass (minification landmine); NO
  migration/env/middleware/scoring/findings change; net -417 LOC source. Spec+plan
  Codex-reviewed, subagent-built (5 tasks), final opus review = READY TO MERGE (0
  Critical/Important, all 5 invariants hold). Gate-green: tsc + 2968 tests (312
  files) + build. NOT merged/deployed/prod-verified.
C8 + upload hotfix (#90/#91) + A2-f1 + D0 + C6 Phase 4 + C10 all COMPLETE +
PROD-VERIFIED. A 16-skill operator library lives in .claude/skills/.

1. Load the skill er-seo-tools-change-control first (hard gates: no merge/
   deploy/server mutation without Kevin's explicit go IN THIS conversation; docs
   rituals mandatory; never scan non-client sites).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state +
   next item) and docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
   (full plan). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff.
3. THE IMMEDIATE NEXT STEP:
   - PR #94 (pt2): Kevin merges → deploys (plain ~/deploy.sh, code-only, no
     migration/env) → prod-verify (upload a real SF crawl for a CLIENT/STAGING site
     incl. page-titles/meta/H1/H2/CSS/JS/PDF exports; confirm on-page + resource
     issues render identically to a pre-refactor run — same counts/severities/groups;
     a pre-C7 archived session still renders). Also finish pt1's prod-verify (upload
     the provided fixtures; confirm the File-processing panel buckets + light/dark +
     backward-compat). Then tick C7-pt1 & pt2 in the tracker + rewrite this handoff.
   - Once pt2 is verified: START C7 PART 3 (streaming parse — the memory/OOM piece)
     via the full pipeline (spec → Codex → plan → Codex → subagent TDD → gates → PR).
     Roadmap warns: do NOT parallelize parsing before streaming it. Part 3 will
     touch the now-consolidated bases; two DEFERRED Minor golden-coverage gaps to
     close then: the mask-fallback branch + a nonzero excluded_urls case.
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

- **BUILT (awaiting merge) 2026-07-03: C7 part 2 — parser consolidation.** PR #94
  (`feat/c7-parser-consolidation`). Behavior-preserving refactor.
  - **What shipped:** `LengthValidatorParser` (`lib/parsers/seoElements/length-validator.base.ts`)
    absorbs pageTitles/meta/h1/h2; `ResourceFileParser` (`lib/parsers/resources/resource-file.base.ts`)
    absorbs css/js/pdf. Each parser is now a ~12-line thin subclass: explicit static
    `parserKey` literal + `filenamePattern` + a config object. images/links stay
    bespoke (verified genuinely non-homogeneous). Net −417 LOC source.
  - **Safety net:** golden characterization tests (`*.golden.test.ts`) written FIRST
    against pre-refactor code — full `toEqual`, all 7 parsers incl. h2/css/js/pdf
    which had NO test file before — stayed green through the refactor. Plus base
    unit tests. Explicit literal `parserKey` per subclass (2026-06-02 minification
    landmine); `parser-key.test.ts` green.
  - **Safety:** NO migration/env/middleware/scoring/findings change. index.ts/PARSER_MAP/
    aggregator/parse-route untouched.
  - **Reviews:** spec + plan Codex-reviewed (fixes applied); 5 per-task spec+quality
    reviews (all Approved); final opus whole-branch review = READY TO MERGE, 0
    Critical/Important, all 5 cross-task invariants HOLD. 2 Minors DEFER to part 3
    (mask-fallback branch + nonzero `excluded_urls` never pinned — verbatim shared
    logic, not parity risks).
  - Gate-green: tsc + **2968 tests** (312 files) + build.
  - Spec: `docs/superpowers/specs/2026-07-03-parser-consolidation-design.md` ·
    Plan: `docs/superpowers/plans/2026-07-03-parser-consolidation.md` (both stay in
    active folders until C7 fully ships).
- **MERGED + DEPLOYED (prod-verify pending) 2026-07-03: C7 part 1 — per-file parse
  reporting.** PR #93 merged (`23847af`) + deployed. Structured `metadata.file_reports`
  (parsed/failed/unmatched/skipped + core/normal severity), `FileProcessingPanel`,
  core-failure banner, drops `parsing_errors`.
  - **Prod-verify finding (important):** the corrupt-CSV core-failure banner is NOT
    upload-reachable — verified against the real route logic that no realistic CSV
    corruption makes a core parser THROW (Papa + the parsers are tolerant → degrade
    to a `parsed` result). The banner/`failed`-bucket path is unit-test-covered
    (mocked throws) only. Achievable prod-verify = parsed/unmatched/skipped buckets
    render (light+dark) + a pre-C7 session still renders. The "corrupt-but-parseable
    core export → silently degraded score" case is a candidate follow-up (detect a
    core export that parsed 0 usable rows) — arguably part 2/3 or a small pt1.5.
- **COMPLETE 2026-07-03: C8** (PR #90) + upload hotfix (#91) — deployed + prod-verified.
- **COMPLETE 2026-07-02: A2-f1** (#88), **D0** (#86), **C6 Phase 4** (#85), **C10** (#75).
- **A1, A2, A2-f1, B1–B5, C1–C5 DONE. C6 Phases 1–4 DONE. C8 DONE. C10 DONE. D0 DONE.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00` (noindex → broken-link findings only, null score).
- **⚠ PENDING HUMAN STEPS (Kevin):**
  1. **PR #94 (C7 pt2):** merge → deploy → prod-verify (see paste-in step 3).
  2. **PR #93 (C7 pt1):** finish prod-verify (fixtures + checklist provided).
  3. **D0:** set `ALERT_WEBHOOK_URL` once Slack admin approves; optional stray-backup rm.
  4. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan 409-blocking the
     localStorage import — keep or delete + re-open).
  5. **First real qct_ push** not yet exercised.
  6. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
- **Blocked / gated:** Anthropic API billing; sitemap miss-rate measurement not yet run;
  daily/nightly cadences still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups:** C7 part 3 (streaming); pt1 "corrupt-but-parseable core" detection;
  C7 pt2 deferred Minors (mask-fallback + nonzero excluded_urls golden coverage);
  C8 diff.service.ts score-source migration + draft-weights preview; D0 off-box backup
  replication; C6 SEO-only scan mode / external-link verification / redirect-canonical-hreflang
  validation / content similarity / daily-cadence supersede-trimming; standalone single-page
  audit CSV/VPAT/report; public share-page export buttons; expandable rows on public ADA
  share view; logo for the PDF; `SessionPage` model drop (≥180 d after 2026-06-11); same-URL
  standalone-audit diffing; fleet instance-level diffing; B2 v1 multi-domain limitation;
  SF-retirement campaign Phase 1.

## Next item

**Gated on PR #94 & #93.** Immediate: Kevin merges/deploys/prod-verifies C7 pt2 (parser
consolidation) and finishes pt1's prod-verify. Once pt2 is verified, START **C7 part 3
(streaming parse)** via the full pipeline — the memory/OOM piece; roadmap warns do NOT
parallelize before streaming; it will touch the now-consolidated bases (close the 2
deferred golden-coverage Minors then). If Kevin redirects: C9, further C6, or
SF-retirement Phase 1.

## Gotchas / decisions already made (don't relitigate)

- **C7 is decomposed into 3 PRs, order isolation→consolidation→streaming** (Kevin 2026-07-03).
- **C7 pt2 decisions (locked 2026-07-03):** roadmap-literal scope (only the two named bases);
  in-code config objects (NO DB/migration); thin subclasses (keep class-per-parser so
  PARSER_MAP + existing tests are the parity net and each `parserKey` stays a literal);
  images + links stay bespoke (genuinely not the css/js/pdf or on-page pattern).
- **C7 pt2 invariants (verified against code + final opus review 2026-07-03):**
  - Byte-identical `parse()` output; check order pinned in the bases (missing→length→
    duplicate→multiple; large→broken); the golden suite (full `toEqual`) is the parity net.
  - Explicit literal `parserKey` per subclass; the two bases declare NO `parserKey`
    (inherit `''` from BaseParser) and are NOT registered → the minification guard never
    inspects them; `findParserForFile`/PARSER_MAP/parse-route untouched (transparent).
  - Config accessor: `protected abstract readonly config` on the base, concrete
    `protected readonly config = {…}` on each subclass; `import { Base, type BaseConfig }`.
    No init-order hazard (BaseParser ctor runs only parseCSV; config read only in parse()).
  - Duplicate group object: `{ [groupValueKey]: value.slice(0,slice), count, urls }`
    (`as Issue['groups']` cast — runtime-inert).
- **C7 pt1 invariants:** `file_reports` is DISPLAY-ONLY on `metadata` (aggregation reads a
  separate `successes[]`); `isCoreExport(filename)` = matches ≥1 tier:'core' export AND 0
  non-core; `skipped` = non-`.csv`; backward-compat (no `file_reports` → legacy summary);
  archived (`result.archived`) → panel null; `parsing_errors` fully removed; `file_reports`
  stripped from the Claude memo export but kept in raw JSON. **Test gotcha:** the parse
  route.test.ts gate block's `afterEach(vi.restoreAllMocks())` STRIPS `.mockResolvedValue()`
  off inline `vi.fn()` mocks in a `vi.mock` factory → pillar-trigger mock must be a NAMED
  handle reconfigured in `beforeEach`.
- **How the SEO health score works:** WEIGHTED COVERAGE RATIO across ~8 factors, NOT a
  count of SF issues. A factor joins the denominator only when its input exists.
- **Upload body caps (PR #91):** `/api/upload` is middleware-matched → Next.js's
  `experimental.middlewareClientMaxBodySize` ('100mb') is the REAL gate — truncates, not 413.
- **C8 invariants:** both SEO scorers share ONE `ScoringWeights` id=1; scorers stay PURE;
  `lib/scoring/weights.ts` must stay prisma-free; persisted `CrawlRun.scoreBreakdown` IS the
  weight snapshot; `parity.ts` recomputes at DEFAULT weights.
- **Deploy protocol:** code-only / config-only (incl. `next.config.ts`) → plain `~/deploy.sh`;
  `ecosystem.config.js`/env changes → `pm2 delete && pm2 start`. Prod has NO `sqlite3` CLI —
  drive read-only prod queries with a throwaway `.mjs` IN THE APP DIR using `new PrismaClient()`
  + inline `DATABASE_URL='file:/home/seo/data/seo-tools/db.sqlite'`.
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`); prod DB `/home/seo/data/seo-tools/db.sqlite`;
  prod URL `https://seo.erstaging.site`.
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only.
- **Local dev quirk:** prefix prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`.
  `prisma migrate dev` is interactive-only — hand-write migration SQL, apply with `migrate deploy`.
  React render tests need `afterEach(cleanup)` + `// @vitest-environment jsdom`; parser/node
  tests use `// @vitest-environment node`.
- **C6 Phase 4 invariants:** `seoIntent` is the freshness-gated canonical SEO signal; schedules
  operator-created (no self-healing); canonical selection is merge-state-sensitive; live score
  never displaces the sf-upload canonical score.
- **C10 invariants:** SERVICE-ACCOUNT auth; job group `seo-report:<id>` NEVER `site-audit:<id>`;
  monthly schedule is a NON-system operator row.
- **Handoff-token / public route gotcha (bit us THREE times):** any new token-authed or public
  route MUST get a `middleware.ts` `isPublicPath` entry + a `middleware.test.ts` case. (C7 pt1
  and pt2 added no routes.)
- Codex reviews: route new specs/plans through Codex per Kevin's standing instruction.

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
- 2026-07-03 — **C7 DECOMPOSED (3 PRs); part 1 (per-file parse reporting) BUILT + PR #93** →
  MERGED (`23847af`) + DEPLOYED (prod-verify pending — banner not upload-reachable, unit-covered).
- 2026-07-03 — **C7 part 2 (parser consolidation) BUILT + PR #94.** Spec+plan Codex-reviewed,
  subagent-built (5 tasks), final opus review = READY TO MERGE. Gate-green (tsc + 2968 tests +
  build). Awaiting Kevin merge/deploy/prod-verify. Part 3 (streaming) NOT started.
