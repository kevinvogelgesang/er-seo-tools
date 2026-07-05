# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-04 (C9-B ADA-audit frontend consolidation — MERGED+DEPLOYED+PROD-VERIFIED; **C9 COMPLETE**) · **Updated by:** the C9-B session (PR #98, main `c082868`). Next is a roadmap-menu choice (no single mandated item).
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: C9-B (ADA-audit frontend consolidation) is now MERGED + DEPLOYED +
PROD-VERIFIED (2026-07-04, PR #98, main `c082868`). It was the second half
of C9 (C9-A ADA Scoring v2 shipped same day, PR #97) — a NEAR-ZERO-BEHAVIOR-
CHANGE refactor. **C9 is now COMPLETE.** The original C9-B scope in the old
handoff was STALE; the actual scope was re-derived from code:
- ALREADY DONE by earlier tracks (handoff was wrong): SiteAuditForm's duplicate
  polling was already lifted to AuditIndexTabs; grouped-violations already
  extracted to useGroupedViolations (effect-driven because it fan-out-fetches
  per page → a useMemo is INAPPLICABLE, not missing); the share views already
  reuse the main views as thin wrappers; page bucketing/filter/sort already
  memoized in useSiteAuditPages.
- GENUINE dup consolidated: (1) `components/ada-audit/useAuditPoller.ts` — a
  generic callback-only interval-poll hook; both AuditPoller (1000ms, terminal
  {complete,error,redirected}, keeps its own elapsed/ETA timer) and
  SiteAuditPoller (3000ms, terminal {complete,error,cancelled}) rewired onto it.
  Callbacks in refs so inline closures don't restart the interval; router.refresh()
  fires once (refreshedRef); terminal-on-mount inert; NO inFlight guard (preserves
  naive setInterval semantics). (2) `components/ada-audit/PageRow.tsx` — pure
  verbatim move out of SiteAuditResultsView (~172 LOC), shareMode no-fetch guards
  intact. (3) `components/ada-audit/useTriageMode.ts` + `ArchivedAuditBanner.tsx`
  — shared triage-localStorage hook (try/catch-guarded) + archived-banner
  (variant page|site, byte-exact copy), adopted by both AuditResultsView and
  SiteAuditResultsView. Each view keeps its OWN read-gating (single: unconditional
  `useTriageMode(auditId)`; site: `useTriageMode(siteAuditId,{enabled:!shareMode})`).
  **`shareMode` ≠ `readOnly` — NOT normalized.**
- EXCLUDED w/ reasons: SiteAuditForm split (cohesive, no dup left — YAGNI);
  useGroupedViolations memo (inapplicable — effectful fetch); shared
  AuditHeaderCard (prop-bag risk, deferred to an optional second pass).
- NO migration → deploy was plain ~/deploy.sh ("No pending migrations").
Pipeline: brainstorm (scope re-derived via Explore) → spec (Codex accept-with-
fixes ×6 folded, 2 REJECTED as behavior changes after code-verification) → plan
(Codex accept-with-fixes ×9) → subagent TDD (8 tasks, every per-task review
Approved, 0 Critical/Important) → final opus whole-branch review READY TO MERGE
(all 6 §6 invariants verified vs code, share/readOnly guarantees intact,
extractions verbatim). Process caught a real bug: the plan's useTriageMode test #4
was self-contradictory (seeded a key then asserted its absence); replaced with a
stronger no-seed test + fixed the plan doc. Two intentional documented deltas,
both hardening: refresh-once on overlapping terminals; interval no-resubscribe on
status change. Gates: tsc · 3141 tests (333 files, +16) · build. Prod: online 0
restarts, HTTP 307, no migration, 4 new source files present.
A2/B1–B5/C1–C10/C9(A+B)/D0 all COMPLETE + PROD-VERIFIED. A 16-skill operator
library lives in .claude/skills/.

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
   tracker/handoff. (C9-B is a fresh reminder: the handoff's forward-looking
   scope drifts — always re-map the actual code before writing a spec.)
3. THE IMMEDIATE NEXT STEP: roadmap-menu choice (no single mandated item). Ask
   Kevin which, or pick and proceed via the full pipeline (brainstorm → spec →
   Codex → plan → Codex → subagent TDD → gates → PR → merge → deploy → verify →
   docs ritual):
   - Further C6 (SF-retirement roadmap §5 sequence): content similarity (Phase 5)
     · external-link verification (finish Phase 1 — externals harvested but not
     checked in v1) · hybrid discovery (Phase 2, the big architectural one) ·
     reachability graph + true depth (3b). Load er-seo-tools-sf-retirement-campaign.
   - SF-retirement campaign Phase 1 (SF-vs-live PARITY MEASUREMENT stream).
   - Streaming concurrency (C7 Phase-3 payoff — parse ~4 big files concurrently
     on the now-streamed base; small, well-scoped).
   - Optional C9-B second pass: shared `AuditHeaderCard` slot component (deferred
     — only pursue if a layout-only slot provably stays small; prop-bag risk).
   - Reusable real crawl for any fixture/parity need:
     /Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25
     (all exports; manhattanschool.edu is an existing client). Never scan non-client sites.
4. LIGHT PENDING behavioral verify (not blocking, all inert-until-first-case):
   - C9-B: UI-render check on a real ADA audit — live poller progress bar +
     elapsed/ETA (single) and pages/pdfs/lighthouse phases (site); triage toggle
     read/write; archived banner render light+dark. Covered by the 16 new tests +
     the two big views' unchanged contract tests.
   - C9-A: v2-SCALE on a REAL client audit — confirm the ada run carries
     `scoreBreakdown.version===2`, the detail badge shows v2, an OLDER audit still
     shows its v1 number, a boundary-spanning trend renders the formula-change
     marker not a bogus delta. Weekly canary client 31 / analyst scan.
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

- **MERGED + DEPLOYED + PROD-VERIFIED 2026-07-04: C9-B — ADA-audit frontend consolidation.**
  PR #98 (`c082868`) merged to main + deployed via plain `~/deploy.sh` (code-only,
  no migration — "No pending migrations to apply"). **C9 COMPLETE (both halves).**
  - **What shipped (near-zero-behavior-change refactor):**
    - `components/ada-audit/useAuditPoller.ts` — generic callback-only interval-poll
      hook; both `AuditPoller` + `SiteAuditPoller` rewired onto it (callbacks in refs,
      `router.refresh()` once, terminal-on-mount inert, no inFlight guard).
    - `components/ada-audit/PageRow.tsx` — pure verbatim move out of `SiteAuditResultsView`
      (shareMode no-fetch guards intact).
    - `components/ada-audit/useTriageMode.ts` + `ArchivedAuditBanner.tsx` — shared
      triage-localStorage hook + archived banner (variant page|site), adopted by both
      result views; each keeps its own read-gating; `shareMode` ≠ `readOnly` (not normalized).
  - **Key invariants (verified by the final opus whole-branch review + prod):**
    - Poll cadences unchanged (1000/3000 ms); terminal-on-mount → no refresh; refresh
      fires once; shareMode≠readOnly not conflated; PageRow no-fetch-in-shareMode; zero
      DOM change when props held constant.
    - Share/readOnly read-only guarantees intact: single share reads localStorage (as
      before) but its toggle-write is unreachable (button gated `!readOnly && !archived`);
      site share `enabled:false` → no localStorage/fetch.
    - Two intentional documented deltas, both hardening: refresh-once on overlapping
      terminals (old pollers could double-refresh); interval no-resubscribe on status change.
  - **This session:** full pipeline start→ship. Scope re-derived from code (handoff was
    stale). Spec Codex-reviewed (accept-with-fixes, 6 applied, 2 rejected as behavior
    changes — readOnly-regating + hook-level archived-gating both change current
    localStorage-read behavior). Plan Codex-reviewed (accept-with-fixes, 9 applied).
    Subagent-driven build (8 tasks, every per-task review Approved; sonnet impl/review,
    opus final). Process caught a self-contradictory plan test (useTriageMode #4) — fixed.
  - **Gate-green in-session (re-run at merge HEAD `d99103a`):** tsc clean · **3141 tests
    (333 files, +16)** · build clean.
  - **Post-deploy verification:** app online, 0 restarts, HTTP 307, "No pending migrations",
    deployed commit `c082868`, 4 new source files present. NO minification-survival concern
    (no `.toString()`-injected code touched). Behavioral UI-render check pends the next real
    ADA audit — inert-until-exercised, covered by tests.
  - Spec: `docs/superpowers/archive/specs/2026-07-04-ada-frontend-consolidation-design.md` ·
    Plan: `docs/superpowers/archive/plans/2026-07-04-ada-frontend-consolidation.md` (both archived).
- **MERGED + DEPLOYED + PROD-VERIFIED 2026-07-04: C9-A — ADA Scoring v2** (PR #97, `6e9bb55`).
  Per-page size-normalized WCAG-aware version-labeled score (`lib/ada-audit/scoring-v2.ts`,
  K=14); v1 `scoring.ts` frozen (read-time fallback); raw `AxeViolation.nodeCount` in the
  blob (no migration); versioned `CrawlRun.scoreBreakdown {version:2}`; `parseScoreVersion`
  + version-aware trends (no cross-version delta); read surfaces prefer persisted score +
  `ScoreVersionBadge`. Spec/plan archived.
- **A1, A2, A2-f1, B1–B5, C1–C10, C9(A+B), D0 all COMPLETE + PROD-VERIFIED.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. Where the C9-A v2-scale + C9-B UI-render
  + C6-validation behavioral prod-verifies will naturally land.
- **⚠ PENDING HUMAN STEPS (Kevin), none blocking:**
  1. **C9-B UI-render check (light):** next real ADA audit — live poller progress, triage
     toggle, archived banner light+dark.
  2. **C9-A v2-scale check (light):** next real client audit — `scoreBreakdown.version===2`,
     v2 badge, older audit still v1, boundary trend shows formula-change marker not a delta.
  3. **C6 validation behavioral prod-verify (light):** canonical/redirect/hreflang findings
     on a real audit's live-scan run.
  4. **C7 pt1 functional panel-render check (light):** multi-file crawl upload → File-processing
     panel buckets render (light+dark) + backward-compat.
  5. **D0:** set `ALERT_WEBHOOK_URL` once Slack admin approves; optional stray-backup rm.
  6. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan 409-blocking the
     localStorage import — keep or delete + re-open).
  7. **First real qct_ push** not yet exercised.
  8. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
- **Blocked / gated:** Anthropic API billing; sitemap miss-rate measurement not yet run;
  daily/nightly cadences still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups:** C9-B optional second pass (shared `AuditHeaderCard` slot component —
  only if it provably stays small); C9-A's deferred site-level v2-compliance rollup + a
  per-row list/recents v2 badge; C6 content similarity (Phase 5) / external-link verification
  (finish Phase 1) / hybrid discovery (Phase 2) / reachability graph + true depth (3b) /
  daily-cadence supersede-trimming; streaming concurrency (C7 Phase-3 payoff); C7 pt1
  "corrupt-but-parseable core" detection; `trackDomain` per-row `findColumn` micro-opt; C8
  diff.service.ts score-source migration + draft-weights preview; D0 off-box backup
  replication; standalone single-page audit CSV/VPAT/report; public share-page export
  buttons; expandable rows on public ADA share view; logo for the PDF; `SessionPage`
  model drop (≥180 d after 2026-06-11); same-URL standalone-audit diffing; fleet
  instance-level diffing; B2 v1 multi-domain limitation; SF-retirement campaign Phase 1.

## Next item

**No single mandated item — C9 is fully shipped (A+B).** Pick from the roadmap
menu (ask Kevin or choose) and run the full pipeline:
- **Further C6** — content similarity (Phase 5) / external-link verification (finish
  Phase 1) / hybrid discovery (Phase 2, the big architectural one) / reachability graph (3b).
- **SF-retirement Phase 1** — SF-vs-live PARITY MEASUREMENT (load `er-seo-tools-sf-retirement-campaign`).
- **Streaming concurrency** — the C7 Phase-3 payoff, safe on the streamed base; small.
- **C9-B second pass (optional)** — shared `AuditHeaderCard` slot; only if it stays small.

## Gotchas / decisions already made (don't relitigate)

- **C9-B decisions (locked 2026-07-04):** near-zero-behavior-change refactor;
  `shareMode` ≠ `readOnly` (NEVER normalize — site view suppresses cookie-gated fetches/
  row-expansion/triage-keys/grouped-fetch/localStorage; single view shows loaded checks
  read-only); `useTriageMode` preserves EACH view's current read-gating (single reads
  unconditionally, site reads `!shareMode`) — do NOT gate the hook on readOnly/archived
  (rejected Codex suggestions; those change current behavior); archived suppression stays
  at the CONSUMER (button visibility + useChecks enabled + checksContext, all `!archived`),
  not the hook; NO inFlight overlap guard in `useAuditPoller` (preserves naive setInterval);
  SiteAuditForm split / useGroupedViolations memo / shared AuditHeaderCard all EXCLUDED.
- **The handoff's forward-looking scope drifts — re-map the code first.** C9-B's original
  scope claimed 3 things already done by earlier tracks. Before writing any spec, dispatch
  an Explore/read pass over the actual components; trust code > handoff.
- **`useAuditPoller` contract:** callback-only (`getStatus`/`isTerminal` predicates,
  `onData`/`onTerminal`, `enabled`); callbacks stored in refs (else inline closures restart
  the interval); effect deps `[url, intervalMs, enabled, initialStatus, router]`; `refreshedRef`
  reset at effect start; the elapsed/ETA timer stays LOCAL to `AuditPoller` (cleared via `onTerminal`).
- **C9-A scoring decisions (locked 2026-07-04):** fix the 3 real defects (normalization,
  WCAG-level via best-practice discount, pass/incomplete signal) — NO curated per-rule table;
  freeze history as v1 (each score labeled by its producing version); NO schema migration
  (reuse `scoreBreakdown` JSON + existing score columns). K=14. v2 compliance = no
  WCAG-conformance violation; read surfaces derive `compliant` version-aware.
- **Raw node count matters (C9-A):** axe nodes truncated to 20 in the blob, so v2 reads
  `v.nodeCount ?? v.nodes.length` (raw count preserved by `capViolationNodesForStorage`).
- **`scoreBreakdown` is a shared string column** on CrawlRun: SEO writes `{version:1}`,
  ADA writes `{version:2,scorer:'ada-v2'}`. `ScoreExplanation` is the ONLY breakdown
  JSON.parse reader and only ever receives SEO-origin runs.
- **`parseSeoFromDocument` is `.toString()`-injected → MUST stay SWC-helper-free** — no
  `typeof`; verify at es2017 on the BUILT bundle. (C9-A/C9-B changed NO injected-into-page
  code → no minification-survival check needed either time.)
- **How the SEO health score works:** WEIGHTED COVERAGE RATIO across ~8 factors, NOT a
  count of SF issues. (ADA score is separate — v1 in `scoring.ts`, v2 in `scoring-v2.ts`.)
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
  React render tests need `afterEach(cleanup)` + `// @vitest-environment jsdom`; parser/node
  tests use `// @vitest-environment node`. `tsc --noEmit` (= `npm run lint`) has NO
  `noUnusedLocals`, so unused imports don't fail lint (but it DOES error on use-of-undefined).
- **Handoff-token / public route gotcha (bit us THREE times):** any new token-authed or public
  route MUST get a `middleware.ts` `isPublicPath` entry + a `middleware.test.ts` case.
  (C9-A/C9-B added no routes.)
- **Codex session for this workspace:** `019f2b57-...` (registry `~/.claude/state/codex-consultations.json`).
  If a resumed Codex answer looks off-topic, `--fresh`.
- Codex reviews: route new specs/plans through Codex per Kevin's standing instruction.
- **SDD progress ledger** (`.superpowers/sdd/progress.md`) is git-ignored scratch and is
  OVERWRITTEN each feature; per-task report files (`.superpowers/sdd/task-N-report.md`) get
  REUSED across cycles — tell implementers to OVERWRITE, not append, and don't trust a report
  file's provenance without checking (a C9-B agent left a stale C9-A report in place).

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
  PROD-VERIFIED. C9 COMPLETE (both halves).** Near-zero-behavior refactor: `useAuditPoller<T>`
  hook (both pollers), `PageRow` extraction, `useTriageMode` + `ArchivedAuditBanner` (both result
  views). Scope re-derived from code (handoff was stale). Spec+plan Codex-reviewed (15 findings
  applied, 2 rejected as behavior changes); subagent-built (8 tasks), final opus review READY TO
  MERGE (all 6 invariants verified). Gates: tsc + 3141 tests (+16) + build. No migration. Next:
  roadmap menu (further C6 / SF-retirement Phase 1 / streaming concurrency).
