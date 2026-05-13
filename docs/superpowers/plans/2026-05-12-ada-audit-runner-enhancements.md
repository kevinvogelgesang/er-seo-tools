# ADA Audit Runner Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump audit RAM headroom to ~3 GB, run Lighthouse alongside axe on every page in a single navigation, scan same-domain PDFs for accessibility issues, and mirror the existing 180d cleanup pattern for new on-disk artifacts.

**Architecture:** All work lands on a single branch `feat/ada-audit-runner-enhancements`. Browser pool grows from 2 → 4 slots with env-tunable knobs. Lighthouse and axe share one page load per audit (LH navigates first, axe runs after on the loaded DOM, PDFs harvested from that same DOM). PDF scanning is its own concurrency-limited Node-side worker pool using `pdfjs-dist`. Lighthouse JSON reports gzip on disk; `lib/cleanup.ts` gains a matching `cleanExpiredLighthouseReports()`. Schema migration adds 2 columns to `AdaAudit`, 3 to `SiteAudit`, and a new `PdfAudit` model.

**Tech Stack:** Next.js 15 App Router · TypeScript · Prisma + SQLite (WAL) · puppeteer-core + Chrome · `lighthouse` npm · `pdfjs-dist` (Node legacy build) · vitest for tests.

**Reference spec:** `docs/superpowers/specs/2026-05-12-ada-audit-runner-enhancements-design.md`

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `lib/ada-audit/lighthouse-runner.ts` | Run Lighthouse against a puppeteer page; return summary + raw report buffer |
| `lib/ada-audit/lighthouse-storage.ts` | gzip read/write/delete for LH JSON; `LIGHTHOUSE_REPORTS_DIR` path |
| `lib/ada-audit/lighthouse-types.ts` | `LighthouseSummary` shape (also referenced by UI) |
| `lib/ada-audit/pdf-discovery.ts` | Harvest `<a href$=".pdf">` from a loaded page; normalize URLs |
| `lib/ada-audit/pdf-runner.ts` | Fetch + parse PDF via `pdfjs-dist`; produce `PdfIssue[]` |
| `lib/ada-audit/pdf-worker-pool.ts` | Independent (non-Chrome) concurrency limiter for PDF scans |
| `lib/ada-audit/pdf-types.ts` | `PdfIssue`, `PdfScanResult`, issue code enum |
| `app/api/ada-audit/[id]/lighthouse-report/route.ts` | GET streams gunzipped LH JSON |
| `lib/ada-audit/lighthouse-runner.test.ts` | Unit tests for summary extraction (mocked LH output) |
| `lib/ada-audit/pdf-discovery.test.ts` | Unit tests for URL normalization + dedup |
| `lib/ada-audit/pdf-runner.test.ts` | Unit tests for issue detection (fixture PDFs in `lib/ada-audit/__fixtures__/`) |

### Modified files
| Path | Change |
|---|---|
| `prisma/schema.prisma` | Add columns to `AdaAudit`, `SiteAudit`; add `PdfAudit` model |
| `lib/db.ts` | Export `initPragmas()` returning a Promise so callers can await it |
| `instrumentation.ts` | Await `initPragmas()` before kicking the queue processor |
| `lib/ada-audit/browser-pool.ts` | Env-tunable `BROWSER_POOL_SIZE`, `CHROME_MAX_OLD_SPACE` |
| `lib/ada-audit/runner.ts` | Single-nav flow: optional LH first → reset CDP → axe → PDF harvest |
| `lib/ada-audit/queue-manager.ts` | Increment `SiteAudit.pdfsTotal/Complete/Error`; complete-when condition |
| `lib/ada-audit/types.ts` | Re-export `LighthouseSummary`, `PdfIssue` types |
| `lib/cleanup.ts` | Add `cleanExpiredLighthouseReports()` to daily run |
| `app/api/ada-audit/[id]/route.ts` | Also call `deleteLighthouseReport(id)` on DELETE |
| `app/api/site-audit/[id]/route.ts` | Iterate child audit IDs, clean screenshots + LH, then cascade delete |
| `components/ada-audit/AuditResultsView.tsx` | Render Lighthouse section + per-page PDFs section |
| `components/ada-audit/SiteAuditResultsView.tsx` | Render site-wide "PDFs Found" section with copy buttons |
| `components/ada-audit/LighthouseSection.tsx` | **NEW** — shared score rings + CWV + top failures display |
| `components/ada-audit/PdfIssuesSection.tsx` | **NEW** — copy-paste-friendly PDF report block |
| `package.json` | Add `lighthouse` + `pdfjs-dist` deps |

---

## Phase 1: Foundation

### Task 1: Cut branch and install dependencies

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Create and switch to branch**

```bash
git checkout main
git pull
git checkout -b feat/ada-audit-runner-enhancements
```

Expected: `Switched to a new branch 'feat/ada-audit-runner-enhancements'`

- [ ] **Step 2: Install Lighthouse + pdfjs-dist**

```bash
npm install lighthouse pdfjs-dist
```

Expected: both packages added to `dependencies` in `package.json`. No peer-dep warnings related to puppeteer-core.

- [ ] **Step 3: Verify versions land**

```bash
node -e "console.log(require('lighthouse/package.json').version, require('pdfjs-dist/package.json').version)"
```

Expected: two version strings printed, e.g. `11.x.x 4.x.x`.

- [ ] **Step 4: Commit dep additions**

```bash
git add package.json package-lock.json
git commit -m "feat(ada-audit): add lighthouse + pdfjs-dist deps"
```

---

### Task 2: Prisma schema migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_lighthouse_and_pdf_audits/migration.sql` (auto-generated)

- [ ] **Step 1: Edit `prisma/schema.prisma` — add columns to `AdaAudit`**

In the `AdaAudit` model, after the existing fields and before `@@index([createdAt])`, insert:

```prisma
  lighthouseSummary String?
  lighthouseError   String?
  pdfAudits         PdfAudit[]
```

- [ ] **Step 2: Edit `SiteAudit` — add counters and relation**

In the `SiteAudit` model, after `pagesError`, insert:

```prisma
  pdfsTotal     Int        @default(0)
  pdfsComplete  Int        @default(0)
  pdfsError     Int        @default(0)
  pdfAudits     PdfAudit[]
```

- [ ] **Step 3: Add `PdfAudit` model**

Append to `prisma/schema.prisma` after the last existing model:

```prisma
model PdfAudit {
  id           String     @id @default(cuid())
  createdAt    DateTime   @default(now())
  siteAuditId  String?
  siteAudit    SiteAudit? @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)
  adaAuditId   String?
  adaAudit     AdaAudit?  @relation(fields: [adaAuditId], references: [id], onDelete: Cascade)
  url          String     // normalized URL (query/fragment stripped, host lowercased)
  fileSize     Int?       // bytes
  pageCount    Int?
  status       String     // pending | scanning | complete | error
  issues       String?    // JSON: PdfIssue[]
  scanError    String?

  @@index([siteAuditId])
  @@index([adaAuditId])
  @@unique([siteAuditId, url])
  @@unique([adaAuditId, url])
}
```

- [ ] **Step 4: Run the migration locally**

```bash
npx prisma migrate dev --name add_lighthouse_and_pdf_audits
```

Expected: a new migration file under `prisma/migrations/`, Prisma client regenerated, no errors. The migration command applies it to your local SQLite at `prisma/local-dev.db`.

- [ ] **Step 5: Verify generated client has new fields**

```bash
node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); console.log(Object.keys(p.pdfAudit), 'lighthouseSummary' in p.adaAudit.fields ? 'ok' : 'missing')"
```

Note: the second check uses `prisma.adaAudit.fields` if it exists in your Prisma version. Alternative simpler check:

```bash
npx tsx -e "import {prisma} from './lib/db'; console.log(prisma.pdfAudit ? 'PdfAudit ok' : 'missing')"
```

Expected: `PdfAudit ok`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(ada-audit): schema for lighthouse + pdf audits"
```

---

### Task 3: Tighten DB PRAGMA initialization

**Files:**
- Modify: `lib/db.ts`
- Modify: `instrumentation.ts`

Current `lib/db.ts` fires PRAGMAs as `void prisma.$executeRawUnsafe(...).catch(() => {})` on import. Under concurrent first-write load this races with the first real query. Convert to an awaited init function.

- [ ] **Step 1: Update `lib/db.ts`**

Replace the entire contents with:

```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
  prismaInitDone: boolean;
};

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Apply SQLite PRAGMA optimizations. WAL mode + busy_timeout are required for
 * the concurrent audit workers to avoid SQLITE_BUSY under load.
 *
 * Idempotent — safe to call multiple times. Awaited from instrumentation.ts
 * before the queue processor starts so the first audit write doesn't race
 * with PRAGMA setup.
 */
export async function initPragmas(): Promise<void> {
  if (globalForPrisma.prismaInitDone) return;
  await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL');
  await prisma.$executeRawUnsafe('PRAGMA cache_size = -20000');
  await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await prisma.$executeRawUnsafe('PRAGMA temp_store = MEMORY');
  globalForPrisma.prismaInitDone = true;
}
```

- [ ] **Step 2: Update `instrumentation.ts` to await `initPragmas()` first**

In `instrumentation.ts`, after the File polyfill block and before the `closeBrowser` import, insert:

```ts
    const { initPragmas } = await import('@/lib/db')
    await initPragmas()
