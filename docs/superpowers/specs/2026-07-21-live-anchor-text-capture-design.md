# Live-scan anchor-text capture → SF findings parity (design)

**Date:** 2026-07-21 · **Status:** spec (Codex-reviewed, fixes applied) · **Owner:** improvement-roadmap / SF-retirement campaign
**Campaign context:** `docs/superpowers/todos/2026-07-05-sf-live-parity-log.md` (Phase-7 retirement bar, OPEN blocking item #3 "anchor-text capture")
**Skill:** `er-seo-tools-sf-retirement-campaign`
**Review:** Codex P0 2026-07-21 — ACCEPT WITH NAMED FIXES (7), all applied (see §10).

---

## 1. Problem & goal

SF's `all_anchor_text.csv` parser (`lib/parsers/resources/anchorText.parser.ts`) emits three
anchor-text findings on the **sf-upload** path today:

| type | severity | SF rule |
|---|---|---|
| `empty_anchor_text` | warning | internal links with empty anchor text |
| `non_descriptive_anchor_text` | notice | internal links whose anchor ∈ a fixed non-descriptive list (`click here`, `read more`, …) |
| `single_anchor_variation` | notice | destination pages receiving links with only ONE distinct anchor text across the crawl (fires only when the count **> 10**) |

These three types are already known to every downstream consumer — `lib/constants/issue-recommendations.ts`
(actionable recommendation strings), `lib/services/priority.service.ts` (`empty_anchor_text` weight 25),
`lib/services/sf-issue-dedup.ts`. But the **live-scan** (seoIntent) pipeline emits **none** of them:
`link-harvest.ts` reads `<a href>` but discards the anchor text, and `HarvestedLink` stores only
`sourcePageUrl` / `targetUrl` / `kind`.

The Phase-7 SF-retirement bar (set 2026-07-20) has "anchor-text capture" as an OPEN **blocking code
prerequisite**: before SF-as-crawler can be demoted, the live scanner must produce the anchor findings
SF currently provides. This spec closes that gap.

**Goal:** the live-scan pipeline captures anchor text and emits the same three findings on the
live-scan `CrawlRun`, at SF-faithful semantics. **Measurement-only** — no `scoreLiveSeo` change,
consistent with every prior C6 phase.

## 2. Scope

**In scope (findings parity only):**
- Capture per-`<a href>` anchor text during the rendered-DOM harvest.
- Persist it on the transient `HarvestedLink` row (additive nullable column; dedup UNCHANGED).
- Aggregate the three findings in the single live-scan run builder (`broken-link-verify.ts`) via a
  bounded reducer over the EXISTING keyset stream.
- A single shared non-descriptive-anchor list + normalizer so the live rule never drifts from the SF parser.
- A durable "anchor analysis ran" marker so a pre-feature run and a new clean run are distinguishable.
- A minimal read-time `AnchorTextSection` on the SEO results tab + share view.
- Type-set + sweep-unit registration (`IssueUnit: 'links'`) so the weekly sweep counts the new types correctly.

**Explicitly OUT of scope (documented rejections):**
- **Rich aggregate stats** (`top_anchors` / `unique_anchors` / `link_positions` / `pages_with_varied_anchors`).
  Evidence: on the SF path these die unconsumed in `aggregator.service.ts:562` (`resources.anchor_text`) —
  **no component renders them** (grep of `components/`/`app/` for `anchor_text`/`top_anchors`/`link_positions`
  returns zero render sites). Low actionability; the actionable signals are the three findings (which have
  recommendation + priority-weight entries). Kevin's ruling 2026-07-21: rich stats only if meaningfully
  usable, else findings parity — the evidence says findings parity.
- **follow/nofollow (`rel`) + link-position capture.** Not required by any of the three gate findings; feeds
  only the (unrendered) aggregate stats. Deferred.
- **`scoreLiveSeo` factor change.** Anchor findings do NOT enter the live score. `lib/ada-audit/seo/live-seo-score.ts`
  and its guard test (`live-seo-score.test.ts`) are untouched. Campaign fence: "never add to the live-score
  denominator casually."
- **Backfill.** `HarvestedLink` is transient; historical audits carry no anchor text and simply emit no anchor
  findings (never a false `empty_anchor_text`).

## 3. Architecture & data flow

The change threads anchor text through the existing C6 live-scan pipeline; **no new job, no new transient
table, and `HarvestedLink`'s dedup/cap and the `internalPairs` graph/validation inputs are UNCHANGED.**

```
site-audit-page job (per page)
  runAxeAudit / render → harvestLinks(page)         [1] extract per-<a> anchor text in-page (self-contained fn)
    → classifyTargets(...)                          [2] carry FIRST-occurrence anchorText on the surviving
                                                        (kind,url)-deduped internal-link target (dedup UNCHANGED)
    → persistHarvest(...)  → HarvestedLink rows      [3] write nullable anchorText (normalized) on internal rows
                                   │
broken-link-verify job (single live-scan run builder, fired LAST in finalizeSiteAudit)
    → streamHarvestedLinks('internal-link',...)      [4] bounded anchor reducer folded into the EXISTING stream
    → mapAnchorTextFindings(agg, {runId, ensurePage, harvestTruncated})   [5] pure mapper → FindingInput[]
    → writeFindingsRun(...) merges anchor + broken + on-page findings into ONE live-scan CrawlRun
       + stamps CrawlRun.anchorSummaryJson (analyzed marker)              [3b]
    → deletes HarvestedLink
                                   │
results SEO tab → AnchorTextSection (reads run findings + anchorSummaryJson)   [6]
```

### [1] Harvest — extract anchor text in-page (`lib/ada-audit/link-harvest.ts`)

Add a module-level **self-contained** function `harvestAnchorsFromDocument(document)` (mirroring
`parseSeoFromDocument`) injected via `.toString()`. It returns, per `<a href>`, `{ href, text }` where:
- `text` = the `<a>`'s `textContent`, trimmed; if empty, the trimmed `alt` of the first descendant `<img alt>`
  (SF treats image links by their alt); else `''`.
- A transport-bounding slice at `ANCHOR_TEXT_MAX = 2048` chars (see §6 fix-6 for why this is a size guard,
  not a semantic change).

**Injected-code contract (fix #6):** `harvestAnchorsFromDocument` MUST be self-contained (no module-scope
references, no imported constants — the `2048` literal is inlined and MUST equal `ANCHOR_TEXT_MAX`) and MUST
NOT emit an escaping SWC helper at es2017 (no `typeof`, etc.). A `.test.ts` (a) asserts
`harvestAnchorsFromDocument.toString()` is helper-free (`/_type_of|_object_spread|_define_property|_instanceof/`
guard + no `\btypeof\b`) and (b) **executes** it against a jsdom document (empty anchor, img-alt fallback,
nested-markup textContent, whitespace, >2048 truncation) — the current `harvestLinks` test mocks the harvest and
never runs the injected source, so this executable test is new.

`HarvestedTarget` gains `anchorText?: string` (populated only for `internal-link` kind).

### [2] Classify — attach anchor, dedup UNCHANGED (`classifyTargets`)

`classifyTargets` keeps its existing `(kind, url)` dedup and the 300-row `HARVEST_CAP` **exactly as-is**
(fix #2 — changing the dedup would let anchor variants evict later links/images from the cap AND inflate the
builder's `internalPairs.occurrences`, corrupting redirect/validation finding counts). For internal links, the
**first occurrence's** anchor text is attached to the surviving deduped target; later same-`(kind,url)` occurrences
are dropped as today.

**Documented consequence (SF deviation, accepted):** because only the first anchor per `(source,target)` survives
the per-page `(kind,url)` dedup, within-page multiple-distinct-anchors to the same destination are not captured.
Across *different* source pages, distinct anchors are still seen (each source is its own `HarvestedLink` row), so
`single_anchor_variation` is faithful for multi-linker destinations — the only gap is the narrow case where a
single page links a destination with ≥2 distinct anchors and no other page links it differently, which can make
`single_anchor_variation` over-report vs SF. This is a NOTICE-severity, measurement-only signal; the deviation is
recorded here (not chased), consistent with the parity log's other documented SF/live differences. Fuller fidelity
(per-page anchor observation capture) is a future increment (§9).

### [3] Persist (`lib/jobs/handlers/site-audit-page.ts persistHarvest`)

Additive nullable `HarvestedLink.anchorText String?`. `persistHarvest` writes:
`anchorText: t.kind === 'internal-link' ? normalizeAnchorText(t.anchorText ?? '') : null`.
→ **internal-link rows always carry a string (`''` if empty), never null; image/external rows carry null.** This is
the load-bearing null-vs-empty contract (fix #3): `null` = not an internal anchor observation (or a legacy
pre-migration row) → skipped; `''` = a captured, genuinely-empty internal anchor → counts as `empty_anchor_text`.
No other shape change; the post-settle fence and `harvestTruncated` denormalization are unchanged.

### [3b] Durable analysis marker (`CrawlRun.anchorSummaryJson`)

Additive nullable `CrawlRun.anchorSummaryJson String?` = `{ v:1, targetsObserved, targetsTruncated, harvestTruncated }`.
The builder stamps it **iff it observed ≥1 internal-link row with `anchorText !== null`** (i.e. real captured anchor
data). Consequences:
- A **legacy/pre-feature run** (or the characterization fixture, whose rows have null `anchorText`) → no captured
  data → `anchorSummaryJson` stays null, zero anchor findings → **byte-identical** to today (fix #4).
- A **post-feature clean run** (has internal anchors, but zero findings) → marker present → distinguishable from
  pre-feature (fix #3). The only conflation — a degenerate site with zero internal links — is immaterial.

UI reads: `anchorSummaryJson == null` → "not analyzed"; present + zero anchor findings → "clean".

### [4] Aggregate — bounded reducer folded into the existing stream (`broken-link-verify.ts`)

`streamHarvestedLinks(job.siteAuditId, ['internal-link','image'], cb)` (`broken-link-verify.ts:283`) already
keyset-streams rows; add `anchorText` to its `select`. Inside the SAME callback, guarded by
`r.kind === 'internal-link'`, maintain (all bounded; the full row array is never retained — 2026-07-16 invariant):

- `emptyCount: number`, `nonDescCount: number` (honest full link counts).
- `emptySources: Map<sourceUrl, count>` and `nonDescSources: Map<sourceUrl, count>`, each **capped at
  `URLS_PER_FINDING` entries** — per-source counts so page findings carry a real per-page count (fix #1).
- `anchorByTarget: Map<targetUrl, { first: string; multiple: boolean }>` — **O(1) per target** (first non-empty
  anchor + a "seen a different one" bit; NOT a `Set<anchor>`), **capped at `ANCHOR_TARGET_CAP = 5000`** with a
  `targetsTruncated` flag (fix #1). No per-target Set and no transition-flush is needed, so there is **no
  final-target / chunk-boundary flush hazard**: single-variation is derived after the stream ends by scanning the
  map. Bounded like the existing `byTarget`.
- `anyAnchorData: boolean` (true once a row has `anchorText !== null`).

Per internal-link row rule (SF-faithful):
- `anchorText === null` → **skip** (legacy/non-internal).
- else `anyAnchorData = true`; let `a = r.anchorText`:
  - `a === ''` → `emptyCount++`, bump `emptySources[source]` if room.
  - else if `isNonDescriptiveAnchor(a)` → `nonDescCount++`, bump `nonDescSources[source]` if room.
  - if `a !== ''` → update `anchorByTarget[target]`: insert `{first:a, multiple:false}` if absent (and under cap);
    else if `existing.first !== a` set `multiple = true`. (Only **non-empty** anchors enter the target map — SF's
    `destinationAnchors` only adds non-empty anchors, so a target reached only by empty anchors is never
    single-variation.)

After the stream: `singleVariationTargets = [t for (t,v) in anchorByTarget if !v.multiple]`;
`singleVariationCount = singleVariationTargets.length`.

**RSS-guard degrade (fix #1 memory safety):** these accumulators are cleared alongside `internalPairs` when the
existing `linkStreamRssTripped` guard fires; the builder then sets no `anchorSummaryJson` and emits no anchor
findings (never a partial/garbage count) — the same degrade posture as graph/coverage/validation.

### [5] Mapper — `lib/findings/anchor-text-mapper.ts` (NEW, pure)

Mirrors `onpage-seo-mapper.ts`: the builder owns `runId` + `ensurePage`; the mapper is pure and returns
`FindingInput[]`.

```ts
export interface AnchorAggregate {
  emptyCount: number
  emptySources: { url: string; count: number }[]         // capped per-source counts
  nonDescriptiveCount: number
  nonDescriptiveSources: { url: string; count: number }[]
  singleVariationCount: number
  singleVariationTargets: string[]                        // capped sample of destination URLs
  harvestTruncated: boolean
  targetsTruncated: boolean
}
export interface AnchorMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
}
export function mapAnchorTextFindings(agg: AnchorAggregate, deps: AnchorMapDeps): FindingInput[]
```

| type | fires when | run-scope count | page rows | affectedComplete |
|---|---|---|---|---|
| `empty_anchor_text` (warning) | `emptyCount > 0` | `emptyCount` | page-scope by **source** (`ensurePage(source)`), `count` = that source's link count | `!harvestTruncated` |
| `non_descriptive_anchor_text` (notice) | `nonDescriptiveCount > 0` | `nonDescriptiveCount` | page-scope by **source**, per-source count | `!harvestTruncated` |
| `single_anchor_variation` (notice) | `singleVariationCount > 10` | `singleVariationCount` | **run-scope ONLY** — no page rows (a destination may be an un-audited target; `ensurePage` would create a phantom page). Destination sample lives in the run `detail` JSON | `!harvestTruncated && !targetsTruncated` |

- `affectedSource: 'live-scan-anchor'` (sibling of `live-scan-onpage` / `live-scan-verify`).
- Run-finding `detail` JSON: `{ description, sample }` — for single-variation, `sample` = `singleVariationTargets`.
- dedupKeys: run `runFindingKey(type)`; page `pageFindingKey(type, source)` (source-page keying avoids
  `@@unique([runId, dedupKey])` collisions across types).
- Counts are honest full link counts. **Documented deviation:** SF caps its own count at 50 (pushes only while
  `length < 50`), so the live count can exceed SF's for the same site — intentional (live is more honest), recorded.

### [6] Read surfaces — type sets + UI

- `lib/findings/finding-type-sets.ts`: add `ANCHOR_FINDING_TYPES = ['empty_anchor_text',
  'non_descriptive_anchor_text', 'single_anchor_variation']`, `ANCHOR_FINDING_TYPE_SET`, `ANCHOR_FINDING_LABELS`,
  and `findingUnit` entries (see §5).
- NEW `components/site-audit/AnchorTextSection.tsx`: reads the live-scan run's findings filtered to the anchor
  type set + `anchorSummaryJson`. States: **not-analyzed** (`anchorSummaryJson == null` / no live-scan run) /
  **clean** (marker present, zero anchor findings) / **findings**. Mirrors `OnPageSeoSection`.
- **Wiring (fix #7):** instantiate `AnchorTextSection` where `OnPageSeoSection`/`BrokenLinksSection` are assembled —
  **the two real page files, NOT `SiteAuditResultsShell`**: `app/(app)/ada-audit/site/[id]/page.tsx` (the SEO-tab
  section stack, ~lines 290–316) and `app/(public)/ada-audit/site/share/[token]/page.tsx` (~lines 84–104). The
  share page already loads run findings server-side token-validated → no cookie-gated fetch. Both get tests for the
  three durable states.

### Shared module (NEW, single source of truth) — `lib/findings/anchor-text-shared.ts`

Client-safe (no server imports), exporting:
- `NON_DESCRIPTIVE_ANCHORS: readonly string[]` (moved verbatim from `AnchorTextParser`).
- `normalizeAnchorText(raw: string): string` — **`raw.trim().slice(0, ANCHOR_TEXT_MAX)`** (trim-only + size guard;
  see §6 fix-6).
- `isNonDescriptiveAnchor(text: string): boolean` — `NON_DESCRIPTIVE_ANCHORS.includes(text.trim().toLowerCase())`.

Both `anchorText.parser.ts` (SF path) and `anchor-text-mapper.ts` / the builder (live path) import it → the live
rule can never drift from SF (same single-source pattern as `deriveIssueTypesForPage`). A parity unit test pins
that the parser's non-descriptive detection and the shared module agree on a fixture set. `anchorText.parser.ts`'s
existing `anchortext.golden.test.ts` stays green (SF-path guard) after the refactor to import the list.

## 4. Data model

Two additive nullable columns (transient/relational, no backfill, no default-scan risk):

```prisma
model HarvestedLink {
  // ...
  anchorText String?   // normalized visible anchor text for internal-link rows; null for images/external/legacy
}
model CrawlRun {
  // ...
  anchorSummaryJson String?  // {v,targetsObserved,targetsTruncated,harvestTruncated}; null = anchor analysis did not run
}
```

Migration `<timestamp>_anchor_text_capture`. `prisma migrate dev` locally; prod applies via `prisma migrate deploy`.

## 5. Sweep `IssueUnit` — DECIDED: adopt `'links'` end-to-end (fix #5)

Extend `IssueUnit` from `'pages' | 'targets' | 'groups'` to add `'links'`. `findingUnit` returns:
`empty_anchor_text` → `'links'`, `non_descriptive_anchor_text` → `'links'`, `single_anchor_variation` → `'pages'`
(it counts destination pages). Falsifying link counts as page counts was rejected — count-fidelity wins over a
smaller ripple.

**Full ripple to implement (name every site):**
- `lib/findings/finding-type-sets.ts:78` — `IssueUnit` union + the three `findingUnit` cases.
- `lib/sweep/types.ts:68` — the sweep snapshot's `IssueUnit` union; `:164` — the **strict** JSON parser must accept
  `'links'` (a corrupt/foreign doc still reads absent, per the ingest-schema convention).
- `components/issues/chips.tsx:42-46` — render the `'links'` noun.
- Tests: `finding-type-sets.test.ts` exhaustiveness (labels + `findingUnit` non-null for the 3 new types);
  `lib/sweep` type-parse tests accept `'links'`; chip render test.

## 6. Error handling & correctness invariants

1. **Characterization stays FROZEN (fix #4).** `broken-link-verify.characterization.test.ts` and
   `anchortext.golden.test.ts` are NOT re-pinned. The nullable columns + the "stamp `anchorSummaryJson` only when
   captured anchor data exists" rule keep the legacy fixture (null `anchorText`) byte-identical. A **separate**
   anchor-aware builder integration golden covers the new behavior. If the characterization asserts the full
   `CrawlRun` row and the new null column surfaces, that is a one-line deliberate null addition — but design intent
   is byte-identical; verify during implementation.
2. **No phantom pages.** `single_anchor_variation` is run-scope only, so `ensurePage` is never called for an
   un-audited destination.
3. **Null vs empty is resolved in the reducer, not the mapper (fix #3).** The mapper receives only aggregate counts;
   the `null → skip` / `'' → empty` decision happens in the stream callback where the row value exists. The mapper
   test asserts finding shape/counts; the reducer/builder test asserts null-vs-empty.
4. **Memory (fix #1).** O(1)-per-target reducer, capped source maps, `ANCHOR_TARGET_CAP`, RSS-guard degrade; the
   full `HarvestedLink` array is never retained (2026-07-16 invariant). No EOF-flush hazard (derive after stream).
5. **Dedup/cap/validation untouched (fix #2).** `classifyTargets` dedup and `internalPairs` are unchanged; anchor
   capture only adds a column value to already-surviving rows.
6. **Normalization pinned (fix #6).** SF trims only and lowercases solely for the non-descriptive test, keeping
   trimmed case-sensitive raw values for distinct-anchor comparison. `normalizeAnchorText` = **trim + `slice(0,2048)`**
   — the slice is a DB/transport size guard; anchors >2048 chars are pathological and the only theoretical effect is
   merging two distinct >2048-char anchors, accepted and documented (SF has no cap). `isNonDescriptiveAnchor`
   lowercases for membership only; the target-map distinct comparison uses the trimmed case-sensitive value (SF-faithful).
   The injected extractor is self-contained + banned-helper-guarded + executed in a test (see §3[1]).
7. **harvestTruncated / targetsTruncated honesty.** `affectedComplete=false` when the 300-link harvest cap or the
   `ANCHOR_TARGET_CAP` was hit (single-variation additionally gated on `targetsTruncated`).
8. **seoOnly + full audits both benefit;** placeholder/`isPlaceholderRun` runs (no harvest) emit none.

## 7. Testing (TDD)

Pure/unit (no DB):
- `link-harvest.test.ts`: `harvestAnchorsFromDocument` executed on jsdom (empty / img-alt fallback / nested markup /
  whitespace / >2048 truncation) + the SWC-helper-free source guard; `classifyTargets` attaches first-occurrence
  `anchorText` to internal targets and leaves dedup/cap/image/external behavior unchanged.
- `anchor-text-shared.test.ts`: `isNonDescriptiveAnchor` membership; `normalizeAnchorText` (trim + 2048 cap);
  **parity** — the SF parser's non-descriptive detection and the shared module agree on a fixture set.
- `anchor-text-mapper.test.ts`: three findings — emission conditions (empty>0, nonDesc>0, single **>10**),
  run/page scope + keying, per-source page counts, `affectedComplete` under truncation flags.
- `finding-type-sets.test.ts`: exhaustiveness (labels + `findingUnit` for the 3 new types); `lib/sweep` parse
  accepts `'links'`; `components/issues/chips.tsx` renders `'links'`.

Builder integration (DB-backed, house conventions):
- HarvestedLink rows with anchor text (empty / non-descriptive / single-variation fixtures) → the live-scan run has
  exactly the expected anchor findings, merged with broken/on-page findings, plus `anchorSummaryJson` stamped.
- Legacy rows (`anchorText: null`) → zero anchor findings, `anchorSummaryJson` null (feeds the frozen
  characterization expectation). **null vs `''` proven here.**
- RSS-guard-tripped path → no anchor findings, marker null.

Component: `AnchorTextSection` not-analyzed / clean / findings states.

Gates (house): `npm run lint` (tsc) · `npm test` (vitest) · `npm run build` (heap-capped) · `npm run smoke`
(needs `CHROME_EXECUTABLE` on macOS). Prod verification lands on the first seoIntent live scan after deploy (the
Mon 2026-07-27 sweep auto-exercises it) — read a real client run's anchor findings + `anchorSummaryJson`.

## 8. Files touched (summary)

| file | change |
|---|---|
| `prisma/schema.prisma` (+migration) | `HarvestedLink.anchorText String?`, `CrawlRun.anchorSummaryJson String?` |
| `lib/ada-audit/link-harvest.ts` | `harvestAnchorsFromDocument` (injected, self-contained); `HarvestedTarget.anchorText`; classify attaches first-occurrence anchor (dedup UNCHANGED) |
| NEW `lib/findings/anchor-text-shared.ts` | `NON_DESCRIPTIVE_ANCHORS` + `normalizeAnchorText` + `isNonDescriptiveAnchor` + `ANCHOR_TEXT_MAX` |
| `lib/parsers/resources/anchorText.parser.ts` | import the shared list + `isNonDescriptiveAnchor` (behavior-preserving) |
| NEW `lib/findings/anchor-text-mapper.ts` | pure `mapAnchorTextFindings` |
| `lib/jobs/handlers/site-audit-page.ts` | `persistHarvest` writes normalized `anchorText` (`''`/value internal, null else) |
| `lib/jobs/handlers/broken-link-verify.ts` | `streamHarvestedLinks` selects `anchorText`; bounded anchor reducer in the internal-link callback (RSS-guard-aware); invoke mapper; merge findings; stamp `anchorSummaryJson` |
| `lib/findings/finding-type-sets.ts` | `ANCHOR_FINDING_TYPES` + labels + `IssueUnit: 'links'` + `findingUnit` |
| `lib/sweep/types.ts` | `IssueUnit` union + strict parser accept `'links'` (:68,:164) |
| `components/issues/chips.tsx` | render `'links'` noun (:42-46) |
| NEW `components/site-audit/AnchorTextSection.tsx` | read-time section |
| `app/(app)/ada-audit/site/[id]/page.tsx` + `app/(public)/ada-audit/site/share/[token]/page.tsx` | wire the section into the SEO section stack |

## 9. Non-goals / future

- Promoting anchor findings to a `scoreLiveSeo` factor (gated: needs SF-parity evidence + Kevin sign-off).
- **Fuller `single_anchor_variation` fidelity** via per-page anchor-observation capture (would recover within-page
  multi-anchor to the same destination — the §3[2] documented deviation). Deferred as its own increment; the
  measurement-only posture makes the current approximation acceptable.
- follow/nofollow + link-position capture and the rich aggregate-stats section (only if a rendered consumer exists).

## 10. Codex P0 fixes applied (2026-07-21)

1. **Bounded reducer + no flush hazard** — O(1)-per-target `{first,multiple}` reducer, derived after the stream (no
   Set, no transition/EOF flush), capped source maps with per-source counts (§3[4], §6.4).
2. **Preserve harvest-cap + validation** — `HarvestedLink` dedup/cap and `internalPairs` UNCHANGED; anchor is only an
   added column value on surviving rows; within-page multi-anchor deviation documented (§3[2], §6.5).
3. **Null/empty + durable availability** — null-vs-empty resolved in the reducer; durable `anchorSummaryJson` marker
   distinguishes pre-feature from clean (§3[3], §3b, §6.3).
4. **Characterization frozen** — legacy fixture stays byte-identical (null anchor → no marker/findings); new separate
   anchor-aware golden; keep `anchortext.golden.test.ts` (§6.1, §7).
5. **`links` end-to-end** — `IssueUnit` extended with the full named ripple (§5).
6. **Normalization + injected contract pinned** — trim-only + 2048 size guard; shared classifier; self-contained
   injected extractor with a banned-helper guard + an executable DOM test (§3[1], §6.6).
7. **Durable mapper/UI contract** — run-detail JSON (`{description, sample}`) + per-source page counts; wire into the
   two real page assemblies, not `SiteAuditResultsShell`, with durable-state tests (§3[5], §3[6], §7).
