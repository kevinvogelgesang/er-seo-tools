---
name: er-seo-tools-research-frontier
description: Use when asked "what should we build next", scoping new capabilities, evaluating claims like "autonomous", "self-healing", or "Screaming-Frog-free", planning work toward the agency-in-a-box goal, scaling/capacity questions (Postgres, multi-process, large crawls), or when a doc/handoff mentions features you cannot find in the code. Also use before promising any capability externally, or when deciding whether a gated item (Anthropic billing, CRM integration) is ready to unblock.
---

# Research frontier: toward an autonomous SEO agency-in-a-box

## Overview

This skill maps the open problems between what er-seo-tools is today and the
owner-confirmed north star: an **autonomous SEO agency-in-a-box** — scheduled
live crawls + analytics + reports + memos with near-zero manual steps.
Everything here is **candidate/open, not committed roadmap**. The commitment
record is `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`;
nothing becomes real work until it goes through the spec → Codex review →
plan → tracker ritual.

Core principle: **measure before you build, prove before you claim.** Several
frontier items are explicitly gated on a measurement that has not been run yet.

## When to use / When NOT to use

**Use when:** planning what to build next; assessing how far the toolkit is
from "autonomous"; drafting external-facing claims about capability; deciding
whether a gated decision is ready to unblock; a handoff doc describes a
feature you can't find in the code.

**NOT for:**
- Executing the Screaming Frog retirement campaign step-by-step → `er-seo-tools-sf-retirement-campaign` (this skill only frames what "parity" must mean).
- The evidence bar and idea lifecycle mechanics (nyi → spec → Codex → plan → build → tracker) → `er-seo-tools-research-methodology`.
- How to actually add a route/job/parser/migration → `er-seo-tools-extension-recipes`.
- Load-bearing invariants you must not break while building → `er-seo-tools-architecture-contract`.
- Change classification and deploy gating → `er-seo-tools-change-control`.

## Ground rules for all frontier work

| Rule | Source |
|---|---|
| No deploy, no SSH mutation, no merge to main without Kevin's explicit go in-conversation | Owner ruling |
| Spec/plan through Codex review before implementation; tracker + handoff updated in the same commit | Project CLAUDE.md handoff protocol |
| Never scan third-party sites casually — client sites or domains you control only | Owner ruling |
| No Anthropic API features until the billing gate opens | CLAUDE.md "Do not" list |
| Every claimed number must be regenerable by a command (script or documented query) | Reproducibility standard, this library |
| SQLite only, no serverless, single VPS — stack changes need an explicit owner decision | CLAUDE.md stack constraints |

**Doc-trust warning (as of 2026-07-02):** the tracker's C6 (live SEO source)
Phase 4 entry and `docs/superpowers/todos/HANDOFF-improvement-roadmap.md` claim
three unbuilt features (self-healing seoIntent schedules, a `lib/seo/providers/`
layer, live srt_/krt_ memos) — plan + code are ground truth; the doc-error story
and claim-vs-truth table are er-seo-tools-failure-archaeology entry 16. Problem 1
below exists precisely because the "self-healing" claim describes unbuilt work.

---

## Problem 1 — Self-healing autonomous schedules (candidate)

**Current state (verified 2026-07-02, branch `feat/autonomous-live-seo-source`):**
SEO-intent scan schedules exist but are 100% operator-created. `POST
/api/clients/[id]/schedules` accepts `seoIntent: true` and enforces one
schedule per (client, domain, seoIntent) — an ADA schedule and an SEO schedule
can coexist for the same domain (decision D1). Grep for
`ensureSeoSchedule|autoCreate|self-healing` in `lib/` and `app/` returns zero
hits. The tracker/handoff text claiming schedules "are created autonomously by
the system when a client has a linked domain (self-healing, weekly cadence)"
describes work that was never built.

**Why it falls short:** the autonomy chain (schedule → live crawl → canonical
run → report → memo) starts with a human clicking "create schedule" per client
per domain. Onboarding a client does not produce recurring SEO coverage; a
deleted-then-recreated domain silently loses its schedule. That is the last
manual step in the crawl half of the box.

**This repo's asset:** everything downstream already exists — the `Schedule`
model, the `scheduled-site-audit` wrapper job with config-rot handling
(`lib/jobs/handlers/scheduled-site-audit.ts`), seoIntent threading end-to-end,
and an idempotent-seed pattern to copy: `lib/jobs/system-schedules.ts` seeds
code-owned `system-*` schedules at every boot. The missing piece is one
reconciler, not a subsystem.

