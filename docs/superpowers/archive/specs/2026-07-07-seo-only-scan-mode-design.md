# SEO-Only Scan Mode + URL Scan Form (C11 PR 1) — Design

Status: **reviewed** (Codex: design decisions adjudicated + spec reviewed
"ACCEPT WITH NAMED FIXES" — all 8 fixes applied 2026-07-07) · Author: Claude
(brainstormed with Kevin) · Roadmap item: **C11 PR 1** (tracker
`docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md:452`).

## 1. Goal

Make an SEO-purposed site scan cheap and directly triggerable from the webapp.

Today an SEO scan pays for the **entire ADA pipeline** — axe-core accessibility,
violation screenshots, PDF scans, and PSI/Lighthouse per page — because SEO output
(the "live-scan" `CrawlRun`) is a side effect of the ADA audit. Prod timing
(2026-07-07): page job 4.6s avg but **PSI 30.3s avg** is the dominant cost;
paired scans run ~12–48 min/100 pages, an SEO-only render pass ~3–4 min/100 pages.

PR 1 delivers:
- **(f) `seoOnly` scan mode** — a render-only page path (navigate + settle +
  harvest links/on-page-SEO) that skips axe, screenshots, PDF dispatch, and PSI.
- **(g) URL scan form** — enter a URL/domain → enqueue a `seoOnly` scan, reusing
  the existing queue / discovery / hybrid-crawler / browser pipeline. Results
  surface as the existing "Live scan" history entries at
  `/seo-parser/results/run/[runId]`.

Out of scope for PR 1 (later C11 PRs): seoIntent/seoOnly toggles on the existing
forms + `ScheduledScansCard`, flipping scheduled scans to seoOnly, rich SEO-phase
progress/visibility, and the `/seo-parser` → `/seo-audits` rename/maturation.

## 2. Background (verified code facts this builds on)

- **Enqueue chain:** `app/api/site-audit/route.ts` POST → `queueSiteAuditRequest`
  (`lib/ada-audit/queue-request.ts`) → `enqueueAudit` (`lib/ada-audit/queue-manager.ts`).
  `enqueueAudit`'s `prisma.siteAudit.create` (queue-manager.ts ~L108-122) is the
  single row-write site; `seoIntent` is written there (L120).
- **Discover job** (`lib/jobs/handlers/site-audit-discover.ts`) already reads the
  parent's `seoIntent` (L104) and uses it to pick **hybrid crawl** discovery
  (L145, L178). It fans out one `site-audit-page` job per URL (L279-303); the
  page-job payload is built L282-287 (`{adaAuditId, siteAuditId, url, wcagLevel}`
  — no mode field today).
- **Page job** (`lib/jobs/handlers/site-audit-page.ts`): claims the child row
  (L203-221; the claim-0 **repair path** re-enqueues PSI only for `axe-complete`
  children, L216-217), calls `runAxeAudit` (L227 — nav+settle+axe+screenshots+
  harvest all inside `runner.ts`), then `dispatchPdfScans` (L268, bumps
  `pdfsTotal`), then either the `detachPsi` settle (`axe-complete` + `lighthouseTotal++`
  + `enqueuePsiJob`, L275-283) or the direct-complete settle (`complete` +
  `pagesComplete++`, L284-299), then `persistHarvest`/`persistPageSeo` (L303-304),
  then `finalizeWarn`.
- **Finalizer** (`lib/ada-audit/site-audit-finalizer.ts`): drains on
  `pagesDone && pdfsDone && lighthouseDone` (L50-52); with `pdfsTotal=0` and
  `lighthouseTotal=0` both are naturally true, so a seoOnly audit drains straight
  to `complete` **iff the page handler never bumps `lighthouseTotal`**. On
  completion it builds an ADA summary (L79-88), fires `carryForwardSiteAuditChecks`
  (L105), and dual-writes an **`ada-audit` `CrawlRun`** via `mapAdaChildren` +
  `writeFindingsRun` (L112-130), then fire-and-forget `enqueueBrokenLinkVerify`
  (L136 — LAST; safe because the audit is already terminal `complete`).
