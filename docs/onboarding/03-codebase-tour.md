# 03 — Codebase Tour

**Re-orientation.** If it's been a while since you were last here: this is
the reference map of the repo — the *static structure*, not the runtime
behavior (what actually happens when an audit runs is `04-how-it-runs.md`).
It exists so you can find where something lives without re-deriving the
architecture from scratch every time you come back. Nothing here is a
one-time read — you'll return to this doc constantly.

**How to read this doc.** Every section below opens with a reading-depth
label:

- **First pass** — read the paragraph, then move on. That's the whole ask
  the first time through.
- **Deep dive later** — skip it on your first visit; come back once you're
  working through Stage 1 of `05-milestones.md` and actually need the
  detail.
- **Senior: read now** — if you're the outside senior developer, read these
  in full before doing anything else in this doc; they're the sections that
  matter for review judgment.

Some sections carry both labels — same paragraph, different urgency
depending on who's reading it.

## 1. Repo layout

**First pass.**

- `app/` — every page and every API route, using Next.js's App Router. Two
  route groups split the pages in half: `app/(app)/` (the login-gated tool
  pages — `/seo-parser`, `/ada-audit`, `/clients`, and the rest) and
  `app/(public)/` (pages anyone can reach without logging in, like `/login`
  and the public share views). `app/api/` holds the JSON API routes both
  groups call.
- `components/` — the React components those pages render: forms, tables,
  charts, the shared shell.
- `lib/` — essentially all of the real logic: parsing, scoring, the job
  queue, database access — everything that isn't "how does this look on
  screen." Section 3 below walks it layer by layer.
- `prisma/schema.prisma` — the database schema (Section 4 covers what's in
  it), plus the migration history that got it there.
- `scripts/` — operational tools you run by hand from a terminal (rebuild
  findings from a blob, check blob/table parity, back up the DB) — never
  called by the running app itself.
- `test/` plus files named `*.test.ts` sitting right next to the code they
  test (a "colocated" test) — the test suite. There's no single `tests/`
  folder holding everything; if you're reading `lib/security/safe-url.ts`,
  look for `lib/security/safe-url.test.ts` right beside it.
- `docs/` — this guide (`docs/onboarding/`) plus `docs/superpowers/` (specs
  and plans — covered properly in `06-working-with-ai.md`).

## 2. Request flow

**First pass.**

Walk through what happens when a page in this app asks for data:

1. Your browser requests a page, or a page's JavaScript calls a JSON API
   route.
2. `middleware.ts` runs first, on *every* request. It checks for a signed
   auth cookie: no valid cookie means either a redirect to `/login` (for a
   page request) or a 401 JSON response (for an API call) — *unless* the
   path is one of the public-path exceptions it carves out (share links
   like `/ada-audit/share/`, the login route itself, and a handful of
   token-authed skill-handoff routes). This is the one and only place auth
   is checked; nothing downstream re-checks it.
3. If the cookie is valid (or the path is public), the request reaches an
   App Router route — either a page component under `app/(app)/` /
   `app/(public)/`, or a route handler under `app/api/`.
4. API route handlers wrap their logic in `withRoute()`
   (`lib/api/with-route.ts`) — a uniform error envelope. Throw an
   `HttpError` and it becomes the right status code; a Prisma "record not
   found" becomes a 404; anything unexpected becomes a generic 500 with no
   internal detail leaked to the client.
5. Inside the handler, database access goes through the single shared
   Prisma client in `lib/db.ts` (`import { prisma } from '@/lib/db'`).
6. The handler returns JSON, which the browser receives and renders.

Background work (an ADA audit, a whole-site crawl, a PDF render) doesn't fit
that request/response shape — it can run for a while, so the app starts a
durable background job and hands the browser an id right away. The browser
then polls for progress: an ADA audit poller checks back every second, the
site-audit queue banner every 5 seconds, the audit history list every 8
seconds while something's active. *Why* the app polls instead of pushing
updates (websockets, server-sent events) is a real, deliberate decision —
covered in `04-how-it-runs.md`.

## 3. `lib/` inventory

**Deep dive later. Senior: read now.**

This section maps `lib/`'s layers — what each one owns and its one or two
most load-bearing files. It's meant to be a coarse, stable map of the
*layers themselves*; for the current, file-by-file detail (which changes
far more often than the layers do), `CLAUDE.md`'s "Key files" list is the
always-current index — read this section to know which layer to go looking
in, then go there.

