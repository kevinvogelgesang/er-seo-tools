# SEO Performance Reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate branded, multi-section PDF SEO performance reports (GA4 + Search Console + CRM "Prospects") per client — replacing the manual per-client Looker Studio export — with period-over-period comparisons, on-demand and on a monthly schedule.

**Architecture:** A reusable server-only analytics provider layer (`lib/analytics/`) reaches all clients' GA4 + GSC through one Google **service account** (granted read access per client — GA4 Property Access Management + GSC Users-and-permissions); a report domain (`lib/report/seo/`) composes provider bundles into self-contained HTML rendered to PDF via the existing C4 Chrome pipeline inside a durable `seo-report-render` job; `SeoReportBatch`/`SeoReport` rows orchestrate on-demand and scheduled generation with explicit retention.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Prisma + SQLite, the in-process durable job queue (`lib/jobs/`), the headless-Chrome browser pool (`lib/ada-audit/browser-pool.ts`), **`googleapis`** only — `google.auth.GoogleAuth` (service account) + GA4 Admin + **GA4 Data API via `google.analyticsdata('v1beta')`** + Search Console (`google.searchconsole('v1')`). Do NOT add `@google-analytics/data` (its gRPC client path is unnecessary; the REST `analyticsdata` endpoint takes the GoogleAuth client directly). Vitest.

**Spec:** `docs/superpowers/specs/2026-06-22-seo-performance-reports-design.md` (read it — this plan implements it section-for-section).

## Global Constraints

- **Node 22**, **SQLite only**, **no serverless** (RunCloud + PM2). Single in-process job worker.
- **Array-form `$transaction([...])` only** — never interactive `prisma.$transaction(async tx => …)`. Express conditional logic as SQL `EXISTS`/`WHERE`. In raw SQL set `updatedAt` manually (`Date.now()`, integer ms).
- **Browser pool discipline:** do ALL network/DB work BEFORE `acquirePage()`; hold the page only across `setContent` + `page.pdf`; `releasePage()` in `finally`.
- **Job group/dedup key for this feature is `seo-report:<seoReportId>`** — NEVER `site-audit:<id>` (that group means audit liveness to recovery).
- **Schema changes:** edit `prisma/schema.prisma`, then hand-write the migration SQL under `prisma/migrations/` (local `migrate dev` is interactive-only); production applies via `prisma migrate deploy` in the deploy command.
- **`gscSiteUrl` is stored and sent VERBATIM** — never normalize (`sc-domain:x` vs `https://x/` are different GSC properties).
- **All date windows are canonical UTC date-only** (`YYYY-MM-DD`), owned by `lib/analytics/dates.ts`.
- **Auth is a Google service account** (decided 2026-06-22 — no user-OAuth, no consent screen, no token expiry). The JSON key lives in a **gitignored file outside the repo**; its path is in `GOOGLE_SA_KEY_FILE`. Never commit or log key material.
- **No new public middleware paths** — everything cookie-gated (no OAuth callback exists in the service-account model). (The pre-existing public `/privacy` + `/about` + Google verification file shipped separately.)
- **Do NOT add Claude/Anthropic AI features** (separate billing, out of scope).
- Tests: Vitest. Pure modules get unit tests; DB-backed routes/jobs use the existing test DB patterns; Google clients are mocked (`vi.mock('googleapis', …)`). **DB-backed tests (Codex):** every new test file uses a unique client-name prefix and cleans up `SeoReport`, `SeoReportBatch`, `ProspectsEntry`, `Job`, and `Schedule` rows in `afterEach`. **Middleware does not run in unit tests** — call route handlers directly.

---

## File Structure

