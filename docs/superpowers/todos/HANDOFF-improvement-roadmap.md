# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-06 (**hybrid-discovery Increment 2 PROD-VERIFIED; reachability graph 3b is the new active build — brainstorm phase**) · **Updated by:** the Increment-2 verify + 3b-kickoff session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: hybrid-discovery Increment 2 (THE CRAWLER) is BUILT + MERGED (PR #109) +
DEPLOYED + PROD-VERIFIED (2026-07-06). Kevin then picked the next build:
REACHABILITY GRAPH 3b (roadmap 3b) — now unblocked by Increment 2 (the crawler
supplies discovered nodes beyond the audited set for true orphan/depth analysis).
3b is in the brainstorm→spec→plan→TDD pipeline; check the tracker + docs/superpowers/
specs|plans for how far it got. If no 3b spec exists yet, start at brainstorming.

Increment-2 verification result (recorded 2026-07-06, parity log + tracker): a fresh
seoIntent audit on manhattanschool.edu (client 12) produced discoveryMode:'hybrid',
discoverySourcesJson {sitemap:67, linked:42} (crawler added 42 link-reachable pages
the sitemap omitted; 109 discovered vs 67 sitemap-only, stoppedBy:'exhausted'),
sitemapMissRate 38.5% (≈ cycle-1 37.4%) + residualMissRate 2.7% (crawler closed the
gap; residual = tracking-param dupes + one asset = effectively 0% real content).
Also = manhattan parity cycle 2 (live score 91). PASS on every runbook check.

1. Load the skill er-seo-tools-change-control first. Gate policy (2026-07-03 ruling,
   rules 1 & 4): THIS PASTED PROMPT is standing authorization to merge pending roadmap
   PRs at session start (re-run gates lint/test/build on the branch this session first)
   and to deploy when needed, ALWAYS followed immediately by post-deploy verification.
   Destructive server ops (prod data deletion, server .env edits, DB restore) stay
   Kevin-gated; docs rituals mandatory; never scan non-client sites. Brainstorm->spec->
   plan runs ungated (route design questions to Codex, not Kevin — notify Kevin one line
   per artifact, don't wait; only a Codex "rewrite" verdict or contradiction with a prior
   Kevin decision pauses the flow).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md + the tracker
   docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md + the parity log
   docs/superpowers/todos/2026-07-05-sf-live-parity-log.md. Trust ranking when docs
   disagree: code > plan/spec > tracker/handoff. ALWAYS re-map the actual code before
   writing a spec (skills/handoff scope drifts — proven repeatedly).
3. THE ACTIVE WORK — reachability graph 3b. Kevin's pick 2026-07-06. Intent: use the
   Increment-2 crawler's discovered-node set (beyond the audited page set) to compute
   truer orphan detection + clicks-from-home (crawl depth) than the current
   computeLinkGraph. Key code to re-map BEFORE speccing:
     - lib/ada-audit/seo/link-graph.ts (computeLinkGraph — currently DISCARDS link targets
       outside the audited set at ~line 20; those discarded same-domain targets are exactly
       the extra reachability signal Increment 1/2 exposed).
     - lib/ada-audit/seo/hybrid-crawl.ts + SiteAudit.discoverySourcesJson (the crawler's
       per-URL provenance {sources:url->('sitemap'|'linked'|...)}, sitemapCount, stoppedBy).
     - lib/ada-audit/seo/discovery-coverage.ts (how coverage already diffs link targets vs
       baseline — the reachability graph is the richer sibling of this).
     - lib/findings/live-seo-score.ts (scoreLiveSeo — crawl-depth is DELIBERATELY excluded
       from the denominator today; folding depth in is a test-breaking decision, gated on
       parallel-run evidence — DO NOT fold it in without Kevin's sign-off + evidence).
   Pipeline: brainstorm (lock scope with Kevin) → spec (Codex) → plan (Codex) → subagent
   TDD → gates → PR → merge → deploy → prod-verify. Watch the priority.service landmine:
   NEVER emit a zero-count finding (count-0 scale 1.0 inflates the score) — surface graph
   metrics as run metadata (like discoveryCoverageJson), not Findings.
4. Alternatives if Kevin redirects off 3b:
   a. Parity cycles 2-3 — roadmap wants 2-3 cycles; cycle 1 done, manhattan cycle 2 done
      (via the Increment-2 verify). Re-run the other 6 clients on future seoIntent audits
      (now hybrid) + append to the parity log. Operational; needs Kevin's cookie.
   b. Content similarity (roadmap Phase 5) — @xenova/transformers in deps; normalized text
      fingerprints + boilerplate control; spec what's stored (hashes/shingles, never raw
      pages) + retention.
   c. Track A infra (code-only, no auth): A5 shared status hook -> optional SSE (0.5 wk) ·
      A6 shared UI primitives + data-driven nav (1 wk) · A7 auth hardening + per-worker test
      DBs + one Playwright smoke (1 wk).
   d. Track D workflow-polish: D1 handoff-engine consolidation · D3 shared lib/seo-fetch/ ·
      D4 client robots/sitemap checks · D6 RankMath generator.
   e. Analytics (roadmap Phase 6): SEMrush/DataForSEO ingestion + memo consumption (memo
      consumption gated on the Anthropic API billing decision).
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

