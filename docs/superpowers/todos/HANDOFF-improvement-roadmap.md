# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-06 (SF-retirement Phase 1 — **7-client parity + first miss-rate DATA collected**; 3 verifier bugs found+fixed, incl. the real `safeFetch` 999 hang) · **Updated by:** the SF-retirement data-stream session. Next action is a **roadmap-menu pick** — hybrid-discovery Increment 2 (the crawler) is now **evidence-backed and ungated**.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: SF-retirement Phase 1 gate DATA is IN HAND (2026-07-06). There is NO
work-in-progress. The next action is a roadmap-menu pick (see step 3).

This session (2026-07-06 PM): Kevin picked the SF-retirement data stream and supplied
an er_auth cookie so I drove it autonomously. Collected the full 7-client parity +
sitemap miss-rate dataset (bidwell 3, boca 4, brockway 5, brownson 6, manhattan 12,
discovery 26, cambria 29): upload SF export at /seo-parser -> parse -> trigger a
seoIntent site audit -> record sf-live-parity.ts + the live run's discoveryCoverageJson.
RESULT — both gates MET (cycle 1): >=5-client parity (7 clients, all deviations
explained) AND the FIRST discoveryCoverageJson miss-rate data ever (was 0 -> 7 points,
7.7%-42.2%, median ~21%, 4/7 >=18%, 3/7 >=37%) = strong quantified evidence FOR building
hybrid-discovery Increment 2. Full table in docs/superpowers/todos/2026-07-05-sf-live-parity-log.md.

The batch (first-ever run of the live scanner across real medium/large client sites)
surfaced 3 verifier bugs, all fixed+deployed+prod-verified:
- PR #105 (8588f56): internal-link verify pass had no time budget (external did) ->
  slow sites died before the run write. Added BROKEN_LINK_INTERNAL_TIME_BUDGET_MS +
  clamped deadline + failure isolation + internalBudgetHit->partial.
- PR #106 (75bc134): widened SAFETY_RESERVE_MS 60s->180s (allocation margin; mis-aimed
  but harmless).