**Phase 1 — foundation + single report:**
- `package.json` (modify) — add `googleapis`.
- `prisma/schema.prisma` (modify) + `prisma/migrations/<ts>_seo_reports/migration.sql` (create) — all models + `Client` fields.
- `lib/analytics/dates.ts` (create) — UTC date-only window math.
- `lib/analytics/google/auth.ts` (create) — builds a `google.auth.GoogleAuth` service-account client from the key file (`GOOGLE_SA_KEY_FILE`) with the read-only scopes; `getAuthClient()` + `getServiceAccountEmail()`. No DB, no OAuth routes, no token encryption. (User-OAuth's `connection.ts`/`crypto.ts`/`oauth-state.ts`/connect+callback routes are NOT built — see dropped Tasks 3 & 6.)
- `app/api/google/properties/route.ts`, `app/api/google/gsc-sites/route.ts` (create) — mapping picker data.
- `lib/analytics/types.ts` (create) — `MetricWindow`, `SourceResult<T>`, `Ga4Bundle`, `GscBundle`, `ProspectsBundle`, `PerformanceAnalyticsBundle`.
- `lib/analytics/google/ga4-provider.ts`, `lib/analytics/google/gsc-provider.ts` (create).
- `lib/analytics/prospects/crm-adapter.ts`, `lib/analytics/prospects/prospects-provider.ts` (create).
- `lib/report/seo/report-data.ts` (create) — pure snapshot → view-model + deltas.
- `lib/report/seo/charts.ts` (create) — inline-SVG line + donut builders.
- `lib/report/seo/seo-report-html.ts` (create) — pure HTML builder (reuses `lib/report/escape.ts`).
- `lib/report/seo/seo-report-file.ts` (create) — derived PDF path + atomic write/delete (mirrors `lib/report/report-file.ts`).
- `lib/jobs/handlers/seo-report-render.ts` (create) — durable render job; **register its handler in `lib/jobs/handlers/register.ts` (`registerBuiltInJobHandlers()`)** — the single centralized registration site called by instrumentation + the worker (Codex-confirmed).
- `lib/services/seo-reports.ts` (create) — create-batch/create-report helpers (shared by routes + wrapper).
- `app/api/reports/[id]/route.ts` (create) — GET status, GET `?file=1` stream, DELETE.
- `app/api/clients/[id]/analytics/route.ts` (create) — GET/PATCH client mapping.
- `app/reports/page.tsx` + components (create) — minimal generate-one + download (expanded in Phase 2).
- `app/clients/[id]/...` (modify) — Analytics IDs panel.
- `app/settings/...` (create/modify) — Google service-account status + "Test connection".
- `lib/seo-report-retention.ts` (create) — `pruneSeoReports()`; register in `runCleanup()` (`lib/cleanup.ts`).

**Phase 2 — batch + schedule + polish:**
- `app/api/reports/route.ts` (create) — POST ad-hoc batch + GET list.
- `app/api/reports/batch/[id]/route.ts` (create) — batch status rollup.
- `lib/jobs/handlers/seo-report-monthly-run.ts` (create) — scheduled wrapper.
- `app/api/reports/[id]/prospects/route.ts` (create) — manual-entry route.
- `lib/seo-report-recovery.ts` (create) — `recoverSeoReports()` (global stranded-job recovery); wired into `recoverQueue()` (boot, after broken-link recovery) + `lib/jobs/handlers/stale-audit-reset.ts` (10-min tick) via dynamic import — **not** ADA-specific despite the host file's name.
- `app/reports/...` (modify) — full library UI; `app/settings/...` schedule controls.
- `app/api/reports/schedule/route.ts` (create) — get/set the `seo-report-monthly` Schedule (NOT under `/api/google` — it's a reports concern, Codex fix #12).

---

# PHASE 1 — Foundation + single on-demand report + retention

### Task 0: Add the `googleapis` dependency (Codex fix #1)

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: `googleapis` available to import in server-only modules (Tasks 5–8, 17).

- [ ] **Step 1:** `npm install googleapis` (RunCloud uses `npm install`, never `npm ci`). Do **not** add `@google-analytics/data` (Codex fix #4 — GA4 Data API is reached via `google.analyticsdata('v1beta')` in `googleapis`).
- [ ] **Step 2:** Verify `googleapis` is server-only — it must only be imported from `lib/analytics/**` and `app/api/**` (never a client component); add an `import 'server-only'` guard to `lib/analytics/google/auth.ts` when created.
- [ ] **Step 3:** `npx tsc --noEmit` → PASS; `npm run build` → PASS (confirms no client-bundle leak).
- [ ] **Step 4: Commit** `git add package.json package-lock.json && git commit -m "chore(reports): add googleapis dependency"`

---

### Task 1: Schema — models + Client mapping fields

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_seo_reports/migration.sql`

**Interfaces:**
- Produces: Prisma models `SeoReportBatch`, `SeoReport`, `ProspectsEntry` (NO `GoogleConnection` — auth is a service-account key file, not a DB row); `Client.ga4PropertyId/gscSiteUrl/crmClientRef` + relations `seoReports`, `prospectsEntries`.

- [ ] **Step 1:** Add to `prisma/schema.prisma` the **three** models exactly as in spec §3 (including `SeoReportBatch.scheduledFor` + `@@unique([scheduleId, scheduledFor])`, `SeoReport @@unique([batchId, clientId])`, the per-source status fields, `retainUntil`, and NO `pdfPath`). Add to `model Client`: `ga4PropertyId String?`, `gscSiteUrl String?`, `crmClientRef String?`, `seoReports SeoReport[]`, `prospectsEntries ProspectsEntry[]`. **Make `SeoReportBatch.scheduleId` a real relation (Codex fix #14, mirroring scheduled site audits):** add `schedule Schedule? @relation(fields: [scheduleId], references: [id], onDelete: SetNull)` and the reverse `seoReportBatches SeoReportBatch[]` on `model Schedule`.
- [ ] **Step 2:** Generate the client and hand-write SQL. Run: `npx prisma generate` and confirm types compile. Hand-write `migration.sql` with `CREATE TABLE` for the **three** tables (matching SQLite column types Prisma expects: `DATETIME`, `TEXT`, `INTEGER`), the two unique indexes, the `@@index` indexes, and `ALTER TABLE Client ADD COLUMN` ×3. Model after an existing migration file's style.
- [ ] **Step 3:** Apply locally against a scratch DB: `DATABASE_URL="file:./dev-scratch.db" npx prisma migrate deploy` (or apply the SQL directly) and verify no error.
- [ ] **Step 4:** Run `npx tsc --noEmit` — expect PASS (new Prisma types resolve).
- [ ] **Step 5: Commit** `git add prisma/ && git commit -m "feat(reports): schema for SEO performance reports"`

---

### Task 2: `lib/analytics/dates.ts` — UTC date-only window math

**Files:**
- Create: `lib/analytics/dates.ts`
- Test: `lib/analytics/dates.test.ts`

**Interfaces:**
- Produces:
  - `type DateWindow = { start: Date; end: Date }` (midnight-UTC instants, inclusive days)
  - `formatYmd(d: Date): string` → `YYYY-MM-DD` (UTC)
  - `lastFullMonth(now: Date): DateWindow`
  - `comparisonWindow(period: DateWindow, mode: 'prev_period' | 'prev_year'): DateWindow`
  - `dayCount(w: DateWindow): number`

- [ ] **Step 1: Write failing tests** in `dates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatYmd, lastFullMonth, comparisonWindow, dayCount } from './dates'

const utc = (s: string) => new Date(s + 'T00:00:00.000Z')

describe('dates', () => {
  it('formats UTC ymd regardless of local tz', () => {
    expect(formatYmd(new Date('2026-05-31T23:30:00.000Z'))).toBe('2026-05-31')
  })
  it('lastFullMonth returns the prior calendar month inclusive', () => {
    const w = lastFullMonth(new Date('2026-06-22T10:00:00.000Z'))
    expect(formatYmd(w.start)).toBe('2026-05-01')
    expect(formatYmd(w.end)).toBe('2026-05-31')
  })
  it('prev_period mirrors length immediately before', () => {
    const period = { start: utc('2026-05-01'), end: utc('2026-05-31') } // 31 days
    const c = comparisonWindow(period, 'prev_period')
    expect(formatYmd(c.start)).toBe('2026-03-31')
    expect(formatYmd(c.end)).toBe('2026-04-30')
    expect(dayCount(c)).toBe(31)
  })
  it('prev_year shifts back one year', () => {
    const period = { start: utc('2026-05-01'), end: utc('2026-05-31') }
    const c = comparisonWindow(period, 'prev_year')
    expect(formatYmd(c.start)).toBe('2025-05-01')
    expect(formatYmd(c.end)).toBe('2025-05-31')
  })
})
```

- [ ] **Step 2:** Run `npx vitest run lib/analytics/dates.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `dates.ts` using only `Date.UTC`/`getUTC*` (no local-tz APIs). `dayCount = round((end-start)/86400000)+1`. `prev_period`: `newEnd = start - 1 day`, `newStart = newEnd - (dayCount-1) days`. `prev_year`: subtract 1 from `getUTCFullYear()` on both ends.
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): UTC date-window math"`

---

### Task 3: ~~refresh-token encryption~~ — REMOVED (service-account decision, 2026-06-22)

**Not built.** The service account uses a key file in env, not a DB-stored refresh token, so there is no secret to encrypt at rest. (`GOOGLE_TOKEN_ENC_KEY` is gone.) Task number retained so later task references stay stable. Skip to Task 4.

---

### Task 4: `lib/analytics/types.ts` — provider contracts

**Files:**
- Create: `lib/analytics/types.ts`

**Interfaces:**
- Produces: `MetricWindow = { start: string; end: string }`; `SourceResult<T> = { ok: true; data: T } | { ok: false; reason: 'unmapped'|'auth'|'quota'|'error'; message?: string }`; `Ga4Bundle`, `GscBundle`, `ProspectsBundle` (shapes below); `PerformanceAnalyticsBundle = { period: MetricWindow; comparison: MetricWindow; ga4: SourceResult<Ga4Bundle>; gsc: SourceResult<GscBundle>; prospects: SourceResult<ProspectsBundle> }`.

- [ ] **Step 1: Write** `types.ts`. `Ga4Bundle`:
```ts
export interface Ga4Totals { sessions: number; engagedSessions: number; averageSessionDuration: number; eventsPerSession: number; bounceRate: number; keyEvents: number }
export interface Ga4Bundle {
  totals: Ga4Totals; comparisonTotals: Ga4Totals
  sessionsSeries: { date: string; value: number }[]
  sessionsSeriesPrev: { date: string; value: number }[]
  landingPages: { path: string; sessions: number; keyEvents: number }[]
  cities: { city: string; sessions: number; keyEvents: number }[]
  newVsReturning: { label: string; sessions: number }[]
  devices: { label: string; sessions: number }[]
}
```
`GscTotals { clicks; impressions; ctr; position }`; `GscBundle { totals; comparisonTotals; clicksSeries; clicksSeriesPrev; impressionsSeries; impressionsSeriesPrev; positionSeries; positionSeriesPrev; queries: { query; position; positionPrev: number|null }[] }` (series same shape as GA4). `ProspectsBundle { total: number; organic: number | null }`.
- [ ] **Step 2:** Run `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Commit** `git commit -am "feat(reports): analytics provider types"`

---

### Task 5: `lib/analytics/google/auth.ts` — service-account client

**Files:**
- Create: `lib/analytics/google/auth.ts`
- Test: `lib/analytics/google/auth.test.ts`

**Interfaces:**
- Consumes: `googleapis` (`google.auth.GoogleAuth`); `process.env.GOOGLE_SA_KEY_FILE`.
- Produces:
  - `getAuthClient(): Promise<{ ok: true; auth: GoogleAuth } | { ok: false; reason: 'auth'; message: string }>` — builds `new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_SA_KEY_FILE, scopes: ['https://www.googleapis.com/auth/analytics.readonly','https://www.googleapis.com/auth/webmasters.readonly'] })`; returns `{ok:false,reason:'auth'}` (not a throw) when the env var is unset or the file is missing/invalid.
  - `getServiceAccountEmail(): Promise<string | null>` — reads `client_email` from the key file (for Settings display + the "grant this email access" hint). **Returns `null` if the JSON parses but has no `client_email`** (Codex guard). Never logs the private key.
  - **Guard (Codex):** `getAuthClient()` returns `{ok:false,reason:'auth'}` when the file is missing, unparseable, **or lacks key material** (no `private_key`/`client_email`) — a malformed key degrades to a labeled gap, never a crash.
- The auth client is passed to the GA4/GSC providers (Tasks 7–8) as `auth`.

- [ ] **Step 1: Write failing tests** (point `GOOGLE_SA_KEY_FILE` at a fixture JSON written to a tmp dir; `vi.mock('googleapis')` so `google.auth.GoogleAuth` is a spy): `getAuthClient` returns `{ok:true}` with the scopes passed through when the key file exists; returns `{ok:false,reason:'auth'}` when the env var is unset and when the file path doesn't exist; `getServiceAccountEmail` returns the fixture's `client_email`; neither logs the `private_key`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** with `google.auth.GoogleAuth` + `import 'server-only'`. Read/parse the key file with `fs/promises` (wrap `JSON.parse` in try/catch). No DB, no token storage.
- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): Google service-account auth client"`

