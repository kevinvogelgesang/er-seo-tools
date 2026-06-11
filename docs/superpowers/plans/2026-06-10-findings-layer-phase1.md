# Findings Layer Phase 1 (Schema + SEO Dual-Write) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `CrawlRun`/`CrawlPage`/`Finding`/`Violation` tables and dual-write the SEO parser's results into them (best-effort, blob stays source of truth), with parity + rebuild tooling for the SEO side.

**Architecture:** One migration adds all four tables (ADA writes land in Phase 2 but the schema ships complete). A new `lib/findings/` module holds pure mappers (blob → row bundle), an idempotent delete-and-recreate writer (array-form transaction, chunked createMany), dedup-key helpers (sha256 of canonical JSON), a parity comparator, and a rebuild entry. The parser hook is a try/caught call after the existing completion transaction.

**Tech Stack:** Prisma 5.22 + SQLite, Next.js 15 App Router, vitest (colocated `*.test.ts`, shared dev DB), tsx for CLI scripts.

**Spec:** `docs/superpowers/specs/2026-06-10-findings-layer-design.md` (Codex-reviewed). Read it before starting. This plan itself is Codex-reviewed (accept-with-fixes ×8, all applied).

**Branch:** `feat/findings-layer-phase1` off `main`.

**Local dev quirk (applies to every prisma/vitest command):** `.env` points at a path that doesn't exist on this Mac. Prefix every prisma CLI and vitest invocation with `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is interactive-only — generate SQL with `prisma migrate diff`, write the migration folder by hand, apply with `prisma migrate deploy`.

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | + `CrawlRun`, `CrawlPage`, `Finding`, `Violation`; back-relations on `Client`/`Session`/`SiteAudit`/`AdaAudit` |
| `prisma/migrations/<ts>_findings_layer/migration.sql` | hand-authored via `migrate diff` |
| `lib/findings/keys.ts` | `normalizeFindingUrl`, `runFindingKey`, `pageFindingKey` |
| `lib/findings/types.ts` | `FindingsBundle` + row input types shared by mappers/writer |
| `lib/findings/seo-mapper.ts` | pure: `mapSeoResult(result, ctx)` → bundle |
| `lib/findings/writer.ts` | `writeFindingsRun(bundle)` — validate origin, delete-and-recreate, chunked array-form txn |
| `lib/findings/seo-write.ts` | `writeSeoFindings(sessionId, result, clientId)` — fetch ctx, map, write (the hook target) |
| `lib/findings/parity.ts` | `compareSeoParity(sessionId)` — blob vs tables |
| `app/api/parse/[sessionId]/route.ts` | + try/caught `writeSeoFindings` call after the completion txn |
| `scripts/findings-rebuild.ts` | CLI: rebuild one session's run from its blob |
| `scripts/findings-parity.ts` | CLI: run parity for one session |

Each `lib/findings/*.ts` gets a colocated `*.test.ts`.

---

### Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_findings_layer/migration.sql`

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/findings-layer-phase1
```

- [ ] **Step 2: Add models to `prisma/schema.prisma`**

Append at the end of the file:

```prisma
model CrawlRun {
  id              String     @id @default(cuid())
  createdAt       DateTime   @default(now())
  tool            String     // 'seo-parser' | 'ada-audit'
  source          String     // 'sf-upload' | 'site-audit' | 'page-audit' (reserved: 'live-scan')
  domain          String?    // normalized host
  clientId        Int?
  client          Client?    @relation(fields: [clientId], references: [id], onDelete: SetNull)
  sessionId       String?    @unique
  session         Session?   @relation(fields: [sessionId], references: [id], onDelete: SetNull)
  siteAuditId     String?    @unique
  siteAudit       SiteAudit? @relation(fields: [siteAuditId], references: [id], onDelete: SetNull)
  adaAuditId      String?    @unique // standalone page audits only
  adaAudit        AdaAudit?  @relation(fields: [adaAuditId], references: [id], onDelete: SetNull)
  status          String     // 'complete' | 'partial'
  score           Int?       // healthScore (seo-parser) | site/page score (ada-audit)
  wcagLevel       String?    // ada runs only
  pagesTotal      Int        @default(0)
  startedAt       DateTime?
  completedAt     DateTime?
  archivePrunedAt DateTime?  // set when the origin row's blob was pruned
  pages           CrawlPage[]
  findings        Finding[]
  violations      Violation[]

  @@index([clientId, tool, createdAt])
  @@index([domain, createdAt])
  @@index([createdAt])
}

model CrawlPage {
  id              String   @id @default(cuid())
  runId           String
  run             CrawlRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  url             String   // normalized via normalizeFindingUrl
  status          String?  // ada: 'complete' | 'error' | 'redirected'; seo: null
  error           String?
  finalUrl        String?
  statusCode      Int?
  title           String?
  h1              String?
  metaDescription String?
  wordCount       Int?
  crawlDepth      Int?
  indexable       Boolean?
  score           Int?     // ada page score (mapper-computed)
  adaAuditId      String?  // drill-through to the child AdaAudit (no FK)
  findings        Finding[]
  violations      Violation[]

  @@unique([runId, url])
  @@index([runId])
}

model Finding {
  id               String     @id @default(cuid())
  runId            String
  run              CrawlRun   @relation(fields: [runId], references: [id], onDelete: Cascade)
  pageId           String?
  page             CrawlPage? @relation(fields: [pageId], references: [id], onDelete: Cascade)
  scope            String     // 'run' | 'page' — never inferred from pageId
  type             String     // seo issue-type id | axe ruleId
  severity         String     // 'critical' | 'warning' | 'notice'
  url              String?    // normalized URL for page-scope findings (kept when pageId null)
  count            Int        @default(1)
  affectedComplete Boolean?   // run-scope SEO: issue.affectedUrlRefsComplete
  affectedSource   String?    // run-scope SEO: issue.affectedUrlSource
  detail           String?    // capped JSON
  dedupKey         String     // sha256 of canonical JSON
  violation        Violation?

  @@unique([runId, dedupKey])
  @@index([runId, severity])
  @@index([runId, scope])
  @@index([type])
  @@index([pageId])
}