**`lib/db.ts`.** The single Prisma client singleton every other file imports
(`import { prisma } from '@/lib/db'`), plus `initPragmas()`, which sets the
SQLite PRAGMAs (WAL journal mode, `busy_timeout`, foreign keys on) the app
needs to survive concurrent writers on a single-file database.

**`lib/api/`.** The house kit every API route is expected to use:
`with-route.ts` (`withRoute()`, the error envelope from Section 2) and
`body.ts` (`parseJsonBody()`, which turns malformed JSON into a clean 400
instead of an unhandled throw). `errors.ts` defines the `HttpError` type
`withRoute` knows how to translate.

**`lib/log/`.** The structured logger (`index.ts`, built on `pino`):
`logger` for direct structured logging and `logError(context, err)` for the
common "something failed, don't crash the caller" case — `logError` is
written so it can never itself throw.

**`lib/jobs/`.** The durable job queue: `queue.ts` (enqueue and the
conditional-claim logic), `worker.ts` (the single in-process worker loop
that actually runs jobs), `scheduler.ts` (the periodic tick that turns
`Schedule` rows into new `Job` rows), and `registry.ts` (the map from job
`type` string to handler function). Every actual job's logic lives one
level down, in `lib/jobs/handlers/` — one file per job type, e.g.
`lib/jobs/handlers/ada-audit.ts` or `lib/jobs/handlers/site-audit-page.ts`.

**`lib/ada-audit/`.** Everything about running an accessibility audit — and,
as the app has grown, live on-page SEO signals too. `browser-pool.ts` (the
headless-Chrome page pool every audit borrows a page from) and `runner.ts`
(the axe-core runner itself) are the core; `site-audit-finalizer.ts` is the
single decision point for "is this whole-site audit actually done," and
`sitemap-crawler.ts` handles page discovery. A `lib/ada-audit/seo/`
subdirectory holds the newer live on-page SEO parsing, content-similarity,
and discovery-coverage logic that grew out of the same page-crawl.

**`lib/findings/`.** The normalized findings layer described in Section 4:
`types.ts` (the source-agnostic `FindingsBundle` contract every adapter
targets) and `writer.ts` (the single transaction that lands a bundle as
`CrawlRun`/`CrawlPage`/`Finding`/`Violation` rows). `seo-mapper.ts` and
`ada-mapper.ts` are the adapters that turn a legacy blob into a bundle.

**`lib/report/`.** Everything that turns stored results into a document a
client can read: `csv.ts`, `vpat.ts`, and `report-html.ts` (pure HTML
builders), plus `report-data.ts` (the loader that assembles what a report
needs). A `lib/report/seo/` subdirectory holds the GA4/GSC performance-report
renderer behind `/reports`.

**`lib/services/`.** Cross-cutting read-side logic that doesn't belong to
any single audit type: `scoring.service.ts` (the SEO-parser health score),
`client-findings.ts`, `site-audit-diff.ts` (instance-to-instance diffing),
and `findings-shared.ts` (the canonical-run selector other code relies on
to pick the "real" score when a client has more than one kind of run).

**`lib/parsers/`.** The Screaming Frog CSV parsers uploaded through
`/seo-parser`. `base.parser.ts` defines `BaseParser`, the class every
specific parser extends, with an O(1) `headerMap` for column lookups instead
of scanning header arrays per row.

**`lib/analytics/`.** The provider layer behind `/reports`: a `google/`
subdirectory (service-account auth, the GA4 and Search Console API
wrappers) and a `prospects/` subdirectory (the CRM adapter for pipeline
data). No OAuth routes and no per-user credential rows — auth is a single
service-account key file.

**`lib/security/`.** The guardrails around anything that touches an
untrusted URL or a cross-site request: `safe-url.ts` (the safe-fetch helpers
every external fetch of a user- or client-provided URL is required to go
through — this is the SSRF defense) and `same-site-request.ts` (the CSRF
check `middleware.ts` calls on mutating requests).

**`lib/ops/`.** Production observability: `health-summary.ts` is the single
source of the "is anything degraded" flag shared by `/api/health` and
`/admin/ops`, and `ops-snapshot.ts` loads each `/admin/ops` panel with its
own failure isolation, so one broken panel never blanks the whole page.

## 4. Data model

**Deep dive later. Senior: read now.**

Three kinds of models live in `prisma/schema.prisma`, and telling them apart
is the single most useful thing you can learn about this schema.

