# Prospect Sales Audit View (C14) — Design

**Date:** 2026-07-09
**Status:** Approved by Kevin (brainstorm 2026-07-09); Codex-reviewed
(accept-with-named-fixes ×9, all applied)
**Tracker:** C14 in `../todos/2026-06-10-improvement-roadmap-tracker.md`
**Relation to C18:** designed to land after C18 (results-page reorg); file
footprints are disjoint except one shared seam (see §10).

## 1. Purpose

Sales scans a PROSPECT's website before a meeting and presents a branded,
pruned results page live in the meeting, then sends the same link to the
prospect as a leave-behind. Progressive disclosure: section-level scores and
plain-English counts up front, each section expandable to a bounded set of
REAL demonstrable issues — "don't dangle a carrot without being able to show
it's a carrot." The page is a persuasion surface, not a work surface.

Policy: scanning prospect (non-client) domains is owner-sanctioned business
use (Kevin 2026-07-07). The "never scan third-party sites" rule stays for
dev/testing — all dev verification uses seeded synthetic data.

## 2. Decisions (locked in brainstorm)

| Question | Decision |
|---|---|
| Who runs it | Sales, self-serve, via existing Google SSO (no new auth tier) |
| Onboarding | Minimal dedicated intake page; NO in-app walkthrough (2-min Loom instead). Output is NOT minimal — full presentational treatment |
| Link usage | Live in meeting + leave-behind → content must read well unattended; 30-day TTL |
| v1 sections | Accessibility, SEO, Core Web Vitals, GEO (schema slice). E-E-A-T out (not derivable) |
| Data model | Lightweight `Prospect` model (re-scans grouped per prospect, stable link) |
| Drill-down depth | Curated examples w/ screenshots, token-scoped — never the full dataset |
| CTA | Salesperson attribution + contact CTA block |
| Architecture | **Approach A**: purpose-built sales view layer; reuses the data layer, NOT `SiteAuditResultsView` |

Rejected approaches: (B) `salesMode` on `SiteAuditResultsView` — collides
with C18's active rewrite and fights the internal information architecture;
(C) frozen snapshot artifact — adds an artifact lifecycle for little gain
(links live 30 d, blobs 90 d, and every section has a findings fallback).

## 3. Data model

New model:

```prisma
model Prospect {
  id                  Int         @id @default(autoincrement())
  name                String      // display name, e.g. "Acme College"
  domain              String
  notes               String?
  createdBy           String?     // SSO operator label at creation
  salesToken          String?     @unique
  salesTokenExpiresAt DateTime?
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt
  siteAudits          SiteAudit[]

  @@index([domain])
  @@index([salesTokenExpiresAt])
}
```

`SiteAudit.prospectId` gets `@@index([prospectId])` (Codex fix #6 — the
cleanup sweep, prospect list, and latest-audit queries must not table-scan).

