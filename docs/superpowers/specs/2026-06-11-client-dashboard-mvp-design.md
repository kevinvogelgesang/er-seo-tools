# Client Dashboard MVP (B1) — Design

**Date:** 2026-06-11 · **Status:** Spec (Phase 1a of doc 04, "Client Command Center")
**Source:** `docs/superpowers/nyi/improvement-roadmaps/04-clients-and-quarter-grid.md` § Phase 1a
**Tracker item:** B1 — Client dashboard MVP from existing scalar data (1.5–2 wks)

## Goal

Rebuild `/clients/[id]` as the de-facto home page of the platform and `/clients`
as the fleet "Monday morning" screen — assembled entirely from data the tools
already store. **Read-only**: Phase 1a adds no new data collection, no new
schema, no writes. The findings/action center (open findings, drill-downs,
regression alerts from scheduled scans) is **B2** and explicitly out of scope.

## Hard constraints

1. **Scalar-only — zero new blob readers.** The A2 retention machinery
   (`PRUNE_ACTIVATED`) flips per-tool when that tool's *last* blob reader is
   removed. This feature must not add readers of `Session.result`,
   `SiteAudit.summary`, or `AdaAudit.result`. Everything renders from scalar
   columns and the A2 `CrawlRun` table.
2. No schema changes, no migrations, no backfill of historical blobs.
3. Existing client CRUD (add/rename/domains/seed URLs/Teamwork ID/delete)
   must survive unchanged — it moves, it doesn't get rebuilt.
4. Repo conventions: server components + `lib/services/` for reads (the
   existing `/clients/[id]` pattern), Recharts only via `next/dynamic`
   `ssr: false`, dark-mode class pairs, array-form transactions only (moot
   here — read-only feature).

## Score sources (the load-bearing decision)

Verified against `prisma/schema.prisma` and the routes:

| Scorecard | Scalar source | History depth |
|---|---|---|
| SEO health | `CrawlRun.score` where `tool='seo-parser'` (sessions joined via `CrawlRun.sessionId`) | Post-A2 only (≥ 2026-06-10) |
| SEO issue counts | `Session.criticalCount/warningCount/noticeCount/totalUrls` (`workflow='technical'`, `status='complete'`) | Full history |
| ADA site score | `CrawlRun.score` where `tool='ada-audit' AND source='site-audit'` | Post-A2 only (`SiteAudit.score` is **never persisted** — pre-A2 site scores live only in the `summary` blob, which we will not read) |
| ADA page score (fallback) | `AdaAudit.score` where `siteAuditId IS NULL AND status='complete'` — a real persisted scalar | Full history |
| Pillar score | `PillarAnalysis.score` (1–10, `status='complete'`), client via `session.clientId` | Full history |

Consequences, accepted: ADA and SEO *score* sparklines start shallow (history
begins at A2's ship date) and deepen with every run; pre-A2 runs still appear
in the activity timeline and the SEO issue-count trend. We do **not** reuse
`/api/clients/audit-summary`'s blob-derived scoring (it parses
`SiteAudit.summary` — exactly the reader class we're trying to retire; that
route stays as-is for the `/ada-audit` page and is untouched by B1).

ADA series selection rule: if the client has ≥1 site-audit `CrawlRun`, the ADA
scorecard/series is site-audit runs only; otherwise it falls back to standalone
page-audit scores (labeled "page audit" on the card). Site scores and
single-page scores are never mixed in one series.

## Architecture

Two read services, two server-component pages, presentational client
components only where interactivity/charts require it. No new API routes —
server components call services directly.

```
lib/services/client-fleet.ts        getClientFleet(): FleetRow[]        (all clients, batched)
lib/services/client-dashboard.ts    getClientDashboard(id): Dashboard   (one client)
lib/services/scorecard-shared.ts    series/delta/alert helpers shared by both (pure, unit-testable)

app/clients/page.tsx                fleet table (server component)
app/clients/[id]/page.tsx           dashboard (server component, rebuilt)
app/clients/manage/page.tsx         the existing 561-LOC CRUD page, moved verbatim

components/clients/FleetTable.tsx       client component (client-side sort)
components/clients/Scorecard.tsx        score + delta arrow + sparkline + "as of" link
components/clients/Sparkline.tsx        tiny Recharts line, next/dynamic ssr:false
components/clients/ActivityTimeline.tsx server-renderable list
components/clients/ClientHeader.tsx     name, domains, seed URLs, Teamwork, schedules, Edit link
```

