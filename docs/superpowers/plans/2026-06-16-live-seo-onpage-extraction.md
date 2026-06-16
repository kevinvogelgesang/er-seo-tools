# Live SEO On-page Extraction (C6 Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract rendered-DOM on-page SEO signals (title/meta/H1/canonical/schema/word-count/images) from the pages the ADA site audit already loads, and surface duplicate/missing/thin on-page issues as normalized `Finding`s in the same live-scan `CrawlRun` the C6 Phase 1 broken-link verifier already builds.

**Architecture:** On-page extraction folds into the existing rendered-DOM harvest (`link-harvest.ts`); one transient `HarvestedPageSeo` row per successfully-settled page (sibling to `HarvestedLink`) is persisted post-settle. The existing post-terminal `broken-link-verify` job becomes the single live-scan run builder: it reads both transient tables, builds on-page + broken-link findings against ONE shared `runId`/page map, writes ONE `CrawlRun` (`tool:'seo-parser'`, `source:'live-scan'`, `score:null`), and deletes both transient tables. No new run/page models, no forked scorer, no runner-path surgery.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, puppeteer-core, Vitest. Node 22.

**Spec:** `docs/superpowers/specs/2026-06-16-live-seo-onpage-extraction-design.md`

---

## Conventions (read once)

- **Local dev:** prefix prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is interactive-only here — write migration SQL by hand and apply with `prisma migrate deploy`.
- **Transactions:** array-form `$transaction([...])` ONLY. Never interactive `$transaction(async tx => ...)` (2026-06-10 write-lock incident).
- **DB-test hygiene:** unique domain/id prefix per file; clean `CrawlRun` by domain BEFORE origin rows; any `crawlRun` lookup by `siteAuditId` as a unique key uses the compound `siteAuditId_tool` input. Node is the default vitest env.
- **Findings invariant:** a SiteAudit holds up to two `CrawlRun`s (ada-audit + seo-parser live-scan). The writer's `deleteMany` uses plain `{ siteAuditId, tool }`; `findUnique`/`update` use `{ siteAuditId_tool: { siteAuditId, tool } }`.

---

## File Structure

**Create:**
- `lib/ada-audit/seo/parse-seo-dom.ts` — pure self-contained `parseSeoFromDocument(doc, win)` + `RawPageSeo` type
- `lib/ada-audit/seo/parse-seo-dom.test.ts`
- `lib/findings/onpage-seo-mapper.ts` — pure `mapOnPageSeoFindings(rows, deps)` → `FindingInput[]` (pushes pages via injected `ensurePage`)
- `lib/findings/onpage-seo-mapper.test.ts`

**Modify:**
- `prisma/schema.prisma` — add `HarvestedPageSeo` model + `SiteAudit.harvestedPageSeo` back-relation
- `prisma/migrations/<ts>_add_harvested_page_seo/migration.sql` — hand-written
- `lib/types/index.ts` — widen `Issue.affectedUrlSource` union (×2) with `'live-scan-onpage'`
- `lib/ada-audit/link-harvest.ts` — fold on-page extraction into `harvestLinks`'s `page.evaluate`; return `pageSeo`
- `lib/ada-audit/link-harvest.test.ts` — update `harvestLinks` shape assertions (if present)
- `lib/ada-audit/runner.ts` — carry `harvestedPageSeo` on the `audited` `RunAxeResult`
- `lib/jobs/handlers/site-audit-page.ts` — persist `HarvestedPageSeo` post-settle (alongside `persistHarvest`)
- `lib/findings/broken-link-mapper.ts` — refactor `mapBrokenLinks` → `mapBrokenLinkFindings(broken, deps)` returning `FindingInput[]` against injected `runId`/`ensurePage`
- `lib/findings/broken-link-mapper.test.ts` — update to the new signature
- `lib/jobs/handlers/broken-link-verify.ts` — become the single live-scan builder (own `runId` + `ensurePage`, merge both mappers, delete both tables)
- `lib/jobs/handlers/broken-link-verify.test.ts` — add on-page + merge cases
- `lib/ada-audit/broken-link-recovery.ts` — broaden stranded condition to `HarvestedLink` OR `HarvestedPageSeo`
- `lib/ada-audit/broken-link-recovery.test.ts` — add HarvestedPageSeo-only recovery case
- `lib/findings/retention.ts` — add `pruneHarvestedPageSeo`
- `lib/findings/retention.test.ts` (if present) — add prune case
- `lib/cleanup.ts` — register `pruneHarvestedPageSeo()`
- `components/site-audit/BrokenLinksSection.tsx` — filter to `broken_*` types only
- `components/site-audit/OnPageSeoSection.tsx` — NEW sibling component
- `app/ada-audit/site/[id]/page.tsx` — render `<OnPageSeoSection run={liveScanRun} />`

---

## Phase 1 — Foundations (schema + pure helpers)

### Task 1: `HarvestedPageSeo` model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_harvested_page_seo/migration.sql`

- [ ] **Step 1: Add the model** after the `HarvestedLink` model (`schema.prisma:383`):

```prisma
// C6 Phase 2: transient per-page on-page SEO signals captured during the ADA
// site audit. Deleted by the broken-link-verify builder after it writes the
// live-scan findings; a 7-day sweep backstops audits whose build never ran.
// Scaffolding, not a durable store — the live-scan CrawlRun is the record.
model HarvestedPageSeo {
  id            String    @id @default(cuid())
  siteAuditId   String
  siteAudit     SiteAudit @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)
  url           String    // normalized audited page URL (NEVER page.url())
  statusCode    Int?
  isHtml        Boolean   @default(true)
  title         String?
  titleLength   Int?
  metaDescription String?
  metaDescriptionLength Int?
  h1            String?
  h1Count       Int?
  h2Count       Int?
  wordCount     Int?
  canonicalUrl  String?
  robotsNoindex   Boolean @default(false)
  xRobotsNoindex  Boolean @default(false)
  loginLike     Boolean   @default(false)
  schemaCount   Int?
  imageCount    Int?
  imagesMissingAlt        Int?
  imagesMissingDimensions Int?
  harvestTruncated Boolean @default(false)
  detailsJson   String?   // bounded JSON: { schemaTypes: string[], hreflang: string[] }
  createdAt     DateTime  @default(now())

  @@index([siteAuditId])
  @@index([siteAuditId, url])
}
```

- [ ] **Step 2: Add the back-relation** to `model SiteAudit` (after `harvestedLinks   HarvestedLink[]`, `schema.prisma:153`):

```prisma
  harvestedPageSeo HarvestedPageSeo[]
```

- [ ] **Step 3: Hand-write the migration** (local `migrate dev` is interactive). Create `prisma/migrations/<timestamp>_add_harvested_page_seo/migration.sql` (use a timestamp later than the last existing migration dir):

```sql
-- CreateTable
CREATE TABLE "HarvestedPageSeo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteAuditId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER,
    "isHtml" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "titleLength" INTEGER,
    "metaDescription" TEXT,
    "metaDescriptionLength" INTEGER,
    "h1" TEXT,
    "h1Count" INTEGER,
    "h2Count" INTEGER,
    "wordCount" INTEGER,
    "canonicalUrl" TEXT,
    "robotsNoindex" BOOLEAN NOT NULL DEFAULT false,
    "xRobotsNoindex" BOOLEAN NOT NULL DEFAULT false,
    "loginLike" BOOLEAN NOT NULL DEFAULT false,
    "schemaCount" INTEGER,
    "imageCount" INTEGER,
    "imagesMissingAlt" INTEGER,
    "imagesMissingDimensions" INTEGER,
    "harvestTruncated" BOOLEAN NOT NULL DEFAULT false,
    "detailsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HarvestedPageSeo_siteAuditId_fkey" FOREIGN KEY ("siteAuditId") REFERENCES "SiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "HarvestedPageSeo_siteAuditId_idx" ON "HarvestedPageSeo"("siteAuditId");
CREATE INDEX "HarvestedPageSeo_siteAuditId_url_idx" ON "HarvestedPageSeo"("siteAuditId", "url");
```

