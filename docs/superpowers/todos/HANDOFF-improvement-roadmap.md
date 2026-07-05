# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-05 (SF-retirement Phase 1 — kickoff + 6 fresh SF crawls landed on disk; docs-only, no code) · **Updated by:** the SF-retirement-Phase-1 session. Next action is **operational**: Kevin uploads the 7 fresh SF crawls at /seo-parser + triggers matching seoIntent audits, recording parity + discoveryCoverageJson per domain.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: SF-retirement Phase 1 (SF-vs-live PARITY MEASUREMENT + collect
discoveryCoverageJson miss-rate DATA) is IN PROGRESS. This work is OPERATIONAL
(a query/data problem, not a build) and spans 2-3 reporting cycles, so it does
not complete in one session. Kickoff done 2026-07-05 (docs-only, no code):
- Corrected the campaign skill's stale "Phase 0 = next action": Phase 0
  (feat/autonomous-live-seo-source: seoIntent + pickCanonicalSeo + CrawlRun-native
  /seo-parser) was MERGED as PR #85 on 2026-07-02 (verified git log
  main..feat/autonomous-live-seo-source = 0; seoIntent + lib/services/seo-canonical.ts
  on main). Phase 1 is correctly the work.
- Read-only prod inventory (all tool:'seo-parser' CrawlRuns): 83 total = 7
  sf-upload + 76 live-scan, of which ONLY 1 is seoIntent (manhattanschool.edu,
  score 98, ~2.7d). discoveryCoverageJson: 0 runs. discoveryMode: 0 audits.
  → The C6 Increment-1 miss-rate stream has produced ZERO data points because NO
  site audit has run since Increment 1 deployed 2026-07-04 (weekly canary last
  fired Mon 2026-06-30, next Mon 2026-07-07; the lone seoIntent run also predates
  it). This IS the handoff's long-standing "FIRST GATE DATA POINT still pending."
- First parity data point recorded (sf-live-parity.ts manhattanschool.edu, prod,
  read-only): SF run de498917 score 82 (168 pages) vs Live run 54680dd9 score 98
  (66 pages, seoIntent) → Δ+16 (expected — Live scores a narrower factor set);
  page-set Jaccard 0.337 (LOW, but SF's 168 is inflated by asset URLs SF crawls
  and the page-only live scan doesn't; SF-only set ALSO holds real content pages
  sitemap-discovery missed — /admissions /programs /career-placement-support/
  /student-success /book-a-tour/ — evidence FOR hybrid-discovery Phase 2, to be
  quantified cleanly by discoveryCoverageJson); only shared issue type
  duplicate_title 1|1 (Δ0); ~70 SF-only types = expected capability gaps. All
  deviations explained.
- SF-SIDE PREREQUISITE NOW MET: Kevin manually ran 6 fresh full SF crawls on
  2026-07-05 (GA4+GSC + 47-CSV bulk exports) into sf-crawls/, plus manhattan
  (2026-07-03) = 7 clients: bidwell(3)=bidwelltraining.edu,
  boca(4)=bocabeautyacademy.edu, brockway(5)=brockwaycatart.org,
  brownson(6)=brownson.edu, cambria(29)=cambriacollege.ca,
  discovery(26)=discoverycommunitycollege.com, manhattan(12)=manhattanschool.edu.
  GA4/GSC verified CORRECT on the bidwell export (matched property, real metrics).
  BUT these are on DISK — they become the SF half of a parity pair ONLY after
  upload at /seo-parser (creates a Session + sf-upload CrawlRun). Only 3 domains
  (manhattan/glow/nuvani) are uploaded in prod so far. NO active client has
  seedUrls → all eligible for sitemap-mode miss-rate.
- Deliverable: docs/superpowers/todos/2026-07-05-sf-live-parity-log.md (data-state
  snapshot + manhattan data point + full candidate list incl. the 6 disk crawls +
  per-domain operational plan).
