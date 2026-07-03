# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-03 (C7 pt2 merged+deployed+verified) · **Updated by:** C7 part 2 (parser consolidation) MERGED (PR #94, `6b0900d`) + DEPLOYED + fully VERIFIED (real-crawl byte-identical parity + prod minification-survival + gates). C7 part 3 (streaming) is the next build. C7 stays `[~]`.
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
- PART 1 (per-file parse reporting): MERGED (PR #93) + DEPLOYED. Functional
  fixture-upload render check (the File-processing panel) still light-pending —
  needs a multi-file upload through the app; buckets are unit-covered. KEY FINDING:
  the corrupt-CSV core-failure banner is NOT upload-reachable — Papa.parse + the
  parsers tolerate corruption and DEGRADE (land in "parsed"), never throw; the
  banner/failed bucket is unit-test-covered only.
- PART 2 (parser consolidation): MERGED (PR #94, `6b0900d`) + DEPLOYED + fully
  VERIFIED 2026-07-03. Behavior-preserving refactor: two declarative bases —
  LengthValidatorParser (pageTitles/meta/h1/h2) + ResourceFileParser (css/js/pdf) —
  as thin config-bearing subclasses; images/links stay bespoke; net -417 LOC source;
  NO migration/env/middleware/scoring/findings change. Gate-green re-run in-session
  (tsc + 2968 tests / 312 files + build). VERIFIED three ways: (1) real-crawl parity —
  piped a fresh manhattanschool.edu SF export (49 CSVs) through the full parse
  pipeline on pre-refactor (worktree at 175dab8^) vs post-refactor code, output
  BYTE-IDENTICAL; (2) prod minification-survival — deployed bundle preserves all 7
  parserKey literals, constructor.name only in framework code (2026-06-02 landmine
  disarmed); (3) app online 0 restarts post-deploy.
C8 + upload hotfix (#90/#91) + A2-f1 + D0 + C6 Phase 4 + C10 all COMPLETE +
PROD-VERIFIED. A 16-skill operator library lives in .claude/skills/.

1. Load the skill er-seo-tools-change-control first. Gate policy (2026-07-03
   ruling, rules 1 & 4): THIS PASTED PROMPT is standing authorization to merge
   pending roadmap PRs at session start — re-run the gates (lint/test/build) on
   the PR branch in this session first — and to deploy when needed, ALWAYS
   followed immediately by post-deploy verification. Destructive server ops
   (prod data deletion, server .env edits, DB restore) stay Kevin-gated; docs
   rituals mandatory; never scan non-client sites. Brainstorm→spec→plan runs
   ungated — Kevin reviews after both artifacts are complete.
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state +
   next item) and docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
   (full plan). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff.
3. THE IMMEDIATE NEXT STEP: START C7 PART 3 (streaming parse — the memory/OOM
   piece) via the full pipeline (spec → Codex → plan → Codex → subagent TDD →
   gates → PR). Roadmap warns: do NOT parallelize parsing before streaming it.
   Part 3 will touch the now-consolidated bases (LengthValidatorParser +
   ResourceFileParser); close the two DEFERRED Minor golden-coverage gaps then:
   the mask-fallback branch + a nonzero excluded_urls case.
   - Reusable crawl: a fresh full manhattanschool.edu SF export lives at
     /Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25
     (all exports incl. page_titles/meta/h1/h2/css/js/pdf). Use it whenever a real
     crawl is needed (parity runs, streaming fixtures, pt1's fixture-render check).
   - LIGHT PENDING (not blocking part 3): pt1's functional File-processing-panel
     render check — needs a multi-file upload through the app (local dev or prod).
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

- **MERGED + DEPLOYED + VERIFIED 2026-07-03: C7 part 2 — parser consolidation.**
  PR #94 (`6b0900d`) merged to main + deployed via plain `~/deploy.sh` (code-only,
  no migration/env). Behavior-preserving refactor.
  - **What shipped:** `LengthValidatorParser` (`lib/parsers/seoElements/length-validator.base.ts`)
    absorbs pageTitles/meta/h1/h2; `ResourceFileParser` (`lib/parsers/resources/resource-file.base.ts`)
    absorbs css/js/pdf. Each parser is now a thin subclass: explicit static
    `parserKey` literal + `filenamePattern` + a config object. images/links stay
    bespoke (verified genuinely non-homogeneous). Net −417 LOC source.
  - **This session:** PR #94 arrived `CONFLICTING` (pt1's merge + the gate-policy
    amendment both touched the tracker/handoff on main). Merged `origin/main` in,
    resolved the two docs-only conflicts (kept both status-log entries; handoff
    took the pt2-advanced HEAD), pushed → `MERGEABLE`/`CLEAN`. Re-ran all three
    gates in-session on the merged branch: tsc clean, 2968 tests (312 files) green,
    build clean. Merged (autonomous per the 2026-07-03 gate policy) + deployed.
  - **Verification (all three passed):**
    1. **Real-crawl functional parity** — Kevin supplied a fresh manhattanschool.edu
       SF export (`.../sf-crawls/manhattan/2026.07.03.11.29.25`, 49 CSVs). Piped
       every CSV through the full parse pipeline (`findParserForFile`→`parse()`) on
       pre-refactor code (bespoke, worktree at `175dab8^`) vs post-refactor (main)
       and diffed: **byte-identical** (370,580 B each, `diff` clean) across all
       parsers. The 7 consolidated parsers produced correct keys + sensible counts
       (pagetitles 3, metadescription 2, h1 2, h2 1, css 1, js 0, pdf 0). This is
       stronger than the golden fixtures and covers the real-data paths the two
       deferred Minors don't. Since PARSER_MAP/aggregator/route/UI are provably
       untouched, the parity runner covers the entire changed surface.
    2. **Prod minification-survival** — deployed `.next/server` bundle preserves all
       7 `parserKey` literals (string literals are never minified); `constructor.name`
       occurs only in framework/library code (Error-subclass naming, Node `util`/
       `assert` formatting), never the parser/aggregator path. The 2026-06-02
       minification landmine is confirmed disarmed in prod.
    3. **App health** — online, 0 restarts, 426 MB (well under the 2400M ceiling),
       307 = expected OAuth redirect.
  - **Reviews:** spec + plan Codex-reviewed (fixes applied); 5 per-task spec+quality
    reviews (all Approved); final opus whole-branch review = READY TO MERGE, 0
    Critical/Important, all 5 cross-task invariants HELD. 2 Minors DEFER to part 3
    (mask-fallback branch + nonzero `excluded_urls` never golden-pinned).
  - Spec: `docs/superpowers/specs/2026-07-03-parser-consolidation-design.md` ·
    Plan: `docs/superpowers/plans/2026-07-03-parser-consolidation.md` (both stay in
    active folders until C7 fully ships — part 3 still pending).
- **MERGED + DEPLOYED (functional panel-render verify light-pending) 2026-07-03:
  C7 part 1 — per-file parse reporting.** PR #93 merged (`23847af`) + deployed.
  Structured `metadata.file_reports` (parsed/failed/unmatched/skipped + core/normal
  severity), `FileProcessingPanel`, core-failure banner, drops `parsing_errors`.
  - **Prod-verify finding (important):** the corrupt-CSV core-failure banner is NOT
    upload-reachable — no realistic CSV corruption makes a core parser THROW (Papa +
    the parsers degrade to a `parsed` result). The banner/`failed`-bucket path is
    unit-test-covered (mocked throws) only. Achievable functional render-verify =
    parsed/unmatched/skipped buckets render (light+dark) + a pre-C7 session renders;
    needs a multi-file upload through the app (the Manhattan crawl now available).
- **COMPLETE 2026-07-03: C8** (PR #90) + upload hotfix (#91) — deployed + prod-verified.
- **COMPLETE 2026-07-02: A2-f1** (#88), **D0** (#86), **C6 Phase 4** (#85), **C10** (#75).
- **A1, A2, A2-f1, B1–B5, C1–C5 DONE. C6 Phases 1–4 DONE. C8 DONE. C10 DONE. D0 DONE.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00` (noindex → broken-link findings only, null score).
- **⚠ PENDING HUMAN STEPS (Kevin):**
  1. **C7 pt1 functional panel-render check (light):** upload a multi-file crawl
     through the app; confirm the File-processing panel buckets render (light+dark) +
     backward-compat (a pre-C7 session still renders). Not blocking part 3.
  2. **D0:** set `ALERT_WEBHOOK_URL` once Slack admin approves; optional stray-backup rm.
  3. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan 409-blocking the
     localStorage import — keep or delete + re-open).
  4. **First real qct_ push** not yet exercised.
  5. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
- **Blocked / gated:** Anthropic API billing; sitemap miss-rate measurement not yet run;
  daily/nightly cadences still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups:** pt1 "corrupt-but-parseable core" detection; C7 pt2 deferred
  Minors (mask-fallback + nonzero excluded_urls golden coverage — close in part 3);
  C8 diff.service.ts score-source migration + draft-weights preview; D0 off-box backup
  replication; C6 SEO-only scan mode / external-link verification / redirect-canonical-hreflang
  validation / content similarity / daily-cadence supersede-trimming; standalone single-page
  audit CSV/VPAT/report; public share-page export buttons; expandable rows on public ADA
  share view; logo for the PDF; `SessionPage` model drop (≥180 d after 2026-06-11); same-URL
  standalone-audit diffing; fleet instance-level diffing; B2 v1 multi-domain limitation;
  SF-retirement campaign Phase 1.

## Next item

**Immediate (build):** START **C7 part 3 (streaming parse)** — the memory/OOM piece —
via the full pipeline (spec → Codex → plan → Codex → subagent-driven TDD → gates → PR).
Roadmap warns: do NOT parallelize parsing before streaming it. Part 3 touches the
now-consolidated bases (`LengthValidatorParser` + `ResourceFileParser`); close the two
deferred golden-coverage Minors then (mask-fallback branch + nonzero `excluded_urls`).
A reusable fresh Manhattan SF crawl is at
`/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25` for
fixtures/parity. If Kevin redirects: C9, further C6, or SF-retirement Phase 1.

## Gotchas / decisions already made (don't relitigate)

- **C7 is decomposed into 3 PRs, order isolation→consolidation→streaming** (Kevin 2026-07-03).
- **Reusable real crawl:** `/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25`
  — fresh (2026-07-03) full manhattanschool.edu SF export, all CSVs. manhattanschool.edu is an
  existing client (used in C6 prod verification). Use it for any crawl need; don't scan non-client sites.
- **C7 pt2 decisions (locked 2026-07-03):** roadmap-literal scope (only the two named bases);
  in-code config objects (NO DB/migration); thin subclasses (keep class-per-parser so
  PARSER_MAP + existing tests are the parity net and each `parserKey` stays a literal);
  images + links stay bespoke (genuinely not the css/js/pdf or on-page pattern).
- **C7 pt2 invariants (verified against code + final opus review + prod bundle + real-crawl parity 2026-07-03):**
  - Byte-identical `parse()` output — PROVEN on the real Manhattan crawl (pre vs post = identical).
    Check order pinned in the bases (missing→length→duplicate→multiple; large→broken).
  - Explicit literal `parserKey` per subclass; the two bases declare NO `parserKey`
    (inherit `''` from BaseParser) and are NOT registered → the minification guard never
    inspects them; `findParserForFile`/PARSER_MAP/parse-route untouched. CONFIRMED in the
    deployed bundle: all 7 key literals survive SWC minification; no `constructor.name`
    derivation in the parser path.
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
  tests use `// @vitest-environment node`. A quick parser parity/smoke script runs via
  `npx tsx <file>.ts` (NOT `.mts` — the barrel export interop fails under strict ESM).
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
  MERGED (`23847af`) + DEPLOYED (functional panel-render verify light-pending — banner not upload-reachable, unit-covered).
- 2026-07-03 — **C7 part 2 (parser consolidation) BUILT + PR #94** → **MERGED (`6b0900d`) + DEPLOYED
  + fully VERIFIED.** Spec+plan Codex-reviewed, subagent-built (5 tasks), final opus review = READY
  TO MERGE. Gate-green re-run in-session (tsc + 2968 tests + build). Verified three ways: real-crawl
  byte-identical parity (pre vs post over a fresh 49-CSV Manhattan export), prod minification-survival
  (7 parserKey literals preserved, no name-derivation in the parser path), app health. Part 3
  (streaming) NEXT.
