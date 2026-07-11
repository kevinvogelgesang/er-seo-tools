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
- **CrawlRun already carries several nullable metadata JSON columns**
  (`discoveryCoverageJson`, `contentSimilarityJson`, `schemaTypesJson`,
  `programEntitiesJson`, plus reachability) — the measurement-first house pattern
  this spec extends. `contentSignalsJson` is a sibling of exactly this shape.
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
  clientExists: boolean       // distinguishes unknown client (→ 404) from unmapped
  gscMapped: boolean
  report: {
    fetchedAt: string          // ISO, from the snapshot row
    windowStart: string
    windowEnd: string
    queryAtLimit: boolean      // KS-1 honesty flag: query rows possibly truncated
    queryPageAtLimit: boolean  // KS-1 honesty flag: query×page rows possibly truncated
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

**`loadLatestValidSnapshot` must distinguish unknown client from unmapped (Codex #5):**
the shared helper returns `{ clientExists, gscMapped, row, payload }` — a
`findUnique` miss is `clientExists:false` (the route 404s), a client with a null
`gscSiteUrl` is `clientExists:true, gscMapped:false` (the card's "not mapped"
state). `getLatestGscSnapshot` keeps its `{ gscMapped, summary }` shape by
mapping `clientExists:false → gscMapped:false` (its current behavior — the
refactor stays behavior-preserving for that function). BOTH truncation flags
(`queryAtLimit` and `queryPageAtLimit`) ride the report: query-row truncation
can still understate a query's total impressions and thus a page's computed
share/coverage, so the honesty line must reflect either.

**New route `GET /api/clients/[id]/gsc-cannibalization`** (cookie-gated,
`withRoute`): strict numeric id parse (400 `invalid_id`), 404 `client_not_found`
(driven by `clientExists:false`), then `getCannibalizationReport`. Response
`{ gscMapped, report }`. No POST — the card refreshes via the EXISTING
`POST /api/clients/[id]/gsc-snapshot` (one snapshot feeds both cards), then
re-GETs this route. No middleware change.

**New component `components/clients/GscCannibalizationCard.tsx`** on
`/clients/[id]`, rendered adjacent to `GscKeywordCard` (client component,
follows its fetch/refresh/state conventions + dark-mode variants):

- States: **not mapped** (map a GSC property first) · **no snapshot yet**
  (offer refresh) · **clean** ("No cannibalized queries observed in this GSC
  window" — KS-1 absence phrasing: observation, never "not ranking") ·
  **report list**.
- Each entry: query, total observed impressions, `queryAtLimit ||
  queryPageAtLimit`/`capped` honesty line where applicable, expandable
  competing-pages list (URL, share as a proportion bar, impressions, clicks).
  Window + fetchedAt shown in the header.

**Refresh coordination (Codex #6):** two independent client components cannot
"shared-disable" a button or update each other's in-memory state. v1 accepts
**independent controls** — each card owns its own refresh: the cannibalization
card's refresh calls the same `POST /api/clients/[id]/gsc-snapshot` and then
re-GETs ONLY its own `gsc-cannibalization` route (a fresh snapshot also
benefits `GscKeywordCard` on its next load/refresh, but the two are not
wired to update in lockstep). The card copy must not promise the other card
updates simultaneously. (A shared `useGscSnapshotRefresh` hook lifting the
POST + both re-fetches into a common parent is noted as future polish, not v1.)

### 4.2 Increment B — content signals (stale dates + readability)

**New pure module `lib/ada-audit/seo/content-signals.ts`** (NOT injected into the
page — ordinary Node module, no SWC-injection contract needed; it runs in the
builder over already-harvested text):

```ts
export type ContentSignalsInput = {
  url: string
  contentText: string | null
  contentTruncated: boolean       // from HarvestedPageSeo — text capped at 30k (Codex #2)
}
export type StaleDateHit = { kind: 'copyright' | 'term' | 'deadline'; year: number; excerpt: string }
export type ContentSignalsResult = {
  observedPages: number            // pages with non-null contentText
  truncatedPages: number           // observed pages whose text was capped (Codex #2)
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
  pages: ContentSignalsInput[],     // builder pre-filters to indexable ∧ ¬loginLike (Codex #2)
  opts: { currentYear: number },    // injected — the module stays Date-free/deterministic
): ContentSignalsResult | null      // null when zero pages have contentText
```

**Eligibility + truncation (Codex #2):** the builder filters inputs to the SAME
`indexableOf(r) && !r.loginLike` aggregation set content-similarity/on-page use
(never the whole harvested set), and passes `contentTruncated` through.
`truncatedPages` is reported so a "clean" stale-date result is not over-read
when page text was capped at 30k — the UI's clean-state copy distinguishes "no
stale references detected" from "all content fully observed" (see §8).

**Stale-date rules (precision-first — this is a surfaced signal, false positives
erode trust):** a year token alone is NEVER a hit ("founded in 1998" must not
flag). A hit requires year + context in the same match window:

- `copyright`: `©`/`(c)`/`Copyright` + year ≤ `currentYear - 2` (a site can
  legitimately lag one year). **Range handling (Codex #3):** when the copyright
  token is followed by a year RANGE (`© 2018–2025`, `Copyright 2018-2025`, en-dash
  / hyphen / "to" / space variants), evaluate the LATEST year in the range, not
  the start year — a current range like `© 2018–<currentYear>` must NOT flag.
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

**Readability:** Flesch Reading Ease + Flesch-Kincaid grade per page. Only pages
with ≥ `READABILITY_MIN_WORDS` (100) words score (short utility pages are noise).
Site roll-up = medians + per-page list (capped at 50 pages in stored JSON, sorted
lowest Flesch Reading Ease first — hardest pages surface). Explicitly labeled
English-calibrated in the UI copy — v1 computes regardless of site language and
the section states the caveat (language detection is out of scope).

**Fixed algorithm contract (Codex #4 — vague "standard heuristic" is untestable):**
- *Tokenization:* words = maximal `[A-Za-z]` runs (intra-word apostrophes kept);
  pure-number and URL tokens are NOT words and NOT syllable-counted.
- *Sentences:* split on `.!?` runs; if the text has ZERO sentence terminators,
  treat the whole block as one sentence (no divide-by-zero / NaN medians).
- *Syllables:* count vowel-group runs (`[aeiouy]+`) per word, minimum 1; subtract
  1 for a silent trailing `e` (not `le`) — the common Flesch estimator, pinned so
  fixtures are exact.
- *Formulas:* FRE = 206.835 − 1.015·(words/sentences) − 84.6·(syllables/words);
  FK grade = 0.39·(words/sentences) + 11.8·(syllables/words) − 15.59.
- *Rounding:* both scores to 1 decimal; medians over an even count average the two
  middle values, then round to 1 decimal.

**Builder integration (`broken-link-verify.ts`):** immediately before the
content-similarity block, compute
`computeContentSignals(eligibleRows, { currentYear: new Date().getUTCFullYear() })`
where `eligibleRows` is the `indexableOf ∧ ¬loginLike` filtered set carrying
`{url, contentText, contentTruncated}`.

**Time-budget guard (Codex #1 — a try/catch does NOT protect against queue
timeout / process termination):** give content signals the SAME deadline
protection content similarity has. Add a `CONTENT_SIGNALS_RESERVE_MS` (small —
10s; the scan is linear regex + arithmetic, far cheaper than MinHash's 30s
reserve, but the reserve must exist so this block cannot push the job past its
15-min ceiling) and compute a `sigRemaining` the same way `simRemaining` is
computed; skip → `contentSignalsJson = null` when under the reserve. Wrap the
compute in try/catch → `JSON.stringify({ v: 1, ...result })`, fail-to-null +
`logError` (never fails the run write). Because this block runs BEFORE the
content-similarity block, its reserve must account for BOTH the similarity
reserve and its own so neither is starved — i.e. skip content signals when
`sigRemaining < CONTENT_SIGNALS_RESERVE_MS + CONTENT_SIM_RESERVE_MS`.

**Wiring (Codex #1):** add `contentSignalsJson?: string | null` to `CrawlRunInput`
(`lib/findings/types.ts`) so `writer.ts` persists it through its existing run
spread — written in the same `CrawlRun` create as the sibling metadata columns,
no new transaction.

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
  `lib/jobs/handlers/broken-link-verify.ts` (one compute block + budget guard +
  one field) · `lib/findings/types.ts` (`CrawlRunInput.contentSignalsJson`) ·
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
  GSC window"; `queryAtLimit || queryPageAtLimit`/`capped` = "possibly
  truncated", never definite.
- `clientExists:false` (Codex #5) is the ONLY thing that 404s; `clientExists:true,
  gscMapped:false` is the card's "not mapped" state — the two are never conflated.
- Increment B never fails the live-scan run write (fail-to-null + logError);
  the module takes `currentYear` as input (Date-free, deterministic tests).
- **Clean-state honesty (Codex #2 verify note):** the results section
  distinguishes "no stale references detected" from "all content fully observed"
  — when `truncatedPages > 0`, clean-state copy notes that some page text was
  capped at 30k chars, so absence of hits is not over-read.
- Stale-date detection is precision-first: no bare-year hits; every rule requires
  contextual keywords; fixture suite includes a false-positive table ("founded in
  1998", "since 1998", "© <currentYear>", "© 2018–<currentYear>" (current range),
  "Class of 2027 applications open" (future), "start your journey" (non-year
  "start")).
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
  the false-positive table incl. current copyright RANGE + "since 1998" +
  future dates + non-year "start"), readability formula spot-checks against
  known Flesch values (exact per the pinned syllable/sentence contract),
  zero-terminator single-sentence fallback, even-count median averaging, word
  floor, `truncatedPages` count, per-page/page-count caps, null on empty input,
  determinism (fixed `currentYear`).
- Builder test: `contentSignalsJson` written on a normal run over the
  eligible-filtered set; compute throw → null + run still written; under-reserve
  skip → null (mirror the similarity budget-skip test).
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
