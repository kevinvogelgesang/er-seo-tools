# Live-scan anchor-text capture → SF findings parity (design)

**Date:** 2026-07-21 · **Status:** spec (pre-plan) · **Owner:** improvement-roadmap / SF-retirement campaign
**Campaign context:** `docs/superpowers/todos/2026-07-05-sf-live-parity-log.md` (Phase-7 retirement bar, OPEN blocking item #3 "anchor-text capture")
**Skill:** `er-seo-tools-sf-retirement-campaign`

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
- Persist it on the transient `HarvestedLink` row (additive nullable column).
- Aggregate the three findings in the single live-scan run builder (`broken-link-verify.ts`).
- A single shared non-descriptive-anchor list so the live rule never drifts from the SF parser.
- A minimal read-time `AnchorTextSection` on the SEO results tab + share view.
- Type-set + sweep-unit registration so the weekly sweep counts the new types correctly.

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

The change threads anchor text through the existing C6 live-scan pipeline; no new job, no new transient table.

```
site-audit-page job (per page)
  runAxeAudit / render → harvestLinks(page)         [1] capture anchorText in-page
    → classifyTargets(...)                          [2] carry anchorText on internal-link targets; dedup (url, anchorText)
    → persistHarvest(...)  → HarvestedLink rows      [3] write nullable anchorText column
                                   │
broken-link-verify job (single live-scan run builder, fired LAST in finalizeSiteAudit)
    → streamHarvestedLinks('internal-link')          [4] fold anchor accumulation into the EXISTING stream
        → anchor accumulators (target-contiguous)
    → mapAnchorTextFindings(accum, {runId, ensurePage, harvestTruncated})   [5] pure mapper → FindingInput[]
    → writeFindingsRun(...) merges with broken/on-page findings into ONE live-scan CrawlRun
    → deletes HarvestedLink
                                   │
results SEO tab → AnchorTextSection (reads run findings, scoped to anchor type set)   [6]
```

### [1] Harvest — capture anchor text in-page (`lib/ada-audit/link-harvest.ts`)

Extend the single `page.evaluate` so each `<a href>` yields `{ href, anchorText }` instead of a bare href.
The evaluate body is injected as a string and must keep the **SWC-helper-free contract** (no `typeof`, no
constructs that emit `_type_of`/spread helpers — same rule as `parse-seo-dom.ts`).

Extraction rule (v1, documented):
- `anchorText` = whitespace-collapsed, trimmed `a.textContent`, capped at `ANCHOR_TEXT_MAX = 200` chars.
- If empty, fall back to the trimmed `alt` of a descendant `<img alt>` (SF treats image links by their alt).
- Still empty → empty anchor.

`HarvestedTarget` gains an optional `anchorText?: string` (present only for `internal-link` kind; images and
external targets carry none — they never feed anchor findings).

### [2] Classify — preserve distinct anchors (`classifyTargets`)

The current dedup key is `(kind, url)`, collapsing two same-page links to the same destination with different
anchors into one row. That would corrupt `single_anchor_variation` (a destination reached with 2 distinct
anchors from one page must NOT look single-variation). Change:
- **Internal links** dedup by `(url, anchorText)` — distinct anchor variations survive as distinct targets.
- **Images / external** dedup unchanged by `(kind, url)`.

The verify builder already dedups targets before HTTP-checking (`byTarget`), so extra internal rows with the
same URL but different anchors cause **no extra fetches** — anchor multiplicity is purely an aggregation input.

### [3] Persist (`lib/jobs/handlers/site-audit-page.ts persistHarvest`)

Additive nullable `HarvestedLink.anchorText String?`. `persistHarvest` maps `t.anchorText ?? null` onto each row.
No other shape change; the post-settle fence and `harvestTruncated` denormalization are unchanged.

### [4] Aggregate — fold into the existing internal-link stream (`broken-link-verify.ts`)

`streamHarvestedLinks(..., ['internal-link','image'], cb)` at `broken-link-verify.ts:283` already keyset-streams
rows **ordered by `targetUrl, kind, sourcePageUrl, id`** — i.e. target-contiguous. `streamHarvestedLinks` must
add `anchorText` to its `select`. Inside the SAME callback (guarded by `r.kind === 'internal-link'`), accumulate:

- **empty count + capped source sample:** if the resolved anchor is empty → `emptyLinks++`, push `sourcePageUrl`
  into a sample set capped at `URLS_PER_FINDING`.
- **non-descriptive count + capped source sample:** if `isNonDescriptiveAnchor(anchor)` → `nonDescLinks++`, sample
  the source page (capped).
- **distinct-anchor set per target (flush on transition):** maintain the current target's `Set<anchorText>`;
  when `targetUrl` changes (using the existing target-transition boundary), if the just-finished target had
  exactly ONE distinct **non-empty** anchor → `singleVariationTargets.push(target)` (capped sample). Empty-anchor
  links do not count as a "variation" for this rule (SF's `destinationAnchors` only adds non-empty anchors).

Memory: these accumulators are O(1) per target (a per-target set flushed on transition) + integer counters +
capped samples — far smaller than the existing `internalPairs`. They ride the SAME stream (one pass, no extra
query) and honor the 2026-07-16 memory-fix invariant (the full row array is never retained). They are gated by
the **same `linkStreamRssTripped` guard**: if the RSS guard trips mid-stream, anchor accumulation is abandoned
to "no anchor findings" (degrade-to-null), exactly as `internalPairs` degrades.

Aggregation runs over **all** streamed internal-link rows, independent of the `byTarget` link-check `cap`
(anchor findings describe harvested links, not the checked subset).

### [5] Mapper — `lib/findings/anchor-text-mapper.ts` (NEW, pure)

Mirrors `onpage-seo-mapper.ts` / `broken-link-mapper.ts`: the builder owns `runId` + `ensurePage`; the mapper is
pure and returns `FindingInput[]`.

```ts
export interface AnchorAggregate {
  emptyCount: number                   // full honest count of internal links with an empty (captured) anchor
  emptySampleSources: string[]         // capped, normalized source page URLs
  nonDescriptiveCount: number          // full honest count of internal links with a non-descriptive anchor
  nonDescriptiveSampleSources: string[]
  singleVariationCount: number         // full count of destinations with exactly one distinct anchor
  singleVariationTargets: string[]     // capped sample of those destination URLs
}
export interface AnchorMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
  harvestTruncated: boolean
}
export function mapAnchorTextFindings(agg: AnchorAggregate, deps: AnchorMapDeps): FindingInput[]
```

Finding emission (SF-faithful):

| type | fires when | run-scope count | page rows | dedupKey |
|---|---|---|---|---|
| `empty_anchor_text` | `emptyCount > 0` | `emptyCount` (link instances) | page-scope by **source** page (from the capped sample), via `ensurePage(source)` | run: `runFindingKey(type)`; page: `pageFindingKey(type, source)` |
| `non_descriptive_anchor_text` | `nonDescriptiveCount > 0` | `nonDescriptiveCount` | page-scope by **source** page | same keying |
| `single_anchor_variation` | `singleVariationCount > 10` | `singleVariationCount` (destination pages) | **run-scope ONLY** — destination URLs live in the run finding `detail` sample; NO page rows (a destination may be an un-audited link target, and `ensurePage` for it would create a phantom CrawlPage) | run: `runFindingKey(type)` |

- `affectedComplete = !harvestTruncated`.
- `affectedSource: 'live-scan-anchor'` (new source tag; siblings: `live-scan-onpage`, `live-scan-verify`).
- Empty/non-descriptive `count` is the honest full link count. **Documented deviation:** SF's parser caps its
  own count at 50 (it only pushes while `length < 50`), so the live count can exceed SF's for the same site;
  this is intentional (live is more honest) and recorded here, not chased in parity review.

### [6] Read surfaces — type sets + UI

- `lib/findings/finding-type-sets.ts`: add `ANCHOR_FINDING_TYPES = ['empty_anchor_text',
  'non_descriptive_anchor_text', 'single_anchor_variation']`, an `ANCHOR_FINDING_TYPE_SET`, `ANCHOR_FINDING_LABELS`,
  and **`findingUnit` entries** for all three (see §5, the sweep-unit decision).
- NEW `components/site-audit/AnchorTextSection.tsx`: reads the live-scan run's findings filtered to the anchor
  type set. States: not-analyzed (no live-scan run / pre-feature run) / clean (run present, zero anchor findings)
  / findings. Rendered on the SEO results tab in `SiteAuditResultsShell`, after `OnPageSeoSection`. Share view
  renders the same section (findings are already loaded server-side, token-validated) — no cookie-gated fetch.

### Shared non-descriptive list (NEW, single source of truth)

Extract `AnchorTextParser.NON_DESCRIPTIVE_ANCHORS` into a client-safe module
`lib/findings/anchor-text-shared.ts` exporting:
- `NON_DESCRIPTIVE_ANCHORS: readonly string[]`
- `normalizeAnchorText(raw: string): string` (whitespace-collapse + trim + `ANCHOR_TEXT_MAX` cap — the ONE
  normalizer both harvest-side and parser-side agree on)
- `isNonDescriptiveAnchor(text: string): boolean` (lowercased membership test)

Both `anchorText.parser.ts` and `anchor-text-mapper.ts` import it — the live rule can never drift from SF (same
single-source pattern as `deriveIssueTypesForPage` in `issue-membership.ts`). A parity unit test pins that the
parser and the shared module agree.

## 4. Data model

Additive migration (nullable, transient table — no backfill, no default-value scan risk):

```prisma
model HarvestedLink {
  // ... existing fields ...
  anchorText String?   // C6-anchor: normalized visible anchor text for internal-link rows; null for images/external
}
```

Migration name: `<timestamp>_harvested_link_anchor_text`. `prisma migrate dev` locally; prod applies via
`prisma migrate deploy` on deploy.

## 5. Open decision for Codex review — sweep `IssueUnit` for the anchor types

`findingUnit(tool, type)` (finding-type-sets.ts) must return a non-null unit for every KNOWN type or the weekly
sweep logs "unknown" and falls back to `'groups'`. The current enum is `'pages' | 'targets' | 'groups'`.

- `single_anchor_variation` counts **destination pages** → `'pages'` (clean).
- `empty_anchor_text` / `non_descriptive_anchor_text` count **links** (link instances), which is not one of the
  three existing nouns.

**Recommended:** extend `IssueUnit` with `'links'` and map the two link-counting types to it — this keeps SF
count-fidelity (run count = link instances) AND an honest sweep noun. The ripple is small: `IssueUnit` type +
any `snapshot.ts` unit rendering that switches on the noun. **Alternative (lower ripple):** map both to `'pages'`
with run count = distinct affected **source pages** (a documented deviation from SF's link count). Codex to rule
on whether the `'links'` enum extension is worth the ripple vs. the page-count deviation.

## 6. Error handling & correctness invariants

1. **Characterization gate re-pin (RISK).** `lib/jobs/handlers/broken-link-verify.characterization.test.ts` is a
   FROZEN byte-identical happy-path gate on the run's findings/JSON. Adding anchor findings changes that output.
   The gate MUST be re-pinned **deliberately** (regenerate the golden with anchor findings present, review the
   diff, commit) — never auto-overwritten. This is a first-class plan task.
2. **No phantom pages.** `single_anchor_variation` emits run-scope only (see §3[5]) precisely so `ensurePage` is
   never called for an un-audited destination.
3. **Null-safe legacy path.** A run built from rows with `anchorText = null` (pre-migration harvest, or the
   image-only path) yields `emptyCount`/`nonDescriptiveCount`/`singleVariationCount` = 0 → no anchor findings.
   A null anchor is NEVER treated as an "empty anchor text" finding (null = not captured ≠ empty string). Only a
   captured-but-empty anchor (`''` after normalization on an internal-link row) counts as `empty_anchor_text`.
   → the mapper distinguishes `anchorText === null` (skip) from `anchorText === ''` (empty finding). The harvest
   writes `''` for a genuinely-empty anchor and `null` only when uncaptured.
4. **RSS-guard degrade.** Anchor accumulators are cleared with `internalPairs` when the stream RSS guard trips →
   no anchor findings on that run (never a partial/garbage count). Consistent with graph/coverage degrade.
5. **harvestTruncated honesty.** `affectedComplete = false` on all anchor findings when any harvested page hit
   the 300-link cap.
6. **dedupKey collisions.** Run + page findings use `runFindingKey`/`pageFindingKey`; source-page keying for
   empty/non-descriptive avoids `@@unique([runId, dedupKey])` collisions across the three types.
7. **seoOnly + full audits both benefit.** The builder runs for every completed site audit (seoOnly and full);
   anchor findings appear on both. Placeholder/`isPlaceholderRun` runs emit none (no harvest).

## 7. Testing (TDD)

Pure/unit (no DB):
- `link-harvest.test.ts`: `classifyTargets` carries `anchorText` on internal links; `(url, anchorText)` dedup
  keeps distinct anchors; images/external unaffected; the extraction/normalize rule (textContent → img-alt
  fallback → empty; whitespace collapse; 200-cap).
- `anchor-text-shared.test.ts`: `isNonDescriptiveAnchor` membership; `normalizeAnchorText`; **parity** — the SF
  parser's non-descriptive detection and the shared module agree on a fixture set.
- `anchor-text-mapper.test.ts`: the three findings — emission conditions (empty>0, nonDesc>0, singleVar **>10**),
  run/page scope + keying, counts, `affectedComplete`, `null` vs `''` handling, empty-anchor excluded from
  single-variation.
- `finding-type-sets.test.ts`: exhaustiveness — labels + `findingUnit` non-null for the 3 new types.

Builder integration (DB-backed, per house conventions):
- HarvestedLink rows with anchor text (empty / non-descriptive / single-variation fixtures) → the live-scan run
  carries exactly the expected anchor findings, merged with broken/on-page findings.
- Legacy rows (`anchorText: null`) → zero anchor findings.
- **Re-pin** `broken-link-verify.characterization.test.ts` (deliberate golden regeneration + diff review).

Component:
- `AnchorTextSection` not-analyzed / clean / findings states.

Gates (house): `npm run lint` (tsc) · `npm test` (vitest) · `npm run build` (heap-capped) · `npm run smoke`
(needs `CHROME_EXECUTABLE` on macOS). Prod verification lands on the first seoIntent live scan after deploy
(the Mon 2026-07-27 sweep auto-exercises it) — read the live-scan run's anchor findings on a real client.

## 8. Files touched (summary)

| file | change |
|---|---|
| `prisma/schema.prisma` (+migration) | `HarvestedLink.anchorText String?` |
| `lib/ada-audit/link-harvest.ts` | in-page anchor capture; `HarvestedTarget.anchorText`; `(url,anchorText)` dedup for internal links |
| NEW `lib/findings/anchor-text-shared.ts` | shared non-descriptive list + `normalizeAnchorText` + `isNonDescriptiveAnchor` |
| `lib/parsers/resources/anchorText.parser.ts` | import the shared list (remove the local copy) |
| NEW `lib/findings/anchor-text-mapper.ts` | pure `mapAnchorTextFindings` |
| `lib/jobs/handlers/site-audit-page.ts` | `persistHarvest` writes `anchorText` |
| `lib/jobs/handlers/broken-link-verify.ts` | `streamHarvestedLinks` selects `anchorText`; anchor accumulators in the internal-link callback; invoke the mapper; merge findings |
| `lib/findings/finding-type-sets.ts` | `ANCHOR_FINDING_TYPES` + labels + `findingUnit` (+ possible `IssueUnit` 'links') |
| NEW `components/site-audit/AnchorTextSection.tsx` | read-time section, SEO tab + share |
| `components/ada-audit/SiteAuditResultsShell.tsx` (or the SEO-tab assembly) | wire the section after `OnPageSeoSection` |

## 9. Non-goals / future

- Promoting anchor findings to a `scoreLiveSeo` factor (gated decision, needs SF-parity evidence + Kevin sign-off).
- follow/nofollow + link-position capture and the rich aggregate-stats section (only if a rendered consumer is
  ever built).
- Anchor-text near-duplicate / over-optimization analysis.
