# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-05 (A3 API route kit — MERGED+DEPLOYED+PROD-VERIFIED) · **Updated by:** the A3 session (PR #102, main `c0cbb22`). Next is a roadmap-menu choice (no single mandated item).
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: A3 (API route kit + tests for the untested routes) is now MERGED +
DEPLOYED + PROD-VERIFIED (2026-07-05, PR #102, main `c0cbb22`). It added a small
`lib/api/` route kit and closed the untested-route gap with zero net prod risk.
- Scope was corrected from code first: roadmap said "14 untested" but the tree
  had 73 routes / 52 sibling tests; Codex plan review found the 5 quarter-plan
  subroutes were already covered in the `quarter-plan/route.test.ts` monolith →
  REAL untested count = 16. Auth is entirely middleware-owned, so `withRoute`
  gets NO auth; logging deferred to A4; no zod.
- What shipped (tests-first, adopt-incrementally):
  - Phase 1: characterization tests pinning current behavior of all 16 untested
    routes (incl. deliberately pinned quirks: the two `brief` 500 `error.message`
    leaks, `clients`-POST-bad-JSON-500, `brief/[sessionId]`'s `{}`-default).
  - Phase 2: `lib/api/` kit — `errors.ts` (`HttpError`), `body.ts`
    (`parseJsonBody`→`400 invalid_json`), `with-route.ts` (`withRoute`: passes
    handler-returned AND thrown `Response` through; `HttpError`→status+code;
    Prisma `P2025`→404/`P2002`→409 as a LAST-RESORT net; unknown→`500
    internal_error` with NO message leak; rest-args generic type-checks no-arg
    `GET()` + `(req,ctx)`).
  - Phase 3: kit adopted on 8 plain-JSON cookie-gated routes under their green
    Phase-1 tests. Streaming/file/public-share/token routes are test-only in v1.
  - Deliberate normalizations (all test-pinned): `clients` POST bad-JSON 500→400
    `invalid_json`; both `brief` 500s stop leaking `error.message` →
    `internal_error` (`brief/[sessionId]` KEEPS `.catch(()=>({}))`);
    `diff`/`quarter-plan/import`/`site-audit checks`/`ada-audit checks` bad-JSON
    string→`invalid_json`; cross-route: removing a route's inline 500 catch
    standardizes its unhandled-500 body to `internal_error` (route-specific
    strings like `clients`' human duplicate-name 409 PRESERVED via explicit
    P2002 catch, never the generic mapper).
- Process: spec Codex accept-with-fixes; plan Codex accept-with-fixes ×6
  (quarter-plan monolith / count 21→16, APP_AUTH_PASSWORD stub, screenshots
  404-only, no flaky accessCount assert, preserve brief {} default, thrown-
  Response passthrough); subagent-driven TDD (16 tasks, all reviews Approved,
  3 fix-loops); final opus whole-branch review READY TO MERGE (0 Critical/0
  Important). Gates re-run in the merging session: tsc + 3320 tests (361 files)
  + build. Plain `~/deploy.sh` (no migration).
- Latent bug found + pinned (NOT fixed — needs a separate ticket):
  `tokenErrorCode()`'s `'expired'` substring never matches jose's real expiry
  message → an expired `qct_` token returns `token_invalid` not `token_expired`.
A2/A2-f1/B1–B5/C1–C10/C9(A+B)/D0 all COMPLETE + PROD-VERIFIED. A1, A3 COMPLETE.
C7 fully complete. C6: Phases 1–4 + on-page + live score + redirect/canonical/
hreflang validation + external-link verification + hybrid-discovery Increment 1
(miss-rate measurement) all shipped. A 16-skill operator library lives in
.claude/skills/.

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
   handoff's forward-looking scope drifts (A3 proved this: "14 untested" was
   really 16, and 5 quarter-plan routes were already tested).
3. THE IMMEDIATE NEXT STEP: roadmap-menu choice (no single mandated item). Ask
   Kevin which, or pick and proceed via the full pipeline (brainstorm → spec →
   Codex → plan → Codex → subagent TDD → gates → PR → merge → deploy → verify →
   docs ritual):
   - SF-retirement data stream (Phase 1): run the existing SF-vs-live PARITY
     script across ≥5 clients × 2–3 cycles AND collect `discoveryCoverageJson`
     across real seoIntent audits — this DATA gates hybrid-discovery Increment 2
     (the crawler). Operational more than code. Load er-seo-tools-sf-retirement-campaign.
   - Further C6 (SF-retirement §5): hybrid discovery INCREMENT 2 (the capped BFS
     crawler — gated on the Increment-1 miss-rate DATA) · reachability graph +
     true depth (3b) · content similarity (Phase 5, embeddings asset in deps).
   - Track A infra: A4 observability floor (`/api/health` + pino + `/admin/ops`)
     · A5 SSE hook · A6 shared UI primitives · A7 auth hardening + Playwright.
     (A3's `lib/api/` kit is now the pattern new routes/A4 build on.)
   - Track D: D1 handoff-engine consolidation · D3 shared lib/seo-fetch/ · D4
     client robots/sitemap checks · D6 RankMath redirect generator.
   - Reusable real crawl for any fixture/parity need:
     /Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25
     (all exports; manhattanschool.edu is an existing client). Never scan non-client sites.
4. LIGHT PENDING behavioral verify (not blocking, all inert-until-first-case):
   - A3 error-envelope normalizations: the adopted routes' new codes
     (`clients` POST bad-JSON 400 `invalid_json`; `brief` 500 `internal_error`
     no-leak; the `*/checks` + `diff` + `import` bad-JSON `invalid_json`) are
     cookie-gated → confirmed deployed, but only fire on the specific inputs
     with a session. Exercise incidentally via normal dashboard use.
   - Sitemap miss-rate (C6 Increment 1): FIRST GATE DATA POINT still pending — a
     real seoIntent audit of an indexable client site WITH a sitemap →
     `discoveryCoverageJson` `mode:'sitemap'` + plausible `offBaselineCount`.
   - External-link verification: `broken_external_links` amber tier on the next
     client audit with outbound links.
   - Streaming concurrency wall-clock on a real multi-big-file upload (Manhattan 49-CSV).
   - C9-A v2-scale · C9-B UI-render · C6-validation finding-emission · C7 pt1 File-processing panel.
5. Small open follow-ups (not blocking):
   - **`tokenErrorCode()` expired-token bug** (found in A3): expired `qct_`
     tokens report `token_invalid` not `token_expired` — the `'expired'`
     substring test never matches jose's `'"exp" claim timestamp check failed'`.
     Fix + a pinning test (the Phase-1 test currently pins the WRONG behavior
     with a comment).
   - **A3 doc caveat:** `withRoute` would 500 a thrown Next `redirect()`/
     `notFound()` (non-`Response` control-flow throw). No adopted route uses
     them; add a one-line note to the kit's CLAUDE.md/SKILL guidance if a future
     route needs to throw a redirect.
   - D0: set `ALERT_WEBHOOK_URL` in the server .env once Slack admin approves;
     optional BACKUP_DIR-unset warning in scripts/db-backup.ts; two ~444 MB
     backups in /home/seo/data/seo-tools/backups/ (safe to rm the older one).
   - Stray untracked server files: `~/probe-beal.ts.bak`, audit-aggregate.js,
     audit-snapshot.js, .env.*.bak, lighthouse-reports/ (Kevin may rm).
6. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **MERGED + DEPLOYED + PROD-VERIFIED 2026-07-05: A3 API route kit.** PR #102
  (`c0cbb22`) merged to main + deployed via plain `~/deploy.sh` (no migration).
  - **What shipped (tests-first, adopt-incrementally; zero net prod risk):**
    - `lib/api/` kit: `errors.ts` (`HttpError`), `body.ts` (`parseJsonBody`→`400 invalid_json`),
      `with-route.ts` (`withRoute` — uniform envelope, Prisma last-resort net, no 500 leak,
      passes handler/thrown `Response` through, rest-args generic).
    - Characterization tests for the **16** sibling-untested routes (count corrected 21→16 — 5
      quarter-plan subroutes already in the monolith test, extended in-place).
    - Kit adopted on 8 plain-JSON cookie-gated routes; streaming/file/public-share/token routes test-only.
  - **Key decisions (locked, don't relitigate):** no auth in `withRoute` (middleware owns it);
    no zod; logging deferred to A4; Prisma mapping is a LAST-RESORT net (route-specific error
    strings preserved via explicit catches); `brief/[sessionId]` keeps its `{}`-default; bad-JSON
    standardizes to `invalid_json` across adopted routes; 500s standardize to `internal_error`.
  - **Gate-green in the merging session:** tsc clean · **3320 tests (361 files)** · build compiled.
  - **Post-deploy verification:** commit `c0cbb22`; `lib/api/` present + compiled into `.next/server`;
    clean boot; gated API route → `401 {"error":"auth_required"}`; login 200. Error-envelope
    normalizations are cookie-gated → inert until exercised with a session.
  - Spec: `../archive/specs/2026-07-05-api-route-kit-design.md` · Plan: `../archive/plans/2026-07-05-api-route-kit.md` (both archived).
- **A1, A2, A2-f1, A3, B1–B5, C1–C10, C9(A+B), D0 all COMPLETE + PROD-VERIFIED.**
  C7 fully complete. C6 Phases 1–4 + on-page + live score + redirect/canonical/hreflang
  validation + external-link verification + hybrid-discovery Increment 1 (miss-rate measurement) shipped.
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. Noindex → good for plumbing, near-empty for on-page/coverage.
- **⚠ PENDING HUMAN STEPS (Kevin), none blocking:**
  1. **A3 error-envelope behavioral checks** — cookie-gated normalizations fire incidentally on
     normal dashboard use; confirmed deployed.
  2. **Sitemap miss-rate first data point** (C6 Increment 1) — next real seoIntent audit of an
     indexable client site with a sitemap. Gates hybrid-discovery Increment 2.
  3. **Seed-url fleet audit** — how many campaign clients have `Client.seedUrls` (those show "not
     applicable" → fewer applicable miss-rate data points).
  4. **External-link behavioral check** · **streaming-concurrency wall-clock** · **C9-A v2-scale ·
     C9-B UI-render · C6-validation finding-emission · C7 pt1 panel** (all light).
  5. **`tokenErrorCode()` expired-token bug** (found in A3) — fix + repoint the Phase-1 test.
  6. **D0:** set `ALERT_WEBHOOK_URL`; optional stray-backup + stray-server-file rm.
  7. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan 409-blocking the localStorage import).
  8. **First real qct_ push** not yet exercised.
  9. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is gained.
- **Blocked / gated:** Anthropic API billing; **hybrid-discovery Increment 2 (the crawler) gated on
  the Increment-1 miss-rate DATA** (collect it across clients first); daily/nightly cadences gated.
- **Parked follow-ups:** hybrid discovery Increment 2 / reachability graph 3b / content similarity
  Phase 5; A3 minors (withRoute redirect()/notFound() doc caveat, test-fixture dedup, explicit
  unmapped-Prisma-code→500 test); discovery-coverage Minors; manual-UI-flow discovery mode threading;
  external-link partial-coverage UI Minor; C9-B optional `AuditHeaderCard`; C9-A site-level v2-compliance
  rollup; C7 pt1 corrupt-core detection; C8 diff score-source migration; D0 off-box backup replication;
  standalone single-page audit CSV/VPAT/report; public share-page export buttons; expandable rows on
  public ADA share; logo for the PDF; `SessionPage` model drop (≥180 d after 2026-06-11); SF-retirement
  campaign Phase 1; A4–A7 infra; D1–D6 workflow-polish.

## Next item

**No single mandated item — A3 is fully shipped.** Pick from the roadmap menu
(ask Kevin or choose) and run the full pipeline:
- **SF-retirement Phase 1** — SF-vs-live PARITY MEASUREMENT + collect miss-rate DATA (gates hybrid
  discovery Increment 2). Load `er-seo-tools-sf-retirement-campaign`. Most strategically load-bearing.
- **Further C6** — hybrid discovery Increment 2 (the crawler, gated on data) / reachability graph 3b /
  content similarity Phase 5.
- **Track A infra** — A4 observability (`/api/health` + pino + `/admin/ops`, builds on A3's `lib/api/`)
  / A5 SSE / A6 UI primitives / A7 auth+Playwright.
- **Track D** — D1 handoff-engine consolidation / D3 shared lib/seo-fetch/ / D4 client robots-sitemap /
  D6 RankMath generator.

## Gotchas / decisions already made (don't relitigate)

- **A3 kit decisions (locked 2026-07-05):** `withRoute` does NO auth (middleware
  is the single cookie gate; token routes self-verify; adding auth would
  double-gate and break direct handler tests); no zod (a dep + would make A3 a
  validation migration); logging deferred to A4 (single `console.error` only);
  Prisma P2025→404/P2002→409 is a LAST-RESORT net — routes that already handle a
  Prisma code keep their own error string (never delegate to the generic
  mapper); `withRoute` passes handler-returned AND thrown `Response` through;
  bad-JSON standardizes to `invalid_json`, unhandled-500 to `internal_error`
  across adopted routes; `brief/[sessionId]` keeps its `.catch(()=>({}))`
  `{}`-default. New routes should adopt `withRoute` + `parseJsonBody`.
- **Route-count re-mapping beats the roadmap number.** A3's "14 untested" was
  really 16, and 5 quarter-plan subroutes were already tested in the monolith.
  ALWAYS enumerate `app/api/**/route.ts` vs `route.test.ts` AND check monolith
  test files before trusting a count.
- **`priority.service.calculatePriorityScore` scores by type weight × count-scale,
  count-0 scale defaults 1.0** — a count-0 run finding is NOT inert. Never emit
  zero-count findings; surface measurement/coverage as run metadata or `run.status`.
- **The handoff's forward-looking scope drifts — re-map the code first.** Before writing any
  spec, dispatch an Explore/read pass over the actual code; trust code > handoff.
- **NEW deploy gotcha — stray untracked `.ts` files on the server break the build
  when you change a public function's signature.** `next build` type-checks EVERY
  `.ts`/`.tsx` in the tree, including untracked scratch files. Move/rename them out
  of the repo tree server-side (operational recovery, reversible). Known strays:
  `~/probe-beal.ts.bak`, audit-aggregate.js/audit-snapshot.js/.env.*.bak/lighthouse-reports/.
- **Injected-into-page code must stay SWC-helper-free** — `parseSeoFromDocument`
  (`parse-seo-dom.ts`) is `.toString()`-injected; no `typeof`; verify at es2017 on the
  BUILT bundle only when you touch it.
- **Never rely on `Class.name`/function names at runtime** (SWC minifies them).
- **Canonical-run selection unchanged:** `sf-upload` stays canonical; live-scan segregated.
- **Deploy protocol:** code-only / config-only → plain `~/deploy.sh` (migrations apply automatically);
  `ecosystem.config.js`/env changes → `pm2 delete && pm2 start`. Prod has NO `sqlite3` CLI — drive
  read-only prod queries with a throwaway `.mjs`/`node -e` IN THE APP DIR using `new PrismaClient()`.
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`); prod DB `/home/seo/data/seo-tools/db.sqlite`;
  prod URL `https://seo.erstaging.site`. Unauth API requests → `401 {"error":"auth_required"}` (that's
  the middleware gate; you can't reach cookie-gated handlers from outside without a session).
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only.
- **Never `git add -A` at repo root** — `pentest-results/`, `googlefc472dc61896519a.html`,
  `SEO_Report_1st_Draft.pdf` are untracked + not gitignored. Add specific paths only.
- **Local dev quirk:** prefix prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`.
  React render tests need `afterEach(cleanup)` + `// @vitest-environment jsdom`; parser/node/route
  tests use node env (global default, no docblock). `tsc --noEmit` has NO `noUnusedLocals`.
  No `@testing-library/jest-dom`. **Test env pins UPLOADS_DIR to a non-writable prod path** (Next
  loads only `.env`, not `.env.local`) → mock `fs/promises` at the boundary, don't touch disk.
  **Use BLOCK-BODY `beforeEach(() => { mock.mockReset() })`** — an implicit-return arrow returning
  the mock trips a Vitest 2.1.9 false-fail (found twice in A3). Quarter-plan route tests MUST stay in
  the `quarter-plan/route.test.ts` monolith (singleton DB) — never a sibling file.
- **Handoff-token / public route gotcha (bit us THREE times):** any new token-authed or public
  route MUST get a `middleware.ts` `isPublicPath` entry + a `middleware.test.ts` case.
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
- 2026-07-04 — **C6 hybrid discovery Increment 1 (sitemap miss-rate measurement) MERGED (#101,
  `9a70368`) + DEPLOYED + PROD-VERIFIED.** Measurement-first miss-rate from already-harvested
  `HarvestedLink` data; stored on `CrawlRun.discoveryCoverageJson` (NOT a Finding). Migration
  `20260704120000_discovery_coverage`.
- 2026-07-05 — **A3 (API route kit + tests for the 16 untested routes) MERGED (#102, `c0cbb22`) +
  DEPLOYED + PROD-VERIFIED. A3 COMPLETE.** `lib/api/` kit (`withRoute`/`HttpError`/`parseJsonBody`),
  characterization tests for all 16 sibling-untested routes (count corrected 21→16 via Codex — 5
  quarter-plan subroutes already in the monolith), kit adopted on 8 plain-JSON routes. Auth stays in
  middleware; no zod; Prisma net is last-resort; bad-JSON→`invalid_json`, 500→`internal_error`;
  `brief/[sessionId]` `{}`-default preserved. Spec Codex accept-with-fixes; plan Codex ×6; subagent-TDD
  16 tasks (all reviews Approved, 3 fix-loops); final opus review READY TO MERGE. Gates: tsc + 3320
  tests (361 files) + build. Found + pinned a latent `tokenErrorCode()` expired-token bug (separate
  ticket). Merge also landed the previously-uncommitted C6-Increment-1 CLAUDE.md docs. Next: roadmap
  menu — SF-retirement data stream / further C6 / Track A (A4–A7) / Track D.
```
