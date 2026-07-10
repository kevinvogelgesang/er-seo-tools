# Audit Consolidation Batch — Design

**Date:** 2026-07-08 · **Status:** approved by Kevin (brainstorm session) ·
Codex-reviewed (accept-with-named-fixes ×12, applied 2026-07-08)
**Scope:** four sequenced projects (PR0 → P1 → P2 → P3), then C14 (prospect/demo
view) becomes the next roadmap priority. This is the umbrella spec: PR0 is fully
specified here; P1–P3 each get their own plan (and deeper spec where needed) via
the normal ritual when they start. Decisions recorded here are settled — do not
re-litigate them in the per-project cycles.

---

## Motivation

- `/ada-audit` (Site Audits) and `/seo-audits` (SEO Audits) are two front doors
  to the same pipeline: the Full Site form's Scan Type toggle
  (`components/ada-audit/SiteAuditForm.tsx:453-480`) and the SEO URL scan form
  (`components/seo-parser/SeoScanForm.tsx:150-153`) both POST
  `/api/site-audit` (the latter with `seoOnly: true`). The Scan Type selector
  negates the need for a separate SEO Audits page.
- The "Mine" recents filter has been broken for site audits since the SSO
  migration (root cause below).
- SEO scan progress UX is immature: static pill during the crawl, no live
  history rows, manual click-through on completion.
- The site-audit results page buries SEO and ADA content in one long scroll,
  the triage button floats in the header, and site-wide patterns show only a
  CSS selector — no screenshots or element HTML.

## Priority order (tracker)

**C15 (PR0 Mine fix) → C16 (P1 consolidation) → C17 (P2 progress) → C18 (P3
results pass) → C14 (prospect sales audit view).**
C18 absorbs C13's UI items; C13 retains only the Bellus scorecard
investigation.

---

## PR0 — Fix the "Mine" filter (C15; bug fix, hours)

**Root cause (verified 2026-07-08):**

- Read side: `/api/ada-audit/recents?scope=mine` filters
  `where: { requestedBy: operator }` (`lib/ada-audit/recents-query.ts:51,55`)
  where `operator = getOperatorLabel(authCookie, operatorCookie)`
  (`lib/auth.ts:45-52` — prefers the verified SSO session,
  `session.name ?? session.email`; legacy `er-operator-name` cookie only as
  fallback).
- Single-page ADA audits write consistently:
  `app/api/ada-audit/route.ts:56-59` sets `requestedBy = getOperatorLabel(…)`.
- **Site audits do not:** `app/api/site-audit/route.ts:34` and
  `app/api/site-audit/bulk-queue/route.ts:17` set
  `requestedBy = sanitizeOperatorName(er-operator-name cookie)`. That cookie is
  written only by the password login route (`app/api/auth/login/route.ts:61-72`);
  the Google OAuth path never sets it. Under SSO,
  `sanitizeOperatorName(undefined) → null`, so every site audit (including
  seoOnly scans) gets `requestedBy = null` and can never match "Mine".

