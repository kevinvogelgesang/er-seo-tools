# ADA Audit Runner Enhancements — Design Spec

**Date:** 2026-05-12
**Branch:** `feat/ada-audit-runner-enhancements`
**Scope:** PR 1 of 2. UI overhaul (clients view, paginated history) is PR 2 and has its own spec.

## Goals

1. Bump RAM budget so the audit tool can use ~3 GB instead of ~1 GB.
2. Add Lighthouse scans alongside axe-core for every page audit. Run per-page concurrently with the rest of the audit.
3. Add same-domain PDF accessibility scanning. Report findings in a dedicated, copy-paste-friendly section.
4. Mirror the existing cleanup pattern so new on-disk artifacts don't accumulate.

## Non-goals

- Lighthouse mobile config, throttling tuning, or inline HTML report rendering.
- OCR for image-only PDFs, off-site PDFs, full PDF/UA validation.
- Cleaning up old `AdaAudit` / `SiteAudit` rows themselves (separate concern, deferred).
- Re-scanning only LH or only PDFs from a finished audit — the existing re-scan button re-does everything.
- The clients view and paginated recents — those are PR 2.

## Architecture changes

### 1. Browser pool (`lib/ada-audit/browser-pool.ts`)

Three env-tunable knobs:

| Env var | Default | Notes |
|---|---|---|
| `BROWSER_POOL_SIZE` | `4` (was `2`) | Concurrent page slots. |
| `CHROME_MAX_OLD_SPACE` | `512` (was hard-coded `256`) | Chrome's V8 heap ceiling, MB. Threaded into the `--js-flags=--max-old-space-size=N` launch arg. |
| `LIGHTHOUSE_ENABLED` | `true` | Kill switch. When `false`, audits run axe + PDF only with no UI errors. |

Projected memory at full load: 4 slots × ~500 MB resident ≈ 2 GB Chrome, plus Node and pdfjs workers ≈ 2.5–3 GB peak. Comfortable on the 3.82 GB VPS with room left for the OS.

### 2. Lighthouse integration (new `lib/ada-audit/lighthouse-runner.ts`)

- Uses the `lighthouse` npm package, connecting to the pool's existing Chrome instance via CDP.
- Categories: `performance`, `accessibility`, `best-practices`. Desktop config (`screenEmulation.disabled = true`, desktop user agent).
- Per-page timeout: 60s (env: `LIGHTHOUSE_TIMEOUT_MS`). Failure stores `lighthouseError`, does **not** fail the page audit.

**Single navigation per page.** Lighthouse and axe share the same page to avoid loading the URL twice:

1. If `LIGHTHOUSE_ENABLED`: `lighthouse(url, opts, config, page)` — Lighthouse owns the navigation, runs its audits, and returns with the page still loaded.
2. **Reset CDP state Lighthouse left behind** before axe runs: `page.emulateNetworkConditions(null)`, `page.emulateCPUThrottling(1)`, `page.setCacheEnabled(true)`. Without this, axe runs under LH's 4× CPU throttle and 'Slow 4G' network emulation, which slows axe and can affect dynamic checks.
3. Run axe against the loaded page.
4. Harvest same-domain PDF links from the same DOM.
5. Close page. Release slot.

If `LIGHTHOUSE_ENABLED=false`, fall back to the original flow: `page.goto(url)` → axe → harvest → close.

Cross-page concurrency stays at `BROWSER_POOL_SIZE` (LH only blocks its own slot).

**Storage:**
- Raw report serialized as JSON, gzipped, written to `$DATA_HOME/lighthouse-reports/{auditId}.json.gz`. Path overridable via `LIGHTHOUSE_REPORTS_DIR`. Gzip yields ~10× reduction on LH reports (mostly repeated DOM strings).
- Inline summary on a new `AdaAudit.lighthouseSummary` column (JSON string):
  ```ts
  {
    scores: { performance: number, accessibility: number, bestPractices: number },  // 0–100
    cwv: { lcp: number, cls: number, tbt: number, lcpStatus: 'pass'|'needs-improvement'|'fail', ... },
    topFailures: Array<{ id: string, title: string, score: number|null, displayValue?: string, category: 'performance'|'accessibility'|'best-practices' }>  // up to 5
  }
  ```