```

The block now looks like:

```ts
    if (process.env.NODE_ENV === 'production' && !process.env.PILLAR_TOKEN_SECRET) {
      console.error('[startup] PILLAR_TOKEN_SECRET is required in production but is unset. Refusing to start.');
      process.exit(1);
    }

    const { initPragmas } = await import('@/lib/db')
    await initPragmas()

    const { closeBrowser } = await import('@/lib/ada-audit/browser-pool')
    // ...
```

- [ ] **Step 3: Smoke test — restart dev server, verify WAL active**

```bash
npm run dev &
sleep 5
sqlite3 prisma/local-dev.db "PRAGMA journal_mode;"
kill %1
```

Expected output: `wal`

- [ ] **Step 4: Commit**

```bash
git add lib/db.ts instrumentation.ts
git commit -m "refactor(db): await PRAGMA init at startup to avoid race with first write"
```

---

## Phase 2: Browser pool RAM bump

### Task 4: Env-tunable browser pool

**Files:**
- Modify: `lib/ada-audit/browser-pool.ts`

- [ ] **Step 1: Edit launch args block in `lib/ada-audit/browser-pool.ts`**

Replace the top of the file:

```ts
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'

const CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE ?? '/usr/bin/google-chrome'
const POOL_SIZE = parseInt(process.env.BROWSER_POOL_SIZE ?? '4', 10)
const MAX_OLD_SPACE = parseInt(process.env.CHROME_MAX_OLD_SPACE ?? '512', 10)

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-translate',
  '--disable-sync',
  `--js-flags=--max-old-space-size=${MAX_OLD_SPACE}`,
  '--disable-http-cache',
]
```

Leave the rest of the file (singleton browser, semaphore) unchanged.

- [ ] **Step 2: Verify it parses**

```bash
npx tsc --noEmit
```

Expected: no errors related to `browser-pool.ts`.

- [ ] **Step 3: Smoke test pool size and heap flag at runtime**

```bash
BROWSER_POOL_SIZE=3 CHROME_MAX_OLD_SPACE=640 npx tsx -e "
const { acquirePage, releasePage, closeBrowser } = require('./lib/ada-audit/browser-pool');
(async () => {
  const p = await acquirePage();
  const args = await p.browser().process().spawnargs;
  console.log(args.find(a => a.includes('max-old-space-size')));
  await releasePage(p);
  await closeBrowser();
})();
"
```

Expected: `--js-flags=--max-old-space-size=640` printed.

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/browser-pool.ts
git commit -m "feat(ada-audit): env-tunable BROWSER_POOL_SIZE and CHROME_MAX_OLD_SPACE"
```

---

## Phase 3: Lighthouse integration

### Task 5: Define LighthouseSummary types

**Files:**
- Create: `lib/ada-audit/lighthouse-types.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/ada-audit/lighthouse-types.ts
//
// Stable subset of the Lighthouse report shape that the rest of the app cares
// about. Stored as a JSON string on AdaAudit.lighthouseSummary.

export type CwvStatus = 'pass' | 'needs-improvement' | 'fail'

export type LighthouseCategory = 'performance' | 'accessibility' | 'best-practices'

export interface LighthouseScores {
  performance: number       // 0–100
  accessibility: number     // 0–100
  bestPractices: number     // 0–100
}

export interface LighthouseCwv {
  lcp: number               // ms
  cls: number               // unitless
  tbt: number               // ms
  lcpStatus: CwvStatus
  clsStatus: CwvStatus
  tbtStatus: CwvStatus
}

export interface LighthouseFailure {
  id: string                // e.g. 'render-blocking-resources'
  title: string
  score: number | null      // 0–1 in raw LH; we copy as-is
  displayValue?: string
  category: LighthouseCategory
}

export interface LighthouseSummary {
  scores: LighthouseScores
  cwv: LighthouseCwv
  topFailures: LighthouseFailure[]  // up to 5
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ada-audit/lighthouse-types.ts
git commit -m "feat(ada-audit): lighthouse summary types"
```

---

### Task 6: Lighthouse storage helper

**Files:**
- Create: `lib/ada-audit/lighthouse-storage.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/ada-audit/lighthouse-storage.ts
import { promises as fs } from 'fs'
import path from 'path'
import zlib from 'zlib'
import { promisify } from 'util'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

export const LIGHTHOUSE_REPORTS_DIR =
  process.env.LIGHTHOUSE_REPORTS_DIR
  ?? path.join(process.cwd(), 'lighthouse-reports')

function reportPath(auditId: string): string {
  return path.join(LIGHTHOUSE_REPORTS_DIR, `${auditId}.json.gz`)
}

/** Write a Lighthouse report as gzipped JSON. Creates the directory if needed. */
export async function writeLighthouseReport(
  auditId: string,
  report: unknown,
): Promise<void> {
  await fs.mkdir(LIGHTHOUSE_REPORTS_DIR, { recursive: true })
  const compressed = await gzip(Buffer.from(JSON.stringify(report)))
  await fs.writeFile(reportPath(auditId), compressed)
}

/** Read and gunzip a stored Lighthouse report. Returns null if not present. */
export async function readLighthouseReport(auditId: string): Promise<unknown | null> {
  try {
    const buf = await fs.readFile(reportPath(auditId))
    const json = await gunzip(buf)
    return JSON.parse(json.toString('utf-8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

/** Delete the stored gzipped report for an audit. No-op if absent. */
export async function deleteLighthouseReport(auditId: string): Promise<void> {
  await fs.rm(reportPath(auditId), { force: true }).catch(() => {})
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/lighthouse-storage.ts
git commit -m "feat(ada-audit): gzipped lighthouse report storage helpers"
```

---

### Task 7: Lighthouse runner — summary extraction (testable in isolation)

**Files:**
- Create: `lib/ada-audit/lighthouse-runner.ts`
- Create: `lib/ada-audit/lighthouse-runner.test.ts`

We TDD the summary extraction function (`extractSummary`) since it's pure. The actual Chrome-invoking `runLighthouse` is added in Task 8 and tested via integration smoke.

- [ ] **Step 1: Write the failing test `lighthouse-runner.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { extractSummary } from './lighthouse-runner'

const FAKE_LHR = {
  categories: {
    performance:        { score: 0.42, auditRefs: [{ id: 'lcp-audit' }, { id: 'render-blocking' }] },
    accessibility:      { score: 0.91, auditRefs: [{ id: 'color-contrast' }] },
    'best-practices':   { score: 0.83, auditRefs: [{ id: 'console-errors' }] },
  },
  audits: {
    'largest-contentful-paint': { numericValue: 3200, score: 0.5 },
    'cumulative-layout-shift':  { numericValue: 0.05, score: 0.95 },
    'total-blocking-time':      { numericValue: 220, score: 0.7 },
    'lcp-audit':                { id: 'lcp-audit', title: 'Largest Contentful Paint',  score: 0.5,  displayValue: '3.2 s' },
    'render-blocking':          { id: 'render-blocking', title: 'Render blocking',     score: 0.1,  displayValue: '900 ms' },
    'color-contrast':           { id: 'color-contrast',  title: 'Color contrast',      score: 0.6,  displayValue: '3 issues' },
    'console-errors':           { id: 'console-errors',  title: 'No console errors',   score: 1,    displayValue: '' },
  },
}

describe('extractSummary', () => {
  it('produces 0–100 scores from raw 0–1 category scores', () => {
    const s = extractSummary(FAKE_LHR)
    expect(s.scores.performance).toBe(42)
    expect(s.scores.accessibility).toBe(91)
    expect(s.scores.bestPractices).toBe(83)
  })

  it('extracts Core Web Vitals with pass/fail thresholds', () => {
    const s = extractSummary(FAKE_LHR)
    expect(s.cwv.lcp).toBe(3200)
    expect(s.cwv.lcpStatus).toBe('needs-improvement') // 2500 < 3200 <= 4000
    expect(s.cwv.cls).toBe(0.05)
    expect(s.cwv.clsStatus).toBe('pass')              // <= 0.1
    expect(s.cwv.tbt).toBe(220)
    expect(s.cwv.tbtStatus).toBe('needs-improvement') // 200 < 220 <= 600
  })

  it('returns up to 5 failing audits across categories sorted by score ascending', () => {
    const s = extractSummary(FAKE_LHR)
    // Failing = score !== null && score < 0.9
    // From the fixture: render-blocking (0.1), color-contrast (0.6), lcp-audit (0.5)
    // = 3 failures; console-errors (1) is a pass and excluded
    expect(s.topFailures).toHaveLength(3)
    expect(s.topFailures[0].id).toBe('render-blocking')   // worst score first
    expect(s.topFailures[1].id).toBe('lcp-audit')
    expect(s.topFailures[2].id).toBe('color-contrast')
    expect(s.topFailures[0].category).toBe('performance')
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npm test -- lighthouse-runner
```

Expected: FAIL with "Cannot find module './lighthouse-runner'" or similar.

