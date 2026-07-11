# C12 Tier-1 — MiniLM topic-overlap cannibalization (design)

**Tracker item:** C12 (Tier-1, Increment C of `nyi/FUTURE-content-auditing.md`).
Zero-AI (local ONNX embeddings, no API), zero-new-fetch, **measurement-first**
(run-metadata JSON, NOT a Finding, NO score change). Sibling of the shipped
lexical content-similarity (C6 Phase 5) and content-signals (C12 Tier-0 B).

**Scope (locked with Kevin, 2026-07-11):** Increment C ONLY — on-server embedding
topic-overlap. The `cat_` content-audit handoff family + 1-h `contentText`
retention reversal are a SEPARATE later spec; Tier-2/AI stays off (standing gate).

---

## 1. Problem

Two pages can compete for the same topic while sharing few literal words
("Nursing Diploma" vs "RN Program", "Tuition & Fees" vs "Cost of Attendance").
The two cannibalization signals already shipped both miss this:

- **Lexical near-duplicate** (`contentSimilarityJson`, C6 Phase 5) — MinHash over
  word shingles; catches copy-paste, not paraphrase.
- **Query-based cannibalization** (Increment A, `getCannibalizationReport`) — GSC
  query×page; only surfaces overlap Google has *already* observed, and only for
  GSC-mapped clients.

Topic-overlap fills the gap: **semantic** similarity over page embeddings, run for
**every** audit (including prospects, no GSC needed), catching overlap before GSC
shows it.

## 2. Prior art in the repo (verified 2026-07-11)

- `lib/services/pillarAnalysis/embeddings.ts` — `embedTexts(texts) → number[][]`
  (Xenova `all-MiniLM-L6-v2`, 384-dim, mean-pooled, **L2-normalized**, lazy ONNX
  singleton `extractorPromise`; batched internally) + `cosineSimilarity(a,b)`
  (dot product for normalized vectors). **Reused as-is**; no changes.
- `lib/ada-audit/seo/content-similarity.ts` — the structural template:
  `compute*(pages, opts) → nullable result`, union-find grouping, min-pairwise
  score per group, deterministic, caps, `null` for <2 eligible. Topic-overlap
  mirrors its shape and its builder wiring.
- `lib/ada-audit/seo/content-signals.ts` (C12 Tier-0 B) — the purity + pinned-
  constant + fail-to-null precedent; an ordinary Node module (NOT `.toString()`-
  injected — no SWC/`typeof` contract).
- `lib/jobs/handlers/broken-link-verify.ts` — the single live-scan run builder;
  loads transient `HarvestedPageSeo` rows once (`seoRows`), computes the content
  blocks over the **indexable ∧ ¬login-like** set before deleting the transient
  tables, and writes everything on `bundle.run` via the writer's `crawlRun.create`
  spread. `SAFETY_RESERVE_MS=180_000`; `CONTENT_SIGNALS_RESERVE_MS=10_000` +
  `CONTENT_SIM_RESERVE_MS=30_000` are summed skip-reserves.
- `HarvestedPageSeo` persists `title`, `h1`, `metaDescription` **as text**;
  headings beyond H1 are **counts only** (`h1Count`/`h2Count`) — H2/H3 text is not
  captured. The injected parser (`parse-seo-dom.ts`) carries the SWC-helper-free
  contract and is **not touched** by this work.

## 3. Scope decisions (locked with Kevin, 2026-07-11)

- **D1 — Embed BOTH a topic signature and a body-intro, weighted.**
  - *Signature* = `title + "\n" + h1 + "\n" + metaDescription` (the text fields
    already on `HarvestedPageSeo`; empty parts dropped). What the page *declares*
    it is about. Fits the model window with no truncation.
  - *Body-intro* = the leading slice of `contentText` (MiniLM reads only the first
    ~256 tokens regardless, so we pass a bounded prefix — see §5).
  - Combined pair similarity = `W_SIG·cos(sigA,sigB) + W_BODY·cos(bodyA,bodyB)`.
- **D2 — Pure semantic clusters, NO GSC coupling.** Union-find over pairs above a
  threshold → clusters of ≥2 pages. Runs for every live-scan audit. A read-time
  "also competes in GSC" enrichment is OUT of scope (breadcrumb only).
- **D3 — Measurement-first.** Nullable `CrawlRun.topicOverlapJson`; read-time
  section only; NOT a Finding, NO score change. Promotion is a separate gated step
  (content-similarity precedent).
- **D4 — Pinned constants with fixtures.** `W_SIG=0.6`, `W_BODY=0.4`,
  `TOPIC_OVERLAP_THRESHOLD=0.78`, and all caps are starting defaults; they are
  pinned to fixtures and only retuned WITH the fixtures (content-signals rule).
  Measurement-first exists precisely to eyeball real clusters before promotion.
- **D5 — No suppression of lexical-duplicate overlap in v1.** The two signals
  catch different things; identical pages legitimately appearing in both is honest.
  A read-time cross-note is a cheap optional add, not required.

