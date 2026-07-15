# 04 — How It Runs

**Re-orientation.** If it's been a while: `03-codebase-tour.md` was the
*static* map — where things live. This doc is its dynamic sibling — what
actually *happens*, over time, when the machinery moves. It's written as a
set of "what happens when…" stories rather than component lists, because
the runtime behavior only makes sense as a sequence. Read a story, then go
find the files it names.

**How to read this doc.** Same reading-depth labels as the tour:

- **First pass** — read it, follow the story, move on.
- **Deep dive later** — come back when Stage 1 of `05-milestones.md` sends
  you here, or when you're about to touch the code it describes.
- **Senior: read now** — the sections an outside senior should read in full
  before forming opinions about this codebase.

One meta-note before the stories: this doc stays one level above the exact
invariants. `CLAUDE.md`'s "Architecture patterns" section is the precise,
always-current statement of every rule the stories below gesture at —
when you need the letter of the law rather than the plot, go there.

## 1. What happens when you click "Start Audit"

**First pass.**

You're on `/ada-audit`, you type in a client's domain, choose site-wide,
and click the button. Here's the whole life of that audit.

**A row is born, waiting.** The API route creates a `SiteAudit` record
with status `queued` and — crucially — does *not* start crawling anything.
Site audits are heavy (a headless Chrome browser per page, possibly a
thousand pages), so only one is allowed to run at a time. Everything else
waits in a first-in-first-out line. Your browser immediately gets back the
new audit's id and starts polling for updates; the form shows you your
place in the queue.

**A promoter notices the line.** A small function called the promoter
(`processNext()` in `lib/ada-audit/queue-manager.ts`) looks at the queue
whenever something changes — a new audit arrives, an old one finishes. If
nothing is currently in flight, it picks the oldest queued audit and
creates a background job to start it. The promoter itself is deliberately
dumb: it holds no lock and keeps no state, and it's fine if two copies of
it race each other, because the real "only one at a time" rule is enforced
one step later, at the database.

**The discover job claims the audit.** That background job
(`site-audit-discover`) tries to flip the row from `queued` to `running`
with a single conditional database update that only succeeds if *no other
audit anywhere is currently in a running state*. The database — not any
in-memory lock — is the referee. If another audit is still in flight, the
claim simply fails and the job leaves the row queued for a later attempt.
If it succeeds, this audit now owns the one running slot.

**Discovery: what pages does this site even have?** The discover job asks
the site for its sitemap — first via `robots.txt`, then the usual sitemap
locations (`/sitemap.xml`, sitemap indexes, the WordPress flavor,
gzip-compressed variants). If no sitemap exists it falls back to a shallow
crawl of the homepage's links. Either way the page list is hard-capped at
1,000 pages. The discovered URL list is saved onto the audit row itself —
so if anything crashes and retries later, the exact same page set is used
rather than re-crawling and maybe getting a different answer.

**Fan-out.** The discover job creates one child record per page and one
`site-audit-page` background job per URL, then it's done. From here the
audit is just a swarm of small, independent page jobs draining from the
queue (a couple at a time — page concurrency is deliberately low, because
each page means a real Chrome tab and real memory).

**Each page job does its page.** It borrows a Chrome page from the shared
browser pool, loads the URL, runs the axe-core accessibility engine
against the rendered page, and — while it's in there anyway — harvests
every link and image target plus the page's on-page SEO signals (title,
headings, meta description, and so on) for later. If the page links to PDF
files, it dispatches PDF-scan jobs for those *before* marking its own page
done — the ordering matters, so the audit can never look "finished" while
PDF work is still being registered. Then it settles: one atomic database
update marks the page done and bumps the audit's counters. Finally it
queues a PageSpeed Insights (Lighthouse) check for the page.

**The finalizer decides what "done" means.** After every page, PDF, or
Lighthouse result lands, one function — `finalizeSiteAudit` in
`lib/ada-audit/site-audit-finalizer.ts` — re-reads the counters and makes
the single authoritative call: if pages are still outstanding, do nothing;
if pages are done but PDFs aren't, the audit shows `pdfs-running`; if only
Lighthouse remains, `lighthouse-running`; if everything is drained, it
builds the summary and writes `complete`. Nothing else in the codebase is
allowed to flip an audit to a terminal state. So the status flow you watch
in the UI is: `queued → running → pdfs-running / lighthouse-running →
complete`.

**One more thing happens after "complete."** Completion quietly enqueues a
final background job, the live-scan builder (`broken-link-verify`). It
takes everything the page jobs harvested — all those link targets and
on-page SEO signals — verifies which internal links and images are
actually broken, checks external links, computes a live SEO score, and
writes the results as a second, SEO-flavored set of findings attached to
the same audit. That's why the results page can show broken links and
on-page SEO issues alongside accessibility violations from a single
"accessibility" audit: two passes, one crawl.