A2/A2-f1/A3/B1-B5/C1-C10/C9(A+B)/D0 all COMPLETE + PROD-VERIFIED. A1 COMPLETE.
C7 fully complete. C6: Phases 1-4 + on-page + live score + redirect/canonical/
hreflang validation + external-link verification + hybrid-discovery Increment 1
(miss-rate MECHANISM, 0 data yet) all shipped. A 16-skill operator library lives
in .claude/skills/.

1. Load the skill er-seo-tools-change-control first. Gate policy (2026-07-03
   ruling, rules 1 & 4): THIS PASTED PROMPT is standing authorization to merge
   pending roadmap PRs at session start (re-run the gates lint/test/build on the
   PR branch in this session first) and to deploy when needed, ALWAYS followed
   immediately by post-deploy verification. Destructive server ops (prod data
   deletion, server .env edits, DB restore) stay Kevin-gated; docs rituals
   mandatory; never scan non-client sites. Brainstorm->spec->plan runs ungated.
   Route design questions to Codex, not Kevin.
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md + the tracker
   docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md + the parity
   log docs/superpowers/todos/2026-07-05-sf-live-parity-log.md. Trust ranking
   when docs disagree: code > plan/spec > tracker/handoff. Always re-map the
   actual code before writing a spec (the campaign skill was already found stale
   this session — Phase 0 was long merged).
3. THE IMMEDIATE NEXT STEP is OPERATIONAL (needs Kevin's authed prod session —
   OAuth-only, no automated cookie; Kevin via UI, or supplies an er_auth cookie
   for the runbook curls). The SF crawls exist on disk for 7 clients; run this
   per-domain loop for {manhattan 12, bidwell 3, boca 4, brockway 5, brownson 6,
   cambria 29, discovery 26}:
   a. UPLOAD the fresh SF export at /seo-parser → Session + sf-upload CrawlRun
      (manhattan already uploaded — skip its upload). SF export dirs are under
      /Users/kevin/enrollment-resources/sf-crawls/<slug>/<newest-timestamp>/.
   b. TRIGGER a seoIntent audit on the same domain (er-seo-tools-sf-retirement-campaign
      Gate 0.3 Step 2: POST /api/site-audit {domain, wcagLevel:'wcag21aa',
      clientId:<id>, seoIntent:true}) → live-scan run + discoveryCoverageJson
      (the FIRST miss-rate data point comes from any indexable client here).
   c. RECORD both: on prod, cd /home/seo/webapps/seo-tools && npx tsx
      .claude/skills/er-seo-tools-sf-retirement-campaign/scripts/sf-live-parity.ts <domain>
      AND read the live run's discoveryCoverageJson (mode/offBaselineCount/missRate);
      append a dated data point to 2026-07-05-sf-live-parity-log.md.
   Start with manhattan (both halves exist — just needs a FRESH post-Increment-1
   seoIntent audit for its first discoveryCoverageJson), then the 6 disk crawls.
   If Kevin would rather switch tracks while data accumulates, the menu is open:
   further C6 (hybrid discovery Increment 2 is GATED on this miss-rate data;
   reachability graph 3b; content similarity Phase 5) · Track A infra (A4
   observability /api/health + pino + /admin/ops, builds on A3's lib/api/ kit; A5
   SSE; A6 UI primitives; A7 auth+Playwright) · Track D (D1 handoff-engine
   consolidation; D3 shared lib/seo-fetch/; D4 client robots/sitemap checks; D6
   RankMath generator).
4. Reusable real crawl for any fixture/parity need (never scan non-client sites):
   /Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25
   (all exports; manhattanschool.edu is client 12).
