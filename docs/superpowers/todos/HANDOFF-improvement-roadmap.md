# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-03 (C6 SF-retirement Phase 4 — redirect/canonical/hreflang validation — MERGED+DEPLOYED+PROD-VERIFIED) · **Updated by:** the validation increment (PR #96, `270b81f`). Next is a roadmap-menu choice (no single mandated item).
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: C6 SF-retirement roadmap §2 Phase 4 (redirect/canonical/hreflang
VALIDATION) is now MERGED + DEPLOYED + PROD-VERIFIED (2026-07-03, PR #96,
main `270b81f`). It:
- Added `lib/ada-audit/url-resolver.ts` `resolveUrl()` — a thin wrapper
  exposing the final URL + redirect chain safeFetch already computes but
  checkUrl discarded; checkUrl now delegates to it (byte-identical, regression-
  tested).
- Folded canonical/redirect/hreflang validation into the existing
  `broken-link-verify` builder as ONE dedup'd, same-domain, LEGACY-FIRST
  resolution cache (validation-only URLs can never displace broken-link
  targets). Pure `lib/findings/validation-mapper.ts` emits canonical_broken/
  canonical_redirect, redirect_chain/redirect_loop (only when the link resolves
  OK — broken chains stay broken_internal_links, no double-count),
  hreflang_broken/no_return(in-set reciprocity)/missing_self/missing_x_default/
  invalid_code, + canonical/hreflang_external_unverified run notices — ALL into
  the SAME live-scan CrawlRun.
- Changed hreflang harvest to {lang,href} pairs in the .toString()-injected
  parseSeoFromDocument — VERIFIED SWC-helper-free at es2017 on the DEPLOYED
  .next/server bundle (2026-06-16 typeof→_type_of landmine stays disarmed;
  hreflang selector string present in the deployed chunks = survived minify).
- Same-domain-only INITIAL targets (rule 3 + WAF safety); cross-domain recorded-
  unverified. A same-domain target that redirects off-site IS followed by
  safeFetch (pre-existing Phase-1 behavior, documented not changed).
- New TechnicalSeoSection results block (disjoint validation type-set).
- NO schema migration (canonicalUrl existing column; hreflang in existing
  detailsJson string; new Finding type/affectedSource are free strings) →
  deploy was plain ~/deploy.sh ("No pending migrations").
Pipeline: spec (Codex ×7) → plan (Codex ×9) → subagent TDD (6 tasks, all
per-task reviews Approved) → final opus whole-branch review READY TO MERGE
(8 invariants hold, 0 Critical/Important; 4 Minors folded into f0dab93).
Gates: tsc · 3081 tests (325 files, +26) · build. Prod: online 0 restarts
429MB, HTTP 307, minification-survival CLEAN.
A2/B1–B5/C1–C6(P1–4 + validation)/C7/C8/C10/D0 all COMPLETE + PROD-VERIFIED.
A 16-skill operator library lives in .claude/skills/.

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
   - C9 (ADA scoring v2 + poller/results-view consolidation) — the last unbuilt
     C-track item; 1–1.5 wks.
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
4. LIGHT PENDING behavioral verify (not blocking): the validation increment's
   finding-emission on a REAL client audit — the live-scan builder runs post-
   terminal on the next real audit (weekly canary client 31 / analyst scan);
   covered by gate-green integration tests, inert-until-first-case like A2-f1.
   Also still open: C7 pt1 multi-file File-processing-panel render check.
5. Small open D0 follow-ups (not blocking): set ALERT_WEBHOOK_URL in the server
   .env once Slack admin approves; consider a BACKUP_DIR-unset warning in the
   manual scripts/db-backup.ts; two ~444 MB backups sit in
   /home/seo/data/seo-tools/backups/ (safe to rm the older one).
6. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **MERGED + DEPLOYED + PROD-VERIFIED 2026-07-03: C6 SF-retirement Phase 4 — redirect/canonical/hreflang validation.**
  PR #96 (`270b81f`) merged to main + deployed via plain `~/deploy.sh` (code-only,
  no migration/env — "No pending migrations to apply").
  - **What shipped:** `resolveUrl()` shared resolver + `checkUrl` delegation
    (byte-identical); the `broken-link-verify` builder now resolves ONE dedup'd,
    same-domain, legacy-first cache and derives canonical/redirect/hreflang findings
    (via pure `validation-mapper.ts`) into the SAME live-scan `CrawlRun` alongside
    broken-link + on-page findings; hreflang harvest → `{lang,href}` pairs; new
    `TechnicalSeoSection`. Finding types: `canonical_broken`, `canonical_redirect`,
    `redirect_chain`, `redirect_loop`, `hreflang_broken`, `hreflang_no_return`,
    `hreflang_missing_self`, `hreflang_missing_x_default`, `hreflang_invalid_code`,
    `canonical_external_unverified`, `hreflang_external_unverified`.
  - **Key invariants (verified by the final opus whole-branch review + prod):**
    - `checkUrl` byte-identical (delegates to `resolveUrl`; SafeUrlError-on-HEAD →
      unconfirmed with NO GET preserved). Broken-link findings unchanged.
    - `redirect_chain`/`redirect_loop` fire only when the link resolves OK / loops —
      a broken chain stays `broken_internal_links` (no double-count).
    - Cap is legacy-first → validation-only URLs never displace broken-link targets.
      `affectedComplete` for validation findings = `!capped && !cappedValidation`
      (final-review fix `f0dab93` — redirect findings depend on the LEGACY cap).
    - Page findings aggregate per (type, page) → no `@@unique([runId,dedupKey])`
      collision; validation type-set disjoint from broken_*/on-page.
    - **Injected-function landmine stays disarmed:** es2017 helper-free verified on
      the DEPLOYED `.next/server` bundle; hreflang selector string survived minify.
    - No schema migration; single CrawlRun write + both transient-table deletes +
      recovery/idempotency unchanged.
  - **Same-domain-only initial targets** (rule 3 + WAF safety); cross-domain
    canonical/hreflang recorded-unverified via run notices. A same-domain target
    that redirects off-site is followed by `safeFetch` (pre-existing Phase-1 behavior).
  - **This session:** full pipeline start→ship. Spec Codex-reviewed (accept-with-fixes,
    7 applied — incl. the safeFetch cross-host-redirect honesty + resolver posture +
    chain-shape + mapper aggregation + dedupe-by-lang). Plan Codex-reviewed
    (accept-with-fixes, 9 applied — incl. the Task-5 seoRows-reorder + old-worker-
    removal that made the fold-in compose, the graph.test.ts stub, and the
    esbuild→built-bundle authoritative helper gate). Subagent-driven build (6 tasks;
    Task 5 on opus; one reviewer returned a malformed empty response and was
    re-dispatched). Final opus whole-branch review = READY TO MERGE, 0 Critical/
    Important.
  - **Gate-green in-session:** tsc clean · **3081 tests (325 files, +26)** · build clean.
  - **Post-deploy verification:** app online, 0 restarts, 429MB (well under 2400M),
    HTTP 307 = expected OAuth redirect; **minification-survival PASSED** on the
    deployed bundle. **Behavioral finding-emission** (validation findings on a real
    audit) pends the next real client audit — covered by gate-green integration tests.
  - Spec: `docs/superpowers/archive/specs/2026-07-03-redirect-canonical-hreflang-validation-design.md` ·
    Plan: `docs/superpowers/archive/plans/2026-07-03-redirect-canonical-hreflang-validation.md` (both archived).