### Query strategy (no N+1)

Both services issue a fixed number of `findMany` calls selecting scalar
columns only, then aggregate in JS. At ~30 clients × a few hundred rows total
this is well inside SQLite/single-process comfort.

- **Fleet (6 queries total, not per-client):** clients; technical sessions
  (scalar counts); seo-parser `CrawlRun`s; ada-audit `CrawlRun`s
  (source='site-audit'); standalone `AdaAudit`s (id/score/clientId/createdAt/
  status); `PillarAnalysis` (score/status/createdAt + `session.clientId`).
  Group by clientId in memory.
- **Dashboard (one client):** the same filtered to one clientId, plus the
  timeline sources: sessions `include`-ing `pillarAnalyses`, `seoRoadmap`,
  `keywordResearch` (one query covers four timeline types), siteAudits,
  standalone adaAudits, client schedules. Latest ~50 timeline items.

### Shared scorecard computation (`scorecard-shared.ts`, pure functions)

- `buildSeries(points: {date, score}[]): ScoreSeries` — sorted asc, capped to
  the most recent 12 points for sparklines.
- `latestAndDelta(series)` → `{ latest, previous, delta }` (delta null when <2
  points).
- `computeAlerts(client aggregates)` → `Alert[]` with three kinds:
  - `score-drop` — SEO or ADA `delta <= -10`
  - `error` — the most recent run of any tool has `status='error'`
  - `stale` — no completed run/memo of any kind in the last 30 days
  Thresholds are named constants (`SCORE_DROP_THRESHOLD = 10`,
  `STALE_DAYS = 30`) in this file.

## Page designs

### `/clients` — fleet table

Server component fetches `getClientFleet()`, renders `<FleetTable rows={…}/>`.
Columns: **Client** (name + first domain, links to `/clients/[id]`) · **SEO**
(score + delta chip) · **ADA** (score + delta chip, "page" suffix when the
series is the standalone fallback) · **Pillar** (n/10) · **Last activity**
(relative time) · **Alerts** (colored chips: red `error`, amber `score-drop`,
gray `stale`). Client-side sort by name / SEO / ADA / pillar / last activity
(FleetTable is a `'use client'` component over server-passed props — same
pattern as `RecentsTable`). Default sort: alerts first, then name. Header row
has an "Add client / Manage →" link to `/clients/manage`. Missing scores
render an em-dash, never 0.

### `/clients/[id]` — client dashboard

Server component; 404 via `notFound()` for unknown ids (current behavior
kept).

1. **Header** (`ClientHeader`): client name; domain chips; seed-URL count
   ("4 seed URLs", title-attr with the list) when present; Teamwork link
   (`https://enrollmentresources.teamwork.com/app/tasklists/{id}`) when
   `teamworkTasklistId` set; scheduled-scan line listing enabled
   client-attached `Schedule` rows (cadence + next run) or "No scheduled
   scans"; "Edit client →" link to `/clients/manage`.
