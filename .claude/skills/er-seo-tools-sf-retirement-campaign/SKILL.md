---
name: er-seo-tools-sf-retirement-campaign
description: Use when retiring Screaming Frog from routine SEO work — merging/prod-verifying feat/autonomous-live-seo-source, triggering or debugging seoIntent live scans, measuring SF-vs-live parity, planning hybrid discovery, orphan analysis, redirect/canonical/hreflang validation, content similarity, or deciding if SF can be dropped for a client. Also when a live-scan CrawlRun is missing, its score is null, or canonical selection picks the wrong source.
---

# The Screaming Frog Retirement Campaign

## Overview

The goal is NOT to delete Screaming Frog (SF). It is to demote SF from a
*routine* per-client tool to a *deliberate fallback* — the native live scanner
(riding the ADA site-audit pipeline) becomes the always-on SEO source, and SF
returns only for discovery sweeps, migrations, ad-hoc/competitor crawls, and
low-confidence live runs. Every phase below is decision-gated: **success is
measured with numbers, never eyeballed.** Master strategy doc (read it before
any phase work): `docs/superpowers/nyi/2026-06-04-screaming-frog-retirement-roadmap.md`.

State as of **2026-07-02**: roadmap Phases 0–1 are shipped to prod
(tracker item C6 — live SEO phases — Phases 1–3); roadmap 3a — the audited-set link graph — plus the
canonical live source (C6 Phase 4) is **built, gate-green, on unmerged
branch `feat/autonomous-live-seo-source`** (23 commits ahead of main).
Campaign Phase 0 below is the immediate next action.

## Glossary (project jargon, defined once)

| Term | Meaning |
|---|---|
| SF | Screaming Frog SEO Spider. Analysts upload its CSV exports at `/seo-parser`; parsed into a `Session` + an `sf-upload` `CrawlRun` |
| Live scan | The SEO by-product of an ADA site audit: page jobs harvest links + on-page SEO into transient tables; the post-terminal `broken-link-verify` job builds ONE `CrawlRun` (`tool:'seo-parser'`, `source:'live-scan'`) per SiteAudit |
| `seoIntent` | Boolean on `SiteAudit` + `CrawlRun` (branch only). Marks an audit as SEO-purposed; only `seoIntent:true` live runs can become the canonical SEO source or appear in `/seo-parser` history |
| Canonical run | The one `CrawlRun` a surface treats as "the SEO truth" for a client+domain, chosen by `pickCanonicalSeo` (`lib/services/seo-canonical.ts`): fresh SF (≤30 d) wins; else a newer seoIntent live run supersedes; a non-seoIntent live run can NEVER be canonical. (Selection is merge-state-sensitive — both states: er-seo-tools-architecture-contract §6) |
| The builder | `lib/jobs/handlers/broken-link-verify.ts` — the single writer of the live-scan run (findings, graph scalars, score) |
| pat_ / srt_ / krt_ | Claude-skill handoff token prefixes: pillar memo / SEO roadmap memo / keyword memo. Only **pat_** works from a live run (plan decision D3); srt_/krt_ stay SF-session-bound in v1 |
| Canary | Prod weekly schedule: client 31 "ER Staging Canary" → proway.erstaging.site. **Noindex by design** → broken-link findings only, no on-page findings, `score:null`. Never "fix" those nulls |

## When to use / When NOT to use

Use this skill to execute or advance any campaign phase, or to interpret
seoIntent/canonical/parity behavior.

Do NOT use it for:
- **Process mechanics** (how to spec/plan/Codex-review/PR/deploy-gate) → `er-seo-tools-change-control`
- **General bug triage** (audit stuck, job stranded) → `er-seo-tools-debugging-playbook`
- **Score formulas / issue-type theory** → `er-seo-tools-domain-reference`
- **Adding routes/jobs/migrations mechanically** → `er-seo-tools-extension-recipes`
- **Open research questions beyond this campaign** → `er-seo-tools-research-frontier`
- **Prod paths / PM2 / deploy protocol details** → `er-seo-tools-run-and-operate`

## Promotion protocol (applies to EVERY phase)