- **`broken-link-verify`** is the single **live-scan run builder**: it reads the
  transient `HarvestedLink`/`HarvestedPageSeo` rows, writes a live-scan `CrawlRun`
  (`tool:'seo-parser'`, `source:'live-scan'`, coexisting with any ada run via the
  C6 compound unique `@@unique([siteAuditId, tool])`), then deletes the transient
  rows. Median 36s / p90 55s in prod.
- **SEO history already works** once the live-scan run exists: `/api/parse/history`
  includes `tool:'seo-parser', source:'live-scan', seoIntent:true` runs
  (history route L32-45); `HistoryList` routes run entries to
  `/seo-parser/results/run/[id]` (L230-233).
- **ADA export routes gate purely on an `ada-audit` run existing:**
  `report/route.ts:27`, `csv/route.ts:58`, `vpat/route.ts:19` → 409 `no_findings_run`
  when absent. **This is why a seoOnly audit must NOT create an `ada-audit` run**
  (an empty one would make ADA exports look valid).
- **Schema:** `model SiteAudit` (`prisma/schema.prisma` ~L119-171) has
  `seoIntent Boolean @default(false)` at L151; `status` is a **string** (no enum).
- **UI:** `SiteAuditForm.tsx` and `QuickSiteAuditWidget.tsx` POST to
  `/api/site-audit` without `seoIntent`. `QuickSiteAuditWidget.tsx:26-27` routes
  **both `202` and `409`** responses to `/ada-audit/site/${id}`.
- **Score in the list:** `GET /api/site-audit` maps `score` from
  `crawlRuns where tool:'ada-audit'` **and** falls back to `summary.aggregate`
  when a summary exists (route.ts L103-108). A seoOnly audit's score is `null`
  **only because the finalizer guard leaves `summary` null** (§4.4) — no ada run
  AND no summary. (If a summary were written, the fallback would compute a score.)
- **`/api/site-audit/[id]` detail route** selects child ADA `result`s (L96) for
  the ADA detail view; it does **not** currently expose the live-scan run id.
- **Share route** `app/api/site-audit/[id]/share/route.ts` gates only on
  `status === 'complete'` (L31) — no mode check.

## 3. Scope decisions (locked — Codex-adjudicated 2026-07-07)

| Decision | Ruling | Why |
|---|---|---|
| **Flag model** | New persisted **`seoOnly Boolean @default(false)`** column beside `seoIntent`. Enforce **`seoOnly ⇒ seoIntent`** at enqueue (a seoOnly request forces `seoIntent:true`). Do NOT collapse the two meanings, do NOT introduce a `scanMode` enum. | `seoIntent` means "produce SEO output" and is intentionally full-ADA today (scheduled/autonomous scans rely on it). `seoOnly` means "skip the ADA work." Independent columns = minimal blast radius; an enum would touch every `seoIntent` read site. |
| **PR 1 trigger scope** | **On-demand URL form only.** `scheduled-site-audit.ts` stays full-pipeline. | Keeps PR1 tight/independently shippable; the schedule flip is a D1-behavior decision for PR2 with the toggle UI. The second `// FUTURE` breadcrumb stays. |
| **Mode plumbing** | The page handler reads **`seoOnly` off the parent `SiteAudit` row** (authoritative). The page-job payload MAY carry it as a hint, but the DB row is source of truth. | Retries, recovery re-enqueues, and stale payloads can otherwise silently fall back to the full ADA path. |
| **Runner seam** | New **`renderOnly`** option on `runAxeAudit` returning a distinct **`kind:'rendered'`** result: keep safe-URL validation + navigation + settle + redirect handling + link/on-page-SEO harvest; skip axe, screenshots, PDF harvest, and (inline) Lighthouse. | Smallest clean seam; the runner already owns the browser/SSRF/nav/settle boundary. |
| **Form + results placement** | Form is a **new card on `/seo-parser`**. After submit the user stays on `/seo-parser` with a **minimal pending-scan status card**; results appear in the existing history + `/seo-parser/results/run/[runId]` once the live-scan run is built. Do **NOT** route seoOnly audits to `/ada-audit/site/[id]`. | The live-scan `CrawlRun` doesn't exist until ~30-55s after `complete`; "queued, see history" alone leaves a real invisibility gap. Rich poller is PR2. |
| **ADA-surface guards** | A seoOnly audit produces **no `ada-audit` `CrawlRun`, no ADA summary, no carry-forward**; ADA list/history/quick-widget/exports must not treat it as an accessibility audit. | Prevents empty ADA data from looking valid (exports/score/summary). |

