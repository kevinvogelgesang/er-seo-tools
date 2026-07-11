# C12 Tier-1 — MiniLM Topic-Overlap Cannibalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect semantic keyword cannibalization — sets of pages targeting the same topic even with different wording — using the local MiniLM embedding model, stored as measurement-only run metadata.

**Architecture:** A pure clusterer (`topic-overlap.ts`) takes precomputed 384-dim vectors and returns connected-component "topic-overlap networks" via union-find over a weighted signature+body cosine metric. A cooperative chunked embedder (`embed-chunked.ts`) wraps the existing `embedTexts` so synchronous ONNX inference can't starve the job worker. The live-scan builder (`broken-link-verify.ts`) embeds the indexable∧¬login-like candidate set before transient deletion, clusters it, and writes `CrawlRun.topicOverlapJson`. A read-time `TopicOverlapSection` renders on the results-page SEO tab. NOT a Finding, NO score change (measurement-first, content-similarity precedent).

**Tech Stack:** TypeScript, Next.js 15 App Router, Prisma + SQLite, `@xenova/transformers` (MiniLM-L6-v2, already a dependency), vitest.

## Global Constraints

- **Local gates are the ONLY type-check gate** (in-build tsc/eslint disabled 2026-07-11). Every task ends gate-green: `npx tsc --noEmit`, `DATABASE_URL="file:./local-dev.db" npm test`, `npm run build`.
- **`topic-overlap.ts` and `embed-chunked.ts` are ordinary Node modules** — NOT `.toString()`-injected. No SWC/`typeof`-helper contract applies. `parse-seo-dom.ts` is NOT touched.
- **Determinism:** no `Math.random`, no `Date.now()`/`new Date()` inside the pure clusterer. Constants are pinned to fixtures; a locking test fails if a default changes without the fixture.
- **Measurement-first:** `topicOverlapJson` is run metadata only. NOT a Finding, NO effect on any score. `selectRuns`/canonical selection unchanged.
- **Fail-to-null:** any throw, model failure, or deadline-abandon in the builder block leaves `topicOverlapJson = null`; the live-scan run write must still succeed.
- **Array-form `$transaction` only** (no interactive transactions). This plan adds no transaction — the column rides the existing writer `crawlRun.create({ data: { ...run } })` spread.
- **Never `git add -A`/`-u` at repo root** (untracked `pentest-results/`, `.playwright-mcp/`). Stage explicit paths only.
- **Migrations:** `migrate dev` is interactive-only here — hand-author the SQL and apply with `migrate deploy` + `generate`. SQLite additive `ADD COLUMN` only.
- **Pinned constants:** `W_SIG=0.6`, `W_BODY=0.4`, `TOPIC_OVERLAP_THRESHOLD=0.78`, `MAX_CLUSTERS=50`, `MAX_MEMBERS=50`, `EMBED_CHUNK=32`, `BODY_CHARS=2000`, `MAX_PAGES=1000`, `RESERVE_MS=45_000`.

---

## File structure

- **Create** `lib/ada-audit/seo/topic-overlap.ts` — pure clusterer (no model dep).
- **Create** `lib/ada-audit/seo/topic-overlap.test.ts` — clusterer unit tests.
- **Create** `lib/ada-audit/seo/embed-chunked.ts` — cooperative chunked embedder.
- **Create** `lib/ada-audit/seo/embed-chunked.test.ts` — embedder unit tests.
- **Create** `components/site-audit/TopicOverlapSection.tsx` — read-time section.
- **Create** `components/site-audit/TopicOverlapSection.test.tsx` — component tests.
- **Modify** `prisma/schema.prisma` — add `CrawlRun.topicOverlapJson String?`.
- **Create** `prisma/migrations/20260712120000_topic_overlap/migration.sql`.
- **Modify** `lib/findings/types.ts:32-52` — add `topicOverlapJson?` to `CrawlRunInput`.
- **Modify** `lib/jobs/handlers/broken-link-verify.ts` — reserve consts (~L94-96), topic block (after L551), bundle field (L587).
- **Modify** `lib/jobs/handlers/broken-link-verify.test.ts` — builder integration cases.
- **Modify** `app/(app)/ada-audit/site/[id]/page.tsx` — select `topicOverlapJson` (~L230), render `<TopicOverlapSection>` (after L290). **Share page NOT touched** (follows content-signals: results-page-only).

---

### Task 1: Schema column + migration + CrawlRunInput field

**Files:**
- Modify: `prisma/schema.prisma` (CrawlRun model, near line 413)
- Create: `prisma/migrations/20260712120000_topic_overlap/migration.sql`
- Modify: `lib/findings/types.ts:49` (add field after `contentSignalsJson`)

**Interfaces:**
- Produces: `CrawlRun.topicOverlapJson: String?` (DB + Prisma client) and
  `CrawlRunInput.topicOverlapJson?: string | null` — consumed by Task 4 (builder
  write via `{ ...run }` spread) and Task 5 (read).

- [ ] **Step 1: Confirm no later migration collides**