Each phase ≥1 is a full change-control cycle — no shortcuts:
spec → Codex review → plan → Codex review → subagent TDD build → gates
(`npm run lint` + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`)
→ PR → **merge once gate-green → deploy when needed** (autonomous per the
2026-07-03 ruling — `er-seo-tools-change-control` rule 1) → prod verification →
tracker checkbox + status-log line + handoff rewrite in the same commit +
paste-in prompt in the final reply. The owner rules that remain absolute:

1. **Merge/deploy autonomy is conditional:** gates re-run green in this session,
   post-deploy verification immediately after every deploy, outcome reported.
   Destructive server ops (deleting prod data, server `.env` edits, DB restore)
   stay Kevin-gated in the current conversation.
2. **Never scan third-party sites.** Live scans, audits, and broken-link
   verification fetch real external websites. Only client sites already in the
   system (or domains you control). The canary (proway.erstaging.site) is the
   safe default target.
3. **Docs rituals are mandatory** even under time pressure.

---

## Campaign map

| Phase | What | Roadmap ref | Status (2026-07-02) |
|---|---|---|---|
| 0 | Merge + deploy + prod-verify `feat/autonomous-live-seo-source` | roadmap 3a + spec `docs/superpowers/specs/2026-06-30-autonomous-live-seo-source-design.md` | **NEXT ACTION** |
| 1 | SF-vs-live parity measurement (parallel run) | roadmap §4 parallel-run gate | Not started; unblocked by Phase 0 |
| 2 | Hybrid discovery (sitemap + link-graph frontier) | roadmap Phase 2 | Gated on sitemap miss-rate measurement (tracker gated decision) |
| 3 | Reachability graph + true depth / orphan analysis | roadmap 3b | Requires Phase 2 |
| 4 | Redirect / canonical / hreflang validation | roadmap Phase 4 | Open; solution menu below |
| 5 | Content similarity | roadmap Phase 5 | Open; embeddings asset already in deps |
| 6 | Analytics integrations | roadmap Phase 6 | GA4/GSC half SHIPPED (C10, SEO performance reports); SEMrush/DataForSEO + memo consumption remain |
| 7 | Operational retirement gate | roadmap Phase 7 + §4 | Criteria below; needs Phases 0–1 minimum |

---

## Phase 0 — Merge, deploy, prod-verify the autonomous live SEO source

What the branch delivers (verified against code, 2026-07-02): `CrawlRun.seoIntent`
+ `SiteAudit.seoIntent` (migration `20260630120000_live_seo_source`), link-graph
scalars (`CrawlPage.inlinks/outlinks/crawlDepth` via `computeLinkGraph` in the
builder), the canonical selector (`pickCanonicalSeo`/`selectCanonicalSeoRun`),
CrawlRun-native `/seo-parser` (merged source-labeled history + `results/run/[runId]`),
`getCanonicalPageFacts` provider, live pillar analysis (`runForCanonical`),
provider-fed brief (`POST /api/brief/live`), depth-guard test.

**Correcting the handoff doc:** `HANDOFF-improvement-roadmap.md` and the tracker
claim three unbuilt Phase-4 features (self-healing schedule creation, a
`lib/seo/providers/` layer, live srt_/krt_ memos) — plan + code are ground
truth; claim-vs-truth table: er-seo-tools-failure-archaeology entry 16.
Operationally: schedules are operator-created via
`POST /api/clients/[id]/schedules` with a `seoIntent` flag (D1: one schedule per
client+domain+seoIntent; ADA and SEO coexist), and only the pat_ pillar memo and
the brief work live (D3). Smoke-test the **brief or pillar**, not an srt_ memo.

### Gate 0.1 — pre-merge re-run (any session may do this)

```bash
git checkout feat/autonomous-live-seo-source && git log main..HEAD --oneline | wc -l
npm run lint                                        # tsc --noEmit
DATABASE_URL="file:./local-dev.db" npm test         # vitest run
npm run build                                       # heap flag baked into the script
```

**Expected:** 23 commits; tsc clean; all tests green; build completes.
- If tests fail only in DB-backed files → check `prisma/local-dev.db` has the
  branch migration: `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy`.
- If main has moved since (check `git log main -1 --oneline` vs tip `6679993`) →
  rebase/merge main first, re-run the gate, and re-request Codex review if
  conflicts touched campaign files.
- Any other failure → STOP, branch to `er-seo-tools-debugging-playbook`; do not
  present a red branch to Kevin.

### Gate 0.2 — merge + deploy (autonomous when Gate 0.1 is green)

Open the PR (`feat/autonomous-live-seo-source` → `main`), record the gate
output in the PR body, and merge (2026-07-03 ruling — a pasted roadmap
continuation prompt is standing authorization; gates must be green in THIS
session). Then deploy: `git push` first, then
`ssh $PROD_SSH "~/deploy.sh"` (server pulls from GitHub;
`prisma migrate deploy` applies `20260630120000_live_seo_source`
automatically). Gate 0.3 verification is mandatory immediately after.

**Expected after deploy:** PM2 restart clean, no migration errors in
`$LOG_HOME/`. If the migration fails → the `PillarAnalysis` table-rebuild
is the risky part (SQLite PRAGMA rebuild); do NOT hand-patch prod SQL — roll
back the deploy with Kevin and fix the migration in a follow-up commit.

### Gate 0.3 — prod verification runbook

Target: a real **client** site that is indexable (the canary is noindex — it
proves plumbing but can never produce on-page findings or a score).
manhattanschool.edu was the Phase-2/3 verification site.

**Step 1 — authed session (cookie jar):**
```bash
# Preferred: Kevin logs in via Google OAuth in a browser and supplies the
# er_auth cookie value (or runs these curls himself). Password login is the
# break-glass path — it 303s to /login?error=password_login_disabled if
# ALLOW_PASSWORD_LOGIN=false (Google OAuth is primary since PR #83/#84).
# If break-glass is used: NEVER echo/print the password or paste it into a
# transcript — source it into the shell env on the server and reference it
# only as $APP_AUTH_PASSWORD.
curl -s -c /tmp/jar -X POST "$APP_URL/api/auth/login" \
  --data-urlencode "password=$APP_AUTH_PASSWORD" -o /dev/null -w '%{http_code}\n'   # expect 303
```

**Step 2 — trigger a seoIntent audit:**
```bash
curl -s -b /tmp/jar -X POST "$APP_URL/api/site-audit" \
  -H 'Content-Type: application/json' \
  -d '{"domain":"<client-domain>","wcagLevel":"wcag21aa","clientId":<id>,"seoIntent":true}'
# expect HTTP 202 {"id":"...","status":"queued"}; 409 = an audit already in flight (wait it out)
```
Wait for the audit to reach `complete` (poll `/api/site-audit`, or the UI).
The full ADA pipeline runs (axe + screenshots + PSI) — SEO-only scan mode is a
`// FUTURE` breadcrumb at `app/api/site-audit/route.ts` +
`lib/jobs/handlers/scheduled-site-audit.ts`, NOT built. Budget minutes, not seconds.

**Step 3 — DB checks** (server has NO sqlite3 CLI; use Prisma from the app dir):
```bash
cd $APP_HOME && npx tsx -e "
import { prisma } from './lib/db'
async function main() {
  const run = await prisma.crawlRun.findFirst({
    where: { tool: 'seo-parser', source: 'live-scan', domain: '<client-domain>' },
    orderBy: { completedAt: 'desc' },
    select: { id: true, seoIntent: true, score: true, status: true, siteAuditId: true },
  })
  console.log(run)
  if (run) {
    const g = await prisma.crawlPage.aggregate({ where: { runId: run.id },
      _count: true, _avg: { inlinks: true, outlinks: true, crawlDepth: true } })
    console.log(g)
  }
}
main().finally(() => prisma.\$disconnect())"
```
**Expected:** `seoIntent: true`, `status: 'complete'` (`'partial'` is also
valid — it means the 2000-target verify cap or the 300/page harvest cap bit),
**non-null `score`** (0–100), non-null avg `inlinks`/`outlinks`, `crawlDepth`
avg present (may be null-heavy if the homepage redirected off-set — that is a
labeled degraded state, not a bug).

**Step 4 — UI checks:** `/seo-parser` history shows the run labeled **"Live
scan"** (SF entries say "SF upload"); clicking it opens
`/seo-parser/results/run/<runId>`; export/share/diff areas render the
"needs Screaming Frog data" state (`NeedsScreamingFrog`), never a 500.

**Step 5 — memo/brief smoke:**
```bash
curl -s -b /tmp/jar -X POST "$APP_URL/api/brief/live" -H 'Content-Type: application/json' \
  -d '{"clientId":<id>,"domain":"<client-domain>"}'
# expect 200 {brief, stats} with degraded (empty) keyword + schema sections; 404 = no canonical run
```
Pillar: `runForCanonical` (`lib/services/pillarAnalysis/runFromSession.ts`) has
**no HTTP trigger as of 2026-07-02** — invoke via
`npx tsx -e` calling `runForCanonical({ clientId, domain })` from the app dir,
then open `/pillar-analysis/<analysisId>` (poll path
`/api/pillar-analysis/by-analysis/<analysisId>` serves run-keyed analyses).
**Prod note:** `runForCanonical` PERSISTS a PillarAnalysis row (commit
`5d3454a`) — a prod-DB write. Under the 2026-07-03 ruling this benign
single-row write is allowed autonomously as part of this documented
verification runbook; report that you ran it. (Steps 1–4 above are reads;
this step is not.)

**Failure branches:**

| Observation | Branch |
|---|---|
| `score: null` | Expected iff: noindex/login-walled site (`indexableScored===0`), or observed coverage <50% (`observed` = HarvestedPageSeo rows, not `pagesComplete`), or `attempted===0`. Check `SELECT indexable FROM CrawlPage` for the run; if the site is genuinely indexable and coverage was high → real bug, capture the builder log lines |
| Live-scan run missing entirely | The verify enqueue is fire-and-forget. Check for a `broken-link-verify` job (group `site-audit:<id>`); if absent AND transient `HarvestedLink`/`HarvestedPageSeo` rows survive, `recoverBrokenLinkVerifies()` re-enqueues at boot + every 10 min (`stale-audit-reset`) — wait one sweep or restart. If transient rows are also gone with no run → the 7-d sweep ate them; re-run the audit |
| `seoIntent: false` on the run | The flag threads request → `SiteAudit.seoIntent` → builder (`broken-link-verify.ts` copies `site.seoIntent` onto the run). Confirm the POST body actually carried `seoIntent:true` (strict `=== true` check) |
| History shows no "Live scan" entry | History filters `seoIntent:true` only (`app/api/parse/history/route.ts`) — a plain ADA audit's live run is correctly absent |
| Wrong canonical (SF still shown) | Correct if the newest sf-upload run for that client+domain is ≤30 d old (`SEO_SF_CANONICAL_WINDOW_DAYS`). Fresh SF wins unconditionally by design |

**Step 6 — docs ritual:** tracker C6 status-log line + rewrite
`docs/superpowers/todos/HANDOFF-improvement-roadmap.md` (fix its three wrong
Phase-4 claims while you are in there) in the same commit; `git mv` the
2026-06-30 spec + plan from `docs/superpowers/{specs,plans}/` to
`docs/superpowers/archive/{specs,plans}/`; end the reply with the paste-in prompt.

---

## Phase 1 — Parity measurement (define the numbers BEFORE trusting)

The roadmap's retirement gate requires **documented, explainable variance from
side-by-side SF-vs-live runs over 2–3 normal reporting cycles**. Both sources
already land as `CrawlRun`s, so this is a query problem, not a build problem.

**Protocol per client:** same site, same day — analyst runs SF and uploads at
`/seo-parser`; trigger a `seoIntent:true` audit (Gate 0.3 Step 2). Then:

```bash
DATABASE_URL="file:./local-dev.db" npx tsx \
  .claude/skills/er-seo-tools-sf-retirement-campaign/scripts/sf-live-parity.ts <domain>
# prod: cd $APP_HOME && npx tsx <skill-script-path> <domain>
# NOTE: verify the skill directory is committed with:
#   git ls-files .claude/skills/er-seo-tools-sf-retirement-campaign/ | wc -l
# (0 = untracked → the script does not exist on prod; commit/merge/deploy the
# skill library first, or scp the script / run locally against a DB copy.)
```

The script (tested 2026-07-02) reports: score delta, page-set overlap
(normalized-URL Jaccard), and per-issue-type run-scope count deltas with the
known type alias mapped (`duplicate_titles` SF ↔ `duplicate_title` live).

**Metrics and expectations (record these per run in a dated parity log under
`docs/superpowers/todos/`):**

| Metric | Expectation | Deviation means |
|---|---|---|
| Page-set Jaccard | High (≥~0.9) when SF crawls the sitemap set | Low → SF discovered non-sitemap pages (evidence FOR Phase 2) or the audit's 1000-page cap bit |
| `missing_title/h1/meta`, `thin_content` deltas | Small (±few pages) | Live renders JS, SF (default) may not — rendered word counts differ; thin threshold is <300 words in both |
| `duplicate_*` deltas | Same GROUP-count semantics both sides — should be close | Divergence → trimmed-exact comparison differences or page-set mismatch |
| Score delta | NOT expected to be 0 — different denominators (live has no crawl-depth factor; SF renormalizes absent factors) | Track the distribution; explain outliers, don't tune to zero |
| Live-side "—" rows | EXPECTED for SF-only types (redirects, alt text, content duplicates…) | These are the known capability gaps — record, don't chase |

**Gate to pass Phase 1:** N ≥ 5 representative clients × 2–3 cycles with every
deviation explained in the log. An unexplained deviation is a bug hunt, not a
footnote. Broken-link counts: live checks internal targets only (cap 2000,
`BROKEN_LINK_MAX_CHECKS`), HEAD→GET; `unconfirmed` excluded — expect live ≤ SF.

---

## Phases 2–6 — build phases (each = full change-control cycle)

**Phase 2 — hybrid discovery** (roadmap Phase 2; the scanner becomes a crawler).
Gated on the tracker's open decision **"Sitemap miss-rate measurement"** — run
Phase 1 first and use SF-only page counts as the miss-rate evidence. **Build the
crawler only if clients' sitemaps routinely miss important pages** (roadmap §5).
Spec obligations if greenlit: extend `discoverPages()`
(`lib/ada-audit/sitemap-crawler.ts`) to a capped same-domain BFS frontier;
per-URL source tag (`sitemap|linked|seed|manual`); robots.txt respect; crawl-trap
heuristics (calendars, faceted params); dedup via the shared normalizer; the
1000-page cap interplay defined BEFORE coding; runtime budget vs the nightly window.

**Phase 3 — reachability + true depth + orphans** (roadmap 3b, requires Phase 2).
Today's graph is audited-set-only: `computeLinkGraph`
(`lib/ada-audit/seo/link-graph.ts`) BFSes harvested edges over audited pages;
depth is "approximate (audited-set)"; orphan = `inlinks===0` among indexable
non-login pages — meaning only "not linked by audited pages". Phase 3 extends
the edge set with discovered nodes for true-er orphans + clicks-from-home.
Folding depth into the live score afterwards is a **deliberate, test-breaking
decision**: the depth-guard test (`lib/findings/live-seo-score.test.ts`, "live
score excludes crawl depth (v1 guard)") must be consciously rewritten, gated on
Phase-1-style parallel-run evidence.

**Phase 4 — redirect / canonical / hreflang validation.** Solution menu, ranked:

| # | Option | Effort | Derivation obligations |
|---|---|---|---|
| 1 | Extend the builder: it already fetches every internal target (`checkUrl`, HEAD→GET, `HostThrottle`); capture redirect chains + final URLs; validate `canonicalUrl` + hreflang from `HarvestedPageSeo` (they exist there — `canonicalUrl` column, hreflang in `detailsJson` — but are TRANSIENT and today die with the table) against the verified-target map, emitting new finding types | M | Persist what validation needs before transient deletion (new CrawlPage scalars or finding detail JSON — spec it); chain-following semantics (max hops, loop detection); cap interplay with `BROKEN_LINK_MAX_CHECKS`; hreflang return-link checks multiply fetch volume — budget it |
| 2 | Standalone shared URL-resolver service (the roadmap's own proposal) reused by canonical/hreflang/redirect/sitemap-hygiene checks as a separate post-terminal job | M/L | New job type + recovery path + group-key liveness analysis (only `broken-link-verify` may reuse `site-audit:<id>`, and only post-terminal); dedup/cache across checks |
| 3 | Keep SF for these checks (do nothing) | — | Legitimate: they are B-tier gaps; revisit after Phase 1 quantifies how often they appear in deliverables |

Option 1 is preferred v1 (rides existing fetch infrastructure, no new job), but
the spec must prove the builder's 15-min timeout survives the added fetches.

**Phase 5 — content similarity.** The embedding asset already ships:
`@xenova/transformers` (MiniLM, 384-dim, in-process, prewarmed via postinstall)
powers pillar clustering today. Near-duplicate detection needs normalized text
fingerprints + boilerplate control (roadmap flags false-positive risk from
rendered-text variance) — and the live scan currently persists only `wordCount`,
not text, so spec what gets stored (hashes/shingles, never raw pages) and its
retention. Exact-duplicate title/meta/H1 already ships (Phase-2 mappers).

**Phase 6 — analytics.** C10 (shipped 2026-06-22, PRs #75/#76) delivered the
GA4 + GSC half via service account (`lib/analytics/`) — but its **prod
verification is still Kevin-pending** (see the handoff's Next item). Remaining:
SEMrush/DataForSEO ingestion (retires SF as the keyword-data *joiner*; distinct
from retiring the crawler — both are required for full demotion) and direct memo
consumption, **gated on the Anthropic API billing decision** (tracker gated
decision — until then all AI stays skill-handoff).

---

## Phase 7 — the retirement gate (falsifiable criteria)

SF is demoted for a client only when ALL hold, each backed by recorded numbers:

- [ ] **N consecutive weekly seoIntent runs** (proposed default N=8; Kevin sets
      the final bar) on that client completed with a non-null score and stable
      timing (no recovery-path rescues).
- [ ] **Coverage ≥ 90–95%** of known pages per run (observed/attempted from the
      builder inputs), surfaced per run — or the shortfall explicitly capped/blocked.
- [ ] **Parity log complete** (Phase 1): 2–3 cycles, every deviation explained;
      broken-link false-positive rate low enough that analysts act on findings unreviewed.
- [ ] **Graph signals accepted** by pillar/brief consumers, labeled
      "ER audited-set authority" — never "SF Link Score".
- [ ] **Analytics independent** (Phase 6 complete) so SF is not still the data joiner.
- [ ] **Dashboards + roadmap generation + Teamwork outputs** default to the live
      source for that client.
- [ ] **Miss-rate verdict recorded**: either Phase 2 shipped, or the measured
      sitemap miss-rate justified deferring it — in which case SF explicitly
      stays the discovery instrument (quarterly sweeps).

**Automatic rollback triggers** (SF returns to routine for that client, no
debate): repeated low-confidence/null-score runs; coverage under threshold;
verifier false-positive spike; a site migration/redesign. **Keep SF forever
for:** discovery sweeps, migrations, staging QA, competitor/ad-hoc list crawls,
custom XPath extraction, any blocked/capped client.

## Wrong paths — fenced (do not do these)

| Fence | Why |
|---|---|
| Never let a live score displace SF outside `pickCanonicalSeo`'s freshness window | Fresh SF (≤30 d) wins unconditionally; a NON-seoIntent live run can never be canonical. Ad-hoc "prefer live" logic on any surface forks the source of truth the whole campaign depends on |
| Never add crawl-depth or broken-links to the live-score denominator casually | Depth is an audited-set approximation; broken-links are capped/unconfirmed. Guard test exists (`live-seo-score.test.ts`); changing it is a gated decision, not a cleanup |
| Never backfill historical blobs into findings rows | Findings-layer house rule; pre-A2 data stays blob-only. `scripts/findings-rebuild.ts` is dual-write-failure repair, not backfill (and for a SiteAudit id it rebuilds only the ada run — the live run is owned by the builder) |
| Never widen same-domain to subdomains in the v1 harvest | `link-harvest.ts` is exact-host + www-insensitive by design; subdomains are external (recorded, unverified). Widening silently inflates the verify workload and the graph |
| Never scan non-client sites | Owner rule. Live scans fetch real sites; a "test crawl" of a random domain is an unauthorized scan |
| Never raise `BROWSER_POOL_SIZE` above 4 for crawl speed | Each Chrome page is ~150–200 MB resident; the VPS has two memory-incident scars already (PM2 SIGKILL 2026-05-14, build OOM 2026-06-22). Throughput problems are a spec problem (SEO-only scan mode), not a knob problem |
| Never write the live-scan run from a second job | The builder is the single writer (delete-and-recreate on `{siteAuditId, tool}`); a second writer clobbers it |

## Common mistakes

- Trusting the handoff/tracker Phase-4 prose (self-healing schedules,
  `lib/seo/providers/`, live srt_/krt_) — plan + code are ground truth.
- Smoke-testing with the canary and concluding on-page extraction or scoring is
  broken — the canary is noindex; nulls and empty on-page findings are correct there.
- Reading coverage from `SiteAudit.pagesComplete` — the score uses the
  `HarvestedPageSeo` row count (best-effort persist runs after the counter bump).
- Querying the live run with `findUnique({ where: { siteAuditId } })` — since C6
  a SiteAudit carries up to two runs; use `{ siteAuditId_tool: { siteAuditId, tool } }`.
- Interactive `prisma.$transaction(async tx => …)` in any parity/measurement
  tooling — array-form only (2026-06-10 prod incident).
- Declaring a phase done without the tracker + handoff commit and the paste-in prompt.

## Provenance and maintenance

Authored **2026-07-02** against branch `feat/autonomous-live-seo-source`
(23 commits ahead of main; main tip `6679993`). Phase 0 describes the BRANCH;
CLAUDE.md's "live score never displaces sf-upload" text describes MAIN and is
superseded on the branch by `pickCanonicalSeo`. Once Phase 0 merges, update the
status lines here and in the campaign map.

Re-verify volatile facts:

```bash
git branch --show-current && git log main..feat/autonomous-live-seo-source --oneline | wc -l  # 23 pre-merge; 0/absent post-merge
head -30 docs/superpowers/todos/HANDOFF-improvement-roadmap.md            # current next action
grep -n 'SEO_SF_CANONICAL_WINDOW_DAYS' lib/services/seo-canonical.ts      # 30-d window default
grep -n 'seoIntent' app/api/parse/history/route.ts                        # history filters seoIntent:true
grep -n 'excludes crawl depth' lib/findings/live-seo-score.test.ts        # depth-guard test alive
grep -n 'MAX_CHECKS\|HOST_DELAY\|CONCURRENCY' lib/jobs/handlers/broken-link-verify.ts  # verifier tunables (2000/250ms/4)
grep -n 'FUTURE' app/api/site-audit/route.ts lib/jobs/handlers/scheduled-site-audit.ts # SEO-only-mode breadcrumbs (unbuilt)
grep -rn 'runForCanonical' app --include='*.ts' | grep -v test            # empty = still no HTTP trigger for live pillar
grep -n 'Sitemap miss-rate' docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md  # Phase-2 gate still open
sed -n '210,220p' docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md  # Anthropic billing gate
grep -n 'ALLOW_PASSWORD_LOGIN' app/api/auth/login/route.ts                # break-glass login flag
```

Parity script: `.claude/skills/er-seo-tools-sf-retirement-campaign/scripts/sf-live-parity.ts`
(read-only; tested against a seeded local DB 2026-07-02). Roadmap doc:
`docs/superpowers/nyi/2026-06-04-screaming-frog-retirement-roadmap.md` — if it
moves to `archive/` or gets superseded, follow it.