## 4. Architecture — units

### 4.1 Schema + plumbing (`seoOnly` from request to row)

- **Migration** `prisma/migrations/<ts>_seo_only/migration.sql`: add
  `seoOnly BOOLEAN NOT NULL DEFAULT false` to `SiteAudit`. SQLite-safe (additive
  column with default; no nullability alteration). Update `schema.prisma:151`
  area (`seoOnly Boolean @default(false)` beside `seoIntent`; no index).
- **`enqueueAudit`** (`queue-manager.ts`): add `seoOnly?: boolean` to
  `EnqueueAuditOptions`; write it in the `create` block.
- **`queueSiteAuditRequest`** (`queue-request.ts`): add `seoOnly?: boolean` to
  `QueueRequestInput`; **enforce `seoOnly ⇒ seoIntent`** here (compute
  `const seoIntent = input.seoIntent || input.seoOnly === true`), pass both to
  `enqueueAudit`.
- **Route** (`route.ts`): read `const seoOnly = raw?.seoOnly === true`; pass
  `seoOnly` (and let the helper force `seoIntent`).

### 4.2 Render-only runner path (`runner.ts`)

- Add `renderOnly?: boolean` to `RunAxeOptions`. When set:
  - keep: safe-URL validation, browser page acquire, navigation, `postLoadSettle`,
    redirect detection, link harvest, on-page-SEO harvest.
  - skip: `page.addScriptTag(AXE_PATH)` + `axe.run`, `captureViolationScreenshots`,
    PDF-URL harvest (no PDFs dispatched downstream anyway), inline Lighthouse.
  - return a distinct `kind:'rendered'` result carrying `{ finalUrl?, redirected?,
    harvestedLinks, harvestedLinksTruncated, harvestedPageSeo }` — **no `axe`,
    no `lighthouseSummary`**.
  - `kind:'redirected'` still returns for redirects (SEO cares about redirects).
- **SWC-injection invariant:** the on-page harvest/parse functions
  (`parseSeoFromDocument`, link harvest) are unchanged; renderOnly only gates
  which phases run in Node. No new `.toString()`-injected code.

### 4.3 seoOnly page-job path (`site-audit-page.ts`)

- **Read parent `seoOnly` BEFORE the claim-0 repair branch** (the claim-0 branch
  at L207-221 `return`s before the normal path). Load `seoOnly` via a single
  `select` on `SiteAudit` by `job.siteAuditId` right after the claim attempt, so
  the flag is available in both the repair branch and the normal path →
  `const seoOnly = parent?.seoOnly === true`. (Authoritative per §3.)
- Call `runAxeAudit(job.url, job.wcagLevel, undefined, { auditId, siteAudit:
  detachPsi, renderOnly: seoOnly })`. (When `renderOnly` is set the inline-LH is
  skipped regardless of `detachPsi`, so the `siteAudit` flag is moot for that path.)
- **When `seoOnly`:** on a `kind:'rendered'` result, settle the child directly to
  `complete` bumping **only `pagesComplete`** (mirror the non-detach branch, but
  `result: null`, `runnerType:'browser'`, `completedAt`), then
  `persistHarvest`/`persistPageSeo`, then `finalizeWarn`. **Never** call
  `dispatchPdfScans`, **never** bump `lighthouseTotal`, **never** `enqueuePsiJob`.
