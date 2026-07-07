# Content Similarity (near-duplicate) for the Live SEO Scan — Design

**Status:** REVIEWED (Codex ACCEPT-WITH-FIXES ×10 applied) · **Date:** 2026-07-06 · **Author:** improvement-roadmap session
**Roadmap home:** Screaming-Frog-retirement roadmap **Phase 5 — content similarity + quality layer**
(`docs/superpowers/nyi/2026-06-04-screaming-frog-retirement-roadmap.md:96`). Last remaining
C6/SF-retirement capability phase.

---

## 1. Motivation & goal

Screaming Frog reports a **Near Duplicate** column (lexical near-duplicate content at a
configurable ~90% similarity threshold — `docs/screaming-frog-setup.md:91,127`) and an exact-duplicate
signal. The parser consumes SF's precomputed cell (`lib/parsers/internal.parser.ts:500`) and surfaces
it as the `near_duplicate_pages` issue (`components/seo-parser/DuplicateContentSection.tsx`). The **live
scan has no equivalent** — it computes trimmed-EXACT title/meta/H1 duplicates only
(`lib/findings/onpage-seo-mapper.ts`); body-content near-duplicate detection does not exist. This is the
last SF capability the live scanner cannot yet own, and it blocks the "drop Screaming Frog" thesis for
clients whose SEO issues include duplicate/near-duplicate content.

**Goal:** compute lexical near-duplicate (and exact-duplicate) page groups during the live SEO scan and
store them as bounded run-metadata on the live-scan `CrawlRun`, faithful enough to SF's Near Duplicate
output to validate parity on the 7 fresh client crawls.

**Explicitly NOT semantic similarity.** Kevin's decision (2026-07-06): the target is SF-parity **lexical**
near-duplicate (shingling + MinHash), NOT the MiniLM embedding/cosine capability already in the repo
(`lib/services/pillarAnalysis/embeddings.ts`). Embeddings would flag differently-worded-but-semantically-
related pages that SF would not, diverging from parity. Semantic clustering, if ever wanted, is a separate
capability (and pillar analysis already does it).

## 2. Non-goals (this increment)

- **No `scoreLiveSeo` change.** Content duplication is NOT folded into the live SEO score
  (`lib/findings/live-seo-score.ts`). This mirrors the deliberately-deferred crawl-depth/orphan exclusions
  (`live-seo-score.ts:90`): compute the signal first, validate it, promote it only on evidence + Kevin's
  sign-off.
- **No `priority.service` Finding.** Near-duplicate groups are run metadata (like `reachabilityJson` and
  `discoveryCoverageJson`), NOT a `Finding`. Emitting a Finding pre-validation would inflate
  `priority.service` with an unvalidated signal (`priority.service` count-0 scale is 1.0 — the same reason
  reachability and discovery-coverage are metadata, not Findings).
- **No SF-side changes**, no change to the SF parser's existing `near_duplicate_pages` path.
- **No new external fetches** and **no MiniLM model load** — pure CPU over already-harvested page text.
- **No change to the audited page set** — reads only pages the live scan already visited.

This is a **measurement-first, findings-native-later increment**, the same shape as reachability 3b and
hybrid-discovery Increment 1.

## 3. Key decisions (resolved)