---

### Task 6: ~~OAuth state nonce + connect/callback routes~~ — REMOVED (service-account decision, 2026-06-22)

**Not built.** Service accounts need no user-consent flow, so there is no `/api/google/connect|callback`, no OAuth `state` nonce, and no `lib/auth.ts` HMAC-helper extraction. Task number retained so later references stay stable. Skip to Task 7. (Settings instead shows SA status + a "Test connection" — Task 19.)

---

### Task 7: `GA4Provider`

**Files:**
- Create: `lib/analytics/google/ga4-provider.ts`
- Test: `lib/analytics/google/ga4-provider.test.ts`

**Interfaces:**
- Consumes: `getAuthClient` (Task 5); `types.ts` (Task 4); `dates.formatYmd`.
- Produces: `fetchGa4(propertyId: string | null, period: DateWindow, comparison: DateWindow): Promise<SourceResult<Ga4Bundle>>`.

- [ ] **Step 1: Write failing tests** by mocking the `googleapis` `google.analyticsdata` factory (`vi.mock('googleapis', …)`) so `analyticsData.properties.runReport` is a spy: returns `{ ok:false, reason:'unmapped' }` when `propertyId` is null; maps a mocked `runReport` response into `Ga4Bundle` (assert one totals field, one series point, one landing-page row); maps a thrown `403/quota` to `reason:'quota'` and a generic throw to `reason:'error'`; **two separate date-range groups** are issued for period vs comparison (assert call count).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement (Codex fix #4 — pinned construction).** Use `googleapis`, not `@google-analytics/data`:
```ts
import { google } from 'googleapis'
const a = await getAuthClient()        // service-account client from auth.ts (Task 5)
if (!a.ok) return a                    // { ok:false, reason:'auth' } — propagates as a gap
const analyticsData = google.analyticsdata({ version: 'v1beta', auth: a.auth })
const res = await analyticsData.properties.runReport({
  property: `properties/${propertyId}`,
  requestBody: { dateRanges: [{ startDate: formatYmd(w.start), endDate: formatYmd(w.end) }], metrics: [...], dimensions: [...] },
})
```
Issue one `runReport` per metric group, once for the current window then once for the comparison window (single `dateRanges` entry each — Codex fix #9): (a) totals metrics, (b) sessions by `date`, (c) `landingPagePlusQueryString`, (d) `city`, (e) `newVsReturning`, (f) `deviceCategory`. Metric names pinned per spec §4 (`sessions`, `engagedSessions`, `averageSessionDuration`, `eventsPerSession`, `bounceRate`, `keyEvents`). **Error taxonomy (Codex auth-review fix — `401/403→auth` is too blunt for a service account):** `getAuthClient()` failure / missing-or-invalid key → `auth`; API **`401`** → `auth`; **`403` because the SA lacks access to *this* property** (PERMISSION_DENIED) → **`unmapped`** (a per-property access gap, NOT a global auth failure — a valid SA with no access to one client must render that client's gap, not fail everything); `429`/`RESOURCE_EXHAUSTED` (even when carried on a 403) → `quota`; everything else → `error`. `eventsPerSession` — request directly if available, else derive `eventCount/sessions`.
- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): GA4 data provider"`

---

### Task 8: `GSCProvider`

**Files:**
- Create: `lib/analytics/google/gsc-provider.ts`
- Test: `lib/analytics/google/gsc-provider.test.ts`

**Interfaces:**
- Consumes: `getAuthClient` (Task 5); `types.ts`; `dates.formatYmd`.
- Produces: `fetchGsc(siteUrl: string | null, period: DateWindow, comparison: DateWindow): Promise<SourceResult<GscBundle>>`.

- [ ] **Step 1: Write failing tests** with `google.searchconsole('v1').searchanalytics.query` mocked: null `siteUrl` → `unmapped`; maps totals + a `date`-dimension series + `query`-dimension rows; **`siteUrl` passed verbatim** (assert the mock received `sc-domain:example.com` unchanged); error taxonomy **same as GA4 (Codex)** — `401`/auth-client-fail → `auth`, **`403` SA-not-a-user-of-this-site → `unmapped`** (per-site gap, not global), `429`/quota → `quota`, else `error`; period + comparison = separate queries.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Build the client from the SA auth: `const a = await getAuthClient(); if (!a.ok) return a; const sc = google.searchconsole({ version: 'v1', auth: a.auth })`. For each of period/comparison: one totals query (no dimensions), one `dimensions:['date']` query (series), and one `dimensions:['query']` query (top queries, `rowLimit` ~25). Pass `siteUrl` to `sc.searchanalytics.query({ siteUrl, requestBody: {...} })` **verbatim**. Compute `ctr`/`position` from the API fields. Build `queries[].positionPrev` by matching query strings across the two `query`-dimension result sets.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): Search Console provider"`

