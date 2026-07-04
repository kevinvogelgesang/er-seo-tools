# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-03 (C7 pt3 merged+deployed+verified — **C7 COMPLETE**) · **Updated by:** C7 part 3 (streaming parse) MERGED (PR #95, `75b84f6`) + DEPLOYED + PROD-VERIFIED. All three C7 parts now shipped. Next is a roadmap-menu choice (no single mandated item).
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: C7 (parser consolidation + streaming + per-file failure isolation) is now
FULLY COMPLETE — all 3 decomposed PRs shipped + prod-verified:
- pt1 per-file parse reporting (PR #93), pt2 parser consolidation (PR #94),
  pt3 streaming parse (PR #95, `75b84f6`) MERGED + DEPLOYED + PROD-VERIFIED 2026-07-03.
- pt3 shipped a StreamingParser sibling base + streamCsv (Papa NODE_STREAM_INPUT)
  for the 4 big-file parsers (externallinks/anchortext/images/linksissues) + route
  filename-first detection with a bounded header-peek (unmatched files never fully
  read). Byte-identical proven 3 ways (golden + Papa parity table + real-crawl
  deepStrictEqual vs baselines). KEY prod-only catch: Papa.parse(string) strips a
  leading UTF-8 BOM but NODE_STREAM_INPUT does NOT — every real SF export has a BOM
  that would break findColumn(['Address','URL']); streamCsv now strips it. Memory:
  bare driver ~184MB over a 500MB file (bounded = the fix), whole-file OOMs.
  InternalParser deliberately NOT converted. The 2 deferred pt2 golden Minors are
  closed. 3055 tests (322 files).
A2/B1–B5/C1–C6/C8/C10/D0 all COMPLETE + PROD-VERIFIED. A 16-skill operator library
lives in .claude/skills/.

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
3. THE IMMEDIATE NEXT STEP: roadmap-menu choice (no single mandated item — C7 is
   done). Ask Kevin which, or pick and proceed via the full pipeline
   (brainstorm → spec → Codex → plan → Codex → subagent TDD → gates → PR):
   - C9 (ADA scoring v2 + poller/results-view consolidation) — the last unbuilt
     C-track item; 1–1.5 wks.
   - Further C6 (SEO-only scan mode — spec §9; external-link verification;
     redirect/canonical/hreflang validation; content similarity).
   - SF-retirement campaign Phase 1 (SF-vs-live parity — a MEASUREMENT stream;
     load er-seo-tools-sf-retirement-campaign).
   - Reusable real crawl for any fixture/parity need:
     /Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25
     (all exports; manhattanschool.edu is an existing client). Never scan non-client sites.
4. LIGHT PENDING (not blocking anything): C7 pt1's functional File-processing-panel
   render check — needs a multi-file upload through the app (local dev or prod).
   Buckets are unit-covered; the pt3 deploy also exercises the real parse path on
   the next real upload. The corrupt-CSV core-failure banner is NOT upload-reachable
   (Papa+parsers degrade, never throw) — unit-covered only.
5. Small open D0 follow-ups (not blocking): set ALERT_WEBHOOK_URL in the server
   .env once Slack admin approves; consider a BACKUP_DIR-unset warning in the
   manual scripts/db-backup.ts; two ~444 MB backups sit in
   /home/seo/data/seo-tools/backups/ (safe to rm the older one).
6. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **MERGED + DEPLOYED + PROD-VERIFIED 2026-07-03: C7 part 3 — streaming parse.**
  PR #95 (`75b84f6`) merged to main + deployed via plain `~/deploy.sh` (code-only,
  no migration/env). **C7 is now fully complete (all 3 parts).**
  - **What shipped:** a new `StreamingParser` **sibling** base
    (`lib/parsers/streaming-parser.base.ts`; `consume(row)`/`onHeaders()`/`finalize()`
    lifecycle) + `streamCsv` driver (`lib/parsers/stream-csv.ts`, Papa
    `NODE_STREAM_INPUT`). The 4 big-file parsers converted:
    `ExternalLinksParser` (all_outlinks 10MB), `AnchorTextParser` (all_anchor_text
    3.6MB), `ImagesParser`, `LinksIssuesParser`. Route (`app/api/parse/[sessionId]/route.ts`)
    detects filename-first, peeks a bounded header (`readHeaderChunk`, 64KB base /
    1MB cap) only on miss, so **unmatched files (all_inlinks 7.3MB, external_all)
    are never fully read**. Shared `header-map.ts` util (both bases delegate) +
    widened `ParserClass` registry type. `InternalParser` deliberately NOT converted
    (small file, O(URLs) state, 704 lines).
  - **Byte-identical, proven 3 ways:** golden characterization tests (full `toEqual`,
    written pre-refactor, green through conversion) + a generic Papa string-vs-stream
    parity table (8 cases) + a real-crawl `deepStrictEqual` harness diffing streaming
    output against committed pre-refactor baselines (all 3 parsed big files identical).
  - **Key prod-only catch (via the parity table):** `Papa.parse(string)` strips a
    leading UTF-8 BOM; `Papa.parse(NODE_STREAM_INPUT)` does NOT. Every real SF export
    starts with a BOM (`ef bb bf`) that would attach to the first header cell
    (`﻿Address`) and break `findColumn(['Address','URL'])` on the streaming path.
    `streamCsv` now strips a leading BOM (a Transform, `decodeStrings:false`) so its
    rows are byte-identical to the whole-file path. `streamCsv` also resolves only on
    the readable-side `'end'` (never `'finish'`) and rejects on any stream error.
  - **Memory (continuous-sampling @ `--max-old-space-size=1024`):** bare `streamCsv`
    ~184MB over a ~500MB file (bounded regardless of size — the structural fix: no
    full string, no full row array); stream w/ `ExternalLinksParser` ~751MB (driver +
    its O(broken-links) output accumulator + Papa churn); whole-file
    `Papa.parse(readFileSync)` OOMs (`Reached heap limit`, exit 134, architecturally
    unbounded). Harness: `scripts/streaming-memory-check.ts` (bare/stream/whole modes)
    + `scripts/streaming-parity-check.ts` (self-diffs vs baselines).
  - **Also closed the 2 deferred pt2 golden Minors** (mask-fallback branch + nonzero
    `excluded_urls`) on `pageTitles.golden.test.ts`.
  - **This session:** full pipeline start→ship. Spec Codex-reviewed (accept-with-fixes,
    10 findings applied); plan Codex-reviewed (ship-with-fixes, 10 findings applied);
    subagent-driven build (11 tasks, per-task spec+quality reviews all Approved).
    **Two real defects caught mid-build:** (a) Task 2 — the plan's mask-fallback
    fixture didn't actually hit the `!hasIndexable` branch (absent Indexability col →
    all-true); fixed via coverage instrumentation; (b) Task 5 — the BOM asymmetry
    above. Final opus whole-branch review = **READY TO MERGE**, 0 Critical/Important,
    all 7 invariants hold.
  - **Gate-green in-session:** tsc clean · **3055 tests (322 files, +87)** · build clean.
  - **Post-deploy verification:** app online, 0 restarts, 387MB (well under 2400M),
    307 = expected OAuth redirect; **minification-survival PASSED** — all 4 new
    `parserKey` literals present in the deployed `.next/server` bundle, no
    `constructor.name` in the parser path (2026-06-02 landmine stays disarmed).
  - Spec: `docs/superpowers/archive/specs/2026-07-03-streaming-parse-design.md` ·
    Plan: `docs/superpowers/archive/plans/2026-07-03-streaming-parse.md` (both archived).
