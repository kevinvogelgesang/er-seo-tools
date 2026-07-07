# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-06 (**content similarity C6 Phase 5 SHIPPED + PROD-VERIFIED (PR #111); ALL C6 SF-retirement capability phases now shipped; no work-in-progress — next action is a roadmap-menu pick**) · **Updated by:** the content-similarity build session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: content similarity (C6 Phase 5) is BUILT + MERGED (PR #111, main 146a14d) + DEPLOYED +
PROD-VERIFIED (autonomous scope) 2026-07-06. This was the LAST remaining C6/SF-retirement
CAPABILITY phase — all of them (broken links, on-page, live score, external links, hybrid
discovery Increments 1+2, reachability 3b, content similarity) are now shipped. There is NO
work-in-progress; the next action is a roadmap-menu pick (step 3 below).

Session 2026-07-06 built content similarity end to end: brainstorm (Kevin locked measurement-first
+ lexical/SF-parity over semantic embeddings) -> spec (Codex ACCEPT-WITH-FIXES x10) -> plan (Codex
ACCEPT-WITH-FIXES x11, incl. 2 REAL code bugs caught) -> 6-task inline TDD (gate-green each) ->
merge -> deploy -> prod-verify. It captures bounded main-content text in-page (parse-seo-dom.ts,
nav/header/footer/aside stripped, <=30k, SWC-safe, wordCount unchanged) into transient
HarvestedPageSeo.contentText (deleted post-write, NEVER durable), computes exact (sha256) + near
(MinHash-128 candidate -> exact-Jaccard refine over DF-boilerplate-filtered 5-word shingles at 0.9)
duplicate groups in the broken-link-verify builder (time-budget-guarded, fail-to-null), and stores
them on new nullable CrawlRun.contentSimilarityJson (migration 20260706130000_content_similarity)
+ a read-time ContentSimilaritySection. Measurement-only: NO Finding, NO scoreLiveSeo change.
Prod-verify PASS (autonomous): /api/health 200, all 3 columns present on prod DB, clean restart.
BEHAVIORAL verify (contentSimilarityJson populated on a fresh seoIntent live-scan) is PENDING an
authed client-site scan (prod OAuth-only; only NEW audits harvest contentText -> compute).

1. Load the skill er-seo-tools-change-control first. Gate policy (2026-07-03 ruling,
   rules 1 & 4): THIS PASTED PROMPT is standing authorization to merge pending roadmap
   PRs at session start (re-run gates lint/test/build on the branch this session first)
   and to deploy when needed, ALWAYS followed immediately by post-deploy verification.
   Destructive server ops (prod data deletion, server .env edits, DB restore) stay
   Kevin-gated; docs rituals mandatory; never scan non-client sites. Brainstorm->spec->
   plan runs ungated (route design questions to Codex, not Kevin; notify Kevin one line
   per artifact, don't wait; only a Codex "rewrite" verdict or a contradiction with a
   prior Kevin decision pauses the flow).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md + the tracker
   docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md + the parity log
   docs/superpowers/todos/2026-07-05-sf-live-parity-log.md. Trust ranking when docs
   disagree: code > plan/spec > tracker/handoff. ALWAYS re-map the actual code before
   writing a spec (skills/handoff scope drifts — proven repeatedly).
3. PICK THE NEXT ROADMAP ITEM (ask Kevin if unsure — genuine fork):
   a. SF-retirement VALIDATION (natural next step — all capabilities now shipped): the
      capability thesis is complete, so the remaining SF-retirement work is proving parity.
      (i) Content-similarity parity: on a fresh seoIntent scan, compare live nearDuplicateGroups/
      exactDuplicateGroups vs SF's Near Duplicate column on the 7 client crawls (new parity
      stream opened in the parity log). (ii) Parity cycles 2-3 (roadmap wants 2-3; cycle 1 done,
      manhattan cycle 2 done) — re-run the other 6 clients on hybrid seoIntent audits. Both need
      Kevin's er_auth cookie (12h TTL) + client-site scans. Operational, not a build.
   b. Track A infra (code-only, no auth): A5 shared status hook -> optional SSE (0.5 wk) ·
      A6 shared UI primitives + data-driven nav (1 wk) · A7 auth hardening + per-worker test
      DBs + one Playwright smoke (1 wk).
   c. Track D workflow-polish: D1 handoff-engine consolidation · D3 shared lib/seo-fetch/ ·
      D4 client robots/sitemap checks · D6 RankMath generator.
   d. Analytics (roadmap Phase 6, the last thing under C6): SEMrush/DataForSEO ingestion +
      memo consumption (memo consumption gated on the Anthropic API billing decision).
   Recommended: (a) SF-retirement validation — capabilities are done; parity data is what turns
   "can drop Screaming Frog" into "did drop it" per client. Needs Kevin's cookie. For a heads-down
   code-only session with no cookie, A5/A6 (Track A infra).