---

### Task 9: `ProspectsProvider` + CRM stub

**Files:**
- Create: `lib/analytics/prospects/crm-adapter.ts`, `lib/analytics/prospects/prospects-provider.ts`
- Test: `lib/analytics/prospects/prospects-provider.test.ts`

**Interfaces:**
- Consumes: `prisma` (for `ProspectsEntry`); `types.ts`.
- Produces: `fetchProspects(client: { id: number; crmClientRef: string | null }, period: DateWindow): Promise<SourceResult<ProspectsBundle>>`; `crmAdapter.fetch(ref, period): Promise<SourceResult<ProspectsBundle>>` (stub → `{ok:false, reason:'unmapped', message:'CRM adapter not configured'}`).

- [ ] **Step 1: Write failing tests:** CRM stub returns not-configured; when a `ProspectsEntry` exists for the exact window, provider returns `{ok:true, data:{total, organic}}`; with no CRM + no entry → `{ok:false, reason:'unmapped'}`; CRM success short-circuits the manual lookup.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** the precedence: try `crmAdapter.fetch` iff `crmClientRef` set and `process.env.CRM_API_BASE` present → on `ok` return it; else `prisma.prospectsEntry.findUnique({ where: { clientId_periodStart_periodEnd: {...} } })` → map; else `unmapped`. The CRM adapter body is a documented stub.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): prospects provider with CRM stub + manual fallback"`