Run: `ls prisma/migrations | tail -5`
Expected: newest is `20260712000000_*` (Tier-0). `20260712120000` sorts after it.

- [ ] **Step 2: Add the Prisma column**

In `prisma/schema.prisma`, directly after the `contentSignalsJson` line (~413) in `model CrawlRun`:

```prisma
  topicOverlapJson      String? // C12 Tier-1: semantic topic-overlap networks (live-scan runs only); measurement, NOT a finding
```

- [ ] **Step 3: Hand-author the migration**

Create `prisma/migrations/20260712120000_topic_overlap/migration.sql`:

```sql
-- C12 Tier-1: additive nullable column for semantic topic-overlap clusters (live-scan runs only).
ALTER TABLE "CrawlRun" ADD COLUMN "topicOverlapJson" TEXT;
```

- [ ] **Step 4: Apply the migration + regenerate the client**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: migration `20260712120000_topic_overlap` applied; client regenerated.

- [ ] **Step 5: Add the CrawlRunInput field**

In `lib/findings/types.ts`, immediately after line 49 (`contentSignalsJson?: string | null ...`):

```ts
  topicOverlapJson?: string | null   // C12 Tier-1: semantic topic-overlap networks; live-scan runs only
```

- [ ] **Step 6: Verify types compile + column is readable**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

Run:
```bash
DATABASE_URL="file:./local-dev.db" node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.crawlRun.findFirst({select:{topicOverlapJson:true}}).then(r=>{console.log('column readable:',r===null?'no rows':'ok');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: prints `column readable: ...` and exits 0.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260712120000_topic_overlap/migration.sql lib/findings/types.ts
git commit -m "feat(c12): CrawlRun.topicOverlapJson column + CrawlRunInput field (Tier-1)"
```

---

### Task 2: Pure clusterer `lib/ada-audit/seo/topic-overlap.ts`

**Files:**
- Create: `lib/ada-audit/seo/topic-overlap.ts`
- Test: `lib/ada-audit/seo/topic-overlap.test.ts`

**Interfaces:**
- Consumes: `cosineSimilarity` from `@/lib/services/pillarAnalysis/embeddings`.
- Produces:
  - `clusterByTopicOverlap(pages: TopicOverlapPageVectors[], opts?: TopicOverlapOptions): TopicOverlapResult | null`
  - `TopicOverlapPageVectors = { url: string; sigVec: number[] | null; bodyVec: number[] | null; bodyPrefixTruncated: boolean }`
  - `TopicOverlapOptions = { wSig?, wBody?, threshold?, maxClusters?, maxMembers?, inputCapped?: boolean }`
  - `TopicOverlapResult = { observedPages, clusteredCandidates, threshold, weights:{sig,body}, bodyPrefixTruncatedPages, inputCapped, clustersCapped, clusters: TopicOverlapCluster[] }`
  - `TopicOverlapCluster = { urls: string[]; size: number; membersTruncated: boolean; minEdgeSimilarity: number }`
  - `TOPIC_OVERLAP_DEFAULTS = { wSig:0.6, wBody:0.4, threshold:0.78, maxClusters:50, maxMembers:50 }`
  - Consumed by Task 4 (builder) and Task 5 (component parses the JSON shape).

- [ ] **Step 1: Write the failing tests**