model Violation {
  id        String    @id @default(cuid())
  findingId String    @unique
  finding   Finding   @relation(fields: [findingId], references: [id], onDelete: Cascade)
  runId     String
  run       CrawlRun  @relation(fields: [runId], references: [id], onDelete: Cascade)
  pageId    String
  page      CrawlPage @relation(fields: [pageId], references: [id], onDelete: Cascade)
  ruleId    String
  impact    String    // exact axe impact
  wcagTags  String    // JSON string[]
  help      String?
  helpUrl   String?
  nodeCount Int       @default(0)
  nodes     String?   // capped node JSON

  @@index([runId, impact])
  @@index([ruleId])
  @@index([pageId])
}
```

Then add the back-relations to the existing models (one line each):

- `Client` (after `schedules Schedule[]`): `crawlRuns CrawlRun[]`
- `Session` (after `pages SessionPage[]`): `crawlRun CrawlRun?`
- `SiteAudit` (after `checks SiteAuditCheck[]`): `crawlRun CrawlRun?`
- `AdaAudit` (after `checks AdaAuditCheck[]`): `crawlRun CrawlRun?`

- [ ] **Step 3: Validate the schema**

Run: `DATABASE_URL="file:./local-dev.db" npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Generate the migration SQL by hand**

```bash
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_findings_layer"
DATABASE_URL="file:./local-dev.db" npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "file:./shadow-migrate.db" \
  --script > "prisma/migrations/${TS}_findings_layer/migration.sql"
rm -f shadow-migrate.db
cat "prisma/migrations/${TS}_findings_layer/migration.sql"
```

Expected: `CREATE TABLE "CrawlRun" ...`, `"CrawlPage"`, `"Finding"`, `"Violation"`, plus the unique/regular indexes. No `ALTER` of existing tables (back-relations are virtual).

- [ ] **Step 5: Apply + regenerate client**

```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy
DATABASE_URL="file:./local-dev.db" npx prisma generate
```

Expected: `1 migration found ... applied` and client generation success.

- [ ] **Step 6: Sanity-check types compile**

Run: `npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(findings): CrawlRun/CrawlPage/Finding/Violation schema"
```

---

### Task 2: Dedup keys + URL normalization (`lib/findings/keys.ts`)

**Files:**
- Create: `lib/findings/keys.ts`
- Test: `lib/findings/keys.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/findings/keys.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeFindingUrl, runFindingKey, pageFindingKey } from './keys'

describe('normalizeFindingUrl', () => {
  it('lowercases host, strips fragment, keeps path case and query', () => {
    expect(normalizeFindingUrl('https://Example.COM/Path?b=2#frag')).toBe('https://example.com/Path?b=2')
  })
  it('strips the trailing slash on a bare root path only', () => {
    expect(normalizeFindingUrl('https://example.com/')).toBe('https://example.com')
    expect(normalizeFindingUrl('https://example.com/dir/')).toBe('https://example.com/dir/')
  })
  it('returns non-URL input unchanged', () => {
    expect(normalizeFindingUrl('not a url')).toBe('not a url')
  })
})

describe('finding keys', () => {
  it('run key is stable and 64 hex chars', () => {
    const k = runFindingKey('missing_title')
    expect(k).toMatch(/^[0-9a-f]{64}$/)
    expect(runFindingKey('missing_title')).toBe(k)
  })
  it('page key normalizes the URL before hashing', () => {
    expect(pageFindingKey('missing_title', 'https://Example.com/a#x'))
      .toBe(pageFindingKey('missing_title', 'https://example.com/a'))
  })
  it('different types/urls produce different keys', () => {
    expect(runFindingKey('a')).not.toBe(runFindingKey('b'))
    expect(pageFindingKey('a', 'https://x.com/1')).not.toBe(pageFindingKey('a', 'https://x.com/2'))
    expect(runFindingKey('a')).not.toBe(pageFindingKey('a', 'https://x.com/1'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/keys.test.ts`
Expected: FAIL — cannot resolve `./keys`.

- [ ] **Step 3: Implement**

```typescript
// lib/findings/keys.ts
//
// Canonical identity helpers for the normalized findings layer.
// Same hashing discipline as lib/ada-audit/checks-keys.ts: sha256 of
// canonical JSON, never delimiter-joined raw strings.
import { createHash } from 'crypto'
import { canonicalJson } from '@/lib/ada-audit/checks-keys'

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Normalization shared by CrawlPage.url, Finding.url, and the page dedup
 * key: lowercase host, drop fragment, strip the trailing slash on a bare
 * root path. Non-URLs pass through unchanged.
 */
export function normalizeFindingUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  u.hash = ''
  let out = u.toString()
  if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '')
  return out
}

export function runFindingKey(type: string): string {
  return sha256Hex(canonicalJson({ scope: 'run', type }))
}

export function pageFindingKey(type: string, url: string): string {
  return sha256Hex(canonicalJson({ scope: 'page', type, url: normalizeFindingUrl(url) }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/keys.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/findings/keys.ts lib/findings/keys.test.ts
git commit -m "feat(findings): dedup keys + URL normalization"
```

---

### Task 3: Bundle types (`lib/findings/types.ts`)

**Files:**
- Create: `lib/findings/types.ts`

No test — pure type declarations.

- [ ] **Step 1: Write the types**

```typescript
// lib/findings/types.ts
//
// The in-memory row bundle every mapper produces and the writer persists.
// Ids are pre-generated (crypto.randomUUID) so rows can cross-reference
// before insert — createMany cannot return ids.

export interface CrawlRunInput {
  id: string
  tool: 'seo-parser' | 'ada-audit'
  source: 'sf-upload' | 'site-audit' | 'page-audit'
  domain: string | null
  clientId: number | null
  sessionId: string | null
  siteAuditId: string | null
  adaAuditId: string | null
  status: 'complete' | 'partial'
  score: number | null
  wcagLevel: string | null
  pagesTotal: number
  startedAt: Date | null
  completedAt: Date | null
}

export interface CrawlPageInput {
  id: string
  runId: string
  url: string
  status: string | null
  error: string | null
  finalUrl: string | null
  statusCode: number | null
  title: string | null
  h1: string | null
  metaDescription: string | null
  wordCount: number | null
  crawlDepth: number | null
  indexable: boolean | null
  score: number | null
  adaAuditId: string | null
}

export interface FindingInput {
  id: string
  runId: string
  pageId: string | null
  scope: 'run' | 'page'
  type: string
  severity: 'critical' | 'warning' | 'notice'
  url: string | null
  count: number
  affectedComplete: boolean | null
  affectedSource: string | null
  detail: string | null
  dedupKey: string
}

export interface ViolationInput {
  id: string
  findingId: string
  runId: string
  pageId: string
  ruleId: string
  impact: string
  wcagTags: string
  help: string | null
  helpUrl: string | null
  nodeCount: number
  nodes: string | null
}

export interface FindingsBundle {
  run: CrawlRunInput
  pages: CrawlPageInput[]
  findings: FindingInput[]
  violations: ViolationInput[]
}
```