---

### Task 10: `lib/report/seo/report-data.ts` — snapshot → view-model

**Files:**
- Create: `lib/report/seo/report-data.ts`
- Test: `lib/report/seo/report-data.test.ts`

**Interfaces:**
- Consumes: `PerformanceAnalyticsBundle` (Task 4).
- Produces: `buildSeoReportData(bundle: PerformanceAnalyticsBundle, meta: { clientName: string; domain: string; periodLabel: string; comparisonLabel: string; generatedAt: string; operator: string | null }): SeoReportData`. `SeoReportData` carries: header meta; `scorecards: { label: string; value: string; delta: number | null; deltaGood: boolean | null }[]`; chart series pairs; table rows; donut slices; and `gaps: { ga4: boolean; gsc: boolean; prospects: boolean }`.

- [ ] **Step 1: Write failing tests:** delta math (`(cur-prev)/prev`), `deltaGood` polarity (bounce-rate/position lower-is-better → good when negative; sessions/clicks higher-is-better), value formatting (duration `mm:ss`, percentages, thousands separators), top-N slicing (landing pages 10, queries/ cities as spec), and gap flags set when a `SourceResult` is `ok:false` (scorecards for that source render `'—'`, `delta:null`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** as a pure function — no prisma, no network, no `Date.now()` (take `generatedAt` as input). Use the spec §5 scorecard list and source mapping.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): report view-model + delta math"`

---

### Task 11: `lib/report/seo/charts.ts` — inline-SVG builders

**Files:**
- Create: `lib/report/seo/charts.ts`
- Test: `lib/report/seo/charts.test.ts`

**Interfaces:**
- Produces: `lineChartSvg(current: number[], previous: number[], opts: { width: number; height: number; color: string }): string`; `donutSvg(slices: { label: string; value: number; color: string }[], opts): string`. Pure strings, deterministic.

- [ ] **Step 1: Write failing tests:** 0 points → renders an empty chart frame (no NaN in path `d`); 1 point → single dot, no crash; N points → a `<path>` with the right number of `L` commands and two series; donut slices sum to a full circle (assert path count = slice count) and 0-total renders a neutral ring. Assert no `NaN`/`Infinity` substring in output.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** with manual SVG path math (scale to min/max, guard divide-by-zero), matching the C4 sparkline approach in `lib/report/report-html.ts`. No external libs.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): inline SVG chart builders"`

---

### Task 12: `lib/report/seo/seo-report-html.ts` — HTML builder

**Files:**
- Create: `lib/report/seo/seo-report-html.ts`
- Test: `lib/report/seo/seo-report-html.test.ts`

**Interfaces:**
- Consumes: `SeoReportData` (Task 10), `charts.ts` (Task 11), `lib/report/escape.ts` (`escapeHtml`/`escapeAttr`).
- Produces: `buildSeoReportHtml(data: SeoReportData): string` — a full self-contained HTML doc (inline CSS, brand colors, ER wordmark).

- [ ] **Step 1: Write failing tests:** output contains the client name (escaped — feed `"<script>alert(1)</script>"` as the client name and assert no raw `<script>` survives); a gap source renders its labeled "unavailable" block and omits its charts; all 12 scorecards present with values; tables/donuts present; deltas render with sign + arrow class.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** the section layout from spec §5/§6; every dynamic string through `escapeHtml`/`escapeAttr`; charts via Task 11; print CSS (Letter, `@page`), navy/orange palette hard-coded.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): branded SEO report HTML builder"`

---

### Task 13: `lib/report/seo/seo-report-file.ts` — derived PDF path

**Files:**
- Create: `lib/report/seo/seo-report-file.ts`
- Test: `lib/report/seo/seo-report-file.test.ts`

**Interfaces:**
- Produces: `seoReportPath(id: string): string` (= `REPORTS_DIR/seo-report-<id>.pdf`), `writeSeoReportFile(id, buf)`, `deleteSeoReportFile(id)`, `seoReportFileExists(id)`. Mirrors `lib/report/report-file.ts`; id is validated to `[A-Za-z0-9_-]+` to prevent traversal.

- [ ] **Step 1: Write failing tests** (tmp `REPORTS_DIR`): write→exists→delete→not-exists round trip; a malicious id (`../../etc`) throws.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** mirroring `report-file.ts` (atomic tmp+rename, ENOENT-tolerant delete) + the id guard.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): derived report file storage"`

---

### Task 14: `lib/services/seo-reports.ts` — batch/report creation helper

**Files:**
- Create: `lib/services/seo-reports.ts`
- Test: `lib/services/seo-reports.test.ts`

**Interfaces:**
- Consumes: `prisma`, `dates.ts`.
- Produces:
  - `isClientEligible(c: { archivedAt: Date|null; ga4PropertyId: string|null; gscSiteUrl: string|null }): boolean`
  - `createBatchWithReports(input: { trigger:'manual'|'scheduled'; scheduleId?: string; scheduledFor?: Date; clientIds: number[]; period: DateWindow; comparisonMode: 'prev_period'|'prev_year'; createdBy?: string|null }): Promise<{ batchId: string; reportIds: string[] }>` — idempotent on `@@unique([scheduleId, scheduledFor])` + `@@unique([batchId, clientId])`.