Create `lib/ada-audit/seo/topic-overlap.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { clusterByTopicOverlap, TOPIC_OVERLAP_DEFAULTS, type TopicOverlapPageVectors } from './topic-overlap'

// Helper: 2-D unit vectors on the circle so we control cosine exactly.
// cos(angle-between) = dot for unit vectors. angleDeg → [cos, sin].
function unit(angleDeg: number): number[] {
  const r = (angleDeg * Math.PI) / 180
  return [Math.cos(r), Math.sin(r)]
}
function page(url: string, sigDeg: number | null, bodyDeg: number | null, trunc = false): TopicOverlapPageVectors {
  return {
    url,
    sigVec: sigDeg === null ? null : unit(sigDeg),
    bodyVec: bodyDeg === null ? null : unit(bodyDeg),
    bodyPrefixTruncated: trunc,
  }
}

describe('clusterByTopicOverlap', () => {
  it('exposes pinned defaults', () => {
    expect(TOPIC_OVERLAP_DEFAULTS).toEqual({ wSig: 0.6, wBody: 0.4, threshold: 0.78, maxClusters: 50, maxMembers: 50 })
  })

  it('returns null with fewer than 2 clustering candidates', () => {
    // one candidate (both vecs) + one sig-only → clusteredCandidates = 1
    expect(clusterByTopicOverlap([page('a', 0, 0), page('b', 0, null)])).toBeNull()
    expect(clusterByTopicOverlap([])).toBeNull()
  })

  it('counts observedPages (all) vs clusteredCandidates (both-vector only)', () => {
    // a,b are identical candidates → 1 cluster; c is body-only (not a candidate)
    const r = clusterByTopicOverlap([page('a', 0, 0), page('b', 0, 0), page('c', null, 0)])!
    expect(r.observedPages).toBe(3)
    expect(r.clusteredCandidates).toBe(2)
    expect(r.clusters).toHaveLength(1)
    expect(r.clusters[0].urls).toEqual(['a', 'b'])
    expect(r.clusters[0].size).toBe(2)
    expect(r.clusters[0].minEdgeSimilarity).toBeCloseTo(1, 5)
  })

  it('thresholds the weighted 2-component metric (0.6*sig + 0.4*body)', () => {
    // sig identical (cos=1), body 60° apart (cos=0.5): combined = 0.6*1 + 0.4*0.5 = 0.8 ≥ 0.78 → cluster
    expect(clusterByTopicOverlap([page('a', 0, 0), page('b', 0, 60)])!.clusters).toHaveLength(1)
    // body 90° apart (cos=0): combined = 0.6*1 + 0.4*0 = 0.6 < 0.78 → no cluster
    expect(clusterByTopicOverlap([page('a', 0, 0), page('b', 0, 90)])).toBeNull()
  })

  it('BRIDGE FIXTURE: single-linkage connects A-B-C even when A-C is below threshold', () => {
    // Choose sig=body angles so combined sim is just the cosine of the angle gap.
    // A@0, B@33, C@66 (all sig=body so combined = cos(gap)).
    // cos(33°)=0.838 ≥0.78 (A-B, B-C); cos(66°)=0.407 <0.78 (A-C).
    const r = clusterByTopicOverlap([page('a', 0, 0), page('b', 33, 33), page('c', 66, 66)])!
    expect(r.clusters).toHaveLength(1)
    expect(r.clusters[0].urls).toEqual(['a', 'b', 'c'])
    expect(r.clusters[0].size).toBe(3)
    // minEdgeSimilarity = weakest DIRECT edge (A-B or B-C), NOT the A-C non-edge.
    expect(r.clusters[0].minEdgeSimilarity).toBeCloseTo(Math.cos((33 * Math.PI) / 180), 4)
  })

  it('orders clusters by size desc then smallest-url; sorts member urls asc', () => {
    // cluster1: a,b,c identical @0 ; cluster2: y,z identical @180
    const r = clusterByTopicOverlap([
      page('c', 0, 0), page('a', 0, 0), page('b', 0, 0),
      page('z', 180, 180), page('y', 180, 180),
    ])!
    expect(r.clusters.map((c) => c.urls)).toEqual([['a', 'b', 'c'], ['y', 'z']])
  })

  it('caps members and clusters with explicit honest flags', () => {
    const many = Array.from({ length: 55 }, (_, i) => page(`u${String(i).padStart(2, '0')}`, 0, 0))
    const r = clusterByTopicOverlap(many, { maxMembers: 50 })!
    expect(r.clusters).toHaveLength(1)
    expect(r.clusters[0].size).toBe(55)            // TRUE size preserved
    expect(r.clusters[0].urls).toHaveLength(50)    // members truncated
    expect(r.clusters[0].membersTruncated).toBe(true)
    expect(r.clustersCapped).toBe(false)
  })

  it('echoes inputCapped and counts bodyPrefixTruncatedPages', () => {
    const r = clusterByTopicOverlap([page('a', 0, 0, true), page('b', 0, 0, false)], { inputCapped: true })!
    expect(r.inputCapped).toBe(true)
    expect(r.bodyPrefixTruncatedPages).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/topic-overlap.test.ts`
Expected: FAIL — cannot find module `./topic-overlap`.

- [ ] **Step 3: Write the implementation**

Create `lib/ada-audit/seo/topic-overlap.ts`:

```ts
// lib/ada-audit/seo/topic-overlap.ts
// C12 Tier-1: semantic topic-overlap clustering over MiniLM embeddings.
// PURE module — takes precomputed vectors, no model dependency, deterministic
// (no Math.random / Date.now). Measurement-only (CrawlRun.topicOverlapJson); NOT a Finding.
import { cosineSimilarity } from '@/lib/services/pillarAnalysis/embeddings'

export const TOPIC_OVERLAP_DEFAULTS = {
  wSig: 0.6,
  wBody: 0.4,
  threshold: 0.78,
  maxClusters: 50,
  maxMembers: 50,
} as const

export interface TopicOverlapPageVectors {
  url: string
  sigVec: number[] | null
  bodyVec: number[] | null
  bodyPrefixTruncated: boolean
}

export interface TopicOverlapOptions {
  wSig?: number
  wBody?: number
  threshold?: number
  maxClusters?: number
  maxMembers?: number
  inputCapped?: boolean
}

export interface TopicOverlapCluster {
  urls: string[]
  size: number
  membersTruncated: boolean
  minEdgeSimilarity: number
}

export interface TopicOverlapResult {
  observedPages: number
  clusteredCandidates: number
  threshold: number
  weights: { sig: number; body: number }
  bodyPrefixTruncatedPages: number
  inputCapped: boolean
  clustersCapped: boolean
  clusters: TopicOverlapCluster[]
}

export function clusterByTopicOverlap(
  pages: TopicOverlapPageVectors[],
  opts: TopicOverlapOptions = {},
): TopicOverlapResult | null {
  const wSig = opts.wSig ?? TOPIC_OVERLAP_DEFAULTS.wSig
  const wBody = opts.wBody ?? TOPIC_OVERLAP_DEFAULTS.wBody
  const threshold = opts.threshold ?? TOPIC_OVERLAP_DEFAULTS.threshold
  const maxClusters = opts.maxClusters ?? TOPIC_OVERLAP_DEFAULTS.maxClusters
  const maxMembers = opts.maxMembers ?? TOPIC_OVERLAP_DEFAULTS.maxMembers

  const observedPages = pages.length
  // Homogeneous metric: only pages with BOTH vectors are clustering candidates.
  const candidates = pages.filter((p) => p.sigVec && p.bodyVec)
  const clusteredCandidates = candidates.length
  const bodyPrefixTruncatedPages = candidates.filter((p) => p.bodyPrefixTruncated).length

  if (clusteredCandidates < 2) return null

  const n = clusteredCandidates
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  const edges: { a: number; b: number; sim: number }[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim =
        wSig * cosineSimilarity(candidates[i].sigVec!, candidates[j].sigVec!) +
        wBody * cosineSimilarity(candidates[i].bodyVec!, candidates[j].bodyVec!)
      if (sim >= threshold) {
        edges.push({ a: i, b: j, sim })
        union(i, j)
      }
    }
  }

  const membersByRoot = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const arr = membersByRoot.get(r)
    if (arr) arr.push(i)
    else membersByRoot.set(r, [i])
  }
  // Weakest DIRECT edge per final component (single-linkage bridge, not weakest pair).
  const minEdgeByRoot = new Map<number, number>()
  for (const e of edges) {
    const r = find(e.a)
    const cur = minEdgeByRoot.get(r)
    minEdgeByRoot.set(r, cur === undefined ? e.sim : Math.min(cur, e.sim))
  }

  let clusters: TopicOverlapCluster[] = []
  for (const [root, members] of membersByRoot) {
    if (members.length < 2) continue
    const urls = members.map((i) => candidates[i].url).sort()
    const size = urls.length
    clusters.push({
      urls: urls.slice(0, maxMembers),
      size,
      membersTruncated: size > maxMembers,
      minEdgeSimilarity: minEdgeByRoot.get(root) ?? threshold,
    })
  }
  clusters.sort((a, b) => b.size - a.size || (a.urls[0] < b.urls[0] ? -1 : a.urls[0] > b.urls[0] ? 1 : 0))
  const clustersCapped = clusters.length > maxClusters
  clusters = clusters.slice(0, maxClusters)

  return {
    observedPages,
    clusteredCandidates,
    threshold,
    weights: { sig: wSig, body: wBody },
    bodyPrefixTruncatedPages,
    inputCapped: opts.inputCapped ?? false,
    clustersCapped,
    clusters,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/topic-overlap.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/topic-overlap.ts lib/ada-audit/seo/topic-overlap.test.ts
git commit -m "feat(c12): pure topic-overlap clusterer (weighted metric, single-linkage networks)"
```

---

### Task 3: Cooperative chunked embedder `lib/ada-audit/seo/embed-chunked.ts`

**Files:**
- Create: `lib/ada-audit/seo/embed-chunked.ts`
- Test: `lib/ada-audit/seo/embed-chunked.test.ts`

**Interfaces:**
- Produces: `embedChunked(texts: string[], deps: EmbedChunkedDeps): Promise<number[][] | null>`
  where `EmbedChunkedDeps = { embed: (texts:string[]) => Promise<number[][]>; yieldFn?: () => Promise<void>; shouldAbort?: () => boolean; chunkSize?: number }`.
  Returns vectors in input order, or `null` if `shouldAbort()` fires before a chunk.
  Consumed by Task 4 (builder passes the real `embedTexts`).

- [ ] **Step 1: Write the failing tests**

Create `lib/ada-audit/seo/embed-chunked.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { embedChunked } from './embed-chunked'

describe('embedChunked', () => {
  it('preserves input→vector order across chunk boundaries', async () => {
    const texts = Array.from({ length: 10 }, (_, i) => `t${i}`)
    const embed = vi.fn(async (chunk: string[]) => chunk.map((t) => [Number(t.slice(1))]))
    const out = await embedChunked(texts, { embed, chunkSize: 3, yieldFn: async () => {} })
    expect(out).toEqual(texts.map((_, i) => [i]))
    expect(embed).toHaveBeenCalledTimes(4) // 3+3+3+1
  })

  it('yields between chunks but not after the last', async () => {
    const yieldFn = vi.fn(async () => {})
    const embed = async (chunk: string[]) => chunk.map(() => [0])
    await embedChunked(['a', 'b', 'c', 'd'], { embed, chunkSize: 2, yieldFn })
    expect(yieldFn).toHaveBeenCalledTimes(1) // one gap between the two chunks
  })

  it('abandons to null when shouldAbort fires mid-stream (no partial result)', async () => {
    let calls = 0
    const embed = vi.fn(async (chunk: string[]) => chunk.map(() => [0]))
    const shouldAbort = () => {
      calls += 1
      return calls > 1 // allow first chunk, abort before the second
    }
    const out = await embedChunked(['a', 'b', 'c', 'd'], { embed, chunkSize: 2, yieldFn: async () => {}, shouldAbort })
    expect(out).toBeNull()
    expect(embed).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/embed-chunked.test.ts`