- [ ] **Step 3: Implement `lib/ada-audit/lighthouse-runner.ts` (extractSummary only for now)**

```ts
// lib/ada-audit/lighthouse-runner.ts
import type {
  LighthouseSummary,
  LighthouseFailure,
  LighthouseCategory,
  CwvStatus,
} from './lighthouse-types'

// Per https://web.dev/lcp, https://web.dev/cls, https://web.dev/tbt
function lcpStatus(ms: number): CwvStatus {
  if (ms <= 2500) return 'pass'
  if (ms <= 4000) return 'needs-improvement'
  return 'fail'
}
function clsStatus(v: number): CwvStatus {
  if (v <= 0.1) return 'pass'
  if (v <= 0.25) return 'needs-improvement'
  return 'fail'
}
function tbtStatus(ms: number): CwvStatus {
  if (ms <= 200) return 'pass'
  if (ms <= 600) return 'needs-improvement'
  return 'fail'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lhr = any

export function extractSummary(lhr: Lhr): LighthouseSummary {
  const cat = (key: LighthouseCategory) =>
    Math.round(((lhr.categories?.[key]?.score ?? 0) as number) * 100)

  const audit = (id: string) => lhr.audits?.[id]?.numericValue ?? 0

  const failures: LighthouseFailure[] = []
  for (const [catKey, category] of Object.entries(lhr.categories ?? {}) as [string, Lhr][]) {
    if (!['performance', 'accessibility', 'best-practices'].includes(catKey)) continue
    for (const ref of category.auditRefs ?? []) {
      const a = lhr.audits?.[ref.id]
      if (!a) continue
      const score = a.score
      if (score === null || score === undefined) continue
      if (score >= 0.9) continue
      failures.push({
        id: a.id ?? ref.id,
        title: a.title ?? ref.id,
        score,
        displayValue: a.displayValue,
        category: catKey as LighthouseCategory,
      })
    }
  }
  failures.sort((a, b) => (a.score ?? 1) - (b.score ?? 1))

  return {
    scores: {
      performance:   cat('performance'),
      accessibility: cat('accessibility'),
      bestPractices: cat('best-practices'),
    },
    cwv: {
      lcp: audit('largest-contentful-paint'),
      cls: audit('cumulative-layout-shift'),
      tbt: audit('total-blocking-time'),
      lcpStatus: lcpStatus(audit('largest-contentful-paint')),
      clsStatus: clsStatus(audit('cumulative-layout-shift')),
      tbtStatus: tbtStatus(audit('total-blocking-time')),
    },
    topFailures: failures.slice(0, 5),
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npm test -- lighthouse-runner
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/lighthouse-runner.ts lib/ada-audit/lighthouse-runner.test.ts
git commit -m "feat(ada-audit): lighthouse summary extraction with tests"
```

---

### Task 8: Lighthouse runner — Chrome integration

**Files:**
- Modify: `lib/ada-audit/lighthouse-runner.ts`

Add the function that actually runs Lighthouse against a puppeteer page. This is exercised end-to-end in Task 9.

- [ ] **Step 1: Append `runLighthouse` to `lib/ada-audit/lighthouse-runner.ts`**

Add at the bottom of the file (keep `extractSummary` and existing imports):

```ts
import type { Page } from 'puppeteer-core'
import { writeLighthouseReport } from './lighthouse-storage'

const LIGHTHOUSE_ENABLED = (process.env.LIGHTHOUSE_ENABLED ?? 'true') !== 'false'
const LIGHTHOUSE_TIMEOUT_MS = parseInt(process.env.LIGHTHOUSE_TIMEOUT_MS ?? '60000', 10)

export const isLighthouseEnabled = () => LIGHTHOUSE_ENABLED

export interface RunLighthouseResult {
  summary: LighthouseSummary | null
  error?: string
}

/**
 * Run Lighthouse against an existing puppeteer Page. Lighthouse owns the navigation
 * (page.goto is NOT called by us beforehand). After this returns, the page is loaded
 * to `url` but its CDP state (network throttling, CPU throttling, cache) has been
 * mutated — callers must reset before running other tools.
 */
export async function runLighthouse(
  url: string,
  auditId: string,
  page: Page,
): Promise<RunLighthouseResult> {
  if (!LIGHTHOUSE_ENABLED) return { summary: null }

  let lighthouse: typeof import('lighthouse').default
  try {
    lighthouse = (await import('lighthouse')).default
  } catch (e) {
    return { summary: null, error: `lighthouse import failed: ${(e as Error).message}` }
  }

  const browser = page.browser()
  // puppeteer-core uses CDP; lighthouse v11+ accepts a puppeteer-core Page directly
  // via the `page` option in `lighthouse(url, flags, config, page)`. The 4-arg form
  // tells LH to attach to our existing browser instead of launching its own.
  try {
    const result = await Promise.race([
      lighthouse(url, {
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices'],
        formFactor: 'desktop',
        screenEmulation: {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1,
          disabled: true,
        },
        // Connect to the running browser; no port flag needed when passing `page`.
      }, undefined, page),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Lighthouse timed out after ${LIGHTHOUSE_TIMEOUT_MS}ms`)), LIGHTHOUSE_TIMEOUT_MS),
      ),
    ])

    if (!result || !result.lhr) {
      return { summary: null, error: 'Lighthouse returned no report' }
    }

    const summary = extractSummary(result.lhr)
    await writeLighthouseReport(auditId, result.lhr)
    return { summary }
  } catch (e) {
    return { summary: null, error: (e as Error).message }
  }
}

/**
 * Reset CDP state that Lighthouse mutates so subsequent tools (axe) run under
 * default conditions, not LH's emulated slow network + 4x CPU throttle.
 */
export async function resetCdpAfterLighthouse(page: Page): Promise<void> {
  const client = await page.target().createCDPSession()
  try {
    await client.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    })
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await client.send('Network.setCacheDisabled', { cacheDisabled: false })
  } finally {
    await client.detach().catch(() => {})
  }
}

// (Browser is needed only for type-narrowing — re-export not required.)
```

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke test against a real page**

```bash
LIGHTHOUSE_ENABLED=true npx tsx -e "
import { acquirePage, releasePage, closeBrowser } from './lib/ada-audit/browser-pool'
import { runLighthouse, resetCdpAfterLighthouse } from './lib/ada-audit/lighthouse-runner'

;(async () => {
  const page = await acquirePage()
  try {
    const { summary, error } = await runLighthouse('https://example.com', 'smoke-test-1', page)
    if (error) console.error('ERROR:', error)
    else console.log(JSON.stringify(summary, null, 2))
    await resetCdpAfterLighthouse(page)
  } finally {
    await releasePage(page)
    await closeBrowser()
  }
})()
"
```

Expected: a JSON object with `scores`, `cwv`, `topFailures`. Three numeric scores 0–100. The Lighthouse JSON file at `lighthouse-reports/smoke-test-1.json.gz` exists.

Verify the gzip:
```bash
ls -la lighthouse-reports/smoke-test-1.json.gz && rm lighthouse-reports/smoke-test-1.json.gz
```

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/lighthouse-runner.ts
git commit -m "feat(ada-audit): lighthouse runner integrated with browser pool"
```

---

### Task 9: Download endpoint for Lighthouse JSON

**Files:**
- Create: `app/api/ada-audit/[id]/lighthouse-report/route.ts`

- [ ] **Step 1: Write the route**

```ts
// app/api/ada-audit/[id]/lighthouse-report/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { readLighthouseReport } from '@/lib/ada-audit/lighthouse-storage'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const report = await readLighthouseReport(id)
  if (!report) {
    return NextResponse.json({ error: 'No Lighthouse report for this audit' }, { status: 404 })
  }
  return new NextResponse(JSON.stringify(report), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="lighthouse-${id}.json"`,
    },
  })
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/ada-audit/[id]/lighthouse-report/route.ts
git commit -m "feat(ada-audit): download endpoint for stored lighthouse JSON"
```

---

## Phase 4: PDF discovery and scanning

### Task 10: PDF discovery — URL harvest and normalization

**Files:**
- Create: `lib/ada-audit/pdf-types.ts`
- Create: `lib/ada-audit/pdf-discovery.ts`
- Create: `lib/ada-audit/pdf-discovery.test.ts`

- [ ] **Step 1: Write `pdf-types.ts`**

```ts
// lib/ada-audit/pdf-types.ts
export type PdfIssueSeverity = 'high' | 'medium' | 'low'

export type PdfIssueCode =
  | 'not-tagged'
  | 'no-title'
  | 'no-language'
  | 'image-only'
  | 'at-restricted'
  | 'large-file'
  | 'many-pages'

export interface PdfIssue {
  code: PdfIssueCode
  severity: PdfIssueSeverity
  title: string
  description: string
  remediation: string
}

export interface PdfScanResult {
  url: string                 // normalized
  fileSize: number | null
  pageCount: number | null
  issues: PdfIssue[]
  scanError?: string
}
```

- [ ] **Step 2: Write the failing test `pdf-discovery.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { normalizePdfUrl, dedupePdfUrls } from './pdf-discovery'

