# C12 Tier-0 content auditing — GSC cannibalization report + content signals (design)

**Date:** 2026-07-11 · **Status:** draft for Codex review
**Tracker item:** C12 (zero-AI Tier-0 increments only — the data-correctness half
is OFF per the 2026-07-08 no-AI-API ruling)
**Problem map:** `docs/superpowers/nyi/FUTURE-content-auditing.md` (Increments A + B
of its §6 sequencing; Kevin locked this scope 2026-07-11)

## 1. Goal

Two independent, zero-AI, zero-new-fetch content-auditing increments:

- **Increment A — GSC cannibalization report:** a full, report-shaped surface for
  the query×page cannibalization detection KS-1 already computes — today its only
  surface is a 20-entry cap inside the kst_ strategy export. New client-dashboard
  card + cookie-gated route, re-derived at read time from the stored snapshot rows.
- **Increment B — stale-date + readability signals:** per-page stale-date-reference
  detection and readability scoring computed in the live-scan builder from
  `HarvestedPageSeo.contentText` before transient deletion, stored as run metadata
  (`CrawlRun.contentSignalsJson`), surfaced read-time on the results page SEO tab.
  Measurement-first: NOT Findings, NO score change.

## 2. Background (verified code facts this builds on)

- **KS-1 snapshot stores raw rows, caps at the summary boundary.** `GscSnapshot`
  persists `queryRowsJson` (`GscQueryRow[]`) + `queryPageRowsJson`
  (`GscQueryPageRow[]`) verbatim; `getLatestGscSnapshot` (`lib/keywords/gsc-snapshot.ts:193`)
  loads the newest 3 rows filtered on the CURRENT `client.gscSiteUrl` (verbatim
  stamp), falls back past corrupt/invalid newest rows, re-runs the pure
  `deriveKeywordSignals` on the stored rows, and only then caps lists in
  `buildSummary` (50/50/50/20; caps "applied at THIS boundary (never in
  derive.ts)"). A full cannibalization report therefore needs **zero new GSC
  fetches and zero new storage** — it is a second read-time derivation.
- **`deriveKeywordSignals` is pure** (`lib/keywords/derive.ts` — no I/O, no
  `Date.now`) and already returns the FULL `cannibalization: CannibalizationEntry[]`
  (query, nullable `queryImpressions`, `observedPageImpressions`, nullable
  `observedPageCoverage`, pages with impressions/clicks/share), sorted by
  `observedPageImpressions` desc. Thresholds: page share ≥ 20% of the OBSERVED
  query×page impression sum + ≥ 10 impressions, ≥ 2 qualifying pages
  (`CANNIBALIZATION_MIN_SHARE` / `CANNIBALIZATION_MIN_PAGE_IMPRESSIONS`,
  `lib/keywords/types.ts`).
- **Refresh path exists:** `refreshGscSnapshot(clientId)` (single-flight,
  validate→derive→atomic publish) is exposed via `POST /api/clients/[id]/gsc-snapshot`;
  `GscKeywordCard` drives it. Retention: keep-latest-3 per client in `runCleanup`.
- **Increment B's exact pattern shipped twice.** The live-scan builder
  (`lib/jobs/handlers/broken-link-verify.ts`) computes content similarity from
  `HarvestedPageSeo.contentText` before deleting the transient rows: best-effort,
  try/catch fail-to-null, time-budget-guarded (`CONTENT_SIM_RESERVE_MS` 30s against
  the 15-min job ceiling), result JSON-stringified with a `{v:1,...}` envelope onto
  nullable `CrawlRun.contentSimilarityJson` (migration `20260706130000`, additive).
  `contentText` is nav/header/footer/aside-stripped main content, ≤30k chars/page,
  transient by design (never durable, never logged). Read-time
  `ContentSimilaritySection` renders on the results page
  (`app/(app)/ada-audit/site/[id]/page.tsx`); the share page imports it too but the
  C6 Phase 5 ship kept the share view unchanged.
- **CrawlRun already carries four nullable metadata JSON columns**
  (`discoveryCoverageJson`, `contentSimilarityJson`, `schemaTypesJson`,
  `programEntitiesJson`) — the measurement-first house pattern this spec extends.