Expected: FAIL — cannot find module `./embed-chunked`.

- [ ] **Step 3: Write the implementation**

Create `lib/ada-audit/seo/embed-chunked.ts`:

```ts
// lib/ada-audit/seo/embed-chunked.ts
// C12 Tier-1: cooperative chunked embedding. @xenova/transformers runs ONNX
// inference synchronously on the JS thread, so one large embedTexts call can
// block the event loop past the reserve and delay the job-worker heartbeat/timeout
// (the pdfjs event-loop-starvation incident is the cautionary tale). This splits
// the work into bounded chunks with an event-loop yield + deadline check between
// them, abandoning to null (no partial result) if the deadline passes.
export interface EmbedChunkedDeps {
  embed: (texts: string[]) => Promise<number[][]>
  yieldFn?: () => Promise<void>
  shouldAbort?: () => boolean
  chunkSize?: number
}

const defaultYield = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))

export async function embedChunked(texts: string[], deps: EmbedChunkedDeps): Promise<number[][] | null> {
  const chunkSize = deps.chunkSize ?? 32
  const yieldFn = deps.yieldFn ?? defaultYield
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += chunkSize) {
    if (deps.shouldAbort?.()) return null
    const chunk = texts.slice(i, i + chunkSize)
    const vecs = await deps.embed(chunk)
    for (const v of vecs) out.push(v)
    if (i + chunkSize < texts.length) await yieldFn()
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/embed-chunked.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/embed-chunked.ts lib/ada-audit/seo/embed-chunked.test.ts
git commit -m "feat(c12): cooperative chunked embedder (yield + deadline abandon)"
```

---

### Task 4: Builder integration in `broken-link-verify.ts`

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (imports; consts ~L94-96; block after L551; bundle field L587)
- Test: `lib/jobs/handlers/broken-link-verify.test.ts`

**Interfaces:**
- Consumes: `clusterByTopicOverlap` (Task 2), `embedChunked` (Task 3), `embedTexts` (existing), `CrawlRunInput.topicOverlapJson` (Task 1).
- Produces: `bundle.run.topicOverlapJson` written via the existing `{ ...run }` spread in `writeFindingsRun`. Consumed by Task 5 (read).

- [ ] **Step 1: Add imports (top of file, near the other seo imports ~L35)**

```ts
import { clusterByTopicOverlap } from '@/lib/ada-audit/seo/topic-overlap'
import { embedChunked } from '@/lib/ada-audit/seo/embed-chunked'
import { embedTexts } from '@/lib/services/pillarAnalysis/embeddings'
```

- [ ] **Step 2: Add the reserve/limit constants (after line 96, beside `CONTENT_SIGNALS_RESERVE_MS`)**

```ts
const TOPIC_OVERLAP_RESERVE_MS = 45_000 // skip topic-overlap if under this + the similarity reserve
const TOPIC_OVERLAP_EMBED_CHUNK = 32    // embed in bounded chunks; yield between them
const TOPIC_OVERLAP_BODY_CHARS = 2000   // body-intro prefix (MiniLM reads ~256 tokens anyway)
const TOPIC_OVERLAP_MAX_PAGES = 1000    // backstop candidate cap (crawl is page-capped upstream)
```

- [ ] **Step 3: Widen the content-signals reserve guard (line 541)**

Change:
```ts
  if (sigRemaining >= CONTENT_SIGNALS_RESERVE_MS + CONTENT_SIM_RESERVE_MS) {
```
to:
```ts
  if (sigRemaining >= CONTENT_SIGNALS_RESERVE_MS + TOPIC_OVERLAP_RESERVE_MS + CONTENT_SIM_RESERVE_MS) {
```

- [ ] **Step 4: Insert the topic-overlap block between the signals block (ends L551) and the similarity block (starts L553)**