describe('normalizePdfUrl', () => {
  it('strips query string and fragment', () => {
    expect(normalizePdfUrl('https://Example.com/doc.pdf?utm=email#page=4'))
      .toBe('https://example.com/doc.pdf')
  })

  it('lowercases host but preserves path case', () => {
    expect(normalizePdfUrl('HTTPS://EXAMPLE.COM/Docs/Foo.pdf'))
      .toBe('https://example.com/Docs/Foo.pdf')
  })

  it('resolves relative URLs against a base', () => {
    expect(normalizePdfUrl('/files/x.pdf', 'https://example.com/about'))
      .toBe('https://example.com/files/x.pdf')
  })

  it('returns null for non-pdf URLs', () => {
    expect(normalizePdfUrl('https://example.com/index.html')).toBeNull()
  })

  it('returns null for invalid URLs', () => {
    expect(normalizePdfUrl('not a url')).toBeNull()
  })
})

describe('dedupePdfUrls', () => {
  it('removes duplicates and normalizes', () => {
    const out = dedupePdfUrls([
      'https://example.com/a.pdf?v=1',
      'https://example.com/a.pdf',
      'https://example.com/b.pdf',
      'https://EXAMPLE.com/A.pdf',  // path case preserved → /A.pdf is different
    ])
    expect(out.sort()).toEqual([
      'https://example.com/A.pdf',
      'https://example.com/a.pdf',
      'https://example.com/b.pdf',
    ])
  })
})
```

- [ ] **Step 3: Run, verify fail**

```bash
npm test -- pdf-discovery
```

Expected: FAIL (module not found).

- [ ] **Step 4: Implement `lib/ada-audit/pdf-discovery.ts`**

```ts
// lib/ada-audit/pdf-discovery.ts
import type { Page } from 'puppeteer-core'

/**
 * Normalize a PDF URL for dedup. Returns null if the URL doesn't point at a .pdf
 * or can't be parsed.
 *
 * - Resolves relative URLs against `base` if provided.
 * - Strips query string and fragment.
 * - Lowercases the host. Preserves path case (case-sensitive on most servers).
 */
export function normalizePdfUrl(raw: string, base?: string): string | null {
  let u: URL
  try {
    u = base ? new URL(raw, base) : new URL(raw)
  } catch {
    return null
  }
  if (!u.pathname.toLowerCase().endsWith('.pdf')) return null
  u.search = ''
  u.hash = ''
  u.hostname = u.hostname.toLowerCase()
  u.protocol = u.protocol.toLowerCase()
  return u.toString()
}

/** Normalize + dedup a list of raw URLs. Order not preserved. */
export function dedupePdfUrls(raws: string[], base?: string): string[] {
  const set = new Set<string>()
  for (const r of raws) {
    const n = normalizePdfUrl(r, base)
    if (n) set.add(n)
  }
  return Array.from(set)
}

/**
 * Harvest all same-domain PDF links from the currently loaded page.
 * Uses page.evaluate to read every <a href> in the DOM, then filters server-side
 * to same-domain pdfs after normalization.
 */
export async function harvestPdfLinks(
  page: Page,
  audittedDomain: string,
): Promise<string[]> {
  const hrefs: string[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter(Boolean),
  )
  const base = page.url()
  const sameDomain = audittedDomain.toLowerCase()
  return dedupePdfUrls(hrefs, base).filter((u) => {
    try {
      return new URL(u).hostname.toLowerCase() === sameDomain
    } catch {
      return false
    }
  })
}
```

- [ ] **Step 5: Run, verify pass**

```bash
npm test -- pdf-discovery
```

Expected: PASS, 7 tests (5 normalize + 2 dedupe — adjust counts if needed).

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/pdf-types.ts lib/ada-audit/pdf-discovery.ts lib/ada-audit/pdf-discovery.test.ts
git commit -m "feat(ada-audit): pdf discovery + url normalization with tests"
```

---

### Task 11: PDF runner — issue detection

**Files:**
- Create: `lib/ada-audit/pdf-runner.ts`
- Create: `lib/ada-audit/pdf-runner.test.ts`
- Create: `lib/ada-audit/__fixtures__/tagged.pdf`, `untagged.pdf`, `image-only.pdf`, `no-title.pdf`

Fixture PDFs: you do not need to create these by hand. Many small public-domain test PDFs exist; for this plan, generate them with a small helper script at the start of the task.

- [ ] **Step 1: Generate test fixtures with `pdf-lib`**

Install dev dep:
```bash
npm install --save-dev pdf-lib
```

Run a one-shot generator (do not commit this script — it just makes the fixtures):
```bash
mkdir -p lib/ada-audit/__fixtures__
npx tsx -e "
import { PDFDocument } from 'pdf-lib'
import { writeFile } from 'fs/promises'

async function gen() {
  // Untagged, no title, no lang, has text
  const a = await PDFDocument.create()
  a.addPage([300, 200]).drawText('hello')
  await writeFile('lib/ada-audit/__fixtures__/untagged.pdf', await a.save())

  // With title metadata
  const b = await PDFDocument.create()
  b.setTitle('Sample Document')
  b.setLanguage('en')
  b.addPage([300, 200]).drawText('with metadata')
  await writeFile('lib/ada-audit/__fixtures__/titled.pdf', await b.save())

  // Image-only: page with no text drawing
  const c = await PDFDocument.create()
  c.addPage([300, 200])
  await writeFile('lib/ada-audit/__fixtures__/image-only.pdf', await c.save())
}
gen()
"
```

Verify:
```bash
ls -la lib/ada-audit/__fixtures__/
```

Expected: three .pdf files, all small (<10 KB each).

- [ ] **Step 2: Write the failing test `pdf-runner.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { scanPdfBuffer } from './pdf-runner'

const FIX = (name: string) => path.join(__dirname, '__fixtures__', name)
const load = async (name: string) => fs.readFile(FIX(name))

describe('scanPdfBuffer', () => {
  it('flags an untagged PDF as not-tagged', async () => {
    const r = await scanPdfBuffer(await load('untagged.pdf'), 'https://x/u.pdf')
    expect(r.issues.map((i) => i.code)).toContain('not-tagged')
  })

  it('flags missing title metadata', async () => {
    const r = await scanPdfBuffer(await load('untagged.pdf'), 'https://x/u.pdf')
    expect(r.issues.map((i) => i.code)).toContain('no-title')
  })

  it('does not flag no-title when title is present', async () => {
    const r = await scanPdfBuffer(await load('titled.pdf'), 'https://x/t.pdf')
    expect(r.issues.map((i) => i.code)).not.toContain('no-title')
  })

  it('flags image-only when page has no extractable text', async () => {
    const r = await scanPdfBuffer(await load('image-only.pdf'), 'https://x/i.pdf')
    expect(r.issues.map((i) => i.code)).toContain('image-only')
  })

  it('reports pageCount', async () => {
    const r = await scanPdfBuffer(await load('untagged.pdf'), 'https://x/u.pdf')
    expect(r.pageCount).toBe(1)
  })
})
```

- [ ] **Step 3: Run, verify fail**

```bash
npm test -- pdf-runner
```

Expected: FAIL.

- [ ] **Step 4: Implement `lib/ada-audit/pdf-runner.ts`**

