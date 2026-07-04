# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-04 (C9-A ADA Scoring v2 — MERGED+DEPLOYED+PROD-VERIFIED) · **Updated by:** the C9-A session (PR #97, main `6e9bb55`). Next is a roadmap-menu choice (no single mandated item).
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: C9-A (ADA Scoring v2) is now MERGED + DEPLOYED + PROD-VERIFIED
(2026-07-04, PR #97, main `6e9bb55`). It replaced the blunt v1 ADA score
(impact-penalty ÷ log10(node count)) with a per-page, size-normalized,
WCAG-aware, version-labeled v2 score:
- `lib/ada-audit/scoring-v2.ts` (pure): computeScoreV2 = 100/(1+K·density)
  (K=14, impact 10/6/3/1, best-practice-only ×0.4 advisory discount,
  incomplete ×0.5, DOM_FLOOR=50/NODE_CAP=200 guards); computeComplianceV2
  (no WCAG-conformance violation → advisory findings don't break compliance);
  computeSiteScoreV2 (rounded unweighted mean of per-page scores). v1
  `scoring.ts` FROZEN/untouched (it stays the read-time fallback).
- Raw pre-truncation `AxeViolation.nodeCount` preserved in the axe blob
  (JSON shape change, NO migration) so density is faithful past the 20-node
  storage cap.
- `ada-mapper` writes a versioned `CrawlRun.scoreBreakdown {version:2,
  scorer:'ada-v2'}`; `parseScoreVersion` (default 1) drives version-aware
  trends — `buildSeries` suppresses the numeric delta across a v1↔v2 boundary
  (`formulaChanged`), wired through client-dashboard/client-fleet/
  client-schedules/report-data/report-html (dashed boundary + "formula
  changed" marker).
- Read surfaces (ada-audit detail/share/site/site-share) prefer the persisted
  score + version via `resolveDisplayScore` (recompute = frozen v1,
  `fromFallback`); compliance follows the score's version; a dark-mode
  `ScoreVersionBadge` threaded via an OPTIONAL `scoreMeta` prop (backward-
  compatible) through AuditResultsView/SiteAuditResultsView → AuditScorecard.
- FREEZE-HISTORY-AS-V1 falls out of the data model: v2 is only produced where
  per-page node+DOM data exists (write time / unpruned blob); the count-based
  read fallback stays v1 and is only reachable for pre-v2/pruned (v1-era)
  audits. Each score is labeled by the version that produced it.
- NO schema migration (scoreBreakdown column existed; nodeCount is JSON-only;
  score columns existed) → deploy was plain ~/deploy.sh ("No pending
  migrations to apply").
Pipeline: brainstorm (3 decisions: fix-the-3-defects / freeze-as-v1 / split) →
spec (Codex ×6) → plan (Codex ×8, incl. the v2-COMPLIANCE gap catch) →
subagent TDD (7 tasks, all per-task reviews Approved; sonnet impl/review, opus
final) → final opus whole-branch review READY TO MERGE (3 spec invariants
verified end-to-end, 0 Critical/Important; 4 minors, 3 folded into 951c61a, 1
deferred). K bumped 12→14 mid-build (rounding boundary). Gates: tsc · 3125
tests (330 files, +44) · build. Prod: online 0 restarts, HTTP 307, no
migration, deployed v2 source present.
C9 was DECOMPOSED (Kevin's call) into C9-A (scoring, DONE) + C9-B (frontend
consolidation, NOT started). A2/B1–B5/C1–C8/C9-A/C10/D0 all COMPLETE +
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
3. THE IMMEDIATE NEXT STEP: roadmap-menu choice (no single mandated item). Ask
   Kevin which, or pick and proceed via the full pipeline (brainstorm → spec →
   Codex → plan → Codex → subagent TDD → gates → PR → merge → deploy → verify →
   docs ritual):
   - C9-B (frontend consolidation) — the second half of C9: ONE `useAuditPoller`
     hook replacing the duplicated AuditPoller + SiteAuditPoller; split
     SiteAuditForm (570 LOC) + SiteAuditResultsView (517 LOC) into composable
     pieces shared with the share view; memoize grouped-violation derivations.
     Pure/near-zero-behavior-change refactor; the last C9 piece. ~0.5–1 wk.
   - Further C6 (SF-retirement roadmap §5 sequence): content similarity (Phase 5)
     · external-link verification (finish Phase 1 — externals harvested but not
     checked in v1) · hybrid discovery (Phase 2, the big architectural one) ·
     reachability graph + true depth (3b). Load er-seo-tools-sf-retirement-campaign.
   - SF-retirement campaign Phase 1 (SF-vs-live PARITY MEASUREMENT stream).
   - Streaming concurrency (C7 Phase-3 payoff — parse ~4 big files concurrently
     on the now-streamed base; small, well-scoped).
   - Reusable real crawl for any fixture/parity need:
     /Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25
     (all exports; manhattanschool.edu is an existing client). Never scan non-client sites.
4. LIGHT PENDING behavioral verify (not blocking): C9-A's v2-SCALE on a REAL
   client audit — K=14 was calibrated on synthetic golden bands; the live-scan/
   ada mapper runs on the next real audit (weekly canary client 31 / analyst
   scan). Confirm the ada run carries `scoreBreakdown.version===2`, the detail
   badge shows v2, an OLDER audit still shows its v1 number, and a boundary-
   spanning trend renders the formula-change marker not a bogus delta. Covered
   by gate-green tests + golden bands; inert-until-first-case like A2-f1 / C6
   validation. Also still open: C6-validation finding-emission on a real audit;
   C7 pt1 multi-file File-processing-panel render check.
5. Small open D0 follow-ups (not blocking): set ALERT_WEBHOOK_URL in the server
   .env once Slack admin approves; consider a BACKUP_DIR-unset warning in the
   manual scripts/db-backup.ts; two ~444 MB backups sit in
   /home/seo/data/seo-tools/backups/ (safe to rm the older one).
6. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **MERGED + DEPLOYED + PROD-VERIFIED 2026-07-04: C9-A — ADA Scoring v2.**
  PR #97 (`6e9bb55`) merged to main + deployed via plain `~/deploy.sh` (code-only,
  no migration — "No pending migrations to apply").
  - **What shipped:** pure `lib/ada-audit/scoring-v2.ts` (`computeScoreV2` saturating
    density `100/(1+K·density)` K=14, best-practice ×0.4 advisory discount,
    incomplete ×0.5; `computeComplianceV2`; `computeSiteScoreV2` mean-of-pages);
    raw `AxeViolation.nodeCount` preserved pre-truncation in the blob (no migration);
    `ada-mapper` writes versioned `CrawlRun.scoreBreakdown {version:2,scorer:'ada-v2'}`;
    `parseScoreVersion` + version-aware trends (`buildSeries` suppresses cross-version
    delta, wired through client-dashboard/client-fleet/client-schedules/report-data/
    report-html); read surfaces prefer persisted score+version (`resolveDisplayScore`,
    v1 recompute fallback); compliance follows the score's version; dark-mode
    `ScoreVersionBadge` via an optional `scoreMeta` prop.
  - **Key invariants (verified by the final opus whole-branch review + prod):**
    - **v1 frozen:** `lib/ada-audit/scoring.ts` untouched; the fallback recompute is
      v1 and is called lazily (a persisted v2 score never triggers a v1 recompute);
      historical persisted scores read as-is (no backfill).
    - **No silent v1↔v2 delta:** all 4 trend/delta surfaces guarded; legacy AdaAudit
      rows pinned to v1; SEO series unaffected (their v1 breakdown → parseScoreVersion 1).
    - **No migration / no misparse:** `scoreBreakdown` reused; `ScoreExplanation` (the
      only breakdown JSON.parse reader) receives only SEO-origin runs; every
      `tool:'ada-audit'` run query selects only `score`/`id`.
    - **v2 math sound:** DOM_FLOOR (no div0), NODE_CAP (no overflow), monotonic;
      archived-blob compliance reads real WCAG tags (buildArchivedAxeResults preserves
      `tags`) → no false-compliant.
    - **Backward-compat:** `scoreMeta` optional (bare `&&` guard, no DOM change when
      omitted); site pages' score-preference logic byte-identical.
  - **Decomposition (Kevin's call 2026-07-04):** C9 = C9-A (scoring, DONE) + C9-B
    (frontend consolidation, NOT started).
  - **This session:** full pipeline start→ship. Spec Codex-reviewed (accept-with-fixes,
    6 applied — the raw-nodeCount catch was the important one). Plan Codex-reviewed
    (accept-with-fixes, 8 applied — the v2-COMPLIANCE gap was the important one:
    a v2 score would otherwise have shipped with a v1 pass/fail label). Subagent-driven
    build (7 tasks, all per-task reviews Approved; sonnet impl/review, opus final).
    Final opus whole-branch review = READY TO MERGE, 0 Critical/Important.
  - **Gate-green in-session (re-run at fix HEAD `951c61a`):** tsc clean · **3125 tests
    (330 files, +44)** · build clean.
  - **Post-deploy verification:** app online, 0 restarts, HTTP 307 (expected OAuth
    redirect), "No pending migrations", deployed v2 source present. **Behavioral
    v2-SCALE** (a real client audit's v2 number lands in a sane band) pends the next
    real audit — K=14 calibrated on synthetic golden bands; covered by gate-green tests.
    No minification-survival concern (no injected-into-page code changed).
  - Spec: `docs/superpowers/archive/specs/2026-07-04-ada-scoring-v2-design.md` ·
    Plan: `docs/superpowers/archive/plans/2026-07-04-ada-scoring-v2.md` (both archived).
- **A1, A2, A2-f1, B1–B5, C1–C8, C9-A, C10, D0 all COMPLETE + PROD-VERIFIED.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. This is where C9-A's v2-scale behavioral
  prod-verify (and the C6-validation finding-emission) will naturally land.
- **⚠ PENDING HUMAN STEPS (Kevin):**
  1. **C9-A v2-scale behavioral prod-verify (light):** on the next real client audit,
     confirm the ada run's `scoreBreakdown.version===2`, the detail badge shows v2, an
     older audit still shows its v1 number, and a boundary-spanning trend renders the
     formula-change marker (not a bogus delta). Not blocking.
  2. **C6 validation behavioral prod-verify (light):** canonical/redirect/hreflang
     findings on a real audit's live-scan run. Not blocking.
  3. **C7 pt1 functional panel-render check (light):** upload a multi-file crawl; confirm
     the File-processing panel buckets render (light+dark) + backward-compat.
  4. **D0:** set `ALERT_WEBHOOK_URL` once Slack admin approves; optional stray-backup rm.
  5. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan 409-blocking the
     localStorage import — keep or delete + re-open).
  6. **First real qct_ push** not yet exercised.
  7. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
- **Blocked / gated:** Anthropic API billing; sitemap miss-rate measurement not yet run;
  daily/nightly cadences still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups:** C9-B (frontend consolidation — the second C9 half); C9-A's
  deferred site-level v2-compliance rollup (per-page WCAG-conformance → site compliant;
  deferred to avoid loading per-page blobs on the site view) + a per-row list/recents v2
  badge; C6 content similarity (Phase 5) / external-link verification (finish Phase 1) /
  hybrid discovery (Phase 2) / reachability graph + true depth (3b) / daily-cadence
  supersede-trimming; streaming concurrency (C7 Phase-3 payoff); C7 pt1 "corrupt-but-
  parseable core" detection; `trackDomain` per-row `findColumn` micro-opt; C8
  diff.service.ts score-source migration + draft-weights preview; D0 off-box backup
  replication; standalone single-page audit CSV/VPAT/report; public share-page export
  buttons; expandable rows on public ADA share view; logo for the PDF; `SessionPage`
  model drop (≥180 d after 2026-06-11); same-URL standalone-audit diffing; fleet
  instance-level diffing; B2 v1 multi-domain limitation; SF-retirement campaign Phase 1.

## Next item

**No single mandated item — C9-A is fully shipped.** Pick from the roadmap
menu (ask Kevin or choose) and run the full pipeline:
- **C9-B** — frontend consolidation (the second C9 half): one `useAuditPoller` hook
  replacing the duplicated pollers; split SiteAuditForm/SiteAuditResultsView into
  composable shared pieces; memoize grouped-violation derivations. Near-zero-behavior
  refactor; ~0.5–1 wk.
- **Further C6** — content similarity (Phase 5) / external-link verification (finish
  Phase 1) / hybrid discovery (Phase 2, the big architectural one) / reachability graph (3b).
- **SF-retirement Phase 1** — SF-vs-live PARITY MEASUREMENT (load `er-seo-tools-sf-retirement-campaign`).
- **Streaming concurrency** — the C7 Phase-3 payoff, safe on the streamed base; small.

## Gotchas / decisions already made (don't relitigate)

- **C9-A scoring decisions (locked 2026-07-04):** fix the 3 real defects (normalization
  via domElementCount, WCAG-level-awareness via best-practice discount, pass/incomplete
  signal) — NO curated per-axe-rule weight table (keep impact-level weights); freeze
  history as v1 (each score labeled by the version that produced it); split C9 into
  C9-A/C9-B; NO schema migration (reuse `scoreBreakdown` JSON + existing score columns).
  K=14 (bumped from 12: at 12 a large-DOM incomplete-only page rounded 99.55→100). v2
  compliance = no WCAG-conformance violation (best-practice-only findings DON'T break it),
  and read surfaces derive `compliant` version-aware (v2 branch → `computeComplianceV2`).
- **Raw node count matters:** axe nodes are truncated to 20 in the stored blob, so v2
  reads `v.nodeCount ?? v.nodes.length` (raw count preserved by `capViolationNodesForStorage`
  in `lib/ada-audit/node-cap.ts` BEFORE the runner slices). Without it, size-invariance
  breaks the moment a rule exceeds 20 nodes.
- **`scoreBreakdown` is a shared string column** on CrawlRun: SEO writes `{version:1,
  scorer:'health'|'live-seo'}`, ADA writes `{version:2,scorer:'ada-v2'}`. `ScoreExplanation`
  is the ONLY breakdown JSON.parse reader and only ever receives SEO-origin runs; never
  feed it an ADA-origin run without branching on `parseScoreVersion` first.
- **safeFetch follows redirects ACROSS hosts** (SSRF-checked per hop) — a same-domain
  target that 301s off-site IS fetched off-site. PRE-EXISTING Phase-1 behavior; documented,
  not changed.
- **`parseSeoFromDocument` is `.toString()`-injected → MUST stay SWC-helper-free** — no
  `typeof`, no spread-of-unknown; verify at es2017 on the BUILT `.next/server` bundle.
  (C9-A changed NO injected-into-page code, so no minification-survival check was needed.)
- **How the SEO health score works:** WEIGHTED COVERAGE RATIO across ~8 factors, NOT a
  count of SF issues. (The ADA score is a separate formula — v1 in `scoring.ts`, v2 in
  `scoring-v2.ts`.)
- **Deploy protocol:** code-only / config-only (incl. `next.config.ts`) → plain `~/deploy.sh`;
  `ecosystem.config.js`/env changes → `pm2 delete && pm2 start`. Prod has NO `sqlite3` CLI —
  drive read-only prod queries with a throwaway `.mjs` IN THE APP DIR using `new PrismaClient()`
  + inline `DATABASE_URL='file:/home/seo/data/seo-tools/db.sqlite'`. (A throwaway `.mjs`
  importing a `.ts` module fails ESM resolution — query the DB and call pure logic separately,
  or write a `.ts` run through `tsx`.)
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`); prod DB `/home/seo/data/seo-tools/db.sqlite`;
  prod URL `https://seo.erstaging.site`.
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only.
- **Never `git add -A` at repo root** — `pentest-results/`, `googlefc472dc61896519a.html`,
  `SEO_Report_1st_Draft.pdf` are untracked + not gitignored. Add specific paths only.
- **Local dev quirk:** prefix prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`.
  React render tests need `afterEach(cleanup)` + `// @vitest-environment jsdom`; parser/node
  tests use `// @vitest-environment node`.
- **Handoff-token / public route gotcha (bit us THREE times):** any new token-authed or public
  route MUST get a `middleware.ts` `isPublicPath` entry + a `middleware.test.ts` case. (C9-A added no routes.)
- **Codex session for this workspace:** `019f2b57-...` (registry `~/.claude/state/codex-consultations.json`).
  If a resumed Codex answer looks off-topic, `--fresh`.
- Codex reviews: route new specs/plans through Codex per Kevin's standing instruction.

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, handoff created.
- 2026-06-10 — A1 Phases 0–4 (PRs #50–#54), prod-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), prod-verified. **A2 COMPLETE.**
- 2026-06-11 — B1–B5 (#60–#64 + middleware fix) shipped + prod-verified. **TRACK B COMPLETE.**
- 2026-06-11/12 — C1 (#65), C2 (#66), C3 (#67), C4 (#68), C5 (#69) SHIPPED.
- 2026-06-16/17 — C6 Phases 1–3 (#70, #71, #73) SHIPPED + prod-verified.
- 2026-06-22 — C10 (#75) + build-heap fix (#76), deployed, migration applied.
- 2026-06-30 — C6 Phase 4 (autonomous live SEO source) BUILT.
- 2026-07-02 — Skill library SHIPPED (`57ae636`). C6 Phase 4 (autonomous) MERGED+DEPLOYED (#85)+VERIFIED.
  C10 PROD-VERIFIED (COMPLETE). D0 SHIPPED (#86)+DEPLOYED+VERIFIED (COMPLETE).
  A2-f1 MERGED+DEPLOYED+PROD-VERIFIED. **A2-f1 COMPLETE.**
- 2026-07-03 — **C8 BUILT+MERGED (#90)+DEPLOYED+PROD-VERIFIED = COMPLETE.** Upload hotfix **PR #91** merged+deployed.
- 2026-07-03 — **C7 (all 3 parts) MERGED (#93/#94/#95) + DEPLOYED + PROD-VERIFIED = COMPLETE.**
- 2026-07-03 — **C6 SF-retirement Phase 4 (redirect/canonical/hreflang validation) MERGED (#96, `270b81f`)
  + DEPLOYED + PROD-VERIFIED.**
- 2026-07-04 — **C9-A (ADA Scoring v2) MERGED (#97, `6e9bb55`) + DEPLOYED + PROD-VERIFIED.**
  Per-page size-normalized WCAG-aware version-labeled score; v1 frozen; raw nodeCount in blob;
  version-aware trends; read-surface persisted-score preference + `ScoreVersionBadge`; no migration.
  Spec+plan Codex-reviewed (14 findings applied incl. the v2-compliance gap); subagent-built (7 tasks),
  final opus review READY TO MERGE. Gates: tsc + 3125 tests + build. K=14. **C9 DECOMPOSED → C9-A done,
  C9-B (frontend consolidation) NOT started.** Next: roadmap menu (C9-B / further C6 / SF-retirement
  Phase 1 / streaming concurrency).