- [ ] **Step 1: Write failing tests** (DB-backed; use a unique client-name prefix per test file + clean up `SeoReport`/`SeoReportBatch`/`Client` in `afterEach`): creates a batch + one report per client id and returns all `reportIds`; eligibility rule (`archivedAt null AND (ga4 OR gsc)`); a second scheduled call with the same `(scheduleId, scheduledFor)` does NOT duplicate (returns the existing batch + its existing report ids).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement (Codex fixes #5/#6/#7 — NOT one transaction, NO `createMany`/`skipDuplicates`; both are unsupported/insufficient on SQLite, see `lib/jobs/handlers/site-audit-discover.ts`).** Compute comparison via `comparisonWindow`. Then:
  1. Try `prisma.seoReportBatch.create(...)`; on **P2002** (scheduled slot already exists) fetch the existing batch via `where: { scheduleId_scheduledFor: { scheduleId, scheduledFor } }`.
  2. For each clientId, `prisma.seoReport.create(...)` **individually** wrapped in a try/catch that swallows **P2002** (`@@unique([batchId, clientId])`) — on conflict fetch the existing row. Collect every report id (created or pre-existing).
  3. Return `{ batchId, reportIds }`. (N≈32 individual inserts is fine; this also yields the ids `createMany` cannot.)
  Enqueue is done by the CALLER (routes/wrapper), not here.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): batch/report creation service"`

---

### Task 15: `seo-report-render` job handler

