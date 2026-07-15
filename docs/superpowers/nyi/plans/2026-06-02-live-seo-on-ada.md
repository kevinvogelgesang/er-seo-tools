# Live SEO Audit (on the ADA scan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract rendered-DOM SEO signals from each page the ADA site audit already loads, persist them per-page and per-run, and surface a "Live SEO Audit" alongside the a11y results — without re-crawling and without touching the Screaming Frog CSV pipeline.

**Architecture:** "B-borrow-A" — a separate `PageSeoSnapshot` + `SiteSeoResult` data model and a live-specific aggregator/scorer, rendered through the existing seo-parser report components. Per-page extraction happens inside `runAxeAudit()` (returned as `seoSnapshotInput`, persisted by `queue-manager.ts` in the existing page-settle transactions); the aggregate pass runs in `finalizeSiteAudit()` gated on `pagesDone`, idempotent via upsert, never blocking ADA completion.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, puppeteer-core, Vitest. Node 22.

**Spec:** `docs/superpowers/nyi/specs/2026-06-02-live-seo-on-ada-design.md`

---

## File Structure

**Create:**
- `lib/ada-audit/seo/url-key.ts` — shared URL normalizer (`normalizeUrlKey`, `NORMALIZATION_VERSION = 'sf1'`)
- `lib/ada-audit/seo/types.ts` — `RawPageSeo`, `PageSeoSnapshotInput`, `LiveSeoAggregate`, `FactorAvailability`
- `lib/ada-audit/seo/extract-page-seo.ts` — `extractPageSeo(page, response, requestedUrl)`
- `lib/ada-audit/seo/score-live-seo.ts` — `scoreLiveSeo(aggregate, coverage)` (forked scorer)
- `lib/ada-audit/seo/aggregate-live-seo.ts` — `aggregateLiveSeo(siteAuditId)` (idempotent upsert)
- `lib/ada-audit/seo/prune-seo.ts` — `pruneSeoSnapshots(now)` retention job
- Test files alongside each (`*.test.ts`)
- `app/ada-audit/[id]/seo/` view wiring (Phase 5)

**Modify:**
- `prisma/schema.prisma` — add `PageSeoSnapshot`, `SiteSeoResult`, back-relations, set `SiteAudit.runnerType` correctly
- `lib/ada-audit/runner.ts` — capture `seoSnapshotInput`, add to `RunAxeResult` (both kinds)
- `lib/ada-audit/queue-manager.ts` — persist snapshot in each page-settle transaction (redirect/axe-complete/local/error)
- `lib/ada-audit/site-audit-finalizer.ts` — call `aggregateLiveSeo` when `pagesDone`
- `lib/ada-audit/sitemap-crawler.ts` — return `{ urls, capped, source }`; use shared normalizer

---

## Phase 1 — Foundations (schema + pure helpers, no integration)

### Task 1: URL normalizer

**Files:**
- Create: `lib/ada-audit/seo/url-key.ts`
- Test: `lib/ada-audit/seo/url-key.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeUrlKey, NORMALIZATION_VERSION } from './url-key'

describe('normalizeUrlKey', () => {
  it('lowercases host, strips www, fragment, and tracking params', () => {
    expect(normalizeUrlKey('https://WWW.Example.com/Path/?utm_source=x&gclid=y&id=7#frag'))
      .toBe('https://example.com/Path?id=7')
  })
  it('collapses a single trailing slash except on bare root', () => {
    expect(normalizeUrlKey('https://example.com/a/')).toBe('https://example.com/a')
    expect(normalizeUrlKey('https://example.com/')).toBe('https://example.com/')
  })
  it('strips wildcard utm_* and fbclid/msclkid/mc_eid', () => {
    expect(normalizeUrlKey('https://example.com/p?utm_term=a&fbclid=b&msclkid=c&keep=1'))
      .toBe('https://example.com/p?keep=1')
  })
  it('exposes a version string', () => {
    expect(NORMALIZATION_VERSION).toBe('sf1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ada-audit/seo/url-key.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/ada-audit/seo/url-key.ts
export const NORMALIZATION_VERSION = 'sf1'

const TRACKING_EXACT = new Set(['gclid', 'fbclid', 'msclkid', 'mc_eid'])
const isTracking = (k: string) => k.toLowerCase().startsWith('utm_') || TRACKING_EXACT.has(k.toLowerCase())

export function normalizeUrlKey(input: string): string {
  let u: URL
  try { u = new URL(input) } catch { return input.trim() }
  u.hash = ''
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
  u.protocol = u.protocol.toLowerCase()
  for (const k of [...u.searchParams.keys()]) if (isTracking(k)) u.searchParams.delete(k)
  // sort params for stable keys
  u.searchParams.sort()
  let path = u.pathname
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  u.pathname = path
  const qs = u.searchParams.toString()
  return `${u.protocol}//${u.host}${u.pathname}${qs ? `?${qs}` : ''}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ada-audit/seo/url-key.test.ts`
Expected: PASS (4 tests). Adjust the expected query-order in the first test if `.sort()` reorders — keep the test and impl consistent.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/url-key.ts lib/ada-audit/seo/url-key.test.ts
git commit -m "feat(seo): shared URL-key normalizer (sf1)"
```

---

### Task 2: SEO types

**Files:**
- Create: `lib/ada-audit/seo/types.ts`

- [ ] **Step 1: Write the types** (no test — pure type module)

```ts
// lib/ada-audit/seo/types.ts
export type SeoExtractionStatus = 'ok' | 'error' | 'skipped'
export type CanonicalKind = 'self' | 'other' | 'missing'

export interface RawPageSeo {
  status: SeoExtractionStatus
  error?: string
  statusCode?: number
  contentType?: string
  isHtml: boolean
  redirected: boolean
  finalUrl?: string
  robotsNoindex: boolean
  xRobotsNoindex: boolean
  loginLike: boolean
  title?: string
  metaDescription?: string
  h1?: string
  h1Count?: number
  h2Count?: number
  wordCount?: number
  canonicalUrl?: string
  schemaTypes: string[]
  hreflang: string[]
  imageCount?: number
  imagesMissingAlt?: number
  imagesMissingDimensions?: number
  internalOutlinkKeys: string[]
  externalOutlinkSample: string[]
  externalOutlinkCount?: number
  internalOutlinkKeysTruncated: boolean
  ttfbMs?: number | null
}