- **Claim-0 repair guard:** a seoOnly child never reaches `axe-complete` (it
  settles straight to `complete`), so the L216 PSI re-enqueue is already
  unreachable for seoOnly — but add an explicit `&& !seoOnly` guard on that
  `enqueuePsiJob(job)` for defense (the flag is now read before this branch).
- Redirect handling unchanged (kept for both modes).

### 4.4 Finalizer guard (`site-audit-finalizer.ts`)

- Load `seoOnly` in the finalizer's existing audit read.
- **When `seoOnly`:** on drain-complete, set `status:'complete'` + `completedAt`
  **without** building/writing the ADA `summary` (leave `summary` null), and
  **skip** `carryForwardSiteAuditChecks` and the `mapAdaChildren`/`writeFindingsRun`
  ADA dual-write. Keep `closeBatchIfDrained`, the `processNext` kick, and
  **`enqueueBrokenLinkVerify`** (the live-scan builder — this is what produces
  the SEO report).
- Drain math is unchanged and already correct (zero pdf/lighthouse totals).

### 4.5 URL scan form + pending status (`/seo-parser`)

- **Readiness signal (fix — required):** the live-scan `CrawlRun` only exists
  ~30-55s **after** `SiteAudit.status === 'complete'` (once `broken-link-verify`
  builds it). Polling `GET /api/site-audit` / the queue endpoint is **not enough**
  — neither returns the live-scan `runId`, and the queue drops terminal audits.
  Add `liveScanRunId: string | null` to **`GET /api/site-audit/[id]`** by
  selecting `crawlRuns where tool:'seo-parser'` (the one live-scan run) → its id
  when present. This is the clean signal the form polls.
- New client component `components/seo-parser/SeoScanForm.tsx` (name TBD in plan):
  domain/URL input + submit → `POST /api/site-audit` with
  `{ domain, seoOnly: true }` (clientId optional; `seoIntent` forced server-side).
  - On `202` → show a **pending-scan status card** keyed on the returned `id`,
    polling `GET /api/site-audit/[id]`. States: **queued/running** (from `status`)
    → **building SEO report** (`status==='complete'` but `liveScanRunId` still
    null) → **ready** (link to `/seo-parser/results/run/[liveScanRunId]`). Persist
    the `id` (e.g. sessionStorage) so the card survives a soft refresh. Reuse
    existing dark-mode + `components/ui` primitives (deck language).
  - On `409` (duplicate in-flight) → surface the existing-domain message; do NOT
    route to `/ada-audit/site/[id]`.
  - On `400` → inline validation error.
- Placement: a card on the `/seo-parser` page alongside the CSV upload; the full
  section maturation/tabs is PR3. **No route rename in PR1.**

### 4.6 ADA-surface guards (concrete matrix)

Because a seoOnly audit is still a `SiteAudit` row, every ADA-facing read can see
it. `GET /api/site-audit` must include `seoOnly` on each item so views can filter.
Per-surface disposition for PR1:

