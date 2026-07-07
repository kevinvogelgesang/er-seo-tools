# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-06 (**reachability graph 3b SHIPPED + PROD-VERIFIED (PR #110); no work-in-progress — next action is a roadmap-menu pick**) · **Updated by:** the 3b build session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: reachability graph 3b is BUILT + MERGED (PR #110, main 140a850) + DEPLOYED +
PROD-VERIFIED (2026-07-06). Hybrid-discovery Increment 2 (the crawler) was verified
earlier the same session. There is NO work-in-progress; the next action is a
roadmap-menu pick (step 3 below).

Session 2026-07-06 did two things: (1) prod-verified hybrid-discovery Increment 2
(manhattan: discoveryMode 'hybrid', 42 linked pages beyond a 67-page sitemap,
sitemapMissRate 38.5% -> residualMissRate 2.7%); (2) built reachability graph 3b end
to end — brainstorm -> spec (Codex ACCEPT-WITH-FIXES x8) -> plan (Codex ACCEPT-WITH-
FIXES x8) -> 4-task subagent TDD -> opus whole-branch review -> 2 fix waves (scheme/www-
insensitive homepage anchor; query-string rootKey guard) -> merge -> deploy -> prod-verify.
3b refactored computeLinkGraph to the FULL discovered node set (was audited-only) and
surfaces orphans/unreachable/clicks-from-home depth as new nullable CrawlRun.reachabilityJson
(migration 20260706120000_reachability_graph) + a ReachabilitySection UI. Measurement-only:
NO score change, NO orphan Finding. Prod-verify PASS: reachabilityJson populated,
homepageResolved:true, invariant depthHistogram.null(12)===unreachableCount(12), 11 real
orphans, nav pages 94 inlinks (full-graph).

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
   a. Content similarity (roadmap Phase 5 / last remaining C6 phase) — @xenova/transformers
      already in deps; needs normalized text fingerprints + boilerplate control; spec what
      gets stored (hashes/shingles, NEVER raw pages) + retention. The live-scan builder
      already has per-page text signals in hand (HarvestedPageSeo) — likely another
      measurement-first, findings-native increment. Full pipeline.
   b. Parity cycles 2-3 — roadmap wants 2-3 reporting cycles; cycle 1 done, manhattan cycle 2
      done (Increment-2 verify). Re-run the other 6 clients on future seoIntent audits (now
      hybrid) + append to the parity log. Operational; needs Kevin's er_auth cookie.
   c. Track A infra (code-only, no auth): A5 shared status hook -> optional SSE (0.5 wk) ·
      A6 shared UI primitives + data-driven nav (1 wk) · A7 auth hardening + per-worker test
      DBs + one Playwright smoke (1 wk).
   d. Track D workflow-polish: D1 handoff-engine consolidation · D3 shared lib/seo-fetch/ ·
      D4 client robots/sitemap checks · D6 RankMath generator.
   e. Analytics (roadmap Phase 6): SEMrush/DataForSEO ingestion + memo consumption (memo
      consumption gated on the Anthropic API billing decision).
   Recommended: content similarity (a) — it's the LAST remaining C6/SF-retirement capability
   phase and the live-scan builder already has the text signals; completing it materially
   advances the "drop Screaming Frog" thesis. A5/A6 for a heads-down code-only session.
3b. Now that reachability data exists (CrawlRun.reachabilityJson), a FOLLOW-ON (gated, NOT
   this session unless Kevin asks): fold clicks-from-home depth / orphan signal into
   scoreLiveSeo. This is the deliberately-deferred, test-breaking, evidence-gated decision
   (the depth-guard exclusion at live-seo-score.ts:90). Needs parallel-run evidence + Kevin
   sign-off — do NOT do it without both.
4. Reusable real crawls for any fixture/parity need (never scan non-client sites):
   /Users/kevin/enrollment-resources/sf-crawls/{manhattan,bidwell,boca,brockway,brownson,
   cambria,discovery}/<newest>/ — 7 clients, fresh (2026-07-03..05), all uploaded to prod.