**Prospect dedupe (Codex fix #7):** one Prospect per normalized domain,
best-effort app-level (the client-schedules precedent, no DB unique). The
create route checks for an existing prospect with the same normalized
domain and returns it (409-style `{existing}` payload); the intake UI then
offers "Re-scan existing prospect" instead of silently creating a duplicate
whose stable link would fragment.

`SiteAudit` gains nullable `prospectId Int?` + `prospect Prospect?`
relation (`onDelete: SetNull` — mirrors `clientId`). A prospect scan is a
**full** audit (axe + PSI + live-scan SEO; NOT `seoOnly` — the Accessibility
and CWV sections need that data), created with `prospectId` set and
`clientId` null, running through the normal queue unchanged.

Additive migration also adds nullable `CrawlRun.schemaTypesJson String?`
(see §6 GEO).

**Token semantics:** one stable link per prospect. The public page resolves
`salesToken` → Prospect → **latest reportable** audit for that prospect.
"Reportable" (Codex fix #4) = `status='complete'` **AND the live-scan
`seo-parser` CrawlRun exists** — the finalizer flips the parent to
`complete` BEFORE the broken-link-verify builder writes the SEO run, so a
plain latest-complete rule would render a report with empty SEO/GEO
sections during the verifier window (exactly when sales copies the link).
If a newer audit is complete but not yet reportable, the previous
reportable audit keeps serving. Re-scan before a meeting → same link shows
fresher data once reportable. (Accepted trade-off, Kevin to confirm: a
leave-behind's content changes silently after a re-scan — the stable-link
semantics are intentional; §5's rendered-audit pinning keeps any single
page-load internally consistent.)
TTL 30 days (`SALES_TTL_MS`, same shape as C4's `SHARE_TTL_MS`); "Copy
sales link" **POSTs** to the share route, which extends-or-rotates exactly
like `app/api/site-audit/[id]/share/route.ts` (extend
`salesTokenExpiresAt` if valid, rotate `crypto.randomUUID()` if
missing/expired); **GET is read-only** (returns the current token or null,
never mutates expiry — Codex fix #9). The cleanup sweep
(`lib/cleanup.ts` expired-share block) gains a Prospect clause nulling
expired `salesToken`/`salesTokenExpiresAt`.

**Visibility:** prospect audits never touch Client surfaces (client pages,
schedules, client-findings). They DO appear in unified recents with a
**"Prospect"** badge (they are real site audits; hiding them from ops
surfaces would hurt debuggability). They are manual-class for retention
(`scheduleId` null → never pruned by `pruneScheduledSiteAudits`).
Prospect DELETE (v1: allowed from the intake page) SetNulls its audits'
`prospectId`; the audits themselves follow existing manual-audit lifecycle.

## 4. Sales intake page — `/sales` (cookie-gated)

Nav entry "Prospect Scans". Deliberately minimal, one screen:

- **New prospect scan** card: prospect name + domain → creates the Prospect
  row and enqueues a full site audit. Re-uses the existing
  `queueSiteAuditRequest` path; the route is a thin cookie-gated wrapper
  (`POST /api/sales/prospects` create; `POST /api/sales/prospects/[id]/scan`
  re-scan) that sets `prospectId` server-side. `requestedBy` via
  `getOperatorLabel` (SSO-aware — the C15 pattern, NOT the legacy cookie).
- **Prospect list**: name, domain, latest-scan status with live progress
  (reuse the C17 compact polling pattern — `useRecentsLivePoll` /
  `GET /api/ada-audit/recents/status`), headline scores once complete,
  **Copy sales link** (calls the token extend-or-rotate route,
  `GET/POST /api/sales/prospects/[id]/share`), **Re-scan**, delete.

No walkthrough. Salespeople authenticate with the existing Google SSO; the
page is inside the normal `(app)` cookie gate.

## 5. Public sales view — `/sales/[token]`

Server component under the `(public)` route group,
`dynamic = 'force-dynamic'`, zero cookie-gated client fetches (C4 share
rule). Not-found/expired token → `notFound()`. Valid token but no completed
audit yet → friendly "your report is being prepared" page (NOT 404).

**Page structure (top to bottom):**

1. **Hero** — ER branding; "Website Opportunity Report — prepared for
   *{prospect.name}*"; domain; scan date; pages scanned. Four headline
   tiles: Accessibility score · SEO score · Performance grade ·
   Structured Data coverage — color-graded (red/amber/green) for
   across-the-table readability.
2. **Four section cards** — progressive disclosure:
   - Collapsed: score/grade + 2–4 plain-English headline counts
     ("23 broken links · 14 pages missing titles"). No issue dump.
   - Expand level 1: short canned "why this matters to enrollment"
     paragraph + issue-type groups with counts.
   - Expand level 2 (per group): **3–5 curated real examples** — element
     screenshot where available, offending HTML/URL, one-line plain-English
     consequence.
3. **CTA footer** — "Prepared by *{createdBy}* — Enrollment Resources",
   contact email (new env `SALES_CONTACT_EMAIL`, default
   `kevin@enrollmentresources.com` — same pattern as `NOTIFY_FROM`), short
   closing copy.

Responsive + print-friendly (projector in meeting, phone for leave-behind).

**Per-section content and sources:**

| Section | Content | Source |
|---|---|---|
| Accessibility | ADA score, compliance statement, top site-wide patterns w/ ONE representative screenshot + bounded affected-element sample each | `SiteAudit.summary` blob or `buildSummaryFromFindings` fallback; canonical score from ada-audit `CrawlRun.score`; representative-page loader (C18 seam, §10) |
| SEO | live SEO score, broken links/images w/ example URLs, on-page issues w/ example pages, duplicate-content groups, sitemap coverage gap | live-scan `CrawlRun` (`siteAuditId_tool`): findings + `scoreBreakdown` + `contentSimilarityJson` + `discoveryCoverageJson` |
| Performance | p75 LCP/CLS + TBT, % pages passing, perf-score distribution, worst-page examples ("how long your applicants wait") | per-page child `AdaAudit.lighthouseSummary` rows (survive 90-d pruning); NEW pure aggregation (§6). **Honest labeling (Codex fix #8):** this is Lighthouse *lab* data — TBT is a proxy, not a Core Web Vital, INP isn't captured, and it's not CrUX field data. Section title "Performance", copy says "Lighthouse-measured"; never claim "Core Web Vitals pass/fail" |
| GEO (schema slice) | schema coverage %, schema-type histogram ("no Course or FAQPage structured data — AI search can't recommend your programs"), hreflang/canonical findings if present | `scoreBreakdown` schema factor + NEW `CrawlRun.schemaTypesJson` (§6) + validation findings |

**Evidence curation rule (the safety boundary):** all selection happens
server-side. Rank issue types by severity × count; cap examples per type
(≤5) and screenshots (one per pattern, via the representative-page loader —
never fan out across child audits). The token grants access ONLY to what
the loader chose — never the full pages-with-issues dataset, arbitrary
screenshots, or any internal API. No internal links anywhere on the page.

**Rendered-audit pinning (Codex fix #3):** the page embeds the resolved
audit identity in every screenshot URL it renders. If a re-scan completes
between the HTML render and the image requests, the screenshot route must
NOT re-resolve "latest reportable" independently — it authorizes the
`{adaAuditId, file}` in the URL against the token's prospect (ownership
chain), so an already-open report keeps loading its own images.

## 6. New server pieces (all pure/testable)

- **`lib/sales/sales-report-data.ts`** — `loadSalesReportData(token)`:
  token+expiry validation → prospect → latest **reportable** audit (§3) →
  all four sections' data in one pass, including curated-example
  selection. The screenshot route shares the token/prospect validation
  helper but does its own ownership-chain check against the URL's pinned
  audit id (§5) — it never re-resolves "latest".
- **`lib/sales/cwv-aggregate.ts`** — pure `LighthouseSummary[]` → site
  roll-up: p75 LCP/CLS/TBT, pass %, perf-score distribution, worst pages.
  Degrades below a floor (< 3 measured pages → "measured on N pages" copy
  or hide the distribution).
- **`lib/sales/copy.ts`** — ALL canned persuasion copy (section intros,
  consequence one-liners keyed by issue type/axe rule family, CTA text) in
  one editable module; components stay copy-free.
- **Builder addition** (`lib/jobs/handlers/broken-link-verify.ts`):
  aggregate schema-type histogram from
  `HarvestedPageSeo.detailsJson.schemaTypes`, computed BEFORE transient
  deletion (same seam as Phase 5 content similarity), written to new
  nullable `CrawlRun.schemaTypesJson`. **Versioned shape with denominators
  (Codex fix #5):** `{v: 1, observedPages, pagesWithSchema, types:
  [{type, pages}]}` (types bounded to top ~20) — coverage % is computed
  from these raw counts, NOT from `scoreBreakdown`'s schema factor (that's
  weighted score data, not a denominator). Fail-to-null; never fails the
  run write. Benefits all future audits, not just prospects.
- **`app/api/sales/[token]/screenshot/[adaAuditId]/[file]/route.ts`** —
  token-validated streaming of screenshot artifacts. Filenames like
  `color-contrast-0.png` are only unique per child audit
  (`SCREENSHOTS_DIR/<adaAuditId>/<file>`), so the public URL carries the
  child audit id (Codex fix #2). Authorization = ownership chain PLUS
  curated-set membership (Codex plan-review fix #2, 2026-07-09 — this
  replaces an earlier ownership-only stance): token valid+unexpired →
  prospect → `adaAuditId`'s parent SiteAudit belongs to that prospect →
  filename allowlist pattern + traversal guard → `${adaAuditId}/${file}`
  must be in `curatedScreenshotSet(prospectId, adaAuditId)` — the same
  pattern-selection rule the loader uses, computed against the URL's
  PINNED audit (so open reports keep working after a re-scan). A guessed
  filename under an owned audit still 404s; the token authorizes only
  what the report renders. The internal cookie-gated screenshot route is
  untouched.

New UI in **`components/sales/`** only (hero tiles, section cards,
disclosure groups, example cards, CTA block) — no changes to
`components/ada-audit/` or `components/site-audit/`.

## 7. Security

- `middleware.ts`: public matching for the sales surface is
  **regex-based, NOT prefix-based** (Codex fix #1). A `/api/sales/`
  prefix would make the cookie-gated intake routes
  (`/api/sales/prospects…`) public. Public matchers (the skill-handoff
  regex precedent already in `middleware.ts`):
  `^/sales/[^/]+$` (public view) and
  `^/api/sales/[^/]+/screenshot/[^/]+/[^/]+$` (screenshot streaming).
  Exact `/sales` (intake page) and everything under `/api/sales/prospects`
  stay cookie-gated.
- Tokens: `crypto.randomUUID()`, unique, 30-d TTL, swept by cleanup.
- Screenshot route authorizes the full ownership chain AND curated-set
  membership (token → prospect → child audit → filename in the pinned
  audit's curated set), per §6.
- Prospect scans use the existing SSRF-guarded fetch paths unchanged.
- Public page renders NO internal affordances/links; share-view precedent
  (zero cookie-gated fetches) applies.

## 8. Edge cases / degradation

- Token valid, no reportable audit → "report being prepared" page (this
  also covers the complete-but-verifier-still-building window).
- Latest scan failed → intake page surfaces the failure; public page keeps
  serving the previous reportable audit if one exists, else "being
  prepared".
- PSI partial/failed pages → CWV aggregates over measured pages with an
  "N of M pages measured" line; section hides below a minimum sample.
- Blob-pruned audit (> 90 d) → findings-fallback data; screenshots absent →
  example cards render HTML/URL evidence without images (in practice the
  token expires before pruning; re-scan is the fix).
- seoOnly audits are NEVER prospect scans (intake always creates full
  audits); the loader ignores non-complete and seoOnly rows defensively.
- Empty section (e.g. zero broken links) → the card renders a green
  "no issues found" state — credibility matters in a sales artifact.

## 9. Testing

House convention (vitest, DB-backed where needed, hermetic env):

- Unit: `cwv-aggregate` (p75s, floors, partial data), curated-example
  selection (ranking, caps, determinism), schema-histogram builder
  (bounded, fail-to-null), copy module lookups.
- Route: token validation (missing/expired/rotated), latest-complete
  resolution, screenshot ownership + traversal guard, intake routes
  (create/scan/share/delete, SSO `requestedBy`), middleware public/gated
  split for `/sales` vs `/sales/[token]`.
- Component: disclosure states (collapsed/level-1/level-2), degraded
  states (no screenshots, small PSI sample, empty sections).
- Browser verify (dev): seeded synthetic Prospect + completed audit with
  fixture data — ZERO external scans (C17 precedent).

## 10. C18 coordination & sequencing

C14 file footprint: `components/sales/*`, `lib/sales/*`,
`app/(public)/sales/*`, `app/(app)/sales/*`, `app/api/sales/*`,
`prisma/schema.prisma` (additive), `middleware.ts` (one prefix),
`lib/jobs/handlers/broken-link-verify.ts` (histogram seam), nav registry,
and a small unified-recents touch (the "Prospect" badge — C16's files, not
C18's). **None of C18's files** (`SiteAuditResultsView`, site results page, triage,
`CommonIssueCallout`, share page).

The ONE shared seam: the **bounded representative-page loader** (resolve a
pattern's example page → load that one child audit → extract nodes for the
rule). C18's plan specifies it; C14 imports it. If C14's implementation
reaches that point before C18 lands, that single task waits or mirrors the
interface behind a thin adapter — everything else is parallel-safe (own
worktree).

Suggested build order (plan-level): schema migration + Prospect model →
data modules (cwv-aggregate, histogram, loader) → intake page + routes →
public view + screenshot route → polish/copy → browser verify.

## 11. Out of scope (v1)

- E-E-A-T section (new checks, partly LLM-shaped — and AI APIs are a
  settled NO per 2026-07-08 decision).
- Real GEO checks beyond the schema slice (llms.txt, AI-crawler robots
  rules, answerability) — `// FUTURE`.
- INP (PSI summary doesn't capture it).
- Prospect → Client conversion flow (close the deal → recreate as Client
  manually for now).
- PDF export of the sales view (the page IS the artifact; print styles
  cover paper).
- Scheduling/recurring prospect scans.