- PR #107 (d95d70b, THE real fix): safeFetch hung forever on out-of-range HTTP status
  (LinkedIn's 999) — new Response({status}) throws RangeError inside the response
  callback after settled=true -> promise never settles -> verifier worker blocks ->
  15-min job timeout cycle (manhattan, cambria). A time budget can't stop a promise
  that never settles. Fix: isConstructibleResponseStatus guard + try/catch around the
  whole Response construction (Codex ACCEPT-WITH-FIXES; SSRF-neutral). After #107 all
  7 built (manhattan 99, cambria 100, brownson 90 complete; boca/discovery/brockway
  partial from external-cap / WAF-403s, not timeouts).

A1/A2/A2-f1/A3/A4/B1-B5/C1-C10/C9(A+B)/D0 all COMPLETE + PROD-VERIFIED. C7 complete.
C6: Phases 1-4 + on-page + live score + redirect/canonical/hreflang + external-link +
hybrid-discovery Increment 1 (miss-rate MECHANISM) shipped — and Increment 1 now has
DATA (7 points). A 16-skill operator library lives in .claude/skills/.

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
3. PICK THE NEXT ITEM (ask Kevin if unsure — genuine fork):
   a. Hybrid-discovery Increment 2 — THE CRAWLER (roadmap C6 Phase 2). Now UNGATED:
      the miss-rate data (7.7%-42.2%, 3/7 sites >=37%) is the evidence the roadmap
      required before building it. Big feature-class build: extend discoverPages() to
      a capped same-domain BFS frontier (sitemap + linked), per-URL source tag, robots
      respect, crawl-trap heuristics, dedup via the shared normalizer, 1000-page-cap
      interplay + runtime budget defined BEFORE coding. Spec obligations in the campaign
      skill (er-seo-tools-sf-retirement-campaign Phase 2). RECOMMENDED marquee item.
   b. Parity cycles 2-3 — the roadmap wants 2-3 reporting cycles; cycle 1 is done.
      Cheap/operational: re-run the 7 (or add clients) on future scheduled/manual audits
      and append to the parity log. Needs Kevin's authed session (or the er_auth cookie).
   c. Track A infra (code-buildable, no auth): A5 shared status hook -> optional SSE
      (0.5 wk) · A6 shared UI primitives in components/ui/ + data-driven nav (1 wk) ·
      A7 auth hardening (per-operator attribution + login rate-limit) + per-worker test
      DBs + one Playwright smoke suite (1 wk).
   d. Track D workflow-polish: D1 handoff-engine consolidation · D3 shared lib/seo-fetch/
      · D4 client robots/sitemap checks · D6 RankMath generator.
   e. Further C6: reachability graph 3b (needs Increment 2) · content similarity Phase 5.
   Recommended: (a) hybrid-discovery Increment 2 — it's the evidence-backed payoff of
   the miss-rate work. A5/A6 for a heads-down code-only session.
4. Reusable real crawls for any fixture/parity need (never scan non-client sites):
   /Users/kevin/enrollment-resources/sf-crawls/{manhattan,bidwell,boca,brockway,brownson,
   cambria,discovery}/<newest>/ — 7 clients, fresh (2026-07-03..05), all uploaded to prod.
5. Small open follow-ups (not blocking):
   - broken-link-verify maxAttempts inconsistency: registers maxAttempts:2 but
     enqueueBrokenLinkVerify passes none so Job rows carry schema @default(3). Harmless.
   - brockway (client 5) serves HTTP 403 to the scanner (WAF): 28/84 pages blocked.
     Its server IP needs allowlisting before the live scanner fully replaces SF there.
   - tokenErrorCode() expired-token bug (from A3): expired qct_ tokens report
     token_invalid not token_expired. Fix + repoint the Phase-1 test.
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

- **SF-retirement Phase 1 gate DATA collected (2026-07-06).** 7-client parity +
  7 `discoveryCoverageJson` miss-rate points (7.7%–42.2%). Both gates met for cycle 1.
  Parity log `2026-07-05-sf-live-parity-log.md` has the full table + per-domain
  deviation notes + the 3-PR bug arc. **NO work-in-progress.**
- **3 verifier bugs fixed + deployed + prod-verified:** PR #105 (internal verify time
  budget, `8588f56`), #106 (reserve margin, `75bc134`), **#107 (the real `safeFetch`
  999-hang fix, `d95d70b`)**. All gate-green, Codex-reviewed.
- **A1, A2, A2-f1, A3, A4, B1–B5, C1–C10, C9(A+B), D0 all COMPLETE + PROD-VERIFIED.**
  C7 complete. C6 Phases 1–4 + on-page + live score + redirect/canonical/hreflang +
  external-link + hybrid-discovery Increment 1 shipped — Increment 1 now has DATA.
- **Weekly canary still LIVE:** client 31 "ER Staging Canary" → proway.erstaging.site,
  `weekly:1@06:00` (noindex → plumbing only).
- **⚠ Human-in-the-loop leftovers (Kevin, none blocking a code change):**
  1. brockway WAF-403 allowlist (if the live scanner should fully cover client 5).
  2. Parity cycles 2–3 (re-run on future audits — needs authed session / cookie).
  3. tokenErrorCode() expired-token fix. 4. A4 uptime monitor + `/admin/ops` eyeball.
  5. D0 `ALERT_WEBHOOK_URL`. 6. B4 quarter-plan decision; first real qct_ push; C10 SA-grant.
- **Blocked / gated:** Anthropic API billing. **hybrid-discovery Increment 2 is now
  UNGATED** (miss-rate data in hand). Daily/nightly cadences still gated.

## Next item