- New `AdaAudit.lighthouseError` column (nullable string).
- Download route `GET /api/ada-audit/[id]/lighthouse-report` streams `zlib.createGunzip()` so the user receives a plain `.json`.

### 3. PDF discovery + scanning

**Files (new):**
- `lib/ada-audit/pdf-discovery.ts` — `harvestPdfLinks(page, sameDomain): Promise<string[]>` extracts `<a href$=".pdf">` from the loaded page, filters to the audit's domain.
- `lib/ada-audit/pdf-runner.ts` — `scanPdf(url): Promise<PdfScanResult>` fetches the PDF, parses with `pdfjs-dist` (Node-compatible build), runs checks, returns issues.
- `lib/ada-audit/pdf-worker-pool.ts` — independent concurrency limiter, size 4 (env: `PDF_POOL_SIZE`). PDFs do not consume Chrome resources; pdfjs is pure Node.

**Checks (issue codes):**
| Code | Title | Detection |
|---|---|---|
| `not-tagged` | PDF lacks structure tags for screen readers | `StructTreeRoot` missing from catalog |
| `no-title` | Document title not set in metadata | `metadata.info.Title` empty/missing |
| `no-language` | Document language not declared | `metadata.info.Lang` and `catalog.lang` both missing |
| `image-only` | PDF contains no extractable text | Page text extraction returns empty across all pages |
| `at-restricted` | Encrypted with assistive-tech access blocked | `encrypt` set with `EncryptMetadata` flag blocking copy/AT |
| `large-file` | File over 10 MB may be slow to load | `Content-Length` > 10 MB |
| `many-pages` | Over 50 pages — consider HTML alternative | `numPages` > 50 |

Each issue has: `code`, `severity` (`high` | `medium` | `low`), `title`, `description`, `remediation`. Remediation strings are written for a non-developer audience.

**URL normalization (before dedup).** A `normalizePdfUrl(raw)` helper in `pdf-discovery.ts` produces the canonical form used for dedup and stored on `PdfAudit.url`:
- Strip query string and fragment (`?version=2`, `#page=4` → gone).
- Lowercase host.
- Resolve to absolute URL against the page being scanned.
- Preserve path case (`/Docs/Foo.pdf` ≠ `/docs/foo.pdf` on case-sensitive servers).

Without normalization, `/doc.pdf` and `/doc.pdf?utm_source=email` would be scanned as two distinct files.

**Dedup:** unique by `(siteAuditId, normalizedUrl)` for site audits, and by `(adaAuditId, normalizedUrl)` for standalone single-page audits. A PDF linked from 5 pages in a site audit = 1 scan. PDFs are scanned for both single-page and site audits — single-page audits attach `PdfAudit` rows via `adaAuditId`; site-audit page scans attach via `siteAuditId` (the parent), not the per-page `AdaAudit`.

**Persistence:** new `PdfAudit` Prisma model:

```prisma
model PdfAudit {
  id           String     @id @default(cuid())
  createdAt    DateTime   @default(now())
  siteAuditId  String?
  siteAudit    SiteAudit? @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)
  adaAuditId   String?    // For single-page audits without a parent site audit
  adaAudit     AdaAudit?  @relation(fields: [adaAuditId], references: [id], onDelete: Cascade)
  url          String
  fileSize     Int?       // bytes
  pageCount    Int?
  status       String     // pending | scanning | complete | error
  issues       String?    // JSON: array of PdfIssue
  scanError    String?

  @@index([siteAuditId])
  @@index([adaAuditId])
}
```

### 4. Cleanup

`lib/cleanup.ts` gains `cleanExpiredLighthouseReports()`, mirroring `cleanExpiredScreenshots()`:

- Walks `lighthouse-reports/`, deletes any `{id}.json.gz` whose matching `AdaAudit` is missing or older than 180 days.
- Added to the daily `runCleanup()` `Promise.allSettled([...])`.

Manual-delete code paths also clean up:

- `DELETE /api/ada-audit/[id]` — already calls `deleteScreenshots(id)`; **adds** `deleteLighthouseReport(id)`.
- `DELETE /api/site-audit/[id]` — currently DB-cascades child AdaAudits but **leaves screenshot directories orphaned** (latent bug). Fixed in this PR: query child `AdaAudit.id`s first, call both `deleteScreenshots` + `deleteLighthouseReport` for each, then cascade DB delete.

`PdfAudit` rows have no on-disk artifacts and cascade via the FK, so no new cleanup is required for PDFs.

## Schema migration

```diff
 model AdaAudit {
   ...
+  lighthouseSummary String?
+  lighthouseError   String?
+  pdfAudits         PdfAudit[]
 }

 model SiteAudit {
   ...
+  pdfsTotal     Int        @default(0)
+  pdfsComplete  Int        @default(0)
+  pdfsError     Int        @default(0)
+  pdfAudits     PdfAudit[]
 }

+model PdfAudit { ... see above ... }
```

Migration name: `add_lighthouse_and_pdf_audits`.

## Data flow per page (one browser pool slot)

1. Acquire pool slot. Open page.
2. If `LIGHTHOUSE_ENABLED`: `lighthouse(url, opts, config, page)` runs and returns with page loaded.
3. Reset CDP throttling/emulation/cache state Lighthouse left behind.
4. Run axe against the loaded page.
5. Harvest same-domain PDF links from the same DOM.
6. Write Lighthouse gzipped JSON to disk (if it ran).
7. Close page. Release pool slot.
8. Update `AdaAudit` row in one write (axe `result`, `lighthouseSummary` or `lighthouseError`, `progress`/`progressMessage`).
9. Increment `SiteAudit.pdfsTotal` by the count of unique normalized PDF URLs newly discovered on this page. Harvested PDF URLs feed the **separate** `pdf-worker-pool`. PDF scans run in the background; deduped against existing `PdfAudit` rows for this `siteAuditId`.
10. PDF worker completes a scan → writes `PdfAudit` row → increments `SiteAudit.pdfsComplete` or `pdfsError`. Updates `SiteAudit.progressMessage` to "Analyzing PDFs: N/M".
11. `SiteAudit.status = 'complete'` only when `pagesComplete === pagesTotal` **and** `pdfsComplete + pdfsError === pdfsTotal`.

This means a page audit row finishes and is viewable before its PDFs do — that's fine because PDFs are surfaced in a separate top-level section, not inline with the page. The UI (PR 2) can distinguish the "pages done, PDFs still scanning" sub-phase by reading `pagesComplete === pagesTotal && pdfsComplete + pdfsError < pdfsTotal` so users don't think the audit has hung at 100% page progress.

## UI surfacing (minimal — full overhaul is PR 2)

### Single-page audit (`AuditResultsView.tsx`)
New "Lighthouse" section between the existing scorecard and violations. A "PDFs Found" section below violations renders iff PDFs linked from the page were scanned, using the same card + copy-button format as the site audit's PDFs section.