- **A1, A2, A2-f1, B1–B5, C1–C6, C7 (all 3 parts), C8, C10, D0 all COMPLETE + PROD-VERIFIED.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00` (noindex → broken-link findings only, null score).
- **⚠ PENDING HUMAN STEPS (Kevin):**
  1. **C7 pt1 functional panel-render check (light):** upload a multi-file crawl
     through the app; confirm the File-processing panel buckets render (light+dark) +
     backward-compat (a pre-C7 session still renders). Not blocking anything.
  2. **D0:** set `ALERT_WEBHOOK_URL` once Slack admin approves; optional stray-backup rm.
  3. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan 409-blocking the
     localStorage import — keep or delete + re-open).
  4. **First real qct_ push** not yet exercised.
  5. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
- **Blocked / gated:** Anthropic API billing; sitemap miss-rate measurement not yet run;
  daily/nightly cadences still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups:** C7 pt1 "corrupt-but-parseable core" detection; streaming
  concurrency (limit ~4 — the roadmap's Phase-3 payoff AFTER streaming, deliberately
  deferred; now safe to build on the streamed base); `trackDomain` per-row `findColumn`
  micro-opt (StreamingParser, constant-factor); C8 diff.service.ts score-source migration
  + draft-weights preview; D0 off-box backup replication; C6 SEO-only scan mode /
  external-link verification / redirect-canonical-hreflang validation / content similarity /
  daily-cadence supersede-trimming; standalone single-page audit CSV/VPAT/report; public
  share-page export buttons; expandable rows on public ADA share view; logo for the PDF;
  `SessionPage` model drop (≥180 d after 2026-06-11); same-URL standalone-audit diffing;
  fleet instance-level diffing; B2 v1 multi-domain limitation; SF-retirement campaign Phase 1.

## Next item

**No single mandated item — C7 is fully shipped.** Pick from the roadmap menu (ask
Kevin or choose) and run the full pipeline (brainstorm → spec → Codex → plan → Codex
→ subagent TDD → gates → PR → merge → deploy → prod-verify → docs ritual):
- **C9** — ADA scoring v2 + poller/results-view consolidation (the last unbuilt C-track item, 1–1.5 wks).
- **Further C6** — SEO-only scan mode (spec §9) / external-link verification / redirect-canonical-hreflang validation / content similarity.
- **SF-retirement Phase 1** — SF-vs-live parity (a MEASUREMENT stream; load `er-seo-tools-sf-retirement-campaign`).
- **Streaming concurrency** — the roadmap's Phase-3 payoff (parse ~4 files concurrently) is now safe to build on the streamed base; a small, well-scoped follow-up if throughput is wanted.

## Gotchas / decisions already made (don't relitigate)

- **C7 is decomposed into 3 PRs, order isolation→consolidation→streaming** (Kevin 2026-07-03) — ALL DONE.
- **C7 pt3 decisions (locked 2026-07-03):** stream ONLY the 4 big-file parsers (not the full fleet, not the consolidated bases — those read small files); streaming-only (no concurrency in pt3); keep the parse synchronous (streaming's chunk-async relieves event-loop pressure without a job-queue move); defer InternalParser (small file / O(URLs) state); add route filename-first + header-peek detection.
- **C7 pt3 invariants (verified against code + final opus review + prod bundle + real-crawl parity):**
  - Byte-identical `finalize()` output vs the old whole-file `parse()` — accumulators kept verbatim (AnchorText `Record` NOT `Map` so `Object.entries` tie-order holds for numeric-looking anchors; caps 50/30/20; `stats` gating; `total_*` = row count; issue order). PROVEN via golden + real-crawl deepStrictEqual.
  - `StreamingParser` lifecycle: `consume()` resolves headers + calls `onHeaders()` (column caching) BEFORE folding the first row; `finalize()` emits only; empty input → `onHeaders` never fires → empty shape.
  - Explicit literal `parserKey` per subclass; base declares `''` + is unregistered → minification guard never inspects it. CONFIRMED in the deployed bundle.
  - **BOM:** `streamCsv` strips a leading `﻿` (Papa's string path stripBom's, the stream path does NOT). Without this every real SF export breaks `findColumn`.
  - `streamCsv` resolves on readable `'end'` only (NOT `'finish'` — early-return bug); rejects on file/stripper/papa errors + destroys streams.
  - Detection filename-first, peek only on miss, unmatched never fully read; registry type widened to `ParserClass` (contents + detection order unchanged). Real-registry detection-equivalence tests live in `lib/parsers/detection-equivalence.test.ts` (NOT the route test, which mocks `@/lib/parsers`).
- **Reusable real crawl:** `/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25`
  — full manhattanschool.edu SF export (existing client). Use for any crawl need; never scan non-client sites.
- **How the SEO health score works:** WEIGHTED COVERAGE RATIO across ~8 factors, NOT a
  count of SF issues. A factor joins the denominator only when its input exists.
- **Deploy protocol:** code-only / config-only (incl. `next.config.ts`) → plain `~/deploy.sh`;
  `ecosystem.config.js`/env changes → `pm2 delete && pm2 start`. Prod has NO `sqlite3` CLI —
  drive read-only prod queries with a throwaway `.mjs` IN THE APP DIR using `new PrismaClient()`
  + inline `DATABASE_URL='file:/home/seo/data/seo-tools/db.sqlite'`.
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`); prod DB `/home/seo/data/seo-tools/db.sqlite`;
  prod URL `https://seo.erstaging.site`.
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only.
- **Never `git add -A` at repo root** — `pentest-results/`, `googlefc472dc61896519a.html`,
  `SEO_Report_1st_Draft.pdf` are untracked + not gitignored. Add specific paths only.