/** Shape the queue-manager persists. urlKey + indexable + canonicalKind derived here. */
export interface PageSeoSnapshotInput {
  url: string
  finalUrl?: string
  urlKey: string
  capturedAt: Date
  raw: RawPageSeo
}

export type FactorAvailability = 'present' | 'absent'

export interface LiveSeoAggregate {
  duplicateTitles: { value: string; urls: string[] }[]
  duplicateMeta: { value: string; urls: string[] }[]
  duplicateH1: { value: string; urls: string[] }[]
  missingTitle: string[]
  missingMeta: string[]
  missingH1: string[]
  thinContent: string[]
  canonical: { self: number; other: number; missing: number }
  schemaCoverage: { pagesWithSchema: number; types: Record<string, number> }
  graph: { inlinkCounts: Record<string, number>; truncatedPages: number }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ada-audit/seo/types.ts
git commit -m "feat(seo): live-seo shared types"
```

---

### Task 3: Prisma schema — new models + relations + runnerType fix

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add models and back-relations**

Add to `prisma/schema.prisma`:

```prisma
model PageSeoSnapshot {
  id          String   @id @default(cuid())
  siteAuditId String
  siteAudit   SiteAudit @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)
  adaAuditId  String   @unique
  adaAudit    AdaAudit @relation(fields: [adaAuditId], references: [id], onDelete: Cascade)
  clientId    Int?     // denormalized, no FK
  url         String
  finalUrl    String?
  urlKey      String
  capturedAt  DateTime @default(now())
  seoExtractionStatus String  // ok | error | skipped
  seoExtractionError  String?
  statusCode  Int?
  contentType String?
  redirected  Boolean  @default(false)
  isHtml      Boolean  @default(false)
  indexable   Boolean  @default(false)
  robotsNoindex   Boolean @default(false)
  xRobotsNoindex  Boolean @default(false)
  loginLike   Boolean  @default(false)
  title       String?
  titleLength Int?
  metaDescription String?
  metaDescriptionLength Int?
  h1          String?
  h1Count     Int?
  h2Count     Int?
  wordCount   Int?
  canonicalUrl String?
  canonicalKind String?  // self | other | missing
  schemaCount Int?
  imageCount  Int?
  imagesMissingAlt Int?
  imagesMissingDimensions Int?
  internalOutlinkCount Int?
  externalOutlinkCount Int?
  internalOutlinkKeysTruncated Boolean @default(false)
  ttfbMs      Int?
  detailsJson String?   // bounded JSON: schemaTypes, hreflang, internalOutlinkKeys, externalSample, truncation flags

  @@index([siteAuditId])
  @@index([clientId, capturedAt])
  @@index([siteAuditId, urlKey])
  @@index([siteAuditId, indexable])
  @@index([siteAuditId, loginLike])
}

model SiteSeoResult {
  id          String   @id @default(cuid())
  siteAuditId String   @unique
  siteAudit   SiteAudit @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)
  clientId    Int?
  domain      String
  capturedAt  DateTime @default(now())
  score       Int?
  confidence  String   // high | medium | low
  normalizationVersion String
  pagesTotal           Int @default(0)
  pagesWithSeo         Int @default(0)
  pagesSkipped         Int @default(0)
  pagesErrored         Int @default(0)
  pagesRedirected      Int @default(0)
  loginLikePages       Int @default(0)
  nonHtmlPages         Int @default(0)
  indexablePages       Int @default(0)
  scoreDenominatorPages Int @default(0)
  discoveryCapped      Boolean @default(false)
  aggregateJson        String
}
```

Add the back-relations to existing models:
- In `model SiteAudit { ... }`: `pageSeoSnapshots PageSeoSnapshot[]` and `siteSeoResult SiteSeoResult?`
- In `model AdaAudit { ... }`: `pageSeoSnapshot PageSeoSnapshot?`

Also change `SiteAudit.runnerType` default handling: keep the column, but the queue-manager will set it to `'browser'` at run start (Task 9). No schema change required for that beyond what exists.

- [ ] **Step 2: Create the migration**

Run: `npx prisma migrate dev --name add_live_seo_models`
Expected: migration created, client regenerated, no errors.

- [ ] **Step 3: Verify the client typechecks**

Run: `npx tsc --noEmit`
Expected: PASS (new `prisma.pageSeoSnapshot` / `prisma.siteSeoResult` accessors exist).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(seo): PageSeoSnapshot + SiteSeoResult models"
```

---

## Phase 2 — Extraction (pure, browser-driven)

### Task 4: `extractPageSeo`

**Files:**
- Create: `lib/ada-audit/seo/extract-page-seo.ts`
- Test: `lib/ada-audit/seo/extract-page-seo.test.ts`

The single `page.evaluate()` body is pure DOM and is unit-testable via jsdom by extracting it into an exported pure function `parseSeoFromDocument(doc, win)` that `extractPageSeo` calls inside `page.evaluate`. Test the pure function; the puppeteer wiring is covered by integration later.

- [ ] **Step 1: Write the failing test** (against the pure DOM parser)