- **hybrid-discovery Increment 2 (THE CRAWLER) BUILT + MERGED (PR #109) + DEPLOYED + PROD-VERIFIED 2026-07-06.**
  Bounded raw-HTTP same-domain BFS behind a `hybrid` flag, seoIntent-audits-only; per-URL
  provenance on `SiteAudit.discoverySourcesJson`; dual miss-rate. **Prod-verify PASS**
  (manhattanschool.edu: `discoveryMode:'hybrid'`, `{sitemap:67, linked:42}`, sitemapMissRate
  38.5% → residualMissRate 2.7%, stoppedBy `exhausted`). See tracker latest + parity log.
- **Reachability graph 3b is the NEW ACTIVE BUILD** (Kevin's pick 2026-07-06), unblocked by
  Increment 2. In the brainstorm→spec→plan→TDD pipeline (step 3 above). Extends
  `computeLinkGraph` to true-er orphans + clicks-from-home using the crawler's discovered-node set.
- **A1, A2, A2-f1, A3, A4, B1–B5, C1–C10, C9(A+B), D0 all COMPLETE + PROD-VERIFIED.** C7 complete.
  C6 Phases 1–4 + on-page + live score + redirect/canonical/hreflang + external-link +
  hybrid-discovery Increment 1 + **Increment 2 (the crawler, prod-verified)** shipped.
- **SF-retirement Phase 1 gate DATA in hand** (7-client parity + 7 miss-rate points, 7.7%–42.2%).
  Cycle 1 done; manhattan cycle 2 done (via Increment-2 verify). Roadmap wants 2–3 cycles.
- **Weekly canary still LIVE:** client 31 "ER Staging Canary" → proway.erstaging.site,
  `weekly:1@06:00` (noindex → plumbing only).
- **⚠ Human-in-the-loop leftovers (Kevin, none blocking a code change):** 1. brockway WAF-403
  allowlist. 2. parity cycles 2–3 (6 remaining clients). 3. tokenErrorCode() fix. 4. A4 uptime
  monitor + `/admin/ops` eyeball. 5. D0 `ALERT_WEBHOOK_URL`. 6. B4 quarter-plan decision; first
  real qct_ push; C10 SA-grant.
- **Blocked / gated:** Anthropic API billing (direct memo generation). Daily/nightly cadences still gated.

## Next item

**Reachability graph 3b** (step 3) — brainstorm → spec → plan → TDD. Increment 2 just unblocked
it (the crawler now supplies discovered nodes beyond the audited set for true orphan/depth
analysis). Cheaper alternatives if Kevin redirects: parity cycles 2–3 (operational), content
similarity Phase 5, or Track A code infra (A5/A6/A7).

## Gotchas / decisions already made (don't relitigate)

- **crawl-depth is DELIBERATELY excluded from `scoreLiveSeo`** (live-seo-score.ts) — folding
  reachability depth into the live score is a known test-breaking decision (the depth-guard
  test), gated on parallel-run evidence + Kevin's sign-off. 3b can COMPUTE depth/orphans without
  touching the score; changing the score is a separate, gated step.
- **`priority.service` scores by type-weight × count-scale, count-0 scale 1.0** — never emit
  zero-count findings; surface measurement as run metadata (`discoveryCoverageJson`) / `run.status`.
  Reachability metrics follow the same rule (metadata, not a Finding).
- **The live-scan run is built by a SEPARATE `broken-link-verify` job AFTER the SiteAudit reaches
  `complete`** (fire-and-forget, concurrency 1). "SiteAudit complete" ≠ "live run ready" — poll for
  the run, not the audit. `recoverBrokenLinkVerifies()` (boot + every 10 min) re-enqueues stranded verifiers.
- **Increment 2 is seoIntent-gated.** `discoverPages` only crawls when the `hybrid` flag is true,
  which the discover handler sets to `audit.seoIntent`. A plain ADA audit is byte-identical to
  pre-Increment-2. If a seoIntent audit does NOT get `discoveryMode:'hybrid'`, confirm the POST
  carried `seoIntent:true` (strict `=== true`) and the crawl budget wasn't below the 15s floor.
- **Two-representation crawler:** the BFS keeps a coverage-normalized `key` (dedup + `sources` map)
  and a resolved real `fetchUrl`. NEVER fetch the coverage key. robots `isAllowed` matches the
  RESOLVED path, not the key.
- **Miss-rate continuity:** hybrid runs report `sitemapMissRate` (vs sitemap-only baseline, cycle-
  comparable) + `residualMissRate` (vs full baseline = the success number). Non-hybrid runs keep
  byte-identical legacy `missRate`/`applicable`.
- **Verified live (manhattan 2026-07-06):** the crawler works end-to-end in prod — 42 linked pages
  found beyond a 67-page sitemap, residual miss 2.7%, `stoppedBy:'exhausted'`.
- **The `safeFetch` 999-hang (fixed #107, hardened #108) is the model bug:** a promise that never
  settles cannot be stopped by any downstream time budget. When a verify job "times out" but its
  targets resolve fast in isolation, suspect a non-settling await, not a slow site.
- **`er_auth` cookie is 12h TTL.** Do cookie-dependent work (upload/parse/trigger) up front; polling
  + recording are read-only SSH and outlive the cookie. Prod is OAuth-only (`ALLOW_PASSWORD_LOGIN=false`).
- **Prod has NO sqlite3 CLI** — drive read-only prod queries with a throwaway `.ts` via `npx tsx`
  from the app dir; import as `@/lib/db`. Keep scratch `.ts` OUTSIDE the repo tree (`next build`
  type-checks every `.ts`; a stray one breaks the deploy). Clean it up after.
- **Deploy protocol:** code/config → plain `~/deploy.sh` (migrations auto-apply); `ecosystem.config.js`/
  env changes → `pm2 delete && pm2 start`.
- **NEVER `git add -A` at repo root** — `pentest-results/`, `SEO_Report_1st_Draft.pdf`,
  `googlefc472dc61896519a.html` are untracked + not gitignored. Add explicit paths only.
- **Injected-into-page code must stay SWC-helper-free** (`parse-seo-dom.ts`, no `typeof`). **Never
  rely on `Class.name`/function names at runtime** (SWC minifies). (Neither applies to the Increment-2
  crawler — it does raw HTTP, no `.toString()` injection.)
- **Canonical-run selection (on main since PR #85):** `pickCanonicalSeo` — fresh SF (≤30 d) wins; a
  newer seoIntent live run supersedes; a NON-seoIntent live run can NEVER be canonical.
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
- 2026-07-06 — **hybrid-discovery Increment 2 (THE CRAWLER) MERGED (PR #109) + DEPLOYED + PROD-VERIFIED** (manhattanschool.edu: hybrid, 42 linked pages beyond a 67-page sitemap, residualMissRate 2.7%). seoIntent-gated bounded raw-HTTP BFS; `SiteAudit.discoverySourcesJson` (migration `20260705080000_discovery_sources`); dual miss-rate. **Next: reachability graph 3b (Kevin's pick) — now in the brainstorm→spec→plan pipeline.**