- **A1, A2, A2-f1, B1–B5, C1–C6 (P1–3 + autonomous P4 + validation), C7 (all 3 parts), C8, C10, D0 all COMPLETE + PROD-VERIFIED.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00` (noindex → broken-link findings only, null score).
  This is where the validation increment's behavioral prod-verify will naturally land.
- **⚠ PENDING HUMAN STEPS (Kevin):**
  1. **Validation behavioral prod-verify (light):** on the next real client audit, confirm
     the live-scan run carries canonical/redirect/hreflang findings alongside broken-link +
     on-page (one CrawlRun, transient tables cleaned). Not blocking.
  2. **C7 pt1 functional panel-render check (light):** upload a multi-file crawl; confirm
     the File-processing panel buckets render (light+dark) + backward-compat.
  3. **D0:** set `ALERT_WEBHOOK_URL` once Slack admin approves; optional stray-backup rm.
  4. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan 409-blocking the
     localStorage import — keep or delete + re-open).
  5. **First real qct_ push** not yet exercised.
  6. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
- **Blocked / gated:** Anthropic API billing; sitemap miss-rate measurement not yet run;
  daily/nightly cadences still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups:** C6 content similarity (Phase 5) / external-link verification
  (finish Phase 1) / hybrid discovery (Phase 2) / reachability graph + true depth (3b) /
  daily-cadence supersede-trimming; streaming concurrency (C7 Phase-3 payoff, safe on the
  streamed base); C7 pt1 "corrupt-but-parseable core" detection; `trackDomain` per-row
  `findColumn` micro-opt; C8 diff.service.ts score-source migration + draft-weights preview;
  D0 off-box backup replication; standalone single-page audit CSV/VPAT/report; public
  share-page export buttons; expandable rows on public ADA share view; logo for the PDF;
  `SessionPage` model drop (≥180 d after 2026-06-11); same-URL standalone-audit diffing;
  fleet instance-level diffing; B2 v1 multi-domain limitation; SF-retirement campaign Phase 1.

## Next item

**No single mandated item — C6 validation is fully shipped.** Pick from the roadmap
menu (ask Kevin or choose) and run the full pipeline:
- **C9** — ADA scoring v2 + poller/results-view consolidation (the last unbuilt C-track item, 1–1.5 wks).
- **Further C6** — content similarity (Phase 5) / external-link verification (finish Phase 1) / hybrid discovery (Phase 2, the big architectural one) / reachability graph (3b).
- **SF-retirement Phase 1** — SF-vs-live PARITY MEASUREMENT (load `er-seo-tools-sf-retirement-campaign`).
- **Streaming concurrency** — the C7 Phase-3 payoff, safe on the streamed base; small.

## Gotchas / decisions already made (don't relitigate)

- **C6 validation decisions (locked 2026-07-03):** Full Phase 4 scope (canonical + redirect + hreflang incl. hreflang hrefs); fold into the existing `broken-link-verify` builder (one dedup'd cache, no new job); same-domain-only initial targets (cross-domain recorded-unverified); new `TechnicalSeoSection` (not extending the existing two); validation findings do NOT enter `scoreLiveSeo` (frozen factor set); no schema migration.
- **safeFetch follows redirects ACROSS hosts** (SSRF-checked per hop, not same-domain-enforced) — so a same-domain target that 301s off-site IS fetched off-site. This is PRE-EXISTING Phase-1 behavior; we document it, we do NOT add an allowed-host redirect policy (would fork safeFetch + change broken-link behavior).
- **`checkUrl` precision posture** (preserved by `resolveUrl`): SafeUrlError on HEAD (incl. 'Too many redirects') → `unconfirmed` immediately with NO GET; only a non-SafeUrlError HEAD throw or HEAD≥400 confirms with GET.
- **safeFetch `redirects[]` already ends at the final URL** — `resolveUrl.chain = redirects` verbatim; do NOT append `finalUrl` (would duplicate).
- **`parseSeoFromDocument` is `.toString()`-injected → MUST stay SWC-helper-free** — no `typeof`, no spread-of-unknown; verify at es2017 on the BUILT `.next/server` bundle (esbuild is only a dev precheck). Object-literal + imperative loops are safe.
- **hreflang dedupe:** `new Set()` of objects does NOT dedupe by lang — use an explicit seen-lang guard.
- **Reusable real crawl:** `/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25`
  — full manhattanschool.edu SF export (existing client). Never scan non-client sites.
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
  React render tests need `afterEach(cleanup)` + `// @vitest-environment jsdom`; parser/node
  tests use `// @vitest-environment node`.
- **Handoff-token / public route gotcha (bit us THREE times):** any new token-authed or public
  route MUST get a `middleware.ts` `isPublicPath` entry + a `middleware.test.ts` case. (C6 validation added no routes.)
- **Codex session for this workspace:** `019f2b57-...` (registry `~/.claude/state/codex-consultations.json`). The prior `019f14d4-...` was archived after it returned a stale (C7) answer on resume — a FRESH session gave the clean C6-P4 review. If a resumed Codex answer looks off-topic, `--fresh`.
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
  + DEPLOYED + PROD-VERIFIED.** resolveUrl + checkUrl-delegate + validation-mapper folded into the
  live-scan builder (legacy-first cache) + hreflang-href harvest (es2017 helper-free on deployed bundle)
  + TechnicalSeoSection; no migration. Spec+plan Codex-reviewed (16 findings applied); subagent-built
  (6 tasks), final opus review READY TO MERGE. Gates: tsc + 3081 tests + build. Next: roadmap menu
  (C9 / further C6 / SF-retirement Phase 1 / streaming concurrency).