- [ ] **Step 2: Verify compile + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add lib/findings/types.ts
git commit -m "feat(findings): bundle input types"
```

---

### Task 4: SEO mapper (`lib/findings/seo-mapper.ts`)

**Files:**
- Create: `lib/findings/seo-mapper.ts`
- Test: `lib/findings/seo-mapper.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/findings/seo-mapper.test.ts
import { describe, it, expect } from 'vitest'
import type { AggregatedResult } from '@/lib/types'
import { computeHealthScore } from '@/lib/services/scoring.service'
import { mapSeoResult } from './seo-mapper'
import { runFindingKey, pageFindingKey } from './keys'

const CTX = {
  sessionId: 'sess-1',
  clientId: 7,
  startedAt: new Date('2026-06-10T00:00:00Z'),
  completedAt: new Date('2026-06-10T00:05:00Z'),
}

/** Minimal current-format AggregatedResult: 2 pages, 1 critical issue with
 *  complete refs, 1 warning with sample urls only (no refs), 1 notice with
 *  an external URL not in the page index. */
function fixture(): AggregatedResult {
  return {
    crawl_summary: { total_urls: 2 },
    issues: {
      critical: [{
        type: 'broken_pages', severity: 'critical', count: 1,
        description: 'Pages returning 4xx/5xx',
        affectedUrlRefs: [0], affectedUrlRefsComplete: true,
        affectedUrlSource: 'parser-complete',
      }],
      warnings: [{
        type: 'missing_meta_description', severity: 'warning', count: 2,
        description: 'Missing meta descriptions',
        urls: ['https://Example.com/a#frag'],
        affectedUrlSource: 'parser-sample',
      }],
      notices: [{
        type: 'external_broken_link', severity: 'notice', count: 1,
        description: 'External link broken',
        urls: ['https://other-site.org/gone'],
      }],
    },
    site_structure: {}, resources: {}, technical_seo: {}, performance: {},
    recommendations: [],
    metadata: {
      files_processed: [], parsers_used: [], total_parsers_available: 41,
      site_name: 'Example.com', health_score: 83,
    },
    url_registry: {
      sessionOrigin: { scheme: 'https', host: 'example.com' },
      hosts: ['example.com'],
      urls: [
        { id: 0, kind: 'page', hostId: 0, scheme: 'https', path: '/a' },
        { id: 1, kind: 'page', hostId: 0, scheme: 'https', path: '/' },
      ],
    },
    page_index: [
      { ref: 0, title: 'A', h1: 'A1', metaDescription: null, wordCount: 100, crawlDepth: 1, indexable: true, issueTypes: ['broken_pages', 'missing_meta_description'] },
      { ref: 1, title: 'Home', h1: null, metaDescription: 'd', wordCount: 500, crawlDepth: 0, indexable: true, issueTypes: [] },
    ],
  } as unknown as AggregatedResult
}

