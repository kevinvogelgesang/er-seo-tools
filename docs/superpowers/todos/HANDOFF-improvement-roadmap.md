# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-06 (**hybrid-discovery Increment 2 — THE CRAWLER — built, merged PR #109, deployed**) · **Updated by:** the Increment-2 build session. The single next action is **feature prod-verification of Increment 2** (needs Kevin's `er_auth` cookie), then a roadmap-menu pick.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: hybrid-discovery Increment 2 (THE CRAWLER) is BUILT + MERGED (PR #109) +
DEPLOYED (2026-07-06). The one open thread on it is FEATURE PROD-VERIFICATION,
which needs Kevin's er_auth cookie (prod is OAuth-only). Otherwise there is NO
work-in-progress; after verification the next action is a roadmap-menu pick.

Session 2026-07-06 (this build): Kevin picked hybrid-discovery Increment 2 — the
evidence-backed payoff of the Increment-1 miss-rate data (7 clients, 7.7%-42.2%
off-sitemap, 3/7 >=37%). Full pipeline in one session: brainstorm (Kevin locked
seoIntent-only scope + moderate-but-env-tunable crawl budget) -> spec (Codex
ACCEPT-WITH-FIXES ×10) -> plan (Codex ACCEPT-WITH-FIXES ×10) -> subagent-driven
TDD (8 tasks, per-task spec+quality review, opus whole-branch final) -> gates
(tsc / 3418 tests / build) -> PR #109 -> merged -> deployed. The crawler extends
discoverPages(domain,{hybrid,seeds,timeBudgetMs}) to a bounded raw-HTTP same-domain
BFS (lib/ada-audit/seo/hybrid-crawl.ts, pure/injected-fetch; robots-rules.ts), running
ONLY for seoIntent audits (plain ADA audits byte-identical). Per-URL provenance ->
new nullable SiteAudit.discoverySourcesJson (migration 20260705080000_discovery_sources,
additive); the builder derives the sitemap-only baseline from it and
computeDiscoveryCoverage now reports BOTH sitemapMissRate (intrinsic, cycle-comparable)
+ residualMissRate (what even the crawl missed = the success number). 6 real bugs
caught+fixed in the review loop (crawler key/fetch conflation; robots trailing-slash
bypass; SSRF ordering; mode-on-seeds; double-crawl from a stale audit snapshot;
inert budget ceiling). No new required-in-prod env var (7 HYBRID_CRAWL_* all default-safe);
migration additive-nullable.

1. Load the skill er-seo-tools-change-control first. Gate policy (2026-07-03 ruling,
   rules 1 & 4): THIS PASTED PROMPT is standing authorization to merge pending roadmap
   PRs at session start (re-run gates lint/test/build on the branch this session first)
   and to deploy when needed, ALWAYS followed immediately by post-deploy verification.
   Destructive server ops (prod data deletion, server .env edits, DB restore) stay
   Kevin-gated; docs rituals mandatory; never scan non-client sites. Brainstorm->spec->
   plan runs ungated. Route design questions to Codex, not Kevin.
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md + the tracker
   docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md + the parity log
   docs/superpowers/todos/2026-07-05-sf-live-parity-log.md. Trust ranking when docs
   disagree: code > plan/spec > tracker/handoff. ALWAYS re-map the actual code before
   writing a spec (skills/handoff scope drifts — proven repeatedly).