That's the plot. The precise invariants behind each step — the discovery
guard, the counter ordering, first-writer-wins fencing — live in the
"Site-audit phase model" bullet of `CLAUDE.md` and in
`.claude/skills/er-seo-tools-architecture-contract/SKILL.md`.

## 2. The job queue

**Deep dive later. Senior: read now.**

Everything in the story above that "enqueues a job" runs through one
homegrown durable job queue: two database tables (`Job` and `Schedule` in
`prisma/schema.prisma`) and a single in-process worker loop
(`lib/jobs/worker.ts`). There is no Redis, no BullMQ, no separate worker
process — the queue *is* SQLite rows, and the worker is a timer inside the
same Node process that serves web requests. On a one-box deployment this
is a feature: a job survives anything the process doesn't, because it's a
row, and there's no second piece of infrastructure to keep alive.

**How a job gets claimed.** The worker polls for `queued` rows whose
`runAfter` has passed. For each candidate it doesn't just start working —
it first issues a conditional update: *set this row to `running`, but only
if it's still `queued`*. If that update reports "1 row changed," this
worker won the job. If it reports "0 rows," someone else (a concurrent
tick, a previous life of this process) got there first, and the worker
moves on to the next candidate. First writer wins; the database adjudicates.

**How a dead claimant is survived.** Winning the claim also increments the
job's `attempts` counter, and the winner remembers the value it wrote.
Every subsequent write it makes — the 15-second heartbeat, the final
success/failure settle — carries a condition: *only apply this if the row
is still `running` and `attempts` still equals my number*. Why? Because a
handler can time out at the queue layer but keep executing (not everything
honors a cancellation signal). The queue's stale-sweep will notice the
missing heartbeat after 2 minutes and re-queue the job; a fresh attempt
claims it and bumps `attempts`. When the old, zombified attempt eventually
tries to write its result, its condition matches zero rows and the write
silently evaporates. That remembered attempt number acting as a write
permit has a name: it's a *fencing token*, and this pattern — conditional
claim plus fenced writes — is called **fencing**. It's the single most
load-bearing idea in this codebase's concurrency story, and it's why the
`CLAUDE.md` rules about conditional SQL updates exist.

**Per-type configuration.** Each job type registers a handler plus its own
concurrency limit, max attempts, timeout, and backoff base
(`lib/jobs/handlers/register.ts` is the one truthful catalog of all the
types). A failed attempt is re-queued with exponential backoff (doubling
per attempt, capped at 15 minutes). When a job burns its final attempt,
the queue flips it to `error` and invokes that type's optional
`onExhausted` hook — the domain layer's chance to mark *its* record
(the audit, the report) as failed too, so a dead job never leaves a
parent row spinning forever in the UI.

**Schedules.** The `Schedule` table holds recurring rules — a cadence
string plus a job type. Every 60 seconds the worker ticks
`tickSchedules()` (`lib/jobs/scheduler.ts`), which enqueues a `Job` row
for any schedule whose time has come. A uniqueness constraint on
(schedule, scheduled-slot) makes each slot fire exactly once, even if the
tick crashes halfway and replays. The system's own maintenance — daily
cleanup, the 10-minute stale-audit reset, the 30-minute screenshot sweep,
the daily database backup, the 15-minute health-alert check — are
`system-*` Schedule rows seeded from code at every boot
(`lib/jobs/system-schedules.ts`), so a fresh database grows its own
maintenance schedule with no manual setup. Client scan schedules are
plain rows in the same table (Section 4).

One consequence worth internalizing: the worker's concurrency accounting
is in-memory, so this design assumes **exactly one process**. That's why
PM2 runs the app in fork mode with one instance, never cluster mode.

## 3. What happens when the server restarts mid-audit

**First pass.**

Deploys restart the server. Audits take many minutes. So "the process died
while three audits were in flight" isn't an emergency here — it's a
Tuesday, and the system is built to shrug it off. Here's the story.

**Going down.** The deploy sends the process a shutdown signal (SIGTERM).
The handler in `instrumentation.ts` stops the job worker, then calls
`closeBrowser()` so headless Chrome exits cleanly instead of lingering as
an orphaned memory-hungry process. In-flight page jobs just… stop. That's
allowed — every one of them is a durable `Job` row, and rows don't die
with the process.

**Coming back up.** Boot (also `instrumentation.ts`) runs a strict
sequence: register the job handlers, recover orphaned jobs (rows stuck
`running` with no live process behind them get re-queued or errored), then
run `recoverQueue()` — the audit-level triage described next — then seed
the system schedules, and only then start the worker draining jobs again.

**The triage decision.** For every audit that looks in-progress,
`recoverQueue()` (in `lib/ada-audit/queue-manager.ts`) asks one question:
*does this audit still have active jobs in the queue?*

- **Yes** → resume. Leave it alone; the worker will drain its jobs and the
  audit picks up where it left off. This is the normal case after a
  deploy — running audits simply continue.