**First three steps in this repo:**
1. Write a spec (`docs/superpowers/specs/`) answering the policy questions: which clients qualify (linked domain + not archived?), what cadence, what happens on domain change/removal, and whether operators can opt a client out. Note that `system-` is a reserved Schedule namespace — these would be client-owned rows (`name: null`, `clientId` set), so the seeder pattern is borrowed, not reused verbatim.
2. Route the spec through Codex (`consulting-codex`), then plan + TDD an idempotent `ensureSeoSchedules()` reconciler: for each qualifying client+domain with no existing seoIntent schedule, create one; disable orphans. Run it where `system-schedules` seeding runs (boot) and optionally in a periodic sweep.
3. Verify unattended end-to-end in dev against a domain you control: create a client + domain, never touch the schedules API, and confirm the schedule row appears, fires, and yields a canonical seoIntent live-scan `CrawlRun`.

**You have a result when:** a freshly created client with a linked domain gets
a seoIntent schedule with zero schedules-API calls, and removing the domain
disables it — both demonstrated by a test and one dev-server drill. Until
then, "self-healing" may not appear in any external description.

---

## Problem 2 — Hybrid page discovery beyond sitemaps (open, measurement-gated)

**Current state:** `lib/ada-audit/sitemap-crawler.ts` `discoverPages()` walks
robots.txt `Sitemap:` directives → common sitemap paths → `.xml.gz`, falls
back to a single-page homepage link scrape (`shallowCrawl`), hard cap 1000
pages. Pages not in the sitemap and not linked from the homepage are
invisible. SF-retirement roadmap Phase 2 (hybrid sitemap + capped BFS
frontier) is deliberately deferred: *"Build the crawler only if measurement
shows our clients' sitemaps routinely miss important pages."* That
measurement is an open gated decision in the tracker ("Sitemap miss-rate
measurement") — it has not been run.

**Why it falls short:** for clients with bad sitemaps, every downstream
autonomous product (live score, findings, link graph, pillar facts) is blind
in exactly the cases that matter most. But the fix is the single biggest
architectural commitment on the roadmap (scanner → crawler: traps, robots
policy, runtime), so building it unmeasured is the classic mistake.

**This repo's asset:** the miss-rate is measurable **without building
anything risky**. Every audited page's internal links are already persisted to
the transient `HarvestedLink` table during audits, and the audited URL set is
persisted as `SiteAudit.discoveredUrls`. On the current branch, live-scan
`CrawlPage` rows also carry inlinks/outlinks. Set difference = pages linked
internally but never discovered.

**First three steps in this repo:**
1. Write a read-only script (`npx tsx`) that, for a given completed audit (before the verifier deletes transients, or from live-scan `CrawlPage` link data after), computes: distinct same-domain HTML-like `HarvestedLink` targets NOT in `discoveredUrls`, as a count and percentage.
2. Run it across recent audits for consenting client domains (never third-party sites) and produce a per-client miss-rate table.
3. Record the numbers against the tracker's gated-decision line and make the call: if miss-rates are routinely material (roadmap gate suggests a 90–95% coverage threshold), spec Phase 2; if not, close the gate with evidence and keep SF as the periodic discovery instrument.

**You have a result when:** the gated-decision checkbox has a dated table of
per-client sitemap miss-rates attached, regenerable by one command — whichever
way the decision goes.

---

## Problem 3 — SF parity measurement + the retirement gate (open)

**Current state:** the retirement decision gate
(`docs/superpowers/nyi/2026-06-04-screaming-frog-retirement-roadmap.md` §4)
requires "documented, explainable variance from side-by-side SF vs Live
comparisons on a representative client set" over 2–3 reporting cycles. **No
SF-vs-live comparison tooling exists.** Do not confuse it with
`scripts/findings-parity.ts` — that verifies blob-vs-tables consistency
within one run, a completely different kind of parity.

**Why it falls short:** the whole retirement campaign is blocked on trust,
and trust requires numbers nobody has produced. Without a defined parity
metric, "the live scan is good enough" is an opinion.

**This repo's asset:** SF uploads and live scans land in the **same
normalized schema** (`CrawlRun` → `CrawlPage`/`Finding`, sha256 `dedupKey`s,
shared issue-type vocabulary via `lib/services/issue-membership.ts`), and a
page-set-aware differ (`diffInstances` in `lib/services/findings-shared.ts`)
already exists. Comparing an `sf-upload` run to a `live-scan` run for the same
client+domain is a query, not an integration project.

**What "parity" must mean measurably (candidate definition — spec it first):**
per issue-type count deltas; health-score delta (with the known caveat that
the live score omits crawl-depth and broken-links from its denominator —
`lib/findings/live-seo-score.ts` — so score parity must be factor-by-factor,
not headline-vs-headline); page-set overlap (coverage explains most variance);
and an explanation category for every material delta (coverage / definition
difference / real bug).

**First three steps in this repo:**
1. Spec the parity metric set and thresholds; route through Codex. Cross-ref: `er-seo-tools-sf-retirement-campaign` owns the campaign execution — this step just gives it an instrument.
2. Build a read-only `scripts/`-style comparison script: given clientId+domain, find the newest sf-upload run and newest seoIntent live-scan run within N days of each other, emit the metric table.
3. Start the parallel-run ledger: for each client with both sources, run the script per reporting cycle and file the variance table (dated, in-repo) — the roadmap requires 2–3 consecutive cycles.

**You have a result when:** each checkbox in roadmap §4's decision gate has a
number and a regeneration command next to it. "SF-free" (or even "SF as
quarterly instrument") may be claimed externally only after the parallel-run
ledger exists.

---

## Problem 4 — AI-native memo generation in-app (candidate, HARD-GATED)

**Gate:** CLAUDE.md "Do not" — *"Add Claude AI analysis features — requires
separate Anthropic API billing not currently set up."* The tracker carries the
matching open gated decision ("Anthropic API billing — gates direct memo
generation"). **Write no Anthropic-API code until that checkbox flips.**

**Current state:** all AI narrative work travels the clipboard skill-handoff:
the dashboard mints a 1-hour JWT (four token families — `lib/pillar-token.ts`
pat_, `lib/seo-roadmap-token.ts` srt_, `lib/keyword-memo-token.ts` krt_,
`lib/quarter-push-token.ts` qct_), an external Claude session fetches a
structured export and PATCHes markdown back.

**Why it falls short:** the memo — the deliverable clients actually read — is
the least autonomous step in the box: it requires a human to paste a prompt
into a separate Claude session. "Scheduled crawl → report → memo" breaks at
the last hop.

**This repo's asset:** the hard part is done. The four export families are
already AI-ready structured payloads (e.g. `buildTechnicalAuditExport` in
`lib/parsers/claude-export-builder.ts`, which deliberately strips
`health_score` so the model can't parrot it), prompt composers exist
(`lib/*-prompt.ts`), and the durable job queue is the natural transport. The
nyi strategy doc (`docs/superpowers/nyi/improvement-roadmaps/03-ai-memo-tools.md`
Phase 3) already sketches the end state: a memo job on the queue, streamed
draft, analyst approves in-dashboard, handoff kept as the no-API fallback —
and estimates cost at single-digit dollars/month at current memo volume.

**First three steps in this repo:**
1. Force the decision, don't drift (the 03-doc's own warning): put the billing question to Kevin with the cost estimate; the outcome is either "gate opens" or "clipboard handoff is the committed permanent transport". Record it on the tracker's gated-decision line.
2. If the gate opens: spec the memo job per the 03-doc sketch (queue job type, memo versions stored relationally, prompt templates versioned in-repo, handoff fallback preserved); Codex review.
3. TDD entirely against a mocked Anthropic client; the only live-API step is a final smoke, and deploy stays Kevin-gated as always.

**You have a result when:** an analyst clicks "Generate memo" on a run and
gets an editable draft in the dashboard with no external Claude session — while
the pat_/srt_/krt_/qct_ clipboard path still passes its tests as the fallback.

---

## Problem 5 — Content similarity / semantic clustering for live scans (candidate)

**Current state:** duplicate/near-duplicate detection for SF sessions comes
from SF's own precomputed "Near Duplicate" column
(`lib/parsers/internal.parser.ts`); live scans detect duplicate
titles/metas/H1s by trimmed-exact match only
(`lib/findings/onpage-seo-mapper.ts`). Body-content similarity does not exist
in the live pipeline: `lib/ada-audit/seo/parse-seo-dom.ts` computes a visible
word count but returns **no text**, and `HarvestedPageSeo` has no text or
fingerprint column. Meanwhile `@xenova/transformers` (MiniLM, 384-dim, local
ONNX) is already a dependency — used today **only** by pillar-analysis
embeddings (`lib/services/pillarAnalysis/embeddings.ts`) and the postinstall
prewarm (`scripts/prewarm-embedding-model.ts`). This is SF-retirement roadmap
Phase 5.

**Why it falls short:** near-duplicate pages are a real deliverable category,
and without it the live scan can never claim duplicate-content parity with SF
— a named checkbox-adjacent gap in the retirement gate.

**This repo's asset:** proven in-process embedding infrastructure (pillar
clustering runs MiniLM on the same VPS today), plus a natural capture point in
the harvest evaluate. One hard constraint to respect: `parse-seo-dom.ts` is
**string-injected** into the page (`.toString()`) and must reference no module
scope — any text-capture extension lives inside that self-contained function
and returns bounded data.

**First three steps in this repo:**
1. Spec the capture: bounded normalized body text (or in-page shingle hashes) returned from the existing evaluate, a fingerprint column on `HarvestedPageSeo` → `CrawlPage`, size caps, and the roadmap's warned failure mode (boilerplate/nav text inflating similarity). Decide fingerprint style (MinHash/SimHash per the roadmap vs MiniLM embeddings already on hand) in the spec, with Codex.
2. Wire a similarity pass into the live-scan builder (`lib/jobs/handlers/broken-link-verify.ts`) emitting a near-duplicate finding type — computed before transient-table deletion, like the score and schema coverage already are.
3. Validate against SF: for parallel-run clients, compare live near-duplicate groups to SF's Near Duplicate output and document agreement/variance (this folds into Problem 3's parity ledger).

**You have a result when:** a live scan of a client site with known duplicate
pages emits near-duplicate findings whose groups match SF's within documented,
explained variance — regenerable by the parity script.

---

## Problem 6 — Monitoring, alerting, and ops autonomy (open — currently zero)

**Current state (verified):** there is no alerting of any kind — no email/
webhook/notification code in `lib/` or `app/`, no `/api/health` route, no
`/admin` surface. Failures (a scheduled audit that exhausts retries, a
findings dual-write failure, a stranded verifier) are visible only in PM2 logs
and `Job` rows. Tracker item A4 ("Observability floor: `/api/health`, pino
logging, `/admin/ops` page") and D5 ("Scheduled robots/sitemap monitoring with
change-only alerts") are both open.

**Why it falls short:** an agency-in-a-box that cannot notice its own
failures is not autonomous — it is unattended. Recovery machinery is genuinely
good here (stale-audit reset, verifier re-enqueue, boot recovery), but when
recovery itself gives up, nothing tells a human.

**This repo's asset:** `lib/jobs/introspection.ts` already exists —
`getJobQueueState()` returns per-type/status counts, oldest running job, and
the 10 most recent failures, written explicitly "for the future /admin/ops
page (roadmap A4)". The system-schedules pattern gives a free periodic
check-job slot.

**First three steps in this repo:**
1. Build the A4 floor: `/api/health` (DB reachable, worker ticking, queue depth) + an `/admin/ops` page rendering `getJobQueueState()`. This is pure read surface — low risk, high leverage.
2. Add an ops-digest system schedule that snapshots exhausted jobs, dual-write failure log markers, and recovery events since the last tick into a queryable row (notification channel undecided — surfacing in-app first is enough to start).
3. Prove it with a drill: force a scheduled audit to fail terminally in dev and confirm it appears on the ops surface within one sweep cycle, no log-grepping.

**You have a result when:** the drill in step 3 passes. "Autonomous" may be
claimed externally only with this plus evidence of unattended failure→recovery
(e.g. a killed mid-audit process resuming and completing without intervention,
documented with timestamps).

---

## Problem 7 — Real CRM prospects integration (candidate)

**Current state:** C10 reports fetch "Prospects" through
`lib/analytics/prospects/prospects-provider.ts` with precedence: CRM adapter
(only if `Client.crmClientRef` is set AND `CRM_API_BASE` env exists) → manual
`ProspectsEntry` row for the exact client+period → `{ok:false,
reason:'unmapped'}`. The CRM adapter
(`lib/analytics/prospects/crm-adapter.ts`) is a v1 stub that always returns
"CRM adapter not configured". Every monthly report's prospects section
therefore depends on a human typing numbers into `ProspectsEntry` per client
per period.

**Why it falls short:** ~32 clients × monthly = a recurring manual data-entry
chore inside a product whose pitch is removing manual steps.

**This repo's asset:** the contract is deliberately frozen — the stub's own
header says "swap the body, not the contract". `fetchProspects` precedence,
the `SourceResult<ProspectsBundle>` shape, and tests already exist; a real
adapter is a transport implementation, not a design project.

**First three steps in this repo:**
1. Confirm with Kevin which CRM this is and what `crmClientRef` maps to — **the repo does not name the CRM**; do not invent an API.
2. TDD the adapter body against a mocked transport: happy path, auth failure, unmapped ref, period-window semantics — all returning honest `{ok:false}` reasons on failure so the manual fallback still catches.
3. Parity-check: for one period where manual `ProspectsEntry` rows exist, compare adapter output to the manual numbers before letting the CRM path short-circuit reports fleet-wide.

**You have a result when:** a monthly batch renders correct prospects for a
CRM-mapped client that has **zero** `ProspectsEntry` rows, and the parity
check against a manually-entered period is documented.

---

## Problem 8 — The multi-process / scale ceiling (open — measure first)

**Current state:** one PM2 fork instance (`ecosystem.config.js`:
`instances: 1, exec_mode: 'fork'`); the durable-job worker's concurrency
accounting is in-memory with an explicit single-process assumption
(`lib/jobs/worker.ts` header: a second process is "safe (just
over-concurrent), not corrupt"); SQLite in WAL mode with
`busy_timeout = 5000` (`lib/db.ts`); one Chrome pool (default 2 pages,
prod 4 — each ~150-200 MB); array-form-transactions-only after the 2026-06-10
write-lock incident. The retirement roadmap's residual-gaps list is honest:
"a single VPS + SQLite handles ER's current fleet comfortably, but not
arbitrary 50k+ page crawls."

**Why it falls short:** the north star multiplies load — fleet-wide scheduled
crawls + verifiers + PSI + report renders + (eventually) memo jobs on one
event loop and one SQLite writer. Nobody knows which limit binds first:
SQLITE_BUSY under write contention, event-loop starvation during CPU work
(pdfjs already caused the 2026 incident; embeddings are CPU-bound too), Chrome
memory, or plain queue latency. Guessing leads to either premature
re-architecture (violating the SQLite/no-serverless constraints) or a
production stall.

**This repo's asset:** the `Job` table is a free measurement instrument —
every job carries queued/started/completed timestamps, so claim latency and
queue wait are historical queries, not new instrumentation. `JOB_POLL_MS`,
`SITE_AUDIT_CONCURRENCY`, `PSI_CONCURRENCY`, and `BROWSER_POOL_SIZE` are all
env knobs for controlled experiments.

**First three steps in this repo:**
1. Write a read-only script computing queue-wait and run-duration percentiles per job type from existing `Job` rows — the baseline under today's load.
2. Run a synthetic load experiment in dev against domains you control: enqueue N site audits at increasing concurrency knob settings, record queue wait, heartbeat misses, SQLITE_BUSY/timeout log lines, and RSS.
3. Publish a capacity note: "at X concurrent page jobs + Y PSI jobs, metric Z degrades first", with the regeneration commands. Only then discuss remedies — knob tuning and job scheduling first; anything touching the SQLite/single-process/stack constraints is an explicit owner decision, never a drive-by.

**You have a result when:** the capacity note exists with a named first-binding
limit and a load number, regenerable by the scripts — before any architecture
change is proposed.

---

## External-positioning discipline: claim vs. proof

Never let marketing language outrun the evidence. As of 2026-07-02:

| Claim | May be said today? | Proof required first |
|---|---|---|
| "Runs live SEO scans on a schedule" | Yes (C2 scheduled scans + C6 live scans shipped; seoIntent canonical selection pending merge) | — |
| "Autonomous" / "near-zero manual steps" | **No** | Problem 1 (no-touch schedules) + Problem 6 drill (unattended failure→recovery evidence) |
| "Self-healing schedules" | **No — not built** | Problem 1 milestone |
| "Screaming-Frog-free" / "SF retired" | **No** | Problem 3 parity ledger over 2–3 cycles + every roadmap §4 gate checkbox with numbers |
| "Same health score as the SF report" | **No — different instrument** | Live score omits crawl-depth + broken-links from its denominator; compare factor-by-factor only |
| "AI-generated memos in-app" | **No — gated** | Anthropic billing decision, then Problem 4 milestone |
| "CRM-integrated reporting" | **No** | Problem 7 milestone (stub returns not-configured today) |
| Any specific number ("90% coverage", "80% fewer SF runs") | Only with a regeneration command | Reproducibility standard: script or documented query in-repo |

## Common mistakes

- **Trusting the tracker/handoff Phase-4 prose.** Self-healing schedules, `lib/seo/providers/`, and live srt_/krt_ memos are described there but do not exist. Verify features in code before citing them anywhere.
- **Building the Phase-2 crawler before running the miss-rate measurement.** The roadmap gates it explicitly; the measurement is nearly free (Problem 2).
- **Confusing `scripts/findings-parity.ts` with SF-vs-live parity.** The existing script checks blob-vs-tables consistency inside one run. SF-vs-live comparison tooling does not exist yet.
- **Writing Anthropic API code "to be ready" before the billing gate flips.** CLAUDE.md forbids it; the allowed pre-gate work is the decision memo and cost model.
- **Running load tests or crawl experiments against third-party sites.** Client sites in the system or domains you control, only.
- **Treating this skill as a roadmap.** It is a problem map. Committing any item means: spec → Codex review → plan → tracker checkbox + status log + handoff rewrite, per the standing ritual.
- **Extending `parse-seo-dom.ts` with module-scope references.** It is string-injected into the page; any capture extension must stay self-contained (and avoid constructs that emit SWC helpers).
- **Proposing Postgres/multi-process as the first answer to scale.** Measure first (Problem 8); stack changes contradict the standing constraints and need an explicit owner decision.

## Provenance and maintenance

Written 2026-07-02 against branch `feat/autonomous-live-seo-source` (23
commits ahead of an unmerged main; C6 Phase 4 built, gate-green, not
deployed). Facts marked "current state" describe this branch. Re-verify
volatile facts before relying on them:

| Fact | Re-verify with |
|---|---|
| Branch/merge state | `git branch --show-current && git log main..HEAD --oneline \| wc -l` |
| No auto-created schedules (Problem 1) | `grep -rn "ensureSeoSchedule\|autoCreate" lib app --include="*.ts"` (expect zero hits) |
| seoIntent is operator-set in the schedules route | `grep -n "seoIntent" "app/api/clients/[id]/schedules/route.ts"` |
| Gated decisions still open (billing, miss-rate) | `grep -n "Gated decisions" -A 6 docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` |
| Tracker/handoff still carry the unbuilt "self-healing" claim | `grep -rn "self-healing" docs/superpowers/todos/` |
| Discovery = sitemaps + homepage fallback, cap 1000 | `grep -n "HARD_CAP\|shallowCrawl" lib/ada-audit/sitemap-crawler.ts` |
| Retirement gate criteria + phase ordering | `grep -n "Retirement decision gate" -A 20 docs/superpowers/nyi/2026-06-04-screaming-frog-retirement-roadmap.md` |
| Live score omits crawl-depth/broken-links | `sed -n '1,40p' lib/findings/live-seo-score.ts` |
| @xenova used only by pillar embeddings + prewarm | `grep -rln "@xenova" lib app scripts` |
| No text/fingerprint on HarvestedPageSeo | `sed -n '/model HarvestedPageSeo/,/^}/p' prisma/schema.prisma` |
| CRM adapter still a stub | `sed -n '1,15p' lib/analytics/prospects/crm-adapter.ts` |
| No health route / admin surface / alerting | `ls app/api/health app/admin 2>&1; grep -rli "nodemailer\|webhook\|smtp" lib app --include="*.ts"` |
| Single PM2 instance, in-process worker | `grep -n "instances\|exec_mode" ecosystem.config.js && sed -n '1,20p' lib/jobs/worker.ts` |
| SQLite pragmas (WAL, busy_timeout) | `grep -n "PRAGMA" lib/db.ts` |
| SF canonical window (30d default) | `grep -n "SEO_SF_CANONICAL_WINDOW_DAYS" lib/services/seo-canonical.ts` |
| SEO-only scan mode still only a breadcrumb | `grep -rn "SEO-only" app/api/site-audit/route.ts lib/jobs/handlers/scheduled-site-audit.ts` |

When any problem here gets committed and shipped, update this skill: move the
item's "current state", and re-check the claim/proof table — stale frontier
docs are how the "self-healing" fabrication happened in the first place.