| Decision | Choice | Rationale |
|---|---|---|
| Similarity type | **Lexical** (shingle + MinHash), not semantic embeddings | Kevin 2026-07-06; SF-parity is the goal |
| Where text is captured | **In-page** (extend `parseSeoFromDocument`), returning bounded normalized main-content text | `bodyText` is already computed there; DOM structure (nav/header/footer/aside) is only available in-page for layer-1 boilerplate stripping |
| Where fingerprints/groups are computed | **In the builder** (`broken-link-verify.ts`), before transient-table deletion | The whole page set is only in scope there; cross-page document-frequency boilerplate filtering (layer 2) needs all pages; keeps hashing in normal testable TS, not the injected string |
| Raw-text storage | **Transient only** — new nullable `HarvestedPageSeo.contentText`, deleted at builder `:469` (7-day backstop) | The durable `CrawlRun` stores only fingerprint-derived groups; satisfies the roadmap's "store fingerprints, never raw pages" constraint (the constraint governs the durable store) |
| Fingerprint algorithm | **MinHash** (128 perms) over filtered word-shingles for candidate pairs, **refined with EXACT Jaccard** on the filtered shingle sets for any pair near `nearThreshold` (Codex #5, confirmed vs SimHash) | MinHash estimates a Jaccard "% similar" that maps onto SF's ~90% threshold; SimHash's Hamming distance is a harder-to-calibrate proxy. 128-perm sampling error is a few points at 0.90, so the final near/not decision uses exact Jaccard over the (small) filtered shingle sets — cheap at our scale, removes threshold variance for parity calibration |
| Durable output | New nullable `CrawlRun.contentSimilarityJson` (bounded, versioned) | Mirrors `reachabilityJson`; flows through `writeFindingsRun` via the `{ ...run }` spread with no writer change |
| Surfacing | Read-time `ContentSimilaritySection` on the site-audit results page | Sibling of `ReachabilitySection`/`DiscoveryCoverageSection`; user-visible without being a scored Finding |

## 4. Architecture / data flow

```
site-audit-page job (per page)
  parseSeoFromDocument(doc, win)         [parse-seo-dom.ts, injected]
    → RawPageSeo { …, contentText?, contentTruncated }   ← NEW: bounded normalized main-content text
  persistPageSeo()                       [site-audit-page.ts]
    → HarvestedPageSeo { …, contentText, contentTruncated }   ← NEW transient columns

broken-link-verify job (once, post-terminal, concurrency 1)   [broken-link-verify.ts]
  read HarvestedPageSeo (select + contentText, contentTruncated)   [:173-180]
  … existing broken-link / on-page / validation / graph / score / coverage passes …
  computeContentSimilarity(eligibleRows, opts)   ← NEW pure module, before the bundle
    → ContentSimilarityResult { exactDuplicateGroups, nearDuplicateGroups, … }
  bundle.run.contentSimilarityJson = JSON.stringify({ v:1, ...result })   ← NEW, near :463
  writeFindingsRun(bundle)              [:467]  — passes contentSimilarityJson through unchanged
  delete HarvestedLink, HarvestedPageSeo [:468-469]  — raw contentText dies here

results page
  ContentSimilaritySection reads liveScanRun.contentSimilarityJson   ← NEW component
```

## 5. Capture: `parseSeoFromDocument` extension (`lib/ada-audit/seo/parse-seo-dom.ts`)

The function is `.toString()`-injected into the audited page — **it must stay SWC-helper-free and reference
no module scope** (no `typeof`; the 2026-06-16 `_type_of` ReferenceError incident). All helpers/constants
stay inside the body, as today.

- Add `contentText?: string` and `contentTruncated: boolean` to `RawPageSeo` (interface + return).
- **Reuse the existing single tree-walker pass** (`:51-58`) that already computes `wordCount`. Do NOT change
  `wordCount` semantics — it feeds `thin_content` and the score; changing it would silently shift scores.
  Add a **second accumulator** on the same pass:
  - A node contributes to `contentText` iff it is not hidden (existing `hiddenAncestor` test) **and** not
    inside a boilerplate region. `inBoilerplateRegion(el)` = walks ancestors for tag `NAV|HEADER|FOOTER|ASIDE`
    or `role` ∈ `navigation|banner|contentinfo` (layer-1 boilerplate strip).
  - Accumulate trimmed text tokens joined by single spaces; **cap at `CONTENT_TEXT_CAP` = 30_000 chars**;
    set `contentTruncated = true` when the cap is hit and **stop appending — do NOT stop the tree walk**
    (the walk must complete so `wordCount` keeps its full-page semantics; Codex #10).
  - Lowercasing/whitespace-collapse can happen here or in the builder normalizer; do the cheap collapse here,
    canonical normalization in the builder (single source of truth for the shingle input).
- `contentText` is `undefined` when the page has no eligible text (empty / all-boilerplate).
- **SWC gate (Codex #10):** the change is verified against the existing es2017 compile + grep guard that
  proves no SWC helper (`_type_of`, etc.) escapes into the injected string; `wordCount` output must be
  proven unchanged by a test that strips nav/header/footer/aside and asserts the count is identical.

## 6. Transient persistence (`lib/jobs/handlers/site-audit-page.ts` `persistPageSeo`)

- Write `contentText: seo.contentText ?? null` and `contentTruncated: seo.contentTruncated` on the
  `harvestedPageSeo.create`. Best-effort path unchanged.

## 7. Data-model changes (one migration)

`prisma/schema.prisma`:

- `HarvestedPageSeo` (transient): add
  - `contentText String?` — normalized main-content text, bounded ≤ 30k chars. Transient; deleted with the
    row at builder `:469` and by the 7-day `pruneHarvestedPageSeo()` backstop.
  - `contentTruncated Boolean @default(false)`
- `CrawlRun` (durable): add
  - `contentSimilarityJson String?` — bounded versioned JSON (§9). Nullable; only live-scan runs populate it.
    Rides `CrawlRun` retention; no separate sweep.

`lib/findings/types.ts`: add `contentSimilarityJson?: string | null` to `CrawlRunInput` (next to
`reachabilityJson`). No `writer.ts` change (spread passthrough). No `CrawlPageInput` change.

Migration authored by hand (interactive `migrate dev` unavailable in this env): additive nullable columns
only — no `ALTER COLUMN`, no table rebuild. Directory `prisma/migrations/<ts>_content_similarity/`.

## 8. Compute: `lib/ada-audit/seo/content-similarity.ts` (new pure module)

Pure, fully unit-testable, no I/O. Signature (illustrative):

```ts
export interface SimilarityPageInput { url: string; contentText: string | null; contentTruncated: boolean }
export interface ContentSimilarityOptions {
  shingleSize?: number       // k-word shingles, default 5
  minTokens?: number         // eligibility floor over NORMALIZED CONTENT tokens, default 50 (Codex #3)
  boilerplateDfRatio?: number// drop shingles on > ratio of pages, default 0.5
  boilerplateDfMin?: number  // AND df ≥ this absolute floor, default 3 (Codex #4 small-site guard)
  nearThreshold?: number     // exact-Jaccard ≥ this = near-dup, default 0.90 (SF parity)
  minhashPerms?: number      // MinHash candidate-signature length, default 128
  maxPages?: number          // hard eligible-page cap for compute, default 1000 (Codex #1/#8)
  maxGroups?: number; maxUrlsPerGroup?: number  // output caps, default 100 / 50
}
export interface ContentSimilarityResult { /* the JSON payload of §9 */ }
export function computeContentSimilarity(pages: SimilarityPageInput[], opts?: ContentSimilarityOptions): ContentSimilarityResult
```

Algorithm:

1. **Eligibility (Codex #3).** Caller passes only indexable, non-login pages (same set the on-page mappers use:
   `2xx ∧ isHtml ∧ ¬robotsNoindex ∧ ¬xRobotsNoindex ∧ ¬loginLike`). Within the module: require `contentText`
   present, normalize it (step 2), and require **`normalizedTokenCount ≥ minTokens`** — the floor is over the
   NORMALIZED CONTENT tokens, NOT `HarvestedPageSeo.wordCount` (which counts all visible text incl. boilerplate;
   a page can have `wordCount≥50` but 10 content tokens). Count the rest as `pagesSkipped.{noText,thin}`.
   Enforce `maxPages` (drop excess deterministically by sorted URL, set `capped`).
2. **Normalize.** Lowercase; strip punctuation to spaces; collapse whitespace; tokenize to word array.
   Single canonical normalizer so exact-hash and shingling share input.
3. **Exact duplicates (Codex #2).** `sha256(normalizedText)` → group pages with identical hash. (Node `crypto`,
   server-only — builder-side, not injected.) **Truncated pages (`contentTruncated`) are EXCLUDED from exact
   groups** (a shared 30k prefix isn't a true exact dup); they still participate in near-dup and count toward
   `truncatedPages`.
4. **Shingling.** k-word shingles → 32-bit shingle hashes (per-page hash SET). Require `tokenCount > shingleSize`.
5. **Boilerplate document-frequency filter (layer 2, Codex #4).** Drop a shingle hash only when
   **`df ≥ boilerplateDfMin` AND `df / eligibleCount > boilerplateDfRatio`** — the absolute floor prevents a
   2–3-page site's genuine shared body shingles from being erased as "boilerplate." Record
   `boilerplateShinglesDropped`. A page reduced below the shingle floor after filtering → skipped (counted).
6. **MinHash (Codex #6).** `minhashPerms` independent hashes from a fixed-seed universal family, implemented
   with **`Math.imul`-based 32-bit mixing (or `BigInt` modular arithmetic)** — plain `(a·x+b) mod prime` in JS
   `number` overflows 2^53 and loses determinism. Seeds are hard-coded constants, NEVER generated at module load
   (no `Math.random`/`Date.now`). signature[i] = min over the page's filtered shingle hashes. Fixed-size.
7. **Near-duplicate grouping (candidate → exact refine, Codex #5/#7).** Pairwise MinHash Jaccard estimate =
   fraction of equal signature positions (direct O(n²), n ≤ `maxPages`, no LSH). For any pair whose estimate is
   within a margin of `nearThreshold`, compute **exact Jaccard over the filtered shingle sets** and decide on
   that (removes 128-perm sampling error at 0.90). Edge iff exact Jaccard ≥ `nearThreshold`; group by connected
   components (union-find). **Group similarity = MIN pairwise similarity within the group** (conservative;
   makes explicit that connected components can chain pages whose weakest pair is below threshold).
8. **Exact-vs-near reporting (Codex #7).** `exactDuplicateGroups` reported separately. A near group that is
   entirely one exact group is NOT re-listed in `nearDuplicateGroups`; a mixed group (A/B exact, C near) is
   listed once in `nearDuplicateGroups` with an `exactSubgroups: [["A","B"]]` annotation. No double-count.
9. **Bound output (Codex #8).** Cap groups (`maxGroups`) and urls/group (`maxUrlsPerGroup`); set `capped`.
   Memory: after DF counting, **convert shingle sets to sorted numeric arrays** and drop token/text arrays; do
   not retain normalized text past hashing/shingling; bound output byte size.

Determinism: fixed hash seeds, sorted inputs where order affects output. Same pages → same JSON (needed for
idempotent re-runs — the verify job is `maxAttempts:2`).

Builder wiring (`broken-link-verify.ts`, between the score/coverage block ~:437 and the bundle ~:454):
build `SimilarityPageInput[]` from `seoRows` (now selecting `contentText`, `contentTruncated`, plus the
existing indexability fields), then **guard on remaining job time (Codex #1)**: if
`JOB_TIMEOUT_MS − (now − jobStartedAt) − SAFETY_RESERVE_MS < CONTENT_SIM_RESERVE_MS`, skip the compute and
leave `contentSimilarityJson: null` (the run still writes). Otherwise call `computeContentSimilarity` and set
`contentSimilarityJson: JSON.stringify({ v: 1, ...result })` on `bundle.run`. Best-effort: wrap in try/catch
that logs and leaves the field `null` on failure (mirrors the reachability graph's fail-to-null at `:361-371`),
so a similarity bug or overrun can never fail the live-scan write.

## 9. Durable output shape (`CrawlRun.contentSimilarityJson`)

Versioned, bounded:

```json
{
  "v": 1,
  "algorithm": "minhash+exact-jaccard",
  "shingleSize": 5,
  "nearThreshold": 0.9,
  "minTokens": 50,
  "boilerplateDfRatio": 0.5,
  "boilerplateDfMin": 3,
  "pagesEligible": 142,
  "pagesSkipped": { "noText": 3, "thin": 11 },
  "boilerplateShinglesDropped": 87,
  "exactDuplicateGroups": [ { "urls": ["…","…"], "count": 2 } ],
  "nearDuplicateGroups":  [ { "urls": ["…","…","…"], "similarity": 0.94, "exactSubgroups": [["…","…"]] } ],
  "truncatedPages": 0,
  "capped": false
}
```

`similarity` (the group MIN pairwise, rounded to 2 decimals). `exactSubgroups` present only on mixed groups
(omitted otherwise). Empty arrays when no duplicates (the "clean" UI state). The field stays `null` for:
non-live-scan runs, pre-feature runs, a compute that threw, the time-budget skip (Codex #1), or < 2 eligible pages.

## 10. UI: `components/site-audit/ContentSimilaritySection.tsx`

Read-time, sibling to `ReachabilitySection`. Reads the live-scan run's `contentSimilarityJson`. States:

- **not-analyzed** — no live-scan run, or `contentSimilarityJson` null (pre-feature / < 2 eligible pages).
  Mirror the "pre-Phase-2 probe" wording used by `OnPageSeoSection` where relevant.
- **no-duplicates** — both group arrays empty → a clean confirmation line + `pagesEligible`.
- **duplicates** — exact-duplicate groups (red) and near-duplicate groups (amber, with similarity %) as URL
  lists, capped with an "and N more" affordance. Show `pagesEligible`, `boilerplateShinglesDropped` (as a
  "boilerplate excluded" reassurance), and a `capped`/`truncatedPages` note when set.

Full dark-mode variants (`dark:` on every element), no hydration-mismatch patterns. Included on both the
authed results view and — decide in the plan — the public share view (read-only; likely yes, it's read-time
metadata like the other sections).

## 11. `scoreLiveSeo` — untouched (explicit)

No new `ScoringWeights` key, no `addFactor` call, no input change. Documented here so the plan does not
"helpfully" wire it in. Promotion to a scored factor is a separate future step gated on parity evidence +
Kevin's sign-off (same gate as depth/orphans).

## 12. Retention & privacy (Codex #9)

- `contentText` (transient): deleted at builder `:469` on the normal path; `pruneHarvestedPageSeo()` (7-day,
  `lib/findings/retention.ts:144`) backstops stranded rows if the verifier never succeeds. No new sweep.
- **Explicit privacy handling:** `contentText` is raw page prose. It is **never logged**, **never selected
  outside the builder** (`broken-link-verify.ts` is the only reader; no other query adds it to its `select`),
  and never surfaced in any API/UI. A test asserts the 7-day backstop covers it (retention/migration test).
- `contentSimilarityJson` (durable): bounded JSON on `CrawlRun`; lives and dies with the run. No new sweep.

## 13. Testing strategy

**Pure module (`content-similarity.test.ts`) — the core of the coverage:**
- identical normalized text → one exact-duplicate group; near arrays exclude it (fully-exact group not re-listed).
- one-paragraph-changed pair → near-dup at ≥ threshold; unrelated pair → no group.
- **boilerplate control:** two pages with different bodies but a shared large nav/footer block → NOT grouped
  (DF filter removes the shared shingles). This is the roadmap's flagged false-positive risk — must be a test.
- **small-site DF guard (Codex #4):** a **2-page** pair sharing genuine body text → STILL grouped (the
  `boilerplateDfMin=3` absolute floor stops the df/2 ratio from erasing the signal). Explicit regression test.
- **truncation (Codex #2):** two pages with identical first-30k but different tails + `contentTruncated=true`
  → NOT an exact duplicate; counted in `truncatedPages`.
- **eligibility floor over content tokens (Codex #3):** a page with `wordCount≥50` but < `minTokens`
  post-boilerplate content tokens → skipped.
- **mixed exact/near group (Codex #7):** A/B exact, C near → one near group of {A,B,C} with `exactSubgroups`;
  chain case (A~B, B~C, A≁C) → connected component reports the MIN pairwise similarity.
- below `minTokens` → skipped, counted in `pagesSkipped`.
- < 2 eligible pages → empty result (field null upstream).
- determinism: same input twice → byte-identical JSON.
- caps: > `maxGroups` / > `maxUrlsPerGroup` / > `maxPages` → bounded + `capped` flag.
- threshold accuracy: a pair whose MinHash estimate is near 0.9 is decided by the exact-Jaccard refine and
  lands on the correct side of `nearThreshold`.

**`parse-seo-dom` (extend existing tests, Codex #10):** `contentText` excludes `nav/header/footer/aside`;
**`wordCount` proven unchanged** by the strip; cap hit → `contentTruncated=true` AND the walk still completes
(count reflects full page); SWC-helper-free (existing es2017 injection/grep guard covers the class).

**Builder integration (DB-backed):** `HarvestedPageSeo` rows with `contentText` → `CrawlRun.contentSimilarityJson`
populated; empty/one-page → null; a thrown compute → null field + run still written; a time-budget skip →
null field + run still written; transient rows still deleted; `contentText` absent from every non-builder select.

**UI component:** the three states render; dark-mode classes present.

Gate: `npm run lint` + `npm test` + `npm run build` all green.

## 14. Parity validation (post-deploy gate before any promotion)

After merge + deploy + a smoke prod-verify (one seoIntent audit shows `contentSimilarityJson` populated),
run seoIntent audits on the 7 fresh client crawls, compare the live `nearDuplicateGroups` against SF's
Near Duplicate column, and record agreement/variance in `docs/superpowers/todos/2026-07-05-sf-live-parity-log.md`.
Every deviation explained (SF's content-area config, threshold differences, boilerplate handling). This is the
gate that would later justify promoting the signal to a Finding / score factor — NOT done in this increment.

**Pre-deploy timing measurement (Codex verify):** before deploy, measure worst-case `computeContentSimilarity`
wall-clock on a ~1000-page fixture and confirm it fits inside `CONTENT_SIM_RESERVE_MS` (else the time-budget
guard #1 will simply skip it, which is safe but yields no signal on large sites). Keep both the raw MinHash
estimate and the refined exact Jaccard available in the first parity read so threshold tuning is evidence-based.

## 15. Rollout / deploy

Code + one additive nullable migration → plain `~/deploy.sh` (migrations auto-apply). No new required-in-prod
env var (all thresholds are code defaults). No `ecosystem.config.js` change. Post-deploy prod verification:
trigger/observe one seoIntent live-scan run and confirm `contentSimilarityJson` is populated and bounded.

## 16. Codex review — resolved (ACCEPT-WITH-NAMED-FIXES, 2026-07-06)

Codex reviewed this spec (session `019f2b57`) and returned **accept-with-named-fixes**; all 10 applied in place:

1. **Time-budget guard** before compute → skip + `null` if < `CONTENT_SIM_RESERVE_MS` remains (§8 wiring). The
   verifier's historical failure mode is dying before its final write; similarity must not reintroduce it.
2. **`contentTruncated` into the module** → truncated pages excluded from exact groups (§8 step 3).
3. **Eligibility over normalized content tokens**, not `wordCount` (§8 step 1).
4. **Small-site DF floor** `boilerplateDfMin=3` so 2–3-page genuine shared body text isn't erased (§8 step 5 + test).
5. **MinHash confirmed over SimHash**; 128-perm candidates **refined with exact Jaccard** near the threshold (§3, §8 step 7).
6. **JS-safe deterministic hashing** (`Math.imul`/`BigInt`, fixed seeds, no `Math.random`/`Date.now`) (§8 step 6).
7. **Exact-vs-near mixed groups** defined via `exactSubgroups`; group similarity = MIN pairwise (§8 step 7–8, §9).
8. **Explicit memory representation** — sorted numeric shingle arrays, drop token/text arrays, output byte cap (§8 step 9).
9. **Transient-text privacy** — never logged/selected outside builder; retention test (§12).
10. **Injected-parser gate** — es2017 SWC guard + `wordCount`-unchanged test; stop appending, not the walk (§5, §13).

Word-shingles over char-n-grams and `nearThreshold=0.90` start (revisit from parity data) also confirmed.

---

*Next: writing-plans skill → implementation plan → Codex review → TDD build.*