- [ ] **Step 4: Apply + regenerate the client**

Run: `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`
Expected: migration applied; client regenerated with `prisma.harvestedPageSeo`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (`prisma.harvestedPageSeo` accessor exists).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(c6): HarvestedPageSeo transient model + migration"
```

---

### Task 2: `parseSeoFromDocument` pure DOM parser

**Files:**
- Create: `lib/ada-audit/seo/parse-seo-dom.ts`
- Test: `lib/ada-audit/seo/parse-seo-dom.test.ts`

The function is injected into the page via `.toString()` (Task 4), so it MUST be fully self-contained — no module-scope references (no imports, no module consts). All helpers/constants live inside the body. Returns RAW fields; the builder computes `indexable`/derived issues later.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { parseSeoFromDocument } from './parse-seo-dom'

const dom = (html: string) => {
  const d = new JSDOM(html, { url: 'https://example.com/p' })
  return parseSeoFromDocument(d.window.document, d.window as unknown as Window)
}

describe('parseSeoFromDocument', () => {
  it('extracts title, meta, h1/h2 counts, canonical, robots noindex, schema, hreflang', () => {
    const r = dom(`<html><head><title> Hi </title>
      <meta name="description" content="desc">
      <meta name="robots" content="NOINDEX,follow">
      <link rel="canonical" href="https://example.com/p">
      <link rel="alternate" hreflang="en" href="https://example.com/en">
      <script type="application/ld+json">{"@type":"Organization"}</script></head>
      <body><h1>Head</h1><h2>a</h2><h2>b</h2><p>one two three</p></body></html>`)
    expect(r.title).toBe('Hi')
    expect(r.metaDescription).toBe('desc')
    expect(r.h1).toBe('Head')
    expect(r.h1Count).toBe(1)
    expect(r.h2Count).toBe(2)
    expect(r.canonicalUrl).toBe('https://example.com/p')
    expect(r.robotsNoindex).toBe(true)
    expect(r.schemaTypes).toContain('Organization')
    expect(r.hreflang).toContain('en')
    expect(r.wordCount).toBeGreaterThanOrEqual(3)
  })
  it('flags login-like via password input', () => {
    expect(dom(`<html><body><form><input type="password"></form></body></html>`).loginLike).toBe(true)
  })
  it('does NOT flag login-like on a body-text "password" mention on a long page', () => {
    const long = 'word '.repeat(200)
    expect(dom(`<html><head><title>Blog</title></head><body><p>reset your password here ${long}</p></body></html>`).loginLike).toBe(false)
  })
  it('excludes script/style/hidden text from the word count', () => {
    const r = dom(`<html><body><script>var x=1</script><div style="display:none">hidden words here</div><p>real words only</p></body></html>`)
    expect(r.wordCount).toBe(3)
  })
  it('counts images missing alt and dimensions', () => {
    const r = dom(`<html><body><img src="/a.png"><img src="/b.png" alt="x" width="1" height="1"></body></html>`)
    expect(r.imageCount).toBe(2)
    expect(r.imagesMissingAlt).toBe(1)
    expect(r.imagesMissingDimensions).toBe(1)
  })
  it('recurses @graph for schema types', () => {
    const r = dom(`<html><head><script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["Article","BlogPosting"]}]}</script></head><body></body></html>`)
    expect(r.schemaTypes).toEqual(expect.arrayContaining(['WebPage', 'Article', 'BlogPosting']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/parse-seo-dom.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ada-audit/seo/parse-seo-dom.ts
//
// C6 Phase 2: pure rendered-DOM on-page SEO extraction. This function is
// injected into the page via `(${parseSeoFromDocument.toString()})(document, window)`
// (see link-harvest.ts), so it MUST be fully self-contained — NO module-scope
// references (no imports, no module consts/regex). All helpers + constants are
// declared INSIDE the body. Returns RAW fields; the verifier/builder computes
// indexability and derived issues from these. MVP scope: JSON-LD schema only.
export interface RawPageSeo {
  title?: string
  metaDescription?: string
  robotsNoindex: boolean
  canonicalUrl?: string
  h1?: string
  h1Count: number
  h2Count: number
  wordCount: number
  schemaTypes: string[]
  hreflang: string[]
  imageCount: number
  imagesMissingAlt: number
  imagesMissingDimensions: number
  loginLike: boolean
}

export function parseSeoFromDocument(doc: Document, win: Window): RawPageSeo {
  const LOGIN_RE = /\b(sign[\s-]?in|log[\s-]?in|member login)\b/i
  const title = doc.querySelector('title')?.textContent?.trim() || undefined
  const metaDescription =
    doc.querySelector('meta[name="description" i]')?.getAttribute('content')?.trim() || undefined
  const robots = (doc.querySelector('meta[name="robots" i]')?.getAttribute('content') || '').toLowerCase()
  const robotsNoindex = /\bnoindex\b/.test(robots)
  const canonicalUrl = doc.querySelector('link[rel="canonical" i]')?.getAttribute('href') || undefined
  const h1s = Array.from(doc.querySelectorAll('h1'))
  const h1 = h1s[0]?.textContent?.trim() || undefined
  const h1Count = h1s.length
  const h2Count = doc.querySelectorAll('h2').length

  // visible word count — walk ANCESTORS so text inside a hidden container
  // (not just a hidden direct parent) is excluded.
  const hiddenAncestor = (el: Element | null): boolean => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const tag = e.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return true
      if (e.getAttribute && e.getAttribute('aria-hidden') === 'true') return true
      const s = win.getComputedStyle(e as Element)
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

  // schema @type set — JSON-LD only, with @graph recursion.
  const schemaTypes: string[] = []
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const collect = (o: unknown): void => {
        if (!o || typeof o !== 'object') return
        if (Array.isArray(o)) { o.forEach(collect); return }
        const rec = o as Record<string, unknown>
        if (rec['@type']) ([] as unknown[]).concat(rec['@type']).forEach((t) => schemaTypes.push(String(t)))
        if (rec['@graph']) collect(rec['@graph'])
      }
      collect(JSON.parse(s.textContent || ''))
    } catch { /* ignore malformed */ }
  }

  const hreflang = Array.from(doc.querySelectorAll('link[rel="alternate"][hreflang]'))
    .map((l) => l.getAttribute('hreflang') || '')
    .filter(Boolean)
  // Bound the "bounded JSON" arrays: dedupe + cap at 50 each (Codex fix #7).
  const CAP = 50
  const boundedSchema = Array.from(new Set(schemaTypes)).slice(0, CAP)
  const boundedHreflang = Array.from(new Set(hreflang)).slice(0, CAP)
  const imgs = Array.from(doc.querySelectorAll('img'))
  const imagesMissingAlt = imgs.filter((i) => !i.getAttribute('alt')).length
  const imagesMissingDimensions = imgs.filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).length

  const bodyText = doc.body?.textContent || ''
  const loginLike =
    !!doc.querySelector('input[type="password" i]') ||
    LOGIN_RE.test(title || '') ||
    LOGIN_RE.test(h1 || '') ||
    (LOGIN_RE.test(bodyText) && words < 80) // body match supporting-only (short page)

  return {
    title, metaDescription, robotsNoindex, canonicalUrl, h1, h1Count, h2Count,
    wordCount: words, schemaTypes: boundedSchema, hreflang: boundedHreflang,
    imageCount: imgs.length, imagesMissingAlt, imagesMissingDimensions, loginLike,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/parse-seo-dom.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/parse-seo-dom.ts lib/ada-audit/seo/parse-seo-dom.test.ts
git commit -m "feat(c6): pure rendered-DOM on-page SEO parser"
```

---

### Task 3: Widen the `affectedUrlSource` union

**Files:**
- Modify: `lib/types/index.ts` (two occurrences: lines ~61 and ~242)