- **Local dev quirk:** prefix prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`.
  `prisma migrate dev` is interactive-only — hand-write migration SQL, apply with `migrate deploy`.
  React render tests need `afterEach(cleanup)` + `// @vitest-environment jsdom`; parser/node
  tests use `// @vitest-environment node`. Quick parser smoke scripts run via `npx tsx <file>.ts` (NOT `.mts`).
- **Handoff-token / public route gotcha (bit us THREE times):** any new token-authed or public
  route MUST get a `middleware.ts` `isPublicPath` entry + a `middleware.test.ts` case. (C7 added no routes.)
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
- 2026-07-03 — **C7 DECOMPOSED (3 PRs); pt1 (per-file parse reporting) MERGED (#93, `23847af`) + DEPLOYED**
  (functional panel-render verify light-pending — banner not upload-reachable, unit-covered).
- 2026-07-03 — **C7 pt2 (parser consolidation) MERGED (#94, `6b0900d`) + DEPLOYED + fully VERIFIED**
  (real-crawl byte-identical parity + prod minification-survival + gates).
- 2026-07-03 — **C7 pt3 (streaming parse) MERGED (#95, `75b84f6`) + DEPLOYED + PROD-VERIFIED.**
  StreamingParser sibling base + streamCsv (Papa NODE_STREAM_INPUT) for the 4 big-file parsers +
  route filename-first header-peek detection. Byte-identical proven 3 ways; BOM-strip prod-only catch;
  memory bounded (bare driver ~184MB vs whole-file OOM). Spec+plan Codex-reviewed (20 findings applied),
  subagent-built (11 tasks), final opus review READY TO MERGE. Gates: tsc + 3055 tests + build.
  **C7 FULLY COMPLETE (all 3 parts).** Next: roadmap menu (C9 / further C6 / SF-retirement Phase 1 / streaming concurrency).
