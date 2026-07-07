# Content Similarity (near-duplicate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lexical near-duplicate + exact-duplicate content detection to the live SEO scan, stored as bounded run-metadata on the live-scan `CrawlRun`, faithful enough to Screaming Frog's Near Duplicate output to validate parity.

**Architecture:** Measurement-first, matching reachability 3b / discovery-coverage. The site-audit page job captures bounded normalized main-content text in-page (SWC-helper-free) → transient `HarvestedPageSeo.contentText`. The `broken-link-verify` builder reads it, computes exact (sha256) + near (MinHash candidate → exact-Jaccard refine over boilerplate-DF-filtered word shingles) duplicate groups via a pure module, and writes `CrawlRun.contentSimilarityJson`, then deletes the transient text with the rest of the transient tables. A read-time UI section renders it. **No `priority.service` Finding, no `scoreLiveSeo` change.**

**Tech Stack:** Next.js 15 / TypeScript / Prisma + SQLite; Node `crypto` (server-side); Vitest; puppeteer-core (injected DOM parser). No new dependency.

**Spec:** `docs/superpowers/specs/2026-07-06-content-similarity-design.md` (Codex ACCEPT-WITH-FIXES ×10).

## Global Constraints

- **Injected code (`parse-seo-dom.ts`) must be SWC-helper-free and reference NO module scope** — no `typeof`, no imports, all helpers inline (2026-06-16 `_type_of` ReferenceError incident). Verify at es2017.
- **No interactive `prisma.$transaction(async tx => …)`** — array form only.
- **Never rely on runtime identifier names** (SWC minifies).
- **Determinism:** the compute module uses fixed hard-coded seeds and sorted outputs; NO `Math.random()` / `Date.now()` inside it (unavailable/non-deterministic). The verify job is `maxAttempts:2` — identical input must yield byte-identical JSON.
- **`contentText` is raw page prose:** never logged, never `select`ed outside `broken-link-verify.ts`, never surfaced in any API/UI. Transient only.
- **Gate-green before PR:** `npm run lint` (`tsc --noEmit`) + `npm test` (`DATABASE_URL="file:./local-dev.db" npm test`) + `npm run build`.
- **Migrations:** author SQL by hand (interactive `migrate dev` unavailable); additive nullable columns only.

---

### Task 1: Schema — transient text columns + durable similarity JSON

**Files:**
- Modify: `prisma/schema.prisma` (`HarvestedPageSeo` model ~:408-437; `CrawlRun` model near `contentSimilarityJson` sibling `reachabilityJson` ~:374)
- Create: `prisma/migrations/20260706130000_content_similarity/migration.sql`
- Modify: `lib/findings/types.ts` (`CrawlRunInput`, next to `reachabilityJson` ~:45)

**Interfaces:**
- Produces: `HarvestedPageSeo.contentText: String?`, `HarvestedPageSeo.contentTruncated: Boolean @default(false)`, `CrawlRun.contentSimilarityJson: String?`, `CrawlRunInput.contentSimilarityJson?: string | null`.

- [ ] **Step 1: Add the schema columns**

In `prisma/schema.prisma`, add to `model HarvestedPageSeo` (after `detailsJson`):
```prisma
  contentText      String?  // transient normalized main-content text (≤30k), deleted with the row; NEVER durable
  contentTruncated Boolean  @default(false)
```
Add to `model CrawlRun` (immediately after `reachabilityJson String?`):
```prisma
  contentSimilarityJson String? // C6 Phase 5: bounded near/exact-duplicate groups. Measurement, NOT a Finding.
```

- [ ] **Step 2: Author the migration SQL**

Create `prisma/migrations/20260706130000_content_similarity/migration.sql`:
```sql
-- C6 Phase 5: content similarity.
ALTER TABLE "HarvestedPageSeo" ADD COLUMN "contentText" TEXT;
ALTER TABLE "HarvestedPageSeo" ADD COLUMN "contentTruncated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CrawlRun" ADD COLUMN "contentSimilarityJson" TEXT;
```

- [ ] **Step 3: Apply the migration + regenerate the client**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: `1 migration applied` (or "already applied"); client regenerated with no error.

- [ ] **Step 4: Add the `CrawlRunInput` field**

In `lib/findings/types.ts`, in `CrawlRunInput`, immediately after the `reachabilityJson?: string | null` line:
```ts
  contentSimilarityJson?: string | null
```

- [ ] **Step 5: Verify types compile**