5. Small open follow-ups (not blocking):
   - tokenErrorCode() expired-token bug (found in A3): expired qct_ tokens report
     token_invalid not token_expired — the 'expired' substring test never matches
     jose's '"exp" claim timestamp check failed'. Fix + repoint the Phase-1 test
     (currently pins the WRONG behavior with a comment).
   - A3 doc caveat: withRoute would 500 a thrown Next redirect()/notFound()
     (non-Response control-flow throw). No adopted route uses them; add a one-line
     note to the kit guidance if a future route needs to throw a redirect.
   - D0: set ALERT_WEBHOOK_URL in the server .env once Slack admin approves;
     optional BACKUP_DIR-unset warning in scripts/db-backup.ts; two ~444 MB backups
     in /home/seo/data/seo-tools/backups/ (safe to rm the older one).
   - Stray untracked server files: ~/probe-beal.ts.bak, audit-aggregate.js,
     audit-snapshot.js, .env.*.bak, lighthouse-reports/ (Kevin may rm). This
     session's read-only prod scratch scripts were all cleaned up (none left).
6. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **IN PROGRESS 2026-07-05: SF-retirement Phase 1 (parity + miss-rate data collection).**
  Docs-only kickoff (no code). This is OPERATIONAL and multi-cycle — it does not
  finish in one session.
  - **Corrected the campaign skill's stale premise:** it treats "Phase 0 = merge
    feat/autonomous-live-seo-source" as the next action, but that branch merged as
    PR #85 on 2026-07-02 (verified on main). Phase 1 is the real work.
  - **Prod data state (read-only inventory, 2026-07-05):** 83 seo-parser CrawlRuns
    = 7 sf-upload + 76 live-scan; **only 1 seoIntent** (manhattan, score 98).
    **discoveryCoverageJson: 0 runs. discoveryMode: 0 audits** — the miss-rate
    mechanism (deployed 2026-07-04) has produced no data because no audit has run
    since. First data needs a post-2026-07-04 seoIntent audit of an indexable
    client site with a sitemap.
  - **First parity data point recorded** (manhattan): Δ+16 score (Live 98 / SF 82),
    Jaccard 0.337 (asset-inflated on the SF side + real sitemap-missed content
    pages), duplicate_title the only shared type (Δ0). All deviations explained.
  - **SF-side prerequisite now MET:** Kevin manually ran 6 fresh full SF crawls
    2026-07-05 (GA4+GSC + 47-CSV exports) into `sf-crawls/` — bidwell(3), boca(4),
    brockway(5), brownson(6), cambria(29), discovery(26) — plus manhattan(12) from
    07-03 = **7 clients**. GA4/GSC verified correct on the bidwell export. These are
    on DISK; they become `sf-upload` runs only after upload at `/seo-parser`.
  - **Deliverable:** `docs/superpowers/todos/2026-07-05-sf-live-parity-log.md`
    (data-state snapshot + manhattan data point + full candidate list + per-domain plan).
  - **Blocker:** filling both streams needs Kevin's authed prod session (OAuth-only)
    to (a) upload the disk SF crawls at `/seo-parser` and (b) trigger matching
    seoIntent audits, then record parity + `discoveryCoverageJson` per domain.
- **A1, A2, A2-f1, A3, B1–B5, C1–C10, C9(A+B), D0 all COMPLETE + PROD-VERIFIED.**
  C7 fully complete. C6 Phases 1–4 + on-page + live score + redirect/canonical/hreflang
  validation + external-link verification + hybrid-discovery Increment 1 (miss-rate MECHANISM) shipped.
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. Noindex → good for plumbing, near-empty for on-page/coverage.
  Next fire Mon 2026-07-07 (first audit on Increment-1 code → will set discoveryMode, but noindex ⇒ weak miss-rate).