- **Cookie-gated client routes need NO middleware change** (default-gated); the
  middleware trap is public/token routes only. `GET/POST /api/clients/[id]/gsc-snapshot`
  is the conventions template (withRoute, strict id parse, `gscMapped` absence
  states).

## 3. Scope decisions (locked with Kevin, 2026-07-11)

- **D1 — Scope: Increments A + B only.** Tier-1 topic overlap (MiniLM) and the
  cat_ handoff family (with the approved 1-h contentText retention + per-page
  content endpoint) are LATER specs. Tier-2/AI stays off (standing gate).
- **D2 — Surface: dedicated client-dashboard card** for the cannibalization
  report (not a monthly-PDF section, not an expansion of the already-dense
  `GscKeywordCard`). PDF/report integration is future work.
- **D3 — Data path: read-time re-derive from stored snapshot rows** (no schema
  change, no new provider calls; the kst_ export's 20-cap is untouched).
- **D4 — Increment B is measurement-first:** run-metadata JSON + read-time
  section only; promotion to `Finding`/score is a separate, later, gated step
  (parity-evidence bar, content-similarity precedent).

## 4. Architecture

### 4.1 Increment A — cannibalization report service + route + card

**`lib/keywords/gsc-snapshot.ts` refactor (internal):** extract the row-selection
loop of `getLatestGscSnapshot` (fetch newest 3 on the current verbatim
`gscSiteUrl`, JSON-parse, `isValidPayload`, corrupt-newest fallback, log+skip) into
a private `loadLatestValidSnapshot(clientId)` returning
`{ gscMapped: boolean, row: GscSnapshot | null, payload: {queryRows, queryPageRows} | null }`.
`getLatestGscSnapshot` keeps its exact public shape and behavior (existing tests
must pass unchanged).

**New export `getCannibalizationReport(clientId)`** in the same module:

```ts
type CannibalizationReport = {
  gscMapped: boolean
  report: {
    fetchedAt: string          // ISO, from the snapshot row
    windowStart: string
    windowEnd: string
    queryPageAtLimit: boolean  // KS-1 honesty flag: "possibly truncated", never definite
    thresholds: KeywordSignals['thresholds']
    totalCannibalizedQueries: number   // FULL count, before the payload cap
    capped: boolean                    // entries.length < totalCannibalizedQueries
    entries: CannibalizationEntry[]    // up to CANNIBALIZATION_REPORT_CAP
  } | null                             // null = no usable snapshot yet
}
```

Implementation: `loadLatestValidSnapshot` → `deriveKeywordSignals(payload, {minImpressions: row.minImpressions})`
→ take `signals.cannibalization` (already sorted by observed impressions desc)
→ slice to `CANNIBALIZATION_REPORT_CAP = 200` (payload bound only — a client-safe
constant in `lib/keywords/types.ts` beside the existing caps; full count still
reported). No new storage, no new provider call, no change to `derive.ts`.

**New route `GET /api/clients/[id]/gsc-cannibalization`** (cookie-gated,
`withRoute`): strict numeric id parse (400 `invalid_id`), 404 `client_not_found`,
then `getCannibalizationReport`. Response `{ gscMapped, report }`. No POST — the
card refreshes via the EXISTING `POST /api/clients/[id]/gsc-snapshot` (one
snapshot feeds both cards), then re-GETs this route. No middleware change.

**New component `components/clients/GscCannibalizationCard.tsx`** on
`/clients/[id]`, rendered adjacent to `GscKeywordCard` (client component,
follows its fetch/refresh/state conventions + dark-mode variants):

- States: **not mapped** (map a GSC property first) · **no snapshot yet**
  (offer refresh) · **clean** ("No cannibalized queries observed in this GSC
  window" — KS-1 absence phrasing: observation, never "not ranking") ·
  **report list**.
- Each entry: query, total observed impressions, `queryPageAtLimit`/`capped`
  honesty line where applicable, expandable competing-pages list (URL, share
  as a proportion bar, impressions, clicks). Window + fetchedAt shown in the
  header; refresh button shared-disables while the snapshot POST is in flight.

### 4.2 Increment B — content signals (stale dates + readability)

**New pure module `lib/ada-audit/seo/content-signals.ts`** (NOT injected into the
page — ordinary Node module, no SWC-injection contract needed; it runs in the
builder over already-harvested text):

```ts
export type ContentSignalsInput = { url: string; contentText: string | null }
export type StaleDateHit = { kind: 'copyright' | 'term' | 'deadline'; year: number; excerpt: string }
export type ContentSignalsResult = {
  observedPages: number            // pages with non-null contentText
  staleDates: {
    pagesWithHits: number
    pages: Array<{ url: string; hits: StaleDateHit[] }>   // hits capped per page
  }
  readability: {
    scoredPages: number            // pages ≥ READABILITY_MIN_WORDS
    medianFleschReadingEase: number | null
    medianGradeLevel: number | null
    pages: Array<{ url: string; fleschReadingEase: number; gradeLevel: number; words: number }>
  }
}
export function computeContentSignals(
  pages: ContentSignalsInput[],
  opts: { currentYear: number },   // injected — the module stays Date-free/deterministic
): ContentSignalsResult | null     // null when zero pages have contentText
```

**Stale-date rules (precision-first — this is a surfaced signal, false positives
erode trust):** a year token alone is NEVER a hit ("founded in 1998" must not
flag). A hit requires year + context in the same match window:

- `copyright`: `©`/`(c)`/`Copyright` + year ≤ `currentYear - 2` (a site can
  legitimately lag one year).
- `term`: season term (Fall/Spring/Summer/Winter/Autumn, case-insensitive) +
  year < `currentYear`, e.g. "Fall 2023 enrollment".
- `deadline`: an application/enrollment keyword (apply, enroll, enrollment,
  deadline, registration, "starts", "start date", "class of") within the same
  sentence as a year < `currentYear`.

Excerpts are bounded (~120 chars around the match), hits capped at 5/page and
pages capped at 50 in the stored JSON (site counts stay full). Regexes are
written without nested quantifiers (no catastrophic backtracking over 30k-char
inputs); scanning is per-sentence/per-line, not whole-document multiline
backtracking.

**Readability:** Flesch Reading Ease + Flesch-Kincaid grade per page with a
standard syllable-estimation heuristic; only pages with ≥ `READABILITY_MIN_WORDS`
(100) words score (short utility pages are noise). Site roll-up = medians +
per-page list (capped at 50 pages in stored JSON, sorted lowest Flesch Reading
Ease first — hardest pages surface).
Explicitly labeled English-calibrated in the UI copy — v1 computes regardless of
site language and the section states the caveat (language detection is out of
scope).

**Builder integration (`broken-link-verify.ts`):** immediately before the
content-similarity block, compute
`computeContentSignals(rows, { currentYear: new Date().getUTCFullYear() })` in
its own try/catch → `contentSignalsJson = JSON.stringify({ v: 1, ...result })`,
fail-to-null + `logError` (never fails the run write). No time-budget reserve of
its own: linear regex + arithmetic over ≤30k×N chars is orders cheaper than
MinHash; the try/catch is the guard. Written in the same `CrawlRun` create as the
sibling metadata columns.

**Schema:** additive migration `20260712000000_content_signals` — nullable
`CrawlRun.contentSignalsJson String?` beside the four existing metadata columns.
Hand-authored SQL (`ALTER TABLE "CrawlRun" ADD COLUMN "contentSignalsJson" TEXT`),
applied locally with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy`.

**Read-time `components/site-audit/ContentSignalsSection.tsx`** on the results
page SEO tab (site page only — share view unchanged, content-similarity
precedent): stale-date hits grouped by page with excerpts; readability medians +
a worst-pages list; "not analyzed" state for runs predating this ship (null
column) — phrased as "not analyzed", never "no issues".

## 5. Data flow

- **A:** GSC (already-stored snapshot rows) → `loadLatestValidSnapshot` →
  `deriveKeywordSignals` → full-list slice → route JSON → card. Refresh: card →
  existing snapshot POST → re-GET.
- **B:** page job harvest (`contentText`, transient) → builder
  `computeContentSignals` (pre-deletion) → `CrawlRun.contentSignalsJson` →
  results-page section. Historical runs: null → "not analyzed".

## 6. Affected surfaces

- `lib/keywords/gsc-snapshot.ts` (internal refactor + new export) ·
  `lib/keywords/types.ts` (report cap constant + report types) ·
  new `app/api/clients/[id]/gsc-cannibalization/route.ts` ·
  new `components/clients/GscCannibalizationCard.tsx` ·
  `app/(app)/clients/[id]/page.tsx` (render the card).
- new `lib/ada-audit/seo/content-signals.ts` ·
  `lib/jobs/handlers/broken-link-verify.ts` (one compute block + one field) ·
  `prisma/schema.prisma` + migration ·
  new `components/site-audit/ContentSignalsSection.tsx` ·
  `app/(app)/ada-audit/site/[id]/page.tsx` (render the section).
- NOT touched: `derive.ts` thresholds/semantics, kst_ export caps, share pages,
  middleware, scoring, Findings, provider layer.

## 7. Retention

- **A:** none new — reads existing snapshots (keep-latest-3 unchanged).
- **B:** `contentSignalsJson` rides `CrawlRun` (findings-forever, cascade-deleted
  with the run; blob pruning does not touch metadata columns — same posture as
  `contentSimilarityJson`). `contentText` transience is unchanged: computed
  before deletion, raw text never durable.

## 8. Error handling & invariants

- Corrupt stored snapshot JSON: `loadLatestValidSnapshot` inherits KS-1's
  log-and-fall-back-to-next-valid behavior; report degrades to `report: null`
  ("no usable snapshot"), never throws.
- KS-1 honesty invariants carry over verbatim: absence = "not observed in this
  GSC window"; `queryPageAtLimit`/`capped` = "possibly truncated", never definite.
- Increment B never fails the live-scan run write (fail-to-null + logError);
  the module takes `currentYear` as input (Date-free, deterministic tests).
- Stale-date detection is precision-first: no bare-year hits; every rule requires
  contextual keywords; fixture suite includes a false-positive table ("founded in
  1998", "© <currentYear>", "Class of 2027 applications open").
- No interactive transactions anywhere (no new transactions at all).

## 9. Testing

- `gsc-snapshot.test.ts`: existing `getLatestGscSnapshot` tests pass UNCHANGED
  (refactor is behavior-preserving); new `getCannibalizationReport` tests —
  not-mapped, no-snapshot, corrupt-newest fallback, full-vs-capped counts
  (fixture with > cap entries), thresholds passthrough.
- New route tests: 401 shape delegated to middleware defaults (cookie-gated —
  no middleware.test.ts change needed), invalid id 400, unknown client 404,
  happy path.
- `content-signals.test.ts`: stale-date rule fixtures (each rule positive +
  the false-positive table), readability formula spot-checks against known
  Flesch values, word floor, per-page/page-count caps, null on empty input,
  determinism (fixed `currentYear`).
- Builder test extension: `contentSignalsJson` written on a normal run; compute
  throw → null + run still written (mirror the similarity fail-to-null test).
- Component tests: card states (not-mapped / empty / clean / list, expansion),
  section states (not-analyzed / hits / clean) — `afterEach(cleanup)`,
  `getAllBy*` for repeated copy, dark-mode classes present.

## 10. Out of scope (breadcrumbed)

- Tier-1 MiniLM topic-overlap cannibalization (needs the contentText-availability
  decision; own spec).
- cat_ content-audit handoff family + 1-h contentText retention + per-page
  content endpoint (shared with KS-6; own spec).
- Promotion of content signals to Findings/score (gated on observed real-site
  signal quality, content-similarity precedent).
- Monthly-PDF cannibalization section; fleet-wide cannibalization view.
- Language detection / non-English readability calibration.

## 11. Acceptance criteria

1. A GSC-mapped client with a stored snapshot shows the full cannibalization
   report on `/clients/[id]` (uncapped up to 200, honest `capped` flag beyond),
   refresh updates both GSC cards from one snapshot.
2. Unmapped / snapshot-less / all-corrupt-snapshot clients get the correct
   degraded card states; nothing throws.
3. A fresh seoIntent live scan stores `contentSignalsJson` with stale-date hits
   and readability medians; the results page SEO tab renders them; pre-ship runs
   show "not analyzed".
4. The false-positive fixture table passes: no bare-year or current-year flags.
5. `getLatestGscSnapshot` behavior byte-identical (existing tests unchanged).
6. Gates green: tsc, full vitest suite, build.