5. Small open follow-ups (not blocking):
   - broken-link-verify maxAttempts inconsistency: registers maxAttempts:2 but
     enqueueBrokenLinkVerify passes none so Job rows carry schema @default(3). Harmless but
     OBSERVED live: repeated deploys can exhaust a verifier; recoverBrokenLinkVerifies() re-enqueues.
   - brockway (client 5) serves HTTP 403 to the scanner (WAF): 28/84 pages blocked; server IP
     needs allowlisting before the live scanner fully replaces SF there.
   - 3b Minor (deferred, non-blocking): safeParseUrlList(site.discoveredUrls) parsed twice in
     the builder (graph nodes + discovery-coverage) — harmless, pure; optional dedupe. Also a
     wp-content/*.html asset counted as an indexable node (appeared in unreachable, not orphan)
     — edge case, not worth a filter unless it recurs.
   - Increment-2 Minor roll-up: robots isAllowed specificity metric strips */$ before length-count;
     single-letter locals in the coverage refactor.
   - tokenErrorCode() expired-token bug (from A3): expired qct_ reports token_invalid not token_expired.
   - A3 doc caveat: withRoute would 500 a thrown Next redirect()/notFound().
   - A4: point an uptime monitor at /api/health; eyeball /admin/ops with an authed browser.
   - D0: set ALERT_WEBHOOK_URL in the server .env once Slack admin approves.
   - Stray untracked repo-root files (SEO_Report_1st_Draft.pdf, googlefc472dc61896519a.html,
     pentest-results/) are NOT gitignored — NEVER `git add -A`; add explicit paths only.
