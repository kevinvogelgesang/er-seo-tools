# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-07 (**SF-retirement VALIDATION advanced: content-similarity parity cycle 1 + score/miss-rate parity cycle 2 recorded for 7 clients; content-similarity behavioral prod-verify COMPLETE. No work-in-progress — next action is a roadmap-menu pick (or continue validation / A8 homepage redesign, which is mid-brainstorm).**) · **Updated by:** the SF-retirement validation session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: ALL C6/SF-retirement CAPABILITY phases are shipped + prod-verified. The 2026-07-07 session did
SF-retirement VALIDATION (operational, no code change): fresh seoIntent live scans on 7 clients
(manhattan/bidwell/boca/brockway/brownson/cambria/nuvani) → recorded (a) content-similarity parity
cycle 1 and (b) score/miss-rate parity cycle 2, every deviation explained, in
docs/superpowers/todos/2026-07-05-sf-live-parity-log.md (2026-07-07 section). This ALSO closed the
content-similarity behavioral prod-verify (contentSimilarityJson now confirmed populating on fresh
seoIntent scans). Key results: live near-dup = 0 across all 7 (precise/conservative — zero false
positives); exact-dup = boca 2 thin-archive groups. Only nuvani had a valid SF near-dup half (Kevin
re-crawled it WITH Crawl Analysis + JS render + content-area exclusion → sf-crawls/070726-testcrawls/);
SF flagged 6 pagination archives, we flagged 0 because nuvani ran sitemap-mode and those /news/page/N
pages aren't in the sitemap (explained, not a miss). Score: live > SF on 6/7 (Δ +9..+23), bidwell −2.
Hybrid crawler (Increment 2) closes the sitemap gap where it expands (manhattan 38.5%→2.7%, boca
47.4%→3.3%, bidwell 8.5%→0%) but expansion is INCONSISTENT (brownson/nuvani/cambria under-expand). There
is NO work-in-progress; the next action is a roadmap-menu pick (step 3).

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
   a. A8 app-shell + homepage redesign (mid-brainstorm as of 2026-07-07): Kevin requested a full
      homepage + nav redesign (left collapsible sidebar, quick-start inline-launch homepage,
      ER-website-derived "app not website"). Two direction mockups (A navy command-deck / B light
      PostHog-style) were built + delivered; AWAITING KEVIN'S DIRECTION PICK before spec. If Kevin
      picks a direction, this becomes the active build (UI-class: dark-mode variants + no hydration
      mismatch). Absorbs the old A6.
   b. SF-retirement VALIDATION continuation (operational, needs cookie): the capability thesis is
      complete; remaining is proving parity across cycles. (i) Re-crawl the other 6 clients WITH
      Crawl Analysis + JS render + content-area exclusion (the levers nuvani got) → fills the SF
      near-dup half for a full content-similarity comparison. (ii) Upload the fresh 070726 SF crawls
      to prod for clean score pairs. (iii) Parity cycle 3 (roadmap wants 2-3; cycle 1+2 done). Needs
      Kevin's er_auth cookie (12h) + client-site scans.
   c. Track A infra (code-only, no auth): A5 shared status hook -> optional SSE (0.5 wk) ·
      A7 auth hardening + per-worker test DBs + one Playwright smoke (1 wk). (A6 absorbed into A8.)
   d. Track D workflow-polish: D1 handoff-engine consolidation · D3 shared lib/seo-fetch/ ·
      D4 client robots/sitemap checks · D6 RankMath generator.
   e. Analytics (roadmap Phase 6, last under C6): SEMrush/DataForSEO ingestion + memo consumption
      (memo consumption gated on the Anthropic API billing decision).
   Recommended: if Kevin has picked an A8 direction, build A8. Otherwise, for a code-only heads-down
   session, Track A (A5/A7) or Track D. SF-retirement validation continuation needs a cookie.