Lighthouse section shows:
- Three score rings (Perf / A11y / BP) with 0–100 numbers and pass/fail color (≥90 green, ≥50 amber, <50 red — Lighthouse's own thresholds).
- LCP / CLS / TBT row with value and pass/fail badge.
- Top 5 failing audits as a compact list: title + score + displayValue. Click expands to show description.
- Link "Download full Lighthouse report (JSON)" pointing at `/api/ada-audit/[id]/lighthouse-report`.
- If `lighthouseError` is set: small amber note "Lighthouse failed: {error}". No empty section.

### Site audit (`SiteAuditResultsView.tsx`)
- **Per-page detail view:** same Lighthouse section as single-page.
- **New top-level "PDFs Found" section**, only rendered if `pdfAudits.length > 0`. Sits above the existing per-page list.
  - Header row: PDF count + total issues + "Copy all" button.
  - One card per PDF: filename / URL / file size / page count / issue list.
  - Each card has its own "Copy" button → clipboard contains the plain-text block for that PDF only.
  - Plain-text format example (per Q4 answer):
    ```
    foo.pdf — https://example.edu/docs/foo.pdf (1.2 MB, 12 pages)
    • Not tagged for screen readers — PDF lacks a structure tree, so assistive
      technology reads content in random order. Fix: re-export from source with
      "Tagged PDF" enabled, or open in Acrobat Pro → Prepare for Accessibility.
    • No document title set — Title metadata is empty, so screen readers
      announce the filename instead of a meaningful title. Fix: in Acrobat,
      File → Properties → Description → set Title.
    ```
  - "Copy all" produces the concatenation of every PDF's block, separated by blank lines.

## SQLite concurrency

`lib/db.ts` already configures the right PRAGMAs at import time: `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`, `foreign_keys=ON`, `temp_store=MEMORY`. Prisma's SQLite driver serializes writes through a single connection, so 4 browser + 4 PDF workers (8 concurrent writers max) become a serialized queue rather than a contention storm.

**One tightening this PR will do:** the PRAGMA calls in `lib/db.ts` are currently fire-and-forget (`void prisma.$executeRawUnsafe(...).catch(() => {})`). On cold start under concurrent load this races with the first real query. Convert to an awaited init function called from `instrumentation.ts` before the queue processor starts, so WAL mode is guaranteed active before the first write.

## Dependencies added

- `lighthouse` (npm) — current latest, peer-compatible with installed `puppeteer-core` major.
- `pdfjs-dist` (npm) — use the legacy Node build path documented by Mozilla; works without `canvas` since we don't render pages.

## Acceptance criteria

- `BROWSER_POOL_SIZE=4`, `CHROME_MAX_OLD_SPACE=512` honored by Chrome launch args.
- A site audit of a 50-page site processes 4 pages concurrently, peak resident memory under 3 GB.
- Each page is loaded exactly once. Network panel of a single page audit shows one document load, not two.
- After Lighthouse runs, axe is not affected by CPU/network throttling — verified by adding a temporary `console.time/timeEnd` around `axe.run()` and comparing against an `LIGHTHOUSE_ENABLED=false` run; difference should be within 20%.
- Single-page audit completes with both axe and Lighthouse sections visible. Failed Lighthouse degrades gracefully (no UI crash, small inline error note).
- Site audit detail page renders "PDFs Found" section iff at least one PDF was scanned. Per-PDF copy and copy-all both produce the documented plain-text format.
- A site that links to `/doc.pdf` and `/doc.pdf?utm=email` from different pages produces exactly **one** `PdfAudit` row, not two.
- `SiteAudit.status` does not flip to `complete` until both `pagesComplete === pagesTotal` and `pdfsComplete + pdfsError === pdfsTotal`. Until then, `progressMessage` reflects whichever phase is currently active.
- `cleanExpiredLighthouseReports()` runs in the daily cleanup; deletes `.json.gz` files older than 180d or with no matching `AdaAudit`.
- `DELETE /api/site-audit/[id]` no longer leaves orphan screenshot directories on disk.
- Setting `LIGHTHOUSE_ENABLED=false` cleanly skips Lighthouse end-to-end: no on-disk file, no DB column writes for LH, UI hides the Lighthouse section without errors.

## Open considerations carried forward

- **DB row cleanup gap:** `AdaAudit` and `SiteAudit` rows are never auto-deleted. Storage math (~150 MB/month of axe JSON in SQLite) says we have years of runway. Revisit after PR 2 ships or once disk hits 50%.
- **PDF false positives:** the lightweight check set will sometimes flag a tagged PDF as untagged if its structure tree uses uncommon constructs. Acceptable for v1 — clients get a "direction to go" not a compliance certificate.