```ts
// lib/ada-audit/pdf-runner.ts
//
// Lightweight PDF accessibility scanner. Uses pdfjs-dist (Node legacy build)
// to inspect metadata, structure tree, and extractable text. No Chrome, no
// veraPDF — fast and pure-Node.

import type { PdfIssue, PdfScanResult } from './pdf-types'

const LARGE_FILE_BYTES = 10 * 1024 * 1024
const MANY_PAGES = 50

const ISSUE_TEMPLATES: Record<PdfIssue['code'], Omit<PdfIssue, 'code'>> = {
  'not-tagged': {
    severity: 'high',
    title: 'Not tagged for screen readers',
    description: 'PDF lacks a structure tree, so assistive technology reads content in random order.',
    remediation: 'Re-export from source with "Tagged PDF" enabled, or open in Acrobat Pro → Prepare for Accessibility.',
  },
  'no-title': {
    severity: 'medium',
    title: 'No document title set',
    description: 'Title metadata is empty, so screen readers announce the filename instead of a meaningful title.',
    remediation: 'In Acrobat, File → Properties → Description → set Title. Also enable "Display title bar" in Initial View.',
  },
  'no-language': {
    severity: 'medium',
    title: 'No language declared',
    description: 'Document language metadata is missing, so screen readers cannot select the correct voice/pronunciation.',
    remediation: 'In Acrobat, File → Properties → Advanced → set Language. For multilingual PDFs, set per-section language in the structure tree.',
  },
  'image-only': {
    severity: 'high',
    title: 'No extractable text — appears to be a scanned image',
    description: 'Screen readers cannot read images of text. The PDF contains no real text layer.',
    remediation: 'Run OCR (Acrobat Pro → Recognize Text) to add a real text layer, then verify reading order.',
  },
  'at-restricted': {
    severity: 'high',
    title: 'Encrypted with assistive technology access restricted',
    description: 'PDF security settings block screen readers from extracting content.',
    remediation: 'In Acrobat → Properties → Security, change to "No Security" or enable "Allow text access for screen readers".',
  },
  'large-file': {
    severity: 'low',
    title: 'Large file (over 10 MB)',
    description: 'Large PDFs are slow to download and can time out on mobile.',
    remediation: 'Compress images, split into multiple smaller PDFs, or offer an HTML alternative.',
  },
  'many-pages': {
    severity: 'low',
    title: 'Over 50 pages',
    description: 'Long PDFs are hard to navigate with a screen reader.',
    remediation: 'Consider offering an HTML version of the content, or splitting into chapter-sized files.',
  },
}

function make(code: PdfIssue['code']): PdfIssue {
  return { code, ...ISSUE_TEMPLATES[code] }
}

export async function scanPdfBuffer(buf: Buffer, normalizedUrl: string): Promise<PdfScanResult> {
  // pdfjs-dist v4+ legacy build is the Node-compatible one
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // Disable worker (we're in Node)
  pdfjs.GlobalWorkerOptions.workerSrc = ''

  const data = new Uint8Array(buf)
  const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise

  const issues: PdfIssue[] = []
  const fileSize = buf.byteLength
  const pageCount = doc.numPages

  // Structure tree
  let hasStructTree = false
  try {
    const tree = await doc.getStructTree?.()
    hasStructTree = !!tree
  } catch { /* not tagged */ }
  if (!hasStructTree) issues.push(make('not-tagged'))

  // Metadata
  const meta = await doc.getMetadata().catch(() => null)
  const info = meta?.info ?? {}
  if (!info.Title || String(info.Title).trim() === '') issues.push(make('no-title'))
  if (!info.Language && !info.Lang) issues.push(make('no-language'))

  // Text extraction across all pages
  let totalChars = 0
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    totalChars += (tc.items ?? []).reduce((n: number, it: { str?: string }) => n + (it.str?.length ?? 0), 0)
    if (totalChars > 0) break
  }
  if (totalChars === 0) issues.push(make('image-only'))

  // Encryption — pdfjs throws on AT-restricted PDFs at getDocument time;
  // if we got here, content is accessible. We still surface the flag if present.
  // (We don't check raw bytes for this v1; the threshold is low enough.)

  if (fileSize > LARGE_FILE_BYTES) issues.push(make('large-file'))
  if (pageCount > MANY_PAGES) issues.push(make('many-pages'))

  return { url: normalizedUrl, fileSize, pageCount, issues }
}

/** Fetch + scan. Wraps scanPdfBuffer with HTTP fetch and error capture. */
export async function scanPdfUrl(url: string): Promise<PdfScanResult> {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) {
      return { url, fileSize: null, pageCount: null, issues: [], scanError: `HTTP ${res.status}` }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return await scanPdfBuffer(buf, url)
  } catch (e) {
    return { url, fileSize: null, pageCount: null, issues: [], scanError: (e as Error).message }
  }
}
```

- [ ] **Step 5: Run, verify pass**

```bash
npm test -- pdf-runner
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/pdf-runner.ts lib/ada-audit/pdf-runner.test.ts lib/ada-audit/__fixtures__/ package.json package-lock.json
git commit -m "feat(ada-audit): pdf scanner with lightweight a11y checks"
```

---

### Task 12: PDF worker pool

**Files:**
- Create: `lib/ada-audit/pdf-worker-pool.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/ada-audit/pdf-worker-pool.ts
//
// Concurrency limiter for PDF scans. Lives outside the browser pool because
// pdfjs is pure Node — no Chrome cost.

const POOL_SIZE = parseInt(process.env.PDF_POOL_SIZE ?? '4', 10)

let slots = POOL_SIZE
const waitQueue: Array<() => void> = []

async function acquire(): Promise<void> {
  if (slots > 0) { slots--; return }
  await new Promise<void>((resolve) => waitQueue.push(resolve))
}

function release(): void {
  const next = waitQueue.shift()
  if (next) next()
  else slots++
}

/** Run `fn` once a PDF slot is available. Returns whatever fn returns. */
export async function withPdfSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/pdf-worker-pool.ts
git commit -m "feat(ada-audit): pdf worker pool concurrency limiter"
```

---

### Task 13: Wire single-nav flow + PDF dispatch into the runner

**Files:**
- Modify: `lib/ada-audit/runner.ts`
- Modify: `lib/ada-audit/queue-manager.ts` (PDF dispatch on completion of per-page audit)
- Create: `lib/ada-audit/pdf-orchestrator.ts` (handles dedup + DB writes for harvested URLs)

This is the largest task in the plan — the integration point for Lighthouse, axe, PDF discovery, and PDF scanning. Read the spec section "Data flow per page" before implementing.

- [ ] **Step 1: Create `lib/ada-audit/pdf-orchestrator.ts`**

```ts
// lib/ada-audit/pdf-orchestrator.ts
//
// Takes harvested PDF URLs from a page, dedupes against existing PdfAudit
// rows for this audit, inserts pending rows, and dispatches scans through
// the PDF worker pool. Updates SiteAudit pdf counters as scans settle.

import { prisma } from '@/lib/db'
import { withPdfSlot } from './pdf-worker-pool'
import { scanPdfUrl } from './pdf-runner'

interface DispatchArgs {
  urls: string[]              // already normalized + same-domain filtered
  siteAuditId?: string
  adaAuditId?: string         // for standalone single-page audits
}

export async function dispatchPdfScans({ urls, siteAuditId, adaAuditId }: DispatchArgs): Promise<void> {
  if (!siteAuditId && !adaAuditId) throw new Error('pdf-orchestrator: need siteAuditId or adaAuditId')
  if (urls.length === 0) return

  // Dedup against existing rows for this audit
  const existing = await prisma.pdfAudit.findMany({
    where: siteAuditId ? { siteAuditId, url: { in: urls } } : { adaAuditId, url: { in: urls } },
    select: { url: true },
  })
  const known = new Set(existing.map((r) => r.url))
  const fresh = urls.filter((u) => !known.has(u))
  if (fresh.length === 0) return

  // Insert pending rows (atomic across this audit)
  await prisma.$transaction(async (tx) => {
    for (const url of fresh) {
      await tx.pdfAudit.create({
        data: { siteAuditId, adaAuditId, url, status: 'pending' },
      })
    }
    if (siteAuditId) {
      await tx.siteAudit.update({
        where: { id: siteAuditId },
        data: { pdfsTotal: { increment: fresh.length } },
      })
    }
  })

  // Fire scans through the pool — do NOT await here; let caller decide.
  for (const url of fresh) {
    void withPdfSlot(async () => {
      try {
        await prisma.pdfAudit.updateMany({
          where: { url, ...(siteAuditId ? { siteAuditId } : { adaAuditId }) },
          data: { status: 'scanning' },
        })
        const result = await scanPdfUrl(url)
        const matches = await prisma.pdfAudit.updateMany({
          where: { url, ...(siteAuditId ? { siteAuditId } : { adaAuditId }) },
          data: {
            fileSize: result.fileSize,
            pageCount: result.pageCount,
            issues: JSON.stringify(result.issues),
            status: result.scanError ? 'error' : 'complete',
            scanError: result.scanError,
          },
        })
        if (siteAuditId && matches.count > 0) {
          await prisma.siteAudit.update({
            where: { id: siteAuditId },
            data: result.scanError
              ? { pdfsError: { increment: 1 } }
              : { pdfsComplete: { increment: 1 } },
          })
        }
      } catch (e) {
        // Last-resort: don't leave row in 'scanning' forever
        await prisma.pdfAudit.updateMany({
          where: { url, ...(siteAuditId ? { siteAuditId } : { adaAuditId }) },
          data: { status: 'error', scanError: (e as Error).message },
        }).catch(() => {})
        if (siteAuditId) {
          await prisma.siteAudit.update({
            where: { id: siteAuditId },
            data: { pdfsError: { increment: 1 } },
          }).catch(() => {})
        }
      }
    })
  }
}
```

- [ ] **Step 2: Update `lib/ada-audit/runner.ts` to use the single-nav flow**

Modify `runAxeAudit` so that, when called, it:
1. Optionally runs Lighthouse first (which performs the navigation).
2. Resets CDP state.
3. Runs axe on the loaded page.
4. Harvests PDF links from the same DOM.
5. Returns axe result + lighthouse summary/error + harvested PDFs.

Replace `runAxeAudit`'s signature and body. The full file becomes:

```ts
import { promises as dns } from 'dns'
import path from 'path'
import { acquirePage, releasePage } from './browser-pool'
import { captureViolationScreenshots } from './screenshot-helpers'
import { runLighthouse, resetCdpAfterLighthouse, isLighthouseEnabled } from './lighthouse-runner'
import { harvestPdfLinks } from './pdf-discovery'
import type { StoredAxeResults } from './types'
import type { LighthouseSummary } from './lighthouse-types'

const AXE_PATH = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js')

const PRIVATE_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^::1$/, /^fc[0-9a-f]{2}:/i, /^fd[0-9a-f]{2}:/i,
  /^fe80:/i, /^0\.0\.0\.0$/,
]

export async function assertNotPrivate(hostname: string) {
  let address: string
  try {
    const result = await dns.lookup(hostname)
    address = result.address
  } catch {
    throw new Error(`Could not resolve hostname: ${hostname}`)
  }
  for (const range of PRIVATE_RANGES) {
    if (range.test(address)) throw new Error('Requests to private/internal addresses are not allowed')
  }
}

export type ProgressCallback = (progress: number, message: string) => Promise<void>

export interface RunAxeOptions {
  captureScreenshots?: boolean
  screenshotDir?: string
  auditId: string             // REQUIRED — used for the lighthouse-reports filename
}

export interface RunAxeResult {
  axe: StoredAxeResults
  lighthouseSummary: LighthouseSummary | null
  lighthouseError: string | null
  harvestedPdfUrls: string[]  // normalized + same-domain
}

export async function runAxeAudit(
  targetUrl: string,
  wcagLevel: string = 'wcag21aa',
  onProgress?: ProgressCallback,
  options?: RunAxeOptions,
): Promise<RunAxeResult> {
  const progress = onProgress ?? (async () => {})
  if (!options?.auditId) throw new Error('runAxeAudit: options.auditId is required')

  const parsed = new URL(targetUrl)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http/https URLs are allowed')

  await progress(5, 'Verifying URL…')
  await assertNotPrivate(parsed.hostname)

  await progress(10, 'Launching browser…')
  const page = await acquirePage()

  let lighthouseSummary: LighthouseSummary | null = null
  let lighthouseError: string | null = null
  let harvestedPdfUrls: string[] = []

  try {
    if (isLighthouseEnabled()) {
      await progress(20, 'Running Lighthouse…')
      const lh = await runLighthouse(targetUrl, options.auditId, page)
      lighthouseSummary = lh.summary
      lighthouseError = lh.error ?? null
      await resetCdpAfterLighthouse(page)
    } else {
      await progress(20, 'Loading page…')
      const response = await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30_000 })
      if (!response) throw new Error('No response received from page')
      const status = response.status()
      if (status === 304) throw new Error('HTTP 304 Not Modified — cached response received; re-run to get a fresh scan')
      if (!response.ok()) {
        if (status === 403) throw new Error('HTTP 403 — This site is blocking automated scanners. Try adding your server IP to the site\'s allowlist, or contact the site owner.')
        if (status === 401) throw new Error('HTTP 401 — This page requires authentication. The scanner cannot access password-protected pages.')
        throw new Error(`HTTP ${status} — ${response.statusText()}`)
      }
      const contentType = response.headers()['content-type'] ?? ''
      if (!contentType.includes('html')) throw new Error(`Response is not HTML (Content-Type: ${contentType})`)
    }

    await progress(75, 'Analyzing page…')
    const domElementCount = await page.evaluate(() => document.querySelectorAll('*').length)

    await progress(82, 'Running accessibility checks…')
    await page.addScriptTag({ path: AXE_PATH })

    const wcagTags = wcagLevel === 'wcag22aa'
      ? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
      : ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawResults: any = await page.evaluate(async (opts: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (window as any).axe.run(document, opts)
    }, {
      runOnly: { type: 'tag', values: wcagTags },
      resultTypes: ['violations', 'incomplete'],
      reporter: 'no-passes',
    })

    // Screenshots (existing behavior)
    if (options?.captureScreenshots && options.screenshotDir) {
      await captureViolationScreenshots(page, rawResults.violations ?? [], options.screenshotDir)
    }

    // PDF harvest from same DOM
    await progress(95, 'Harvesting linked PDFs…')
    try {
      harvestedPdfUrls = await harvestPdfLinks(page, parsed.hostname.toLowerCase())
    } catch (e) {
      // PDF harvest failure should not fail the audit
      console.warn('[ada-audit] PDF harvest failed:', (e as Error).message)
      harvestedPdfUrls = []
    }

    const axe: StoredAxeResults = {
      ...rawResults,
      domElementCount,
      captureScreenshots: options?.captureScreenshots ?? false,
    }
    return { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls }
  } finally {
    await releasePage(page)
  }
}
```

- [ ] **Step 3: Update `lib/ada-audit/queue-manager.ts` to call `dispatchPdfScans` after each page audit**

Find where `runAxeAudit` is called inside the per-page worker and rewrite the post-call block. Specifically: pass `options.auditId`, persist `lighthouseSummary`/`lighthouseError`, and dispatch PDFs.

Read the file to locate the call site, then change the block from:

```ts
const result = await runAxeAudit(url, wcagLevel, onProgress, { captureScreenshots, screenshotDir })
await prisma.adaAudit.update({
  where: { id: pageAuditId },
  data: { status: 'complete', result: JSON.stringify(result) },
})
```

To:

```ts
const { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls } = await runAxeAudit(
  url, wcagLevel, onProgress, { captureScreenshots, screenshotDir, auditId: pageAuditId },
)
await prisma.adaAudit.update({
  where: { id: pageAuditId },
  data: {
    status: 'complete',
    result: JSON.stringify(axe),
    lighthouseSummary: lighthouseSummary ? JSON.stringify(lighthouseSummary) : null,
    lighthouseError,
  },
})

// PDF dispatch — fire-and-forget; updates SiteAudit counters as scans settle
const { dispatchPdfScans } = await import('./pdf-orchestrator')
void dispatchPdfScans({
  urls: harvestedPdfUrls,
  siteAuditId: siteAuditId ?? undefined,
  adaAuditId: siteAuditId ? undefined : pageAuditId,
})
```