3. THE IMMEDIATE NEXT ACTION — feature prod-verification of Increment 2 (needs Kevin's
   er_auth cookie; prod is OAuth-only). Runbook: trigger a seoIntent audit on a KNOWN
   high-miss client already in the system (manhattan 12 @ 37.4%, or cambria 29 @ 21.1%):
     curl -s -b jar -X POST "$APP_URL/api/site-audit" -H 'Content-Type: application/json' \
       -d '{"domain":"manhattanschool.edu","wcagLevel":"wcag21aa","clientId":12,"seoIntent":true}'
   Wait for the audit to reach 'complete', then the SEPARATE broken-link-verify job builds
   the live-scan run (poll for the run, not the audit). Then on prod (npx tsx, read-only)
   inspect the live-scan CrawlRun + its SiteAudit:
     - SiteAudit.discoveryMode === 'hybrid'; discoverySourcesJson populated (a {v:1,sources,
       sitemapCount,sitemapCapped,stoppedBy,fetches} object; sources a mix of 'sitemap'+'linked').
     - audited page count (pagesTotal) > the sitemap-only count would have been.
     - CrawlRun.discoveryCoverageJson: sitemapMissRate ≈ the cycle-1 number (manhattan ~0.374),
       residualMissRate materially LOWER (the crawler closed the gap). Record which bound
       (stoppedBy: maxFetches/maxAdded/hardCap/depth/timeBudget/exhausted) stopped the crawl.
   Append the result to 2026-07-05-sf-live-parity-log.md; flip the tracker C6 Increment-2 line
   from 'feature prod-verify pending' to VERIFIED. If discoveryMode is NOT 'hybrid' or
   discoverySourcesJson is null on a seoIntent audit of an indexable client, that's a real bug —
   check the discover-job logs + confirm the POST carried seoIntent:true (strict === true).
4. THEN pick the next roadmap item (ask Kevin if unsure — genuine fork):
   a. Parity cycles 2-3 — the roadmap wants 2-3 reporting cycles; cycle 1 done. Re-run the 7
      clients on future scheduled/manual seoIntent audits (now hybrid) + append to the parity log.
      Cheap/operational; needs Kevin's authed session/cookie. Naturally pairs with step 3.
   b. Reachability graph / true depth / orphans (roadmap 3b) — NOW UNBLOCKED by Increment 2
      (the crawler gives discovered nodes beyond the audited set). Extends computeLinkGraph to
      true-er orphans + clicks-from-home. Folding depth into the live score is a deliberate
      test-breaking decision (the depth-guard test) gated on parallel-run evidence.
   c. Content similarity (roadmap Phase 5) — @xenova/transformers already in deps; needs
      normalized text fingerprints + boilerplate control; spec what gets stored (hashes/shingles,
      never raw pages) + retention.
   d. Track A infra (code-buildable, no auth): A5 shared status hook -> optional SSE (0.5 wk) ·
      A6 shared UI primitives in components/ui/ + data-driven nav (1 wk) · A7 auth hardening
      (per-operator attribution + login rate-limit) + per-worker test DBs + one Playwright smoke (1 wk).
   e. Track D workflow-polish: D1 handoff-engine consolidation · D3 shared lib/seo-fetch/ ·
      D4 client robots/sitemap checks · D6 RankMath generator.
   f. Analytics (roadmap Phase 6): SEMrush/DataForSEO ingestion + memo consumption (memo
      consumption gated on the Anthropic API billing decision).
   Recommended: (a)+(b) — verify Increment 2 in prod (step 3), accrue parity cycle 2 while there,
   then build the reachability graph (3b), which Increment 2 just unblocked. A5/A6 for a
   heads-down code-only session.
4b. Reusable real crawls for any fixture/parity need (never scan non-client sites):
   /Users/kevin/enrollment-resources/sf-crawls/{manhattan,bidwell,boca,brockway,brownson,
   cambria,discovery}/<newest>/ — 7 clients, fresh (2026-07-03..05), all uploaded to prod.
5. Small open follow-ups (not blocking):
   - broken-link-verify maxAttempts inconsistency: registers maxAttempts:2 but
     enqueueBrokenLinkVerify passes none so Job rows carry schema @default(3). Harmless but
     OBSERVED live: repeated deploys can exhaust a verifier; recoverBrokenLinkVerifies() re-enqueues.
   - brockway (client 5) serves HTTP 403 to the scanner (WAF): 28/84 pages blocked; server IP
     needs allowlisting before the live scanner fully replaces SF there.
   - Increment-2 Minor roll-up (deferred): robots isAllowed specificity metric strips */$ before
     length-count (no wrong input found — 1-line comment nice-to-have); single-letter locals in
     the coverage refactor; mode='hybrid' with only opts.seeds+0-expansion → sitemapBaseline=seed set.
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