```ts
  // C12 Tier-1: semantic topic-overlap networks over MiniLM embeddings, over the
  // SAME indexable ∧ ¬login-like set. Runs BEFORE similarity, so its reserve
  // accounts for both remaining blocks. Cooperative chunked embedding keeps the
  // synchronous ONNX pass off the event-loop critical path. Fail-to-null: a throw,
  // model failure, or deadline-abandon must NEVER fail the live-scan write.
  let topicOverlapJson: string | null = null
  const topicRemaining = JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS
  if (topicRemaining >= TOPIC_OVERLAP_RESERVE_MS + CONTENT_SIM_RESERVE_MS) {
    try {
      const eligible = seoRows.filter((r) => indexableOf(r) && !r.loginLike)
      const withText = eligible.map((r) => ({
        url: r.url,
        sigText: [r.title, r.h1, r.metaDescription].map((s) => (s ?? '').trim()).filter(Boolean).join('\n'),
        bodyFull: (r.contentText ?? '').trim(),
      }))
      const candidates = withText.filter((c) => c.sigText.length > 0 && c.bodyFull.length > 0)
      const inputCapped = candidates.length > TOPIC_OVERLAP_MAX_PAGES
      const kept = inputCapped
        ? [...candidates].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)).slice(0, TOPIC_OVERLAP_MAX_PAGES)
        : candidates
      if (kept.length >= 2) {
        const sigTexts = kept.map((c) => c.sigText)
        const bodyTexts = kept.map((c) => c.bodyFull.slice(0, TOPIC_OVERLAP_BODY_CHARS))
        const vecs = await embedChunked([...sigTexts, ...bodyTexts], {
          embed: embedTexts,
          chunkSize: TOPIC_OVERLAP_EMBED_CHUNK,
          shouldAbort: () =>
            JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS < TOPIC_OVERLAP_RESERVE_MS,
        })
        if (vecs) {
          const m = kept.length
          const vecByUrl = new Map(
            kept.map((c, i) => [
              c.url,
              { sigVec: vecs[i], bodyVec: vecs[m + i], bodyPrefixTruncated: c.bodyFull.length > TOPIC_OVERLAP_BODY_CHARS },
            ]),
          )
          const pageVecs = eligible.map((r) => {
            const v = vecByUrl.get(r.url)
            return v
              ? { url: r.url, sigVec: v.sigVec, bodyVec: v.bodyVec, bodyPrefixTruncated: v.bodyPrefixTruncated }
              : { url: r.url, sigVec: null, bodyVec: null, bodyPrefixTruncated: false }
          })
          const result = clusterByTopicOverlap(pageVecs, { inputCapped })
          if (result) topicOverlapJson = JSON.stringify({ v: 1, ...result })
        }
      }
    } catch (e) {
      console.error('[live-seo] topic overlap failed', e)
    }
  }
```

- [ ] **Step 5: Add the field to `bundle.run` (after `contentSignalsJson,` at line 584)**

```ts
      topicOverlapJson,
```

- [ ] **Step 6: Add builder integration tests**

In `lib/jobs/handlers/broken-link-verify.test.ts`, add a `describe('topic overlap', ...)` block. Use `vi.spyOn` on the embeddings module (this file's convention — NO `vi.mock`). Stub `embedTexts` to return deterministic unit vectors sized to its input so two same-topic pages cluster:

```ts
import * as embeddings from '@/lib/services/pillarAnalysis/embeddings'

// inside the topic-overlap describe:
it('writes topicOverlapJson clustering two same-topic pages; fail-to-null on embed throw', async () => {
  // Arrange: two indexable, non-login HarvestedPageSeo rows with identical topical
  // signature + body text (see existing helpers in this file for row/audit setup).
  // Stub embedTexts: every text → the SAME unit vector so both pages are identical.
  const spy = vi.spyOn(embeddings, 'embedTexts').mockImplementation(async (texts: string[]) =>
    texts.map(() => [1, 0]),
  )

  // Act: run the verifier to terminal (reuse this file's run-to-completion helper).
  // Assert: the live-scan CrawlRun has non-null topicOverlapJson with one cluster.
  //   const run = await prisma.crawlRun.findFirst({ where: { source: 'live-scan' }, select: { topicOverlapJson: true } })
  //   const d = JSON.parse(run!.topicOverlapJson!)
  //   expect(d.v).toBe(1)
  //   expect(d.clusters).toHaveLength(1)

  // Then: embed throw → topicOverlapJson null AND the run still writes.
  spy.mockRejectedValueOnce(new Error('model boom'))
  // re-run; assert run persists with topicOverlapJson === null.
  spy.mockRestore()
})
```

> Implementer note: wire the assertions to this test file's existing fixtures
> (audit/site/`HarvestedPageSeo` builders + the run-to-terminal helper). The two
> behaviors to prove: (1) a non-null `{v:1,...}` cluster on identical-topic pages,
> (2) `embedTexts` rejection → `topicOverlapJson: null` while `writeFindingsRun`
> still succeeds (mirror the existing content-similarity fail-to-null test).

- [ ] **Step 7: Run the builder tests + typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS (existing cases + the two new assertions).

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(c12): compute topic-overlap in the live-scan builder (chunked embed, fail-to-null)"
```

---

### Task 5: Read-time `TopicOverlapSection` + wire into the results page

**Files:**
- Create: `components/site-audit/TopicOverlapSection.tsx`
- Test: `components/site-audit/TopicOverlapSection.test.tsx`
- Modify: `app/(app)/ada-audit/site/[id]/page.tsx` (select ~L230; render after L290)

**Interfaces:**
- Consumes: the `topicOverlapJson` shape from Task 2/4.
- Produces: `TopicOverlapSection({ run }: { run: { topicOverlapJson: string | null } | null })`.

- [ ] **Step 1: Write the failing component tests**

Create `components/site-audit/TopicOverlapSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TopicOverlapSection } from './TopicOverlapSection'

