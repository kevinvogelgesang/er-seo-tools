# SEO Performance Reports — Design

**Date:** 2026-06-22 · **Status:** spec
**Author:** Claude (brainstormed with Kevin) · **Reviewed by:** Codex (2026-06-22, session `019e754d`)
**Positioning:** Delivers the **GA4 + GSC analytics half of SF-retirement Phase 6** (`nyi/2026-06-04-screaming-frog-retirement-roadmap.md`) as a reusable foundation — not a report-private integration.

> **Sequencing note (not yet decided):** This jumps the current improvement-roadmap queue. The tracker (`todos/2026-06-10-improvement-roadmap-tracker.md`) and `HANDOFF-improvement-roadmap.md` are **not** modified by this spec. If Kevin greenlights building this next, update both and label it the GA4/GSC analytics foundation for Phase 6.

## Problem

For a client-services SEO business the *report is the product*. Today each client's monthly report is produced by hand: open a single shared Looker Studio report, swap the GA4 + GSC data-source selectors to that client, set the date range, export to PDF, repeat ~32×. It does not scale, it is not reproducible, and the Looker file is a stand-in we don't want to fork 30+ times.

We want to generate the same deliverable — a branded, multi-section PDF with **period-over-period comparisons** — automatically, on a schedule we control, for every client, plus ad-hoc for any date range and any subset of clients.

## Goals

- Branded PDF per client replicating (and able to improve on) the current Looker layout, **with period-over-period deltas** as a first-class feature.
- **Scheduled monthly** generation for all active clients, on a configurable day-of-month, waiting in-app for review.
- **Ad-hoc** generation: arbitrary date range × any client selection (one / all / arbitrary combination).
- Reach all clients' GA4 + Search Console through **one Google service account** — **no per-client OAuth flow**; a one-time per-client permission grant (the SA email added to each GA4 property + GSC site) is the only per-client setup.
- Build GA4/GSC ingestion as a **shared provider layer** future keyword/pillar/SF-retirement work can consume.

## Non-goals (this spec)

- Auto-emailing reports to clients (review-then-download only; email is a later phase).
- Per-user / per-client OAuth (single server-level company connection only).
- User-consent OAuth (rejected — sensitive scopes force verification/7-day-token; service account chosen instead, §1).
- Live in-app analytics dashboard (PDF is the deliverable; a dashboard can reuse the providers later).
- The CRM "Prospects" API integration itself (framed with a manual-entry fallback — see §5.3).
- Normalizing analytics metrics into the `findings` layer (explicitly rejected — see §6).

## Scope reconciliation (what already exists and is reused)

- **C4 reporting pipeline** — `lib/report/` + `lib/jobs/handlers/report-render.ts` establish the exact rail: load data → build **pure** HTML → `acquirePage()` **late** → `setContent()` → `page.pdf()` → write under `REPORTS_DIR` (atomic tmp+rename, `lib/report/report-file.ts`) → stamp the origin row. We **mirror this pattern; we do not reuse the site-audit handler or its file helpers** (different id space, different group key).
- **Durable job queue** — `registerJobHandler({ type, concurrency, maxAttempts, timeoutMs, ... })` (`lib/jobs/registry.ts`); array-form `$transaction` only; per-type concurrency/timeout/backoff; `dedupKey`/`groupKey`; `onExhausted` hooks; 60s schedule tick.
- **Schedule system** — `monthly:<1-28>@HH:MM` cadence + `cadenceClass()` already exist (`lib/jobs/scheduler.ts`); system schedules seeded idempotently from `lib/jobs/system-schedules.ts` (reserved `system-` namespace).
- **Browser pool** — `acquirePage()`/`releasePage()`, size 4, recycling gates. Never hold a page across awaits we don't control.
- **Client model** — `Client` with `domains`, archived flag, schedule relation, ~32 active clients.
- **Auth** — cookie auth (`er_auth`, `APP_AUTH_PASSWORD`/`APP_AUTH_SECRET`), HMAC via WebCrypto in `lib/auth.ts`; middleware `PUBLIC_PATH_PREFIXES` allowlist (`middleware.ts`).
- **`REPORTS_DIR`** already wired in `ecosystem.config.js` (`${DATA_HOME}/reports`).

## Architecture overview