2. **Scorecard row** — three `Scorecard` cards (SEO health, ADA, Pillar):
   large latest score (color thresholds matching existing scorecards:
   ≥90 green / ≥70 amber / else red for 0–100 scores; pillar uses its 1–10
   scale with ≥8/≥5 bands), delta vs previous run (▲ green / ▼ red, inverse
   never needed — higher is always better for all three), 12-point sparkline,
   "as of {date}" linking to the source run's detail view. Cards with no data
   show "No runs yet". The SEO card also shows latest critical/warning/notice
   counts as small stat chips (from Session scalars — these exist even when
   the score doesn't).
3. **Issue trend** — keep the existing `SeoHistoryChart` (critical/warning/
   notice lines over full session history) below the scorecards; it already
   exists and covers pre-A2 history the score sparkline can't.
4. **Activity timeline** (`ActivityTimeline`): reverse-chron union of
   - SEO parse sessions (`workflow='technical'`) → `/seo-parser/results/[id]`
   - Keyword-research sessions → `/keyword-research/[sessionId]`
   - Site audits → `/ada-audit/site/[id]`
   - Standalone ADA audits → `/ada-audit/[id]`
   - Pillar analyses → `/pillar-analysis/[id]`
   - SEO roadmaps → `/seo-parser/results/[sessionId]` (roadmap renders as a
     card there)
   Each row: tool badge (colored, uppercase, matching `RecentsTable` style),
   title (domain or url), status badge, key stat (score / counts / pages),
   relative date (`ClientDate`-style hydration-safe), link. Capped at the 50
   most recent; non-terminal statuses (pending/running) show as-is with no
   special polling — this page is not a live monitor.
5. **"Compare latest two crawls"** link (existing behavior from
   `SeoHistoryView`) is preserved next to the issue trend.

`SeoHistoryView` is superseded by the new page composition;
`SeoHistoryChart` is kept and reused. `lib/services/client-seo-history.ts`
remains the chart/diff-link data source (still called from the rebuilt page).

### Navigation

`components/nav.tsx`: "Clients" becomes a dropdown — "Fleet" → `/clients`,
"Manage clients" → `/clients/manage` (the nav already supports dropdowns).

## Error handling

- Services: malformed `Client.domains`/`seedUrls` JSON → `[]` (existing
  convention); every aggregate tolerates empty inputs (new client with zero
  runs renders a complete, empty dashboard).
- Pages: invalid/unknown id → `notFound()`; service throws → Next's default
  error boundary (no custom error UI in MVP).
- Timeline rows for runs whose origin was deleted simply don't exist (FKs are
  `SetNull` — orphaned `CrawlRun`s have `clientId` intact but their session/
  audit gone; rule: **timeline renders from origin rows, scores render from
  `CrawlRun`**, so an orphaned `CrawlRun` still contributes its score point
  but no timeline row. Deep links always target origin rows, so no dead
  links.)

## Testing

DB-backed vitest (repo conventions: unique domain/id prefix per file, clean up
`CrawlRun` by both origin id and test domain):

- `scorecard-shared.test.ts` (pure): series ordering + 12-cap, delta null with
  <2 points, each alert kind fires/doesn't at its threshold boundary.
- `client-fleet.test.ts`: two clients with interleaved runs group correctly;
  ADA site-vs-standalone fallback rule; missing scores → null (not 0);
  keyword-research sessions excluded from the SEO series; `error`-status runs
  excluded from series but driving the `error` alert; stale alert.
- `client-dashboard.test.ts`: timeline union ordering + cap, all six item
  types present with correct hrefs, orphaned-CrawlRun rule (score point
  without timeline row), empty client renders empty-but-valid shape.
- Component smoke tests (pattern: `RecentsTable.test.tsx`): `FleetTable`
  renders rows + em-dashes; `Scorecard` renders delta arrow direction;
  `ActivityTimeline` renders badges + links.

`tsc --noEmit`, full vitest suite, `next build` before PR.

## Alternatives considered

- **Blob-derived scores for full history** (what `/api/clients/audit-summary`
  does): richer pre-A2 sparklines, but adds new blob readers and directly
  conflicts with the A2 retention plan. Rejected.
- **API routes + client-side fetching for the dashboard**: needed only if we
  add live polling; this page is a read-only snapshot. Rejected (YAGNI).
- **Fleet table with inline CRUD** (keep editing on `/clients`): clutters the
  Monday-morning screen and mixes read/write concerns; moving the existing
  page wholesale to `/clients/manage` is near-zero risk. Chosen.
- **Denormalizing latest scores onto `Client`**: caching for a 6-query page at
  30 clients is premature. Rejected.

## Out of scope (explicit)

- Findings/action center, issue drill-downs, regression alerts (B2).
- Quarter-grid context on the dashboard (doc 04 Phase 2 — grid state is still
  in localStorage).
- Scheduled-scan management UI (C2); B1 only *displays* existing `Schedule`
  rows.
- Any write path, any schema change, any new blob reader.