- **No, zero jobs** → try to finalize it once. Maybe every page actually
  finished and the crash just ate the final bookkeeping — in which case
  finalizing now completes it, and nothing was lost.
- **Still stuck after that** → fail it, cleanly: flip the audit to a
  terminal error state, fail its orphaned children, cancel any leftover
  queued jobs, and kick the promoter so the next queued audit gets the
  slot.

One rule inside that triage is worth quoting because it shapes the whole
recovery philosophy: **a failed job count never destroys a parent.** If
the "does it have active jobs?" read itself errors (a momentarily busy
database, say), recovery *skips* that audit this pass rather than treating
the error as "zero jobs" and killing something healthy. Destruction
requires positive evidence.

**And it keeps happening, without restarts.** The same triage runs every
10 minutes as the `stale-audit-reset` scheduled job, using staleness as
its trigger: every write to an audit bumps its `updatedAt` timestamp, so a
healthy audit — however long it runs — always looks fresh, and an audit
untouched for 5 minutes is presumed wedged and gets triaged. That's why
the practical first response to "an audit looks stuck" is usually
*wait ten minutes* — the system is already scheduled to notice.

## 4. Scheduled scans and retention

**Deep dive later.**

**Scheduled scans.** A client page can carry recurring scan schedules —
"audit this domain weekly" — which are ordinary rows in the same
`Schedule` table from Section 2, created through the client API rather
than seeded from code. Cadences are weekly or monthly (daily is
deliberately rejected for client scans — the data volume isn't worth it).
When the 60-second tick fires one, a wrapper job re-validates that the
client and domain still exist and still match (a schedule whose config has
rotted disables itself rather than scanning the wrong thing), then feeds
the request into exactly the same queue → promoter → discover pipeline as
a hand-started audit from Section 1. The resulting audit is just tagged as
scheduled, which matters for retention below. Details: the "Scheduled
scans (C2)" bullet in `CLAUDE.md`.

**Retention — what quietly deletes your data, and when.** Three separate
retention passes run inside the daily cleanup job; if data "disappeared,"
check these before suspecting a bug. Exact windows live in `CLAUDE.md`
and the retention modules; here's the shape:

*Terminal job rows.* Finished `Job` rows are bookkeeping, not results —
completed and cancelled ones are deleted after about a week, errored ones
kept longer (roughly a month) so failures stay inspectable
(`lib/jobs/retention.ts`).

*Scheduled site audits.* Schedule-originated audits pile up forever if you
let them, so they're pruned on a per-cadence window — weekly-cadence
audits kept ~90 days, monthly ~a year — always keeping the latest couple
of completed runs per schedule for comparison. Manually started audits are
**never** pruned by this pass (`lib/ada-audit/scheduled-retention.ts`).

*Blob archiving.* The big JSON result blobs on origin rows (`Session`,
`AdaAudit`, `SiteAudit` — the "origin models" from the tour's data-model
section) are nulled out ~90 days after completion. The audit is *not*
deleted: its normalized findings rows remain, and every read surface falls
back to a degraded view rebuilt from those tables, with an "archived"
banner in the UI. Screenshots go with the blob; scores survive because
they live on the findings side (`lib/findings/retention.ts`).

## 5. Production topology

**First pass. Senior: read now.**

Everything above runs on **one machine**: a small VPS managed through
RunCloud, with nginx in front reverse-proxying to a single Node process
kept alive by PM2 (fork mode, one instance — Section 2 explains why never
more). Google Chrome is installed on the box itself
(`/usr/bin/google-chrome`); the ADA audits need a real browser, and that's
half the reason this app was never a serverless candidate.

Where things live on that box:

- App code: `$APP_HOME`
- Data — the SQLite database, uploads, screenshots, generated report PDFs:
  under `$DATA_HOME/` (the database is `db.sqlite` there)
- Logs: `$LOG_HOME/`

The data directory sitting *outside* the app directory is deliberate:
deploys can replace the code wholesale without going anywhere near the
database.

**How a deploy works.** The server pulls from GitHub — it never receives
code any other way. So a deploy is two steps, in an order that matters:

1. `git push` (unpushed local commits deploy nothing, ever)
2. `ssh $PROD_SSH "~/deploy.sh"` — a script on the server that
   pulls, installs dependencies, rebuilds, stops the app, applies any
   pending database migrations, and starts it again.

That stop → migrate → start ordering is why Section 3's restart story is
so central: *every deploy is a mid-flight restart*, and the recovery
machinery is what makes deploying while audits run a non-event.

Production tuning (pool sizes, concurrency, memory limits) lives in
`ecosystem.config.js`, committed to the repo. The full operational
playbook — reading PM2 logs, post-deploy verification, diagnosing a stuck
queue, what to check before restarting anything — is
`08-operations-runbook.md`, the Stage 4 companion to this doc.