6. After any advance: tracker checkbox + dated status-log line, rewrite this handoff,
   and end your final reply with this doc's updated paste-in prompt in a code block.
   COMMIT doc updates in the SAME commit as the work — do NOT leave the tracker/handoff/
   CLAUDE.md modified-but-uncommitted (a later `git reset --hard` will silently eat them;
   this bit the A4 docs on 2026-07-06 — see the tracker's A4 doc-integrity note).
```

## Current state

- **Reachability graph 3b BUILT + MERGED (PR #110, main `140a850`) + DEPLOYED + PROD-VERIFIED 2026-07-06.**
  `computeLinkGraph` over the full discovered node set; orphans/unreachable/clicks-from-home depth on
  new nullable `CrawlRun.reachabilityJson` (migration `20260706120000_reachability_graph`) +
  `ReachabilitySection` UI. Measurement-only (no score change, no Finding). Prod-verify PASS
  (manhattan: homepageResolved:true, invariant holds, 11 real orphans, nav pages 94 inlinks).
- **hybrid-discovery Increment 2 (crawler) + Increment 1 (miss-rate) SHIPPED + PROD-VERIFIED.**
- **A1, A2, A2-f1, A3, A4, B1–B5, C1–C10, C9(A+B), D0 all COMPLETE + PROD-VERIFIED.** C7 complete.
  C6 Phases 1–4 + on-page + live score + redirect/canonical/hreflang + external-link + hybrid discovery
  (Increments 1+2) + **reachability graph 3b** shipped. **Only remaining C6/SF-retirement capability
  phase: content similarity (Phase 5).**
- **SF-retirement Phase 1 gate DATA in hand** (7-client parity + 7 miss-rate points, 7.7%–42.2%).
  Cycle 1 done; manhattan cycle 2 done. Roadmap wants 2–3 cycles.
- **Weekly canary still LIVE:** client 31 "ER Staging Canary" → proway.erstaging.site, `weekly:1@06:00`.
- **⚠ Human-in-the-loop leftovers (Kevin, none blocking a code change):** 1. brockway WAF-403 allowlist.
  2. parity cycles 2–3 (6 remaining clients). 3. tokenErrorCode() fix. 4. A4 uptime monitor + `/admin/ops`
  eyeball. 5. D0 `ALERT_WEBHOOK_URL`. 6. B4 quarter-plan decision; first real qct_ push; C10 SA-grant.
- **Blocked / gated:** Anthropic API billing (direct memo generation + content-similarity memo consumption).
  Daily/nightly cadences still gated. Folding depth/orphans into scoreLiveSeo (needs evidence + sign-off).

## Next item

**Roadmap-menu pick** (step 3). Recommended: **content similarity (Phase 5)** — the last remaining
C6/SF-retirement capability phase; the live-scan builder already holds per-page text signals; likely
another measurement-first, findings-native increment. Cheaper alternatives: parity cycles 2–3
(operational, needs cookie) or Track A code infra (A5/A6/A7).

## Gotchas / decisions already made (don't relitigate)

- **crawl-depth / orphans are DELIBERATELY out of `scoreLiveSeo`** (live-seo-score.ts:90). 3b COMPUTES
  them (reachabilityJson) but does NOT score them. Folding depth/orphans into the live score is a known
  test-breaking decision gated on parallel-run evidence + Kevin's sign-off — a separate future step.
- **`priority.service` count-0 scale 1.0** — never emit zero-count findings; surface measurement as run
  metadata (`discoveryCoverageJson`, `reachabilityJson`) / `run.status`. Reachability is metadata, NOT a Finding.
- **Reachability runs for EVERY live-scan run**, not seoIntent-gated (the finalizer enqueues
  `broken-link-verify` for every completed audit). Hybrid discovery (seoIntent) just enriches the node set.
- **Graph normalization uses `normalizeFindingUrl`** (lowercases host, drops fragment, strips ONLY the
  bare-root trailing slash — NOT www, NOT scheme, NOT non-root slashes) so `byUrl` keys reconcile with
  `CrawlPage.url`. The homepage ANCHOR match is separately scheme+www-insensitive (root-key match, query
  strings excluded) — a real prod bug caught in review (www-canonical sites would else read
  homepageResolved:false site-wide). `computeLinkGraph` seeds seoRow urls FIRST so byUrl.get(r.url) hits.
- **The live-scan run is built by a SEPARATE `broken-link-verify` job AFTER the SiteAudit reaches
  `complete`** (fire-and-forget, concurrency 1). "SiteAudit complete" ≠ "live run ready" — poll for the run.
- **Increment 2 (crawler) is seoIntent-gated at discovery**; a plain ADA audit is byte-identical.
  discoverySourcesJson `{sources: url->('sitemap'|'seed'|'shallow'|'linked'), sitemapCount, ...}`;
  dual miss-rate (sitemapMissRate intrinsic + residualMissRate = success number).
- **The `safeFetch` 999-hang (fixed #107, hardened #108) is the model bug:** a promise that never settles
  cannot be stopped by any downstream time budget.
- **`er_auth` cookie is 12h TTL.** Do cookie-dependent work (upload/parse/trigger) up front; polling +
  recording are read-only SSH and outlive the cookie. Prod is OAuth-only (`ALLOW_PASSWORD_LOGIN=false`).
- **Prod has NO sqlite3 CLI** — drive read-only prod queries with a throwaway `.ts` via `npx tsx` from the
  app dir; import as `@/lib/db`. Keep scratch `.ts` OUTSIDE the repo tree; clean it up after.
- **Deploy protocol:** code/config → plain `~/deploy.sh` (migrations auto-apply); `ecosystem.config.js`/
  env changes → `pm2 delete && pm2 start`.
- **NEVER `git add -A` at repo root** — `pentest-results/`, `SEO_Report_1st_Draft.pdf`,
  `googlefc472dc61896519a.html` are untracked + not gitignored. Add explicit paths only.
- **Injected-into-page code must stay SWC-helper-free** (`parse-seo-dom.ts`, no `typeof`). **Never rely on
  `Class.name`/function names at runtime** (SWC minifies). (Neither applies to the graph/crawler — raw compute.)
- **Canonical-run selection (on main since PR #85):** `pickCanonicalSeo` — fresh SF (≤30 d) wins; a newer
  seoIntent live run supersedes; a NON-seoIntent live run can NEVER be canonical.
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
- 2026-07-06 — hybrid-discovery Increment 2 (THE CRAWLER) MERGED (#109) + DEPLOYED + PROD-VERIFIED (manhattan: 42 linked pages beyond a 67-page sitemap, residualMissRate 2.7%). Migration `20260705080000_discovery_sources`.
- 2026-07-06 — **reachability graph 3b MERGED (PR #110, main `140a850`) + DEPLOYED + PROD-VERIFIED.** Full discovered-graph `computeLinkGraph`; orphans/unreachable/clicks-from-home on `CrawlRun.reachabilityJson` (migration `20260706120000_reachability_graph`) + `ReachabilitySection`. Measurement-only. 4-task subagent TDD + opus review + 2 re-reviewed fix waves. Prod-verify PASS (homepageResolved:true, invariant holds, 11 real orphans). **Next: content similarity (Phase 5) / parity cycles 2–3 / Track A.**
