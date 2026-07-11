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

- **D1 — Embed BOTH a topic signature and a body-intro, weighted; BOTH required
  for a page to be clustered** (Codex fix #1 — homogeneous metric).
  - *Signature* = `title + "\n" + h1 + "\n" + metaDescription` (the text fields
    already on `HarvestedPageSeo`; empty parts dropped). What the page *declares*
    it is about. Fits the model window with no truncation.
  - *Body-intro* = the leading slice of `contentText` (MiniLM reads only the first
    ~256 tokens regardless, so we pass a bounded prefix — see §5).
  - Combined pair similarity = `W_SIG·cos(sigA,sigB) + W_BODY·cos(bodyA,bodyB)`.
  - **A page is only a clustering candidate when it has BOTH a non-empty signature
    AND non-empty body text.** This keeps the metric homogeneous so the single
    threshold is comparable across every pair (no weight redistribution, no mixed
    1-component/2-component scores under one cutoff). Pages missing either are
    *counted* (`observedPages`) but not clustered — a page with no title/H1/meta or
    no body is a weak cannibalization candidate and is already covered by
    thin-content/on-page findings. Signature-only / body-only fallback is dropped
    from v1; revisit only if real-site data shows meaningful lost coverage.
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

Stored shape (versioned, `{v:1,...}`-wrapped like the siblings). Metadata is
**explicit and honest** (Codex fix #3 — no inferring truncation from a length):

```jsonc
{
  "v": 1,
  "observedPages": 60,        // eligible pages (indexable ∧ ¬login-like) seen by the block
  "clusteredCandidates": 42,  // pages with BOTH signature AND body vectors (the clustered set)
  "threshold": 0.78,          // the combined-similarity threshold used
  "weights": { "sig": 0.6, "body": 0.4 },
  "bodyPrefixTruncatedPages": 3, // candidates whose body-intro hit the 2000-char prefix slice
                                 // (distinct from the source contentText 30k capture cap)
  "inputCapped": false,       // true iff the TOPIC_OVERLAP_MAX_PAGES cap dropped candidates
  "clustersCapped": false,    // true iff more than MAX_CLUSTERS clusters were found
  "clusters": [
    {
      "urls": ["https://x/nursing-diploma", "https://x/rn-program"], // sorted asc, ≤MAX_MEMBERS
      "size": 2,                // TRUE cluster size (before member truncation)
      "membersTruncated": false,// true iff size > urls.length
      "minEdgeSimilarity": 0.81 // weakest DIRECT edge in the network, over the FULL cluster
                                // (computed before member truncation)
    }
  ]
}
```

**Cluster semantics (Codex fix #2):** clusters are **connected components** of the
graph whose edges are page pairs with combined similarity ≥ `threshold` (union-find
= single-linkage). Membership is therefore transitive: A–B and B–C can both clear
the threshold and land A and C in one network even if the A–C pair does not. This
is honest for a "topic-overlap network" framing; it is NOT a claim that every pair
in a cluster is ≥ threshold. `minEdgeSimilarity` is the weakest *direct edge* that
built the network, not the weakest pair — the earlier "conservative min-pairwise"
wording is removed. Complete-linkage (every pair ≥ threshold) is breadcrumbed as a
promotion-time tightening, not v1.

Caps: at most `TOPIC_OVERLAP_MAX_CLUSTERS=50` clusters (`clustersCapped` flags
overflow), `...MAX_MEMBERS=50` URLs per cluster (per-cluster `membersTruncated`
flag; `size` stays true). `minEdgeSimilarity` is computed over the full cluster
before any member truncation so it never drifts with display caps.

## 5. Algorithm — `lib/ada-audit/seo/topic-overlap.ts` (new, pure)

Clean impure/pure split mirroring `pillarAnalysis` (impure `embeddings.ts` vs pure
`cluster.ts`). The **pure** module owns the pinned, fixture-tested algorithm and
takes **precomputed vectors** — no model dependency, fully deterministic.

```ts
export interface TopicOverlapPageVectors {
  url: string
  sigVec: number[] | null    // null if no signature text
  bodyVec: number[] | null   // null if no body text
  bodyPrefixTruncated: boolean // true iff the 2000-char body-prefix slice trimmed the source
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
1. `observedPages` = count of input pages. A page is a **clustering candidate**
   only when it has BOTH `sigVec` AND `bodyVec` (Codex fix #1 — homogeneous
   metric); `clusteredCandidates` counts those. Return `null` when
   `clusteredCandidates < 2`.
2. **Combined pairwise similarity** for candidates A,B (both always have both
   vectors): `wSig·cos(sigA,sigB) + wBody·cos(bodyA,bodyB)` with `wSig + wBody = 1`
   (defaults `0.6/0.4`). Every pair uses the identical 2-component metric — no
   redistribution, no 1-component fallback, so the single threshold is comparable
   across all pairs.
3. Build edges for all candidate pairs with combined similarity ≥ `threshold`;
   **union-find** into connected components (single-linkage); keep components of
   size ≥ 2. These are "topic-overlap networks" — membership is transitive (see §4
   semantics), not an all-pairs guarantee.
4. Per cluster: `minEdgeSimilarity` = MIN combined similarity over the DIRECT edges
   that built the component (the weakest bridge, not the weakest pair), computed
   over the full component before member truncation. `size` = true member count;
   `membersTruncated` = `size > maxMembers`.
5. Deterministic ordering: clusters sorted by size desc, then by
   lexicographically-smallest member URL; member URLs sorted ascending; caps
   applied AFTER sort (`clustersCapped`/`membersTruncated` set accordingly). No
   `Math.random`/`Date.now`.
6. Cosine uses the shared `cosineSimilarity` (dot product; inputs are L2-normalized
   by `embedTexts`). The pure module does not import the model.

**Bridge fixture (Codex fix #2):** a locking test builds vectors where A–B ≥
threshold and B–C ≥ threshold but A–C < threshold, and asserts A/B/C form ONE
cluster with `minEdgeSimilarity` = min(sim(A,B), sim(B,C)) — pinning the
single-linkage/connected-network semantics against accidental change.

Complexity: all-pairs is O(N²·384). With candidates capped (see §6) at ~1000,
≈ sub-second.

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
one-time model cold-start (~1–3 s) plus inference over the candidate strings. Skip
→ `topicOverlapJson = null`.

Compute path (all inside one `try`, **fail-to-null**, never fails the run write):
1. Take eligible rows (indexable ∧ ¬login-like); keep those with both a signature
   and body text (the clustering candidates). Cap candidates to
   `TOPIC_OVERLAP_MAX_PAGES=1000` — if exceeded, take a deterministic slice by
   sorted URL and set `inputCapped=true` (the crawl is already page-capped
   upstream, so this is a backstop).
2. Build, per candidate: `signatureText` (title/h1/meta joined) and `bodyText`
   (`contentText` prefix, `TOPIC_OVERLAP_BODY_CHARS=2000` — comfortably over the
   ~256-token window so the model, not our slice, is the limiter; set
   `bodyPrefixTruncated` when the slice trims the source).
3. **Cooperative chunked embedding (Codex fix #4).** `@xenova/transformers` runs
   ONNX inference synchronously on the JS thread, so one big `embedTexts` call can
   block the event loop past the reserve and delay the job-worker heartbeat/timeout
   timer (the pdfjs event-loop-starvation incident is the cautionary tale). A new
   helper embeds in bounded chunks of `TOPIC_OVERLAP_EMBED_CHUNK=32` strings, and
   **between chunks**: (a) `await` a macrotask yield (`setImmediate`/`setTimeout 0`)
   so the loop can service the heartbeat, and (b) re-check remaining budget —
   **abandon to `null`** (no partial result) if under `TOPIC_OVERLAP_RESERVE_MS`.
   The signature and body texts are embedded in the same chunked stream, then split
   back into per-candidate `sigVec`/`bodyVec`. Empty strings are never embedded.
4. `clusterByTopicOverlap(vectors)`; `if (result) topicOverlapJson =
   JSON.stringify({ v: 1, ...result })`.

Memory note (Codex fix #5; call out in PR + verify on prod): the MiniLM model is a
**lazy** module singleton (`extractorPromise`) — it is NOT guaranteed resident when
a live scan runs, because pillar analysis may not have executed in this worker
process. So this change can add the model's persistent RSS (~90 MB) plus inference
temporaries to *every* qualifying live scan on a process that never loaded it. This
is acceptable for a measurement-only, fail-to-null signal, but before any promotion
we **measure cold/warm RSS + inference latency on a real audit with the Chrome pool
active** (a canary), and we **confirm the model artifact is already on disk on prod**
(pillar analysis has run there, so the `@xenova` cache exists) — a first-use
model *download* must never happen during a scan. No `BROWSER_POOL_SIZE`/pool change;
the reserve + candidate cap + chunked-yield keep the CPU-bound pass inside the job
budget, and it runs in the durable job, never a request handler.

## 7. Read-time surface — `components/site-audit/TopicOverlapSection.tsx` (new)

On the results-page **SEO tab**, placed beside `ContentSimilaritySection`. Reads
the live-scan run's `topicOverlapJson`. States:
- **not-analyzed** — column null (pre-Tier-1 run, or skipped/failed): a muted
  "topic overlap not analyzed for this audit" line (mirror the sibling sections).
- **no-overlap** — parsed, zero clusters: "no topic-overlap clusters detected."
- **networks** — list each topic-overlap network: member URLs (linked), true
  `size` (with a "+N more" note when `membersTruncated`), and a tier label
  (e.g. "strong"/"moderate" from `minEdgeSimilarity` bands — bands are display-only,
  not stored). Honest framing: "these pages form a topic-overlap network — related
  pages that may compete; review for consolidation or differentiation," never
  "duplicate" (that's the lexical section), never an all-pairs claim, never a
  compliance/ranking claim.
- Capped notice driven by the explicit `clustersCapped` / per-network
  `membersTruncated` flags (NOT inferred from list length).
- **Share view unchanged** (consistent with similarity/signals — results page only).

Dark-mode variants on every element; no jest-dom (jsdom env + `afterEach(cleanup)`
+ `getAllByText`/`.toBeTruthy()`).

## 8. Testing

- **Pure clusterer** (`topic-overlap.test.ts`): synthetic 384-dim vectors —
  2-component weighting math, threshold boundary (just-above / just-below), the
  **bridge fixture** (A–B and B–C above, A–C below → ONE network,
  `minEdgeSimilarity` = weakest direct edge), deterministic ordering, cluster + member
  caps with `clustersCapped`/`membersTruncated`/`size` set correctly (size stays true
  under member truncation), candidates-require-both-vectors (`observedPages` vs
  `clusteredCandidates`), `<2 candidates → null`. Constants pinned; a locking test
  asserts defaults `0.6/0.4/0.78`.
- **Chunked embedder** (unit): stubbed `embedTexts` — chunk boundaries preserve
  input→vector order, a yield occurs between chunks, and an under-budget deadline
  check mid-stream abandons to `null` (no partial vectors).
- **Builder integration** (extend `broken-link-verify.test.ts`, `vi.spyOn` — no
  `vi.mock` in that file): candidate set = indexable ∧ ¬login-like ∧ both-vectors;
  reserve skip → null; embed throw / model failure → null AND the run still writes
  (mirror the similarity fail-to-null test); `{v:1,...}` wrapper; empty-content site
  → null; `inputCapped` set when the page cap trips. Stub `embedTexts` to avoid
  loading ONNX in tests.
- **Component** (`TopicOverlapSection.test.tsx`): the four states, capped/truncated
  notices (from the explicit flags), dark-mode classes, linked member URLs.
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
3. The run write NEVER fails due to embedding: model/throw/timeout/deadline-abandon
   → null column, everything else on the run persists.
4. Eligible set is byte-identical to the similarity/signals blocks
   (indexable ∧ ¬login-like), computed before transient deletion; candidates are
   that set restricted to both-vectors pages.
5. Embedding is chunked with an inter-chunk event-loop yield and a per-chunk
   deadline check (no single blocking call over the whole candidate set).
6. `tsc` + vitest + build all green; migration applies and the column is readable.
7. Constants pinned to fixtures; the locking test (incl. the bridge fixture) fails
   if a default or the cluster semantics change without updating the fixture.
8. Prod verification includes confirming the `@xenova` model artifact is already
   on disk (no scan-time download) and a cold/warm RSS + latency observation.