- [ ] **Step 1: Add `'live-scan-onpage'`** to both `affectedUrlSource` union declarations. Each currently reads:

```ts
  affectedUrlSource?: 'derived-page-index' | 'parser-complete' | 'parser-sample' | 'live-scan-verify';
```

Change both to:

```ts
  affectedUrlSource?: 'derived-page-index' | 'parser-complete' | 'parser-sample' | 'live-scan-verify' | 'live-scan-onpage';
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/types/index.ts
git commit -m "feat(c6): widen Issue.affectedUrlSource with live-scan-onpage"
```

---

## Phase 2 — Harvest integration

### Task 4: Fold on-page extraction into `harvestLinks`

**Files:**
- Modify: `lib/ada-audit/link-harvest.ts`
- Test: `lib/ada-audit/link-harvest.test.ts` (update if it asserts `harvestLinks` return shape)

One combined `page.evaluate` (spec §3 preferred): collect link/img arrays inline AND invoke the injected `parseSeoFromDocument`. No `eval`/`new Function` at runtime (CSP-safe — puppeteer compiles the expression string).

- [ ] **Step 1: Add the import + extend the return type** at the top of `link-harvest.ts`:

```ts
import { parseSeoFromDocument, type RawPageSeo } from './seo/parse-seo-dom'
```

- [ ] **Step 2: Rewrite `harvestLinks`** (`link-harvest.ts:77-90`) to one combined evaluate returning `pageSeo`:

```ts
/** Read every <a href> + <img src> AND on-page SEO from the loaded page in one
 *  evaluate, then classify links. pageSeo is null only if the in-page eval throws. */
export async function harvestLinks(
  page: Page,
  auditedHost: string,
): Promise<{ targets: HarvestedTarget[]; truncated: boolean; pageSeo: RawPageSeo | null }> {
  const { links, images, seo } = await page.evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href') || '');
    const images = Array.from(document.querySelectorAll('img[src]')).map(i => i.getAttribute('src') || '');
    const seo = (${parseSeoFromDocument.toString()})(document, window);
    return { links, images, seo };
  })()`) as { links: string[]; images: string[]; seo: RawPageSeo }
  const { targets, truncated } = classifyTargets(links, images, auditedHost, page.url(), HARVEST_CAP)
  return { targets, truncated, pageSeo: seo ?? null }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Add a `harvestLinks()` test** (Codex fix #6 — the file currently only covers `classifyTargets`/`normalizeLinkTarget`). Since the evaluate changed from function-form to string-injection, prove the new return shape survives with a fake `Page`:

```ts
import { harvestLinks } from './link-harvest'

it('harvestLinks returns targets + truncated + pageSeo from one evaluate', async () => {
  const seo = { title: 'T', h1Count: 1, h2Count: 0, wordCount: 500, schemaTypes: [], hreflang: [],
    imageCount: 0, imagesMissingAlt: 0, imagesMissingDimensions: 0, robotsNoindex: false, loginLike: false }
  const fakePage = {
    url: () => 'https://x.com/p',
    evaluate: async () => ({ links: ['/a', 'https://other.com/z'], images: ['/i.png'], seo }),
  } as unknown as import('puppeteer-core').Page
  const r = await harvestLinks(fakePage, 'x.com')
  expect(r.pageSeo).toEqual(seo)
  expect(r.targets.some((t) => t.kind === 'internal-link')).toBe(true)
  expect(r.targets.some((t) => t.kind === 'external-link')).toBe(true)
})
```

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/link-harvest.test.ts`
Expected: PASS. (`classifyTargets`/`normalizeLinkTarget` tests are unaffected — pure, unchanged.)

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/link-harvest.ts lib/ada-audit/link-harvest.test.ts
git commit -m "feat(c6): harvest on-page SEO in the same DOM evaluate"
```

---

### Task 5: Carry `harvestedPageSeo` on `RunAxeResult`

**Files:**
- Modify: `lib/ada-audit/runner.ts`

- [ ] **Step 1: Add the type import** at the top of `runner.ts` (next to the existing `harvestLinks` import, `runner.ts:9` — use a normal `import type`, not inline `import()`, matching the file's convention — Codex fix #5):

```ts
import type { RawPageSeo } from './seo/parse-seo-dom'
```

- [ ] **Step 2: Extend the `audited` variant** of `RunAxeResult` (`runner.ts:45-58`). Add after `harvestedLinksTruncated: boolean`:

```ts
      // C6 Phase 2: on-page SEO captured in the same harvest evaluate (null if
      // the in-page extraction threw — non-fatal).
      harvestedPageSeo: RawPageSeo | null
```

- [ ] **Step 3: Capture it at the harvest call site** (`runner.ts:375-385`). Replace the harvest block with:

```ts
    // C6: harvest <a href> + <img src> targets + on-page SEO for the live-scan
    // builder. Non-fatal (best-effort), same contract as the PDF harvest above.
    let harvestedLinks: HarvestedTarget[] = []
    let harvestedLinksTruncated = false
    let harvestedPageSeo: RawPageSeo | null = null
    try {
      const h = await harvestLinks(page, parsed.hostname.toLowerCase())
      harvestedLinks = h.targets
      harvestedLinksTruncated = h.truncated
      harvestedPageSeo = h.pageSeo
    } catch (e) {
      console.warn('[ada-audit] link/seo harvest failed:', (e as Error).message)
    }

    return { kind: 'audited', axe, lighthouseSummary, lighthouseError, harvestedPdfUrls, harvestedLinks, harvestedLinksTruncated, harvestedPageSeo }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (the page handler destructure in Task 6 will consume the new field; until then it's just present).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/runner.ts
git commit -m "feat(c6): carry harvestedPageSeo on RunAxeResult"
```

---

### Task 6: Persist `HarvestedPageSeo` post-settle

**Files:**
- Modify: `lib/jobs/handlers/site-audit-page.ts`

`HarvestedPageSeo.url` is the **audited job URL** (`job.url`), normalized like `HarvestedLink.sourcePageUrl` — never `page.url()` (spec / Codex fix #2).

- [ ] **Step 1: Add the import + a persist helper** near `persistHarvest` (`site-audit-page.ts:58`). Add the import at the top alongside the existing `HarvestedTarget` import:

```ts
import type { RawPageSeo } from '@/lib/ada-audit/seo/parse-seo-dom'
```

Add this function after `persistHarvest`:

```ts
/**
 * Persist one on-page SEO row for THIS audited page — best-effort, fenced to a
 * SUCCESSFUL settle (caller invokes only after settlePage() returned true).
 * url is the audited job URL (normalized), NEVER page.url().
 */
async function persistPageSeo(
  siteAuditId: string,
  pageUrl: string,
  seo: RawPageSeo | null,
): Promise<void> {
  if (!seo) return
  try {
    await prisma.harvestedPageSeo.create({
      data: {
        siteAuditId,
        url: normalizeFindingUrl(pageUrl),
        // The row only exists on the successful-settle (2xx HTML) path — the
        // runner throws before this on non-2xx — so statusCode is 200 and the
        // page is HTML (Codex fix #1: a null statusCode made indexableOf() false
        // and emitted zero findings). xRobotsNoindex stays default false
        // (header threading deferred to the scorer phase, per spec).
        statusCode: 200,
        isHtml: true,
        title: seo.title ?? null,
        titleLength: seo.title?.length ?? null,
        metaDescription: seo.metaDescription ?? null,
        metaDescriptionLength: seo.metaDescription?.length ?? null,
        h1: seo.h1 ?? null,
        h1Count: seo.h1Count,
        h2Count: seo.h2Count,
        wordCount: seo.wordCount,
        canonicalUrl: seo.canonicalUrl ?? null,
        robotsNoindex: seo.robotsNoindex,
        loginLike: seo.loginLike,
        schemaCount: seo.schemaTypes.length,
        imageCount: seo.imageCount,
        imagesMissingAlt: seo.imagesMissingAlt,
        imagesMissingDimensions: seo.imagesMissingDimensions,
        // On-page extraction has no per-page cap in MVP (one row, all fields
        // present), so this is ALWAYS false — never the LINK truncation flag,
        // which would falsely mark on-page findings incomplete (Codex fix #2).
        harvestTruncated: false,
        detailsJson: JSON.stringify({ schemaTypes: seo.schemaTypes, hreflang: seo.hreflang }),
      },
    })
  } catch (e) {
    console.warn('[c6] page-seo persist failed for', siteAuditId, ':', (e as Error).message)
  }
}
```

- [ ] **Step 2: Destructure the new field + call the helper.** At `site-audit-page.ts:208`, add `harvestedPageSeo` to the destructure:

```ts
  const { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls, harvestedLinks, harvestedLinksTruncated, harvestedPageSeo } = runResult
```

At the post-settle fence (`site-audit-page.ts:249`, right after `await persistHarvest(...)`), add:

```ts
  await persistPageSeo(job.siteAuditId, job.url, harvestedPageSeo)
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/jobs/handlers/site-audit-page.ts
git commit -m "feat(c6): persist HarvestedPageSeo on successful page settle"
```

---

## Phase 3 — On-page mapper (pure)

### Task 7: `mapOnPageSeoFindings`

**Files:**
- Create: `lib/findings/onpage-seo-mapper.ts`
- Test: `lib/findings/onpage-seo-mapper.test.ts`

Pure: HarvestedPageSeo-shaped rows → `FindingInput[]`, pushing `CrawlPage`s via an injected `ensurePage(url, scalars?)` (the builder owns the runId + shared page map — Codex fix #3). Reuses `deriveIssueTypesForPage` (`issue-membership.ts:17`) for `missing_*` + `thin_content`; computes duplicate clusters with trimmed-exact comparison (Codex fix #6). Aggregation set = rows that are indexable AND not login-like.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { mapOnPageSeoFindings, type OnPageSeoRow } from './onpage-seo-mapper'
import type { CrawlPageInput, FindingInput } from './types'

function harness() {
  const pages: CrawlPageInput[] = []
  const byUrl = new Map<string, CrawlPageInput>()
  const ensurePage = (url: string, scalars?: Partial<CrawlPageInput>): CrawlPageInput => {
    let p = byUrl.get(url)
    if (!p) {
      p = { id: `p-${byUrl.size}`, runId: 'R', url, status: null, error: null, finalUrl: null,
        statusCode: null, title: null, h1: null, metaDescription: null, wordCount: null,
        crawlDepth: null, indexable: null, score: null, passCount: null, incompleteCount: null, adaAuditId: null }
      pages.push(p); byUrl.set(url, p)
    }
    if (scalars) for (const [k, v] of Object.entries(scalars)) if (v != null) (p as any)[k] = v
    return p
  }
  return { pages, ensurePage }
}

const row = (o: Partial<OnPageSeoRow> & { url: string }): OnPageSeoRow => ({
  url: o.url, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false,
  loginLike: false, title: 'T', h1: 'H', metaDescription: 'M', wordCount: 500, ...o,
})

describe('mapOnPageSeoFindings', () => {
  it('detects duplicate titles (run-scope count = GROUP count, SF semantics) + per-page findings', () => {
    const { pages, ensurePage } = harness()
    const findings = mapOnPageSeoFindings(
      [row({ url: 'https://x.com/a', title: 'Same' }), row({ url: 'https://x.com/b', title: 'Same' })],
      { runId: 'R', ensurePage, harvestTruncated: false },
    )
    const dupRun = findings.find((f) => f.scope === 'run' && f.type === 'duplicate_title')!
    expect(dupRun.count).toBe(1) // one duplicate GROUP (matches SF pageTitles.parser)
    expect(dupRun.severity).toBe('warning')
    expect(findings.filter((f) => f.scope === 'page' && f.type === 'duplicate_title').length).toBe(2)
    expect(pages.length).toBe(2)
  })
  it('flags missing title/meta/h1 only on indexable pages, with right severities', () => {
    const { ensurePage } = harness()
    const findings = mapOnPageSeoFindings(
      [row({ url: 'https://x.com/a', title: undefined, metaDescription: undefined, h1: undefined })],
      { runId: 'R', ensurePage, harvestTruncated: false },
    )
    expect(findings.find((f) => f.scope === 'run' && f.type === 'missing_title')!.severity).toBe('critical')
    expect(findings.find((f) => f.scope === 'run' && f.type === 'missing_meta_description')!.severity).toBe('warning')
    expect(findings.find((f) => f.scope === 'run' && f.type === 'missing_h1')!.severity).toBe('warning')
  })
  it('flags thin content for 0 < wordCount < 300 only (null/0 excluded)', () => {
    const { ensurePage } = harness()
    const f = mapOnPageSeoFindings(
      [row({ url: 'https://x.com/a', wordCount: 100 }), row({ url: 'https://x.com/b', wordCount: 0 }),
       row({ url: 'https://x.com/c', wordCount: null })],
      { runId: 'R', ensurePage, harvestTruncated: false },
    )
    const thin = f.find((x) => x.scope === 'run' && x.type === 'thin_content')!
    expect(thin.count).toBe(1)
  })
  it('excludes login-like and non-indexable pages from the set', () => {
    const { ensurePage } = harness()
    const f = mapOnPageSeoFindings(
      [row({ url: 'https://x.com/a', title: undefined, loginLike: true }),
       row({ url: 'https://x.com/b', title: undefined, robotsNoindex: true })],
      { runId: 'R', ensurePage, harvestTruncated: false },
    )
    expect(f.length).toBe(0)
  })
  it('duplicate comparison is trimmed-exact, not case-folded', () => {
    const { ensurePage } = harness()
    const f = mapOnPageSeoFindings(
      [row({ url: 'https://x.com/a', title: 'Hello' }), row({ url: 'https://x.com/b', title: 'hello' })],
      { runId: 'R', ensurePage, harvestTruncated: false },
    )
    expect(f.find((x) => x.scope === 'run' && x.type === 'duplicate_title')).toBeUndefined()
  })
  it('sets affectedComplete from !harvestTruncated and affectedSource live-scan-onpage', () => {
    const { ensurePage } = harness()
    const f = mapOnPageSeoFindings([row({ url: 'https://x.com/a', title: undefined })],
      { runId: 'R', ensurePage, harvestTruncated: true })
    const run = f.find((x) => x.scope === 'run' && x.type === 'missing_title')!
    expect(run.affectedComplete).toBe(false)
    expect(run.affectedSource).toBe('live-scan-onpage')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/onpage-seo-mapper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/findings/onpage-seo-mapper.ts
//
// Pure: on-page SEO rows -> FindingInput[] for the live-scan CrawlRun (C6 Phase 2).
// The BUILDER owns runId + the shared page map; this mapper pushes pages via the
// injected ensurePage and returns findings only (Codex fix #3). Missing/thin reuse
// deriveIssueTypesForPage so the live rule never drifts from the SF parser; duplicate
// comparison is trimmed-exact (Codex fix #6). Aggregation set = indexable & !login-like.
import { randomUUID } from 'crypto'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import { deriveIssueTypesForPage } from '@/lib/services/issue-membership'
import type { PerUrlRecord } from '@/lib/types'
import type { CrawlPageInput, FindingInput } from './types'

export interface OnPageSeoRow {
  url: string
  statusCode: number | null
  isHtml: boolean
  robotsNoindex: boolean
  xRobotsNoindex: boolean
  loginLike: boolean
  title: string | null | undefined
  h1: string | null | undefined
  metaDescription: string | null | undefined
  wordCount: number | null
}

export interface OnPageMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
  harvestTruncated: boolean
}

const SEVERITY: Record<string, 'critical' | 'warning' | 'notice'> = {
  missing_title: 'critical',
  duplicate_title: 'warning',
  missing_meta_description: 'warning',
  duplicate_meta_description: 'notice',
  missing_h1: 'warning',
  duplicate_h1: 'notice',
  thin_content: 'warning',
}
const DESC: Record<string, string> = {
  missing_title: 'Indexable pages with no <title>.',
  duplicate_title: 'Indexable pages sharing an identical <title>.',
  missing_meta_description: 'Indexable pages with no meta description.',
  duplicate_meta_description: 'Indexable pages sharing an identical meta description.',
  missing_h1: 'Indexable pages with no H1.',
  duplicate_h1: 'Indexable pages sharing an identical H1.',
  thin_content: 'Indexable pages with fewer than 300 visible words.',
}

const indexableOf = (r: OnPageSeoRow): boolean =>
  r.statusCode != null && r.statusCode >= 200 && r.statusCode < 300 &&
  r.isHtml && !r.robotsNoindex && !r.xRobotsNoindex

export function mapOnPageSeoFindings(rows: OnPageSeoRow[], deps: OnPageMapDeps): FindingInput[] {
  const { runId, ensurePage, harvestTruncated } = deps
  const affectedComplete = !harvestTruncated
  // Eligible set: indexable, not login-like. Normalize URL once.
  const eligible = rows
    .filter((r) => !r.loginLike && indexableOf(r))
    .map((r) => ({ ...r, url: normalizeFindingUrl(r.url) }))

  // type -> affected normalized URLs (insertion order, deduped). Page-scope rows
  // come from here for ALL types.
  const byType = new Map<string, string[]>()
  // type -> run-scope count. For missing_*/thin_content this is affected pages;
  // for duplicate_* it is the number of duplicate GROUPS (SF pageTitles.parser
  // semantics — Codex fix #3), set explicitly in dup() below.
  const runCount = new Map<string, number>()
  const add = (type: string, url: string) => {
    const arr = byType.get(type) ?? byType.set(type, []).get(type)!
    if (!arr.includes(url)) arr.push(url)
  }

  // missing_* + thin_content via the shared SF predicate. Run count = affected pages.
  for (const r of eligible) {
    const rec: PerUrlRecord = {
      url: r.url, title: r.title ?? null, h1: r.h1 ?? null, metaDescription: r.metaDescription ?? null,
      wordCount: r.wordCount, crawlDepth: null, indexable: true,
    }
    for (const t of deriveIssueTypesForPage(rec)) add(t, r.url)
  }

  // duplicates: trimmed-exact non-empty value shared by >= 2 pages. Run count =
  // number of duplicate groups; page rows = every page in any group.
  const dup = (key: 'title' | 'metaDescription' | 'h1', type: string) => {
    const groups = new Map<string, string[]>()
    for (const r of eligible) {
      const v = (r[key] ?? '').trim()
      if (!v) continue
      const arr = groups.get(v) ?? groups.set(v, []).get(v)!
      arr.push(r.url)
    }
    let groupCount = 0
    for (const urls of groups.values()) {
      if (urls.length < 2) continue
      groupCount++
      for (const u of urls) add(type, u)
    }
    if (groupCount > 0) runCount.set(type, groupCount)
  }
  dup('title', 'duplicate_title')
  dup('metaDescription', 'duplicate_meta_description')
  dup('h1', 'duplicate_h1')

  const findings: FindingInput[] = []
  for (const [type, urls] of byType) {
    findings.push({
      id: randomUUID(), runId, pageId: null, scope: 'run', type,
      severity: SEVERITY[type] ?? 'warning', url: null, count: runCount.get(type) ?? urls.length,
      affectedComplete, affectedSource: 'live-scan-onpage',
      detail: JSON.stringify({ description: DESC[type] ?? type }),
      dedupKey: runFindingKey(type),
    })
    for (const url of urls) {
      const page = ensurePage(url)
      findings.push({
        id: randomUUID(), runId, pageId: page.id, scope: 'page', type,
        severity: SEVERITY[type] ?? 'warning', url, count: 1,
        affectedComplete, affectedSource: 'live-scan-onpage', detail: null,
        dedupKey: pageFindingKey(type, url),
      })
    }
  }
  return findings
}
```

> Note: the mapper calls `ensurePage(url)` for findings-bearing pages only. The builder (Task 9) separately calls `ensurePage(url, scalars)` for EVERY harvested page so the live-scan run has a full page set with scalars — see Task 9 Step 3.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/onpage-seo-mapper.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/findings/onpage-seo-mapper.ts lib/findings/onpage-seo-mapper.test.ts
git commit -m "feat(c6): pure on-page SEO findings mapper"
```

---

## Phase 4 — Builder merge

### Task 8: Refactor `mapBrokenLinks` → `mapBrokenLinkFindings`

**Files:**
- Modify: `lib/findings/broken-link-mapper.ts`
- Test: `lib/findings/broken-link-mapper.test.ts`

Make the broken-link mapper return `FindingInput[]` against an injected `runId` + `ensurePage`, so the builder owns the single run/page map (Codex fix #3). The page/run-assembly that lived here moves to the builder (Task 9).

- [ ] **Step 1: Update the test** to the new signature (`broken-link-mapper.test.ts`). Replace the bundle-shape assertions with a harness like Task 7's `ensurePage`, and assert the returned `FindingInput[]`:

```ts
import { describe, it, expect } from 'vitest'
import { mapBrokenLinkFindings, type BrokenTarget } from './broken-link-mapper'
import type { CrawlPageInput } from './types'

function harness() {
  const pages: CrawlPageInput[] = []
  const byUrl = new Map<string, CrawlPageInput>()
  const ensurePage = (url: string): CrawlPageInput => {
    let p = byUrl.get(url)
    if (!p) { p = { id: `p-${byUrl.size}`, runId: 'R', url, status: null, error: null, finalUrl: null,
      statusCode: null, title: null, h1: null, metaDescription: null, wordCount: null, crawlDepth: null,
      indexable: null, score: null, passCount: null, incompleteCount: null, adaAuditId: null }
      pages.push(p); byUrl.set(url, p) }
    return p
  }
  return { pages, ensurePage }
}

describe('mapBrokenLinkFindings', () => {
  it('emits run-scope distinct-target counts + source-page-keyed page findings', () => {
    const { pages, ensurePage } = harness()
    const broken: BrokenTarget[] = [
      { targetUrl: 'https://x.com/dead', kind: 'internal-link', sourcePageUrls: ['https://x.com/a', 'https://x.com/b'] },
    ]
    const findings = mapBrokenLinkFindings(broken, {
      runId: 'R', ensurePage, affectedComplete: true,
      confidence: { checked: 1, broken: 1, unconfirmed: 0, capped: false, harvestTruncated: false },
    })
    const run = findings.find((f) => f.scope === 'run' && f.type === 'broken_internal_links')!
    expect(run.count).toBe(1)
    expect(findings.filter((f) => f.scope === 'page' && f.type === 'broken_internal_links').length).toBe(2)
    expect(pages.length).toBe(2) // keyed by SOURCE page
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/broken-link-mapper.test.ts`
Expected: FAIL — `mapBrokenLinkFindings` not exported.

- [ ] **Step 3: Rewrite `broken-link-mapper.ts`** — keep `BrokenTarget`, drop the run/page assembly, export `mapBrokenLinkFindings`:

```ts
// lib/findings/broken-link-mapper.ts
//
// Pure: broken-link verifier results -> FindingInput[] for the live-scan run (C6).
// Run-scope count = distinct broken TARGET urls per type. Page-scope findings keyed
// by SOURCE PAGE (one per (type, source page)) so multiple sources to one broken
// target never collide on @@unique([runId, dedupKey]); broken target urls ride in
// detail. The BUILDER owns runId + the shared page map (ensurePage).
import { randomUUID } from 'crypto'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import type { CrawlPageInput, FindingInput } from './types'

export interface BrokenTarget {
  targetUrl: string
  kind: 'internal-link' | 'image' | 'external-link'
  sourcePageUrls: string[] // sample, <=25; normalized by the caller
}

export interface BrokenLinkMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
  affectedComplete: boolean
  confidence: {
    checked: number
    broken: number
    unconfirmed: number
    capped: boolean
    harvestTruncated: boolean
  }
}

const TYPE_OF: Record<BrokenTarget['kind'], string | null> = {
  'internal-link': 'broken_internal_links',
  image: 'broken_images',
  'external-link': null, // not verified in v1
}
const DESC: Record<string, string> = {
  broken_internal_links: 'Internal links that resolve to a 4xx/5xx response.',
  broken_images: 'Image resources that resolve to a 4xx/5xx response.',
}
const URLS_PER_FINDING = 25

export function mapBrokenLinkFindings(broken: BrokenTarget[], deps: BrokenLinkMapDeps): FindingInput[] {
  const { runId, ensurePage, affectedComplete, confidence } = deps
  const byType = new Map<string, BrokenTarget[]>()
  for (const t of broken) {
    const type = TYPE_OF[t.kind]
    if (!type) continue
    const arr = byType.get(type) ?? byType.set(type, []).get(type)!
    arr.push(t)
  }

  const findings: FindingInput[] = []
  for (const [type, targets] of byType) {
    const distinctTargets = new Set(targets.map((t) => t.targetUrl)).size
    findings.push({
      id: randomUUID(), runId, pageId: null, scope: 'run', type, severity: 'critical',
      url: null, count: distinctTargets, affectedComplete, affectedSource: 'live-scan-verify',
      detail: JSON.stringify({ description: DESC[type] ?? type, ...confidence }),
      dedupKey: runFindingKey(type),
    })
    const bySource = new Map<string, string[]>()
    for (const t of targets) {
      for (const src of t.sourcePageUrls) {
        const s = normalizeFindingUrl(src)
        const arr = bySource.get(s) ?? bySource.set(s, []).get(s)!
        arr.push(t.targetUrl)
      }
    }
    for (const [src, targetUrls] of bySource) {
      const page = ensurePage(src)
      findings.push({
        id: randomUUID(), runId, pageId: page.id, scope: 'page', type, severity: 'critical',
        url: src, count: targetUrls.length, affectedComplete, affectedSource: 'live-scan-verify',
        detail: JSON.stringify({ brokenTargetUrls: targetUrls.slice(0, URLS_PER_FINDING) }),
        dedupKey: pageFindingKey(type, src),
      })
    }
  }
  return findings
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/broken-link-mapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/findings/broken-link-mapper.ts lib/findings/broken-link-mapper.test.ts
git commit -m "refactor(c6): broken-link mapper returns findings against injected run/page map"
```

---

### Task 9: Builder — merge on-page + broken-link into one live-scan run

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts`
- Test: `lib/jobs/handlers/broken-link-verify.test.ts`

`runBrokenLinkVerify` becomes the single live-scan run builder: owns the `runId` + shared `ensurePage`, loads `HarvestedPageSeo`, builds on-page + broken-link findings, writes ONE bundle, deletes BOTH transient tables.

- [ ] **Step 1: Add an idempotency + on-page-merge test** to `broken-link-verify.test.ts` (follow the file's existing seed/cleanup pattern — unique domain prefix; clean `crawlRun` by domain BEFORE origin rows; delete `harvestedLink`/`harvestedPageSeo`). Sketch:

```ts
// Seed a complete SiteAudit with: 2 HarvestedPageSeo rows sharing a title (duplicate),
// and 1 HarvestedLink internal-link whose target the stubbed checkUrl returns 'broken'.
// Run runBrokenLinkVerify with deps.checkUrl stubbed to 'broken' for the target.
it('writes ONE live-scan run carrying on-page + broken-link findings, deletes both tables', async () => {
  // ...seed...
  await runBrokenLinkVerify({ siteAuditId, domain }, stubDeps)
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
    include: { findings: true, pages: true },
  })
  expect(run).not.toBeNull()
  const types = new Set(run!.findings.map((f) => f.type))
  expect(types.has('duplicate_title')).toBe(true)
  expect(types.has('broken_internal_links')).toBe(true)
  expect(await prisma.harvestedPageSeo.count({ where: { siteAuditId } })).toBe(0)
  expect(await prisma.harvestedLink.count({ where: { siteAuditId } })).toBe(0)
})
it('is idempotent (second run replaces, one row)', async () => {
  // re-seed BOTH HarvestedLink AND HarvestedPageSeo rows (Codex fix #8 — the
  // builder consumes both, so both must be present to prove unified idempotency),
  // run runBrokenLinkVerify twice -> exactly one live-scan run, findings from both sources
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: FAIL (on-page findings absent / not yet built).

- [ ] **Step 3: Rewrite the body of `runBrokenLinkVerify`** (`broken-link-verify.ts:56-134`). Replace the imports and the section from the `mapBrokenLinks` call onward. New imports at top:

```ts
import { mapBrokenLinkFindings, type BrokenTarget } from '@/lib/findings/broken-link-mapper'
import { mapOnPageSeoFindings, type OnPageSeoRow } from '@/lib/findings/onpage-seo-mapper'
import type { CrawlPageInput, FindingInput, FindingsBundle } from '@/lib/findings/types'
import { randomUUID } from 'crypto'
```

After the link verification loop produces `broken`, `checked`, `unconfirmed`, `capped`, `harvestTruncated`, replace the `mapBrokenLinks(...)` + `writeFindingsRun(...)` + `deleteMany` block with:

```ts
  // Load on-page SEO rows for the same audit.
  const seoRows = await prisma.harvestedPageSeo.findMany({
    where: { siteAuditId: job.siteAuditId },
    select: {
      url: true, statusCode: true, isHtml: true, robotsNoindex: true, xRobotsNoindex: true,
      loginLike: true, title: true, h1: true, metaDescription: true, wordCount: true,
    },
  })

  // Builder owns the single runId + the shared normalized-URL -> CrawlPage map.
  const runId = randomUUID()
  const pages: CrawlPageInput[] = []
  const pageByUrl = new Map<string, CrawlPageInput>()
  const ensurePage = (url: string, scalars?: Partial<CrawlPageInput>): CrawlPageInput => {
    const u = normalizeFindingUrl(url)
    let p = pageByUrl.get(u)
    if (!p) {
      p = { id: randomUUID(), runId, url: u, status: null, error: null, finalUrl: null,
        statusCode: null, title: null, h1: null, metaDescription: null, wordCount: null,
        crawlDepth: null, indexable: null, score: null, passCount: null, incompleteCount: null, adaAuditId: null }
      pages.push(p); pageByUrl.set(u, p)
    }
    if (scalars) for (const [k, v] of Object.entries(scalars)) if (v != null) (p as Record<string, unknown>)[k] = v
    return p
  }

  // Materialize a CrawlPage for EVERY harvested on-page row, scalars populated.
  const indexableOf = (r: typeof seoRows[number]) =>
    r.statusCode != null && r.statusCode >= 200 && r.statusCode < 300 &&
    r.isHtml && !r.robotsNoindex && !r.xRobotsNoindex
  for (const r of seoRows) {
    ensurePage(r.url, {
      statusCode: r.statusCode, title: r.title, h1: r.h1, metaDescription: r.metaDescription,
      wordCount: r.wordCount, indexable: indexableOf(r) && !r.loginLike,
    })
  }

  // On-page has no per-page cap in MVP, so its completeness is independent of the
  // LINK truncation flag (Codex fix #2) — always pass false here.
  const onPageFindings = mapOnPageSeoFindings(seoRows as OnPageSeoRow[], { runId, ensurePage, harvestTruncated: false })
  const brokenFindings = mapBrokenLinkFindings(broken, {
    runId, ensurePage, affectedComplete: !capped && !harvestTruncated,
    confidence: { checked, broken: broken.length, unconfirmed, capped, harvestTruncated },
  })
  const findings: FindingInput[] = [...onPageFindings, ...brokenFindings]

  const bundle: FindingsBundle = {
    run: {
      id: runId, tool: 'seo-parser', source: 'live-scan', domain: site.domain ?? job.domain,
      clientId: site.clientId, sessionId: null, siteAuditId: site.id, adaAuditId: null,
      status: capped || harvestTruncated ? 'partial' : 'complete', score: null, wcagLevel: null,
      pagesTotal: pages.length, startedAt, completedAt: new Date(deps.now()),
    },
    pages, findings, violations: [],
  }
  await writeFindingsRun(bundle)
  await prisma.harvestedLink.deleteMany({ where: { siteAuditId: job.siteAuditId } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAuditId: job.siteAuditId } })
  console.log(
    `[broken-link-verify] ${job.siteAuditId}: checked ${checked}, broken ${broken.length}, unconfirmed ${unconfirmed}, on-page rows ${seoRows.length}`,
  )
```

Remove the now-unused `mapBrokenLinks` import. Keep the `startedAt`/throttle/worker code above unchanged. Note: the empty case (no links, no on-page rows) still writes an empty `complete` run (`pages: []`, `findings: []`) — verified-clean state preserved.

- [ ] **Step 4: Typecheck + run test**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(c6): broken-link-verify builds unified live-scan run (on-page + broken)"
```

---

## Phase 5 — Recovery & retention

### Task 10: Broaden recovery to `HarvestedPageSeo`

**Files:**
- Modify: `lib/ada-audit/broken-link-recovery.ts`
- Test: `lib/ada-audit/broken-link-recovery.test.ts`

- [ ] **Step 1: Add a recovery test** — a complete audit with ONLY `HarvestedPageSeo` rows (no `HarvestedLink`), no live-scan run, no active job → re-enqueued. Follow the file's existing seed/cleanup pattern.

```ts
it('re-enqueues a stranded audit that has only HarvestedPageSeo rows', async () => {
  // seed complete SiteAudit + 1 harvestedPageSeo row, no harvestedLink, no live-scan run, no job
  const n = await recoverBrokenLinkVerifies()
  expect(n).toBeGreaterThanOrEqual(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/broken-link-recovery.test.ts`
Expected: FAIL (only HarvestedLink is scanned today).

- [ ] **Step 3: Broaden the candidate scan.** Replace the `pending` query (`broken-link-recovery.ts:13-17`) with a union of both transient tables:

```ts
  // Distinct siteAuditIds that still have EITHER transient table populated
  // (the verifier/builder deletes both only on success).
  const [links, seo] = await Promise.all([
    prisma.harvestedLink.findMany({ distinct: ['siteAuditId'], select: { siteAuditId: true } }),
    prisma.harvestedPageSeo.findMany({ distinct: ['siteAuditId'], select: { siteAuditId: true } }),
  ])
  const pending = [...new Set([...links, ...seo].map((r) => r.siteAuditId))].map((siteAuditId) => ({ siteAuditId }))
```

(The rest of the loop — complete-status check, live-run check, active-job check, awaited enqueue — is unchanged and remains idempotent via `dedupKey`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/broken-link-recovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/broken-link-recovery.ts lib/ada-audit/broken-link-recovery.test.ts
git commit -m "feat(c6): recovery scans HarvestedPageSeo too (zero-link audits)"
```

---

### Task 11: `pruneHarvestedPageSeo` + register

**Files:**
- Modify: `lib/findings/retention.ts`
- Modify: `lib/cleanup.ts`
- Test: `lib/findings/retention.test.ts` (if present; else add a focused test)

- [ ] **Step 1: Add a prune test** (mirror `pruneHarvestedLinks`'s test if one exists): seed rows with `createdAt` older/newer than 7 days; assert only old ones deleted.

```ts
it('pruneHarvestedPageSeo deletes rows older than 7 days only', async () => {
  // seed one old (8d) + one fresh row, run pruneHarvestedPageSeo(now), assert old gone
})
```

- [ ] **Step 2: Implement** after `pruneHarvestedLinks` (`retention.ts:135`):

```ts
/**
 * C6 Phase 2: delete stale HarvestedPageSeo scaffolding. The live-scan builder
 * deletes its own rows on success; this backstops audits whose build never ran.
 * Reuses the 7-day HARVEST_RETENTION_MS window. Runs in runCleanup().
 */
export async function pruneHarvestedPageSeo(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - HARVEST_RETENTION_MS)
  const { count } = await prisma.harvestedPageSeo.deleteMany({ where: { createdAt: { lt: cutoff } } })
  if (count > 0) console.log(`[findings] pruned ${count} stale HarvestedPageSeo row(s)`)
}
```

- [ ] **Step 3: Register in `runCleanup`.** In `lib/cleanup.ts`, update the import (`cleanup.ts:7`) and add the call to the `Promise.allSettled([...])` array (after `pruneHarvestedLinks()`, `cleanup.ts:34`):

```ts
import { pruneArchivedBlobs, pruneHarvestedLinks, pruneHarvestedPageSeo } from '@/lib/findings/retention';
```
```ts
    pruneHarvestedLinks(),
    pruneHarvestedPageSeo(),
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/retention.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/findings/retention.ts lib/cleanup.ts lib/findings/retention.test.ts
git commit -m "feat(c6): 7-day pruneHarvestedPageSeo in runCleanup"
```

---

## Phase 6 — Surface

### Task 12: Filter BrokenLinksSection + add OnPageSeoSection

**Files:**
- Modify: `components/site-audit/BrokenLinksSection.tsx`
- Create: `components/site-audit/OnPageSeoSection.tsx`
- Modify: `app/ada-audit/site/[id]/page.tsx`

The live-scan run now carries BOTH broken-link and on-page findings. `BrokenLinksSection` currently renders ALL run-scope findings with `count>0` — it MUST filter to `broken_*` so it never shows on-page findings (Codex fix #4 / verify-3).

- [ ] **Step 1: Filter `BrokenLinksSection` to broken types.** In `BrokenLinksSection.tsx`, add a type set and use it for `runScope`:

```ts
const BROKEN_TYPES = new Set(['broken_internal_links', 'broken_images'])
```

Change the `runScope` line (`BrokenLinksSection.tsx:58`) to:

```ts
  const runScope = run.findings.filter((f) => f.scope === 'run' && f.count > 0 && BROKEN_TYPES.has(f.type))
```

And guard the page-grouping loop (`:78`) to broken types too:

```ts
    if (f.scope !== 'page' || !f.url || !BROKEN_TYPES.has(f.type)) continue
```

- [ ] **Step 2: Create `OnPageSeoSection.tsx`** (sibling, reads the same `liveScanRun`, filters to on-page types):

```tsx
// components/site-audit/OnPageSeoSection.tsx
//
// C6 Phase 2: renders on-page SEO findings (duplicate/missing/thin) from the
// live-scan CrawlRun. Reads the SAME run as BrokenLinksSection; filters to the
// on-page types only. "Clean" means no on-page findings among the successfully
// audited HTML pages — NOT whole-site clean (error/redirect/non-HTML pages are
// not evaluated this phase).
import type { BrokenLinksRun } from './BrokenLinksSection'

const ONPAGE_LABEL: Record<string, string> = {
  missing_title: 'Missing title',
  duplicate_title: 'Duplicate title',
  missing_meta_description: 'Missing meta description',
  duplicate_meta_description: 'Duplicate meta description',
  missing_h1: 'Missing H1',
  duplicate_h1: 'Duplicate H1',
  thin_content: 'Thin content (< 300 words)',
}
const ONPAGE_TYPES = new Set(Object.keys(ONPAGE_LABEL))

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">On-page SEO</h2>
      {children}
    </section>
  )
}

// `analyzed` distinguishes a Phase-2 run (on-page extraction ran — at least one
// CrawlPage has a populated statusCode) from a pre-Phase-2 live-scan run that
// only carries broken-link findings. Without it, an old run would render a
// misleading "clean" (Codex fix #4). The page computes it from the run's pages.
export function OnPageSeoSection({ run, analyzed }: { run: BrokenLinksRun | null; analyzed: boolean }) {
  if (!run) {
    return (
      <Card>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          On-page SEO not yet analyzed — the live scan runs shortly after the audit completes.
        </p>
      </Card>
    )
  }
  if (!analyzed) {
    return (
      <Card>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          This audit predates on-page SEO analysis — re-run the audit to populate it.
        </p>
      </Card>
    )
  }
  const runScope = run.findings.filter((f) => f.scope === 'run' && f.count > 0 && ONPAGE_TYPES.has(f.type))
  if (runScope.length === 0) {
    return (
      <Card>
        <p className="text-[13px] font-body text-green-700 dark:text-green-400">
          No on-page issues found among the successfully audited HTML pages.
        </p>
      </Card>
    )
  }
  const pageByType = new Map<string, string[]>()
  for (const f of run.findings) {
    if (f.scope !== 'page' || !f.url || !ONPAGE_TYPES.has(f.type)) continue
    const list = pageByType.get(f.type) ?? []
    list.push(f.url)
    pageByType.set(f.type, list)
  }
  return (
    <Card>
      <p className="text-[12px] font-body text-navy/45 dark:text-white/45 mb-3">
        Rendered-DOM, sitemap-bounded — among successfully audited HTML pages only. Not Screaming Frog crawl parity.
      </p>
      <div className="space-y-4">
        {runScope.map((f) => {
          const pages = pageByType.get(f.type) ?? []
          return (
            <div key={f.type}>
              <p className="text-[13px] font-body font-semibold text-navy dark:text-white">
                {ONPAGE_LABEL[f.type] ?? f.type}: {f.count}
              </p>
              {pages.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {pages.slice(0, 25).map((u, i) => (
                    <li key={i} className="text-[12px] font-body text-navy/60 dark:text-white/60 break-all">{u}</li>
                  ))}
                  {pages.length > 25 && (
                    <li className="text-[12px] font-body text-navy/40 dark:text-white/40">+{pages.length - 25} more</li>
                  )}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
```

- [ ] **Step 3: Add an analyzed probe to the query + render the section** in `app/ada-audit/site/[id]/page.tsx`. Add the import next to `BrokenLinksSection` (`page.tsx:9`):

```ts
import { OnPageSeoSection } from '@/components/site-audit/OnPageSeoSection'
```

Extend the `liveScanRun` query (`page.tsx:154-160`) to probe for a Phase-2 page (one with a populated `statusCode` — Codex fix #4). Add a `pages` sub-select:

```ts
  const liveScanRun = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: audit.id, tool: 'seo-parser' } },
    select: {
      status: true,
      findings: { select: { scope: true, type: true, count: true, url: true, detail: true } },
      // Phase-2 marker: on-page extraction populates statusCode on every page it
      // writes; pre-Phase-2 runs have only broken-link source pages (statusCode null).
      pages: { where: { statusCode: { not: null } }, select: { id: true }, take: 1 },
    },
  })
  const onPageAnalyzed = !!liveScanRun && liveScanRun.pages.length > 0
```

Add the component right after `<BrokenLinksSection run={liveScanRun} />` (`page.tsx:197`):

```tsx
      <OnPageSeoSection run={liveScanRun} analyzed={onPageAnalyzed} />
```

> Note: `BrokenLinksSection` still receives `liveScanRun` (typed `BrokenLinksRun`). The extra `pages` field on the object is fine — excess-property checks only apply to inline object literals, not a passed variable. `BrokenLinksSection` ignores it.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Manual verify** — `DATABASE_URL="file:./local-dev.db" npx next dev`, open a completed site audit; confirm the On-page SEO section renders and the Broken-links section no longer shows on-page findings.

- [ ] **Step 6: Commit**

```bash
git add components/site-audit/BrokenLinksSection.tsx components/site-audit/OnPageSeoSection.tsx app/ada-audit/site/[id]/page.tsx
git commit -m "feat(c6): on-page SEO results section + scope broken-links to broken_*"
```

---

## Phase 7 — Verification & ship

### Task 13: Full verification + deploy

- [ ] **Step 1: Typecheck + full suite**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npm test`
Expected: PASS, no regressions in existing ADA/findings tests.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Deploy** (per CLAUDE.md — push first; the server pulls + runs `prisma migrate deploy`)

```bash
git push
ssh seo@144.126.213.242 "~/deploy.sh"
```

- [ ] **Step 4: Live canary verification** (authed prod, per handoff gotchas). Trigger a site audit on the canary (`POST /api/site-audit {domain:'proway.erstaging.site', wcagLevel:'wcag21aa'}`), wait for complete + the broken-link-verify job, then from inside `/home/seo/webapps/seo-tools` confirm via Prisma:
  - `HarvestedPageSeo` rows ≈ successfully-settled HTML page count during the run, and **zero** after the build (deleted).
  - the live-scan `CrawlRun` (`siteAuditId_tool` seo-parser) carries on-page findings (duplicate/missing/thin) AND any broken-link findings, with `score: null`.
  - the results page shows the On-page SEO section; the Broken-links section shows no on-page types.
  - a zero-broken-link audit still produces a live-scan run with on-page findings.

- [ ] **Step 5: Update tracker + handoff** (improvement-roadmap protocol): check C6 stays `[~]` with a Phase 2 status-log line; rewrite `HANDOFF-improvement-roadmap.md` for the next item; archive this spec+plan to `docs/superpowers/archive/` once shipped. Commit together.

---

## Self-Review notes

- **Spec coverage:** §2 scope → T2/T4/T7 (extraction + findings, score deferred, no error/redirect rows, graph out); §3 architecture (single writer) → T9; §4 data model → T1 (HarvestedPageSeo, no CrawlRun/CrawlPage change); §5 extraction + vocabulary (`thin_content`, trimmed-exact, severities, `live-scan-onpage`) → T2/T3/T7; §6 builder merge (partial-bundle, builder owns runId/page map) → T8/T9; §7 recovery+retention → T10/T11; §8 surface (filtered sections, clean-scope copy) → T12; §9 testing → per-task tests + T13; §10 acceptance → T13.
- **Codex fixes:** #1 `thin_content` (T7 SEVERITY/DESC + reuse of `deriveIssueTypesForPage`); #2 page identity = `job.url` normalized (T6); #3 partial-bundle mappers + builder-owned run/page map (T8/T9); #4 widen union (T3) + filter both sections (T12); #5 clean-scope copy (T12 OnPageSeoSection); #6 trimmed-exact duplicates (T7 + test).
- **Type consistency:** `RawPageSeo` (T2) → `harvestLinks.pageSeo` (T4) → `RunAxeResult.harvestedPageSeo` (T5) → `persistPageSeo` (T6) → `HarvestedPageSeo` rows → `OnPageSeoRow` (T7) read by the builder (T9). `ensurePage(url, scalars?)` signature identical across T7/T8/T9. `mapOnPageSeoFindings`/`mapBrokenLinkFindings` both return `FindingInput[]`.
- **No placeholders:** every code step shows complete code; T13 is verification/deploy (commands explicit). The two seed-heavy DB tests (T9 Step 1, T10/T11) reference the sibling test files' existing seed/cleanup patterns by name rather than re-deriving them — intentional, to match this repo's per-file DB-test hygiene.
- **Codex plan-review fixes (8):** #1 `statusCode:200` on persist (else `indexableOf` false → zero findings) — T6; #2 on-page `harvestTruncated:false`, decoupled from link cap — T6/T9; #3 duplicate run-scope count = group count (SF semantics) — T7; #4 `analyzed` probe so pre-Phase-2 runs don't show false "clean" — T12; #5 `import type RawPageSeo` not inline `import()` — T5; #6 real `harvestLinks()` test — T4; #7 dedupe+cap `schemaTypes`/`hreflang` at 50 — T2; #8 idempotency test re-seeds both transient tables — T9.