Run: `npm run lint`
Expected: PASS (no errors). `writeFindingsRun` needs NO change — it spreads `run` into `crawlRun.create`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260706130000_content_similarity lib/findings/types.ts
git commit -m "feat(content-sim): schema — transient contentText + CrawlRun.contentSimilarityJson"
```

---

### Task 2: In-page capture — extend `parseSeoFromDocument`

**Files:**
- Modify: `lib/ada-audit/seo/parse-seo-dom.ts` (`RawPageSeo` interface ~:9-24; the tree-walker ~:51-58; the return ~:99-103)
- Test: `lib/ada-audit/seo/parse-seo-dom.test.ts` (existing)

**Interfaces:**
- Produces: `RawPageSeo.contentText?: string`, `RawPageSeo.contentTruncated: boolean`. `contentText` = bounded (≤30_000 chars) normalized visible main-content text, EXCLUDING `nav/header/footer/aside` (and `role=navigation|banner|contentinfo`). `wordCount` unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `lib/ada-audit/seo/parse-seo-dom.test.ts` (follow the existing jsdom `document`-building pattern in that file):
```ts
describe('contentText capture (C6 Phase 5)', () => {
  it('excludes nav/header/footer/aside from contentText but not from wordCount', () => {
    document.body.innerHTML = `
      <header>Site Menu Home About Contact</header>
      <nav>Programs Admissions Tuition</nav>
      <main><p>Our nursing program prepares students for licensure in twelve months.</p></main>
      <footer>Copyright 2026 All Rights Reserved Privacy Policy</footer>`
    const r = parseSeoFromDocument(document, window)
    expect(r.contentText).toContain('nursing program prepares students')
    expect(r.contentText).not.toContain('Site Menu')
    expect(r.contentText).not.toContain('Copyright')
    expect(r.contentText).not.toContain('Programs Admissions')
    // wordCount still counts ALL visible text (header+nav+main+footer)
    expect(r.wordCount).toBeGreaterThan(15)
  })

  it('sets contentTruncated when content exceeds the 30k cap and still counts all words', () => {
    const long = 'lorem ipsum dolor '.repeat(3000) // ~54k chars
    document.body.innerHTML = `<main><p>${long}</p></main>`
    const r = parseSeoFromDocument(document, window)
    expect(r.contentTruncated).toBe(true)
    expect((r.contentText ?? '').length).toBeLessThanOrEqual(30_000)
    expect(r.wordCount).toBeGreaterThan(5000) // walk completed, count reflects full page
  })

  it('leaves contentText undefined when there is no main content', () => {
    document.body.innerHTML = `<nav>Home About</nav><footer>Copyright</footer>`
    const r = parseSeoFromDocument(document, window)
    expect(r.contentText).toBeUndefined()
    expect(r.contentTruncated).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/parse-seo-dom.test.ts`
Expected: FAIL (`contentText` undefined / property missing).

- [ ] **Step 3: Extend the interface**

In `RawPageSeo` (after `loginLike: boolean`):
```ts
  contentText?: string
  contentTruncated: boolean
```

- [ ] **Step 4: Extend the tree-walk (single pass) + return**

Inside `parseSeoFromDocument`, add a boilerplate-region test alongside `hiddenAncestor` (before the walker):
```ts
  const inBoilerplateRegion = (el: Element | null): boolean => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const tag = e.tagName
      if (tag === 'NAV' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'ASIDE') return true
      const role = e.getAttribute && e.getAttribute('role')
      if (role === 'navigation' || role === 'banner' || role === 'contentinfo') return true
    }
    return false
  }
  const CONTENT_CAP = 30000
  let content = ''
  let contentTruncated = false
```
Inside the existing `while ((n = walker.nextNode()))` loop, AFTER the existing `words += …` line (do NOT `break`/`continue` early — the walk must complete for `wordCount`):
```ts
    if (t && !contentTruncated && !inBoilerplateRegion(n.parentElement)) {
      const piece = content ? ' ' + t : t
      if (content.length + piece.length > CONTENT_CAP) {
        content += piece.slice(0, CONTENT_CAP - content.length)
        contentTruncated = true
      } else {
        content += piece
      }
    }
```
Update the return object (add to the existing returned fields):
```ts
    contentText: content || undefined, contentTruncated,
```

- [ ] **Step 5: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/parse-seo-dom.test.ts`
Expected: PASS (all, including the pre-existing tests — `wordCount` unchanged).

- [ ] **Step 6: Verify no SWC helper escapes at es2017**

Run: `npm run lint`
Expected: PASS. (The injected-code guard in the existing test file, if present, must still pass — `inBoilerplateRegion` uses no `typeof` and no module scope.)

- [ ] **Step 7: Commit**

```bash
git add lib/ada-audit/seo/parse-seo-dom.ts lib/ada-audit/seo/parse-seo-dom.test.ts
git commit -m "feat(content-sim): capture bounded main-content text in parseSeoFromDocument"
```

---

### Task 3: Transient persistence — `persistPageSeo`

**Files:**
- Modify: `lib/jobs/handlers/site-audit-page.ts` (`persistPageSeo` ~:93-125)
- Test: `lib/jobs/handlers/site-audit-page.test.ts` (existing; if absent, add a focused DB-backed test file at that path)

**Interfaces:**
- Consumes: `RawPageSeo.contentText`, `RawPageSeo.contentTruncated` (Task 2).
- Produces: `HarvestedPageSeo` rows carrying `contentText` + `contentTruncated`.

- [ ] **Step 1: Write the failing test**

Add a DB-backed test (mirror the existing `persistPageSeo` / harvest-write test setup in the file; create a `SiteAudit` parent, call `persistPageSeo`, read back the row):
```ts
it('persists contentText + contentTruncated on the harvested row', async () => {
  const audit = await prisma.siteAudit.create({ data: { domain: 'ex.test', wcagLevel: 'wcag21aa', status: 'complete' } })
  await persistPageSeo(audit.id, 'https://ex.test/p', {
    title: 't', metaDescription: undefined, robotsNoindex: false, canonicalUrl: undefined,
    h1: 'h', h1Count: 1, h2Count: 0, wordCount: 120, schemaTypes: [], hreflang: [],
    imageCount: 0, imagesMissingAlt: 0, imagesMissingDimensions: 0, loginLike: false,
    contentText: 'the nursing program prepares students', contentTruncated: false,
  } as RawPageSeo)
  const row = await prisma.harvestedPageSeo.findFirst({ where: { siteAuditId: audit.id } })
  expect(row?.contentText).toBe('the nursing program prepares students')
  expect(row?.contentTruncated).toBe(false)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-page.test.ts`
Expected: FAIL (columns written as undefined / row missing fields).

- [ ] **Step 3: Add the two fields to the `create`**

In `persistPageSeo`'s `prisma.harvestedPageSeo.create({ data: { … } })`, after the `detailsJson: …` line:
```ts
        contentText: seo.contentText ?? null,
        contentTruncated: seo.contentTruncated,
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-page.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/site-audit-page.ts lib/jobs/handlers/site-audit-page.test.ts
git commit -m "feat(content-sim): persist contentText on the transient HarvestedPageSeo row"
```

---

### Task 4: The pure compute module — `content-similarity.ts`

**Files:**
- Create: `lib/ada-audit/seo/content-similarity.ts`
- Test: `lib/ada-audit/seo/content-similarity.test.ts`

**Interfaces:**
- Consumes: `SimilarityPageInput { url: string; contentText: string | null; contentTruncated: boolean }`.
- Produces:
  ```ts
  export function computeContentSimilarity(
    pages: SimilarityPageInput[], opts?: ContentSimilarityOptions,
  ): ContentSimilarityResult | null  // null when < 2 eligible pages
  ```
  `ContentSimilarityResult` = the §9 JSON payload (without the outer `v`, which the builder adds). Fields: `algorithm, shingleSize, nearThreshold, minTokens, boilerplateDfRatio, boilerplateDfMin, pagesEligible, pagesSkipped:{noText,thin}, boilerplateShinglesDropped, exactDuplicateGroups:{urls,count}[], nearDuplicateGroups:{urls,similarity,exactSubgroups?}[], truncatedPages, capped`.

- [ ] **Step 1: Write the failing tests**

Create `lib/ada-audit/seo/content-similarity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeContentSimilarity, type SimilarityPageInput } from './content-similarity'

const p = (url: string, text: string, contentTruncated = false): SimilarityPageInput => ({ url, contentText: text, contentTruncated })
const body = (extra = '') =>
  'our nursing program prepares students for licensure in twelve months with clinical placement ' + extra

describe('computeContentSimilarity', () => {
  it('returns null with fewer than 2 eligible pages', () => {
    expect(computeContentSimilarity([p('/a', body())])).toBeNull()
  })

  it('flags exact duplicates (identical normalized text)', () => {
    const r = computeContentSimilarity([p('/a', body('alpha beta gamma')), p('/b', body('alpha beta gamma')), p('/c', 'entirely different content about culinary arts baking pastry techniques and kitchen safety standards')])!
    expect(r.exactDuplicateGroups).toHaveLength(1)
    expect(r.exactDuplicateGroups[0].urls.sort()).toEqual(['/a', '/b'])
    // an all-exact group is NOT re-listed as a near group
    expect(r.nearDuplicateGroups.find(g => g.urls.sort().join() === '/a,/b')).toBeUndefined()
  })

  it('flags near duplicates below exact but above threshold', () => {
    const base = ('word' + Array.from({ length: 200 }, (_, i) => ' w' + i).join(''))
    const r = computeContentSimilarity([p('/a', base + ' tailone'), p('/b', base + ' tailtwo'), p('/c', 'unrelated ' + Array.from({ length: 200 }, (_, i) => ' z' + i).join(''))])!
    const g = r.nearDuplicateGroups.find(x => x.urls.includes('/a') && x.urls.includes('/b'))
    expect(g).toBeDefined()
    expect(g!.similarity).toBeGreaterThanOrEqual(0.9)
  })

  it('does NOT group two pages that share only a large boilerplate block (df floor still lets 2-page real dups through)', () => {
    const boiler = Array.from({ length: 120 }, (_, i) => 'menu' + i).join(' ')
    const r = computeContentSimilarity([
      p('/a', boiler + ' the biology department offers genetics microbiology and ecology courses'),
      p('/b', boiler + ' the culinary school teaches pastry baking and kitchen management skills'),
    ])
    // Only 2 pages: df of the shared boilerplate = 2, ratio 1.0 > 0.5 AND df>=3 is FALSE → NOT dropped as boilerplate,
    // but the distinct bodies keep Jaccard below threshold → no near group.
    expect(r?.nearDuplicateGroups ?? []).toHaveLength(0)
  })

  it('drops shared boilerplate across many pages so distinct bodies are not falsely grouped', () => {
    const boiler = Array.from({ length: 120 }, (_, i) => 'nav' + i).join(' ')
    const pages = [
      p('/a', boiler + ' astronomy telescopes nebulae galaxies stellar physics coursework here'),
      p('/b', boiler + ' plumbing pipefitting welding hvac apprenticeship trades program here'),
      p('/c', boiler + ' accounting taxation auditing finance bookkeeping business program here'),
    ]
    const r = computeContentSimilarity(pages)!
    expect(r.boilerplateShinglesDropped).toBeGreaterThan(0)
    expect(r.nearDuplicateGroups).toHaveLength(0)
  })

  it('excludes truncated pages from exact groups but counts them', () => {
    const same = body('identical prefix content here for both')
    const r = computeContentSimilarity([p('/a', same, true), p('/b', same, true), p('/c', 'other unrelated content about welding and metal fabrication techniques for beginners')])!
    expect(r.truncatedPages).toBe(2)
    expect(r.exactDuplicateGroups).toHaveLength(0)
  })

  it('skips pages below the content-token floor', () => {
    const r = computeContentSimilarity([p('/a', 'too short'), p('/b', 'also short here'), p('/c', body('enough words to clear the floor easily with lots of additional content tokens present'))])
    // /a and /b below minTokens → < 2 eligible → null
    expect(r).toBeNull()
  })

  it('is deterministic (byte-identical JSON on repeat)', () => {
    const pages = [p('/a', body('alpha')), p('/b', body('alpha')), p('/c', body('beta gamma delta'))]
    expect(JSON.stringify(computeContentSimilarity(pages))).toBe(JSON.stringify(computeContentSimilarity(pages)))
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/content-similarity.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the module**

Create `lib/ada-audit/seo/content-similarity.ts`:
```ts
// lib/ada-audit/seo/content-similarity.ts
//
// C6 Phase 5: pure lexical near/exact-duplicate detection for the live SEO scan.
// MinHash candidate pairs refined with EXACT Jaccard over boilerplate-DF-filtered
// word shingles. Deterministic (fixed seeds, sorted output). No I/O, no Math.random.
import { createHash } from 'crypto'

export interface SimilarityPageInput { url: string; contentText: string | null; contentTruncated: boolean }
export interface ContentSimilarityOptions {
  shingleSize?: number; minTokens?: number; boilerplateDfRatio?: number; boilerplateDfMin?: number
  nearThreshold?: number; minhashPerms?: number; maxPages?: number; maxGroups?: number; maxUrlsPerGroup?: number
}
export interface ExactGroup { urls: string[]; count: number }
export interface NearGroup { urls: string[]; similarity: number; exactSubgroups?: string[][] }
export interface ContentSimilarityResult {
  algorithm: string; shingleSize: number; nearThreshold: number; minTokens: number
  boilerplateDfRatio: number; boilerplateDfMin: number; pagesEligible: number
  pagesSkipped: { noText: number; thin: number }; boilerplateShinglesDropped: number
  exactDuplicateGroups: ExactGroup[]; nearDuplicateGroups: NearGroup[]; truncatedPages: number; capped: boolean
}

const D = { shingleSize: 5, minTokens: 50, boilerplateDfRatio: 0.5, boilerplateDfMin: 3, nearThreshold: 0.9, minhashPerms: 128, maxPages: 1000, maxGroups: 100, maxUrlsPerGroup: 50 }
const REFINE_MARGIN = 0.15 // MinHash estimate within this of threshold → refine with exact Jaccard

function normalize(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
}
// deterministic 32-bit hash (FNV-1a + final avalanche via Math.imul)
function hash32(s: string): number {
  let h = 0x811c9dc5 >>> 0
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13
  return h >>> 0
}
// fixed permutation seeds (a odd, b any) derived deterministically — NEVER Math.random
function permSeeds(m: number): { a: number[]; b: number[] } {
  const a: number[] = [], b: number[] = []; let s = 0x9e3779b9 >>> 0
  for (let i = 0; i < m; i++) {
    s = (Math.imul(s, 0x01000193) ^ (i + 1)) >>> 0; a.push((s | 1) >>> 0)
    s = (Math.imul(s, 0x85ebca6b) ^ (i + 7)) >>> 0; b.push(s >>> 0)
  }
  return { a, b }
}
function shingleHashes(tokens: string[], k: number): number[] {
  const set = new Set<number>()
  for (let i = 0; i + k <= tokens.length; i++) set.add(hash32(tokens.slice(i, i + k).join(' ')))
  return Array.from(set)
}
function minhash(hashes: number[], a: number[], b: number[]): Uint32Array {
  const m = a.length, sig = new Uint32Array(m).fill(0xffffffff)
  for (const x of hashes) for (let i = 0; i < m; i++) {
    const v = (Math.imul(a[i], x) + b[i]) >>> 0
    if (v < sig[i]) sig[i] = v
  }
  return sig
}
function estJaccard(x: Uint32Array, y: Uint32Array): number {
  let eq = 0; for (let i = 0; i < x.length; i++) if (x[i] === y[i]) eq++
  return eq / x.length
}
function exactJaccard(x: number[], y: number[]): number {
  if (!x.length && !y.length) return 1
  const sx = new Set(x); let inter = 0
  for (const v of y) if (sx.has(v)) inter++
  return inter / (x.length + y.length - inter)
}

export function computeContentSimilarity(pages: SimilarityPageInput[], opts: ContentSimilarityOptions = {}): ContentSimilarityResult | null {
  const o = { ...D, ...opts }
  let noText = 0, thin = 0, truncatedPages = 0
  type Row = { url: string; tokens: string[]; norm: string; truncated: boolean }
  const eligible: Row[] = []
  for (const pg of [...pages].sort((x, y) => (x.url < y.url ? -1 : x.url > y.url ? 1 : 0))) {
    if (pg.contentTruncated) truncatedPages++
    if (!pg.contentText) { noText++; continue }
    const tokens = normalize(pg.contentText)
    if (tokens.length < o.minTokens) { thin++; continue }
    eligible.push({ url: pg.url, tokens, norm: tokens.join(' '), truncated: pg.contentTruncated })
  }
  let capped = false
  if (eligible.length > o.maxPages) { eligible.length = o.maxPages; capped = true }
  if (eligible.length < 2) return null

  // Exact duplicates (non-truncated only)
  const byHash = new Map<string, string[]>()
  for (const r of eligible) {
    if (r.truncated) continue
    const h = createHash('sha256').update(r.norm).digest('hex')
    ;(byHash.get(h) ?? byHash.set(h, []).get(h)!).push(r.url)
  }
  const exactGroups: ExactGroup[] = [...byHash.values()].filter(u => u.length >= 2)
    .map(u => ({ urls: u.slice().sort(), count: u.length }))

  // Shingle sets + DF-based boilerplate filter
  const raw = eligible.map(r => ({ url: r.url, sh: shingleHashes(r.tokens, o.shingleSize) }))
  const df = new Map<number, number>()
  for (const r of raw) for (const h of new Set(r.sh)) df.set(h, (df.get(h) ?? 0) + 1)
  const dropped = new Set<number>()
  for (const [h, c] of df) if (c >= o.boilerplateDfMin && c / eligible.length > o.boilerplateDfRatio) dropped.add(h)
  const sets = raw.map(r => ({ url: r.url, sh: r.sh.filter(h => !dropped.has(h)).sort((a, b) => a - b) }))

  // MinHash signatures
  const { a, b } = permSeeds(o.minhashPerms)
  const sigs = sets.map(s => ({ url: s.url, sh: s.sh, sig: minhash(s.sh, a, b) }))

  // Candidate pairs (MinHash) refined with exact Jaccard; build edges
  const n = sigs.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const union = (i: number, j: number) => { parent[find(i)] = find(j) }
  const pairSim = new Map<string, number>() // "i,j" (i<j) -> exact jaccard, for grouped pairs
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const est = estJaccard(sigs[i].sig, sigs[j].sig)
    if (est < o.nearThreshold - REFINE_MARGIN) continue
    const exact = exactJaccard(sigs[i].sh, sigs[j].sh)
    if (exact >= o.nearThreshold) { union(i, j); pairSim.set(i + ',' + j, exact) }
  }

  // Connected components → groups (size ≥ 2)
  const comps = new Map<number, number[]>()
  for (let i = 0; i < n; i++) { const r = find(i); (comps.get(r) ?? comps.set(r, []).get(r)!).push(i) }
  const exactKeySet = new Set(exactGroups.map(g => g.urls.join('\n')))
  const near: NearGroup[] = []
  for (const idxs of comps.values()) {
    if (idxs.length < 2) continue
    const urls = idxs.map(i => sigs[i].url).sort()
    // group similarity = MIN exact pairwise over ALL pairs in the component (honest weakest link)
    let minSim = 1
    for (let x = 0; x < idxs.length; x++) for (let y = x + 1; y < idxs.length; y++) {
      const sim = exactJaccard(sigs[idxs[x]].sh, sigs[idxs[y]].sh)
      if (sim < minSim) minSim = sim
    }
    // exact subgroups fully contained in this component
    const urlSet = new Set(urls)
    const subs = exactGroups.filter(g => g.urls.every(u => urlSet.has(u))).map(g => g.urls)
    // skip if the whole component IS exactly one exact group (represented by exactDuplicateGroups)
    if (subs.length === 1 && subs[0].length === urls.length && exactKeySet.has(urls.join('\n'))) continue
    const g: NearGroup = { urls, similarity: Math.round(minSim * 100) / 100 }
    if (subs.length) g.exactSubgroups = subs
    near.push(g)
  }

  // Deterministic ordering + output caps
  const cmpGroup = (x: { urls: string[] }, y: { urls: string[] }) =>
    y.urls.length - x.urls.length || (x.urls[0] < y.urls[0] ? -1 : x.urls[0] > y.urls[0] ? 1 : 0)
  exactGroups.sort(cmpGroup); near.sort(cmpGroup)
  const capGroups = <T extends { urls: string[] }>(arr: T[]): T[] => {
    if (arr.length > o.maxGroups) { arr = arr.slice(0, o.maxGroups); capped = true }
    return arr.map(g => (g.urls.length > o.maxUrlsPerGroup ? ((capped = true), { ...g, urls: g.urls.slice(0, o.maxUrlsPerGroup) }) : g))
  }

  return {
    algorithm: 'minhash+exact-jaccard', shingleSize: o.shingleSize, nearThreshold: o.nearThreshold,
    minTokens: o.minTokens, boilerplateDfRatio: o.boilerplateDfRatio, boilerplateDfMin: o.boilerplateDfMin,
    pagesEligible: eligible.length, pagesSkipped: { noText, thin }, boilerplateShinglesDropped: dropped.size,
    exactDuplicateGroups: capGroups(exactGroups), nearDuplicateGroups: capGroups(near), truncatedPages, capped,
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/content-similarity.test.ts`
Expected: PASS (all 8). If the near-duplicate synthetic fixtures land the wrong side of 0.9, adjust the fixture text (not the threshold) until behavior matches, keeping `nearThreshold` at 0.9.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/content-similarity.ts lib/ada-audit/seo/content-similarity.test.ts
git commit -m "feat(content-sim): pure MinHash+exact-Jaccard near/exact-duplicate module"
```

---

### Task 5: Builder wiring — `broken-link-verify.ts`

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (seoRows select ~:173-180; between the score/coverage block ~:437 and the bundle ~:454; the `run` object ~:455-464)
- Test: `lib/jobs/handlers/broken-link-verify.test.ts` (existing)

**Interfaces:**
- Consumes: `computeContentSimilarity` (Task 4); `HarvestedPageSeo.contentText`/`contentTruncated` (Tasks 1/3).
- Produces: `CrawlRun.contentSimilarityJson` populated (or null on empty / throw / time-budget skip).

- [ ] **Step 1: Write the failing integration tests**

Add to `lib/jobs/handlers/broken-link-verify.test.ts` (follow the file's existing pattern: seed a complete `SiteAudit` + `HarvestedPageSeo` rows, run the handler, read the live-scan `CrawlRun`):
```ts
it('writes contentSimilarityJson with a near/exact duplicate group', async () => {
  const audit = await seedCompleteAudit() // existing helper in this file
  const dup = 'our nursing program prepares students for licensure in twelve months with clinical placement rotations across regional hospitals and skills labs'
  await seedPageSeo(audit.id, 'https://ex.test/a', { contentText: dup, contentTruncated: false })
  await seedPageSeo(audit.id, 'https://ex.test/b', { contentText: dup, contentTruncated: false })
  await seedPageSeo(audit.id, 'https://ex.test/c', { contentText: 'completely different content about welding pipefitting and metal fabrication trades apprenticeship program details here', contentTruncated: false })
  await runBrokenLinkVerify({ siteAuditId: audit.id, domain: 'ex.test' } as any, deps)
  const run = await prisma.crawlRun.findFirst({ where: { siteAuditId: audit.id, tool: 'seo-parser' } })
  const data = JSON.parse(run!.contentSimilarityJson!)
  expect(data.v).toBe(1)
  expect(data.exactDuplicateGroups[0].urls.sort()).toEqual(['https://ex.test/a', 'https://ex.test/b'])
})

it('leaves contentSimilarityJson null when fewer than 2 eligible pages, and still writes the run + deletes transient rows', async () => {
  const audit = await seedCompleteAudit()
  await seedPageSeo(audit.id, 'https://ex.test/only', { contentText: 'short', contentTruncated: false })
  await runBrokenLinkVerify({ siteAuditId: audit.id, domain: 'ex.test' } as any, deps)
  const run = await prisma.crawlRun.findFirst({ where: { siteAuditId: audit.id, tool: 'seo-parser' } })
  expect(run).not.toBeNull()
  expect(run!.contentSimilarityJson).toBeNull()
  expect(await prisma.harvestedPageSeo.count({ where: { siteAuditId: audit.id } })).toBe(0)
})
```
(If the file lacks `seedPageSeo`, add a tiny local helper that `prisma.harvestedPageSeo.create`s with `statusCode:200, isHtml:true` + the passed overrides.)

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: FAIL (`contentSimilarityJson` undefined on the run).

- [ ] **Step 3: Add the import + reserve constant**

At the top imports of `broken-link-verify.ts`:
```ts
import { computeContentSimilarity, type SimilarityPageInput } from '@/lib/ada-audit/seo/content-similarity'
```
Near the other timing constants (~:77-88):
```ts
const CONTENT_SIM_RESERVE_MS = 30_000 // skip similarity if less than this remains before the job ceiling
```

- [ ] **Step 4: Select the new columns**

In the `prisma.harvestedPageSeo.findMany` `select` (~:175-179), add:
```ts
      contentText: true, contentTruncated: true,
```

- [ ] **Step 5: Compute + attach (with time-budget guard + try/catch)**

Immediately BEFORE the `const bundle: FindingsBundle = {` line (~:454), add:
```ts
  // C6 Phase 5: content similarity. Best-effort + time-budget-guarded — a similarity
  // failure or overrun must NEVER fail the live-scan write (mirrors the graph fail-to-null).
  let contentSimilarityJson: string | null = null
  const simRemaining = JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS
  if (simRemaining >= CONTENT_SIM_RESERVE_MS) {
    try {
      const simInputs: SimilarityPageInput[] = seoRows
        .filter((r) => indexableOf(r) && !r.loginLike)
        .map((r) => ({ url: r.url, contentText: r.contentText, contentTruncated: r.contentTruncated }))
      const sim = computeContentSimilarity(simInputs)
      if (sim) contentSimilarityJson = JSON.stringify({ v: 1, ...sim })
    } catch (e) {
      console.error('[live-seo] content similarity failed', e)
    }
  }
```
Then in the `run: { … }` object, immediately after the `reachabilityJson: …` line (~:463):
```ts
      contentSimilarityJson,
```

- [ ] **Step 6: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS (both new tests + all pre-existing).

- [ ] **Step 7: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(content-sim): compute + store contentSimilarityJson in the live-scan builder"
```

---

### Task 6: UI — `ContentSimilaritySection` + page wiring

**Files:**
- Create: `components/site-audit/ContentSimilaritySection.tsx`
- Create: `components/site-audit/ContentSimilaritySection.test.tsx`
- Modify: `app/ada-audit/site/[id]/page.tsx` (liveScanRun `select` ~:166-179; render block ~:231)

**Interfaces:**
- Consumes: a `run` prop `{ contentSimilarityJson: string | null } | null`.
- Produces: `<ContentSimilaritySection run={liveScanRun} />` rendered after `<ReachabilitySection />`.

- [ ] **Step 1: Write the failing component tests**

Create `components/site-audit/ContentSimilaritySection.test.tsx` (mirror `ReachabilitySection.test.tsx`):
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ContentSimilaritySection } from './ContentSimilaritySection'

const sim = (o: object) => ({ contentSimilarityJson: JSON.stringify({ v: 1, ...o }) })

describe('ContentSimilaritySection', () => {
  it('renders nothing when the run or json is null', () => {
    expect(render(<ContentSimilaritySection run={null} />).container).toBeEmptyDOMElement()
    expect(render(<ContentSimilaritySection run={{ contentSimilarityJson: null }} />).container).toBeEmptyDOMElement()
  })
  it('shows a clean state when there are no duplicate groups', () => {
    const { getByText } = render(<ContentSimilaritySection run={sim({ pagesEligible: 40, exactDuplicateGroups: [], nearDuplicateGroups: [] }) as any} />)
    expect(getByText(/no duplicate/i)).toBeTruthy()
  })
  it('lists exact and near duplicate groups', () => {
    const { getByText } = render(<ContentSimilaritySection run={sim({
      pagesEligible: 40, boilerplateShinglesDropped: 12,
      exactDuplicateGroups: [{ urls: ['/a', '/b'], count: 2 }],
      nearDuplicateGroups: [{ urls: ['/c', '/d'], similarity: 0.93 }],
    }) as any} />)
    expect(getByText('/a')).toBeTruthy()
    expect(getByText(/93%/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/ContentSimilaritySection.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the component**

Create `components/site-audit/ContentSimilaritySection.tsx` (match `ReachabilitySection.tsx` card/dark-mode styling):
```tsx
// components/site-audit/ContentSimilaritySection.tsx
// C6 Phase 5: read-time content similarity. Reads the SAME live-scan CrawlRun as the
// sibling measurement sections, from contentSimilarityJson. Measurement, NOT a finding.
interface ExactGroup { urls: string[]; count: number }
interface NearGroup { urls: string[]; similarity: number; exactSubgroups?: string[][] }
interface SimData {
  pagesEligible?: number; boilerplateShinglesDropped?: number; truncatedPages?: number; capped?: boolean
  exactDuplicateGroups?: ExactGroup[]; nearDuplicateGroups?: NearGroup[]
}

export function ContentSimilaritySection({ run }: { run: { contentSimilarityJson: string | null } | null }) {
  if (!run?.contentSimilarityJson) return null
  let d: SimData
  try { d = JSON.parse(run.contentSimilarityJson) } catch { return null }
  const exact = d.exactDuplicateGroups ?? []
  const near = d.nearDuplicateGroups ?? []
  const clean = exact.length === 0 && near.length === 0

  const GroupList = ({ groups, tone, label }: { groups: NearGroup[] | ExactGroup[]; tone: string; label: string }) => (
    <div className="mt-3">
      <h4 className={`text-sm font-medium ${tone}`}>{label} ({groups.length})</h4>
      <ul className="mt-1 space-y-2">
        {groups.map((g, i) => (
          <li key={i} className="rounded border border-gray-200 dark:border-navy-border p-2 text-sm">
            {'similarity' in g && <span className="mr-2 text-amber-600 dark:text-amber-400">{Math.round((g as NearGroup).similarity * 100)}% similar</span>}
            <span className="text-gray-700 dark:text-white/70">{g.urls.slice(0, 8).join('  ·  ')}{g.urls.length > 8 ? `  · and ${g.urls.length - 8} more` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <section className="mt-6 rounded-lg bg-white dark:bg-navy-card p-4 border border-gray-200 dark:border-navy-border">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">Content similarity</h3>
      {clean ? (
        <p className="mt-2 text-sm text-gray-600 dark:text-white/60">No duplicate or near-duplicate content detected across {d.pagesEligible ?? 0} analyzed pages.</p>
      ) : (
        <>
          {exact.length > 0 && <GroupList groups={exact} tone="text-red-600 dark:text-red-400" label="Exact duplicates" />}
          {near.length > 0 && <GroupList groups={near} tone="text-amber-600 dark:text-amber-400" label="Near duplicates" />}
        </>
      )}
      <p className="mt-3 text-xs text-gray-400 dark:text-white/40">
        {d.pagesEligible ?? 0} pages analyzed · {d.boilerplateShinglesDropped ?? 0} boilerplate fragments excluded
        {d.truncatedPages ? ` · ${d.truncatedPages} truncated` : ''}{d.capped ? ' · results capped' : ''}
      </p>
    </section>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/ContentSimilaritySection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into the results page**

In `app/ada-audit/site/[id]/page.tsx`: add to the `liveScanRun` `select` (after `reachabilityJson: true,` ~:173):
```ts
      contentSimilarityJson: true,
```
Add the import with the other section imports (~:12):
```ts
import { ContentSimilaritySection } from '@/components/site-audit/ContentSimilaritySection'
```
Render after `<ReachabilitySection run={liveScanRun} />` (~:231):
```tsx
      <ContentSimilaritySection run={liveScanRun} />
```

- [ ] **Step 6: Verify build + full suite**

Run: `npm run lint && DATABASE_URL="file:./local-dev.db" npm test && npm run build`
Expected: all PASS; the page still builds (`/ada-audit/site/[id]` route registered).

- [ ] **Step 7: Commit**

```bash
git add components/site-audit/ContentSimilaritySection.tsx components/site-audit/ContentSimilaritySection.test.tsx "app/ada-audit/site/[id]/page.tsx"
git commit -m "feat(content-sim): ContentSimilaritySection + results-page wiring"
```

---

### Task 7: Integration gates, PR, deploy, prod-verify, docs ritual

**Files:**
- Modify: `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`, `docs/superpowers/todos/HANDOFF-improvement-roadmap.md`, `CLAUDE.md` (findings-layer / C6 doc line), `docs/superpowers/todos/2026-07-05-sf-live-parity-log.md`
- Move on ship: spec + plan → `docs/superpowers/archive/`

- [ ] **Step 1: Full gate-green**

Run: `npm run lint && DATABASE_URL="file:./local-dev.db" npm test && NODE_OPTIONS='--max-old-space-size=3072' npm run build`
Expected: all three green.

- [ ] **Step 2: Pre-deploy timing sanity (spec §14 Codex verify)**

Add a throwaway bench (or a `.skip` test) that runs `computeContentSimilarity` over ~1000 synthetic pages and logs elapsed; confirm it is well under `CONTENT_SIM_RESERVE_MS` (30s). Delete the throwaway before PR. Record the number in the PR description.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin <branch>
gh pr create --title "feat: content similarity (SF-retirement Phase 5)" --body "…measurement-first near/exact duplicate detection; Codex-reviewed spec+plan; timing bench: <N>ms/1000 pages…"
```

- [ ] **Step 4: Merge (gate-green, rule 1) + deploy**

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull
ssh seo@144.126.213.242 "~/deploy.sh"   # migration auto-applies
```

- [ ] **Step 5: Prod-verify**

Trigger/observe one `seoIntent` live-scan run on a client domain (via the authed UI or Kevin's cookie), then read the live-scan `CrawlRun.contentSimilarityJson` on prod (throwaway `npx tsx` in the app dir, importing `@/lib/db`, cleaned up after) — confirm it is populated, bounded, and `v:1`. Confirm the `ContentSimilaritySection` renders on the results page.

- [ ] **Step 6: Docs ritual (same commit)**

Tick the tracker's content-similarity/Phase-5 item + add a dated status-log line; rewrite `HANDOFF-improvement-roadmap.md` (state, next item, gotchas, updated paste-in prompt); add the CLAUDE.md C6 doc line; append a parity-log entry noting the feature shipped and the parity-validation cycle is now pending. `git mv` the spec + plan to `docs/superpowers/archive/`. Commit tracker+handoff+CLAUDE.md **together**. End the final chat reply with the updated paste-in prompt.

---

## Self-Review

**Spec coverage:** §5 capture → Task 2. §6 transient write → Task 3. §7 schema/types → Task 1. §8 compute (all 9 algorithm steps incl. time-budget guard #1, truncation #2, token-floor #3, DF small-site floor #4, MinHash+refine #5, imul determinism #6, mixed-group #7, memory #8) → Task 4 + Task 5 wiring. §9 output shape → Task 4 return + Task 5 `{v:1,...}`. §10 UI → Task 6. §11 no-score-change → honored (no `scoreLiveSeo` touch in any task). §12 retention/privacy → `contentText` deleted in existing builder `:468-469` path (unchanged), selected only in the builder (Task 5), never logged; 7-day backstop pre-exists. §13 tests → Tasks 2/3/4/5/6. §14 parity + timing → Task 7 steps 2 & 6. §15 rollout → Task 7 steps 4-5.

**Placeholder scan:** none — every code step shows full code; commands have expected output.

**Type consistency:** `computeContentSimilarity(pages: SimilarityPageInput[]): ContentSimilarityResult | null` used identically in Tasks 4 & 5; `SimilarityPageInput { url, contentText, contentTruncated }` consistent across Tasks 3/4/5; `contentSimilarityJson` (durable) vs `contentText`/`contentTruncated` (transient) kept distinct throughout; UI `run={{ contentSimilarityJson: string|null }}` matches the page `select`.
