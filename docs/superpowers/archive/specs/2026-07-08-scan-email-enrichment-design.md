# Scan-completion email enrichment — design

**Status:** draft (2026-07-08)
**Follows:** D7 scan-completion email notifications (`2026-07-08-scan-email-notifications-design.md`, shipped PR #132)
**Class:** small feature (UI/content + handler data-loading). No schema, transport, config, or middleware change.

## Problem

D7 shipped a working but bare completion email: a `system-ui` `<div>`, a three-item
bulleted list (ADA score, SEO score, duration), and a bare text link. Now that
delivery + DMARC alignment are proven in prod (email inboxes for external
recipients first try), Kevin wants the email to (a) look branded and (b) carry
more of the information the operator would otherwise open the app to see.

## Goals

Enrich **both** the `complete` and `failed` emails:

1. **Branded, email-client-safe HTML** — navy header band, score cards colored by
   value, a counts table, a "since last scan" strip, and a bulletproof CTA button.
2. **More information on the completion email:**
   - Pages scanned.
   - Issue counts by area: broken links, on-page SEO issues, ADA violations.
   - Change vs the previous same-domain scan: SEO + ADA score deltas and
     new/resolved ADA issue counts.
3. **Zero regression to D7's send semantics** — at-least-once send, durable
   sent-markers, 3-attempt retry, dark-gate no-op, and every existing no-op
   branch stay byte-for-byte behaviorally identical. Enrichment is strictly
   additive and best-effort.

## Non-goals

- No schema change, no new env var, no transport/config change.
- No remote images (logo included) — see §4.
- No new data *computation* — every number already exists in normalized tables;
  we only read and format it.
- No change to which audits send (opt-in gating, schedules-omit, bulk-omit all
  unchanged).

## Architecture

Two layers, same split D7 already uses:

- **`lib/notify/content.ts`** — stays a pure, DB-free, env-free builder. It gains
  optional input fields and the branded HTML/text rendering. Every new field is
  optional; a section renders only when its data is present. This keeps the
  builder fully unit-testable with no mocks.
- **`lib/jobs/handlers/notify-email.ts`** — the only place that touches the DB.
  It loads the enrichment data and passes it to the builder. All enrichment is
  wrapped so a failure degrades to `null`, never throws into the send path.

### Data loading (handler)

The handler already fetches the `SiteAudit` + its `crawlRuns`. Changes. **Every
count is independently nullable: `null` means _unknown/not-measured_, never `0`
(Codex fix #3) — a missing run must not read as "clean".**

1. **Pages scanned** — add `pagesComplete`, `pagesTotal` (and, for accuracy,
   `pagesError`/`pagesRedirected`) to the existing `select`. `pagesComplete` is
   *successfully audited* pages, not all attempted — so the email renders
   **"X of Y pages"** (`pagesComplete` of `pagesTotal`), never a bare "X pages"
   that overstates coverage (Codex fix #6).
2. **Issue counts** — after the existing run resolution. Each is `number | null`;
   `null` when the source run is absent (see edge-state table):
   - **Broken links & images** — the live-scan run (`tool:'seo-parser'`,
     `source:'live-scan'`). Headline = **sum of the `count` field on the
     run-scope `Finding` rows** of type `broken_internal_links` + `broken_images`
     (= distinct broken target URLs, the critical tier matching
     `BrokenLinksSection`). Sum run-scope `count`, do **not** count rows.
     `broken_external_links` (warning) is excluded from the headline. Label the
     row **"Broken links & images"** since images are folded in (Codex fix #4).
     `null` when there is no live-scan run.
   - **On-page issues** — the same live-scan run. Headline = **sum of the `count`
     field on the run-scope on-page `Finding` rows**. The on-page type set (from
     `onpage-seo-mapper.ts`) is `missing_title`/`missing_h1`/
     `missing_meta_description`/`thin_content`/`duplicate_title`/
     **`duplicate_meta_description`** (NOT `duplicate_meta` — Codex fix #2)/
     `duplicate_h1`. **Unit is mixed by design** (matching `OnPageSeoSection`):
     for duplicate types the run-scope `count` is the number of duplicate
     *groups*; for missing/thin it is the number of *affected pages*. The email
     presents this as one "issues" total and does not claim a single unit.
     `null` when there is no live-scan run.
   - **ADA violations** — page × axe-rule instances on the `ada-audit` run =
     count of page-scope `Finding` rows on that run (0 on a clean/100 audit; this
     is instances, not unique rules or DOM nodes — Codex fix #4). `null` for
     `seoOnly` audits (no ADA run).
   - Implemented as indexed `groupBy`/`aggregate` queries (`Finding` has
     `@@index([runId, severity])`, `@@index([runId, scope])`, `@@index([type])`).
     No blob reads. This is bounded work, not free: see the cost note below.
3. **Partial coverage (Codex fix #5)** — select each run's `status`
   (`'complete' | 'partial'`). When either the live-scan or ADA run is
   `'partial'`, its counts are valid but incomplete; the email renders an
   **"incomplete scan"** qualifier next to the affected counts so low numbers are
   not read as definitive.
4. **Change vs last scan** — three independent, all optional:
   - **ADA new/resolved instances** — `getSiteAuditInstanceDiff(siteAuditId)`
     (`lib/services/site-audit-diff.ts`) returns the instance diff
     (`newCount`/`resolvedCount`/… — page-set-aware, includes findings on
     newly-discovered pages) and the previous audit's id/date, or `null` when
     there is no prior same-domain + same-`wcagLevel` scan. ADA-run-anchored →
     `null` for `seoOnly` audits. **It returns NO scores** (Codex fix #1).
   - **ADA score delta** — computed separately from the current vs previous
     `ada-audit` `CrawlRun.score`. **Suppress the delta when the two runs'
     `scoreBreakdown` scorer/version differ** (a version bump makes the delta
     meaningless — matches `scorecard-shared.ts`; Codex fix #1). Previous run
     resolved via the same pair `getSiteAuditInstanceDiff` selected (its
     `previous.siteAuditId`).
   - **SEO score delta** — a dedicated, deterministic lookup independent of the
     ADA diff so it also works for `seoOnly` audits (Codex fix #8): the earlier
     `seo-parser`/`live-scan` `CrawlRun` for the **same normalized domain**,
     excluding the current run, ordered by `(completedAt ?? createdAt, id)` desc,
     **requiring non-null scores on both sides**. Delta = current − previous;
     omitted when either score is null or no previous run exists. (Guards against
     selecting a later concurrent run.)

**Fault isolation (Codex fix #7).** Enrichment loading **and** the enriched
`buildCompleteEmail(...)` call both sit inside one `try`; the `catch` logs and
rebuilds the email from base fields only. `sendEmail(...)` and the
`notifyCompleteSentAt` `updateMany` marker-stamp run **after**, outside the
`try/catch`, exactly as today:

```ts
let content
try {
  const enrichment = await loadEnrichment(audit)      // counts + change + partial flags
  content = buildCompleteEmail({ ...base, ...enrichment })
} catch (err) {
  logError('notify enrichment', err)
  content = buildCompleteEmail(base)                  // basic-but-valid email
}
await sendEmail({ to: audit.notifyEmail, content }, deps)   // UNCHANGED
await prisma.siteAudit.updateMany({ where: { id, notifyCompleteSentAt: null },
  data: { notifyCompleteSentAt: new Date() } })             // UNCHANGED
```

A send failure is never caught here — it propagates so the marker is NOT stamped
and the job retries (D7's at-least-once guarantee). Enrichment failure can only
downgrade content, never suppress or duplicate the send.

**Cost note:** `getSiteAuditInstanceDiff` issues several queries plus an in-memory
page-instance diff — bounded and appropriate as best-effort, but not "free reads".
This spec does not claim zero computation, only that no *new* metric is computed
and no blobs are read.

### Builder API (content.ts)

`CompleteInput` gains optional fields (all default to "section hidden"):

```
pagesComplete?: number | null
pagesTotal?: number | null
counts?: {                       // each independently nullable: null = unknown, not 0
  brokenLinks: number | null     // broken links & images (critical tier)
  onPageIssues: number | null
  adaViolations: number | null
} | null
partial?: { seo?: boolean; ada?: boolean } | null   // incomplete-run qualifiers
change?: {                       // strip renders ONLY if some field is non-null
  seoDelta?: number | null
  adaDelta?: number | null       // suppressed (null) on scorer-version mismatch
  newIssues?: number | null
  resolvedIssues?: number | null
  previousDate?: string | null   // for "since last scan (Jul 3)"
} | null
```

The builder renders each cell/row/strip **only when its value is non-null**; a
`counts` object with a `null` field renders that row as `—` (or omits it), and a
`change` object whose fields are all null produces **no** strip (Codex fix #9).

`buildFailedEmail` keeps its inputs (`domain`, `requestedBy`, `error`,
`resultsUrl`) and gains the same branded shell (header band + CTA button).

Both builders continue to return `{ subject, html, text }`. The plain-`text` body
is kept in lockstep with the HTML for every new section (accessibility + spam
score + non-HTML clients).

## Visual spec (email-client-safe)

- **Layout:** nested tables, all styles inline. Outer full-width table with
  background `#f4f5f7`; inner centered `600px` white card with `1px #e5e7eb`
  border and rounded corners (best-effort; degrades to square in Outlook).
- **Header band:** solid navy `#1c2d4a` (the app's `navy.DEFAULT`), white
  **"ER SEO Tools" text wordmark** — no `<img>` (see §4).
- **Score cards:** three bordered cells (ADA / SEO / Pages). The score value is
  colored by band: **≥90 `#16a34a` (green), 70–89 `#d97706` (amber), <70
  `#dc2626` (red)**; `—` in grey `#9ca3af` when null/unavailable. "Pages" is a
  neutral **"X of Y"** count.
- **"Since last scan" strip:** only when `change` has ≥1 non-null field. SEO/ADA
  deltas with `▲`/`▼` and sign (each shown only if non-null); "N new · M
  resolved". Includes the previous date when known.
- **Counts table:** up to three rows — **Broken links & images** / On-page issues
  / ADA violations — label left, number right-aligned. A count of `0` renders
  (real signal: "none found"); a `null` count renders `—` or the row is omitted
  (unknown — run absent). A `partial` flag adds a small "incomplete scan"
  qualifier beside the affected count(s).
- **CTA button:** a "bulletproof" table-cell button — navy `<td>` with padding
  and a white-text `<a>` inside — so it renders in Outlook. Label "View full
  report".
- **Failed email:** same shell; a red accent strip instead of score cards; the
  error text in a monospace-ish block, **truncated to a bounded length** (e.g.
  ≤500 chars) so a pathologically large stored `error` can't create an oversized
  message (Codex verify #4); CTA "Open the audit".

### Color / brand tokens (from `tailwind.config.ts`)

`navy.DEFAULT #1c2d4a`, `navy.deep #0f1d30`, `navy.card #243556`,
`navy.border #344d6e`. Status: green `#16a34a`, amber `#d97706`, red `#dc2626`,
muted `#9ca3af`, page bg `#f4f5f7`, hairline `#e5e7eb`.

## Edge / empty states

| Condition | Behavior |
|---|---|
| No previous same-domain scan | Omit the "since last scan" strip entirely (all `change` fields null). |
| SEO unavailable / no live-scan run | SEO card `—`; broken & on-page counts `null` → `—`/omitted (**unknown, not 0**); no SEO delta. |
| `seoOnly` audit (no ADA run) | ADA card `—`, ADA count `null` → `—` (**unknown, not 0**), no ADA delta/new-resolved; SEO card + counts + SEO delta still render; scanType "SEO". |
| Live-scan or ADA run `status:'partial'` | Counts render with an "incomplete scan" qualifier. |
| Counts genuinely zero (run present, none found) | Row shows `0` (positive signal). Distinct from `null`. |
| Scorer/version mismatch between current & previous ADA run | ADA delta suppressed (null); new/resolved still shown. |
| Enrichment throws | Log; rebuild the email from base fields only (scores + duration + link). Send proceeds; marker semantics unchanged. |
| Null scores | `—` grey, per D7's existing `fmtScore`. |
| Oversized failed-email `error` | Truncated to a bounded length before rendering. |

## Testing

Pure-builder unit tests (`lib/notify/content.test.ts`, extend existing):
- Full data (all sections) — subject, presence of each section in `html` **and**
  `text`, correct score-band colors, "X of Y pages".
- No previous scan (all `change` null) → no "since last scan" block.
- SEO unavailable → SEO `—`, broken/on-page counts `null` → `—`/omitted, no SEO
  delta.
- `null` count vs `0` count → `—`/omitted vs a rendered `0` (the two must differ).
- `partial` flag → "incomplete scan" qualifier present.
- ADA delta suppressed (null) → no ADA delta shown, new/resolved still shown.
- Null scores → `—`.
- Failed email → branded shell, error rendered + escaped, **over-long error
  truncated** to the bound.
- HTML-escaping preserved for every dynamic string (regression guard on the D7
  `esc` behavior).

Handler tests (`lib/jobs/handlers/notify-email.test.ts`, extend existing):
- Enrichment loads and is passed to the builder (happy path, mocked prisma).
- A rejected count/diff query degrades to a basic-but-valid email and the send
  still fires exactly once; the marker is still stamped.
- No live-scan run → broken/on-page counts arrive as `null` (not `0`); `seoOnly`
  → ADA count `null`.
- Deterministic previous-SEO selection: given two earlier same-domain live-scan
  runs, the later (by `completedAt ?? createdAt`, id tie-break) is chosen and a
  null-score previous is skipped.
- Every existing D7 no-op branch (dark, deleted, no recipient, marker set,
  `NEXT_PUBLIC_APP_URL` unset) still no-ops with no enrichment queries issued.

## Gates

`npm run lint` (tsc) · `DATABASE_URL="file:./local-dev.db" npm test` (vitest) ·
`npm run build`. Prod verification: trigger a scan with the checkbox ticked
against a client domain or `seo.erstaging.site`, confirm the enriched branded
email inboxes and renders correctly (Gmail web + mobile).

## Risk

Low. Pure-builder changes are fully testable; the handler change is additive and
fault-isolated from the send. The one behavioral guarantee to prove is "enrichment
failure cannot suppress or duplicate the email" — covered by a handler test that
rejects a query and asserts single-send + marker.