Four layers, bottom-up:

1. **Google service-account auth** (`lib/analytics/google/auth.ts`) — server-only `GoogleAuth` client built from `GOOGLE_SA_KEY_FILE`; no OAuth routes, no DB credential row, no token refresh.
2. **Provider layer** (`lib/analytics/`) — `GA4Provider`, `GSCProvider`, `ProspectsProvider`; each returns a typed bundle for a date range. Source-agnostic to the report. **This is the reusable foundation.**
3. **Report domain** (`lib/report/seo/`) — pure HTML + inline-SVG chart builders consuming a `SeoReportData` composed from provider bundles; a durable render job; file storage.
4. **Orchestration** — `SeoReportBatch` + `SeoReport` rows; ad-hoc + scheduled creation; review/download UI.

```
Schedule tick / ad-hoc UI
        │  creates
        ▼
  SeoReportBatch ──< SeoReport (one per client/period)
        │                 │ enqueues seo-report-render (concurrency 1)
        │                 ▼
        │           providers: GA4 + GSC + Prospects  ── PerformanceAnalyticsBundle
        │                 │ persist metricsJson
        │                 ▼
        │           lib/report/seo build HTML → setContent → page.pdf
        │                 ▼
        │           REPORTS_DIR/seo-report-<id>.pdf  + stamp generatedAt
        ▼
  batch progress = rollup of child statuses
```

## Implementation phasing (Codex-endorsed)

- **Phase 1 — foundation + single report:** service-account auth helper (`lib/analytics/google/auth.ts`, key file from env); the `lib/analytics/` provider layer (GA4 + GSC + Prospects-stub) + `PerformanceAnalyticsBundle`; `Client` mapping fields + picker; `lib/report/seo/` rendering; the `seo-report-render` job; **on-demand single-client report** generation + download; **retention sweep** (ships here — a phase that writes PDFs must sweep them). Schema migration for all models lands in Phase 1.
- **Phase 2 — batch + schedule + polish:** `SeoReportBatch`-driven multi-client ad-hoc generation; the `seo-report-monthly` non-system schedule + `seo-report-monthly-run` wrapper; `recoverSeoReports()` sweep; the `/reports` library UX (status chips, per-source badges, manual-prospects entry); Settings schedule controls.

(`SeoReportBatch` exists from Phase 1 — even a single on-demand report is created as a one-child batch, so the model is uniform.)

## 1. Auth — service account (`lib/analytics/google/`)

**Decision (2026-06-22): a Google service account, NOT user-OAuth.** Sensitive scopes (`analytics.readonly`, `webmasters.readonly`) require Google OAuth verification for any *user-consent* app in Production (and Testing mode caps refresh tokens at 7 days — fatal for an unattended monthly scheduler). A **service account** is server-to-server: no consent screen, no verification, no demo video, **no token expiry**. The trade-off is per-client onboarding (grant the SA access), which is acceptable for an internal tool.

**Mechanism:**
- A Google Cloud **service account** (in the same project, where the GA4 Data/Admin + Search Console APIs are already enabled) with a downloaded **JSON key**.
- The key lives **outside the repo** as a gitignored file; its path is in env: `GOOGLE_SA_KEY_FILE` (prod: e.g. `${DATA_HOME}/google-sa.json`; dev: a local gitignored path). No secret is committed; the key is never logged or returned to the browser.
- `lib/analytics/google/auth.ts` builds an authenticated client via `google.auth.GoogleAuth({ keyFile, scopes: [analytics.readonly, webmasters.readonly] })` and exposes `getAuthClient()` + `getServiceAccountEmail()` (read from the key for display). No DB row, no refresh-token storage, no encryption-at-rest module needed.
- **There is NO `GoogleConnection` model, no `/api/google/connect|callback` routes, no OAuth `state` nonce, and no `GOOGLE_TOKEN_ENC_KEY`** — all of that was the user-OAuth path and is dropped.

**Access grants (per client, one-time):** the service account's email is added as a **Viewer** on each client's **GA4 property** (Admin → Property Access Management) and as a user on each **Search Console site** (Settings → Users and permissions). The mapping picker (§2) only lists properties/sites the SA has actually been granted — which doubles as a live check that the grant worked.

