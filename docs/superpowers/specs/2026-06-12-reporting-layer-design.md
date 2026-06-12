# C4 — Reporting Layer Design

**Date:** 2026-06-12 · **Status:** spec
**Tracker item:** C4 — Reporting layer: branded PDF export, site-audit share links, CSV export, VPAT scaffold (roadmap doc `02-ada-audit.md` Phase 4)
**Depends on:** C3 (relational violations + findings fallbacks — shipped PR #67)

## Problem

For a client-services business the *report* is the product, and today the
report is "log into our internal tool." Site audits have no share links
(single-page audits do), no PDF deliverable, no CSV export, and no VPAT
artifact. C3 made all violation data relational, so every export can be built
from `CrawlRun`/`CrawlPage`/`Violation` rows and survives blob pruning.

## Scope reconciliation (what already exists)

- **Single-page share links**: `AdaAudit.shareToken`/`shareExpiresAt`,
  mint route `POST/GET /api/ada-audit/[id]/share` (30-d TTL, rotate on
  expiry, complete-only), public page `/ada-audit/share/[token]`
  (blob-or-`buildArchivedAxeResults` fallback), middleware prefix
  `/ada-audit/share/` + test. **Template to mirror — not shared code.**
- **Findings fallbacks (C3)**: `buildSummaryFromFindings()` /
  `buildArchivedAxeResults()` — every C4 surface goes through the same
  summary-or-fallback read paths the views use; no raw blob parses.
- **Instance diffing (C3)**: `getSiteAuditInstanceDiff()` (level-matched
  previous) + pure `diffInstances()`. Built explicitly as C4 inputs — the
  PDF "changes" section and the changes CSV consume them.
- **Score trend**: `CrawlRun.score` series + `buildSeries()`
  (`scorecard-shared.ts`, 12-point cap).
- **Browser pool**: `acquirePage()`/`releasePage()` singleton Chrome
  (pool 4 in prod, recycling gates). **No `page.pdf()` call exists anywhere
  yet.** Never hold a page across awaits we don't control.
- **Durable job queue (A1)**: `registerJobHandler` + `enqueueJob` with
  dedupKey/groupKey; `pdf-scan`/`ada-audit` handlers are the pattern.
- **CSV**: parsing only (Papa) — no export machinery exists.
- **PDF scan subsystem** (`PdfAudit`, `pdf-scan` job) scans *client* PDFs
  for accessibility. Unrelated to report rendering — do not conflate.
- **No logo asset exists in the repo** (`public/` absent). Branding =
  "Enrollment Resources" text wordmark + brand colors (navy/orange from the
  Tailwind palette). A logo file can be dropped in later.

## Design overview

Four features, one PR, all relational-first:

1. **Site-audit share links** — mirror the single-page pattern onto
   `SiteAudit`.
2. **CSV export** — violations CSV + changes CSV from `Violation` rows /
   instance diff. Pure string builder, streamed from authed routes.
3. **Branded PDF report** — pure HTML-template builders (`lib/report/`)
   rendered to PDF via `page.setContent()` + `page.pdf()` inside a durable
   `report-render` job; file stored under `REPORTS_DIR`, served by an authed
   route.
4. **VPAT scaffold** — markdown download generated from `Violation.wcagTags`
   against a static WCAG success-criteria table. Explicitly a scaffold, not
   a legal ACR.

### Feature 1 — Site-audit share links

**Schema:** `SiteAudit.shareToken String? @unique`,
`SiteAudit.shareExpiresAt DateTime?` (same migration as Feature 3's column).

**Mint route:** `POST/GET /api/site-audit/[id]/share` — verbatim mirror of
the single-page route semantics: complete-only (409 otherwise), 30-day TTL,
`crypto.randomUUID()`, POST returns existing unexpired token or rotates an
expired one; GET reports current token or null. Cookie-gated (middleware
default). Share URL built from `NEXT_PUBLIC_APP_URL`, never request origin.

**Public page:** `/ada-audit/site/share/[token]` — server component,
force-dynamic. Loads by `shareToken`; 404 on unknown token, expired token,
or non-complete status. Renders the **same read path as the internal site
results page**: parse `summary` blob, else `buildSummaryFromFindings()`,
score prefers `CrawlRun.score`, compliance from counts. Renders
`SiteAuditResultsView` in a new `shareMode`:

- Page table renders (per-page impact counts from `summary.pages`) but rows
  are **not expandable** — expansion violations come from an auth-gated API
  the anonymous visitor can't call. No "View full audit ↗" links (child
  pages are auth-gated). External page-open links (to the client's own site)
  stay.
- **`shareMode` suppresses every auth-gated or internal affordance** (Codex
  fix): the by-violation/grouped view and its `useGroupedViolations()`
  fetches to `/api/ada-audit/[id]`, triage mode + its localStorage state,
  common-issue drilldown CTAs (the aggregate common-issues summary itself
  may render — it's server-loaded), "View audit" links inside grouped
  cards, and re-scan/share/export controls. Anything that would issue a
  cookie-gated fetch or link to a cookie-gated page is off.
- PDF accessibility section renders read-only (data is server-loaded).
- Archived (pruned-blob) audits render with the existing archived banner and
  `archivedCounts` "—" contract.

**Middleware:** add `/ada-audit/site/share/` to `PUBLIC_PATH_PREFIXES` +
`middleware.test.ts` case (this exact shape has bitten three times). Note
`/ada-audit/share/` does NOT cover the new path.

**Lifecycle:** links die naturally when the audit row is deleted (manual
delete or scheduled retention) — acceptable; the share UI copy already warns
about scheduled-audit retention windows elsewhere, and the mint UI shows the
expiry date. **Expired-token cleanup** (Codex fix): mirror
`cleanExpiredAdaShareTokens()` (`lib/cleanup.ts`) with a SiteAudit
equivalent registered in the same `runCleanup()` list, so expired site
tokens are nulled rather than accumulating.

**UI:** Share button on the site results page (mirrors `ShareAuditButton`),
inside the new export bar (below).

### Feature 2 — CSV export

**`lib/report/csv.ts`** — tiny pure RFC-4180 builder: escape fields
containing `" , \n` by quoting + doubling quotes; rows joined with `\r\n`;
UTF-8 BOM prefix so Excel opens it correctly. **Formula-injection
neutralization** (Codex fix): fields starting with `=`, `+`, `-`, `@`, tab,
or CR get a leading `'` so Excel/Sheets never execute them — page URLs and
help text are externally controlled. Unit-tested incl. injection cases.

**Violations CSV:** `GET /api/site-audit/[id]/csv` (cookie-gated).
Relational-only: `Violation` joined to `CrawlPage` by the audit's
`CrawlRun`. Columns:
`page_url, rule_id, impact, severity, wcag_tags, help, help_url, node_count`
(wcag_tags joined with `|`). Sort: impact rank (critical→minor, with the
`'unknown'` sentinel ranked last and rendered verbatim — never assume only
the four axe impacts), then `ruleId`, then `page_url`. Filename
`ada-violations-<domain>-<YYYY-MM-DD>.csv` via Content-Disposition.
Pre-A2 audit (no CrawlRun) → 409 `{error: 'no_findings_run'}`. Works
unchanged on archived audits.

**Changes CSV:** `GET /api/site-audit/[id]/csv?sheet=changes` — reuses the
**same previous-audit selection** as C3 (`getSiteAuditInstanceDiff`'s
domain+wcagLevel-matched previous, anchored at the audit's own run) but with
an **uncapped** classifier: expose a detailed variant
(`diffInstancesDetailed()` returning full per-rule URL lists; the existing
capped `InstanceDiff` derives from it, so UI shapes are unchanged). Note
(Codex fix): the current `diffInstances()` only **counts** not-rescanned
instances — it does not keep their URLs — so the detailed variant must
explicitly accumulate `notRescannedUrls` (and regressed/new-page/resolved
lists) rather than just lifting the existing caps. Columns:
`change, rule_id, severity, page_url` where `change ∈
new | new-page | resolved | not-rescanned` (the C3 vocabulary; `new` =
regressed — page scanned in both runs). Unchanged instances are excluded
(huge and uninformative). No matching previous run → 409
`{error: 'no_previous_run'}`.

Standalone (single-page) audit CSV is a noted follow-up, not v1.

### Feature 3 — Branded PDF report

**The decision: template-string HTML + `page.setContent()` — not
self-HTTP navigation, not a client print stylesheet.**

Alternatives considered:

- *Navigate Chrome to an internal report route* (`http://127.0.0.1:PORT/...`):
  requires a render-token + middleware exemption (the gotcha-prone shape), a
  port/self-HTTP dependency, and the app must serve mid-job. Rejected.
- *Client-side "print to PDF"*: not a deliverable artifact, loses branding
  control. Rejected.
- *`page.setContent(html)` with self-contained HTML*: no auth problem, no
  network dependency, HTML builders are pure functions unit-testable as
  strings, print CSS is hand-rolled anyway for a branded document. Images
  embedded as base64 data URIs (about:blank pages can't load `file://`
  subresources). **Chosen.**

**`lib/report/` modules (pure, no prisma):**

- `report-html.ts` — `buildSiteReportHtml(data: SiteReportData): string`.
  Sections: cover/header (ER text wordmark, domain, client name, audit date,
  WCAG level label, operator), executive summary (score, compliant badge,
  pages scanned/error counts, violation counts by impact), score trend
  (static inline SVG sparkline from up to 12 points + delta line), changes
  vs previous (instance-diff headline counts + top changed rules; section
  omitted when no comparable previous run), top issues (top 10 rules by
  severity rank then affected-page count: rule, impact, help text, helpUrl,
  affected-page count, up to 5 sample URLs, up to 2 capped node HTML
  samples, screenshot when available), remediation priorities (ordered
  list grouped by impact), worst-pages appendix (up to 50 pages by score
  asc with per-page impact counts + "and N more" note), PDF accessibility
  summary (counts only), footer disclaimer ("automated scan, not a legal
  conformance statement") + page numbers via puppeteer footer template.
  All inline CSS; brand colors hard-coded to the Tailwind palette values.
  **Every dynamic string is HTML-escaped** (Codex fix): URLs, client names,
  rule help text, node HTML samples, error text, PDF issue text — via pure
  `escapeHtml()`/`escapeAttr()` helpers, tested with `<script>` and quote
  payloads in node HTML. Impact labels render the `'unknown'` sentinel
  verbatim with a neutral color (never coerced into the four axe impacts).
- `report-data.ts` (this one reads prisma) — `loadSiteReportData(siteAuditId)`:
  goes through the **same read paths as the views** — summary blob or
  `buildSummaryFromFindings()`, score from `CrawlRun.score` else
  `computeScoreFromCounts`, `getSiteAuditInstanceDiff()`, trend series from
  `CrawlRun` rows (`tool='ada-audit'`, `source='site-audit'`, same domain,
  **same wcagLevel**, scored, completed) via `buildSeries()`. Screenshots:
  best-effort, **sourced from child `AdaAudit.result` blobs** (Codex fix —
  `Violation.nodes` stores capped `{html,target}` only and never carries
  `screenshotPath`): for unpruned audits, read `screenshotPath`s from the
  child blobs of the top-issue pages, resolve against `SCREENSHOTS_DIR`,
  read+base64-embed up to 6 total, capped at 300 KB each; missing files
  (24-h sweep) are silently skipped. Archived/pruned audits get **no
  screenshots by contract** (child blobs are nulled and artifacts deleted).
  **Reports are findings-run-only** (Codex plan fix): the loader returns
  `null` when the CrawlRun is missing (pre-A2) or no summary can be built,
  and the POST route rejects pre-A2 audits with 409 `no_findings_run` up
  front — the job's null-handling is a crash-window backstop, not the
  user-visible path.

**Durable `report-render` job** (`lib/jobs/handlers/report-render.ts`):
type `report-render`, concurrency 1, maxAttempts 2, timeout 120 s, payload
`{siteAuditId}`, dedupKey `report:<siteAuditId>`, groupKey
`site-audit:<siteAuditId>` is NOT reused (recovery treats that group as
audit liveness) — use `report:<siteAuditId>` as groupKey too. Handler:

1. Load report data (all awaits BEFORE acquiring a page).
2. Build HTML (pure).
3. `acquirePage()` → `setContent(html, {waitUntil: 'load'})` →
   `page.pdf({format: 'Letter', printBackground: true, margin ~0.5in,
   displayHeaderFooter with page-number footer})` → `releasePage()` in
   `finally`.
4. Write to `REPORTS_DIR/<siteAuditId>.pdf` (atomic: tmp + rename).
5. Update `SiteAudit.reportGeneratedAt` (new column). If the row vanished
   mid-render (P2025), delete the file and settle cleanly.

**Deleted-audit no-ops are explicit** (Codex fix): audit missing at step 1
→ settle complete immediately (no retry burn); audit gone between PDF write
and stamp → delete the file, settle complete. Audit-status guard: only
`complete` audits render; anything else settles as a domain error without
retry. `onExhausted` is log-only — a failed report never touches the audit
row.

**Storage:** `REPORTS_DIR` env, default `./data/reports` locally,
`${DATA_HOME}/reports` added to `ecosystem.config.js`. One file per audit —
regeneration overwrites.

**Routes (cookie-gated):**

- `POST /api/site-audit/[id]/report` — complete-only (409), pre-A2 → 409
  `no_findings_run`, enqueues (deduped); returns `{queued: true}`. Enqueue
  failure → 500.
- `GET /api/site-audit/[id]/report` — streams the PDF
  (`application/pdf`, Content-Disposition
  `ada-report-<domain>-<YYYY-MM-DD>.pdf`) when the file exists; 404
  otherwise.
- `GET /api/site-audit/[id]/report/status` —
  `{state: 'none'|'rendering'|'ready', generatedAt}`: `rendering` when the
  `report:<id>` group has active jobs; `ready` only when
  `reportGeneratedAt` is set **and the file actually exists on disk**
  (Codex fix — never report ready from the column alone); else `none`.

**Why on-demand, not on-completion:** most audits never need a report;
rendering costs a Chrome page and disk. The button regenerates freely
(stale reports after a re-scan are impossible — reports key on the audit id,
and a new scan is a new audit).

**Lifecycle:** report file deleted whenever its SiteAudit row dies (Codex
fix — `pruneScheduledSiteAudits()` currently has NO artifact sweep of its
own; screenshots age out via the 24-h sweep, but report PDFs have no sweep,
so both paths must delete explicitly): the manual DELETE route (alongside
its `deleteAuditArtifacts` loop, plus `cancelJobsByGroup('report:<id>')`
**before** the row delete so queued renders can't resurrect the file —
running renders are covered by the handler's deleted-mid-render cleanup) and
`pruneScheduledSiteAudits()` (snapshot the doomed ids before `deleteMany`,
best-effort unlink after the transaction). Manual-audit reports otherwise
live until their audit is deleted — accepted (one small file per audit,
overwritten on regenerate). Archived
(pruned-blob) audits can still render reports — the data path is the
findings fallback; the report shows the same degraded-contract data (no
screenshots, archivedCounts as "—").

### Feature 4 — VPAT scaffold

**`lib/report/wcag-criteria.ts`** — static table of WCAG success criteria:
`{tag: 'wcag111', criterion: '1.1.1', name: 'Non-text Content', level: 'A',
version: '2.0'|'2.1'|'2.2'}` covering all Level A + AA criteria for WCAG
2.0/2.1, plus the 2.2 AA additions. Axe `wcagTags` entries like `wcag1412`
map by digit-parsing (1.4.12); non-criterion tags (`wcag2a`, `wcag21aa`,
`best-practice`, `cat.*`) are ignored.

**`lib/report/vpat.ts`** — pure
`buildVpatScaffold(input: {domain, auditDate, wcagLevel, rows: ViolationAgg[]}): string`
→ markdown in VPAT 2.4 shape: title + product/date/evaluation-methods
header ("axe-core automated scan via er-seo-tools" + scan stats), a
prominent **"scaffold, not a legal VPAT/ACR — requires human evaluation"**
disclaimer, then Table 1 (Level A) and Table 2 (Level AA), each row =
criterion | conformance | remarks. Honest two-state model (automation can't
prove a pass):

- ≥1 violation tagged with the criterion → **Does Not Support** + remarks
  listing rule ids, affected-page counts, helpUrls (impacts listed verbatim
  incl. the `'unknown'` sentinel).
- otherwise → **Not Evaluated** + "no automated failures detected; manual
  review required."

WCAG 2.2 AA criteria rows included only when the audit ran `wcag22aa`
(otherwise an explicit "not in scan scope" note). Level AAA: out of scope.

**Route:** `GET /api/site-audit/[id]/vpat` (cookie-gated, complete-only) —
aggregates `Violation` rows by criterion tag, streams
`text/markdown` attachment `vpat-scaffold-<domain>-<YYYY-MM-DD>.md`.
Pre-A2 → 409 `no_findings_run`. Works on archived audits.

## Schema changes (one migration)

```prisma
model SiteAudit {
  shareToken        String?   @unique
  shareExpiresAt    DateTime?
  reportGeneratedAt DateTime?
}
```

Hand-written migration SQL (local `prisma migrate dev` is interactive-only),
applied with `prisma migrate deploy`.

## UI surface

`SiteAuditExportBar` — new client component on the site results page
(complete status only), keeping the 517-LOC `SiteAuditResultsView` monolith
out of it: Share button (mirrors `ShareAuditButton` flow), Download CSV
link, Changes CSV link (rendered only when the diff panel has a previous
run — the page already knows), PDF Report button (POST → poll
`/report/status` every 2 s → flip to a download link; shows
`reportGeneratedAt` when one exists), VPAT scaffold link. Buttons match the
existing toolbar idiom (orange accents, dark-mode variants).

## Error handling

- All four routes 404 unknown ids, 409 non-complete audits; CSV/VPAT 409
  pre-A2 audits (`no_findings_run`); changes CSV 409 without a comparable
  previous (`no_previous_run`).
- JSON parses wrapped in try-catch (house rule); blob-corrupt audits fall
  through to the findings fallback exactly like the views.
- Report job: data-load/HTML/PDF failures retry once (attempt 2), then
  log-only exhaustion; the audit row is never flipped by report failures.
- Share page degrades exactly as the internal page does (archived banner,
  "—" counts, legacy "unavailable" card when neither blob nor run exists —
  but share minting requires complete status, so that card is reachable only
  for pre-A2 completes).

## Testing

- `csv.ts`, `vpat.ts`, `wcag-criteria.ts`, `report-html.ts`: pure unit tests
  (RFC-4180 escaping + formula-injection neutralization, HTML escaping with
  `<script>`/quote payloads in node samples, unknown-impact rendering,
  tag→criterion mapping incl. 2.2 gating, section presence/omission,
  sparkline SVG with 0/1/12 points, disclaimer text).
- `diffInstancesDetailed()`: existing `diffInstances` tests keep passing
  (derivation unchanged); new tests for uncapped lists incl. the
  newly-accumulated `notRescannedUrls`.
- Share mint route: mirror of the single-page route tests (rotate, TTL,
  non-complete 409). Share page: DB-backed render tests — fresh blob,
  archived fallback, expired token 404, shareMode suppression (no grouped
  fetch, no triage, no internal links, no drilldown CTAs). Expired
  site-token cleanup covered next to the existing
  `cleanExpiredAdaShareTokens` tests.
- Middleware: `/ada-audit/site/share/x` public + the existing "not public"
  cases still green.
- CSV/changes-CSV/VPAT routes: DB-backed tests (unique domain prefixes,
  tracked-id cleanup; CrawlRun cleaned by domain before origin rows) —
  content asserted on seeded Violation rows, archived-audit path seeded via
  prune, 409 shapes.
- `report-render` handler: mocked browser pool + tmp REPORTS_DIR — happy
  path writes file + stamps `reportGeneratedAt`, audit-deleted-mid-render
  cleans up, non-complete settles without retry, releasePage always called.
  Registration test (job registry includes `report-render`).
- Report routes: status state machine (none/rendering/ready), GET 404
  before render, POST dedup.
- Retention: report file in the `pruneScheduledSiteAudits` snapshot sweep +
  DELETE route test asserts file deletion.

## Out of scope (named follow-ups)

- Standalone single-page audit CSV/VPAT/report.
- Public share page CSV/PDF download buttons (share view stays read-only).
- Expandable page rows on the public share view (needs a token-scoped
  violations API).
- Logo image asset (text wordmark until one is provided).
- Scheduled/automatic report generation or emailing.
- VPAT Section 508/EN 301 549 tables (WCAG tables only).