3b. GATED follow-ons (NOT this session unless Kevin asks, each needs evidence + sign-off):
   (i) fold clicks-from-home depth / orphan signal into scoreLiveSeo (reachability data exists on
   CrawlRun.reachabilityJson; the depth-guard exclusion at live-seo-score.ts:90 is deliberate).
   (ii) promote content similarity to a priority.service Finding / scoreLiveSeo factor — needs the
   parity data from 3a(i) first. Both are the deliberately-deferred, test-breaking, evidence-gated
   decisions. Do NOT do either without parallel-run evidence + Kevin sign-off.
4. Reusable real crawls for any fixture/parity need (never scan non-client sites):
   /Users/kevin/enrollment-resources/sf-crawls/{manhattan,bidwell,boca,brockway,brownson,
   cambria,discovery}/<newest>/ — 7 clients, fresh (2026-07-03..05), all uploaded to prod.
5. Small open follow-ups (not blocking):
   - CONTENT SIMILARITY behavioral prod-verify still pending an authed seoIntent scan (see State).
   - broken-link-verify maxAttempts inconsistency: registers maxAttempts:2 but
     enqueueBrokenLinkVerify passes none so Job rows carry schema @default(3). Harmless but
     OBSERVED live: repeated deploys can exhaust a verifier; recoverBrokenLinkVerifies() re-enqueues.
   - brockway (client 5) serves HTTP 403 to the scanner (WAF): 28/84 pages blocked; server IP
     needs allowlisting before the live scanner fully replaces SF there.
   - 3b Minor (deferred): safeParseUrlList(site.discoveredUrls) parsed twice in the builder;
     a wp-content/*.html asset counted as an indexable node (edge case).
   - tokenErrorCode() expired-token bug (from A3): expired qct_ reports token_invalid not token_expired.
   - A3 doc caveat: withRoute would 500 a thrown Next redirect()/notFound().
   - A4: point an uptime monitor at /api/health; eyeball /admin/ops with an authed browser.
   - D0: set ALERT_WEBHOOK_URL in the server .env once Slack admin approves.
   - Stray untracked repo-root files (SEO_Report_1st_Draft.pdf, googlefc472dc61896519a.html,
     pentest-results/) are NOT gitignored — NEVER `git add -A`; add explicit paths only.
6. After any advance: tracker checkbox + dated status-log line, rewrite this handoff,
   and end your final reply with this doc's updated paste-in prompt in a code block.
   COMMIT doc updates in the SAME commit as the work — do NOT leave the tracker/handoff/
   CLAUDE.md modified-but-uncommitted (a later `git reset --hard` will silently eat them).
```

## Current state

- **Content similarity (C6 Phase 5) BUILT + MERGED (PR #111, main `146a14d`) + DEPLOYED + PROD-VERIFIED
  (autonomous scope) 2026-07-06.** Lexical near/exact-duplicate on the live scan; bounded main-content
  text captured in-page → transient `HarvestedPageSeo.contentText` (never durable) → pure
  `content-similarity.ts` (MinHash+exact-Jaccard over DF-boilerplate-filtered shingles) in the builder
  (time-budget-guarded) → new nullable `CrawlRun.contentSimilarityJson` (migration
  `20260706130000_content_similarity`) + `ContentSimilaritySection`. Measurement-only (no Finding, no
  score change). Prod-verify PASS (health 200, 3 columns present, clean restart). **Behavioral verify
  (contentSimilarityJson populated on a fresh seoIntent scan) PENDING an authed client-site scan.**
- **ALL C6/SF-retirement CAPABILITY phases now shipped + PROD-VERIFIED:** broken-link verifier, on-page
  SEO, live SEO score, external-link verification, redirect/canonical/hreflang, hybrid discovery
  (Increments 1+2), reachability graph 3b, content similarity. Only analytics integrations (Phase 6,
  partly billing-gated) remain under C6.
- **A1, A2, A2-f1, A3, A4, B1–B5, C1–C10, C9(A+B), D0 all COMPLETE + PROD-VERIFIED.** C7 complete.
- **SF-retirement Phase 1 gate DATA in hand** (7-client parity + 7 miss-rate points, 7.7%–42.2%).
  Cycle 1 done; manhattan cycle 2 done. Roadmap wants 2–3 cycles. **New parity stream opened:**
  content-similarity near-dup agreement vs SF's Near Duplicate column (needs a fresh authed scan).
- **Weekly canary still LIVE:** client 31 "ER Staging Canary" → proway.erstaging.site, `weekly:1@06:00`.
- **⚠ Human-in-the-loop leftovers (Kevin, none blocking a code change):** 1. content-similarity behavioral
  prod-verify + near-dup parity (needs a fresh seoIntent scan). 2. brockway WAF-403 allowlist. 3. parity
  cycles 2–3 (6 remaining clients). 4. tokenErrorCode() fix. 5. A4 uptime monitor + `/admin/ops` eyeball.
  6. D0 `ALERT_WEBHOOK_URL`. 7. B4 quarter-plan decision; first real qct_ push; C10 SA-grant.
- **Blocked / gated:** Anthropic API billing (direct memo generation + content-similarity memo consumption).
  Daily/nightly cadences still gated. Folding depth/orphans into scoreLiveSeo AND promoting content
  similarity to a Finding/score factor both need parallel-run evidence + Kevin sign-off.

## Next item

**Roadmap-menu pick** (step 3). Recommended: **SF-retirement validation** — the capabilities are all
built, so the remaining SF-retirement work is proving parity (content-similarity near-dup agreement +
parity cycles 2–3). Needs Kevin's `er_auth` cookie + client-site scans. Code-only alternative with no
cookie: Track A infra (A5/A6/A7).

## Gotchas / decisions already made (don't relitigate)

- **Content similarity is MEASUREMENT-ONLY** — no `priority.service` Finding, no `scoreLiveSeo` change
  (same discipline as reachability 3b / discovery-coverage; avoids the `priority.service` count-0
  scale-1.0 landmine). Promotion to a Finding / score factor is gated on SF-parity evidence + Kevin's
  sign-off — do NOT wire it into the score without both.
- **`HarvestedPageSeo.contentText` is raw page prose:** transient (deleted post-write; 7-day backstop),
  NEVER durable (only fingerprint-derived groups reach `CrawlRun.contentSimilarityJson`), never logged,
  never `select`ed outside `broken-link-verify.ts`. Don't add it to any other query/API/UI.
- **The similarity module is DETERMINISTIC by contract** (verify job is `maxAttempts:2`): fixed-seed
  `Math.imul` hashing, sorted outputs — NO `Math.random`/`Date.now`. Keep it that way.
- **`parse-seo-dom.ts` stays SWC-helper-free** (`.toString()`-injected): no `typeof`, no module scope.
  The new `contentText` capture reuses the SAME tree-walk and must NOT change `wordCount` semantics
  (a test asserts it). The 30k cap stops APPENDING, not the walk.
- **crawl-depth / orphans are DELIBERATELY out of `scoreLiveSeo`** (live-seo-score.ts:90). Reachability
  3b computes them (reachabilityJson) but does NOT score them. Folding them in is evidence+sign-off-gated.
- **Reachability + content similarity + coverage all run for EVERY live-scan run** (the finalizer
  enqueues `broken-link-verify` for every completed audit); hybrid discovery (seoIntent) enriches the node set.
- **The live-scan run is built by a SEPARATE `broken-link-verify` job AFTER the SiteAudit reaches
  `complete`** (fire-and-forget, concurrency 1). "SiteAudit complete" ≠ "live run ready" — poll for the run.
- **`er_auth` cookie is 12h TTL.** Do cookie-dependent work (upload/parse/trigger) up front; polling +
  recording are read-only SSH and outlive the cookie. Prod is OAuth-only (`ALLOW_PASSWORD_LOGIN=false`).
- **Prod has NO sqlite3 CLI** — drive read-only prod queries with a throwaway `.ts` via `npx tsx` from the
  app dir; import as `@/lib/db`. Clean it up after (I used `_colcheck.ts` this session and deleted it).
- **Deploy protocol:** code/config → plain `~/deploy.sh` (migrations auto-apply); `ecosystem.config.js`/
  env changes → `pm2 delete && pm2 start`.
- **NEVER `git add -A` at repo root** — `pentest-results/`, `SEO_Report_1st_Draft.pdf`,
  `googlefc472dc61896519a.html` are untracked + not gitignored. Add explicit paths only.
- **Canonical-run selection (on main):** `pickCanonicalSeo` — fresh SF (≤30 d) wins; a newer seoIntent
  live run supersedes; a NON-seoIntent live run can NEVER be canonical. (Content similarity is metadata on
  the live-scan run — it never affects canonical selection.)
- **Prod URL** `https://seo.erstaging.site`; prod DB `/home/seo/data/seo-tools/db.sqlite`; app dir
  `/home/seo/webapps/seo-tools`. Unauth API → `401 {"error":"auth_required"}`.
- Stack stays: SQLite + single PM2 process + Next.js. **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only.
- **Codex session for this workspace:** `019f2b57-...` (registry `~/.claude/state/codex-consultations.json`).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, handoff created. A1 (PRs #50–#54). A2 (PRs #55–#58).
- 2026-06-11 — B1–B5 (#60–#64). C1 (#65), C2 (#66), C3 (#67), C4 (#68), C5 (#69).
- 2026-06-16/17 — C6 Phases 1–3 (#70, #71, #73).
- 2026-06-22 — C10 (#75) + build-heap fix (#76).
- 2026-07-02 — Skill library. C6 Phase 4 (#85). D0 (#86). A2-f1.
- 2026-07-03 — C8 (#90) + upload hotfix (#91) + C7 (#93/#94/#95) + C6 redirect/canonical/hreflang (#96).
- 2026-07-04 — C9-A (#97) + C9-B (#98) + streaming concurrency (#99) + C6 external-link (#100) + C6 hybrid discovery Increment 1 (#101). Migration `20260704120000_discovery_coverage`.
- 2026-07-05 — A3 (#102). SF-retirement Phase 1 kickoff (fresh SF crawls; parity log).
- 2026-07-06 — A4 (#103). Slack alert enrichment (#104). SF-retirement Phase 1 DATA (#105/#106/#107). safeFetch hardening (#108).
- 2026-07-06 — hybrid-discovery Increment 2 (THE CRAWLER) MERGED (#109) + DEPLOYED + PROD-VERIFIED. Migration `20260705080000_discovery_sources`.
- 2026-07-06 — reachability graph 3b MERGED (PR #110, main `140a850`) + DEPLOYED + PROD-VERIFIED. Migration `20260706120000_reachability_graph`.
- 2026-07-06 — **content similarity C6 Phase 5 MERGED (PR #111, main `146a14d`) + DEPLOYED + PROD-VERIFIED (autonomous scope).** MinHash+exact-Jaccard near/exact-dup on `CrawlRun.contentSimilarityJson` (migration `20260706130000_content_similarity`) + `ContentSimilaritySection`. Measurement-only. Codex ACCEPT-WITH-FIXES ×10 (spec) + ×11 (plan, 2 real bugs). 6-task inline TDD. **ALL C6 capability phases shipped. Next: SF-retirement validation (content-sim parity + cycles 2–3) or Track A infra.**