## 4. Data model

New nullable column, additive:

```
model CrawlRun {
  ...
  topicOverlapJson String? // C12 Tier-1: semantic topic-overlap clusters (live-scan runs only); measurement, NOT a finding
}
```

Migration `20260712120000_topic_overlap` (hand-authored SQL — `migrate dev` is
interactive-only here; SQLite additive `ALTER TABLE ... ADD COLUMN`). Applied with
`DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && ... generate`.
Add `topicOverlapJson?: string | null` to `CrawlRunInput` (`lib/findings/types.ts`)
so the writer's `crawlRun.create` spread carries it (no new transaction).

Stored shape (versioned, `{v:1,...}`-wrapped like the siblings):

```jsonc
{
  "v": 1,
  "observedPages": 42,        // eligible pages that produced at least a signature vector
  "threshold": 0.78,          // the combined-similarity threshold used
  "weights": { "sig": 0.6, "body": 0.4 },
  "truncatedPages": 3,        // pages whose body-intro was truncated (informational)
  "clusters": [
    {
      "urls": ["https://x/nursing-diploma", "https://x/rn-program"],
      "minSimilarity": 0.81,  // MIN pairwise combined similarity within the cluster
      "size": 2
    }
  ]
}
```

Caps: at most `TOPIC_OVERLAP_MAX_CLUSTERS=50` clusters, `...MAX_MEMBERS=50` URLs
per cluster (largest clusters first; drop-count implied by `observedPages`).

## 5. Algorithm — `lib/ada-audit/seo/topic-overlap.ts` (new, pure)

Clean impure/pure split mirroring `pillarAnalysis` (impure `embeddings.ts` vs pure
`cluster.ts`). The **pure** module owns the pinned, fixture-tested algorithm and
takes **precomputed vectors** — no model dependency, fully deterministic.

```ts
export interface TopicOverlapPageVectors {
  url: string
  sigVec: number[] | null   // null if no signature text
  bodyVec: number[] | null  // null if no body text
  bodyTruncated: boolean
}
export interface TopicOverlapOptions {
  wSig?: number         // default 0.6
  wBody?: number        // default 0.4
  threshold?: number    // default 0.78
  maxClusters?: number  // default 50
  maxMembers?: number   // default 50
}
export function clusterByTopicOverlap(
  pages: TopicOverlapPageVectors[], opts?: TopicOverlapOptions,
): TopicOverlapResult | null
```

Rules:
1. Eligible page needs **at least one** of `sigVec`/`bodyVec`. `observedPages` =
   count of eligible pages. Return `null` when `observedPages < 2`.
2. **Combined pairwise similarity** for pages A,B:
   - Let `hasSig = sigA && sigB`, `hasBody = bodyA && bodyB`.
   - If both present: `wSig·cos(sigA,sigB) + wBody·cos(bodyA,bodyB)` where the
     weights are **renormalized** to sum to 1 over the available components
     (they already sum to 1 when both present).
   - If only one component is shared: use that component's cosine alone
     (weight redistributes — a page missing body still clusters on signature).
   - If neither is shared (e.g. A has only sig, B has only body): similarity = 0
     (never clustered).
3. Build edges for all pairs with combined similarity ≥ `threshold`; **union-find**
   into connected components; keep components of size ≥ 2.