```ts
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { parseSeoFromDocument } from './extract-page-seo'

const dom = (html: string) => {
  const d = new JSDOM(html, { url: 'https://example.com/p' })
  return parseSeoFromDocument(d.window.document, d.window)
}

describe('parseSeoFromDocument', () => {
  it('extracts title, meta, h1/h2, canonical, robots noindex', () => {
    const r = dom(`<html><head><title>Hi</title>
      <meta name="description" content="desc">
      <meta name="robots" content="noindex,follow">
      <link rel="canonical" href="https://example.com/p"></head>
      <body><h1>Head</h1><h2>a</h2><h2>b</h2><p>one two three</p></body></html>`)
    expect(r.title).toBe('Hi')
    expect(r.metaDescription).toBe('desc')
    expect(r.h1).toBe('Head')
    expect(r.h1Count).toBe(1)
    expect(r.h2Count).toBe(2)
    expect(r.canonicalUrl).toBe('https://example.com/p')
    expect(r.robotsNoindex).toBe(true)
    expect(r.wordCount).toBeGreaterThanOrEqual(3)
  })
  it('flags login-like via password input', () => {
    const r = dom(`<html><body><form><input type="password"></form></body></html>`)
    expect(r.loginLike).toBe(true)
  })
  it('does NOT flag login-like on body-text "password" mention alone', () => {
    const r = dom(`<html><head><title>Blog</title></head><body><p>reset your password here</p></body></html>`)
    expect(r.loginLike).toBe(false)
  })
  it('excludes script/style/hidden text from word count', () => {
    const r = dom(`<html><body><script>var x=1</script><div style="display:none">hidden words here</div><p>real words only</p></body></html>`)
    expect(r.wordCount).toBe(3)
  })
  it('separates internal vs external outlinks and dedupes internal (raw hrefs)', () => {
    const r = dom(`<html><body>
      <a href="/a">a</a><a href="/a">dup</a><a href="https://other.com/x">ext</a></body></html>`)
    expect(r.internalHrefs.length).toBe(1)   // normalization to keys happens Node-side in extractPageSeo
    expect(r.externalOutlinkCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ada-audit/seo/extract-page-seo.test.ts`
Expected: FAIL — module not found. (If `jsdom` is missing: `npm install -D jsdom` — it is already a transitive dep of the legacy runner; verify with `node -e "require('jsdom')"`.)

- [ ] **Step 3: Write the implementation**

```ts
// lib/ada-audit/seo/extract-page-seo.ts
import type { Page, HTTPResponse } from 'puppeteer-core'
import { normalizeUrlKey } from './url-key'
import type { RawPageSeo } from './types'

const INTERNAL_OUTLINK_CAP = 300

/**
 * Pure DOM parser. MUST be fully self-contained — it is injected into the page
 * via `.toString()` (see extractPageSeo), so it may NOT reference any module
 * scope (no imports, no module consts/regex). All helpers/constants are declared
 * INSIDE the body. It returns RAW internal hrefs; URL-key normalization is done
 * on the Node side by extractPageSeo using the real shared normalizer, so graph
 * keys always match page urlKeys. (The jsdom unit test will NOT catch an external
 * reference — keeping this self-contained is a hard invariant.)
 * MVP scope: JSON-LD only (microdata/RDFa deferred — see spec §2).
 */
export function parseSeoFromDocument(doc: Document, win: Window) {
  const CAP = 300
  const LOGIN_RE = /\b(sign[\s-]?in|log[\s-]?in|member login)\b/i
  const host = win.location.hostname.replace(/^www\./, '')
  const title = doc.querySelector('title')?.textContent?.trim() || undefined
  const metaDescription = doc.querySelector('meta[name="description" i]')?.getAttribute('content')?.trim() || undefined
  const robots = (doc.querySelector('meta[name="robots" i]')?.getAttribute('content') || '').toLowerCase()
  const robotsNoindex = /\bnoindex\b/.test(robots)
  const canonicalUrl = doc.querySelector('link[rel="canonical" i]')?.getAttribute('href') || undefined
  const h1s = Array.from(doc.querySelectorAll('h1'))
  const h1 = h1s[0]?.textContent?.trim() || undefined
  const h1Count = h1s.length
  const h2Count = doc.querySelectorAll('h2').length

  // visible word count — walk ANCESTORS, so text inside a display:none container
  // (not just a hidden direct parent) is excluded.
  const hiddenAncestor = (el: Element | null): boolean => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const tag = e.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return true
      if (e.getAttribute && e.getAttribute('aria-hidden') === 'true') return true
      const s = win.getComputedStyle(e as any)
      if (s && (s.display === 'none' || s.visibility === 'hidden')) return true
    }
    return false
  }
  const walker = doc.createTreeWalker(doc.body || doc.documentElement, win.NodeFilter.SHOW_TEXT)
  let words = 0
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (hiddenAncestor(n.parentElement)) continue
    const t = (n.textContent || '').trim()
    if (t) words += t.split(/\s+/).filter(Boolean).length
  }

  // links — return RAW absolute internal hrefs (normalized to keys on the Node side)
  const internalSet = new Set<string>()
  let externalCount = 0
  const externalSample: string[] = []
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') || ''
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) continue
    let abs: string, h: string
    try { abs = new win.URL(href, win.location.href).href; h = new win.URL(abs).hostname.replace(/^www\./, '') } catch { continue }
    if (h === host) internalSet.add(abs)
    else { externalCount++; if (externalSample.length < 25) externalSample.push(abs) }
  }
  const internalHrefs = Array.from(internalSet)
  const internalOutlinkHrefsTruncated = internalHrefs.length > CAP

  // schema types — JSON-LD only (MVP)
  const schemaTypes: string[] = []
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const collect = (o: any): void => {
        if (!o) return
        if (Array.isArray(o)) { o.forEach(collect); return }
        if (o['@type']) ([] as string[]).concat(o['@type']).forEach(t => schemaTypes.push(String(t)))
        if (o['@graph']) collect(o['@graph'])
      }
      collect(JSON.parse(s.textContent || ''))
    } catch { /* ignore malformed */ }
  }

  const hreflang = Array.from(doc.querySelectorAll('link[rel="alternate"][hreflang]'))
    .map(l => l.getAttribute('hreflang') || '').filter(Boolean)
  const imgs = Array.from(doc.querySelectorAll('img'))
  const imagesMissingAlt = imgs.filter(i => !i.getAttribute('alt')).length
  const imagesMissingDimensions = imgs.filter(i => !i.getAttribute('width') || !i.getAttribute('height')).length

  const bodyText = doc.body?.textContent || ''
  const loginLike = !!doc.querySelector('input[type="password" i]')
    || LOGIN_RE.test(title || '') || LOGIN_RE.test(h1 || '')
    || (LOGIN_RE.test(bodyText) && words < 80)   // body match is supporting-only (short page)

  return {
    robotsNoindex, loginLike, title, metaDescription, h1, h1Count, h2Count, wordCount: words,
    canonicalUrl, schemaTypes, hreflang,
    imageCount: imgs.length, imagesMissingAlt, imagesMissingDimensions,
    internalHrefs: internalHrefs.slice(0, CAP), externalOutlinkSample: externalSample,
    externalOutlinkCount: externalCount, internalOutlinkHrefsTruncated,
  }
}

export async function extractPageSeo(page: Page, response: HTTPResponse | null, _requestedUrl: string): Promise<RawPageSeo> {
  const headers = response?.headers() ?? {}
  const contentType = headers['content-type']
  const isHtml = (contentType ?? '').includes('html')
  const xRobotsNoindex = /\bnoindex\b/i.test(headers['x-robots-tag'] ?? '')
  const statusCode = response?.status()
  const base: RawPageSeo = {
    status: 'ok', statusCode, contentType, isHtml, redirected: false,
    robotsNoindex: false, xRobotsNoindex, loginLike: false,
    schemaTypes: [], hreflang: [], internalOutlinkKeys: [], externalOutlinkSample: [],
    internalOutlinkKeysTruncated: false, ttfbMs: null,
  }
  if (!isHtml) return { ...base, status: 'skipped' }
  try {
    // Self-contained fn injected as source, invoked with the page's real document/window.
    const dom = await page.evaluate(`(${parseSeoFromDocument.toString()})(document, window)`) as any
    // Node-side: normalize internal hrefs to keys with the shared normalizer.
    const internalOutlinkKeys = Array.from(new Set((dom.internalHrefs as string[]).map(normalizeUrlKey)))
    return {
      ...base, ...dom, internalOutlinkKeys,
      internalOutlinkKeysTruncated: dom.internalOutlinkHrefsTruncated, status: 'ok',
    }
  } catch (err) {
    return { ...base, status: 'error', error: err instanceof Error ? err.message : 'seo extract failed' }
  }
}
```