- **⚠ PENDING HUMAN STEPS (Kevin), none blocking a code change but blocking Phase-1 data:**
  1. **Trigger seoIntent audits** (manhattan first, then glow/nuvani) → discoveryCoverageJson + parity pairs.
  2. **Fresh SF uploads on ≥2 more clients** (analysts) → reach the ≥5-client parity gate.
  3. **A3 error-envelope behavioral checks** — cookie-gated normalizations fire incidentally on normal use.
  4. **External-link behavioral check** · **streaming-concurrency wall-clock** · **C9-A v2-scale · C9-B UI-render · C6-validation finding-emission · C7 pt1 panel** (all light).
  5. **`tokenErrorCode()` expired-token bug** (found in A3) — fix + repoint the Phase-1 test.
  6. **D0:** set `ALERT_WEBHOOK_URL`; optional stray-backup + stray-server-file rm.
  7. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan 409-blocking the localStorage import).
  8. **First real qct_ push** not yet exercised.
  9. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
- **Blocked / gated:** Anthropic API billing; **hybrid-discovery Increment 2 (the crawler) gated on
  the Increment-1 miss-rate DATA** (now actively being collected — Phase 1); daily/nightly cadences gated.
- **Parked follow-ups:** hybrid discovery Increment 2 / reachability graph 3b / content similarity
  Phase 5; A3 minors (withRoute redirect()/notFound() doc caveat, test-fixture dedup, explicit
  unmapped-Prisma-code→500 test); discovery-coverage Minors; manual-UI-flow discovery mode threading;
  external-link partial-coverage UI Minor; C9-B optional `AuditHeaderCard`; C9-A site-level v2-compliance
  rollup; C7 pt1 corrupt-core detection; C8 diff score-source migration; D0 off-box backup replication;
  standalone single-page audit CSV/VPAT/report; public share-page export buttons; expandable rows on
  public ADA share; logo for the PDF; `SessionPage` model drop (≥180 d after 2026-06-11); A4–A7 infra; D1–D6 workflow-polish.

## Next item

**SF-retirement Phase 1 is in progress and is OPERATIONAL — the next action needs Kevin's authed
prod session, not code.** Fresh SF crawls now exist on disk for 7 clients (SF-side prerequisite met).
Per-domain loop for {manhattan 12, bidwell 3, boca 4, brockway 5, brownson 6, cambria 29, discovery 26}:
1. **Upload** the fresh SF export at `/seo-parser` → `sf-upload` run (manhattan already uploaded).
2. **Trigger** a `seoIntent` audit on the same domain → live-scan run + `discoveryCoverageJson`
   (the first miss-rate data point comes from any indexable client here).
3. **Record** both: `sf-live-parity.ts <domain>` + the live run's `discoveryCoverageJson`; append a
   dated data point to `2026-07-05-sf-live-parity-log.md`.
Start with **manhattan** (both halves exist — needs a fresh post-Increment-1 seoIntent audit for its
first `discoveryCoverageJson`), then the 6 disk crawls.

**If Kevin prefers to switch tracks while data accumulates** (the data cadence is inherently multi-week):
- **Further C6** — hybrid discovery Increment 2 (the crawler, GATED on this miss-rate data) / reachability
  graph 3b / content similarity Phase 5.