| Surface | File | PR1 action |
|---|---|---|
| **Share API** | `app/api/site-audit/[id]/share/route.ts` | **UPDATE (required):** reject `seoOnly` explicitly (e.g. 400 `seo_only_not_shareable`) — today it only checks `status==='complete'`, so a direct call would mint an ADA share token. |
| **Quick-widget 409 routing** | `components/widgets/QuickSiteAuditWidget.tsx:26-27` | **UPDATE (required):** it routes `202`+`409` to `/ada-audit/site/[id]`. A seoOnly in-flight duplicate returns `409 {id}` → would land on ADA. The `409` body must carry `seoOnly` (add to the route's 409 response) and the widget must route seoOnly duplicates to `/seo-parser` (or not deep-link on 409). |
| **`/ada-audit/site/[id]` page** | the site-audit results page/route | **UPDATE (required):** for a `seoOnly` row, redirect to `/seo-parser` (with the pending id) rather than render the generic "Result data unavailable" ADA page. Specify the redirect in the plan. |
| **ADA exports** | `report/route.ts:27`, `csv/route.ts:58`, `vpat/route.ts:19` | **No change needed** — they already 409 `no_findings_run` when no `ada-audit` run exists (which is the seoOnly case). Add a test asserting this. |
| **Detail poller** | `app/api/site-audit/[id]/route.ts` | **UPDATE:** add `liveScanRunId` (§4.5) + surface `seoOnly`. |
| **Lists / dashboards / recents / fleet** | `/api/site-audit/queue` + `getQueueStatus`, `LiveNowWidget`, `DashboardQueueStatus`, `QueueMemberRow`, batch list/detail routes, `lib/ada-audit/recents-query.ts`, `app/api/clients/audit-summary/route.ts`, `lib/services/client-dashboard.ts`, `lib/services/client-fleet.ts` | **AUDIT + minimally guard:** these read `SiteAudit` rows and may present a seoOnly row as an accessibility audit / deep-link it to `/ada-audit/site/[id]` or show a null ADA score. PR1 minimum = **exclude or clearly SEO-label** seoOnly rows here so nothing presents them as ADA; full labeling polish is PR2. The plan must walk each and mark update-vs-safe with evidence. |

The quick-widget does not *create* seoOnly audits in PR1 — only the 409-duplicate
path above is the exposure.

## 5. Data flow

```
POST /api/site-audit { domain, seoOnly:true }
  → queueSiteAuditRequest (forces seoIntent:true)
  → enqueueAudit → SiteAudit { seoOnly:true, seoIntent:true, status:'queued' }
  → processNext → site-audit-discover (hybrid discovery, seoIntent-driven)
      → fan out site-audit-page jobs
        → each: claim → read parent.seoOnly → runAxeAudit({renderOnly:true})
             → kind:'rendered' → settle complete (pagesComplete++ only)
             → persistHarvest + persistPageSeo → finalizeWarn
  → finalizeSiteAudit: pagesDone && (pdfsTotal=0) && (lighthouseTotal=0) → complete
       (seoOnly: no ADA summary / carry-forward / ada dual-write)
       → enqueueBrokenLinkVerify  ── builds live-scan CrawlRun (~30-55s)
  → /seo-parser history + /seo-parser/results/run/[runId] show the SEO result
```

## 6. Error handling & invariants

- All transactions array-form `$transaction([...])`; raw SQL sets `updatedAt`
  manually (`Date.now()`, integer ms). (CLAUDE.md.)
- Migration additive-only; no `ALTER COLUMN` nullability; no `createMany`+
  `skipDuplicates`; P2002-guarded individual creates where relevant.
- The seoOnly page settle must land `pagesComplete` in the **same fenced settle**
  the harvest persistence depends on (harvest only persists when the attempt won
  the settle — unchanged fence).
- Domain-failure and redirect settles behave identically in seoOnly (a failed
  page is `pagesError`, a redirect is `pagesRedirected`) — drain math still holds.
- `broken-link-verify` and the live-scan builder are unchanged and already cover
  seoOnly (ada-run absence is irrelevant to the builder). **Zero-harvest recovery
  edge (fix):** `recoverBrokenLinkVerifies` re-enqueues stranded verifiers by
  looking for complete audits **with transient harvest rows** and no live-scan run.
  If a seoOnly audit's pages all fail/redirect (or harvest returns null) and the
  process crashes after `complete` but before `enqueueBrokenLinkVerify`, there are
  no transient rows, so recovery won't see it and no (empty) live-scan run is ever
  built. Extend `recoverBrokenLinkVerifies` to ALSO re-enqueue **complete
  `seoOnly:true` audits with no `seo-parser` run and no active verifier job**
  (an empty-harvest verify still writes a clean run — the builder already handles
  empty harvest). Alternatively, weaken the guarantee explicitly; the plan should
  pick the extend option unless it proves costly.
- No new required-in-prod env var (no boot fail-fast risk).
- New/changed routes: `route.ts` POST changes shape (adds `seoOnly`) — confirm
  `middleware.ts` already allows `/api/site-audit` (it does) and add/extend a
  `middleware.test.ts`/route-test case for the new field per repo invariant.

## 7. Testing

- **Unit — plumbing:** `queueSiteAuditRequest` forces `seoIntent` when
  `seoOnly:true`; `enqueueAudit` writes `seoOnly`; route parses `seoOnly` strictly.
- **Unit — runner:** `renderOnly` returns `kind:'rendered'` with harvest arrays
  and no `axe`/`lighthouseSummary`; redirect still returns `kind:'redirected'`;
  axe/screenshot phases are not invoked (spy/mocked).
- **Unit — page handler:** seoOnly child settles `complete` with only
  `pagesComplete++`, never calls `dispatchPdfScans`/`enqueuePsiJob`, never bumps
  `lighthouseTotal`; harvest persisted; claim-0 repair does not enqueue PSI for
  seoOnly.
- **Unit — finalizer:** seoOnly complete writes null summary, skips
  carry-forward + ADA dual-write, still enqueues broken-link-verify; drain math
  reaches complete with zero pdf/lighthouse totals.
- **Integration:** a seoOnly audit → no `ada-audit` `CrawlRun`; ADA
  report/csv/vpat routes 409 `no_findings_run`; after broken-link-verify a
  live-scan run exists and appears in `/api/parse/history`; `GET /api/site-audit`
  returns `score:null` + `seoOnly:true`.
- **Detail route:** `GET /api/site-audit/[id]` returns `liveScanRunId` (null
  pre-verify, the run id after) + `seoOnly`.
- **Share guard:** `POST /api/site-audit/[id]/share` rejects a seoOnly audit.
- **Quick-widget:** a `409` for a seoOnly in-flight duplicate carries `seoOnly`
  and is not routed to `/ada-audit/site/[id]`.
- **`/ada-audit/site/[id]`:** a seoOnly row redirects to `/seo-parser`, not the
  generic ADA unavailable page.
- **Recovery:** `recoverBrokenLinkVerifies` re-enqueues a complete zero-harvest
  seoOnly audit that has no live-scan run and no active verifier.
- **Route/middleware:** `/api/site-audit` POST with `seoOnly` covered; middleware
  test unchanged-green.
- Test-DB hygiene per CLAUDE.md (unique domain prefixes; clean `CrawlRun`/
  `SiteAudit` by domain).

## 8. Acceptance criteria

1. `POST /api/site-audit { domain, seoOnly:true }` creates a `SiteAudit` with
   `seoOnly:true, seoIntent:true` and returns `202 {id, status:'queued'}`.
2. The scan runs render-only: pages settle `complete` with no axe result, no PDFs,
   no PSI; `pdfsTotal===0 && lighthouseTotal===0`; the audit reaches `complete`.
3. No `ada-audit` `CrawlRun`, no ADA summary, no carry-forward for the audit;
   ADA report/csv/vpat 409.
4. `broken-link-verify` runs and produces the live-scan `CrawlRun`; the result is
   reachable at `/seo-parser/results/run/[runId]` and listed in SEO history.
5. `/seo-parser` shows the URL scan form; after submit a pending-scan status card
   is shown; the user is never routed to `/ada-audit/site/[id]`.
6. ADA list surfaces do not present the seoOnly row as an accessibility audit.
7. Gate-green (tsc / test / build); dark-mode on every new element; middleware
   test coverage intact.

## 9. Out of scope / future work (breadcrumbed)

- **C11 PR 2:** seoIntent/seoOnly toggles on `SiteAuditForm` + quick-widget +
  `ScheduledScansCard`; intent labels in queue/history; SEO-phase visibility
  (probe `broken-link-verify` job state) + fine-grained progress
  (`Job.progress`/`progressMessage`); decision on whether seoIntent schedules
  flip to seoOnly (rewire `scheduled-site-audit.ts` — the second `// FUTURE`).
- **C11 PR 3:** `/seo-parser` → `/seo-audits` rename (redirects, nav, handoff
  "Webapp:" URL audit) + section maturation to structurally mirror the
  ADA-Audit section (tabbed index, form+queue+poller+history parity).
- Fast lane / separate queue for SEO scans — explicitly OUT (one global
  site-audit queue by design; the browser pool is the constraint).