**Files:**
- Create: `lib/jobs/handlers/seo-report-render.ts`
- Test: `lib/jobs/handlers/seo-report-render.test.ts`
- Modify: wherever handlers are registered at startup (follow `report-render.ts`'s registration site).

**Interfaces:**
- Consumes: providers (Tasks 7–9), `report-data`/`html`/`file` (10–13), the browser pool (`acquirePage`/`releasePage`), `prisma`. (Auth is internal to the providers via `getAuthClient`.)
- Produces: registered job `type:'seo-report-render'`, `enqueueSeoReportRender(seoReportId)`; constant `SEO_REPORT_RENDER_JOB_TYPE`.

- [ ] **Step 1: Write failing tests** (mocked browser pool + providers + tmp REPORTS_DIR): happy path fetches, persists `metricsJson`, writes the file at `seoReportPath(id)`, stamps `generatedAt`, sets `retainUntil`, status `ready`; **`metricsJson` already present → providers NOT called** (refetch skipped); per-source error sets `ga4Status='error'` but still renders + `ready`; row deleted mid-render → file cleaned, settles without throw; `releasePage` always called (assert via finally spy); registry includes the type.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** per spec §7 render job: `concurrency:1`, `maxAttempts:2`, `timeoutMs:600_000`, dedup/group `seo-report:<id>`. ALL fetch/build before `acquirePage()`. `retainUntil` from env (`SEO_REPORT_RETENTION_SCHEDULED_DAYS` default 730 / `_ADHOC_DAYS` default 90) keyed on `batch.trigger`. Register the handler in `lib/jobs/handlers/register.ts`. **Snapshot rule (Codex fix #8):** "skip fetch when `metricsJson` present" is a *retry* optimization — any input change (e.g. a manual prospects entry, Task 24) MUST null `metricsJson` so the next render refetches. Document this invariant in the handler header.
- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): durable seo-report-render job"`

---

### Task 16: Report status/stream/delete route + on-demand single generate

**Files:**
- Create: `app/api/reports/route.ts` (**`POST` generate** — built here with single-client support, extended to multi-client/`'all'` in Task 21; Codex fix #9 — no temporary route)
- Create: `app/api/reports/[id]/route.ts` (GET status, `GET ?file=1` stream, DELETE)

**Interfaces:**
- Consumes: `createBatchWithReports` (14), `enqueueSeoReportRender` (15), `seoReportFileExists`/`seoReportPath`.

- [ ] **Step 1: Write failing tests** (DB-backed; call the route handlers directly — middleware does not run in tests): `POST /api/reports` with one client id creates batch+report+job, returns `{ batchId, reportIds }`; GET status returns `{ status, ga4Status, gscStatus, prospectsStatus, generatedAt }`; `GET ?file=1` 404s before render and streams `application/pdf` with `Content-Disposition` after a file exists; **enqueue failure flips that report to `error`**; DELETE cancels jobs (`cancelJobsByGroup('seo-report:<id>')`), deletes the row, unlinks the file.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Routes are **middleware cookie-gated** (Codex fix #10 — `middleware.ts` matcher covers `/api/:path*`; there is no per-route auth helper to reuse — if route-local defense is wanted, call `isValidAuthCookie` from `lib/auth.ts` explicitly). Enqueue each created report; on enqueue throw set that `SeoReport.status='error'`. Stream via `seoReportPath` + `seoReportFileExists`. Wrap `JSON.parse(metricsJson)` in try/catch.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): report status/stream/delete + single-client generate"`

---

### Task 17: Client Analytics-IDs mapping API + picker data

**Files:**
- Create: `app/api/clients/[id]/analytics/route.ts` (GET current mapping, PATCH set `ga4PropertyId`/`gscSiteUrl`/`crmClientRef`)
- Create: `app/api/google/properties/route.ts`, `app/api/google/gsc-sites/route.ts`

**Interfaces:**
- Consumes: `getAuthClient` (Task 5), `googleapis` (GA4 Admin `accountSummaries.list`, Search Console `sites.list`).

- [ ] **Step 1: Write failing tests** (mock Google): `properties` returns `[{ propertyId, displayName }]`; `gsc-sites` returns `[{ siteUrl }]` verbatim (incl. `sc-domain:`); PATCH persists the three fields and **does not normalize** `gscSiteUrl`; both 503 when `getAuthClient` returns `{ok:false}` (SA key missing/invalid). The lists reflect only what the SA has been granted.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** (cookie-gated). PATCH validates types only; stores raw.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): client analytics mapping + Google picker APIs"`

---

### Task 18: Retention sweep

**Files:**
- Create: `lib/seo-report-retention.ts`
- Test: `lib/seo-report-retention.test.ts`
- Modify: `lib/cleanup.ts` (register `pruneSeoReports()` in `runCleanup()`)

**Interfaces:**
- Produces: `pruneSeoReports(now?: Date): Promise<{ deleted: number }>`.

- [ ] **Step 1: Write failing tests** (DB + tmp REPORTS_DIR): a report past `retainUntil` is deleted and its PDF unlinked; a future-`retainUntil` report is kept; queued render jobs for doomed ids are cancelled first; empty batches removed.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** per spec §8 (snapshot ids → `cancelJobsByGroup` → array-form `deleteMany` → best-effort unlink). Register in `runCleanup()` next to existing prune calls.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): report retention sweep"`

---

### Task 19: Settings — Google service-account status; minimal `/reports` generate+download UI

**Files:**
- Create: `app/settings/page.tsx` (NEW route — does not exist yet; + a `ConnectGoogleCard` client component)
- Create: `app/reports/page.tsx` (+ a minimal `GenerateOneForm` + report row with poll-to-download)
- Modify: `app/clients/[id]/page.tsx` (+ `AnalyticsIdsPanel` client component)
- Modify: the nav/home tool surface (the `Nav` component + the `/` home tool grid) — add **"SEO Reports"** (`/reports`) and **"Settings"** (`/settings`) entries (Codex fix #13 — otherwise both new routes are unreachable). Match the existing tool-card/nav idiom.

- [ ] **Step 0:** Add the `/reports` and `/settings` links to the Nav + home tool grid (find the existing tool list — the same place `/seo-parser`, `/ada-audit`, `/clients` are registered).
- [ ] **Step 1:** Build `ServiceAccountCard` + `GET /api/google/status` (calls `getServiceAccountEmail` + a lightweight `getAuthClient` check; optionally a "Test connection" that calls the GA4 Admin + GSC list endpoints and returns counts): shows whether the key file loads, the SA email, the count of GA4 properties / GSC sites it can see, and a copy-able hint when counts are 0 — copy (Codex fix): **"Grant this service-account email access in GA4 → Property Access Management and Search Console → Users and permissions"** (do NOT say "Viewer" for GSC — GSC uses its own Full/Restricted model). No "Connect" button (nothing to connect — the key is in env).
- [ ] **Step 2:** Build `AnalyticsIdsPanel`: GA4 + GSC dropdowns populated from the picker APIs (Task 17) **with a manual-text fallback that is a HARD requirement, not just convenience** (Codex — GA4 Admin listing can be narrow/incomplete when access is granted per-property; the operator must always be able to type a `ga4PropertyId`/`gscSiteUrl` directly), CRM ref text field, save via PATCH.
- [ ] **Step 3:** Build minimal `/reports`: a single-client picker + date-range + comparison toggle → POST generate (Task 16) → poll status → show Download when `ready`. (Full library is Phase 2.)
- [ ] **Step 4:** Manual smoke: with the SA key file at the local `GOOGLE_SA_KEY_FILE` path and the SA granted access to ≥1 client's GA4 + GSC, map that client, generate one report, download the PDF, eyeball against `SEO_Report_1st_Draft.pdf`. Run `npm run build`.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): settings connect-google + client mapping + minimal report UI"`

---

### Task 20: Phase 1 integration gate

- [ ] **Step 1:** `npx tsc --noEmit` → PASS. `npx vitest run` → all green.
- [ ] **Step 2:** `npm run build` → PASS.
- [ ] **Step 3:** Metric-parity check (spec acceptance criterion): generate a report for one real client for last month; compare each scorecard + chart against the live Looker report for the same window; record any GA4 metric-name mismatches and fix the provider. Write findings to `docs/seo-report-metric-parity.md`.
- [ ] **Step 4: Commit** any parity fixes `git commit -am "fix(reports): GA4/GSC metric parity with Looker"`

---

# PHASE 2 — Batch + schedule + library polish

### Task 21: Ad-hoc batch POST + list

**Files:**
- Modify: `app/api/reports/route.ts` (extend the Phase-1 `POST` to accept multi-client/`'all'` + add `GET` list with filters — Codex fix #9, same file, not a new one)
- Create: `app/api/reports/batch/[id]/route.ts` (rollup status)

**Interfaces:**
- Consumes: `createBatchWithReports` (14), `enqueueSeoReportRender` (15), `isClientEligible`.

- [ ] **Step 1: Write failing tests:** POST `{ clientIds:'all' | number[], periodStart, periodEnd, comparisonMode }` creates one batch + N reports + N jobs; ineligible clients (no GA4/GSC) require `confirm:true` else 422 with the list; batch GET returns `{ status, counts:{queued,rendering,ready,error}, reports:[...] }`; enqueue failure flips that child to `error`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** `'all'` → eligible active clients. Rollup: `complete` when no non-terminal children, `error` only if all failed, else `running`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): ad-hoc batch generation + status"`

---

### Task 22: `recoverSeoReports()` stranded-job sweep

**Files:**
- Create: `lib/seo-report-recovery.ts` + test
- Modify: `lib/ada-audit/queue-manager.ts` `recoverQueue()` (boot — call AFTER `recoverBrokenLinkVerifies()`, via dynamic import) and `lib/jobs/handlers/stale-audit-reset.ts` (10-min tick — dynamic import). This is **global stranded-job recovery piggybacking on the existing reset job** (Codex fix #11) — name and comment it that way, NOT as ADA/audit-specific, even though the host files are ADA-named.

**Interfaces:**
- Produces: `recoverSeoReports(): Promise<{ requeued: number }>`.

- [ ] **Step 1: Write failing tests:** a `queued`/`fetching`/`rendering` report older than the threshold with NO active `seo-report:<id>` job is re-enqueued; one with an active job is left alone; a `ready`/`error` report is ignored. Mirror `recoverBrokenLinkVerifies()` (`lib/ada-audit/broken-link-recovery.ts`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** by querying non-terminal reports + checking active jobs by group (`seo-report:<id>`); `enqueueSeoReportRender` for stranded ones. Wire the two call sites exactly as the broken-link recovery is wired (dynamic import at boot in `recoverQueue()` after the broken-link call; dynamic import in `stale-audit-reset.ts`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): stranded report recovery sweep"`

---

### Task 23: Monthly schedule + wrapper job

**Files:**
- Create: `lib/jobs/handlers/seo-report-monthly-run.ts` + test (register in `lib/jobs/handlers/register.ts`)
- Create: `app/api/reports/schedule/route.ts` (GET/PUT the `seo-report-monthly` Schedule: enabled, day-of-month, time, comparisonMode — Codex fix #12, NOT under `/api/google`)

**Interfaces:**
- Consumes: `createBatchWithReports` (idempotent), `enqueueSeoReportRender`, `lastFullMonth`.
- Produces: job `type:'seo-report-monthly-run'`; the operator-configurable **non-system** `Schedule` row `name:'seo-report-monthly'`.

- [ ] **Step 1: Write failing tests:** the wrapper resolves `scheduledFor`, last-full-month period, creates one batch (idempotent on the slot) + one report per eligible client, enqueues renders; a re-run for the same slot creates NO duplicates; archived/unmapped clients skipped; PUT route upserts the Schedule with `cadence:'monthly:<day>@HH:MM'` and `payload:{comparisonMode}` and is **not** in `SYSTEM_SCHEDULES`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Register the wrapper handler (concurrency 1, short). The PUT route validates `day∈1..28`, `HH:MM`, and writes a plain `Schedule` row (create or update by `name`). Confirm `system-schedules.ts` cleanup (`startsWith:'system-'`) does NOT touch it.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): monthly schedule + idempotent wrapper job"`

---

### Task 24: `/reports` library + manual prospects entry; Settings schedule controls

**Files:**
- Create: `app/api/reports/[id]/prospects/route.ts` (PUT manual `ProspectsEntry` → re-enqueue render)
- Modify: `app/reports/page.tsx` (full library: filter by client, status chips, per-source badges, download, manual-prospects inline), `app/settings/page.tsx` (schedule controls)

- [ ] **Step 1: Write failing test** for the prospects route: PUT `{ total, organic }` upserts `ProspectsEntry` for the report's window, **then (Codex fix #8) nulls `SeoReport.metricsJson`, resets `status='queued'` + `prospectsStatus='pending'`, and re-enqueues `seo-report-render`** — assert `metricsJson` is null afterward so the re-render refetches and the new value actually appears (without this the render keeps the stale snapshot). Validates non-negative ints.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** the route (upsert entry → invalidate snapshot → re-enqueue) + build the library UI (multi-select generate form incl. "All active", batch progress banner, per-source badges, download links, inline manual-prospects field when `prospectsStatus==='missing'`) and Settings schedule controls (enabled/day/time/comparison) calling Task 23's PUT.
- [ ] **Step 4:** Manual smoke: ad-hoc batch for 3 clients; set a monthly schedule for tomorrow's slot in dev and force a tick; enter a manual prospects value and confirm re-render. `npm run build`.
- [ ] **Step 5: Commit** `git commit -am "feat(reports): report library, manual prospects, schedule controls"`

---

### Task 25: Phase 2 integration gate + deploy notes

- [ ] **Step 1:** `npx tsc --noEmit`, `npx vitest run`, `npm run build` → all PASS.
- [ ] **Step 2:** **Service-account key + its env var live outside the committed config.** The key JSON is a gitignored file (prod: `${DATA_HOME}/google-sa.json` = `$DATA_HOME/google-sa.json`, mode 0600; dev: a local gitignored path). Set `GOOGLE_SA_KEY_FILE=<that path>` in the server's gitignored `.env` (`$APP_HOME/.env`, same file as `APP_AUTH_SECRET`) and in local `.env.local`. The stale `GOOGLE_OAUTH_*` / `GOOGLE_TOKEN_ENC_KEY` vars from the abandoned OAuth approach can be removed. Optional `CRM_API_BASE` in `.env`. Only the **non-secret** retention defaults (`SEO_REPORT_RETENTION_SCHEDULED_DAYS`/`_ADHOC_DAYS`) may go in `ecosystem.config.js`'s `env` block. Document the service-account setup in `docs/google-service-account-setup.md` (create SA → JSON key → confirm APIs → grant the SA email on each client's GA4 Property Access Management + GSC Users-and-permissions), **including key rotation** (Codex): create a new key, deploy the new file, restart PM2, then delete the old key in Cloud Console.
- [ ] **Step 3:** Update `CLAUDE.md` "Tools in the app" table + a short "SEO Performance Reports" architecture note.
- [ ] **Step 4: Commit** `git commit -am "chore(reports): deploy config + docs"`

---

## Self-Review

**Spec coverage:** §1 service-account auth→Task 5 (+ status UI 19); §2 mapping→17,19; §3 schema→1; §4 providers→7,8,9,4; §5 content→10,12; §6 rendering→11,12,13; §7 generation/dates/eligibility→14,15,16,21,23; §8 retention→18; §9 errors/partial→10,12,15; §10 UI→19,24; §11 security→5; §12 testing→every task; §13 Phase-6 seam→provider layer (7–9); §14 deferred→CRM stub (9). (Tasks 3 & 6 intentionally removed — were user-OAuth.) All covered.

**Placeholder scan:** No "TBD/TODO/handle edge cases"; each task carries concrete test + implementation direction and exact paths. Code shown for all pure modules; routes/jobs specify exact signatures, keys, and behaviors.

**Type consistency:** `SourceResult<T>`, `Ga4Bundle`/`GscBundle`/`ProspectsBundle`, `PerformanceAnalyticsBundle`, `DateWindow`, `seoReportPath(id)`, `enqueueSeoReportRender`, `createBatchWithReports`, `SEO_REPORT_RENDER_JOB_TYPE` used consistently across tasks. Group key `seo-report:<id>` everywhere.
