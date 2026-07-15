# 07 — Senior Brief: Decisions, Rationale, and What to Watch

*Audience: an experienced developer (TypeScript/Next.js or equivalent) brought
in occasionally to advise or review, with zero prior context on this repo. This
document is standalone — you do not need to read any other file in
`docs/onboarding/` first. It is written peer-to-peer and warts-and-all: the real
trade-offs, the production incidents that created the house rules, and the parts
that are genuinely fragile.*

---

## 1. What this is

er-seo-tools is an internal web app for one SEO agency (Enrollment Resources).
It runs SEO and WCAG (the W3C's Web Content Accessibility Guidelines,
i.e. web accessibility) audits against client websites — you upload a
Screaming Frog crawl or point it at a domain, and it produces prioritized
reports, health scores, branded PDFs, and a per-client history. The
accessibility audits themselves run on **axe-core**, an open-source
accessibility-testing engine, driven headlessly inside a real Chrome instance.
It is a Next.js 15 (App Router) + TypeScript + Prisma/SQLite app, deployed as
a single long-running Node process on one small VPS hosted on **RunCloud**
(a server-management panel for VPS providers — think "cheaper, self-managed
Heroku").

**The promise of this doc:** after reading it, plus a skim of `03-codebase-tour.md`
(the static map of the repo) and `04-how-it-runs.md` (the runtime machinery), you
should be able to answer three questions with confidence: *what is this, why is
it shaped the way it is, and what must the junior developer never merge without
your review?* Section 5 is the direct answer to the third question; sections 2–4
are what makes that answer make sense.

---

## 2. The context that explains everything else

Every decision below is downstream of five facts. Read these first, because in
isolation several of the choices look wrong — they are only correct *at this
scale*.

- **It is an internal tool.** Users are a handful of people inside one agency,
  not the public internet. No signup flow, no tenancy, no anonymous traffic.
- **One primary developer, plus heavy AI assistance.** The codebase is built
  with Claude Code (AI pair-programming) under review gates, not a team of
  engineers. Throughput is high; the control is process discipline, not
  collective memory (see decision 9).
- **One small VPS.** A single box on RunCloud, ~2.4 GB usable for the app
  process. No cluster, no autoscaling, no managed database.
- **A handful of concurrent users, spiky workload.** Long-running jobs (headless
  Chrome audits that take minutes) matter far more than request throughput.
- **The domain is SEO/accessibility auditing.** The work is inherently
  batch-shaped: crawl a site, score it, render a report.

**State this plainly to yourself before you critique anything here: most of the
decisions in section 3 would be wrong at a different scale.** SQLite would be
wrong with real write concurrency. A single-process job queue would be wrong with
horizontal scale. Polling would be wrong with thousands of clients. Each entry
below therefore ends with a **Revisit if** trigger — the concrete condition under
which the decision flips from right to wrong. If you find yourself wanting to
"fix" something, check whether its Revisit-if trigger has actually fired. Usually
it hasn't.

---

## 3. The nine decisions

Each is stated as **Decision / Why / Consequences / Revisit if**.

### Decision 1 — SQLite + Prisma, no Postgres

**Decision.** The entire datastore is a single SQLite file (`prisma/schema.prisma`
is the schema; the file lives at `$DATA_HOME/db.sqlite` in prod),
accessed through Prisma. This is a hard constraint in `CLAUDE.md` ("SQLite only —
no Postgres/MySQL").

**Why.** One box, one file, zero database server to operate, and a backup story
that's a single `VACUUM INTO` snapshot rather than a managed-database export
pipeline (see the honest state of that snapshot in section 4). At this scale
the operational simplicity is worth more than concurrency headroom.

**Consequences.** SQLite has a *single writer* — one write lock for the whole
database, in WAL mode (Write-Ahead Logging — SQLite's mode that lets readers
proceed concurrently with a writer, but still serializes writers to one at a
time) with a 5-second busy timeout. That lock is the tax you pay, and it
produced the most instructive incident in the repo's history:

> **2026-06-10 — "Operations timed out."** The first real PDF-bearing site audit
> after the durable job queue shipped wedged; 15 of 23 pages failed. Root cause:
> an *interactive* Prisma transaction (`prisma.$transaction(async tx => …)`)
> holds SQLite's single write lock across `await` round-trips. Four concurrent
> `pdfjs` (a PDF-parsing library) invocations starved the Node event loop, so
> the lock outlived the 5-second
> busy timeout for every other writer, and they all timed out.

That incident hardened into three non-negotiable house rules, all in `CLAUDE.md`
under "Do not":

1. **Array-form `$transaction([...])` only** — never the interactive
   `async tx =>` form. The array form runs the statements without yielding the
   lock across your own `await`s.
2. **Conditional logic goes in SQL, not in app code between a read and a write.**
   You cannot hold a lock across an `await`, so read-then-write is always racy;
   express the guard as an `EXISTS` predicate inside the raw statement so the
   write is self-guarding.
3. **Raw SQL must set `"updatedAt" = ${Date.now()}` manually.** Raw statements
   bypass Prisma's `@updatedAt`, and `updatedAt` on `SiteAudit` is the staleness
   heartbeat the recovery system reads — forget it and a healthy long audit gets
   killed by the 5-minute stale sweep.

**Revisit if.** Real write concurrency arrives — multiple operators driving
simultaneous audits routinely, or a second app instance — such that the single
write lock becomes the bottleneck rather than a nuisance. That is the point to
move to Postgres. It has not fired: the workload is a few users and one worker
process.

### Decision 2 — RunCloud VPS + PM2, not serverless

**Decision.** Deployed on a RunCloud-managed VPS, run under PM2 (a Node process
manager) as a single always-on process. Not Vercel, not Lambda. `CLAUDE.md`:
"No serverless — RunCloud + PM2."

**Why — and this is the important nuance: serverless was never viable, not merely
not chosen.** The core feature is running headless Google Chrome (via
puppeteer-core) to audit pages with axe-core. That needs: a real Chrome binary on
disk (`/usr/bin/google-chrome`), jobs that run for minutes (far past typical
serverless execution limits), a persistent local filesystem (the SQLite DB,
uploaded CSVs, generated PDFs, screenshots), and a warm long-lived process that
holds a browser pool and an in-memory job worker between requests. Serverless
gives you none of those.

**Consequences.** You own the box. Deploys are `git push` then SSH `~/deploy.sh`
(the server pulls from GitHub, installs, migrates, restarts). Restarts are a real
event — Chrome must be cleaned up on SIGTERM (`instrumentation.ts` handles this),
and in-flight jobs must survive a restart (decision 3). Memory is finite and has
bitten twice: PM2's runtime restart ceiling (2026-05-14 — a legitimate Lighthouse
memory peak triggered a SIGKILL restart at the then-1200 MB ceiling, raised to
2400 MB in `ecosystem.config.js`), and, separately, the *build* itself ran the
Node heap out of memory once as the codebase grew (2026-06-22, fixed with a
`--max-old-space-size` flag in the build script).

**Revisit if.** You need horizontal scale or true elastic burst — but note that
gets you into multi-instance territory, which the job worker is not designed for
(decision 3). This is a stable choice; the trigger is essentially "the business
outgrew one box," which is a much bigger conversation than infra.

### Decision 3 — Hand-built, DB-backed durable job queue (no Redis/BullMQ)

**Decision.** Background work — ADA audits, per-page site-audit work, PDF scans,
PageSpeed calls, report rendering, scheduled scans, maintenance — runs through a
custom job queue built on two Prisma tables (`Job` and `Schedule`), driven by a
single in-process worker. See `lib/jobs/`. No Redis, no BullMQ, no external queue.

**Why.** With one box and one SQLite file already present, adding Redis would mean
operating a second stateful service for no benefit the DB can't provide. SQLite is
the coordination layer.

**Consequences.** The correctness rests on three mechanisms worth understanding
before you review anything in `lib/jobs/`:

- **Conditional-update claim.** A worker picks a candidate job, then does
  `UPDATE … WHERE id = ? AND status = 'queued'` to flip it to `running`. If the
  update touches exactly one row, this worker owns the job; if zero, someone else
  claimed it and it moves on. No separate lock.
- **Attempt fencing.** Each claim increments an `attempts` counter; that value is
  a fencing token. Every later write (heartbeat, settle) is conditioned on
  `attempts` still matching. A timed-out handler that keeps running ("zombie
  attempt") can't clobber anything, because its writes match zero rows.
- **Per-type concurrency and backoff.** Each job type registers its own
  concurrency limit, max attempts, timeout, and backoff. Restarts are survivable:
  on boot, orphaned `running` jobs are re-queued and resumed.

The trade-off is stated bluntly: **this is single-process.** Concurrency
accounting is an in-memory Map, so a *second* Node process (or PM2 cluster mode)
would be over-concurrent and blow the Chrome/memory budget — not corrupt, but
wrong. There is no multi-instance safety design. And because everything shares one
event loop, event-loop discipline is a correctness property, not a nicety — see
decision 1's incident, which was fundamentally an event-loop-starvation bug.

**Revisit if.** You need more than one worker process (horizontal scale), or the
job volume/variety outgrows what one in-process worker and SQLite can coordinate.
At that point a real broker (and Postgres from decision 1) is the move — they
tend to arrive together.

### Decision 4 — Polling everywhere, no websockets

**Decision.** Live progress (audit progress bars, queue position, history that
updates itself) is delivered by the client polling JSON endpoints on an interval —
roughly every 1 second for an in-flight audit, every 5–8 seconds for queue and
history views. No websockets, no server-sent events.

**Why.** At a handful of concurrent users, polling is trivially cheap and has one
big operational advantage: **it survives PM2 and nginx restarts for free.** A
dropped poll just retries on the next tick; there is no long-lived connection to
re-establish, no reconnection logic, no sticky-session concern behind the reverse
proxy.

**Consequences.** Slightly more request volume and up to one interval of latency
on updates — both irrelevant at this scale. One real subtlety exists and has bitten
before: a client-side poll must anchor its window to a *server-side* timestamp, not
to page-load time, or a page that's left open re-triggers work. Reviewers should
flag any new poll that keys off `Date.now()` in the browser.

**Revisit if.** You need sub-second, high-fidelity realtime for many simultaneous
viewers — genuinely not the case here.

### Decision 5 — Findings dual-write + 90-day blob pruning

**Decision.** Audit results are written twice: once as the original JSON "blob"
on the record that started the audit (`Session` = a Screaming Frog CSV upload,
`SiteAudit` = a whole-site crawl audit, `AdaAudit` = a single-page accessibility
audit — hence `Session.result`, `SiteAudit.summary`, `AdaAudit.result`) and once
as a normalized relational subtree keyed off a `CrawlRun` (one audit run) with
child `CrawlPage` (one crawled page) and `Finding` (one detected issue of any
kind — SEO, accessibility, or link-check) rows; `Violation` rows attach
one-to-one to axe-derived findings to carry accessibility-specific detail. See
`lib/findings/`. Blobs are pruned 90 days
after completion; the normalized tables are the durable record. Read surfaces
fall back to the tables when the blob is gone.

**Why — and the honest history matters here.** The blobs came *first*. The app
originally stored results as JSON strings. The normalized "findings layer" was
retrofitted later (internally called "A2") because blobs can't be queried, diffed,
or reported on efficiently. Rather than a risky one-shot migration, the design is:
new results write *both* shapes, reads tolerate *both* shapes, and old blobs age
out on a 90-day timer while their normalized rows persist.

**Consequences.**

- **The dual-write is fire-and-forget, after the legacy commit.** A findings-write
  failure logs `[findings] … dual-write failed` and must never fail or delay the
  primary path. The repair tool is `scripts/findings-rebuild.ts <id>` — it
  reconstructs the normalized rows from the blob, and it's idempotent
  (delete-and-recreate).
- **We never backfill historical blobs into findings rows.** Pre-A2 records simply
  don't have normalized rows; reads keep a legacy fallback for them. This is a
  deliberate house rule, not an oversight.
- **Reads must tolerate both shapes**, including the pruned state where the blob is
  null but the tables remain. Some export/diff routes deliberately refuse with a
  409 `session_archived` once a blob is pruned rather than serve a degraded result.

**Revisit if.** The blobs stop being needed at all (every read surface fully
served from tables and every legacy record aged out) — then the blob columns and
their fallbacks can finally be dropped. Until then, both shapes are load-bearing.

### Decision 6 — Auth: signed cookie sessions, one global gate

**Decision.** Authentication is a signed session cookie (`er_auth`) — see
`lib/auth.ts`. The cookie is base64url-encoded JSON (`v` — session-format
version stamp, `sub`, `email`, `hd`, `name`, `exp`) plus an HMAC-SHA256
signature, 12-hour TTL. Login has two paths: **Google
OAuth as the primary** (verified ID token, restricted to the company's hosted
domain, with a per-user active/revoked check), and a **break-glass shared-password
path** that mints a synthetic identity (`sub = 'password:break-glass'`). The gate
is enforced in one place: `middleware.ts` runs on every request and either lets it
through or returns 401 (`auth_required`) / redirects to `/login`.

**Why.** For a small internal user set, a stateless signed cookie needs no session
store, and a single middleware gate means auth is not something every route author
has to remember. Google OAuth gives real per-person identity; the break-glass
password is the fallback for when OAuth is misconfigured or unavailable.

**Consequences — and this is the single most common footgun in the codebase.**
Because the gate is global and `middleware.ts` owns it, **per-route code must never
re-check auth**, and — critically — **auth must never be added to the `withRoute`
error-wrapper** the routes use. The flip side: any route that should be reachable
*without* a cookie has to be explicitly allowlisted in `middleware.ts`. There are
two categories of exception:

- **Public paths** — the login page, the public read-only *share* views
  (`/share/`, `/ada-audit/share/`, `/ada-audit/site/share/`), the auth API,
  `/api/health`, `/privacy`, `/about`, and Next's static assets.
- **Token-authed handoff routes** — a set of API routes (pillar-analysis,
  seo-roadmap, keyword-memo, quarter-plan push) that external Claude "skills" call
  with a short-lived JWT verified *inside the handler*, not with the session
  cookie. They must bypass the cookie gate or the token logic never runs.

The recurring bug: **a newly added public or token route returns 401 in prod
because someone forgot to add it to `isPublicPath`.** This has happened at least
three times. The standing rule is that every new public/token route needs both an
`isPublicPath` entry *and* a case in `middleware.test.ts`.

> **Kevin fills in:** production auth posture — is the break-glass shared-password
> login enabled in prod alongside Google OAuth, or is prod Google-only?

**Revisit if.** You need finer-grained authorization (roles, per-resource
permissions) rather than "logged in or not," or an external non-Google identity
source. Today everyone who's in is equally in.

### Decision 7 — Browser pool with recycling and hard size caps

**Decision.** A single headless Chrome instance sits behind a semaphore of
`BROWSER_POOL_SIZE` page slots (`lib/ada-audit/browser-pool.ts`; prod value 4 in
`ecosystem.config.js`). Chrome is periodically recycled (drained and relaunched
every N pages) and idle-closed. `CLAUDE.md` forbids raising `BROWSER_POOL_SIZE`
above 4 without checking VPS memory headroom first.

**Why.** Each open Chrome page is roughly 150–200 MB resident. The Node process
runs with a ~2 GB heap and PM2 restarts it at 2400 MB. Do the arithmetic: a
handful of pages plus Node's own footprint is already most of the box. The pool
cap is a memory budget expressed as a concurrency limit, and the periodic recycle
exists because long-lived Chrome leaks memory.

**Consequences.** Two rules for anyone touching this code. First, **never hold a
page across an `await` you don't control** — build all your data and HTML first,
then acquire a page, do only the browser work (`setContent` / `pdf` / `evaluate`)
while holding it, and release in a `finally`. A leaked page is a permanently lost
slot, and the recycle drain will park every new acquirer until it's released.
Second, `BROWSER_POOL_SIZE` is a "do not raise casually" knob for the memory
reason above.

**Revisit if.** You move to a bigger box with real memory headroom, or offload
browser work to a separate service. On this VPS, 4 is the ceiling.

### Decision 8 — Lighthouse provider is selectable; prod uses PageSpeed

**Decision.** Performance/Lighthouse scoring is behind a `LIGHTHOUSE_PROVIDER`
setting with three supported modes: `pagespeed` (call Google's PageSpeed
Insights, "PSI", API), `local` (run Lighthouse in our own Chrome), or `off`.
Prod currently runs `pagespeed` (`ecosystem.config.js`).

**Why.** Running Lighthouse locally is CPU- and memory-heavy, and on a small VPS
already juggling axe audits in Chrome, that contention hurts. PageSpeed Insights
offloads the work to Google's infrastructure. The accepted cost is **score
variance**: PSI runs from Google data-center IPs with a cold profile, so its
numbers differ from historical local-Lighthouse numbers, and education-sector
client sites behind a WAF (Web Application Firewall, a layer that filters
traffic before it reaches the site) or other bot-mitigation sometimes serve
Google a challenge page that PSI then scores. Per-page PSI failures fail
*only* the Lighthouse portion of an audit by design — axe and PDFs still
complete.

**Consequences.** `local` and `off` are **supported, working modes, not dead
code** — don't delete them. `local` is the escape hatch if PSI quota or reliability
becomes a problem; `off` is there for environments (or debugging) where you don't
want any Lighthouse at all. A related standing rule from the same incident cluster:
**axe is the accessibility authority, not PSI** — never treat PSI's a11y numbers as
ground truth for this client base, because the challenge-page problem makes them
unreliable.

**Revisit if.** PSI quota/cost/latency becomes the bottleneck (switch to `local`
on a box that can afford it), or Google changes the API materially.

### Decision 9 — AI-heavy development process

**Decision.** The repo is developed with AI assistance (Claude Code) as a
first-class workflow, governed by a documented process: `CLAUDE.md` is the living
contract of stack rules and invariants; `docs/superpowers/` holds the specs and
implementation plans for most non-trivial features; features are reviewed by a
second AI (Codex) before landing; and there's a tracker/handoff protocol between
sessions. There's also a set of project-specific skills under
`.claude/skills/` (the ones named `er-seo-tools-…`) that encode the deep "why."

**Why.** One developer plus AI can produce a lot of code quickly. That's a genuine
capability, but it changes where risk lives. Nobody carries the whole codebase in
their head from having typed every line — so the **control cannot be
line-by-line authorship memory. The control is the process: gates and review
discipline.**

**Consequences for you as a reviewer.** Two things follow. First,
`docs/superpowers/` (and the archived specs in `docs/superpowers/archive/specs/`)
are an **archaeology layer** — when you're trying to understand *why* something is
shaped a certain way, the spec that produced it is often more useful than reading
the code cold. Second, be aware that **AI-authored docs can drift from the code.**
There are documented cases in this repo of handoff/tracker prose describing
features that were never built, and of `CLAUDE.md` bullets going stale (for
example, `CLAUDE.md` describes 3 system schedules where the code actually seeds 5).
The rule when doc and code disagree: **the code wins, and the doc gets fixed.**
Verify claims against the running app and `git log`, not against summaries.

**Revisit if.** The team grows enough that collective human authorship memory
becomes a realistic control — but even then, the gates are cheap insurance worth
keeping.

---

## 4. Known debt and sharp edges

These are the things a senior should know are fragile before advising on a change
near them.

- **`AdaAudit` has no `updatedAt` column — this is deliberate, not an oversight.**
  Verified in `prisma/schema.prisma`: the `AdaAudit` model carries no `updatedAt`,
  while `SiteAudit` does. Standalone-audit liveness is derived from *durable-job
  state* instead: an audit is orphaned when there are zero active jobs in its job
  group and it's older than a short race-guard window. Adding `@updatedAt` "for
  consistency" changes nothing recovery uses; worse, copying `SiteAudit`'s
  stale-timeout logic here *without* a column would silently never fire. Leave it
  alone.

- **The prod-only minification bug class.** The prod build minifies with SWC
  (the Rust-based compiler Next.js uses to transpile and minify TypeScript —
  not an internal codename); dev and tests don't. This has produced two
  separate incidents:
  - *Minified class names breaking key lookups (2026-06-02).* Parser keys were
    derived from `ParserClass.name`; SWC renames classes in the prod build only
    (`InternalParser` → `af`), so every hardcoded lookup missed and prod produced
    empty, "hollow" reports while 800+ tests stayed green. Fixed with explicit
    static `parserKey` fields; guarded by `lib/parsers/parser-key.test.ts`. **Never
    derive a runtime identifier from `Function.name` or a class name.**
  - *SWC helper injection breaking string-injected in-page code (2026-06-16).*
    `lib/ada-audit/seo/parse-seo-dom.ts` is serialized with `.toString()` and
    injected into audited pages to run in *their* context. Using `typeof` in it
    made SWC emit an escaping `_type_of` helper that exists in module scope but not
    inside the page, throwing `ReferenceError` in-page. Code that leaves the module
    context must be fully self-contained — no module-scope references, and avoid
    constructs (like `typeof`) that compile to escaping helpers. Re-check the
    compiled output after editing that file.

  The general lesson: **prod is a different machine.** Anything touching fetch,
  URLs, uploads, raw SQL, minified identifiers, or Node-version-specific behavior
  needs a prod verification pass — green local tests are not sufficient evidence.

- **SSRF discipline — never raw-`fetch` a user-provided URL.** SSRF
  (Server-Side Request Forgery) is the class of attack where a server is
  tricked into making a request to a URL its owner didn't intend — e.g. a
  user-supplied "sitemap URL" that actually points at the server's own
  internal admin panel or cloud-metadata endpoint. Audits fetch client sites,
  sitemaps, and links, all from URLs users control. Every such fetch goes
  through the safe-URL helpers in `lib/security/safe-url.ts` (`safeFetch` /
  `assertSafeHttpUrl`), which block private/internal hosts and addresses, reject
  credentials-in-URL and non-http(s) schemes, re-validate on every redirect hop,
  and pin the connection to the pre-validated IP so DNS can't be rebound between
  check and connect. This file also handles a genuinely nasty edge:
  **out-of-range HTTP status codes.** LinkedIn's anti-bot response uses status
  `999`, which makes the WHATWG `Response` constructor throw `RangeError` — and
  because that throw happened on a later tick, it escaped the promise and left a
  verifier *hanging forever* (the 2026-07-06 hang). The transport now screens any
  status outside 200–599, enforces a socket idle timeout, and guarantees every
  code path settles. **Do not introduce a bare `fetch()` of an external URL
  anywhere.**

- **Legacy `SessionPage` read fallback pending model removal.** Pre-A2 sessions
  are still read via the old `SessionPage` model (no longer written to). The model
  drop is *planned* but not yet done — someone has to actually remove it once the
  old records age past their retention window (`prisma/schema.prisma`).

- **Single-process constraint (restated because it's easy to forget).** The job
  worker's concurrency accounting is in-memory. **PM2 must never run this app in
  cluster mode, and a second instance would over-subscribe Chrome and memory.**
  There is no multi-instance safety.

- **Memory ceilings are real and have bitten twice.** Two independent knobs, two
  incidents: the PM2 *runtime* restart ceiling (2026-05-14, raised 1200 MB → 2400 MB
  after a legitimate Lighthouse memory peak triggered a SIGKILL) and the
  *build-time* Node heap (2026-06-22, raised via a `--max-old-space-size` flag in
  the build script after a deploy's `next build` OOM'd). A large PR can hit the
  build ceiling again.

- **Monitoring/alerting exists but is thin, and the backup story has real gaps.**
  There is a `system-health-alert` schedule (every 15 minutes) that checks DB
  health, job failures, stalled audits, and backup staleness, surfaced in
  `/admin/ops` and `/api/health` — and a daily `system-db-backup` schedule
  (`VACUUM INTO`, retained 7). But: the health-alert only reaches a human if
  `ALERT_WEBHOOK_URL` is set (unset means it's logged and computed, never sent —
  whether it's actually configured in prod isn't verifiable from this repo);
  backups live on the *same disk* as the live database, so a disk failure takes
  out both together; and there is no documented or tested restore procedure. A
  dead schedule or a repeatedly failing dual-write that nobody's webhook catches
  is still silent until someone looks. Full detail in
  `08-operations-runbook.md` sections 3 and 6 — don't duplicate it here.

- **Client-domain matching is loose.** Sessions are attributed to clients by a
  first-match, bidirectional host-suffix comparison with no shared service. A
  client registered with a subdomain can claim sibling subdomains' sessions;
  overlaps resolve silently. It's a known source of "wrong client" attribution.

---

## 5. Supervising the junior

The other reader of this repo is a junior developer (first dev job; strong SEO
domain knowledge; ramping up on JS/TS/Node/React) working toward full ownership in
staged milestones (`05-milestones.md`). When you review their work or advise, this
is where to focus.

### (a) Review-focus checklist

Fast things to check on almost any PR:

- **Transactions are array-form only** (`$transaction([...])`), never the
  interactive `async tx =>` form. This is the 2026-06-10 outage's shape; treat it
  as a hard reject.
- **Raw SQL bumps set `updatedAt` manually** and express guards as SQL `EXISTS`
  predicates rather than read-then-write in app code.
- **New API routes use the `withRoute` wrapper and `parseJsonBody`** for uniform
  error handling — **but auth is never added to `withRoute`.** The cookie gate
  lives in `middleware.ts` and only there. A new public/token route needs an
  `isPublicPath` entry *and* a `middleware.test.ts` case (this is the recurring
  401 footgun from decision 6).
- **Writes in job/handler code are fenced** (conditioned on status/attempts) so a
  zombie attempt can't clobber a settled row.
- **Any fetch of a user-provided URL goes through the safe-URL helpers**
  (`lib/security/safe-url.ts`), never a bare `fetch()`.
- **New UI carries `dark:` variants.** The app is class-based dark mode
  throughout; a component without `dark:` styling is a visible bug.
- **Tests exist and run against the right database.** Test runs must use an
  explicit local `DATABASE_URL` (`file:./local-dev.db` — tests share the dev
  DB; there is no separate test DB), never the prod file.

### (b) Danger zones — require your review the longest

Some areas the junior should not be shipping unsupervised until well into their
progression, because a subtle mistake here has broad or silent blast radius:

- `lib/jobs/` — the queue, claiming, fencing, recovery. Concurrency correctness.
- `lib/findings/` — the dual-write, blob pruning, and read-time fallbacks.
- `prisma/schema.prisma` — schema changes and migrations (deletion semantics,
  unique constraints that encode idempotency).
- **Recovery paths** — the stale-audit sweep and startup recovery. A wrong "treat
  a read error as zero jobs" here destroys healthy audits.
- `middleware.ts` and auth (`lib/auth.ts`) — the global gate and the allowlist.
- `lib/security/` — SSRF protection and the same-site/CSRF (Cross-Site Request
  Forgery — a forged request riding a logged-in user's own cookies) guard.

A useful heuristic: UI-scoped and copy changes are safe to hand off early;
anything touching concurrency, the schema, auth, recovery, or external fetches
should keep a senior in the loop longest.

### (c) Where authority lives

When something is ambiguous, these are the sources of truth, in order:

- **The code**, always, when it disagrees with a doc.
- **`CLAUDE.md`** — the living contract: stack constraints, the "Do not" list,
  architecture patterns, deploy procedure.
- **This folder (`docs/onboarding/`)** — the onboarding path and reference set.
- **`docs/superpowers/archive/specs/`** — the shipped-feature specs; the
  archaeology layer for *why* a feature is shaped the way it is.
- **The `er-seo-tools-…` skills under `.claude/skills/`** — condensed, cited playbooks for
  architecture rationale, failure history, debugging, config, and operations.
  These are the fastest way to get the "why" with `file:line` receipts.