- **Track A infra** — A4 observability (`/api/health` + pino + `/admin/ops`, builds on A3's `lib/api/`)
  / A5 SSE / A6 UI primitives / A7 auth+Playwright.
- **Track D** — D1 handoff-engine consolidation / D3 shared lib/seo-fetch/ / D4 client robots-sitemap / D6 RankMath generator.

## Gotchas / decisions already made (don't relitigate)

- **The campaign skill (`er-seo-tools-sf-retirement-campaign`) is STALE on Phase 0** — it says "merge
  feat/autonomous-live-seo-source" is the next action; that branch merged as PR #85 (2026-07-02).
  Phase 1 (parity + miss-rate data) is the current campaign work.
- **Phase 1 is a measurement/query problem, not a build.** Both sources land as `CrawlRun`s; the
  read-only `sf-live-parity.ts` script + `discoveryCoverageJson` are the instruments. Do NOT build
  anything for Phase 1 — record numbers and explain deviations.
- **Miss-rate cleanliness:** raw parity Jaccard is asset-inflated (SF crawls CSS/JS/images; the live
  scan is page-only). The clean sitemap-miss instrument is `discoveryCoverageJson` (excludes images +
  non-page extensions). Use it for the Increment-2 gate; use Jaccard only as a rough proxy.
- **Triggering audits needs auth** — prod is OAuth-only (`ALLOW_PASSWORD_LOGIN=false`). No automated
  cookie exists; do NOT invent a direct-enqueue bypass. Kevin triggers via UI or supplies an `er_auth`
  cookie for the documented runbook curls. Scanning CLIENT sites is authorized (rule 3 forbids only third-party).
- **A3 kit decisions (locked 2026-07-05):** `withRoute` does NO auth (middleware is the single cookie
  gate); no zod; logging deferred to A4; Prisma P2025→404/P2002→409 is a LAST-RESORT net (routes that
  already handle a Prisma code keep their own error string); `withRoute` passes handler-returned AND
  thrown `Response` through; bad-JSON→`invalid_json`, unhandled-500→`internal_error` across adopted
  routes; `brief/[sessionId]` keeps its `{}`-default. New routes should adopt `withRoute` + `parseJsonBody`.
- **`priority.service.calculatePriorityScore` scores by type weight × count-scale, count-0 scale
  defaults 1.0** — a count-0 run finding is NOT inert. Never emit zero-count findings; surface
  measurement/coverage as run metadata (`discoveryCoverageJson`) or `run.status`, never a Finding.
- **The handoff's forward-looking scope drifts — re-map the code first.** Before writing any spec,
  dispatch an Explore/read pass over the actual code; trust code > handoff (proven again this session).
- **Deploy gotcha — stray untracked `.ts` files on the server break the build** when you change a public
  function's signature (`next build` type-checks EVERY `.ts`/`.tsx`, incl. untracked scratch files).
  Keep scratch scripts OUTSIDE the repo tree (`/home/seo/*.ts`, not `/home/seo/webapps/seo-tools/**`).
  Known strays: `~/probe-beal.ts.bak`, audit-aggregate.js/audit-snapshot.js/.env.*.bak/lighthouse-reports/,
  plus this session's `~/parity-inventory.ts` + `~/sf-domains.ts` (both read-only, outside repo, safe).
- **Injected-into-page code must stay SWC-helper-free** — `parseSeoFromDocument` (`parse-seo-dom.ts`) is
  `.toString()`-injected; no `typeof`; verify at es2017 on the BUILT bundle only when you touch it.
- **Never rely on `Class.name`/function names at runtime** (SWC minifies them).
- **Canonical-run selection (on main since PR #85):** `pickCanonicalSeo` — fresh SF (≤30 d) wins; a
  newer seoIntent live run supersedes; a NON-seoIntent live run can NEVER be canonical. Live score
  never displaces the sf-upload canonical outside the freshness window.
- **Deploy protocol:** code-only / config-only → plain `~/deploy.sh` (migrations apply automatically);
  `ecosystem.config.js`/env changes → `pm2 delete && pm2 start`. Prod has NO `sqlite3` CLI — drive
  read-only prod queries with a throwaway `.ts`/`.mjs` (outside the repo tree) via `npx tsx` from the app dir.
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`); prod DB `/home/seo/data/seo-tools/db.sqlite`;
  prod URL `https://seo.erstaging.site`. Unauth API requests → `401 {"error":"auth_required"}`.
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only.
- **Never `git add -A` at repo root** — `pentest-results/`, `googlefc472dc61896519a.html`,
  `SEO_Report_1st_Draft.pdf` are untracked + not gitignored. Add specific paths only.
- **Local dev quirk:** prefix prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`.
  React render tests need `afterEach(cleanup)` + `// @vitest-environment jsdom`. `tsc --noEmit` has NO
  `noUnusedLocals`. Test env pins UPLOADS_DIR to a non-writable prod path → mock `fs/promises`. Use
  BLOCK-BODY `beforeEach(() => { mock.mockReset() })`. Quarter-plan route tests MUST stay in the
  `quarter-plan/route.test.ts` monolith (singleton DB) — never a sibling file.
- **Handoff-token / public route gotcha (bit us THREE times):** any new token-authed or public route
  MUST get a `middleware.ts` `isPublicPath` entry + a `middleware.test.ts` case.
- **Codex session for this workspace:** `019f2b57-...` (registry `~/.claude/state/codex-consultations.json`).
  If a resumed Codex answer looks off-topic, `--fresh`.

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, handoff created.
- 2026-06-10 — A1 Phases 0–4 (PRs #50–#54), prod-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), prod-verified. **A2 COMPLETE.**
- 2026-06-11 — B1–B5 (#60–#64 + middleware fix) shipped + prod-verified. **TRACK B COMPLETE.**
- 2026-06-11/12 — C1 (#65), C2 (#66), C3 (#67), C4 (#68), C5 (#69) SHIPPED.
- 2026-06-16/17 — C6 Phases 1–3 (#70, #71, #73) SHIPPED + prod-verified.
- 2026-06-22 — C10 (#75) + build-heap fix (#76), deployed, migration applied.
- 2026-06-30 — C6 Phase 4 (autonomous live SEO source) BUILT.
- 2026-07-02 — Skill library SHIPPED (`57ae636`). C6 Phase 4 MERGED+DEPLOYED (#85)+VERIFIED (Phase 0 done).
  C10 PROD-VERIFIED (COMPLETE). D0 SHIPPED (#86)+DEPLOYED+VERIFIED (COMPLETE). A2-f1 COMPLETE.
- 2026-07-03 — **C8 BUILT+MERGED (#90)+DEPLOYED+PROD-VERIFIED.** Upload hotfix **PR #91**. **C7 (all 3 parts)
  MERGED (#93/#94/#95) + DEPLOYED + PROD-VERIFIED.** **C6 redirect/canonical/hreflang validation MERGED (#96).**
- 2026-07-04 — **C9-A (#97) + C9-B (#98) = C9 COMPLETE. Streaming parse concurrency (#99). C6 external-link
  verification (#100). C6 hybrid discovery Increment 1 (sitemap miss-rate MEASUREMENT, #101, `9a70368`)** —
  all MERGED + DEPLOYED + PROD-VERIFIED. Migration `20260704120000_discovery_coverage`.
- 2026-07-05 — **A3 (API route kit + tests for the 16 untested routes) MERGED (#102, `c0cbb22`) + DEPLOYED +
  PROD-VERIFIED. A3 COMPLETE.** `lib/api/` kit; count corrected 21→16; kit on 8 routes; found+pinned the
  `tokenErrorCode()` expired-token bug.
- 2026-07-05 — **SF-retirement Phase 1 KICKOFF (docs-only).** Corrected the campaign skill's stale Phase-0
  premise (merged 2026-07-02); read-only prod inventory → **0 discoveryCoverageJson data points** (no audit
  since Increment 1 deployed) + only 1 seoIntent run; first parity data point recorded (manhattan Δ+16,
  Jaccard 0.337, all deviations explained); parity log `2026-07-05-sf-live-parity-log.md` created.
- 2026-07-05 — **6 fresh full SF crawls landed on disk** (Kevin, manual): bidwell/boca/brockway/brownson/
  cambria/discovery (+ manhattan 07-03) = 7 clients with GA4+GSC + 47-CSV exports; GA4/GSC verified correct
  on the bidwell export. SF-side prerequisite for the ≥5-client gate MET. Next action operational: upload at
  /seo-parser + trigger matching seoIntent audits + record parity/coverage (Kevin's authed session; OAuth-only).
```