(Adjust variable names — `pageAuditId`, `url`, `siteAuditId` — to match what's actually in `queue-manager.ts` after you read it.)

- [ ] **Step 4: Update completion-check in queue-manager so SiteAudit only flips to 'complete' when PDFs are also done**

Find the existing completion condition (likely `pagesComplete + pagesError === pagesTotal`) and extend it:

```ts
const isFullyDone =
  audit.pagesComplete + audit.pagesError === audit.pagesTotal
  && audit.pdfsComplete + audit.pdfsError === audit.pdfsTotal
```

Use this in place of the original page-only check when deciding whether to flip status to `complete`. **Also** ensure the per-PDF completion path in `pdf-orchestrator.ts` triggers a re-check — add this at the end of `dispatchPdfScans`'s per-scan callback, after the SiteAudit counter increment:

```ts
// Re-check whether the parent SiteAudit is now fully done
if (siteAuditId) {
  const fresh = await prisma.siteAudit.findUnique({ where: { id: siteAuditId } })
  if (fresh && fresh.status === 'running'
      && fresh.pagesComplete + fresh.pagesError === fresh.pagesTotal
      && fresh.pdfsComplete + fresh.pdfsError === fresh.pdfsTotal) {
    await prisma.siteAudit.update({
      where: { id: siteAuditId },
      data: { status: 'complete', progressMessage: 'Complete' },
    })
  }
}
```

Wrap that re-check in the same try/catch so a single failure doesn't break the chain.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Smoke test full pipeline locally on a small live site**

```bash
npm run dev &
sleep 5
curl -X POST http://localhost:3000/api/site-audit \
  -H 'Content-Type: application/json' \
  -d '{"domain": "example.com", "wcagLevel": "wcag21aa"}'
# Watch logs; in another shell:
sqlite3 prisma/local-dev.db "SELECT id, status, pagesTotal, pagesComplete, pdfsTotal, pdfsComplete FROM SiteAudit ORDER BY createdAt DESC LIMIT 1;"
kill %1
```

Expected: audit row created. After a few minutes, status → `complete`, with `pagesComplete = pagesTotal` and (if example.com had any PDFs) `pdfsComplete + pdfsError = pdfsTotal`.

- [ ] **Step 7: Commit**

```bash
git add lib/ada-audit/pdf-orchestrator.ts lib/ada-audit/runner.ts lib/ada-audit/queue-manager.ts
git commit -m "feat(ada-audit): single-nav flow with lighthouse + pdf dispatch"
```

---

## Phase 5: Cleanup

### Task 14: Wire deleteLighthouseReport into single-page DELETE

**Files:**
- Modify: `app/api/ada-audit/[id]/route.ts`

- [ ] **Step 1: Add the import and call**

In `app/api/ada-audit/[id]/route.ts`, find:

```ts
import { deleteScreenshots } from '@/lib/ada-audit/screenshot-helpers'
```

Add below:

```ts
import { deleteLighthouseReport } from '@/lib/ada-audit/lighthouse-storage'
```

Find:

```ts
await prisma.adaAudit.delete({ where: { id } })
await deleteScreenshots(id)
```

Change to:

```ts
await prisma.adaAudit.delete({ where: { id } })
await Promise.all([
  deleteScreenshots(id),
  deleteLighthouseReport(id),
])
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/api/ada-audit/[id]/route.ts
git commit -m "feat(ada-audit): clean up lighthouse report on single-page delete"
```

---

### Task 15: Fix site-audit DELETE to clean per-page artifacts

**Files:**
- Modify: `app/api/site-audit/[id]/route.ts`

The current `DELETE` only cascades the DB rows and leaves per-page screenshots orphaned. PR 1 fixes that and also cleans up child Lighthouse reports.

- [ ] **Step 1: Rewrite the DELETE handler**

In `app/api/site-audit/[id]/route.ts`, replace the existing `DELETE` function:

```ts
import { deleteScreenshots } from '@/lib/ada-audit/screenshot-helpers'
import { deleteLighthouseReport } from '@/lib/ada-audit/lighthouse-storage'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const existing = await prisma.siteAudit.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })

  // Gather child audit IDs so we can clean their on-disk artifacts
  const children = await prisma.adaAudit.findMany({
    where: { siteAuditId: id },
    select: { id: true },
  })

  // Cascade-delete DB rows first (atomic), then clean up files. If file
  // cleanup partially fails, the daily cleanExpired* sweeps will catch
  // the orphans.
  await prisma.siteAudit.delete({ where: { id } })

  await Promise.allSettled(
    children.flatMap(({ id: childId }) => [
      deleteScreenshots(childId),
      deleteLighthouseReport(childId),
    ]),
  )

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Manual smoke test**

```bash
# Create a fake completed site audit with one child screenshot dir
SCREENSHOTS_DIR_LOCAL=$(node -e "console.log(process.env.SCREENSHOTS_DIR || './screenshots')")
mkdir -p "$SCREENSHOTS_DIR_LOCAL/test-child-123"
echo "test" > "$SCREENSHOTS_DIR_LOCAL/test-child-123/violation.png"
# (Insert SiteAudit + child AdaAudit rows via sqlite3 if needed; skip if your dev DB already has data)
# After running DELETE, verify the directory is gone:
ls "$SCREENSHOTS_DIR_LOCAL/test-child-123" 2>&1
# Expected: "No such file or directory"
```

(If you don't have a convenient test row, this can be a manual UI test instead.)

- [ ] **Step 4: Commit**

```bash
git add app/api/site-audit/[id]/route.ts
git commit -m "fix(ada-audit): site-audit DELETE cleans up child screenshots + LH reports"
```

---

### Task 16: Daily cleanup task for expired Lighthouse reports

**Files:**
- Modify: `lib/cleanup.ts`

- [ ] **Step 1: Add `cleanExpiredLighthouseReports` and wire into `runCleanup`**

Edit `lib/cleanup.ts`. Add the import:

```ts
import { LIGHTHOUSE_REPORTS_DIR } from '@/lib/ada-audit/lighthouse-storage'
```

Add the function below `cleanExpiredScreenshots`:

```ts
/**
 * Delete gzipped Lighthouse reports for AdaAudit records older than 180 days,
 * and any orphaned report files with no matching audit row.
 */
async function cleanExpiredLighthouseReports(): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS);
  const entries = await fs.readdir(LIGHTHOUSE_REPORTS_DIR).catch(() => [] as string[]);

  for (const entry of entries) {
    if (!entry.endsWith('.json.gz')) continue;
    const auditId = entry.replace(/\.json\.gz$/, '');
    const audit = await prisma.adaAudit
      .findUnique({ where: { id: auditId }, select: { createdAt: true } })
      .catch(() => null);

    if (!audit || audit.createdAt < cutoff) {
      await fs.rm(path.join(LIGHTHOUSE_REPORTS_DIR, entry), { force: true }).catch(() => {});
    }
  }
}
```

Add to the `Promise.allSettled` array inside `runCleanup`:

```ts
export async function runCleanup(): Promise<void> {
  await Promise.allSettled([
    cleanOrphanUploads(),
    cleanExpiredSessions(),
    cleanExpiredShareLinks(),
    cleanExpiredScreenshots(),
    cleanExpiredLighthouseReports(),
  ]);
}
```

- [ ] **Step 2: Smoke test (manually trigger the cleanup)**

```bash
npx tsx -e "
import { runCleanup } from './lib/cleanup'
await runCleanup()
console.log('cleanup ok')
"
```

Expected: `cleanup ok`, no thrown errors.

- [ ] **Step 3: Commit**

```bash
git add lib/cleanup.ts
git commit -m "feat(ada-audit): daily cleanup of expired lighthouse reports"
```

---

## Phase 6: UI surfacing (minimal)

These components are intentionally simple — PR 2 does the bigger overhaul. PR 1 just makes the new data visible.

### Task 17: Shared Lighthouse section component

**Files:**
- Create: `components/ada-audit/LighthouseSection.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import type { LighthouseSummary, CwvStatus } from '@/lib/ada-audit/lighthouse-types'

function scoreColor(score: number): string {
  if (score >= 90) return 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-500/15'
  if (score >= 50) return 'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/15'
  return 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-500/15'
}

function cwvColor(status: CwvStatus): string {
  if (status === 'pass') return 'text-green-700 dark:text-green-400'
  if (status === 'needs-improvement') return 'text-amber-700 dark:text-amber-400'
  return 'text-red-700 dark:text-red-400'
}

function fmtMs(v: number) { return `${Math.round(v)} ms` }
function fmtCls(v: number) { return v.toFixed(2) }

interface Props {
  summary: LighthouseSummary | null
  error?: string | null
  auditId: string
}