**Fix:** both site-audit routes derive `requestedBy` via
`getOperatorLabel(authCookie, operatorCookie)`, identical to the ada-audit
route. Scheduled audits keep writing the literal `'scheduled'`
(`lib/jobs/handlers/scheduled-site-audit.ts:116`) — unchanged. Note the fix
also cures a live misattribution bug, not just nulls: a stale legacy
`er-operator-name` cookie left over from the password era currently WINS over
the SSO identity on site-audit creation; `getOperatorLabel` prefers the
verified session (Codex fix #1).

**No backfill.** Post-SSO null rows carry no identity to recover; pre-SSO rows
store typed short names ("Kevin") that cannot be safely mapped to Google
display names. "Mine" heals forward from the fix.

**Tests (Codex fix #1):** route tests on `POST /api/site-audit` + bulk-queue
covering all four `getOperatorLabel` branches: verified session name → name;
session without name → email; no session but legacy cookie → sanitized cookie
value (the helper's documented fallback — "no session" does NOT mean null);
neither → null. No migration; no UI change.

---

## P1 — Audit consolidation (C16): full merge, Site Audits wins

### Navigation & naming

- One sidebar group **"Audits"** (name approved by Kevin — the section now
  includes single-page audits and SF uploads, so "Site Audits" would be wrong)
  replacing both the `site-audit` and `seo-parser` entries in
  `lib/tools-registry.ts:43-57`. Children: **Run an audit · Audit queue ·
  Recents · Compare crawls**.
- `/ada-audit` remains the canonical URL for the merged section.
- **Registry keeps ownership of `/seo-audits/*` (Codex fix #2):** the
  retained result/compare routes must still resolve via `toolForPathname()`
  (breadcrumbs/topbar context). Keep a hidden (non-nav) registry definition —
  or path aliases on the "Audits" entry — covering `/seo-audits`; only the
  visible nav collapses to the one `/ada-audit` group. The footer's SEO Audits
  index link (`components/footer.tsx`) is updated in the same pass (Codex
  verify item).

### Scan entry

- `components/ada-audit/AuditIndexTabs.tsx`: tab order **Site Audit first and
  default**, Single Page second (absorbs the C13 tab-order item; current
  default is `'single'` at `:35-40`). "Full Site" label → "Site Audit".
  Existing deep-link params (`?auditTab=`, `?prefillDomain=`) keep working.
- The Full Site form's Scan Type group (Accessibility | SEO) is unchanged.
- **SF uploads:** when Scan Type = SEO, the form reveals an optional,
  collapsed-by-default "Have Screaming Frog exports?" section hosting
  `SeoUploadCard` (moved from `/seo-audits`). No standalone upload page
  remains.

### Unified history

- One recents table mixing all four record types with a type badge column:
  **Site ADA · Site SEO · Single Page · SF Upload**, plus the existing
  All/Mine toggle (`components/ada-audit/RecentsTable.tsx:48-60` grows to
  merge `Session` rows into the feed).
- **Session selection (Codex fix #5):** only `Session.workflow = 'technical'`
  rows enter the "SF Upload" type — keyword-research sessions are a different
  product surface and stay out of the audit feed.
- **Ordering & pagination (Codex fix #5):** stable global order
  `(createdAt DESC, type, id)` across all three models. Per-source offset
  pagination merged client-side is WRONG beyond page one; either (a) fetch
  `limit` rows from each source and slice for a single bounded first page with
  a cursor `(createdAt, type, id)` for "load more", or (b) a single UNION-style
  query. The plan picks one and tests page-two correctness.
- **Feature parity (Codex fix #6):** retiring `HistoryList` must not silently
  drop session **deletion, search, and client filtering** — the unified
  recents keeps these capabilities (delete on SF-upload rows; search/client
  filter over the merged feed). Removing any of them is a Kevin decision, not
  a side effect.
- **Additive migration:** `Session.requestedBy String?` (+ index consistent
  with the other two models), stamped via `getOperatorLabel` **only when
  `/api/upload` creates a new session — never overwritten when a later request
  appends files to an existing pending session** (Codex fix #7). Legacy
  sessions (null) simply never match "Mine".
- Compare crawls stays a nav child; its page and URL are untouched.

### Routing & seoOnly behavior

- `/seo-audits` **index** 308-redirects to `/ada-audit` — via
  `permanentRedirect()`, not `redirect()` (which emits 307; Codex note).
  Deeper paths stay live: `/seo-audits/results/*` (and the share/compare
  routes) keep their URLs — links in existing memos/history must not break.
  (Precedent: the old `/seo-parser` → `/seo-audits` 308.)
- **seoOnly audits stop redirecting away from `/ada-audit/site/[id]`**
  (today: `app/(app)/ada-audit/site/[id]/page.tsx:48-49` via
  `seo-only-redirect.ts`). New behavior:
  - transient statuses → render `SiteAuditPoller` there (granular
    pages-complete bar already built — head start on P2);
  - `complete` → redirect to the SEO results run page
    (`/seo-audits/results/run/[liveScanRunId]`); if the live-scan run isn't
    ready yet, show the existing `SeoPhaseBanner` state until it is.
  - **Branch placement (Codex fix #4):** the seoOnly branch must run
    immediately after the terminal error/cancelled handling and BEFORE the
    ADA summary/findings-fallback resolution — a seoOnly audit has neither an
    ADA summary nor an ada-audit CrawlRun, so the current complete-page flow
    would dead-end at "Result data unavailable".
- **All `?scan=`/seoOnly link producers updated, not just `SeoScanForm`
  (Codex fix #3):** enumerate and update `SiteAuditForm` (its SEO-success
  redirect), `QuickSiteAuditWidget`, `LiveNowWidget`, `QueueMemberRow`,
  `DashboardQueueStatus`, `ScheduledScansCard`, the client-dashboard
  link-builders, and `components/footer.tsx`. Rule: in-flight seoOnly rows
  link to `/ada-audit/site/[id]` (the poller); completed rows with a live-scan
  run link to `/seo-audits/results/run/[runId]`. `SeoScanForm` + its `?scan=`
  handoff are then retired. (D7 note: the notify checkbox also lives on
  `SiteAuditForm`, so retiring `SeoScanForm` loses nothing — verified.)
- ADA surfaces keep excluding/SEO-labelling seoOnly rows per current
  invariants (CLAUDE.md site-audit phase model) — the unified recents list
  labels them "Site SEO".

---

## P2 — Progress maturation (C17)

- **Verifier phase surfaced:** `SiteAuditPoller` renders the seoOnly
  "building" sub-phase from `GET /api/site-audit/[id]`'s
  `seoPhase{state,progress,message}` (`app/api/site-audit/[id]/route.ts:104-106`)
  so there is no dead gap between crawl-done and results-ready.
- **Poller terminal semantics (Codex fix #8):** `useAuditPoller` currently
  treats `status === 'complete'` as terminal — exactly when a seoOnly audit
  enters the verifier phase. For seoOnly, parent completion stays
  NON-terminal while `seoPhase` is queued/running; polling stops only on
  run-ready (`liveScanRunId` present), failed, or unavailable.
- **Auto-transition:** when the run is ready, the poller auto-navigates to the
  results page — through a SINGLE navigation owner: an explicit
  redirect outcome that suppresses the hook's unconditional
  `router.refresh()`, never `router.replace()` racing a refresh (Codex fix
  #8). Full (ADA) audits likewise flip to their results view without user
  action — the requirement is that *no* click is needed anywhere on
  completion.
- **Live history rows (Codex fix #9):** in-flight rows in the unified recents
  table live-update WITHOUT re-fetching the whole merged history every 8s —
  the full recents query can parse legacy blobs for scores. Poll a compact
  status/progress endpoint for the visible in-flight IDs only; refresh the
  merged list once they settle. Polling stops when nothing is in flight.
- Single-page audits are already granular (1s poll, phase messages) —
  untouched.

---

## P3 — Results-page pass (C18)

Applies to the full-audit results page
(`app/(app)/ada-audit/site/[id]/page.tsx` + `SiteAuditResultsView`). seoOnly
audits land on the SEO results run page and are unaffected except where noted.

- **Layout: shared header + tabs.** Header keeps domain, ADA score
  (`AuditScorecard` summary), SEO score, `SiteAuditExportBar`, and
  `SiteAuditDiffPanel`. Below it, two tabs:
  - **Accessibility:** compliance banner, scorecard tiles, site-wide patterns,
    pages-with-issues (table / by-violation views), redirects, clean pages,
    PDF issues.
  - **SEO:** BrokenLinks, OnPageSeo, TechnicalSeo, DiscoveryCoverage,
    Reachability, ContentSimilarity sections (current stack at
    `page.tsx:237-256` moves inside the tab).
  - **Share view (Codex fix #11):** `shareMode` gets the same tab split, but
    ALL SEO tab data is loaded server-side by the token-validated share page —
    the share view keeps its zero-cookie-gated-fetch rule. Pattern screenshots
    and element-detail dropdowns are OMITTED in `shareMode` (both
    `/api/ada-audit/screenshots/*` and `/api/ada-audit/[id]` are cookie-gated;
    the screenshot prefix is NEVER made globally public — audit IDs and
    filenames are not authorization). Rich public drill-down is C14's job.
- **Triage** toggle moves from the header card
  (`SiteAuditResultsView.tsx:152-162`) into the Pages with Issues section
  header.
- **Site-wide patterns matured** (`components/ada-audit/CommonIssueCallout.tsx`):
  each pattern card becomes expandable; the dropdown shows
  (a) **one representative element screenshot** — served via the existing
  `/api/ada-audit/screenshots/{auditId}/{file}` route from per-node
  `screenshotPath` data (`lib/ada-audit/types.ts:25-31`; today only the
  single-page view renders these, `AuditIssueCard.tsx:196-227`),
  (b) the **list of unique affected elements with their HTML** + selector,
  (c) the "View affected pages →" link is **removed** (C13 decision).
  - **Data source (Codex fix #10):** `CommonIssue` carries selector metadata
    but NO node HTML, screenshot filename, or child audit id — the dropdown
    cannot be built from the summary alone. P3's plan specifies a **bounded
    server loader**: resolve the pattern's representative page (the example
    page already on the issue), load that ONE child audit's stored results,
    and extract its nodes for this rule — never fan out across every affected
    page. "Unique affected elements" = deduplicated nodes from the
    representative page (bounded), labelled as a sample, not a site-wide
    exhaustive list.
  - **Archived degradation (Codex fix #12):** on 90-day-pruned audits the
    child blobs are nulled and screenshot files deleted; the findings fallback
    preserves at most ~5 capped nodes per page with HTML/targets and no
    screenshot paths. The dropdown renders the capped element sample without
    images and its copy says the sample is capped — it must not promise the
    original complete element list.
- **C13 ride-alongs:** reword "Pages are audited one at a time"
  (`SiteAuditPoller.tsx:204`); collapse/soften `KnownLimitationsNotice`;
  paginate Pages with Issues at 25 (currently 50).
- **Stays out:** the Bellus "0 rules passed – 0 needs review" scorecard
  investigation remains its own C13 item (possible data bug, root-cause
  first).

---

## Testing & verification (batch-level)

- PR0: route-level tests (session-derived `requestedBy`).
- P1: registry/nav drift tests, redirect tests (`/seo-audits` index 308,
  results subpaths untouched), unified-recents query tests (type badges +
  Mine semantics incl. `Session.requestedBy`), seoOnly site-page behavior
  tests (poller when transient, redirect when complete).
- P2: poller phase-rendering tests (seoPhase), auto-navigation test,
  history smart-poll gating test.
- P3: component tests for tab split (incl. shareMode), triage placement,
  pattern dropdown states (screenshot present / archived-degraded).
- Each project runs the standard gates (tsc · vitest · build) + authed
  browser verification per house convention.

## Risks / notes

- Unified history merges two data sources (audits + sessions) — keep the
  query cheap (indexed, paginated) and resist N+1 joins.
- `/seo-audits` index redirect must not catch its own subpaths.
- Pattern screenshots depend on child-audit blobs; the 90-d prune deletes
  them — the dropdown must not assume image presence.
- P1 changes where SEO scans land (progress on the site page) — update any
  copy/links that pointed at `/seo-audits?scan=`.