**Origin models** are where a piece of work is tracked from creation to
completion, and — for audits old enough to predate the findings layer, or
young enough not to have had their blob pruned yet — where its legacy result
lives as a JSON blob: `Session` (a Screaming Frog CSV upload run through the
parser; `result` is the aggregated report JSON), `AdaAudit` (a single-page
accessibility audit, or one page-child of a site audit; `result` is
axe-core's raw output), and `SiteAudit` (a whole-site accessibility audit;
`summary` is computed once at completion). These are the rows the UI's
polling loops watch for status changes, and the rows that carry `status` /
`progress` / `error`.

**The normalized findings subtree** is a second, source-agnostic
representation of the same results, built as a side effect once an origin
model finishes. `CrawlRun` (one run — of a parser session, a site audit, or
a standalone page audit) owns a tree of `CrawlPage` rows (one per crawled
URL) and `Finding` rows (one per detected issue, scoped to the run or to a
page), with `Violation` rows attached one-to-one to axe-derived findings to
carry accessibility-specific detail (impact level, WCAG tags, offending
node HTML). Every completed parse, site audit, and standalone ADA audit
writes one of these trees. Report exports, the results-page tables, and
any cross-audit comparison read from this layer, not the blobs.

**Why both exist, honestly.** The blobs came first — `Session`, `AdaAudit`,
and `SiteAudit` and their JSON result columns predate any of this. The
`CrawlRun` subtree was retrofitted on top later specifically so results
could be queried, diffed, and reported on with SQL instead of loading and
re-parsing an entire JSON blob on every read. The dual-write is a
*permanent* design, not a migration-in-progress: old blobs are never
backfilled into the new tables, and audits from before the findings layer
existed only ever have a blob. Blobs are also pruned some time after
completion to keep the database small; once that happens, reads fall back
to a degraded view rebuilt from the findings tables (an "archived" banner
appears in the UI when this has happened to what you're looking at). The
full rationale for carrying two representations of the same result forever
— including whether that trade-off still holds at this project's current
size — is in `07-senior-brief.md`, decision 5.

**Job and Schedule** are a separate pair, one level below the audit models:
`Job` is one row per unit of durable background work (running an audit,
scanning a PDF, a maintenance sweep), tracked independently of which origin
model it's serving; `Schedule` is a recurring rule ("scan this client's
domain weekly") that periodically produces new `Job` rows. How claiming,
fencing, and crash recovery actually work for both is `04-how-it-runs.md`
territory — for this doc, it's enough to know the two tables exist and what
each one is for.

**Cascade vs. `SetNull`, in one sentence:** a relation is `onDelete: Cascade`
when the child row has no meaning without its parent (delete a `CrawlRun`
and its `CrawlPage` / `Finding` / `Violation` rows go with it), and
`onDelete: SetNull` when the child should survive its parent's deletion as
an orphaned-but-still-useful record (delete a `Client` and its `SiteAudit`
history sticks around, just unlinked from that client).

## 5. UI conventions

**Deep dive later.**

Dark mode uses Tailwind's class-based strategy (`darkMode: 'class'` in
`tailwind.config.ts`) rather than following the OS's `prefers-color-scheme`
automatically — the app needs a manual toggle a user can override, not just
whatever the OS says. A small inline `<script>` in `app/layout.tsx`, placed
deliberately before React ever hydrates, reads `localStorage('er-theme')`
(falling back to `prefers-color-scheme` if that's unset) and adds the
`dark` class to `<html>` immediately. That's the "anti-FOUC" (flash of
unstyled content) trick: without it, a dark-mode user would see the page
render light for an instant on every load, then flicker to dark once React
catches up. `components/ThemeProvider.tsx` is the React-side counterpart —
a context exposing `theme`, `toggle()`, and `mounted` (used to defer
rendering the theme-dependent bit of the UI until the client has mounted
and can agree with what the inline script already decided, avoiding a
hydration mismatch). `components/ThemeToggle.tsx` is the sun/moon button
that calls `toggle()`.

Every component with a distinct light and dark look pairs Tailwind's
`dark:` variant classes with the light-mode ones, following a small, stable
set of mappings:

| Light-mode class | Dark-mode variant |
|---|---|
| `bg-white` | `dark:bg-navy-card` |
| `text-gray-*` | `dark:text-white/*` |
| `border-gray-*` | `dark:border-navy-border` |
| semantic status colors (e.g. a red "critical" badge) | `dark:bg-{color}-500/{opacity}` |

Charts are the one place performance discipline shows up at the UI layer:
`Recharts` (the charting library) is lazy-loaded via `next/dynamic` rather
than imported directly, because it doesn't get along with server-side
rendering. `components/clients/Scorecard.tsx` is a real example of the
pattern — it loads Recharts dynamically, with `components/clients/Sparkline.tsx`
as the plain, `ssr:false` piece it renders once loaded.