export default function LighthouseSection({ summary, error, auditId }: Props) {
  if (!summary && !error) return null

  if (error && !summary) {
    return (
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl p-6">
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white mb-2">Lighthouse</h2>
        <p className="text-[13px] text-amber-700 dark:text-amber-400">Lighthouse failed: {error}</p>
      </div>
    )
  }

  const s = summary!
  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">Lighthouse</h2>
        <a
          href={`/api/ada-audit/${auditId}/lighthouse-report`}
          className="text-[12px] text-orange hover:underline"
        >
          Download full report
        </a>
      </div>

      {/* Scores */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Performance', value: s.scores.performance },
          { label: 'Accessibility', value: s.scores.accessibility },
          { label: 'Best Practices', value: s.scores.bestPractices },
        ].map((c) => (
          <div key={c.label} className={`rounded-xl p-4 text-center ${scoreColor(c.value)}`}>
            <div className="font-display font-bold text-2xl">{c.value}</div>
            <div className="text-[11px] uppercase tracking-wider font-body">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Core Web Vitals */}
      <div className="grid grid-cols-3 gap-3 text-[13px] font-body">
        <div><span className="text-navy/50 dark:text-white/50">LCP </span><span className={cwvColor(s.cwv.lcpStatus)}>{fmtMs(s.cwv.lcp)}</span></div>
        <div><span className="text-navy/50 dark:text-white/50">CLS </span><span className={cwvColor(s.cwv.clsStatus)}>{fmtCls(s.cwv.cls)}</span></div>
        <div><span className="text-navy/50 dark:text-white/50">TBT </span><span className={cwvColor(s.cwv.tbtStatus)}>{fmtMs(s.cwv.tbt)}</span></div>
      </div>

      {/* Top failures */}
      {s.topFailures.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider font-body text-navy/50 dark:text-white/50 mb-2">Top failing audits</div>
          <ul className="space-y-1">
            {s.topFailures.map((f) => (
              <li key={f.id} className="text-[13px] font-body text-navy dark:text-white flex justify-between">
                <span>{f.title}</span>
                {f.displayValue && <span className="text-navy/50 dark:text-white/50">{f.displayValue}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/LighthouseSection.tsx
git commit -m "feat(ada-audit): lighthouse results UI section"
```

---

### Task 18: Shared PDF issues section component

**Files:**
- Create: `components/ada-audit/PdfIssuesSection.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useState } from 'react'
import type { PdfIssue } from '@/lib/ada-audit/pdf-types'

interface PdfRow {
  url: string
  fileSize: number | null
  pageCount: number | null
  issues: PdfIssue[]
  scanError?: string | null
}

function formatBytes(b: number | null): string {
  if (b == null) return '?'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function plainTextForPdf(pdf: PdfRow): string {
  const filename = pdf.url.split('/').pop() ?? pdf.url
  const head = `${filename} — ${pdf.url} (${formatBytes(pdf.fileSize)}, ${pdf.pageCount ?? '?'} pages)`
  if (pdf.scanError) return `${head}\n• Scan failed: ${pdf.scanError}`
  const lines = pdf.issues.map((i) => `• ${i.title} — ${i.description} Fix: ${i.remediation}`)
  return [head, ...lines].join('\n')
}

interface Props {
  pdfs: PdfRow[]
}

export default function PdfIssuesSection({ pdfs }: Props) {
  const [copied, setCopied] = useState<string | null>(null)
  if (pdfs.length === 0) return null

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  const totalIssues = pdfs.reduce((n, p) => n + p.issues.length, 0)
  const copyAll = pdfs.map(plainTextForPdf).join('\n\n')

  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">
          PDFs Found <span className="text-navy/40 dark:text-white/40 font-normal">({pdfs.length} files, {totalIssues} issues)</span>
        </h2>
        <button
          type="button"
          onClick={() => copy(copyAll, '__all')}
          className="text-[12px] font-body font-semibold text-orange hover:underline"
        >
          {copied === '__all' ? 'Copied!' : 'Copy all'}
        </button>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-navy-border">
        {pdfs.map((pdf) => {
          const filename = pdf.url.split('/').pop() ?? pdf.url
          const block = plainTextForPdf(pdf)
          return (
            <div key={pdf.url} className="px-6 py-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-body font-semibold text-[14px] text-navy dark:text-white truncate">{filename}</div>
                  <a href={pdf.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-navy/40 dark:text-white/40 hover:underline truncate block">{pdf.url}</a>
                </div>
                <button
                  type="button"
                  onClick={() => copy(block, pdf.url)}
                  className="text-[11px] font-body font-semibold text-orange hover:underline whitespace-nowrap"
                >
                  {copied === pdf.url ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="text-[11px] font-body text-navy/40 dark:text-white/40">
                {formatBytes(pdf.fileSize)} · {pdf.pageCount ?? '?'} pages
              </div>
              {pdf.scanError ? (
                <p className="text-[12px] text-red-600 dark:text-red-400">Scan failed: {pdf.scanError}</p>
              ) : (
                <ul className="space-y-1">
                  {pdf.issues.map((i, idx) => (
                    <li key={`${i.code}-${idx}`} className="text-[12px] font-body text-navy dark:text-white">
                      <span className="font-semibold">{i.title}</span> — <span className="text-navy/60 dark:text-white/60">{i.description}</span> <span className="text-navy/50 dark:text-white/50">Fix: {i.remediation}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/PdfIssuesSection.tsx
git commit -m "feat(ada-audit): pdf issues UI section with copy buttons"
```

---

### Task 19: Wire Lighthouse + PDF sections into result views

**Files:**
- Modify: `components/ada-audit/AuditResultsView.tsx`
- Modify: `components/ada-audit/SiteAuditResultsView.tsx`
- Modify: `app/api/ada-audit/[id]/route.ts` (include lighthouseSummary + PDFs in GET response)
- Modify: `app/api/site-audit/[id]/route.ts` (include PDFs in GET response)

- [ ] **Step 1: Update single-page audit GET to return new fields**

In `app/api/ada-audit/[id]/route.ts`, find the GET handler and the response it returns. Extend the SELECT to include the new fields and the PDFs:

```ts
const audit = await prisma.adaAudit.findUnique({
  where: { id },
  include: {
    pdfAudits: { select: { url: true, fileSize: true, pageCount: true, issues: true, scanError: true } },
  },
})
```

And in the response payload, add:

```ts
lighthouseSummary: audit.lighthouseSummary ? JSON.parse(audit.lighthouseSummary) : null,
lighthouseError: audit.lighthouseError ?? null,
pdfs: audit.pdfAudits.map((p) => ({
  url: p.url,
  fileSize: p.fileSize,
  pageCount: p.pageCount,
  issues: p.issues ? JSON.parse(p.issues) : [],
  scanError: p.scanError ?? null,
})),
```

- [ ] **Step 2: Update site-audit GET to return PDFs**

In `app/api/site-audit/[id]/route.ts`, in the existing GET handler, extend the `findUnique` to include `pdfAudits`:

```ts
const audit = await prisma.siteAudit.findUnique({
  where: { id },
  include: {
    client: { select: { name: true } },
    pdfAudits: { select: { url: true, fileSize: true, pageCount: true, issues: true, scanError: true } },
  },
})
```

And in the response, add:

```ts
pdfs: audit.pdfAudits.map((p) => ({
  url: p.url,
  fileSize: p.fileSize,
  pageCount: p.pageCount,
  issues: p.issues ? JSON.parse(p.issues) : [],
  scanError: p.scanError ?? null,
})),
pdfsTotal: audit.pdfsTotal,
pdfsComplete: audit.pdfsComplete,
pdfsError: audit.pdfsError,
```

- [ ] **Step 3: Render LighthouseSection + PdfIssuesSection in `AuditResultsView`**

Open `components/ada-audit/AuditResultsView.tsx` and find where the result content is rendered. Import the two new components at the top:

```tsx
import LighthouseSection from './LighthouseSection'
import PdfIssuesSection from './PdfIssuesSection'
```

Add the data destructure where the result is consumed:

```tsx
const lighthouseSummary = data.lighthouseSummary ?? null
const lighthouseError = data.lighthouseError ?? null
const pdfs = data.pdfs ?? []
```

Render between the scorecard and violations:

```tsx
<LighthouseSection summary={lighthouseSummary} error={lighthouseError} auditId={data.id} />
```

And below violations:

```tsx
<PdfIssuesSection pdfs={pdfs} />
```

(Adapt prop names — `data` may be called something else; read the file first.)

- [ ] **Step 4: Render PdfIssuesSection in `SiteAuditResultsView`**

Open `components/ada-audit/SiteAuditResultsView.tsx`. At the top of the result content (above the existing per-page list), insert:

```tsx
<PdfIssuesSection pdfs={data.pdfs ?? []} />
```

with appropriate prop wiring.

- [ ] **Step 5: Type-check + lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no errors.

- [ ] **Step 6: Browser smoke test**

```bash
npm run dev
```

Visit `/ada-audit`, run a single-page audit against `https://example.com`, wait for completion, verify:
1. Lighthouse section appears with three score rings, CWV row, top failures.
2. "Download full report" link works and returns a JSON file.
3. If example.com had any PDF links: PDF section appears below violations.

Run a small site audit (1–3 pages site you control) and verify the site detail page shows a "PDFs Found" section if PDFs were linked.

- [ ] **Step 7: Commit**

```bash
git add components/ada-audit/AuditResultsView.tsx components/ada-audit/SiteAuditResultsView.tsx app/api/ada-audit/[id]/route.ts app/api/site-audit/[id]/route.ts
git commit -m "feat(ada-audit): surface lighthouse + pdf results in audit views"
```

---

## Phase 7: Acceptance and ship

### Task 20: Full acceptance pass

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass (existing + new).

- [ ] **Step 2: Full type-check**

```bash
npx tsc --noEmit
```

Expected: no errors anywhere.

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: build succeeds, no warnings about missing types.

- [ ] **Step 4: Manual acceptance — run a real site audit**

Pick a small client site (5–20 pages). Run a site audit with:

```bash
BROWSER_POOL_SIZE=4 CHROME_MAX_OLD_SPACE=512 LIGHTHOUSE_ENABLED=true npm run dev
```

Watch memory in another terminal: `top -pid $(pgrep -f next-server | head -1)`. Verify:
- Peak RSS stays under ~3 GB
- Up to 4 pages process concurrently (visible in DB: `pagesComplete` jumps in increments of up to 4)
- Each page row has both `result` (axe) and `lighthouseSummary` populated
- Network panel of one page audit shows ONE document load (single nav)
- After all pages complete, `pdfsTotal/Complete/Error` reflect any PDFs linked, status flips to `complete` only when both are settled
- A PDF linked twice from different pages produces ONE `PdfAudit` row, not two
- Setting `LIGHTHOUSE_ENABLED=false` and re-running: audit completes with no LH row, UI hides the section cleanly

- [ ] **Step 5: Push branch**

```bash
git push -u origin feat/ada-audit-runner-enhancements
```

- [ ] **Step 6: Open PR**

```bash
gh pr create --title "feat(ada-audit): runner enhancements — RAM, Lighthouse, PDF" --body "$(cat <<'EOF'
## Summary
- Browser pool: 2 → 4 slots, Chrome heap 256 → 512 MB. Env-tunable via `BROWSER_POOL_SIZE`, `CHROME_MAX_OLD_SPACE`, `LIGHTHOUSE_ENABLED`.
- Lighthouse runs per page (Performance / Accessibility / Best Practices). Single-navigation flow: LH owns the navigation, axe runs after on the same DOM, PDFs harvested from same DOM. ~30–50% wall-clock saved.
- PDF accessibility scanning via pdfjs-dist. Same-domain only, lightweight checks (tagged / title / language / image-only / file size / page count), copy-paste-friendly UI.
- Cleanup matches existing 180d pattern: gzipped LH reports purge daily. Fixes latent screenshot orphan bug on site-audit delete.

## Test plan
- [ ] Single-page audit shows Lighthouse + PDF sections
- [ ] Site audit completes only after both pages and PDFs finish
- [ ] Memory stays under ~3 GB during a 50-page audit
- [ ] Same PDF linked twice = one row
- [ ] `LIGHTHOUSE_ENABLED=false` cleanly disables LH

Spec: `docs/superpowers/specs/2026-05-12-ada-audit-runner-enhancements-design.md`
Plan: `docs/superpowers/plans/2026-05-12-ada-audit-runner-enhancements.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: After review/merge, deploy**

```bash
ssh seo@144.126.213.242 "~/deploy.sh"
```

Verify on prod: hit `/ada-audit`, run a small site audit, watch logs for any errors.

---

## Reference: Environment Variables Introduced

| Var | Default | Notes |
|---|---|---|
| `BROWSER_POOL_SIZE` | `4` | Concurrent page slots |
| `CHROME_MAX_OLD_SPACE` | `512` | Chrome V8 heap ceiling (MB) |
| `LIGHTHOUSE_ENABLED` | `true` | Kill switch for Lighthouse |
| `LIGHTHOUSE_TIMEOUT_MS` | `60000` | Per-page LH timeout |
| `LIGHTHOUSE_REPORTS_DIR` | `<cwd>/lighthouse-reports` | Where gzipped LH JSON lives |
| `PDF_POOL_SIZE` | `4` | Concurrent PDF scan workers |