**No WIP — pick from the roadmap menu (step 3).** The standout: **hybrid-discovery
Increment 2 (the crawler)** is now evidence-backed and ungated — it's the payoff of the
miss-rate measurement (sitemaps miss 8–42% of reachable pages; 3/7 sites ≥37%). It's a
big feature-class build (capped same-domain BFS frontier atop `discoverPages`). Cheaper
alternatives: parity cycles 2–3 (operational), or Track A code infra (A5/A6/A7).

## Gotchas / decisions already made (don't relitigate)

- **Doc-integrity lesson (2026-07-06):** the A4 session left CLAUDE.md + tracker +
  handoff **modified-but-uncommitted**; this session's `git reset --hard origin/main`
  (branch reconciliation after squash-merges) silently discarded them (A4 CODE was
  safe — only prose lost; reconstructed from context). **COMMIT doc updates immediately,
  in the same commit as the work. Before ANY `git reset --hard`, check `git status` for
  modified tracked docs and commit/stash them first.** For reconciling local main after
  a squash-merge, prefer `git status` inspection first; `reset --hard origin/main` is
  only safe when the working tree has no uncommitted work you care about.
- **The `safeFetch` 999-hang (fixed #107) is the model bug of this session:** a promise
  that never settles cannot be stopped by any downstream time budget. When a verify job
  "times out" but its targets resolve fast in isolation, suspect a non-settling await
  (out-of-range status, unbounded DNS, etc.), not a slow site. `isConstructibleResponseStatus`
  now guards `new Response` in `lib/security/safe-url.ts`.
- **The live scanner had NEVER been batch-run across real medium/large client sites before
  this session** — that's why 3 latent bugs surfaced at once. Expect more first-contact
  bugs when Increment 2 changes the crawl shape.
- **Uploading SF crawls via curl:** the reverse proxy rejects ~44-part multipart requests
  (exit 56) — batch uploads to ≤12 files, appending to the same `sessionId` (the route
  supports it while `status:'pending'`); add per-batch retries (macOS LibreSSL throws
  `bad record mac` on occasional TLS hiccups). Only ~44 of the 47 SF CSVs matter — exclude
  the 3 giants (`all_inlinks`/`all_outlinks`/`all_anchor_text`, parser ignores them) to
  keep payloads <10MB. Parse (`POST /api/parse/<sid>`) is synchronous + auto-matches the
  client by domain from the CSV URLs.
- **`er_auth` cookie is 12h TTL.** Do all cookie-dependent work (upload/parse/trigger)
  up front; polling + recording are read-only SSH and outlive the cookie. Prod is
  OAuth-only (`ALLOW_PASSWORD_LOGIN=false`).
- **The live-scan run is built by a SEPARATE `broken-link-verify` job AFTER the SiteAudit
  reaches `complete`** (fire-and-forget, concurrency 1). "SiteAudit complete" ≠ "live run
  ready" — poll for the run, not the audit. `recoverBrokenLinkVerifies()` (boot + every
  10 min) re-enqueues stranded verifiers while transient `HarvestedLink`/`HarvestedPageSeo`
  rows persist — this is how the stranded jobs rebuilt after each deploy.
- **Gate-critical outputs (score, coverage/miss-rate, on-page findings) are
  verification-INDEPENDENT** — computed from harvested rows after the link passes. So a
  `partial` run (verification truncated) still has complete score + coverage + on-page.
- **`priority.service` scores by type-weight × count-scale, count-0 scale 1.0** — never
  emit zero-count findings; surface measurement as run metadata (`discoveryCoverageJson`) / `run.status`.
- **Miss-rate cleanliness:** raw parity Jaccard is asset-inflated (SF crawls CSS/JS/images;
  live scan is page-only). The clean instrument is `discoveryCoverageJson.missRate`
  (excludes images + non-page ext), NOT Jaccard.
- **NEVER `git add -A` at repo root** — `pentest-results/`, `SEO_Report_1st_Draft.pdf`,
  `googlefc472dc61896519a.html` are untracked + not gitignored. Add explicit paths only.
  (Bit me this session while staging a diff for Codex — caught + unstaged before commit.)