3b. GATED follow-ons (NOT this session unless Kevin asks, each needs evidence + sign-off):
   (i) fold clicks-from-home depth / orphan signal into scoreLiveSeo (reachability data exists on
   CrawlRun.reachabilityJson; the depth-guard exclusion at live-seo-score.ts:90 is deliberate).
   (ii) promote content similarity to a priority.service Finding / scoreLiveSeo factor — the 2026-07-07
   parity data does NOT justify this (live near-dup is sparse; where SF has more it's pagination noise).
   Both remain deliberately-deferred, test-breaking, evidence-gated decisions.
4. Reusable real crawls for any fixture/parity need (never scan non-client sites):
   /Users/kevin/enrollment-resources/sf-crawls/{manhattan,bidwell,boca,brockway,brownson,
   cambria,discovery}/<newest>/ — 7 clients (2026-07-03..05, cycle-1: raw-HTML, NO Crawl Analysis).
   PLUS /Users/kevin/enrollment-resources/sf-crawls/070726-testcrawls/<ts>/ — nuvani, the FIRST
   properly-configured crawl (Crawl Analysis + JS render + content-area exclusion; near-dup populated).
5. Small open follow-ups (not blocking):
   - HYBRID-CRAWLER EXPANSION INCONSISTENCY (new 2026-07-07): the Increment-2 crawler closes the
     sitemap gap superbly on some sites (manhattan 38.5%→2.7%, boca 47.4%→3.3%, bidwell →0%) but
     barely expands on others (brownson +1 linked / residual 18.1%; nuvani+cambria fall back to
     sitemap-mode, 0 expansion). Candidate crawler-depth/frontier tuning increment (measured, not a bug).
   - broken-link-verify maxAttempts inconsistency: registers maxAttempts:2 but enqueueBrokenLinkVerify
     passes none so Job rows carry schema @default(3). Harmless; recoverBrokenLinkVerifies() re-enqueues.
   - brockway (client 5) serves HTTP 403 to the scanner (WAF): sitemapMiss 87% / 28 pages blocked;
     server IP needs allowlisting before the live scanner fully replaces SF there.
   - SF Crawl-Analysis gotcha: the 6 cycle-1 SF crawls have NO near-dup data (columns blank) because
     SF's post-crawl Crawl Analysis step wasn't run before export (exact-hash populates at crawl time;
     near-dup requires the Analysis pass). Only 070726-testcrawls (nuvani) has it. To fill the other 6:
     re-crawl WITH Analysis + auto-analyse-at-end + JS render + content-area exclusion.
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

- **SF-retirement VALIDATION advanced 2026-07-07 (operational, no code change).** Fresh `seoIntent` live
  scans on 7 clients → recorded **content-similarity parity cycle 1** + **score/miss-rate parity cycle 2**
  in `2026-07-05-sf-live-parity-log.md` (2026-07-07 section), every deviation explained. Also **closed the
  content-similarity behavioral prod-verify** (`contentSimilarityJson` confirmed populating on 7 fresh
  scans). Live near-dup = 0/7 (precise/conservative); exact = boca 2 thin-archive groups. nuvani is the
  one true SF near-dup comparison (its SF-flagged pagination archives fall outside our sitemap-mode page
  set — explained). Score: live > SF 6/7 (Δ +9..+23), bidwell −2.
- **ALL C6/SF-retirement CAPABILITY phases shipped + PROD-VERIFIED:** broken-link verifier, on-page SEO,
  live SEO score, external-link verification, redirect/canonical/hreflang, hybrid discovery (Increments
  1+2), reachability graph 3b, content similarity. Only analytics integrations (Phase 6, partly
  billing-gated) remain under C6.
- **A1, A2, A2-f1, A3, A4, B1–B5, C1–C10, C9(A+B), D0 all COMPLETE + PROD-VERIFIED.** C7 complete.
- **A8 app-shell + homepage redesign** is a NEW item, mid-brainstorm (2026-07-07): two direction mockups
  delivered, awaiting Kevin's direction pick before spec. Absorbs the old A6.
- **Parity status:** cycle 1 (7 clients) + cycle 2 (7 clients) done; content-similarity cycle 1 (live
  baseline + nuvani SF comparison) done. Roadmap wants 2–3 cycles — on track. Full near-dup comparison
  on the other 6 needs them re-crawled WITH Crawl Analysis (the levers nuvani got).
- **Weekly canary still LIVE:** client 31 "ER Staging Canary" → proway.erstaging.site, `weekly:1@06:00`.
- **⚠ Human-in-the-loop leftovers (Kevin, none blocking a code change):** 1. re-crawl the other 6 with
  Crawl Analysis for full near-dup parity + upload fresh 070726 SF crawls to prod. 2. brockway WAF-403
  allowlist. 3. A8 direction pick. 4. tokenErrorCode() fix. 5. A4 uptime monitor + `/admin/ops` eyeball.
  6. D0 `ALERT_WEBHOOK_URL`. 7. B4 quarter-plan decision; first real qct_ push; C10 SA-grant.
- **Blocked / gated:** Anthropic API billing (direct memo generation + content-similarity memo consumption).
  Daily/nightly cadences still gated. Folding depth/orphans into scoreLiveSeo AND promoting content
  similarity to a Finding/score factor both need parallel-run evidence + Kevin sign-off (the 2026-07-07
  data does NOT justify the content-similarity promotion).

## Next item

**Roadmap-menu pick** (step 3). If Kevin has picked an **A8** direction, that's the active build (UI class).
Otherwise: continue **SF-retirement validation** (needs cookie — re-crawl the other 6 with Crawl Analysis
for full near-dup parity; parity cycle 3) or a code-only **Track A / Track D** item.

## Gotchas / decisions already made (don't relitigate)

- **Content similarity is MEASUREMENT-ONLY** — no `priority.service` Finding, no `scoreLiveSeo` change.
  The 2026-07-07 parity data reinforces this: live near-dup is sparse and where SF finds more it's
  pagination noise. Promotion stays gated on parity evidence + Kevin sign-off.
- **Our content-similarity engine is PRECISE/conservative by design** (two-layer boilerplate control:
  in-page element strip + DF shingle filter, 0.9 Jaccard). Zero near-dup false positives on 7 real sites
  is the expected, good outcome — not a coverage gap.
- **SF near-dup needs Crawl Analysis** (post-crawl step). Cycle-1 SF crawls lack it (blank columns); only
  `070726-testcrawls` (nuvani) has it. Exact-hash dupes DO populate at crawl time without Analysis.
- **`HarvestedPageSeo.contentText` is raw page prose:** transient (deleted post-write; 7-day backstop),
  NEVER durable, never logged, never `select`ed outside `broken-link-verify.ts`. Don't add it elsewhere.
- **The similarity module is DETERMINISTIC by contract** (verify job is `maxAttempts:2`): fixed-seed
  `Math.imul` hashing, sorted outputs — NO `Math.random`/`Date.now`. Keep it that way.
- **`parse-seo-dom.ts` stays SWC-helper-free** (`.toString()`-injected): no `typeof`, no module scope.
- **crawl-depth / orphans are DELIBERATELY out of `scoreLiveSeo`** (live-seo-score.ts:90). Folding in is
  evidence+sign-off-gated.
- **The live-scan run is built by a SEPARATE `broken-link-verify` job AFTER the SiteAudit reaches
  `complete`** (fire-and-forget, concurrency 1). "SiteAudit complete" ≠ "live run ready" — poll for the run.
- **`er_auth` cookie is 12h TTL.** Do cookie-dependent work (trigger audits) up front; polling + recording
  is read-only SSH and outlives the cookie. Prod is OAuth-only (`ALLOW_PASSWORD_LOGIN=false`).
- **Prod has NO sqlite3 CLI** — drive read-only prod queries with a throwaway `.ts` via `npx tsx` from the
  app dir (`scp` it up, run, delete after). Cookie-independent.
- **Deploy protocol:** code/config → plain `~/deploy.sh` (migrations auto-apply); `ecosystem.config.js`/
  env changes → `pm2 delete && pm2 start`.
- **NEVER `git add -A` at repo root** — `pentest-results/`, `SEO_Report_1st_Draft.pdf`,
  `googlefc472dc61896519a.html` are untracked + not gitignored. Add explicit paths only.
- **Canonical-run selection (on main):** `pickCanonicalSeo` — fresh SF (≤30 d) wins; a newer seoIntent
  live run supersedes; a NON-seoIntent live run can NEVER be canonical.
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
- 2026-07-06 — content similarity C6 Phase 5 MERGED (PR #111, main `146a14d`) + DEPLOYED + PROD-VERIFIED (autonomous scope). Migration `20260706130000_content_similarity`. Measurement-only. ALL C6 capability phases shipped.
- 2026-07-07 — **SF-retirement VALIDATION (operational, no code change):** 7-client fresh seoIntent scans →
  content-similarity parity cycle 1 + score/miss-rate parity cycle 2 recorded (parity log 2026-07-07
  section), every deviation explained. Content-similarity behavioral prod-verify CLOSED. Live near-dup
  0/7 (precise); nuvani the one true SF near-dup comparison (pagination archives outside our sitemap-mode
  set). Hybrid crawler closes the gap where it expands (manhattan 38.5%→2.7%) but expansion is inconsistent
  → follow-up. A8 homepage redesign is mid-brainstorm (mockups delivered, awaiting direction pick).