describe('mapSeoResult', () => {
  it('builds the run with origin, score, domain, pagesTotal', () => {
    const b = mapSeoResult(fixture(), CTX)
    expect(b.run.tool).toBe('seo-parser')
    expect(b.run.source).toBe('sf-upload')
    expect(b.run.sessionId).toBe('sess-1')
    expect(b.run.siteAuditId).toBeNull()
    expect(b.run.adaAuditId).toBeNull()
    expect(b.run.clientId).toBe(7)
    expect(b.run.score).toBe(83)
    expect(b.run.domain).toBe('example.com')
    expect(b.run.status).toBe('complete')
    expect(b.run.pagesTotal).toBe(2)
  })

  it('builds one CrawlPage per page_index entry with normalized urls', () => {
    const b = mapSeoResult(fixture(), CTX)
    expect(b.pages).toHaveLength(2)
    const urls = b.pages.map((p) => p.url).sort()
    expect(urls).toEqual(['https://example.com', 'https://example.com/a'])
    const a = b.pages.find((p) => p.url === 'https://example.com/a')!
    expect(a.title).toBe('A')
    expect(a.runId).toBe(b.run.id)
    expect(a.status).toBeNull()
  })

  it('builds one run-scope finding per issue with completeness flags', () => {
    const b = mapSeoResult(fixture(), CTX)
    const runScope = b.findings.filter((f) => f.scope === 'run')
    expect(runScope).toHaveLength(3)
    const broken = runScope.find((f) => f.type === 'broken_pages')!
    expect(broken.severity).toBe('critical')
    expect(broken.count).toBe(1)
    expect(broken.affectedComplete).toBe(true)
    expect(broken.affectedSource).toBe('parser-complete')
    expect(broken.dedupKey).toBe(runFindingKey('broken_pages'))
    expect(broken.pageId).toBeNull()
    const meta = runScope.find((f) => f.type === 'missing_meta_description')!
    expect(meta.affectedComplete).toBeNull() // flag absent in blob → null, not false
    expect(meta.affectedSource).toBe('parser-sample')
  })

  it('computes the score when the blob lacks metadata.health_score', () => {
    // Fresh aggregator output does NOT set metadata.health_score — only
    // legacy blobs have it. The mapper must fall back to computeHealthScore.
    const fx = fixture()
    delete (fx.metadata as Record<string, unknown>).health_score
    const b = mapSeoResult(fx, CTX)
    expect(b.run.score).toBe(computeHealthScore(fx))
    expect(typeof b.run.score).toBe('number')
  })

  it('page-scope rows carry the completeness flags of their issue', () => {
    const fx = fixture()
    // current-format sampled issue: refs present but explicitly incomplete
    fx.issues.warnings[0].affectedUrlRefs = [0]
    fx.issues.warnings[0].affectedUrlRefsComplete = false
    const b = mapSeoResult(fx, CTX)
    const metaPage = b.findings.find(
      (f) => f.scope === 'page' && f.type === 'missing_meta_description',
    )!
    expect(metaPage.affectedComplete).toBe(false)
    expect(metaPage.affectedSource).toBe('parser-sample')
  })

  it('extracts page-scope URLs from groups[*].urls (duplicate-content shape)', () => {
    // duplicate title/meta/H1 issues carry URLs in groups, NOT in
    // issue.urls/affectedUrlRefs (same gap recommendation-builder fixed).
    const fx = fixture()
    fx.issues.warnings.push({
      type: 'duplicate_titles', severity: 'warning', count: 2,
      description: 'Duplicate titles',
      groups: [{ title: 'A', count: 2, urls: ['https://example.com/a', 'https://example.com/'] }],
    } as never)
    const b = mapSeoResult(fx, CTX)
    const dup = b.findings.filter((f) => f.scope === 'page' && f.type === 'duplicate_titles')
    expect(dup).toHaveLength(2)
    expect(dup.map((f) => f.url).sort()).toEqual(['https://example.com', 'https://example.com/a'])
  })

  it('builds page-scope findings from refs, sample urls, and external urls', () => {
    const b = mapSeoResult(fixture(), CTX)
    const pageScope = b.findings.filter((f) => f.scope === 'page')
    expect(pageScope).toHaveLength(3)

    const broken = pageScope.find((f) => f.type === 'broken_pages')!
    const pageA = b.pages.find((p) => p.url === 'https://example.com/a')!
    expect(broken.pageId).toBe(pageA.id)
    expect(broken.url).toBe('https://example.com/a')
    expect(broken.dedupKey).toBe(pageFindingKey('broken_pages', 'https://example.com/a'))

    // sample url resolves to the same page via normalization
    const meta = pageScope.find((f) => f.type === 'missing_meta_description')!
    expect(meta.pageId).toBe(pageA.id)

    // external URL: page-scope, pageId null, url kept
    const ext = pageScope.find((f) => f.type === 'external_broken_link')!
    expect(ext.pageId).toBeNull()
    expect(ext.url).toBe('https://other-site.org/gone')
  })

  it('emits no violations and dedupes repeated (type,url) pairs', () => {
    const fx = fixture()
    // duplicate the same affected ref to force a would-be dedup collision
    fx.issues.critical[0].affectedUrlRefs = [0, 0]
    const b = mapSeoResult(fx, CTX)
    expect(b.violations).toHaveLength(0)
    const keys = b.findings.map((f) => f.dedupKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('legacy blob without page_index/url_registry → run-scope rows only', () => {
    const fx = fixture()
    delete (fx as Record<string, unknown>).url_registry
    delete (fx as Record<string, unknown>).page_index
    const b = mapSeoResult(fx, CTX)
    expect(b.pages).toHaveLength(0)
    expect(b.run.pagesTotal).toBe(0)
    expect(b.findings.every((f) => f.scope === 'run')).toBe(true)
    // sample urls exist but cannot be page rows; still no page-scope rows
    expect(b.findings).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/seo-mapper.test.ts`
Expected: FAIL — cannot resolve `./seo-mapper`.

- [ ] **Step 3: Implement**

Note the page-scope URL-source decision (mirrors the spec): use
`affectedUrlRefs` when present, else fall back to the sampled `urls` array.
Run-scope rows always carry the authoritative count + completeness flags.

```typescript
// lib/findings/seo-mapper.ts
//
// Pure mapper: AggregatedResult blob → FindingsBundle. No DB access.
// Mirrors buildSessionPages' field mapping for pages so parity holds.
import { randomUUID } from 'crypto'
import type { AggregatedResult, Issue } from '@/lib/types'
import { rehydrate } from '@/lib/services/url-registry'
import { normalizeHost } from '@/lib/services/normalize-host'
import { computeHealthScore } from '@/lib/services/scoring.service'
import { normalizeFindingUrl, runFindingKey, pageFindingKey } from './keys'
import type { CrawlPageInput, FindingInput, FindingsBundle } from './types'

export interface SeoMapContext {
  sessionId: string
  clientId: number | null
  startedAt: Date | null
  completedAt: Date | null
}

const SEVERITIES = [
  ['critical', 'critical'],
  ['warnings', 'warning'],
  ['notices', 'notice'],
] as const

export function mapSeoResult(result: AggregatedResult, ctx: SeoMapContext): FindingsBundle {
  const runId = randomUUID()
  const reg = result.url_registry
  const pageIndex = result.page_index ?? []

  const pages: CrawlPageInput[] = reg
    ? pageIndex.map((p) => ({
        id: randomUUID(),
        runId,
        url: normalizeFindingUrl(rehydrate(reg, p.ref)),
        status: null,
        error: null,
        finalUrl: null,
        statusCode: null,
        title: p.title,
        h1: p.h1,
        metaDescription: p.metaDescription,
        wordCount: p.wordCount,
        crawlDepth: p.crawlDepth,
        indexable: p.indexable,
        score: null,
        adaAuditId: null,
      }))
    : []
  const pageByUrl = new Map(pages.map((p) => [p.url, p]))

  const findings: FindingInput[] = []
  const seenKeys = new Set<string>()
  const push = (f: FindingInput) => {
    if (seenKeys.has(f.dedupKey)) return
    seenKeys.add(f.dedupKey)
    findings.push(f)
  }

  for (const [bucket, severity] of SEVERITIES) {
    for (const issue of result.issues?.[bucket] ?? []) {
      // Run-scope row: the authoritative per-type record.
      push({
        id: randomUUID(),
        runId,
        pageId: null,
        scope: 'run',
        type: issue.type,
        severity,
        url: null,
        count: issue.count ?? 1,
        affectedComplete: issue.affectedUrlRefsComplete ?? null,
        affectedSource: issue.affectedUrlSource ?? null,
        detail: JSON.stringify({ description: issue.description ?? '' }),
        dedupKey: runFindingKey(issue.type),
      })

      // Page-scope rows: best-available URL attribution. Each row carries
      // its issue's completeness flags so diff consumers can tell complete
      // sets from sampled ones (Codex spec-review fix).
      for (const url of affectedUrls(issue, reg)) {
        const normalized = normalizeFindingUrl(url)
        push({
          id: randomUUID(),
          runId,
          pageId: pageByUrl.get(normalized)?.id ?? null,
          scope: 'page',
          type: issue.type,
          severity,
          url: normalized,
          count: 1,
          affectedComplete: issue.affectedUrlRefsComplete ?? null,
          affectedSource: issue.affectedUrlSource ?? null,
          detail: null,
          dedupKey: pageFindingKey(issue.type, url),
        })
      }
    }
  }

  return {
    run: {
      id: runId,
      tool: 'seo-parser',
      source: 'sf-upload',
      domain: normalizeHost(result.metadata?.site_name ?? reg?.sessionOrigin.host ?? null),
      clientId: ctx.clientId,
      sessionId: ctx.sessionId,
      siteAuditId: null,
      adaAuditId: null,
      status: 'complete',
      // Fresh aggregator output does not persist metadata.health_score —
      // compute it the same way the report does (computeHealthScore is pure).
      score: result.metadata?.health_score ?? computeHealthScore(result),
      wcagLevel: null,
      pagesTotal: pages.length,
      startedAt: ctx.startedAt,
      completedAt: ctx.completedAt,
    },
    pages,
    findings,
    violations: [],
  }
}

/** Page-scope rows need page_index context to be meaningful; a legacy blob
 *  (no registry) gets run-scope rows only. Extraction order mirrors
 *  recommendation-builder: refs first, then groups[*].urls (duplicate
 *  title/meta/H1 issues carry URLs ONLY there), then sampled issue.urls. */
function affectedUrls(issue: Issue, reg: AggregatedResult['url_registry']): string[] {
  if (!reg) return []
  const fromRefs = (issue.affectedUrlRefs ?? []).map((ref) => rehydrate(reg, ref)).filter(Boolean)
  const fromGroups = (issue.groups ?? []).flatMap((g) => g.urls ?? [])
  const fromSamples = fromRefs.length ? [] : (issue.urls ?? [])
  return Array.from(new Set([...fromRefs, ...fromGroups, ...fromSamples]))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/seo-mapper.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/findings/seo-mapper.ts lib/findings/seo-mapper.test.ts
git commit -m "feat(findings): SEO blob -> bundle mapper"
```

---

### Task 5: Writer (`lib/findings/writer.ts`)

**Files:**
- Create: `lib/findings/writer.ts`
- Test: `lib/findings/writer.test.ts` (real shared dev DB — clean up everything you create)

- [ ] **Step 1: Write the failing test**

```typescript
// lib/findings/writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from './writer'
import type { FindingsBundle } from './types'

const SESSION_ID = 'test-findings-writer-session'

function bundle(nPages: number, nFindings: number): FindingsBundle {
  const runId = randomUUID()
  const pages = Array.from({ length: nPages }, (_, i) => ({
    id: randomUUID(), runId, url: `https://w.test/p${i}`,
    status: null, error: null, finalUrl: null, statusCode: null,
    title: `t${i}`, h1: null, metaDescription: null,
    wordCount: null, crawlDepth: null, indexable: true, score: null, adaAuditId: null,
  }))
  const findings = Array.from({ length: nFindings }, (_, i) => ({
    id: randomUUID(), runId,
    pageId: pages.length ? pages[i % pages.length].id : null,
    scope: 'page' as const, type: 'test_issue', severity: 'warning' as const,
    url: `https://w.test/p${i % Math.max(pages.length, 1)}`,
    count: 1, affectedComplete: null, affectedSource: null, detail: null,
    dedupKey: `test-key-${i}`,
  }))
  return {
    run: {
      id: runId, tool: 'seo-parser', source: 'sf-upload', domain: 'w.test',
      clientId: null, sessionId: SESSION_ID, siteAuditId: null, adaAuditId: null,
      status: 'complete', score: 50, wcagLevel: null, pagesTotal: nPages,
      startedAt: null, completedAt: new Date(),
    },
    pages, findings, violations: [],
  }
}

async function clearTestState() {
  // Delete by BOTH origin and domain: SetNull origins mean a run whose
  // Session was deleted is unreachable via sessionId.
  await prisma.crawlRun.deleteMany({
    where: { OR: [{ sessionId: SESSION_ID }, { domain: 'w.test' }] },
  })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

describe('writeFindingsRun', () => {
  beforeEach(async () => {
    await clearTestState()
    await prisma.session.create({
      data: { id: SESSION_ID, status: 'complete', files: '[]' },
    })
  })
  afterEach(clearTestState)

  it('persists run + pages + findings', async () => {
    await writeFindingsRun(bundle(3, 5))
    const run = await prisma.crawlRun.findUnique({
      where: { sessionId: SESSION_ID },
      include: { pages: true, findings: true, violations: true },
    })
    expect(run).not.toBeNull()
    expect(run!.pages).toHaveLength(3)
    expect(run!.findings).toHaveLength(5)
    expect(run!.violations).toHaveLength(0)
  })

  it('is idempotent: rewriting the same origin replaces, never duplicates', async () => {
    await writeFindingsRun(bundle(3, 5))
    await writeFindingsRun(bundle(2, 2))
    const runs = await prisma.crawlRun.findMany({ where: { sessionId: SESSION_ID } })
    expect(runs).toHaveLength(1)
    expect(await prisma.crawlPage.count({ where: { runId: runs[0].id } })).toBe(2)
    expect(await prisma.finding.count({ where: { runId: runs[0].id } })).toBe(2)
    // old subtree fully gone
    expect(await prisma.crawlPage.count({ where: { run: { sessionId: SESSION_ID } } })).toBe(2)
  })

  it('rolls back atomically on a bad bundle, preserving the existing run', async () => {
    await writeFindingsRun(bundle(2, 3))
    const bad = bundle(1, 2)
    bad.findings[1].dedupKey = bad.findings[0].dedupKey // violates @@unique([runId, dedupKey])
    await expect(writeFindingsRun(bad)).rejects.toThrow()
    // the transaction rolled back: the ORIGINAL run + subtree are intact
    const run = await prisma.crawlRun.findUnique({
      where: { sessionId: SESSION_ID },
      include: { pages: true, findings: true },
    })
    expect(run).not.toBeNull()
    expect(run!.pages).toHaveLength(2)
    expect(run!.findings).toHaveLength(3)
  })

  it('handles bundles larger than one chunk (50 rows)', async () => {
    await writeFindingsRun(bundle(80, 160))
    const run = await prisma.crawlRun.findUnique({
      where: { sessionId: SESSION_ID }, include: { pages: true, findings: true },
    })
    expect(run!.pages).toHaveLength(80)
    expect(run!.findings).toHaveLength(160)
  })

  it('rejects a bundle without exactly one origin', async () => {
    const none = bundle(0, 0)
    none.run.sessionId = null
    await expect(writeFindingsRun(none)).rejects.toThrow(/exactly one origin/i)

    const two = bundle(0, 0)
    two.run.siteAuditId = 'also-set'
    await expect(writeFindingsRun(two)).rejects.toThrow(/exactly one origin/i)
  })

  it('run survives origin deletion with sessionId nulled', async () => {
    await writeFindingsRun(bundle(1, 1))
    await prisma.session.delete({ where: { id: SESSION_ID } })
    const runs = await prisma.crawlRun.findMany({ where: { domain: 'w.test' } })
    expect(runs).toHaveLength(1)
    expect(runs[0].sessionId).toBeNull() // clearTestState reaches it by domain
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/writer.test.ts`
Expected: FAIL — cannot resolve `./writer`.

- [ ] **Step 3: Implement**

```typescript
// lib/findings/writer.ts
//
// Idempotent persistence for a FindingsBundle: delete any existing run for
// the same origin, then insert the whole bundle — ONE array-form
// $transaction (never interactive; see CLAUDE.md "Do not"), createMany
// chunked at 75 rows (SQLite bound-variable guard, same as SessionPage).
import { prisma } from '@/lib/db'
import type { FindingsBundle } from './types'

// 50, not 75: CrawlPage has ~15 columns and SQLite's classic bound-variable
// limit is 999 — 75 × 15 would exceed it. 50 × 15 = 750 keeps headroom for
// every table in the bundle.
const CHUNK = 50

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function writeFindingsRun(bundle: FindingsBundle): Promise<void> {
  const { run, pages, findings, violations } = bundle
  const origins = [run.sessionId, run.siteAuditId, run.adaAuditId].filter((v) => v != null)
  if (origins.length !== 1) {
    throw new Error(
      `[findings] writeFindingsRun requires exactly one origin FK, got ${origins.length}`,
    )
  }

  const where = run.sessionId
    ? { sessionId: run.sessionId }
    : run.siteAuditId
      ? { siteAuditId: run.siteAuditId }
      : { adaAuditId: run.adaAuditId! }

  await prisma.$transaction([
    prisma.crawlRun.deleteMany({ where }), // cascade clears the old subtree
    prisma.crawlRun.create({ data: run }),
    ...chunk(pages, CHUNK).map((data) => prisma.crawlPage.createMany({ data })),
    ...chunk(findings, CHUNK).map((data) => prisma.finding.createMany({ data })),
    ...chunk(violations, CHUNK).map((data) => prisma.violation.createMany({ data })),
  ])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/writer.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/findings/writer.ts lib/findings/writer.test.ts
git commit -m "feat(findings): idempotent bundle writer (array-form txn, chunked)"
```

---

### Task 6: SEO write entry + parser hook

**Files:**
- Create: `lib/findings/seo-write.ts`
- Test: `lib/findings/seo-write.test.ts`
- Modify: `app/api/parse/[sessionId]/route.ts` (after the completion `$transaction`, currently ending around line 249, before the `triggerPillarAnalysis` block)

- [ ] **Step 1: Write the failing test**

```typescript
// lib/findings/seo-write.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import type { AggregatedResult } from '@/lib/types'
import { writeSeoFindings } from './seo-write'

const SESSION_ID = 'test-findings-seo-write'

const RESULT = {
  crawl_summary: { total_urls: 1 },
  issues: {
    critical: [],
    warnings: [{ type: 'missing_h1', severity: 'warning', count: 1, description: 'Missing H1', affectedUrlRefs: [0], affectedUrlRefsComplete: true }],
    notices: [],
  },
  site_structure: {}, resources: {}, technical_seo: {}, performance: {},
  recommendations: [],
  metadata: { files_processed: [], parsers_used: [], total_parsers_available: 41, site_name: 'sw.test', health_score: 91 },
  url_registry: {
    sessionOrigin: { scheme: 'https', host: 'sw.test' },
    hosts: ['sw.test'],
    urls: [{ id: 0, kind: 'page', hostId: 0, scheme: 'https', path: '/x' }],
  },
  page_index: [{ ref: 0, title: 'X', h1: null, metaDescription: null, wordCount: 10, crawlDepth: 1, indexable: true, issueTypes: ['missing_h1'] }],
} as unknown as AggregatedResult

async function clearTestState() {
  await prisma.crawlRun.deleteMany({
    where: { OR: [{ sessionId: SESSION_ID }, { domain: 'sw.test' }] },
  })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

describe('writeSeoFindings', () => {
  beforeEach(async () => {
    await clearTestState()
    await prisma.session.create({ data: { id: SESSION_ID, status: 'complete', files: '[]' } })
  })
  afterEach(clearTestState)

  it('maps + persists a run for the session', async () => {
    await writeSeoFindings(SESSION_ID, RESULT, null)
    const run = await prisma.crawlRun.findUnique({
      where: { sessionId: SESSION_ID },
      include: { pages: true, findings: true },
    })
    expect(run).not.toBeNull()
    expect(run!.tool).toBe('seo-parser')
    expect(run!.score).toBe(91)
    expect(run!.pages).toHaveLength(1)
    expect(run!.findings).toHaveLength(2) // 1 run-scope + 1 page-scope
    expect(run!.startedAt).not.toBeNull() // pulled from session.createdAt
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/seo-write.test.ts`
Expected: FAIL — cannot resolve `./seo-write`.

- [ ] **Step 3: Implement**

```typescript
// lib/findings/seo-write.ts
//
// The parser's dual-write entry: fetch context, map, persist. Callers wrap
// this in try/catch — a findings failure must never fail the parse.
import { prisma } from '@/lib/db'
import type { AggregatedResult } from '@/lib/types'
import { mapSeoResult } from './seo-mapper'
import { writeFindingsRun } from './writer'

export async function writeSeoFindings(
  sessionId: string,
  result: AggregatedResult,
  clientId: number | null,
): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdAt: true },
  })
  const bundle = mapSeoResult(result, {
    sessionId,
    clientId,
    startedAt: session?.createdAt ?? null,
    completedAt: new Date(),
  })
  await writeFindingsRun(bundle)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/seo-write.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Hook into the parse route**

In `app/api/parse/[sessionId]/route.ts`, add the import at the top with the
other `@/lib` imports:

```typescript
import { writeSeoFindings } from '@/lib/findings/seo-write';
```

Then insert between the completion `$transaction` (ends `]);` around line
249) and the `// Fire-and-forget trigger` comment block:

```typescript
    // Dual-write the normalized findings run (A2). Best-effort: the blob
    // committed above is the source of truth; a findings failure must never
    // fail the parse.
    try {
      await writeSeoFindings(sessionId, result, clientId);
    } catch (err) {
      console.error('[findings] dual-write failed for session', sessionId, err);
    }
```

- [ ] **Step 6: Verify compile + existing parse tests still pass**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/parse`
Expected: PASS (all pre-existing parse route tests; the hook is non-fatal so none should be affected — if any parse test now fails on a `crawlRun` table miss, the test DB hasn't had the migration applied: re-run Task 1 Step 5).

- [ ] **Step 7: Commit**

```bash
git add lib/findings/seo-write.ts lib/findings/seo-write.test.ts "app/api/parse/[sessionId]/route.ts"
git commit -m "feat(findings): SEO parser dual-write hook (best-effort)"
```

---

### Task 7: Parity comparator (`lib/findings/parity.ts`)

**Files:**
- Create: `lib/findings/parity.ts`
- Test: `lib/findings/parity.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/findings/parity.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import type { AggregatedResult } from '@/lib/types'
import { writeSeoFindings } from './seo-write'
import { compareSeoParity } from './parity'

const SESSION_ID = 'test-findings-parity'

const RESULT = {
  crawl_summary: { total_urls: 2 },
  issues: {
    critical: [{ type: 'broken_pages', severity: 'critical', count: 1, description: 'broken', affectedUrlRefs: [0], affectedUrlRefsComplete: true }],
    warnings: [],
    notices: [{ type: 'thin_content', severity: 'notice', count: 1, description: 'thin', affectedUrlRefs: [1], affectedUrlRefsComplete: true }],
  },
  site_structure: {}, resources: {}, technical_seo: {}, performance: {},
  recommendations: [],
  metadata: { files_processed: [], parsers_used: [], total_parsers_available: 41, site_name: 'par.test', health_score: 70 },
  url_registry: {
    sessionOrigin: { scheme: 'https', host: 'par.test' },
    hosts: ['par.test'],
    urls: [
      { id: 0, kind: 'page', hostId: 0, scheme: 'https', path: '/a' },
      { id: 1, kind: 'page', hostId: 0, scheme: 'https', path: '/b' },
    ],
  },
  page_index: [
    { ref: 0, title: 'A', h1: null, metaDescription: null, wordCount: 10, crawlDepth: 1, indexable: true, issueTypes: ['broken_pages'] },
    { ref: 1, title: 'B', h1: null, metaDescription: null, wordCount: 20, crawlDepth: 1, indexable: true, issueTypes: ['thin_content'] },
  ],
} as unknown as AggregatedResult

async function clearTestState() {
  await prisma.crawlRun.deleteMany({
    where: { OR: [{ sessionId: SESSION_ID }, { domain: 'par.test' }] },
  })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

describe('compareSeoParity', () => {
  beforeEach(async () => {
    await clearTestState()
    await prisma.session.create({
      data: { id: SESSION_ID, status: 'complete', files: '[]', result: JSON.stringify(RESULT) },
    })
  })
  afterEach(clearTestState)

  it('reports ok when tables match the blob', async () => {
    await writeSeoFindings(SESSION_ID, RESULT, null)
    const report = await compareSeoParity(SESSION_ID)
    expect(report.diffs).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('reports a diff when a finding is missing from the tables', async () => {
    await writeSeoFindings(SESSION_ID, RESULT, null)
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { sessionId: SESSION_ID } })
    await prisma.finding.deleteMany({ where: { runId: run.id, type: 'thin_content' } })
    const report = await compareSeoParity(SESSION_ID)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/thin_content/)
  })

  it('reports a diff when no run exists at all', async () => {
    const report = await compareSeoParity(SESSION_ID)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/no CrawlRun/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/parity.test.ts`
Expected: FAIL — cannot resolve `./parity`.

- [ ] **Step 3: Implement**

The comparator recomputes the expected bundle from the blob **via the same
mapper** and diffs it against what's stored — so it validates the writer +
hook, not the mapper against itself twice. Differences are returned as
human-readable strings for the CLI.

```typescript
// lib/findings/parity.ts
//
// Blob-vs-tables parity for the dual-write phase. Recomputes the expected
// bundle from the archived blob with the same mapper, then diffs counts and
// identity sets against the stored rows. Used by scripts/findings-parity.ts
// against production data before any reader flips.
import { prisma } from '@/lib/db'
import type { AggregatedResult } from '@/lib/types'
import { mapSeoResult } from './seo-mapper'

export interface ParityReport {
  ok: boolean
  diffs: string[]
}

export async function compareSeoParity(sessionId: string): Promise<ParityReport> {
  const diffs: string[] = []
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { result: true, clientId: true, createdAt: true },
  })
  if (!session?.result) return { ok: false, diffs: ['session missing or has no result blob'] }

  let blob: AggregatedResult
  try {
    blob = JSON.parse(session.result) as AggregatedResult
  } catch {
    return { ok: false, diffs: ['result blob is not valid JSON'] }
  }

  const expected = mapSeoResult(blob, {
    sessionId,
    clientId: session.clientId,
    startedAt: session.createdAt,
    completedAt: null,
  })

  const run = await prisma.crawlRun.findUnique({
    where: { sessionId },
    include: { pages: true, findings: true },
  })
  if (!run) return { ok: false, diffs: ['no CrawlRun for session'] }

  if (run.score !== expected.run.score) diffs.push(`score: tables=${run.score} blob=${expected.run.score}`)
  if (run.pagesTotal !== expected.run.pagesTotal) diffs.push(`pagesTotal: tables=${run.pagesTotal} blob=${expected.run.pagesTotal}`)
  if (run.pages.length !== expected.pages.length) diffs.push(`pages: tables=${run.pages.length} blob=${expected.pages.length}`)

  const storedUrls = new Set(run.pages.map((p) => p.url))
  for (const p of expected.pages) {
    if (!storedUrls.has(p.url)) diffs.push(`missing CrawlPage: ${p.url}`)
  }

  // Field-level finding comparison keyed by dedupKey — a stored row with
  // the right key but wrong count/severity/flags must NOT pass.
  const storedByKey = new Map(run.findings.map((f) => [f.dedupKey, f]))
  const expectedByKey = new Map(expected.findings.map((f) => [f.dedupKey, f]))
  const FIELDS = ['scope', 'type', 'severity', 'url', 'count', 'affectedComplete', 'affectedSource'] as const
  for (const [key, exp] of expectedByKey) {
    const stored = storedByKey.get(key)
    if (!stored) {
      diffs.push(`missing Finding: ${exp.scope}/${exp.type}${exp.url ? ` @ ${exp.url}` : ''}`)
      continue
    }
    for (const field of FIELDS) {
      if (stored[field] !== exp[field]) {
        diffs.push(`Finding ${exp.scope}/${exp.type}${exp.url ? ` @ ${exp.url}` : ''} ${field}: tables=${stored[field]} blob=${exp[field]}`)
      }
    }
  }
  for (const f of run.findings) {
    if (!expectedByKey.has(f.dedupKey)) diffs.push(`extra Finding: ${f.scope}/${f.type}${f.url ? ` @ ${f.url}` : ''}`)
  }

  // severity counts (run-scope rows mirror the blob's issue buckets)
  for (const severity of ['critical', 'warning', 'notice'] as const) {
    const stored = run.findings.filter((f) => f.scope === 'run' && f.severity === severity).length
    const exp = expected.findings.filter((f) => f.scope === 'run' && f.severity === severity).length
    if (stored !== exp) diffs.push(`run-scope ${severity} count: tables=${stored} blob=${exp}`)
  }

  // sampled page scalars: every expected page, compared by url
  const storedPageByUrl = new Map(run.pages.map((p) => [p.url, p]))
  for (const p of expected.pages) {
    const stored = storedPageByUrl.get(p.url)
    if (!stored) continue // already reported as missing above
    for (const field of ['title', 'h1', 'metaDescription', 'wordCount', 'crawlDepth', 'indexable'] as const) {
      if (stored[field] !== p[field]) {
        diffs.push(`CrawlPage ${p.url} ${field}: tables=${stored[field]} blob=${p[field]}`)
      }
    }
  }

  return { ok: diffs.length === 0, diffs }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/parity.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/findings/parity.ts lib/findings/parity.test.ts
git commit -m "feat(findings): SEO blob-vs-tables parity comparator"
```

---

### Task 8: CLI scripts (rebuild + parity)

**Files:**
- Create: `scripts/findings-rebuild.ts`
- Create: `scripts/findings-parity.ts`

No vitest tests — these are thin wrappers over already-tested lib functions;
verified by running them.

- [ ] **Step 1: Write the rebuild script**

```typescript
// scripts/findings-rebuild.ts
//
// Rebuild the findings run for one session from its archived blob.
// Recovery tool for failed dual-writes of NEW (current-format) runs —
// NOT a historical backfill tool.
//
// Usage (local):  DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-rebuild.ts <sessionId>
// Usage (prod):   cd /home/seo/webapps/seo-tools && npx tsx scripts/findings-rebuild.ts <sessionId>
import { prisma } from '../lib/db'
import { writeSeoFindings } from '../lib/findings/seo-write'
import type { AggregatedResult } from '../lib/types'

async function main() {
  const sessionId = process.argv[2]
  if (!sessionId) {
    console.error('Usage: npx tsx scripts/findings-rebuild.ts <sessionId>')
    process.exit(1)
  }
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { result: true, clientId: true, status: true },
  })
  if (!session) throw new Error(`session ${sessionId} not found`)
  if (session.status !== 'complete' || !session.result) {
    throw new Error(`session ${sessionId} is not a completed run with a result blob`)
  }
  const result = JSON.parse(session.result) as AggregatedResult
  await writeSeoFindings(sessionId, result, session.clientId)
  const run = await prisma.crawlRun.findUnique({
    where: { sessionId },
    include: { _count: { select: { pages: true, findings: true } } },
  })
  console.log(`rebuilt run ${run!.id}: ${run!._count.pages} pages, ${run!._count.findings} findings`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Write the parity script**

```typescript
// scripts/findings-parity.ts
//
// Blob-vs-tables parity for one session. Run against production for 3-5
// representative clients before flipping any reader (A2 Phase 3).
//
// Usage: DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-parity.ts <sessionId>
import { prisma } from '../lib/db'
import { compareSeoParity } from '../lib/findings/parity'

async function main() {
  const sessionId = process.argv[2]
  if (!sessionId) {
    console.error('Usage: npx tsx scripts/findings-parity.ts <sessionId>')
    process.exit(1)
  }
  const report = await compareSeoParity(sessionId)
  if (report.ok) {
    console.log(`PARITY OK for session ${sessionId}`)
  } else {
    console.log(`PARITY FAILED for session ${sessionId}:`)
    for (const d of report.diffs) console.log(`  - ${d}`)
    process.exitCode = 1
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 3: Smoke-test both against the dev DB**

```bash
DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-rebuild.ts does-not-exist; echo "exit=$?"
DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-parity.ts does-not-exist; echo "exit=$?"
```

Expected: both print a clear error (`session does-not-exist not found` /
`session missing or has no result blob` → PARITY FAILED) and exit 1. No
stack-trace crashes from missing args handling.

- [ ] **Step 4: Commit**

```bash
git add scripts/findings-rebuild.ts scripts/findings-parity.ts
git commit -m "feat(findings): rebuild + parity CLI scripts"
```

---

### Task 9: Full verification + PR

- [ ] **Step 1: Full test suite**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run`
Expected: all green (1,726 pre-existing + ~21 new). If unrelated queue tests
flake on stray audits, re-run once (known shared-dev-DB sensitivity).

- [ ] **Step 2: Type-check + build**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npm run build
```

Expected: both clean.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/findings-layer-phase1
gh pr create --title "feat(findings): Phase 1 — schema + SEO parser dual-write" --body "$(cat <<'EOF'
## Summary
A2 (normalized findings layer) Phase 1 of 4 — see docs/superpowers/specs/2026-06-10-findings-layer-design.md (Codex-reviewed).

- New tables: CrawlRun / CrawlPage / Finding / Violation (full schema lands now; ADA writes come in Phase 2)
- lib/findings/: dedup keys (sha256 canonical JSON), SEO mapper, idempotent delete-and-recreate writer (array-form txn, 75-row chunks), parity comparator
- Parser dual-write hook after the completion transaction — best-effort, blob stays source of truth, no reader flips
- scripts/findings-rebuild.ts + scripts/findings-parity.ts (tsx CLIs)

## Post-deploy verification
1. Run a fresh parse on a staging/client crawl
2. `npx tsx scripts/findings-parity.ts <sessionId>` on the server → PARITY OK
3. Confirm the parse UX is unchanged (dual-write is non-fatal + post-commit)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope for this plan (later A2 phases)

- **Phase 2:** ADA mappers (`mapAdaChildren`, `mapAdaSingle`), finalizer +
  standalone hooks, ADA parity, severity mapping tests.
- **Phase 3:** production parity on 3–5 clients, SessionPage reader flip.
- **Phase 4:** `pruneArchivedBlobs()` retention (inert activation constants).