**Connection status:** Settings shows whether the key file loads, the SA email, and a "Test connection" that calls the GA4 Admin + GSC list endpoints and reports how many properties/sites the SA can see. No "Connect" click, no reconnect banner (nothing to expire).

**Library:** `googleapis` (official) — `google.auth.GoogleAuth` for the service-account client, `google.analyticsadmin` (Admin list), `google.analyticsdata('v1beta')` (GA4 Data API `runReport`), and `google.searchconsole('v1')` (Search Console). Single new dependency; one lockfile change — coordinate only with the active `seo-roadmap-render-dedup` work.

## 2. Per-client mapping

**`Client` additions:** `ga4PropertyId String?`, `gscSiteUrl String?`, `crmClientRef String?`.

- **`gscSiteUrl` is stored verbatim and never normalized** — `sc-domain:example.com` vs `https://example.com/` are different GSC property types and the API requires the exact string. (Codex fix.)
- **Mapping picker:** a `/clients/[id]` panel calls `GET /api/google/properties` (GA4 Admin `accountSummaries.list` → property id + display name) and `GET /api/google/gsc-sites` (Search Console `sites.list`) to offer dropdowns auto-filled from **what the service account has been granted access to**; operator confirms the match per client. Domain-based pre-matching against `Client.domains` is a best-effort default selection. (A property/site missing from the list means the SA hasn't been granted access yet — the picker is the live confirmation of the §1 grant step.)
- A client with unmapped GA4/GSC is skippable: the report renders labeled gaps for the missing source (see §9).

## 3. Data model (Prisma, SQLite)

```prisma
// (No GoogleConnection model — auth is a service-account key file in env, §1.)

model SeoReportBatch {
  id              String   @id @default(cuid())
  trigger         String   // 'manual' | 'scheduled'
  scheduleId      String?  // FK → Schedule (set when trigger='scheduled')
  schedule        Schedule? @relation(fields: [scheduleId], references: [id], onDelete: SetNull) // reverse: Schedule.seoReportBatches
  scheduledFor    DateTime? // the schedule slot this run fills (null for ad-hoc) — idempotency key
  periodStart     DateTime  // all date fields are canonical UTC date-only (midnight UTC) — see §7.1
  periodEnd       DateTime
  comparisonMode  String   // 'prev_period' | 'prev_year'
  comparisonStart DateTime
  comparisonEnd   DateTime
  status          String   @default("running") // running|complete|error (rollup)
  totalReports    Int      @default(0)
  createdBy       String?  // operator name
  createdAt       DateTime @default(now())
  reports         SeoReport[]
  @@unique([scheduleId, scheduledFor]) // exactly one scheduled batch per slot (Codex fix #1)
  @@index([createdAt])
}

model SeoReport {
  id              String   @id @default(cuid())
  batchId         String
  batch           SeoReportBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  clientId        Int
  client          Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  periodStart     DateTime
  periodEnd       DateTime
  comparisonStart DateTime
  comparisonEnd   DateTime
  status          String   @default("queued") // queued|fetching|rendering|ready|error
  // per-source status so a partial fetch is recorded, not silently blank (Codex fix)
  ga4Status       String   @default("pending") // pending|ok|skipped|error
  gscStatus       String   @default("pending")
  prospectsStatus String   @default("pending") // pending|ok|manual|missing
  error           String?
  metricsJson     String?  // fetched snapshot — re-render never re-hits APIs
  // NO stored pdfPath (Codex fix #3): the PDF path is DERIVED from the id via
  // lib/report/seo/seo-report-file.ts (`seo-report-<id>.pdf` under REPORTS_DIR),
  // mirroring report-file.ts. `generatedAt` + on-disk existence are the source of truth.
  generatedAt     DateTime?
  retainUntil     DateTime?  // explicit retention (Codex fix #1 set); see §8
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([batchId, clientId]) // one report per client per batch — idempotent re-create (Codex fix #1)
  @@index([clientId])
  @@index([batchId])
  @@index([status])
  @@index([retainUntil])
}

model ProspectsEntry {
  id          String   @id @default(cuid())
  clientId    Int
  client      Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  periodStart DateTime
  periodEnd   DateTime
  total       Int
  organic     Int?
  enteredBy   String?
  enteredAt   DateTime @default(now())
  @@unique([clientId, periodStart, periodEnd])
}
```

`Client` gains relations `seoReports SeoReport[]` and `prospectsEntries ProspectsEntry[]`, plus the three mapping scalars.

**Schema migration:** hand-written SQL applied via `prisma migrate deploy` (local `migrate dev` is interactive-only, per CLAUDE.md).

## 4. Provider layer (`lib/analytics/`)

A pure, server-only seam. Each Google provider is constructed with the **service-account auth helper** (`getAuthClient()`, §1); the prospects provider with client config. Each exposes:

```ts
interface MetricWindow { start: string; end: string } // YYYY-MM-DD
type SourceResult<T> = { ok: true; data: T } | { ok: false; reason: 'unmapped' | 'auth' | 'quota' | 'error'; message?: string }
```

- **`GA4Provider.fetch(propertyId, period, comparison): Promise<SourceResult<Ga4Bundle>>`** — GA4 Data API `runReport` yielding: totals (sessions, engagedSessions, averageSessionDuration, eventsPerSession, bounceRate); sessions time series by `date`; landing pages (`landingPagePlusQueryString` × sessions, keyEvents); sessions by `city`; `newVsReturning` × sessions; `deviceCategory` × sessions.
- **`GSCProvider.fetch(siteUrl, period, comparison): Promise<SourceResult<GscBundle>>`** — Search Console `searchanalytics.query`: totals (clicks, impressions, ctr, position); series by `date`; top queries (`query` dim) with per-query position + delta vs comparison.
- **Comparison mechanics (Codex fix #9):** fetch **two calls per metric group — current window and comparison window separately** — rather than relying on GA4 `runReport`'s multi-`dateRanges` row-shaping (which complicates attribution/sorting/dimension handling). GSC is naturally two `searchanalytics.query` calls. Deltas are computed in `report-data.ts` from the two snapshots. Collapsing to dual-`dateRanges` is a later optimization, only after metric parity is proven. This roughly doubles call count (still low-hundreds for a 32-client run) — acceptable at concurrency 1.
- **`ProspectsProvider.fetch(client, period): Promise<SourceResult<{ total: number; organic: number | null }>>`** — order: (1) CRM HTTP adapter **iff** `crmClientRef` + CRM config present; (2) `ProspectsEntry` manual row for the exact window; (3) `{ ok: false, reason: 'unmapped' }`. The CRM adapter is a **stub interface** in v1 (`lib/analytics/prospects/crm-adapter.ts`) returning "not configured" until Kevin confirms feasibility/date-range/identifier/batching — swapping it in touches one file.

**`PerformanceAnalyticsBundle`** — the typed composition `{ ga4: SourceResult<Ga4Bundle>; gsc: SourceResult<GscBundle>; prospects: SourceResult<...> }` plus the windows. The report builder and (later) Phase 6 / keyword workflows consume this — **the report does not call Google directly.**

**Metric-definition parity is an explicit acceptance criterion** (Codex fix): a short `docs/` note pins each Looker scorecard to its exact GA4 Data API metric name / GSC field, validated against one real client before sign-off.

## 5. Report content (mirrors the Looker layout)

From the sample (`SEO_Report_1st_Draft.pdf`), one logical page:

| Section | Source | Notes |
|---|---|---|
| Scorecard grid (12) w/ % deltas | GA4 + GSC + Prospects | Sessions, Prospects, Organic Prospects, Avg Position (GSC), Avg session duration, Events/session, Bounce rate, Engaged sessions, Clicks, Impressions, Avg Position, Site CTR. Deltas = period vs comparison; Prospects deltas optional (CRM may not segment). |
| Sessions over time | GA4 series | current vs previous (overlaid line) |
| Avg Position / Impressions / Clicks over time | GSC series | current vs previous |
| Landing Page Sessions (table, top 10) | GA4 | landing page, sessions, key events, rate |
| GSC Queries (table, top N) | GSC | query, avg position, %Δ |
| Sessions by Location (table) | GA4 | city, sessions, key events, % of total |
| New / returning (donut) | GA4 | newVsReturning share |
| Device category (donut) | GA4 | deviceCategory share |

### 5.3 Prospects (framed, non-blocking)
"Prospects" = leads in Kevin's proprietary CRM; "Organic Prospects" = organic-attributed leads. Rendered via `ProspectsProvider` regardless of source. Until the CRM API is confirmed, the value comes from a **manual-entry field** (`/reports` library row) writing `ProspectsEntry`; absent that, the scorecards render "—" with a "needs entry" affordance. The report **never blocks** on prospects.

## 6. Rendering (`lib/report/seo/`)

Mirror the C4 decision: **template-string HTML + `page.setContent()`**, self-contained, no external assets, no Recharts in the PDF.

- `seo-report-html.ts` — `buildSeoReportHtml(data: SeoReportData): string`. Cover/header (ER wordmark, client name, domain, period + comparison label, generated date, operator), scorecard grid, charts, tables, donuts, footer (page numbers via puppeteer footer template, "data sources: GA4 / Search Console / CRM" line). Inline CSS; brand colors hard-coded to the Tailwind palette (navy/orange). **Every dynamic string HTML-escaped** via the existing `lib/report/escape.ts` helpers (client names, query text, landing-page URLs, city names — all externally controlled).
- `charts.ts` — pure inline-**SVG** builders: `lineChartSvg(series, prevSeries, opts)` (overlaid current vs previous, matching the C4 sparkline precedent) and `donutSvg(slices)`. Deterministic, unit-testable as strings.
- `report-data.ts` — `buildSeoReportData(metricsJson)`: pure transform from the persisted snapshot to view-model (no prisma, no network). Deltas, %s, top-N slicing, and "—" gap markers computed here.

**Why analytics stays a blob, not findings (Codex-confirmed):** the `findings` layer models crawl/accessibility/SEO *issues*. GA4/GSC metrics are reporting snapshots — different shape, different retention, different consumers. They live in `SeoReport.metricsJson`.

## 7. Generation flow

### 7.1 Date normalization (Codex fix #7)
All period/comparison boundaries and `ProspectsEntry` windows are **canonical UTC date-only** — midnight UTC for the start, and the spec uses **inclusive `[start, end]` day boundaries** serialized as `YYYY-MM-DD` at the provider edge (GA4/GSC both take date strings). The DB `DateTime` columns store midnight-UTC instants; a single `lib/analytics/dates.ts` owns last-full-month resolution, prev-period / prev-year comparison derivation, and the `Date → YYYY-MM-DD` formatter, so manual-prospects matching and monthly slots can't drift across timezones. (Server runs server-local for cadence wall-clock, but reporting windows are UTC-date.)

### 7.2 Client eligibility (Codex fix #8)
A client is **report-eligible** iff `archivedAt IS NULL` **and** at least one of `ga4PropertyId` / `gscSiteUrl` is set. The scheduled run includes only eligible clients. Ad-hoc generation **warns and requires explicit confirmation** before creating a report for a selected client with neither core source (avoids silently producing an all-gap PDF).

**Ad-hoc:** `POST /api/reports` `{ clientIds[] | 'all', periodStart, periodEnd, comparisonMode }` → in one array-form txn create one `SeoReportBatch` + N `SeoReport` rows (status `queued`) → enqueue N `seo-report-render` jobs → return `{ batchId }`. UI polls batch status. **Enqueue-failure handling (Codex fix #5):** if a child's enqueue throws, flip that `SeoReport` to `error` immediately; a **recovery sweep** (`recoverSeoReports()`, in `recoverQueue()` at boot + the 10-min `stale-audit-reset` tick) re-enqueues any `queued`/`fetching`/`rendering` report older than a threshold with **no active `seo-report:<id>` job** — mirroring the existing `recoverBrokenLinkVerifies()` stranded-job pattern.

**Scheduled:** **one operator-configurable, non-system `Schedule` row** named `seo-report-monthly` (Codex fix #2 — **NOT** in `SYSTEM_SCHEDULES`; no boot-time re-enable, since `system-*` is reserved for code-owned schedules). Created/updated by the Settings UI (`monthly:<day>@HH:MM`, payload `{ comparisonMode }`). Tick fires a short **idempotent wrapper job** `seo-report-monthly-run` that resolves the slot (`scheduledFor`), period (last full month) + comparison, then **upserts** one `SeoReportBatch` keyed on `@@unique([scheduleId, scheduledFor])` and one `SeoReport` per eligible client keyed on `@@unique([batchId, clientId])` (so a retry after a mid-run crash is a no-op, not a duplicate), and enqueues child renders. The wrapper does no fetching/rendering itself. Enqueue failures inside the wrapper rely on the same `recoverSeoReports()` sweep.

**`seo-report-render` job** (`lib/jobs/handlers/seo-report-render.ts`):
- `type: 'seo-report-render'`, `concurrency: 1` (raise to 2 only after quota testing — Codex), `maxAttempts: 2`, **`timeoutMs: 600_000`** (Codex fix #6 — 10 min: Google fetches + quota backoff + HTML build + PDF render share one job; the **Chrome page hold stays short** — only `setContent` + `page.pdf`), `dedupKey`/`groupKey` = `seo-report:<id>` (**never** `site-audit:<id>`).
- Steps: (1) load `SeoReport` + client mapping; if `metricsJson` already present (retry after render failure), **skip fetch**; else fetch GA4 + GSC + Prospects for period + comparison, record per-source status, persist `metricsJson` (**all network before `acquirePage()`**). (2) `buildSeoReportData` → `buildSeoReportHtml` (pure). (3) `acquirePage()` → `setContent(html, { waitUntil: 'load' })` → `page.pdf({ format: 'Letter', printBackground: true, margin ~0.4in, displayHeaderFooter })` → `releasePage()` in `finally`. (4) atomic write to the **derived** path `seoReportPath(id)` (= `REPORTS_DIR/seo-report-<id>.pdf`), stamp `generatedAt`, set `retainUntil`, status `ready`. (5) row-vanished mid-render (P2025) → delete file, settle clean.
- After each child settles, recompute the parent `SeoReportBatch.status` rollup (array-form txn).

**Single fetch+render job (Codex-endorsed) for now**, because `metricsJson` is persisted before render so retries don't refetch. Documented escalation: split into `seo-report-fetch` → `seo-report-render` if Google latency/quota proves unstable.

## 8. Retention (Codex fix — reports are NOT covered by findings blob-prune)

Report PDFs and `metricsJson` need their own sweep, registered in `runCleanup()`:
- `retainUntil` set at render: **scheduled** reports ~**24 months**; **ad-hoc** reports ~**3 months** (configurable via env, e.g. `SEO_REPORT_RETENTION_SCHEDULED_DAYS` / `_ADHOC_DAYS`).
- `pruneSeoReports()`: snapshot doomed ids → delete `SeoReport` rows past `retainUntil` (cascade removes nothing external) → best-effort unlink each derived `seoReportPath(id)` after the txn. Cancel any queued render jobs for those ids first (`cancelJobsByGroup('seo-report:<id>')`).
- **Retention ships in Phase 1, not deferred** (Codex): any phase that can write a PDF must also be able to sweep it.
- Manual `DELETE /api/reports/[id]` mirrors this (cancel jobs → delete row → unlink file).
- Empty batches (all children pruned) are removed by a follow-up pass.

## 9. Error handling & partial data

- **Per-source isolation:** a failed/unmapped GA4, GSC, or Prospects fetch sets that source's status and renders a **labeled gap** in its sections ("GA4 data unavailable for this period"); the report still produces a PDF. Only a total failure (no source produced anything) marks the `SeoReport` `error`.
- **SA key missing / invalid / access not granted:** providers return `reason: 'auth'` (bad/absent key) or `reason: 'unmapped'` (SA lacks access to that property/site); the batch completes with labeled gaps and Settings' "Test connection" surfaces a key/permission problem. No key material ever logged.
- **Google quota / 429:** provider returns `reason: 'quota'`; render job retries (attempt 2) with backoff; persistent quota → that source gaps. Concurrency 1 keeps the monthly burst gentle; revisit after measuring a real 32-client run (current + comparison ≈ a few calls each → on the order of low-hundreds of API calls per run).
- **Job discipline:** array-form `$transaction` only; `updatedAt` heartbeat; `onExhausted` is log-only and never flips client/other rows.
- **JSON.parse** of `metricsJson` wrapped in try-catch (house rule).

## 10. UI surfaces

- **`/reports`** — generate form (client multi-select incl. "All active", date-range picker, comparison toggle `prev period | prev year`) + a **report library** (rows: client, period, status chip, per-source badges, download link when `ready`; inline **manual-prospects entry** where `prospectsStatus = missing`). Batch progress banner.
- **`/clients/[id]`** — "Analytics IDs" panel (GA4 property / GSC site pickers + CRM ref) and that client's report history.
- **Settings** — Google service-account status (key loaded?, SA email, "Test connection" → counts of visible GA4 properties + GSC sites) + monthly-schedule controls (enabled, day-of-month, time, comparison mode).
- Buttons/chips match existing toolbar idiom (orange accents, dark-mode variants). New public paths: **none** (everything cookie-gated; no OAuth callback exists).

## 11. Security

- Read-only Google scopes; the service-account **JSON key lives in a gitignored file outside the repo** (`GOOGLE_SA_KEY_FILE`, e.g. `${DATA_HOME}/google-sa.json`, mode 0600); never committed, never logged, never returned to the client. Revocable anytime by deleting the key in Cloud Console or removing the SA's per-property access.
- All report/analytics/google routes cookie-gated (no share links in v1 — reports are internal-review artifacts).
- CRM adapter (when built) reads credentials from env, never persisted in `metricsJson`.

## 12. Testing

- **Pure units:** `charts.ts` (line/donut SVG with 0/1/N points, overlay), `report-data.ts` (delta math, %, top-N, gap markers), `seo-report-html.ts` (section presence/omission per source status, HTML-escaping with `<script>`/quote payloads in client name + query text), retention date math.
- **Provider tests:** GA4/GSC providers with mocked Google clients — happy path, unmapped, auth-fail, quota → correct `SourceResult`. `gscSiteUrl` passed verbatim (sc-domain vs url-prefix). Prospects provider precedence (CRM stub → manual row → missing).
- **Render handler:** mocked browser pool + tmp `REPORTS_DIR` — happy path writes file + stamps + sets `retainUntil`; metricsJson-present skips refetch; row-deleted-mid-render cleans up; `releasePage` always called; registration test includes `seo-report-render`.
- **Routes (DB-backed):** ad-hoc POST creates batch+children+jobs (deduped); batch status rollup; manual DELETE cancels jobs + deletes row + unlinks file; manual-prospects entry upserts `ProspectsEntry`.
- **Schedule:** monthly wrapper creates a batch + one report per active mapped client, idempotent per slot; archived/unmapped clients skipped.
- **Retention:** `pruneSeoReports()` deletes past-`retainUntil` rows + unlinks PDFs; scheduled vs ad-hoc windows; queued-job cancellation.
- **Auth helper:** `getAuthClient()` builds a GoogleAuth client from the key file with the right scopes; missing/invalid key file surfaces a clear error (not a crash); `getServiceAccountEmail()` reads the email from the key; key material never appears in logs or responses.

## 13. Relationship to SF-retirement Phase 6

Phase 6 ("GSC/GA4/SEMRush direct API ingestion … feeds keyword_signals and the keyword/pillar memos") is **NYI**. This spec builds the **GA4 + GSC provider foundation** Phase 6 needs (`lib/analytics/`), keyed per client via the new `Client.ga4PropertyId`/`gscSiteUrl`. Phase 6 later adds: SEMRush/DataForSEO providers, and consumption into `keyword_signals` / memos. **No collision** — this is the shared seam, not a competing one. The active `seo-roadmap-render-dedup-upload-checklist` work does not touch these files; only the dependency/lockfile addition must be coordinated.

## 14. Out of scope / open questions (framed)

- **CRM Prospects API** — feasibility, arbitrary-date-range support, per-client identifier, batching for ~32 clients. Manual entry is the v1 fallback; the adapter interface isolates the future swap.
- **Auto-email to clients** — deferred; review-then-download in v1.
- **User-consent OAuth** — rejected (2026-06-22): sensitive scopes force Google verification (justification + demo video + review) for a Production app, and Testing mode caps refresh tokens at 7 days, which would break the unattended monthly scheduler. The service account (§1) avoids both. If per-client SA grants ever become too burdensome, OAuth-with-verification is the documented alternative.
- **Public share links for reports** — out of v1 (internal-review only).
- **Metric parity doc** — pin exact GA4 Data API metric names against the Looker definitions before sign-off (acceptance criterion, §4).