- **hybrid-discovery Increment 2 (THE CRAWLER) BUILT + MERGED (PR #109) + DEPLOYED 2026-07-06.**
  Bounded raw-HTTP same-domain BFS behind a `hybrid` flag, seoIntent-audits-only; per-URL
  provenance on new nullable `SiteAudit.discoverySourcesJson` (migration
  `20260705080000_discovery_sources`); dual miss-rate (`sitemapMissRate` +
  `residualMissRate`). 8 TDD tasks, per-task + opus whole-branch review, 6 real bugs
  caught+fixed. Gates green (tsc / 3418 tests / build). **Feature prod-verification is the
  single open thread** — needs Kevin's `er_auth` cookie (step 3 above).
- **A1, A2, A2-f1, A3, A4, B1–B5, C1–C10, C9(A+B), D0 all COMPLETE + PROD-VERIFIED.** C7 complete.
  C6 Phases 1–4 + on-page + live score + redirect/canonical/hreflang + external-link +
  hybrid-discovery Increment 1 (miss-rate mechanism, with DATA) + **Increment 2 (the crawler)** shipped.
- **SF-retirement Phase 1 gate DATA in hand** (7-client parity + 7 miss-rate points, 7.7%–42.2%).
  Cycle 1 done; the roadmap wants 2–3 cycles (accrue on future audits — now hybrid).
- **Weekly canary still LIVE:** client 31 "ER Staging Canary" → proway.erstaging.site,
  `weekly:1@06:00` (noindex → plumbing only).
- **⚠ Human-in-the-loop leftovers (Kevin, none blocking a code change):** 1. Increment-2 feature
  prod-verify (cookie). 2. brockway WAF-403 allowlist. 3. parity cycles 2–3. 4. tokenErrorCode()
  fix. 5. A4 uptime monitor + `/admin/ops` eyeball. 6. D0 `ALERT_WEBHOOK_URL`. 7. B4 quarter-plan
  decision; first real qct_ push; C10 SA-grant.
- **Blocked / gated:** Anthropic API billing (direct memo generation). Daily/nightly cadences still gated.

## Next item

**Feature prod-verification of hybrid-discovery Increment 2 (step 3 — needs Kevin's `er_auth`
cookie).** Then the roadmap menu (step 4): the standout follow-on is **reachability graph 3b**,
which Increment 2 just unblocked (the crawler now supplies discovered nodes beyond the audited
set for true orphan/depth analysis). Cheaper alternatives: parity cycles 2–3 (operational,
pairs with the verify), or Track A code infra (A5/A6/A7).

## Gotchas / decisions already made (don't relitigate)

- **The live-scan run is built by a SEPARATE `broken-link-verify` job AFTER the SiteAudit reaches
  `complete`** (fire-and-forget, concurrency 1). "SiteAudit complete" ≠ "live run ready" — poll for
  the run, not the audit. `recoverBrokenLinkVerifies()` (boot + every 10 min) re-enqueues stranded
  verifiers while transient rows persist.
- **Increment 2 is seoIntent-gated.** `discoverPages` only crawls when the `hybrid` flag is true,
  which the discover handler sets to `audit.seoIntent`. A plain ADA audit is byte-identical to
  pre-Increment-2 behavior. If a seoIntent audit does NOT get `discoveryMode:'hybrid'`, confirm the
  POST carried `seoIntent:true` (strict `=== true`) and the effective crawl budget wasn't below the
  15s floor (it skips hybrid, falls back to sitemap-only, if the discover job is already time-starved).
- **Two-representation crawler:** the BFS keeps a coverage-normalized `key` (dedup + `sources` map)
  and a resolved real `fetchUrl` (what's fetched + emitted in `urls`). NEVER fetch the coverage key
  (it strips root trailing slash / www / pins https). robots `isAllowed` matches the RESOLVED path,
  not the key (trailing slash is significant to `Disallow` patterns). Both were real bugs, fixed.
- **Miss-rate continuity:** for hybrid runs, `computeDiscoveryCoverage` diffs against the SITEMAP-only
  baseline (derived from `discoverySourcesJson` source∈{sitemap,seed,shallow}) for `sitemapMissRate`
  (comparable to Increment-1 / cycle-1 data) and against the FULL baseline for `residualMissRate`.
  For a NON-hybrid run (no `discoverySourcesJson`) the legacy `missRate`/`applicable` are byte-identical.
- **Crawl budget = `min(HYBRID_CRAWL_TIME_BUDGET_MS ceiling, discover-job-remaining − 60s insert reserve)`,
  floor 15s.** The env ceiling is the PRIMARY guard (kept live so it's tunable without redeploy); the
  remaining-time only clamps it down. `??` (fallback) would let the handler's larger remaining-time
  bypass the ceiling — that was a real bug fixed by the final review. All 7 `HYBRID_CRAWL_*` have
  safe defaults; a bad value can't crash boot (parse-with-fallback).
- **The `safeFetch` 999-hang (fixed #107, hardened #108) is the model bug:** a promise that never
  settles cannot be stopped by any downstream time budget. When a verify job "times out" but its
  targets resolve fast in isolation, suspect a non-settling await, not a slow site.
- **`priority.service` scores by type-weight × count-scale, count-0 scale 1.0** — never emit
  zero-count findings; surface measurement as run metadata (`discoveryCoverageJson`) / `run.status`.
  (Miss-rate is NOT a Finding for this reason.)
- **Uploading SF crawls via curl:** the reverse proxy rejects ~44-part multipart requests (exit 56) —
  batch to ≤12 files, append to the same `sessionId`; add per-batch retries (macOS LibreSSL
  `bad record mac`). Only ~44 of 47 SF CSVs matter — exclude the 3 giants (`all_inlinks`/`all_outlinks`/
  `all_anchor_text`). Parse (`POST /api/parse/<sid>`) is synchronous + auto-matches the client by domain.
- **`er_auth` cookie is 12h TTL.** Do cookie-dependent work (upload/parse/trigger) up front; polling +
  recording are read-only SSH and outlive the cookie. Prod is OAuth-only (`ALLOW_PASSWORD_LOGIN=false`).
- **Prod has NO sqlite3 CLI** — drive read-only prod queries with a throwaway `.ts` via `npx tsx` from
  the app dir; import as `@/lib/db`. Keep scratch `.ts` OUTSIDE the repo tree (`next build` type-checks
  every `.ts`; a stray one breaks the deploy — bit us 2026-07-04).
- **Deploy protocol:** code/config → plain `~/deploy.sh` (migrations auto-apply); `ecosystem.config.js`/
  env changes → `pm2 delete && pm2 start`.
- **NEVER `git add -A` at repo root** — `pentest-results/`, `SEO_Report_1st_Draft.pdf`,
  `googlefc472dc61896519a.html` are untracked + not gitignored. Add explicit paths only.
- **Injected-into-page code must stay SWC-helper-free** (`parse-seo-dom.ts`, no `typeof`). **Never rely
  on `Class.name`/function names at runtime** (SWC minifies). (Neither applies to the Increment-2 crawler —
  it does raw HTTP, no `.toString()` injection.)
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
- 2026-07-06 — A4 (#103, `75e160a`). Slack alert enrichment (#104). SF-retirement Phase 1 DATA (7-client parity + first miss-rate, 3 verifier bugs #105/#106/#107). safeFetch hardening (#108, `b68a83f`).
- 2026-07-06 — **hybrid-discovery Increment 2 (THE CRAWLER) MERGED (PR #109) + DEPLOYED.** seoIntent-gated bounded raw-HTTP BFS; `SiteAudit.discoverySourcesJson` (migration `20260705080000_discovery_sources`); dual miss-rate; 8 TDD tasks, opus whole-branch review, 6 real bugs caught+fixed. **Next: feature prod-verify (Kevin's cookie), then reachability graph 3b / parity cycles 2–3 / Track A.**
```