Update the Task 4 test's last assertion accordingly: `parseSeoFromDocument` now returns `internalHrefs` (raw), so assert `r.internalHrefs.length === 1` and `r.externalOutlinkCount === 1`. Add one Node-side note: the href→key normalization is a trivial `.map(normalizeUrlKey)` covered transitively by the url-key test.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ada-audit/seo/extract-page-seo.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/extract-page-seo.ts lib/ada-audit/seo/extract-page-seo.test.ts
git commit -m "feat(seo): rendered-DOM page SEO extraction"
```

---

## Phase 3 — Scoring + aggregation (pure, DB)

### Task 5: Forked live scorer

**Files:**
- Create: `lib/ada-audit/seo/score-live-seo.ts`
- Test: `lib/ada-audit/seo/score-live-seo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { scoreLiveSeo } from './score-live-seo'

const cov = (o: Partial<Parameters<typeof scoreLiveSeo>[1]>) => ({
  pagesTotal: 100, scoreDenominatorPages: 80, confidence: 'high' as const, ...o,
})

describe('scoreLiveSeo', () => {
  it('returns null below minimum coverage', () => {
    expect(scoreLiveSeo({ missingTitle: 0, missingMeta: 0, missingH1: 0, thin: 0, schemaPages: 0 },
      cov({ scoreDenominatorPages: 30 }))).toBeNull()
  })
  it('returns null when confidence is low', () => {
    expect(scoreLiveSeo({ missingTitle: 0, missingMeta: 0, missingH1: 0, thin: 0, schemaPages: 0 },
      cov({ confidence: 'low' }))).toBeNull()
  })
  it('never awards crawl-depth/link-score (absent factors excluded from denominator)', () => {
    // perfect on-page → 100, because absent graph factors are not counted
    const s = scoreLiveSeo({ missingTitle: 0, missingMeta: 0, missingH1: 0, thin: 0, schemaPages: 80 }, cov({}))
    expect(s).toBe(100)
  })
  it('penalizes missing titles', () => {
    const s = scoreLiveSeo({ missingTitle: 40, missingMeta: 0, missingH1: 0, thin: 0, schemaPages: 80 }, cov({}))
    expect(s).toBeLessThan(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ada-audit/seo/score-live-seo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ada-audit/seo/score-live-seo.ts
export interface LiveScoreInputs {
  missingTitle: number; missingMeta: number; missingH1: number; thin: number; schemaPages: number
}
export interface LiveScoreCoverage {
  pagesTotal: number; scoreDenominatorPages: number; confidence: 'high' | 'medium' | 'low'
}
const MIN_COVERAGE_RATIO = 0.5

/** Forked from computeHealthScore: every factor is EXPLICITLY present here; absent
 * factors (crawl depth, link score) are simply not part of the sum/denominator. */
export function scoreLiveSeo(inp: LiveScoreInputs, cov: LiveScoreCoverage): number | null {
  if (cov.confidence === 'low') return null
  if (cov.pagesTotal <= 0) return null
  if (cov.scoreDenominatorPages / cov.pagesTotal < MIN_COVERAGE_RATIO) return null
  const base = cov.scoreDenominatorPages || 1
  const factors: [number, number][] = []          // [earned, possible]
  const ratioFactor = (bad: number, weight: number) =>
    factors.push([weight * (1 - Math.min(1, bad / base)), weight])
  ratioFactor(inp.missingTitle, 10)
  ratioFactor(inp.missingMeta, 8)
  ratioFactor(inp.missingH1, 7)
  ratioFactor(inp.thin, 10)
  // schema coverage: present factor, full marks at >=30% pages with schema
  const schemaRatio = Math.min(1, (inp.schemaPages / base) / 0.3)
  factors.push([10 * schemaRatio, 10])
  const earned = factors.reduce((a, [e]) => a + e, 0)
  const possible = factors.reduce((a, [, p]) => a + p, 0)
  return Math.round(Math.max(0, Math.min(100, (earned / possible) * 100)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ada-audit/seo/score-live-seo.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/score-live-seo.ts lib/ada-audit/seo/score-live-seo.test.ts
git commit -m "feat(seo): forked live SEO scorer (null below coverage)"
```

---

### Task 6: Aggregator (idempotent upsert)

**Files:**
- Create: `lib/ada-audit/seo/aggregate-live-seo.ts`
- Test: `lib/ada-audit/seo/aggregate-live-seo.test.ts`

This task talks to Prisma. There is **no shared temp-DB reset helper** — DB-touching ADA tests use the project test DB and clean up their own rows. In `beforeEach`, delete in FK order: `prisma.pageSeoSnapshot.deleteMany()` and `prisma.siteSeoResult.deleteMany()` first, then `prisma.adaAudit.deleteMany({ where: { url: { contains: 'example.com' } } })` and `prisma.siteAudit.deleteMany({ where: { domain: 'example.com' } })`. Each seeded `AdaAudit` is created with its `siteAuditId` set so the test mirrors reality (the `@unique adaAuditId` relation works either way, but seed consistently).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { aggregateLiveSeo } from './aggregate-live-seo'
// NOTE: replicate the test-DB reset helper used by the sibling *.test.ts files.

async function seed() {
  const sa = await prisma.siteAudit.create({ data: { domain: 'example.com', status: 'running', pagesTotal: 2 } })
  const mk = async (url: string, title: string, status = 'ok') => {
    const a = await prisma.adaAudit.create({ data: { url, status: 'complete', wcagLevel: 'wcag21aa', siteAuditId: sa.id } })
    await prisma.pageSeoSnapshot.create({ data: {
      siteAuditId: sa.id, adaAuditId: a.id, url, urlKey: url, seoExtractionStatus: status,
      isHtml: true, indexable: true, title, h1: 'H', canonicalKind: 'self',
      detailsJson: JSON.stringify({ schemaTypes: [], internalOutlinkKeys: [] }),
    } })
  }
  await mk('https://example.com/a', 'Same')
  await mk('https://example.com/b', 'Same')   // duplicate title
  return sa.id
}

describe('aggregateLiveSeo', () => {
  it('produces one SiteSeoResult and detects duplicate titles', async () => {
    const id = await seed()
    await aggregateLiveSeo(id)
    const res = await prisma.siteSeoResult.findUnique({ where: { siteAuditId: id } })
    expect(res).not.toBeNull()
    const agg = JSON.parse(res!.aggregateJson)
    expect(agg.duplicateTitles[0].urls.length).toBe(2)
  })
  it('is idempotent under concurrent calls (one row, no throw)', async () => {
    const id = await seed()
    await Promise.all([aggregateLiveSeo(id), aggregateLiveSeo(id), aggregateLiveSeo(id)])
    const rows = await prisma.siteSeoResult.findMany({ where: { siteAuditId: id } })
    expect(rows.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ada-audit/seo/aggregate-live-seo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ada-audit/seo/aggregate-live-seo.ts
import { prisma } from '@/lib/db'
import { NORMALIZATION_VERSION } from './url-key'
import { scoreLiveSeo } from './score-live-seo'
import type { LiveSeoAggregate } from './types'

export async function aggregateLiveSeo(siteAuditId: string): Promise<void> {
  const site = await prisma.siteAudit.findUnique({ where: { id: siteAuditId } })
  if (!site) return
  const snaps = await prisma.pageSeoSnapshot.findMany({ where: { siteAuditId } })

  const indexableHtml = snaps.filter(s => s.isHtml && s.indexable && !s.loginLike)
  const dupBy = (key: 'title' | 'metaDescription' | 'h1') => {
    const m = new Map<string, string[]>()
    for (const s of indexableHtml) { const v = (s as any)[key]; if (v) (m.get(v) ?? m.set(v, []).get(v)!).push(s.url) }
    return [...m].filter(([, u]) => u.length > 1).map(([value, urls]) => ({ value, urls }))
  }
  const missing = (key: 'title' | 'h1') => indexableHtml.filter(s => !(s as any)[key]).map(s => s.url)
  const missingMeta = indexableHtml.filter(s => !s.metaDescription).map(s => s.url)
  // Only count KNOWN word counts as thin — null/0 (extraction failure, empty render) is NOT "thin".
  const thin = indexableHtml.filter(s => typeof s.wordCount === 'number' && s.wordCount > 0 && s.wordCount < 300).map(s => s.url)

  const canonical = { self: 0, other: 0, missing: 0 }
  for (const s of indexableHtml) {
    const k = s.canonicalKind === 'self' || s.canonicalKind === 'other' ? s.canonicalKind : 'missing'  // whitelist — never NaN
    canonical[k]++
  }

  // Build the inlink graph over ALL snapshots (links can originate anywhere),
  // but schema coverage over indexableHtml only (login/non-indexable pages shouldn't inflate it).
  const inlink: Record<string, number> = {}
  let truncatedPages = 0
  for (const s of snaps) {
    if (s.internalOutlinkKeysTruncated) truncatedPages++
    let details: any = {}
    try { details = JSON.parse(s.detailsJson ?? '{}') } catch { /* ignore */ }
    for (const k of (details.internalOutlinkKeys ?? [])) inlink[k] = (inlink[k] ?? 0) + 1
  }
  const schemaTypes: Record<string, number> = {}
  let pagesWithSchema = 0
  for (const s of indexableHtml) {
    let details: any = {}
    try { details = JSON.parse(s.detailsJson ?? '{}') } catch { /* ignore */ }
    const types: string[] = details.schemaTypes ?? []
    if (types.length) pagesWithSchema++
    for (const t of types) schemaTypes[t] = (schemaTypes[t] ?? 0) + 1
  }

  const aggregate: LiveSeoAggregate = {
    duplicateTitles: dupBy('title'), duplicateMeta: dupBy('metaDescription'), duplicateH1: dupBy('h1'),
    missingTitle: missing('title'), missingMeta, missingH1: missing('h1'), thinContent: thin,
    canonical, schemaCoverage: { pagesWithSchema, types: schemaTypes },
    graph: { inlinkCounts: inlink, truncatedPages },
  }

  const pagesTotal = site.pagesTotal || snaps.length
  const loginLikePages = snaps.filter(s => s.loginLike).length
  const nonHtmlPages = snaps.filter(s => !s.isHtml).length
  const pagesErrored = snaps.filter(s => s.seoExtractionStatus === 'error').length
  const pagesWithSeo = snaps.filter(s => s.seoExtractionStatus === 'ok' && s.isHtml).length
  const indexablePages = snaps.filter(s => s.indexable).length
  const scoreDenominatorPages = indexableHtml.length

  let confidence: 'high' | 'medium' | 'low' = 'high'
  const capped = site.discoveryCapped   // column added + threaded in Task 8
  if (capped || (pagesTotal && loginLikePages / pagesTotal > 0.2) || (pagesTotal && pagesErrored / pagesTotal > 0.1)) confidence = 'low'
  else if (nonHtmlPages > 0 || pagesErrored > 0) confidence = 'medium'

  const score = scoreLiveSeo(
    { missingTitle: aggregate.missingTitle.length, missingMeta: aggregate.missingMeta.length,
      missingH1: aggregate.missingH1.length, thin: aggregate.thinContent.length, schemaPages: pagesWithSchema },
    { pagesTotal, scoreDenominatorPages, confidence },
  )

  const data = {
    clientId: site.clientId ?? null, domain: site.domain, score, confidence,
    normalizationVersion: NORMALIZATION_VERSION,
    pagesTotal, pagesWithSeo, pagesSkipped: snaps.filter(s => s.seoExtractionStatus === 'skipped').length,
    pagesErrored, pagesRedirected: snaps.filter(s => s.redirected).length, loginLikePages, nonHtmlPages,
    indexablePages, scoreDenominatorPages, discoveryCapped: capped, aggregateJson: JSON.stringify(aggregate),
  }
  await prisma.siteSeoResult.upsert({ where: { siteAuditId }, create: { siteAuditId, ...data }, update: data })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ada-audit/seo/aggregate-live-seo.test.ts`
Expected: PASS (2 tests). The `upsert` on the unique `siteAuditId` is what makes concurrent calls converge to one row.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/aggregate-live-seo.ts lib/ada-audit/seo/aggregate-live-seo.test.ts
git commit -m "feat(seo): idempotent live-seo aggregator"
```

---

## Phase 4 — Integration into the ADA scan

### Task 7: Wire extraction into `runner.ts`

**Files:**
- Modify: `lib/ada-audit/runner.ts`

- [ ] **Step 1: Extend `RunAxeResult` with `seoSnapshotInput`**

In `lib/ada-audit/runner.ts`, change the `RunAxeResult` union so BOTH variants carry the SEO data captured before the early exits:

```ts
export type RunAxeResult =
  | { kind: 'audited'; axe: StoredAxeResults; lighthouseSummary: LighthouseSummary | null
      lighthouseError: string | null; harvestedPdfUrls: string[]; seoRaw: import('./seo/types').RawPageSeo }
  | { kind: 'redirected'; finalUrl: string; seoRaw: import('./seo/types').RawPageSeo }
```

- [ ] **Step 2: Capture `seoRaw` right after `response` is available, before redirect/non-HTML/error exits**

Inside `attemptNavigation()`, once `response` is confirmed (after `if (!response) throw`), call `extractPageSeo` and stash it on a holder accessible to both the redirected return and the audited return. For redirect/non-HTML/error paths, the response-derived fields are still captured (extract returns `status:'skipped'` for non-HTML, partial for redirect). Import at top: `import { extractPageSeo } from './seo/extract-page-seo'`.

Minimal shape (place the capture next to `redirectedHolder`):

```ts
const seoHolder: { value: import('./seo/types').RawPageSeo | null } = { value: null }
// ...after `if (!response) throw new Error('No response received from page')`:
seoHolder.value = await extractPageSeo(page, response, parsed.toString())
// On the redirected return:
//   return { kind: 'redirected', finalUrl: detected.finalUrl, seoRaw: { ...seoHolder.value!, redirected: true, finalUrl: detected.finalUrl } }
// On the final audited return, include: seoRaw: seoHolder.value!
```

**HTTP-error behavior (decided):** for non-OK statuses (401/403/4xx/5xx) the runner throws *before* DOM extraction — do NOT attempt `extractPageSeo` there. The error propagates as today; `queue-manager`'s error branch (Task 9) synthesizes a minimal error snapshot. Only redirects and non-HTML (skipped) and OK-HTML (full) paths carry a real `seoRaw`. Do NOT let extraction itself throw out of `runAxeAudit` (it already returns `status:'error'` internally).

**Local-provider path:** `getLighthouseProvider()` (`runner.ts:139`) branches at L141 — the `provider === 'local'` path owns navigation and does not populate the same `response` holder used by the pagespeed/off branch. Add an explicit `seoRaw` capture on the local path too: after local LH finishes and before axe, call `extractPageSeo(page, null, parsed.toString())` (response unavailable there → header-derived fields are null, DOM fields still captured). This keeps `seoRaw` present on every audited result regardless of provider. (Production uses `pagespeed`, but local must not produce `undefined seoRaw` and break the type.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. Existing callers of `runAxeAudit` that destructure `audited` now also receive `seoRaw` (ignored where unused).

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/runner.ts
git commit -m "feat(seo): capture page SEO in runAxeAudit (pre-exit)"
```

---

### Task 8: Discovery returns cap metadata

**Files:**
- Modify: `lib/ada-audit/sitemap-crawler.ts`
- Modify: callers of `discoverPages` (`queue-manager.ts`)

- [ ] **Step 1: Change `discoverPages` return type**

Make `discoverPages(domain)` return `{ urls: string[]; capped: boolean; source: string }`. Set `capped = preSliceCount > HARD_CAP` (record the pre-slice length before `.slice(0, HARD_CAP)` at ≈L294). Use `normalizeUrlKey` from `./seo/url-key` in the dedup step (replace the inline utm-only strip at ≈L136–141) so the audit set aligns with graph keys.

- [ ] **Step 2: Add `discoveryCapped` to the schema + enqueue path**

Add `discoveryCapped Boolean @default(false)` to `SiteAudit` (tiny migration `add_site_audit_discovery_capped`). Thread `capped` through so it survives the **pre-discovered** flow (the one that matters): add `discoveryCapped?: boolean` to `EnqueueAuditOptions`, set it when enqueuing, and write it onto the `SiteAudit` row. For the inline-discovery path in `queue-manager.ts:60`, set it after discovery returns.

- [ ] **Step 3: Update ALL callers + tests + mocks** (verified list)

- `lib/ada-audit/queue-manager.ts:60` — `const { urls, capped } = preDiscoveredUrls ? { urls: preDiscoveredUrls, capped: site.discoveryCapped } : await discoverPages(domain)`; write `runnerType:'browser'` and (inline path) `discoveryCapped: capped` on the `SiteAudit` update at ≈L61.
- `app/api/site-audit/discover/route.ts:31` — destructure `{ urls, capped }`; return `capped` in the JSON so the client can pass it to enqueue (keep `urls` in the response for backward compat).
- `lib/ada-audit/queue-manager.test.ts:15` — change the mock `discoverPages: vi.fn(async () => ({ urls: [], capped: false, source: 'none' }))`.
- `lib/ada-audit/sitemap-crawler.test.ts` (L422/L452/L491/L536 etc.) — update `.resolves.toEqual([...])` assertions to `.resolves.toMatchObject({ urls: [...] })`.

`discoveredUrls` JSON on `SiteAudit` stays `string[]` (backward-compatible) — only the cap flag is added as a separate column.

- [ ] **Step 4: Wire `discoveryCapped` into the aggregator**

In `aggregate-live-seo.ts` (Task 6), replace `const capped = false` with `const capped = site.discoveryCapped` (the `site` row is already loaded). This is the line Task 6 left as a stub.

- [ ] **Step 5: Typecheck + crawler/queue tests**

Run: `npx tsc --noEmit && npx vitest run lib/ada-audit/sitemap-crawler.test.ts lib/ada-audit/queue-manager.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/sitemap-crawler.ts lib/ada-audit/queue-manager.ts app/api/site-audit lib/ada-audit/seo/aggregate-live-seo.ts prisma/schema.prisma prisma/migrations lib/ada-audit/*.test.ts
git commit -m "feat(seo): discovery cap metadata threaded through enqueue + aggregator"
```

---

### Task 9: Persist snapshots in `queue-manager.ts` page-settle transactions

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts`

Add a `PageSeoSnapshot` create into EACH of the existing `prisma.$transaction([...])` arrays in the page loop (redirected, axe-complete/detachPsi, local/complete) AND the error catch path — so the snapshot lands in the same transaction as the page-counter increment. Also set `SiteAudit.runnerType = 'browser'` at run start (Task spec §10).

- [ ] **Step 1: Add a snapshot-input builder helper** (top of queue-manager or a small local fn)

```ts
import { normalizeUrlKey } from './seo/url-key'
import type { RawPageSeo } from './seo/types'

function seoSnapshotData(siteAuditId: string, adaAuditId: string, clientId: number | null, url: string, raw: RawPageSeo) {
  const indexable = !!raw.statusCode && raw.statusCode >= 200 && raw.statusCode < 300
    && !raw.redirected && raw.isHtml && !raw.robotsNoindex && !raw.xRobotsNoindex   // 3xx/redirected are NOT indexable
  const canonicalKey = raw.canonicalUrl ? normalizeUrlKey(raw.canonicalUrl) : undefined
  const urlKey = normalizeUrlKey(url)
  const canonicalKind = !raw.canonicalUrl ? 'missing' : canonicalKey === urlKey ? 'self' : 'other'
  return {
    siteAuditId, adaAuditId, clientId, url, finalUrl: raw.finalUrl, urlKey, capturedAt: new Date(),
    seoExtractionStatus: raw.status, seoExtractionError: raw.error,
    statusCode: raw.statusCode, contentType: raw.contentType, redirected: raw.redirected, isHtml: raw.isHtml,
    indexable, robotsNoindex: raw.robotsNoindex, xRobotsNoindex: raw.xRobotsNoindex, loginLike: raw.loginLike,
    title: raw.title, titleLength: raw.title?.length, metaDescription: raw.metaDescription,
    metaDescriptionLength: raw.metaDescription?.length, h1: raw.h1, h1Count: raw.h1Count, h2Count: raw.h2Count,
    wordCount: raw.wordCount, canonicalUrl: raw.canonicalUrl, canonicalKind,
    schemaCount: raw.schemaTypes.length, imageCount: raw.imageCount, imagesMissingAlt: raw.imagesMissingAlt,
    imagesMissingDimensions: raw.imagesMissingDimensions,
    internalOutlinkCount: raw.internalOutlinkKeys.length, externalOutlinkCount: raw.externalOutlinkCount,
    internalOutlinkKeysTruncated: raw.internalOutlinkKeysTruncated, ttfbMs: raw.ttfbMs ?? null,
    detailsJson: JSON.stringify({ schemaTypes: raw.schemaTypes, hreflang: raw.hreflang,
      internalOutlinkKeys: raw.internalOutlinkKeys, externalSample: raw.externalOutlinkSample }),
  }
}
```

- [ ] **Step 2: Add `prisma.pageSeoSnapshot.create({ data: seoSnapshotData(...) })` into each transaction array**

- Redirected block: use `runResult.seoRaw`.
- detachPsi (axe-complete) block and local (complete) block: use `runResult.seoRaw`.
- Error catch: synthesize a minimal raw (`{ status:'error', error: msg, isHtml:false, redirected:false, robotsNoindex:false, xRobotsNoindex:false, loginLike:false, schemaTypes:[], hreflang:[], internalOutlinkKeys:[], externalOutlinkSample:[], internalOutlinkKeysTruncated:false, ttfbMs:null }`) and wrap the two error updates in a `$transaction` together with the snapshot create.

Set `runnerType:'browser'` on the parent `SiteAudit` near the `pagesTotal` set (≈L61): `data: { pagesTotal: urls.length, runnerType: 'browser' }`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/queue-manager.ts
git commit -m "feat(seo): persist PageSeoSnapshot in page-settle transactions"
```

---

### Task 10: Trigger aggregation in `finalizeSiteAudit`

**Files:**
- Modify: `lib/ada-audit/site-audit-finalizer.ts`

- [ ] **Step 1: Call `aggregateLiveSeo` once `pagesDone`, non-blocking**

After the `if (!pagesDone) return` guard (`site-audit-finalizer.ts:33-36`), add (before the PDF/LH transient-status logic so it runs as soon as pages are done, exactly once per call but idempotent):

```ts
import { aggregateLiveSeo } from './seo/aggregate-live-seo'
// ...inside finalizeSiteAudit, right after the !pagesDone early return:
try { await aggregateLiveSeo(id) } catch (err) {
  console.error(`[finalizeSiteAudit] live-seo aggregation failed for ${id}:`, err)
  // non-blocking: ADA terminal status proceeds regardless
}
```

The upsert (Task 6) makes repeated finalizer calls safe.

- [ ] **Step 2: Typecheck + run the aggregator test again**

Run: `npx tsc --noEmit && npx vitest run lib/ada-audit/seo/aggregate-live-seo.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/site-audit-finalizer.ts
git commit -m "feat(seo): trigger live-seo aggregation on pagesDone"
```

---

## Phase 5 — Surface + retention

### Task 11: API + results view under `/ada-audit/[id]/seo`

**Files:**
- Create: `app/api/ada-audit/[id]/seo/route.ts` (GET → `SiteSeoResult` + paginated snapshots)
- Create: `app/ada-audit/[id]/seo/page.tsx` (server component) + a client view reusing seo-parser report components
- Modify: the existing site-audit results page to add a "Live SEO" tab/link

- [ ] **Step 1: API route** — return `SiteSeoResult` for the `SiteAudit`, plus snapshots paginated at 50; 404 if no result yet. JSON.parse wrapped in try/catch (project convention).
- [ ] **Step 2: Confidence banner** — render `confidence`, `discoveryCapped`, `loginLikePages`, `pagesSkipped`, `pagesErrored`, and the "Live rendered SEO snapshot — not Screaming Frog parity" copy (spec §1/§8).
- [ ] **Step 3: Reuse report components via an adapter, not a fake `AggregatedResult`** — define a small `LiveSeoReportViewModel` (only the overlapping fields: duplicate clusters, missing-element lists, canonical breakdown, schema coverage) and a `toLiveSeoViewModel(siteSeoResult)` adapter. Pass that to the shared presentational components. Do NOT fabricate an `AggregatedResult` or a `Session` — the seo-parser data contract stays untouched.
- [ ] **Step 4: Manual verify** — `npm run dev`, open a completed site audit's `/seo` tab; confirm banner + sections render with real numbers.
- [ ] **Step 5: Commit**

```bash
git add app/api/ada-audit app/ada-audit
git commit -m "feat(seo): Live SEO Audit results view"
```

### Task 12: Retention prune job

**Files:**
- Create: `lib/ada-audit/seo/prune-seo.ts`
- Test: `lib/ada-audit/seo/prune-seo.test.ts`
- Modify: `instrumentation.ts` (hook into the existing daily cleanup)

- [ ] **Step 1: Failing test** — seed snapshots older/newer than 90 days (use the same FK-order cleanup as Task 6); assert only old ones (and only snapshots, not `SiteSeoResult`) are deleted.
- [ ] **Step 2: Implement** `pruneSeoSnapshots(now = new Date())` deleting `PageSeoSnapshot` with `capturedAt < now - 90d`; leave `SiteSeoResult`. Document that a periodic `VACUUM` (outside the crawl window) is required to reclaim file space — add a one-line note in `CLAUDE.md` deploy section.
- [ ] **Step 3: Run test** — `npx vitest run lib/ada-audit/seo/prune-seo.test.ts` → PASS.
- [ ] **Step 4: Schedule** — `instrumentation.ts` already runs a **daily** `cleanupInterval` (`instrumentation.ts:77`, `24 * 60 * 60 * 1000`). Call `pruneSeoSnapshots()` from inside that existing `runCleanup()` (daily), NOT from the 10-min `resetStaleAudits` sweep. Import dynamically as the other cleanup imports do.
- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo CLAUDE.md
git commit -m "feat(seo): 90-day snapshot retention prune"
```

---

## Phase 6 — Verification & ship

### Task 13: Full verification

- [ ] **Step 1: Typecheck + full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS, no regressions in existing ADA tests.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Timing check (acceptance criterion 2)** — run a real site audit locally (small client domain) before and after, compare per-page axe-phase duration from `AdaAudit.startedAt/completedAt`; confirm < 10% increase (well under 2×). Record numbers in the PR description.

- [ ] **Step 4: Coverage spot-check** — pick an audit with a known login page; confirm it's counted in `loginLikePages` and excluded from `scoreDenominatorPages`; confirm score is `null` if coverage < 50%.

- [ ] **Step 5: Deploy** (per CLAUDE.md — push first, deploy outside any crawl window)

```bash
git push
ssh $PROD_SSH "~/deploy.sh"
```

---

## Self-Review notes (done)

- **Spec coverage:** every spec section maps to a task — extraction (T4), data model (T3), scorer fork + null-below-coverage (T5), idempotent aggregate in finalizer (T6/T10), snapshot-per-attempted-page ordered with counter (T7/T9), discovery cap metadata + shared normalizer (T1/T8), coverage/confidence banner (T11), retention + VACUUM note (T12), runnerType fix (T9), verification incl. timing + race (T6/T13).
- **No placeholders:** core logic units have complete code; T11 is UI glue (steps describe exact data + reuse, no new algorithm).
- **Type consistency:** `RawPageSeo` (T2) is produced by `extractPageSeo` (T4), carried on `RunAxeResult.seoRaw` (T7), mapped by `seoSnapshotData` (T9), read by `aggregateLiveSeo` (T6); `scoreLiveSeo` signature matches its caller in T6.
- **Open (low-risk, decide in-task):** thin-content threshold (currently 300), internal-outlink cap (currently 300) — confirm against soma.edu (838 pages) in T13.
