# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-04 (C6 external-link verification — MERGED+DEPLOYED+PROD-VERIFIED) · **Updated by:** the external-link-verification session (PR #100, main `a421c25`). Next is a roadmap-menu choice (no single mandated item).
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: C6 external-link verification is now MERGED + DEPLOYED + PROD-VERIFIED
(2026-07-04, PR #100, main `a421c25`). It completes C6 broken-link Phase 1
(SF-retirement §5): the live-scan builder previously HARVESTED external
<a href>/<img src> targets but only VERIFIED same-domain internal links/images
(one `where` filter dropped externals) — now it verifies externals too, as a
strictly ADDITIVE pass (internal pass byte-unchanged).
- What shipped:
  - `parseNonNegativeInt` (`lib/jobs/config.ts`) — 0 is a valid return (kill
    switch), distinct from `parsePositiveInt`.
  - `resolveExternalHead` (`lib/ada-audit/url-resolver.ts`) — HEAD-only external
    check (NEVER a GET, unlike internal `resolveUrl`'s HEAD→GET). broken =
    404/410/5xx; 401/403/405/429 + other 4xx + throws = `unconfirmed`
    (anti-bot-tolerant, protects analyst trust).
  - mapper: `TYPE_OF['external-link']`→`broken_external_links` (reuses the
    SF-world type: priority 35, `external` membership), per-call `severity`
    param (external `warning`, internal stays `critical`). NO zero-count logic.
  - builder (`broken-link-verify.ts`): additive SECOND pass over `external-link`
    rows — separate query/`externalBroken`/`externalCache` (internal pass
    byte-unchanged); own cap `BROKEN_LINK_EXTERNAL_MAX_CHECKS` (default 300,
    0 disables), remaining-time-aware soft budget
    `BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS` (default 300000, clamped by
    `JOB_TIMEOUT_MS − elapsed − SAFETY_RESERVE_MS(60s)`), shorter timeout
    `BROKEN_LINK_EXTERNAL_TIMEOUT_MS` (8000); worker try/catch wraps BOTH
    `throttle.wait` + `resolveExternal` (throw → one target `unconfirmed`,
    never a job-fail/retry loop); `externalCapped||externalHarvestTruncated`
    → run `partial`.
  - UI (`BrokenLinksSection.tsx`): amber WARNING tier below the red internal
    tier; per-tier partial line from each finding's OWN detail; `run.status`
    partial note on the clean state.
- Decisions locked (don't relitigate): separate external cap (0=kill switch);
  warning severity reusing `broken_external_links`; anti-bot 401/403/405/429 →
  unconfirmed (only 404/410/5xx broken); HEAD-only; remaining-time-aware budget;
  NO zero-count finding (would inflate `priority.service` — coverage via
  `run.status` instead). EXCLUDED: subdomain reclassification, external-image vs
  link finding split, unconfirmed recall, per-client toggle.
- Process caught (plan review): a count-0 `broken_external_links` finding is NOT
  inert — `calculatePriorityScore` scores by type weight × count-scale and the
  count-0 scale defaults to 1.0 → nonzero. So the zero-count coverage finding was
  dropped entirely; coverage transparency now comes from `run.status`.
- NO migration/route/injected-code → deploy was plain ~/deploy.sh ("No pending
  migrations"). Env vars all default-safe (no server .env change).
Pipeline: brainstorm (3 decisions) → spec (Codex accept-with-fixes ×12) → plan
(Codex accept-with-fixes ×12) → subagent TDD (7 tasks, every per-task review
Approved; Task 4 — the concurrency/budget core — opus-reviewed) → final opus
whole-branch review READY TO MERGE (0 Critical/0 Important, all 7 spec invariants
verified vs code). Gates: tsc · 3183 tests (336 files, +26) · build. Prod: online
0 restarts 403MB, HTTP 307, no migration, `broken_external_links` +
`BROKEN_LINK_EXTERNAL_MAX_CHECKS` bundled in `.next/server`.
A2/B1–B5/C1–C10/C9(A+B)/D0 all COMPLETE + PROD-VERIFIED. C7 fully complete incl.
Phase-3 concurrency. C6: Phases 1–4 + on-page + live score + redirect/canonical/
hreflang validation + external-link verification all shipped. A 16-skill operator
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
   tracker/handoff. Always re-map the actual code before writing a spec — the
   handoff's forward-looking scope drifts.
3. THE IMMEDIATE NEXT STEP: roadmap-menu choice (no single mandated item). Ask
   Kevin which, or pick and proceed via the full pipeline (brainstorm → spec →
   Codex → plan → Codex → subagent TDD → gates → PR → merge → deploy → verify →
   docs ritual):
   - Further C6 (SF-retirement §5 sequence): hybrid discovery (Phase 2, the big
     architectural one — gated on the sitemap miss-rate measurement decision) ·
     reachability graph + true depth (3b, needs Phase 2) · content similarity
     (Phase 5, embeddings asset already in deps). Load
     er-seo-tools-sf-retirement-campaign. (External-link verification is now DONE.)
   - SF-retirement campaign Phase 1 (SF-vs-live PARITY MEASUREMENT stream — the
     parity script exists; run it across ≥5 clients × 2–3 cycles).
   - Track A infra (A3 withRoute()+route tests · A4 observability floor · A5 SSE
     hook · A6 shared UI primitives · A7 auth hardening+Playwright).
   - Track D (D1 handoff-engine consolidation · D3 shared lib/seo-fetch/ · D4
     client robots/sitemap checks · D6 RankMath redirect generator).
   - Optional C9-B second pass: shared `AuditHeaderCard` slot component (deferred).
   - Reusable real crawl for any fixture/parity need:
     /Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25
     (all exports; manhattanschool.edu is an existing client). Never scan non-client sites.
4. LIGHT PENDING behavioral verify (not blocking, all inert-until-first-case):
   - External-link verification: on the next real seoIntent audit of a client
     site with outbound links, confirm a `broken_external_links` run finding (or
     a clean external pass) appears on the live-scan run and `BrokenLinksSection`
     renders the amber warning tier + coverage line. Weekly canary
     (proway.erstaging.site) exercises the plumbing but has few externals. Covered
     by the 26 new tests.
   - Streaming concurrency: concurrent-parse WALL-CLOCK on a real multi-big-file
     upload (Manhattan 49-CSV) — byte-identical report + faster parse.
   - C9-A v2-scale on a real client audit; C9-B UI-render check; C6-validation
     (canonical/redirect/hreflang) finding-emission; C7 pt1 File-processing panel.
5. Small open D0 follow-ups (not blocking): set ALERT_WEBHOOK_URL in the server
   .env once Slack admin approves; consider a BACKUP_DIR-unset warning in
   scripts/db-backup.ts; two ~444 MB backups sit in
   /home/seo/data/seo-tools/backups/ (safe to rm the older one).
6. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **MERGED + DEPLOYED + PROD-VERIFIED 2026-07-04: C6 external-link verification.**
  PR #100 (`a421c25`) merged to main + deployed via plain `~/deploy.sh` (code-only,
  no migration — "No pending migrations to apply").
  - **What shipped (additive; internal pass byte-unchanged):**
    - `parseNonNegativeInt` (`lib/jobs/config.ts`) — kill-switch enabler (0 valid).
    - `resolveExternalHead` (`lib/ada-audit/url-resolver.ts`) — HEAD-only, anti-bot-tolerant.
    - mapper `broken_external_links` (warning) + per-call `severity`; no zero-count.
    - builder second external pass — separate cap/budget/cache, failure isolation, partial status.
    - `BrokenLinksSection` amber warning tier + per-tier partial + clean-state partial note.
    - 3 new env vars documented in the config-and-flags skill; stale CLAUDE.md line fixed.
  - **Key invariants (final opus whole-branch review, all verified vs code):**
    - Internal-link/image verification byte-unchanged (separate everything).
    - Deterministic remaining-time budget → run always written before the 15-min
      queue kill; overflow → `partial`, never a job-fail/retry loop.
    - HEAD-only externals; broken = 404/410/5xx; anti-bot 401/403/405/429 → unconfirmed.
    - Reuses `broken_external_links`; distinct type-scoped dedupKeys → no @@unique collision.
    - `scoreLiveSeo`+`selectRuns` untouched → external warning never displaces canonical SEO run.
    - No migration/route/injected-code (no minification concern); idempotency preserved.
  - **Gate-green in-session:** tsc clean · **3183 tests (336 files, +26)** · build clean.
  - **Post-deploy verification:** app online, 0 restarts, 403 MB, HTTP 307, "No
    pending migrations", deployed commit `a421c25`; `broken_external_links` +
    `BROKEN_LINK_EXTERNAL_MAX_CHECKS` bundled in `.next/server`. Behavioral
    finding-emission pends the next real seoIntent audit — inert-until-exercised.
  - Spec: `docs/superpowers/archive/specs/2026-07-04-external-link-verification-design.md` ·
    Plan: `docs/superpowers/archive/plans/2026-07-04-external-link-verification.md` (both archived).
- **A1, A2, A2-f1, B1–B5, C1–C10, C9(A+B), D0 all COMPLETE + PROD-VERIFIED.**
  C7 fully complete (incl. Phase-3 concurrency). C6 Phases 1–4 + on-page + live
  score + redirect/canonical/hreflang validation + external-link verification shipped.
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. Where the external-link, C9-A v2-scale,
  C9-B UI-render, and C6-validation behavioral prod-verifies will naturally land.
- **⚠ PENDING HUMAN STEPS (Kevin), none blocking:**
  1. **External-link behavioral check (light):** next real seoIntent audit of a
     client site with outbound links → `broken_external_links` finding (or clean)
     on the live-scan run + amber tier renders in `BrokenLinksSection`.
  2. **Streaming-concurrency wall-clock check (light):** Manhattan 49-CSV upload → byte-identical + faster.
  3. **C9-A v2-scale · C9-B UI-render · C6-validation finding-emission · C7 pt1 panel** checks (all light).
  4. **D0:** set `ALERT_WEBHOOK_URL` once Slack admin approves; optional stray-backup rm.
  5. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan 409-blocking the localStorage import).
  6. **First real qct_ push** not yet exercised.
  7. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
- **Blocked / gated:** Anthropic API billing; sitemap miss-rate measurement not yet run
  (gates C6 hybrid discovery Phase 2); daily/nightly cadences still gated.
- **Parked follow-ups:** C6 hybrid discovery (Phase 2) / reachability graph + true depth (3b) /
  content similarity (Phase 5); external-link Minor (partial-coverage UI note dropped in the
  external-capped + external-clean + internal-has-findings combination — accepted v1 nicety loss);
  C9-B optional shared `AuditHeaderCard` slot; C9-A deferred site-level v2-compliance rollup + per-row
  v2 badge; C7 pt1 "corrupt-but-parseable core" detection; C8 diff.service.ts score-source migration;
  D0 off-box backup replication; standalone single-page audit CSV/VPAT/report; public share-page export
  buttons; expandable rows on public ADA share view; logo for the PDF; `SessionPage` model drop
  (≥180 d after 2026-06-11); SF-retirement campaign Phase 1; A3–A7 infra track; D1–D6 workflow-polish track.

## Next item

**No single mandated item — external-link verification is fully shipped.**
Pick from the roadmap menu (ask Kevin or choose) and run the full pipeline:
- **Further C6** — hybrid discovery (Phase 2, the big architectural one, gated on sitemap
  miss-rate) / reachability graph (3b) / content similarity (Phase 5).
- **SF-retirement Phase 1** — SF-vs-live PARITY MEASUREMENT (load `er-seo-tools-sf-retirement-campaign`).
- **Track A infra** — A3 withRoute()+route tests / A4 observability / A5 SSE / A6 UI primitives / A7 auth+Playwright.
- **Track D** — D1 handoff-engine consolidation / D3 shared lib/seo-fetch/ / D4 client robots-sitemap / D6 RankMath generator.
- **C9-B second pass (optional)** — shared `AuditHeaderCard` slot; only if it stays small.

## Gotchas / decisions already made (don't relitigate)

- **External-link decisions (locked 2026-07-04):** separate external cap
  `BROKEN_LINK_EXTERNAL_MAX_CHECKS` (default 300, **0 disables** via
  `parseNonNegativeInt`); warning severity reusing `broken_external_links`;
  anti-bot 401/403/405/429 (+ other 4xx + throws) → `unconfirmed`, only 404/410/5xx
  broken; **HEAD-only** external resolver (`resolveExternalHead`, never a GET);
  **remaining-time-aware** soft budget (NOT absolute — the internal pass runs first
  unbounded); worker catch wraps `throttle.wait`+`resolveExternal`; **NO zero-count
  finding** (would inflate `priority.service.calculatePriorityScore` — count-0 scale
  defaults 1.0). EXCLUDED: subdomain reclassification, external-image/link finding
  split, unconfirmed recall, per-client toggle.
- **`priority.service.calculatePriorityScore` scores by type weight × count-scale,
  and the count-0 scale multiplier defaults to 1.0** — so a count-0 run finding is
  NOT inert; it inflates priority/open-issue surfaces. Never emit zero-count findings.
- **The handoff's forward-looking scope drifts — re-map the code first.** Before writing any
  spec, dispatch an Explore/read pass over the actual code; trust code > handoff.
- **Injected-into-page code must stay SWC-helper-free** — `parseSeoFromDocument`
  (`parse-seo-dom.ts`) is `.toString()`-injected; no `typeof`; verify at es2017 on the
  BUILT bundle only when you touch it. (External-link verification touched NONE of it.)
- **Never rely on `Class.name`/function names at runtime** (SWC minifies them).
- **How the SEO health score works:** WEIGHTED COVERAGE RATIO across ~8 factors, NOT a
  count of SF issues. Live SEO score is `scoreLiveSeo` (forked, excludes crawl-depth +
  broken-links); the external-link warning finding does NOT feed it.
- **Canonical-run selection unchanged:** `sf-upload` stays canonical; live-scan segregated;
  a live-scan run (incl. its broken_external_links) NEVER displaces the SEO score.
- **Deploy protocol:** code-only / config-only → plain `~/deploy.sh`;
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
  tests use `// @vitest-environment node`. `tsc --noEmit` has NO `noUnusedLocals`.
- **Handoff-token / public route gotcha (bit us THREE times):** any new token-authed or public
  route MUST get a `middleware.ts` `isPublicPath` entry + a `middleware.test.ts` case.
  (External-link verification added no routes.)
- **Codex session for this workspace:** `019f2b57-...` (registry `~/.claude/state/codex-consultations.json`).
  If a resumed Codex answer looks off-topic, `--fresh`.
- **SDD progress ledger** (`.superpowers/sdd/progress.md`) is git-ignored scratch, OVERWRITTEN each
  feature; per-task report files get REUSED across cycles — tell implementers to OVERWRITE.

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
- 2026-07-03 — **C6 SF-retirement redirect/canonical/hreflang validation MERGED (#96, `270b81f`)
  + DEPLOYED + PROD-VERIFIED.**
- 2026-07-04 — **C9-A (ADA Scoring v2) MERGED (#97, `6e9bb55`) + DEPLOYED + PROD-VERIFIED.**
- 2026-07-04 — **C9-B (ADA-audit frontend consolidation) MERGED (#98, `c082868`) + DEPLOYED +
  PROD-VERIFIED. C9 COMPLETE (both halves).**
- 2026-07-04 — **Streaming parse concurrency (C7 Phase-3 payoff) MERGED (#99, `47c5f87`) + DEPLOYED +
  PROD-VERIFIED.**
- 2026-07-04 — **C6 external-link verification MERGED (#100, `a421c25`) + DEPLOYED + PROD-VERIFIED.**
  Additive HEAD-only external pass (`resolveExternalHead`); separate cap (`BROKEN_LINK_EXTERNAL_MAX_CHECKS`,
  0=kill switch via `parseNonNegativeInt`) + remaining-time-aware budget + failure isolation; emits
  `broken_external_links` (warning) — internal pass byte-unchanged; NO zero-count finding (would inflate
  priority.service); amber UI tier. Spec+plan Codex-reviewed (12 fixes each); subagent-TDD (7 tasks, Task 4
  opus-reviewed); final opus review READY TO MERGE (0 Critical/Important, all 7 invariants verified). Gates:
  tsc + 3183 tests (336 files, +26) + build. No migration. Next: roadmap menu (further C6 / SF-retirement
  Phase 1 / A- or D-track infra).
```