afterEach(cleanup)

describe('TopicOverlapSection', () => {
  it('renders the not-analyzed state when json is null', () => {
    render(<TopicOverlapSection run={{ topicOverlapJson: null }} />)
    expect(screen.getAllByText(/not analyzed/i).length).toBeGreaterThan(0)
  })

  it('renders the not-analyzed state on malformed json', () => {
    render(<TopicOverlapSection run={{ topicOverlapJson: '{bad' }} />)
    expect(screen.getAllByText(/not analyzed/i).length).toBeGreaterThan(0)
  })

  it('renders the clean state when there are no clusters', () => {
    const json = JSON.stringify({ v: 1, observedPages: 5, clusteredCandidates: 5, threshold: 0.78, weights: { sig: 0.6, body: 0.4 }, bodyPrefixTruncatedPages: 0, inputCapped: false, clustersCapped: false, clusters: [] })
    render(<TopicOverlapSection run={{ topicOverlapJson: json }} />)
    expect(screen.getAllByText(/no topic-overlap/i).length).toBeGreaterThan(0)
  })

  it('lists networks with member urls, true size, and truncation notice', () => {
    const json = JSON.stringify({
      v: 1, observedPages: 60, clusteredCandidates: 42, threshold: 0.78, weights: { sig: 0.6, body: 0.4 },
      bodyPrefixTruncatedPages: 0, inputCapped: false, clustersCapped: false,
      clusters: [{ urls: ['https://x/nursing-diploma', 'https://x/rn-program'], size: 2, membersTruncated: false, minEdgeSimilarity: 0.81 }],
    })
    render(<TopicOverlapSection run={{ topicOverlapJson: json }} />)
    expect(screen.getAllByText(/nursing-diploma/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/rn-program/).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/TopicOverlapSection.test.tsx`
Expected: FAIL — cannot find module `./TopicOverlapSection`.

- [ ] **Step 3: Write the component (mirrors `ContentSignalsSection` conventions)**

Create `components/site-audit/TopicOverlapSection.tsx`:

```tsx
// components/site-audit/TopicOverlapSection.tsx
// C12 Tier-1: read-time semantic topic-overlap networks. Reads the SAME live-scan
// CrawlRun as the sibling measurement sections, from topicOverlapJson. Measurement,
// NOT a finding, NO score effect. Results page only (share view unchanged).
interface OverlapCluster {
  urls: string[]
  size: number
  membersTruncated: boolean
  minEdgeSimilarity: number
}
interface OverlapData {
  observedPages?: number
  clusteredCandidates?: number
  clustersCapped?: boolean
  bodyPrefixTruncatedPages?: number
  clusters?: OverlapCluster[]
}

const NOT_ANALYZED = 'Topic overlap was not analyzed for this audit.'

function tierLabel(sim: number): string {
  if (sim >= 0.9) return 'strong'
  if (sim >= 0.83) return 'moderate'
  return 'weak'
}

function NotAnalyzed() {
  return (
    <section className="mt-6 rounded-lg bg-white dark:bg-navy-card p-4 border border-gray-200 dark:border-navy-border">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">Topic overlap</h3>
      <p className="mt-2 text-sm text-gray-600 dark:text-white/60">{NOT_ANALYZED}</p>
    </section>
  )
}

export function TopicOverlapSection({ run }: { run: { topicOverlapJson: string | null } | null }) {
  if (!run?.topicOverlapJson) return <NotAnalyzed />

  let d: OverlapData
  try {
    d = JSON.parse(run.topicOverlapJson)
  } catch {
    return <NotAnalyzed />
  }

  const clusters = d.clusters ?? []

  return (
    <section className="mt-6 rounded-lg bg-white dark:bg-navy-card p-4 border border-gray-200 dark:border-navy-border">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">Topic overlap</h3>

      {clusters.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600 dark:text-white/60">
          No topic-overlap networks detected across {d.clusteredCandidates ?? 0} analyzed pages.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-gray-600 dark:text-white/60">
            Pages that appear to target the same topic — related pages that may compete. Review for
            consolidation or differentiation.
          </p>
          <ul className="mt-3 space-y-2">
            {clusters.map((c, i) => (
              <li key={i} className="rounded border border-gray-200 dark:border-navy-border p-2 text-sm">
                <span className="mr-2 text-amber-600 dark:text-amber-400">
                  {tierLabel(c.minEdgeSimilarity)} overlap ({c.size} pages)
                </span>
                <span className="text-gray-700 dark:text-white/70">
                  {c.urls.join('  ·  ')}
                  {c.membersTruncated ? `  · and ${c.size - c.urls.length} more` : ''}
                </span>
              </li>
            ))}
          </ul>
          {d.clustersCapped && (
            <p className="mt-1 text-xs text-gray-400 dark:text-white/40">
              Showing the largest {clusters.length} networks; more were detected.
            </p>
          )}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/TopicOverlapSection.test.tsx`
Expected: PASS (all four states).

- [ ] **Step 5: Wire into the results page (NOT the share page)**

In `app/(app)/ada-audit/site/[id]/page.tsx`, add to the `liveScanRun` select (after `contentSignalsJson: true,` at line 230):
```ts
      topicOverlapJson: true,
```

Add the import beside the sibling import (line 16):
```ts
import { TopicOverlapSection } from '@/components/site-audit/TopicOverlapSection'
```

Render it directly after `<ContentSignalsSection run={liveScanRun} />` (line 290):
```tsx
      <TopicOverlapSection run={liveScanRun} />
```

- [ ] **Step 6: Typecheck + build (proves the select + JSX wire up)**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run build`
Expected: PASS (route `/ada-audit/site/[id]` compiles).

- [ ] **Step 7: Commit**

```bash
git add components/site-audit/TopicOverlapSection.tsx components/site-audit/TopicOverlapSection.test.tsx "app/(app)/ada-audit/site/[id]/page.tsx"
git commit -m "feat(c12): TopicOverlapSection on the results-page SEO tab (share unchanged)"
```

---

### Task 6: Full gates + PR

**Files:** none (verification + PR only)

- [ ] **Step 1: Run all three gates verbatim**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all green. Note the total test count (should be prior + the new topic-overlap/embed-chunked/component/builder cases).

- [ ] **Step 2: Push the branch and open the PR**

```bash
git push -u origin feat/c12-tier1-topic-overlap
gh pr create --title "C12 Tier-1: MiniLM topic-overlap cannibalization" --body "$(cat <<'EOF'
Semantic topic-overlap cannibalization over the local MiniLM model — measurement-only
(CrawlRun.topicOverlapJson, NOT a Finding, NO score change). Sibling of the shipped
lexical content-similarity + content-signals.

- Pure clusterer: weighted signature+body cosine, single-linkage connected "topic-overlap
  networks"; both vectors required (homogeneous metric); pinned constants + bridge fixture.
- Cooperative chunked embedder: bounded chunks + inter-chunk event-loop yield + per-chunk
  deadline abandon-to-null (ONNX runs synchronously on the JS thread).
- Live-scan builder computes it over the indexable ∧ ¬login-like set before transient
  deletion; fail-to-null; reserve chained ahead of the similarity block.
- Read-time TopicOverlapSection on the results-page SEO tab (share view unchanged).
- Migration 20260712120000 (additive nullable column).

**Kevin pre-deploy note:** no new required env var. Prod verify includes confirming the
@xenova MiniLM artifact is already cached on disk (no scan-time download) + a cold/warm
RSS + inference-latency observation before any promotion.

Spec: docs/superpowers/specs/2026-07-11-c12-tier1-topic-overlap-design.md (Codex ×5)
Plan: docs/superpowers/plans/2026-07-11-c12-tier1-topic-overlap.md (Codex-reviewed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Confirm gates green in the PR context**

Verify CI (security-audit) is green and the three local gates were re-run in-session before merge (change-control rule 1).

---

## Self-review

**Spec coverage:**
- §4 data model → Task 1 (column, migration, CrawlRunInput). ✓
- §5 pure clusterer (require-both, weighted metric, single-linkage, minEdgeSimilarity, caps/flags, bridge fixture) → Task 2. ✓
- §6 builder integration (reserve chaining, cooperative chunked embed, candidate set, fail-to-null, inputCapped) → Tasks 3 + 4. ✓
- §7 read-time section (four states, honest network framing, results-page-only) → Task 5. ✓
- §8 testing (pure clusterer incl. bridge, chunked embedder, builder integration, component) → Tasks 2/3/4/5. ✓
- §10 acceptance (fail-to-null, eligible-set parity, chunked+deadline, gates, pinned constants, prod model-cache verify) → covered across tasks + Task 6 + PR note. ✓

**Placeholder scan:** the only prose-guided step is Task 4 Step 6's test, which wires
assertions to this test file's existing fixtures/helpers (audit/site/`HarvestedPageSeo`
builders + run-to-terminal helper) rather than duplicating ~100 lines of setup verbatim;
the two required behaviors and the assertion shape are spelled out. Acceptable — the exact
fixture calls are file-local and reused, not novel.

**Type consistency:** `clusterByTopicOverlap` / `TopicOverlapPageVectors` /
`TopicOverlapResult` / `TopicOverlapCluster` / `TOPIC_OVERLAP_DEFAULTS` names match across
Tasks 2, 4. `embedChunked` / `EmbedChunkedDeps` match across Tasks 3, 4. `topicOverlapJson`
matches across Tasks 1, 4, 5. The stored JSON keys (`clusteredCandidates`, `clustersCapped`,
`membersTruncated`, `size`, `minEdgeSimilarity`, `clusters`) match between the clusterer
output (Task 2) and the component's `OverlapData`/`OverlapCluster` (Task 5). ✓