- **Prod has NO sqlite3 CLI** — drive read-only prod queries with a throwaway `.ts` via
  `npx tsx` from the app dir; import as `@/lib/db` (NOT `./lib/db` — relative resolves
  against the file's dir). Keep scratch `.ts` OUTSIDE the repo tree (`next build`
  type-checks every `.ts`; a stray one breaks the deploy — bit us 2026-07-04).
- **Deploy protocol:** code/config → plain `~/deploy.sh` (migrations auto-apply);
  `ecosystem.config.js`/env changes → `pm2 delete && pm2 start`.
- **Injected-into-page code must stay SWC-helper-free** (`parse-seo-dom.ts`, no `typeof`).
- **Never rely on `Class.name`/function names at runtime** (SWC minifies).
- **Canonical-run selection (on main since PR #85):** `pickCanonicalSeo` — fresh SF (≤30 d)
  wins; a newer seoIntent live run supersedes; a NON-seoIntent live run can NEVER be canonical.
- **Prod URL** `https://seo.erstaging.site`; prod DB `/home/seo/data/seo-tools/db.sqlite`;
  app dir `/home/seo/webapps/seo-tools`. Unauth API → `401 {"error":"auth_required"}`.
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only.
- **Codex session for this workspace:** `019f2b57-...` (registry `~/.claude/state/codex-consultations.json`).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, handoff created.
- 2026-06-10 — A1 Phases 0–4 (PRs #50–#54), prod-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), prod-verified. **A2 COMPLETE.**
- 2026-06-11 — B1–B5 (#60–#64 + middleware fix) shipped + prod-verified. **TRACK B COMPLETE.**
- 2026-06-11/12 — C1 (#65), C2 (#66), C3 (#67), C4 (#68), C5 (#69) SHIPPED.
- 2026-06-16/17 — C6 Phases 1–3 (#70, #71, #73) SHIPPED + prod-verified.
- 2026-06-22 — C10 (#75) + build-heap fix (#76), deployed, migration applied.
- 2026-07-02 — Skill library SHIPPED. C6 Phase 4 MERGED+DEPLOYED (#85). C10 PROD-VERIFIED. D0 SHIPPED (#86). A2-f1 COMPLETE.
- 2026-07-03 — C8 (#90) + upload hotfix (#91) + C7 (#93/#94/#95) + C6 redirect/canonical/hreflang (#96) — MERGED+DEPLOYED+VERIFIED.
- 2026-07-04 — C9-A (#97) + C9-B (#98) + streaming parse concurrency (#99) + C6 external-link (#100) + C6 hybrid discovery Increment 1 (#101) — MERGED+DEPLOYED+VERIFIED. Migration `20260704120000_discovery_coverage`.
- 2026-07-05 — **A3 (API route kit) MERGED (#102) + DEPLOYED + PROD-VERIFIED. A3 COMPLETE.** + SF-retirement Phase 1 kickoff (6 fresh SF crawls on disk; parity log created).
- 2026-07-06 — **A4 observability floor MERGED (#103, `75e160a`) + DEPLOYED + PROD-VERIFIED. A4 COMPLETE.** (A4 doc updates were later lost to a `git reset --hard` and reconstructed — see tracker note.)
- 2026-07-06 — **Slack alert enrichment MERGED (#104) + archived (`f5db71b`).**
- 2026-07-06 — **SF-retirement Phase 1 DATA: 7-client parity + first miss-rate (7 points, 7.7%–42.2%) collected.** 3 verifier bugs fixed: PR #105 (`8588f56`) internal verify time budget, #106 (`75bc134`) reserve margin, **#107 (`d95d70b`) the `safeFetch` 999-hang** — all merged+deployed+prod-verified. Hybrid-discovery Increment 2 now ungated. **Next: roadmap menu (Increment 2 recommended).**
```