4. Per cluster: `minSimilarity` = MIN combined similarity over the edges internal
   to that component (conservative — a cluster is only as strong as its weakest
   link, matching content-similarity's MIN-pairwise convention).
5. Deterministic ordering: clusters sorted by size desc, then by
   lexicographically-smallest member URL; member URLs sorted ascending; caps
   applied AFTER sort. No `Math.random`/`Date.now`.
6. Cosine uses the shared `cosineSimilarity` (dot product; inputs are L2-normalized
   by `embedTexts`). The pure module does not import the model.

Complexity: all-pairs is O(N²·384). With N capped (see §6) at ~1000, ≈ sub-second.

## 6. Builder integration — `broken-link-verify.ts`

Place the topic-overlap block in the content-analysis sequence, over the SAME
`seoRows.filter(indexableOf ∧ ¬loginLike)` set as signals/similarity. Order and
reserve chaining:

```
signals block   : requires sigRemaining >= CONTENT_SIGNALS_RESERVE_MS + CONTENT_SIM_RESERVE_MS + TOPIC_OVERLAP_RESERVE_MS
topic-overlap   : requires topRemaining >= CONTENT_SIM_RESERVE_MS + TOPIC_OVERLAP_RESERVE_MS
similarity block: requires simRemaining >= CONTENT_SIM_RESERVE_MS   (unchanged)
```

`TOPIC_OVERLAP_RESERVE_MS = 45_000` — generous, because embedding includes a
one-time model cold-start (~1–3 s) plus inference over ≤2N short strings. Skip →
`topicOverlapJson = null`.

Compute path (all inside one `try`, **fail-to-null**, never fails the run write):
1. Take eligible rows; cap to `TOPIC_OVERLAP_MAX_PAGES=1000` (reuse the indexable
   cap; if exceeded, take a deterministic slice by sorted URL and note nothing new
   — the crawl is already page-capped upstream, so this is a backstop).
2. Build, per row: `signatureText` (title/h1/meta joined) and `bodyText`
   (`contentText` prefix, `TOPIC_OVERLAP_BODY_CHARS=2000` — comfortably over the
   ~256-token window so the model, not our slice, is the limiter).
3. Batch `embedTexts([...all signature texts, ...all body texts])` in ONE call;
   split back into per-row `sigVec`/`bodyVec` (empty text → skip that vector,
   producing `null` — do not embed empty strings).
4. `clusterByTopicOverlap(vectors)`; `if (result) topicOverlapJson =
   JSON.stringify({ v: 1, ...result })`.

Memory note (call out in PR): the MiniLM model is a shared module singleton
(~90 MB resident), already loaded when pillar analysis runs in the same worker;
this adds it to the live-scan path. On the 3.8 GB box this is a bounded, shared
cost — no new `BROWSER_POOL_SIZE`/pool pressure, but the reserve + page cap keep
the CPU-bound pass inside the job budget (the pdfjs event-loop incident is the
cautionary tale — this runs in the durable job, never a request handler).

## 7. Read-time surface — `components/site-audit/TopicOverlapSection.tsx` (new)

On the results-page **SEO tab**, placed beside `ContentSimilaritySection`. Reads
the live-scan run's `topicOverlapJson`. States:
- **not-analyzed** — column null (pre-Tier-1 run, or skipped/failed): a muted
  "topic overlap not analyzed for this audit" line (mirror the sibling sections).
- **no-overlap** — parsed, zero clusters: "no topic-overlap clusters detected."
- **clusters** — list each cluster: member URLs (linked), size, and a similarity
  tier label (e.g. "strong"/"moderate" from `minSimilarity` bands — bands are
  display-only, not stored). Honest framing: "pages that appear to target the same
  topic — consider consolidating or differentiating," never "duplicate" (that's the
  lexical section) and never a compliance/ranking claim.
- Capped notice when `clusters.length` hit the cap.
- **Share view unchanged** (consistent with similarity/signals — results page only).

Dark-mode variants on every element; no jest-dom (jsdom env + `afterEach(cleanup)`
+ `getAllByText`/`.toBeTruthy()`).

## 8. Testing

- **Pure clusterer** (`topic-overlap.test.ts`): synthetic 384-dim vectors —
  weighting math (both/one/neither component shared), threshold boundary
  (just-above / just-below), union-find grouping (transitive chain merges into one
  cluster), `minSimilarity` = weakest internal edge, deterministic ordering + caps,
  `<2 eligible → null`, all-null vectors → null. Constants pinned; a locking test
  asserts defaults `0.6/0.4/0.78`.
- **Builder integration** (extend `broken-link-verify.test.ts`, `vi.spyOn` — no
  `vi.mock` in that file): eligible set = indexable ∧ ¬login-like (parity with
  similarity); reserve skip → null; embed throw / model failure → null AND the run
  still writes (mirror the similarity fail-to-null test); `{v:1,...}` wrapper;
  empty-content site → null. Stub `embedTexts` to avoid loading ONNX in tests.
- **Component** (`TopicOverlapSection.test.tsx`): the four states, capped notice,
  dark-mode classes, linked member URLs.
- Gates: `tsc --noEmit` · `DATABASE_URL="file:./local-dev.db" npm test` ·
  `npm run build`, all green (in-build type-check/lint disabled since 2026-07-11 —
  local gates are the ONLY gate).

## 9. Out of scope (breadcrumbed)

- Promotion of topic-overlap to a `Finding` / score factor (gated on real-site
  signal quality; content-similarity precedent).
- GSC-query "also competes" read-time enrichment.
- Suppression / cross-linking of pages also flagged by content-similarity beyond an
  optional read-time note.
- Richer signatures (H2/H3 heading text) — would need a `HarvestedPageSeo` field +
  a `parse-seo-dom.ts` change (SWC-contract-bearing injected code); not worth it.
- The `cat_` content-audit handoff family + 1-h `contentText` retention (own spec).
- Monthly-PDF / fleet-wide topic-overlap views.

## 10. Acceptance criteria

1. A live-scan audit of a site with ≥2 topically-related indexable pages stores a
   non-null `topicOverlapJson` and the results-page SEO tab shows the clusters.
2. A site with no topical overlap shows the "no clusters" state; a pre-Tier-1 /
   skipped / failed run shows "not analyzed" — never a crash, never a false 0.
3. The run write NEVER fails due to embedding: model/throw/timeout → null column,
   everything else on the run persists.
4. Eligible set is byte-identical to the similarity/signals blocks
   (indexable ∧ ¬login-like), computed before transient deletion.
5. `tsc` + vitest + build all green; migration applies and the column is readable.
6. Constants pinned to fixtures; the locking test fails if a default is changed
   without updating the fixture.
