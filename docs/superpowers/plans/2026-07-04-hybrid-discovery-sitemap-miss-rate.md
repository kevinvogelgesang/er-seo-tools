# Hybrid Discovery — Sitemap Miss-Rate Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure, per site audit, how many same-domain URLs are reachable via internal links but absent from the sitemap/discovery baseline — extracted from data the audit already harvests, with zero new fetches — to produce the miss-rate number that gates building a full crawler.

**Architecture:** A pure `computeDiscoveryCoverage` diffs the coverage-normalized internal-link targets (already in `HarvestedLink`) against the coverage-normalized `SiteAudit.discoveredUrls` baseline. The existing post-terminal `broken-link-verify` builder (the single live-scan `CrawlRun` writer) computes it from rows it already loads and stores the result on a new `CrawlRun.discoveryCoverageJson` column. Discovery provenance (`discoveryMode` + `discoveryCapped`) is recorded at every `discoveredUrls` writer so the headline miss-rate is only computed for a real, untruncated sitemap. A new `DiscoveryCoverageSection` renders it read-time on the results page. No new fetches, no new job, no change to the audited page set.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Vitest, Tailwind (class-based dark mode).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-04-hybrid-discovery-sitemap-miss-rate-design.md` (Codex-reviewed accept-with-fixes ×7).
- **NOT a Finding.** The measurement is stored as run metadata (`CrawlRun.discoveryCoverageJson`), never a `Finding` — a `Finding` flows into `priority.service.calculatePriorityScore` where the count-0 scale defaults to 1.0, so even a zero-count finding inflates the roadmap.
- **Coverage normalizer parity is the top correctness risk.** Both the baseline set `B` and the linked set `L` MUST pass through the SAME `normalizeCoverageUrl` (which strips tracking params + non-root trailing slash on top of `normalizeFindingUrl`'s behavior) — `discoverPages` returns UTM-bearing sitemap URLs, so a naive `normalizeFindingUrl` reuse produces false "missed" entries.
- **Honest labeling.** UI copy says "URLs," never "pages" — `internal-link` includes assets/faceted/logout URLs. `L` excludes obvious non-page file extensions.
- **`missRate` denominator:** `|O| / (|B| + |O|)`, bounded [0,1]; `null` when not applicable or denominator is 0.
- **Headline only when trustworthy:** `applicable = mode === 'sitemap' && capped === false`.
- **Migration:** additive nullable columns only; no `ALTER COLUMN` nullability change; no backfill. `migrate dev` is interactive-only here — hand-author `migration.sql` and apply with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`.
- **No subdomain widening**; `internal-link` classification stays exact-host www-insensitive (campaign fence).
- **Test env:** node-only tests start with `// @vitest-environment node`; React render tests start with `// @vitest-environment jsdom` and use `afterEach(cleanup)`. DB-backed tests run with `DATABASE_URL="file:./local-dev.db"`.
- **Gates:** `npm run lint` (tsc) · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build` — all green before PR.

## File Structure

- **Create** `lib/ada-audit/seo/discovery-coverage.ts` — pure `normalizeCoverageUrl` + `computeDiscoveryCoverage` + `DiscoveryCoverage`/`DiscoveryMode` types (Task 1)
- **Create** `lib/ada-audit/seo/discovery-coverage.test.ts` — pure unit tests (Task 1)
- **Modify** `prisma/schema.prisma` — `CrawlRun.discoveryCoverageJson String?`, `SiteAudit.discoveryMode String?`, `SiteAudit.discoveryCapped Boolean?` (Task 2)
- **Create** `prisma/migrations/20260704120000_discovery_coverage/migration.sql` (Task 2)
- **Modify** `lib/findings/types.ts` — add `discoveryCoverageJson?: string | null` to `CrawlRunInput` (Task 2)
- **Modify** `lib/ada-audit/sitemap-crawler.ts` — `discoverPages` returns `{ urls, mode, capped }` (Task 3)
- **Modify** `app/api/site-audit/discover/route.ts` — consume `.urls` (Task 3)
- **Modify** `lib/jobs/handlers/site-audit-discover.ts` — persist `discoveryMode`/`discoveryCapped` from the `discoverPages` result (Task 3)
- **Modify** `lib/ada-audit/queue-manager.ts` — `enqueueAudit` sets `discoveryMode: 'pre-discovered'` when `preDiscoveredUrls` given (Task 3)
- **Modify** `lib/jobs/handlers/broken-link-verify.ts` — select baseline+mode+capped, compute coverage, attach `discoveryCoverageJson` (Task 4)
- **Create** `components/site-audit/DiscoveryCoverageSection.tsx` (Task 5)
- **Create** `components/site-audit/DiscoveryCoverageSection.test.tsx` (Task 5)
- **Modify** `app/ada-audit/site/[id]/page.tsx` — select `discoveryCoverageJson`, render the section (Task 5)

---

### Task 1: Pure `computeDiscoveryCoverage` + coverage normalizer

**Files:**
- Create: `lib/ada-audit/seo/discovery-coverage.ts`
- Test: `lib/ada-audit/seo/discovery-coverage.test.ts`

**Interfaces:**
- Consumes: `normalizeFindingUrl` from `lib/findings/normalize-url.ts`
- Produces:
  ```ts
  export type DiscoveryMode = 'sitemap' | 'shallow-crawl' | 'pre-discovered'
  export interface DiscoveryCoverageInput {
    discoveredUrls: string[]
    internalLinks: Array<{ sourcePageUrl: string; targetUrl: string }>
    discoveryMode: DiscoveryMode | null
    discoveryCapped: boolean
  }
  export interface DiscoveryCoverageSampleEntry { targetUrl: string; sourcePageUrls: string[] }
  export interface DiscoveryCoverage {
    mode: DiscoveryMode | null
    capped: boolean
    applicable: boolean
    discoveredCount: number
    linkedInternalCount: number
    offBaselineCount: number
    missRate: number | null
    sample: DiscoveryCoverageSampleEntry[]
  }
  export function normalizeCoverageUrl(url: string): string
  export function computeDiscoveryCoverage(input: DiscoveryCoverageInput): DiscoveryCoverage
  ```

- [ ] **Step 1: Write the failing tests**

Create `lib/ada-audit/seo/discovery-coverage.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { normalizeCoverageUrl, computeDiscoveryCoverage } from './discovery-coverage'

describe('normalizeCoverageUrl', () => {
  it('strips fragment, tracking params, and non-root trailing slash; lowercases host', () => {
    expect(normalizeCoverageUrl('https://Example.com/Foo/#x')).toBe('https://example.com/Foo')
    expect(normalizeCoverageUrl('https://example.com/foo/?utm_source=n&a=b')).toBe(
      'https://example.com/foo?a=b',
    )
    expect(normalizeCoverageUrl('https://example.com/')).toBe('https://example.com')
  })
  it('passes non-URLs through unchanged', () => {
    expect(normalizeCoverageUrl('not a url')).toBe('not a url')
  })
  it('treats query-param order and index.html as intentionally DISTINCT (v1 accepted, Codex fix #5)', () => {
    // Documenting non-goals: we do not sort query params or collapse index.html.
    // Acceptable because both sides normalize identically; residual mismatches
    // only slightly inflate offBaselineCount and are rare in practice.
    expect(normalizeCoverageUrl('https://example.com/p?a=1&b=2')).not.toBe(
      normalizeCoverageUrl('https://example.com/p?b=2&a=1'),
    )
    expect(normalizeCoverageUrl('https://example.com/index.html')).not.toBe(
      normalizeCoverageUrl('https://example.com'),
    )
  })
})

describe('computeDiscoveryCoverage', () => {
  const base = {
    discoveryMode: 'sitemap' as const,
    discoveryCapped: false,
  }

  it('counts off-baseline internal links absent from the sitemap', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://example.com/a', 'https://example.com/b'],
      internalLinks: [
        { sourcePageUrl: 'https://example.com/a', targetUrl: 'https://example.com/b' }, // in baseline
        { sourcePageUrl: 'https://example.com/a', targetUrl: 'https://example.com/c' }, // OFF baseline
        { sourcePageUrl: 'https://example.com/b', targetUrl: 'https://example.com/c/' }, // same as /c after norm
      ],
    })
    expect(r.discoveredCount).toBe(2)
    expect(r.linkedInternalCount).toBe(2) // /b and /c (deduped after norm)
    expect(r.offBaselineCount).toBe(1) // only /c
    expect(r.missRate).toBeCloseTo(1 / 3) // 1 / (2 + 1)
    expect(r.applicable).toBe(true)
    expect(r.sample).toEqual([
      { targetUrl: 'https://example.com/c', sourcePageUrls: ['https://example.com/a', 'https://example.com/b'] },
    ])
  })

  it('normalization parity: UTM/slash variants do not masquerade as missed', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://example.com/p?utm_source=news'], // baseline has UTM
      internalLinks: [{ sourcePageUrl: 'https://example.com/x', targetUrl: 'https://example.com/p/' }], // clean + slash
    })
    expect(r.offBaselineCount).toBe(0)
    expect(r.missRate).toBe(0)
  })

  it('excludes images and non-page file extensions from L', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://example.com/a'],
      internalLinks: [
        { sourcePageUrl: 'https://example.com/a', targetUrl: 'https://example.com/doc.pdf' },
        { sourcePageUrl: 'https://example.com/a', targetUrl: 'https://example.com/style.css' },
      ],
    })
    expect(r.offBaselineCount).toBe(0)
    expect(r.linkedInternalCount).toBe(0)
  })

  it('is not applicable and yields null missRate for shallow-crawl mode', () => {
    const r = computeDiscoveryCoverage({
      discoveryMode: 'shallow-crawl',
      discoveryCapped: false,
      discoveredUrls: ['https://example.com/a'],
      internalLinks: [{ sourcePageUrl: 'https://example.com/a', targetUrl: 'https://example.com/z' }],
    })
    expect(r.applicable).toBe(false)
    expect(r.missRate).toBeNull()
    expect(r.offBaselineCount).toBe(1) // raw count still computed
  })

  it('is not applicable when the sitemap baseline was capped', () => {
    const r = computeDiscoveryCoverage({
      discoveryMode: 'sitemap',
      discoveryCapped: true,
      discoveredUrls: ['https://example.com/a'],
      internalLinks: [{ sourcePageUrl: 'https://example.com/a', targetUrl: 'https://example.com/z' }],
    })
    expect(r.applicable).toBe(false)
    expect(r.missRate).toBeNull()
  })

  it('caps the sample at 50 targets and 5 source pages per target, deterministically ordered', () => {
    const internalLinks = []
    for (let i = 0; i < 60; i++) {
      for (let s = 0; s < 8; s++) {
        internalLinks.push({
          sourcePageUrl: `https://example.com/src${String(s).padStart(2, '0')}`,
          targetUrl: `https://example.com/off${String(i).padStart(3, '0')}`,
        })
      }
    }
    const r = computeDiscoveryCoverage({ ...base, discoveredUrls: [], internalLinks })
    expect(r.offBaselineCount).toBe(60)
    expect(r.sample).toHaveLength(50)
    expect(r.sample[0].targetUrl).toBe('https://example.com/off000') // sorted
    expect(r.sample[0].sourcePageUrls).toHaveLength(5)
    expect(r.sample[0].sourcePageUrls[0]).toBe('https://example.com/src00') // sorted
  })

  it('handles empty inputs without throwing', () => {
    const r = computeDiscoveryCoverage({ ...base, discoveredUrls: [], internalLinks: [] })
    expect(r).toMatchObject({ discoveredCount: 0, linkedInternalCount: 0, offBaselineCount: 0, missRate: 0 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts`
Expected: FAIL — `Failed to resolve import "./discovery-coverage"` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `lib/ada-audit/seo/discovery-coverage.ts`:

```ts
// lib/ada-audit/seo/discovery-coverage.ts
//
// Hybrid-discovery Increment 1: pure sitemap miss-rate measurement.
// Diffs the coverage-normalized internal-link targets the ADA audit already
// harvested against the coverage-normalized discovery baseline. ZERO new
// fetches. NOT a Finding (would inflate priority.service) — the caller stores
// the result on CrawlRun.discoveryCoverageJson.
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'

export type DiscoveryMode = 'sitemap' | 'shallow-crawl' | 'pre-discovered'

export interface DiscoveryCoverageInput {
  discoveredUrls: string[]
  internalLinks: Array<{ sourcePageUrl: string; targetUrl: string }>
  discoveryMode: DiscoveryMode | null
  discoveryCapped: boolean
}

export interface DiscoveryCoverageSampleEntry {
  targetUrl: string
  sourcePageUrls: string[]
}

export interface DiscoveryCoverage {
  mode: DiscoveryMode | null
  capped: boolean
  applicable: boolean
  discoveredCount: number
  linkedInternalCount: number
  offBaselineCount: number
  missRate: number | null
  sample: DiscoveryCoverageSampleEntry[]
}

const SAMPLE_CAP = 50
const SOURCES_PER_TARGET = 5

// Tracking params `discoverPages` strips for dedup but does NOT remove from the
// URL it returns — so a sitemap URL with ?utm_* would fail to match a clean
// harvested link without stripping them here on BOTH sides.
const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']

// Obvious non-page targets an <a href> may point at. Excluded from L so assets
// never count as "missed pages". Extension checked on the pathname only.
const NON_PAGE_EXT = /\.(pdf|zip|gz|jpe?g|png|gif|svg|webp|ico|docx?|xlsx?|pptx?|mp4|mp3|wav|css|js|mjs|json|xml|rss|txt|csv)$/i

/**
 * Coverage-specific normalizer applied identically to baseline + linked sets.
 * Builds on normalizeFindingUrl's intent (lowercase host, drop fragment) and
 * additionally strips tracking params + trailing slash on ANY path.
 */
export function normalizeCoverageUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return normalizeFindingUrl(url) // non-URL passes through there too
  }
  u.hash = ''
  for (const p of TRACKING_PARAMS) u.searchParams.delete(p)
  if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '')
  let out = u.toString()
  if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '')
  return out
}

function isNonPage(normalizedUrl: string): boolean {
  try {
    return NON_PAGE_EXT.test(new URL(normalizedUrl).pathname)
  } catch {
    return false
  }
}

export function computeDiscoveryCoverage(input: DiscoveryCoverageInput): DiscoveryCoverage {
  const { discoveredUrls, internalLinks, discoveryMode, discoveryCapped } = input

  const baseline = new Set(discoveredUrls.map(normalizeCoverageUrl))

  // Map normalized off-baseline target -> sorted unique source pages.
  const linked = new Set<string>()
  const offSources = new Map<string, Set<string>>()
  for (const link of internalLinks) {
    const target = normalizeCoverageUrl(link.targetUrl)
    if (isNonPage(target)) continue
    linked.add(target)
    if (!baseline.has(target)) {
      let sources = offSources.get(target)
      if (!sources) {
        sources = new Set<string>()
        offSources.set(target, sources)
      }
      sources.add(normalizeCoverageUrl(link.sourcePageUrl))
    }
  }

  const discoveredCount = baseline.size
  const linkedInternalCount = linked.size
  const offBaselineCount = offSources.size

  const applicable = discoveryMode === 'sitemap' && discoveryCapped === false
  const denom = discoveredCount + offBaselineCount
  const missRate = applicable ? (denom === 0 ? 0 : offBaselineCount / denom) : null

  const sample: DiscoveryCoverageSampleEntry[] = [...offSources.keys()]
    .sort()
    .slice(0, SAMPLE_CAP)
    .map((targetUrl) => ({
      targetUrl,
      sourcePageUrls: [...offSources.get(targetUrl)!].sort().slice(0, SOURCES_PER_TARGET),
    }))

  return {
    mode: discoveryMode,
    capped: discoveryCapped,
    applicable,
    discoveredCount,
    linkedInternalCount,
    offBaselineCount,
    missRate,
    sample,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/discovery-coverage.ts lib/ada-audit/seo/discovery-coverage.test.ts
git commit -m "feat(discovery-coverage): pure sitemap miss-rate function + coverage normalizer"
```

---

### Task 2: Schema columns + migration + `CrawlRunInput` field

**Files:**
- Modify: `prisma/schema.prisma` (CrawlRun ~line 369; SiteAudit — near `discoveredUrls` at line 141)
- Create: `prisma/migrations/20260704120000_discovery_coverage/migration.sql`
- Modify: `lib/findings/types.ts:42-43` (add field to `CrawlRunInput`)
- Test: `lib/findings/writer.discovery-coverage.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `CrawlRun.discoveryCoverageJson` column, `SiteAudit.discoveryMode` + `SiteAudit.discoveryCapped` columns, `CrawlRunInput.discoveryCoverageJson?: string | null`. Because `writer.ts` does `crawlRun.create({ data: { ...run, ... } })`, the new field persists with **no writer.ts code change**.

- [ ] **Step 1: Write the failing test**

Create `lib/findings/writer.discovery-coverage.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from './writer'
import type { CrawlRunInput } from './types'

function baseRun(siteAuditId: string): CrawlRunInput {
  return {
    id: randomUUID(), tool: 'seo-parser', source: 'live-scan', domain: 'example.com',
    clientId: null, sessionId: null, siteAuditId, adaAuditId: null, status: 'complete',
    score: null, scoreBreakdown: null, wcagLevel: null, pagesTotal: 0,
    startedAt: null, completedAt: null,
  }
}

describe('writeFindingsRun persists discoveryCoverageJson', () => {
  let siteAuditId: string
  beforeEach(async () => {
    const audit = await prisma.siteAudit.create({
      data: { domain: 'example.com', status: 'complete', wcagLevel: 'wcag21aa' },
    })
    siteAuditId = audit.id
  })

  it('round-trips the discoveryCoverageJson column', async () => {
    const json = JSON.stringify({ missRate: 0.25, offBaselineCount: 3 })
    await writeFindingsRun({
      run: { ...baseRun(siteAuditId), discoveryCoverageJson: json },
      pages: [], findings: [], violations: [],
    })
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { discoveryCoverageJson: true },
    })
    expect(run?.discoveryCoverageJson).toBe(json)
  })

  it('leaves the column null when the field is omitted', async () => {
    await writeFindingsRun({ run: baseRun(siteAuditId), pages: [], findings: [], violations: [] })
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { discoveryCoverageJson: true },
    })
    expect(run?.discoveryCoverageJson).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/writer.discovery-coverage.test.ts`
Expected: FAIL — TS/Prisma error: `discoveryCoverageJson` is not a known property (schema + type not yet added).

- [ ] **Step 3a: Add the schema columns**

In `prisma/schema.prisma`, add to `model CrawlRun` (after `archivePrunedAt DateTime?`, ~line 369):

```prisma
  discoveryCoverageJson String?   // C6 hybrid-discovery Increment 1: sitemap miss-rate metrics (live-scan runs only)
```

In `model SiteAudit`, add near the `discoveredUrls` field (line 141):

```prisma
  discoveryMode         String?   // 'sitemap' | 'shallow-crawl' | 'pre-discovered' — discovery provenance
  discoveryCapped       Boolean?  // true = discovery hit the 1000-page HARD_CAP (miss-rate not applicable)
```

- [ ] **Step 3b: Author and apply the migration**

Create `prisma/migrations/20260704120000_discovery_coverage/migration.sql`:

```sql
-- C6 hybrid-discovery Increment 1: sitemap miss-rate measurement (additive, nullable).
ALTER TABLE "CrawlRun" ADD COLUMN "discoveryCoverageJson" TEXT;
ALTER TABLE "SiteAudit" ADD COLUMN "discoveryMode" TEXT;
ALTER TABLE "SiteAudit" ADD COLUMN "discoveryCapped" BOOLEAN;
```

Apply locally + regenerate the client:

```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: "1 migration applied" (or "following migration(s) applied"), client regenerated.

- [ ] **Step 3c: Add the `CrawlRunInput` field**

In `lib/findings/types.ts`, add after line 43 (`scoreBreakdown?: ...`):

```ts
  discoveryCoverageJson?: string | null   // C6 hybrid-discovery: live-scan runs only
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/writer.discovery-coverage.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260704120000_discovery_coverage/migration.sql lib/findings/types.ts lib/findings/writer.discovery-coverage.test.ts
git commit -m "feat(discovery-coverage): schema columns + CrawlRunInput.discoveryCoverageJson"
```

---

### Task 3: `discoverPages` provenance + record `discoveryMode`/`discoveryCapped`

**Files:**
- Modify: `lib/ada-audit/sitemap-crawler.ts:236-304`
- Modify: `app/api/site-audit/discover/route.ts:31`
- Modify: `lib/jobs/handlers/site-audit-discover.ts:106-138`
- Modify: `lib/ada-audit/queue-manager.ts:108-121`
- Test: `lib/jobs/handlers/site-audit-discover.discovery-mode.test.ts`

**Interfaces:**
- Consumes: `DiscoveryMode` from `lib/ada-audit/seo/discovery-coverage.ts` (Task 1)
- Produces: `discoverPages(domain): Promise<{ urls: string[]; mode: 'sitemap' | 'shallow-crawl'; capped: boolean }>`. The discover job persists `discoveryMode` + `discoveryCapped`; `enqueueAudit` sets `discoveryMode: 'pre-discovered'` for pre-seeded audits.

> **Note (accepted v1 limitation — Codex fix #1, verified against code):** two flows produce `preDiscoveredUrls` → `'pre-discovered'` → miss-rate "not applicable":
> 1. The manual UI flow calls `/api/site-audit/discover` then submits the URLs as `preDiscoveredUrls`.
> 2. **`queueSiteAuditRequest` (`lib/ada-audit/queue-request.ts:50-77`) injects `Client.seedUrls` as `preDiscoveredUrls` for ANY client that has them** — including scheduled `seoIntent` audits (`scheduled-site-audit.ts:110` routes through it). So a seed-url client's scheduled audit is `pre-discovered`, NOT sitemap-measured.
>
> **Decision: do NOT bypass seedUrls for `seoIntent` audits.** seedUrls change which pages get audited (they exist precisely for clients whose sitemap is inadequate); forcing sitemap discovery would alter the audited set and reduce coverage for exactly those clients — violating the spec's "no change to the audited set." A seed-url baseline is a manual curated list, so a *sitemap* miss-rate is genuinely undefined there; `'pre-discovered'`/"not applicable" is the honest label. The raw `offBaselineCount` is still stored in the JSON for future analysis; only the headline is suppressed. The campaign's clean measurement population is clients **without** seedUrls (sitemap-discovered → `'sitemap'`). **Kevin follow-up (non-blocking, surfaced at hand-off):** check how many campaign clients have `Client.seedUrls` — if most do, the gate will have few applicable data points and we may want a separate "seed-baseline coverage" variant later.

- [ ] **Step 1: Write the failing test**

Create `lib/jobs/handlers/site-audit-discover.discovery-mode.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'

// Mock discoverPages so the handler runs without network.
vi.mock('@/lib/ada-audit/sitemap-crawler', () => ({
  discoverPages: vi.fn(async () => ({
    urls: ['https://example.com/a', 'https://example.com/b'],
    mode: 'sitemap' as const,
    capped: false,
  })),
}))

import { runSiteAuditDiscoverJob } from './site-audit-discover'

describe('site-audit-discover records discovery provenance', () => {
  let siteAuditId: string
  beforeEach(async () => {
    const audit = await prisma.siteAudit.create({
      data: { domain: 'example.com', status: 'running', wcagLevel: 'wcag21aa' },
    })
    siteAuditId = audit.id
  })

  it('persists discoveryMode=sitemap and discoveryCapped=false from discoverPages', async () => {
    await runSiteAuditDiscoverJob({ siteAuditId } as any)
    const audit = await prisma.siteAudit.findUnique({
      where: { id: siteAuditId },
      select: { discoveryMode: true, discoveryCapped: true, pagesTotal: true },
    })
    expect(audit?.discoveryMode).toBe('sitemap')
    expect(audit?.discoveryCapped).toBe(false)
    expect(audit?.pagesTotal).toBe(2)
  })
})
```

> Adjust the `runSiteAuditDiscoverJob` call shape and the job-arg type to match the handler's real export signature (the extractor confirmed the handler claims the row itself via raw SQL; if the test needs the row already `running` and the claim to succeed, seed accordingly). The assertion — `discoveryMode`/`discoveryCapped` persisted — is the deliverable.

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-discover.discovery-mode.test.ts`
Expected: FAIL — `discoverPages` still returns `string[]` (the `.urls` access / mode persist not wired), or `discoveryMode` is null.

- [ ] **Step 3a: Change `discoverPages` return shape** (`lib/ada-audit/sitemap-crawler.ts`)

Change the signature (line 236):

```ts
export async function discoverPages(
  domain: string,
): Promise<{ urls: string[]; mode: 'sitemap' | 'shallow-crawl'; capped: boolean }> {
```

Change the shallow-crawl return (line 288):

```ts
    return { urls: crawledPages, mode: 'shallow-crawl', capped: false }
```

Change the sitemap filter/return block (lines 291-303):

```ts
  // 5. Filter to same domain, deduplicate, apply hard cap
  const deduped = dedupeUrls(allPageUrls.filter((u) => isSameDomain(u, normDomain)))
  const filtered = deduped.slice(0, HARD_CAP)

  if (filtered.length === 0) {
    throw new Error(
      `Sitemap was found but contained no pages for ${normDomain}. ` +
      `It may only list pages from a different domain.`
    )
  }

  return { urls: filtered, mode: 'sitemap', capped: deduped.length > HARD_CAP }
```

- [ ] **Step 3b: Update the discover route** (`app/api/site-audit/discover/route.ts:31-32`)

```ts
    const { urls } = await discoverPages(domain)
    return NextResponse.json({ domain, pageCount: urls.length, urls })
```

- [ ] **Step 3c: Persist provenance in the discover job** (`lib/jobs/handlers/site-audit-discover.ts`)

Replace the discovery + first persist (lines 106-125) so it captures mode/capped and writes them with `discoveredUrls`:

```ts
  let urls = parseUrlList(audit.discoveredUrls)
  if (urls === null) {
    const result = await discoverPages(audit.domain)
    const discovered = [...new Set(result.urls)]
    const persisted = await prisma.siteAudit.updateMany({
      where: { id: siteAuditId, discoveredUrls: null },
      data: {
        discoveredUrls: JSON.stringify(discovered),
        pagesTotal: discovered.length,
        discoveryMode: result.mode,
        discoveryCapped: result.capped,
      },
    })
    if (persisted.count === 1) {
      urls = discovered
    } else {
      const reread = await prisma.siteAudit.findUnique({
        where: { id: siteAuditId },
        select: { discoveredUrls: true },
      })
      urls = parseUrlList(reread?.discoveredUrls ?? null) ?? discovered
    }
  }
```

Leave the ensure-write (lines 135-138) unchanged — it re-stores `discoveredUrls`/`pagesTotal` only; `discoveryMode`/`discoveryCapped` are set once above and never need re-writing.

- [ ] **Step 3d: Set `'pre-discovered'` in `enqueueAudit`** (`lib/ada-audit/queue-manager.ts:108-121`)

Add `discoveryMode` to the `prisma.siteAudit.create` data:

```ts
      discoveredUrls: preDiscoveredUrls ? JSON.stringify(preDiscoveredUrls) : null,
      pagesTotal: preDiscoveredUrls ? preDiscoveredUrls.length : 0,
      discoveryMode: preDiscoveredUrls ? 'pre-discovered' : null,
```

- [ ] **Step 3e: Add a seedUrls-provenance test** (Codex fix #6)

Append to `lib/jobs/handlers/site-audit-discover.discovery-mode.test.ts` (or a sibling `queue-request` test) a case asserting the pre-discovered path. `queueSiteAuditRequest` (`lib/ada-audit/queue-request.ts`) injects `Client.seedUrls` → `enqueueAudit({ preDiscoveredUrls })` → `discoveryMode: 'pre-discovered'`:

```ts
// @vitest-environment node
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'
// ...
it('a client with seedUrls yields discoveryMode=pre-discovered', async () => {
  const client = await prisma.client.create({
    data: { name: 'Seeded', domains: JSON.stringify(['seeded.com']),
            seedUrls: JSON.stringify(['https://seeded.com/x', 'https://seeded.com/y']) },
  })
  const res = await queueSiteAuditRequest({ domain: 'seeded.com', clientId: client.id, wcagLevel: 'wcag21aa' })
  const audit = await prisma.siteAudit.findUnique({
    where: { id: res.id }, select: { discoveryMode: true },
  })
  expect(audit?.discoveryMode).toBe('pre-discovered')
})
```

> Match `queueSiteAuditRequest`'s real `QueueRequestInput` shape (`lib/ada-audit/queue-request.ts:27,35`) — the fields above are illustrative.

- [ ] **Step 4: Run the tests + update the existing `discoverPages` tests** (Codex fix #4)

The direct `discoverPages` expectations in `lib/ada-audit/sitemap-crawler.test.ts` (the SSRF / browser-fallback / success cases, around line 422) assert on a bare array return — update each to destructure `{ urls, mode, capped }` and assert `urls` plus the new `mode`/`capped` values (sitemap-success → `mode:'sitemap'`; fallback → `mode:'shallow-crawl'`; a >1000-URL sitemap fixture → `capped:true`).

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-discover.discovery-mode.test.ts lib/ada-audit/sitemap-crawler lib/jobs/handlers/site-audit-discover lib/ada-audit/queue-request`
Expected: PASS (all, including the updated existing expectations).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/sitemap-crawler.ts app/api/site-audit/discover/route.ts lib/jobs/handlers/site-audit-discover.ts lib/ada-audit/queue-manager.ts lib/jobs/handlers/site-audit-discover.discovery-mode.test.ts
git commit -m "feat(discovery-coverage): discoverPages returns {urls,mode,capped}; record provenance at all discoveredUrls writers"
```

---

### Task 4: Builder computes + attaches `discoveryCoverageJson`

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (SiteAudit load 108-111; run assembly 393-401)
- Test: `lib/jobs/handlers/broken-link-verify.discovery-coverage.test.ts`

**Interfaces:**
- Consumes: `computeDiscoveryCoverage` (Task 1), `SiteAudit.discoveredUrls`/`discoveryMode`/`discoveryCapped` (Task 3), `CrawlRunInput.discoveryCoverageJson` (Task 2). Reuses the already-loaded `rows` (`HarvestedLink` internal+image) — no new query; filter to `kind === 'internal-link'`.
- Produces: the live-scan `CrawlRun.discoveryCoverageJson` is populated on every build.

- [ ] **Step 1: Write the failing test**

Create `lib/jobs/handlers/broken-link-verify.discovery-coverage.test.ts`. Mirror the setup of the existing `broken-link-verify` builder tests (seed a complete `SiteAudit` with `HarvestedLink` rows, invoke the handler with injected deps, assert on the written live-scan run). Core assertion:

```ts
// @vitest-environment node
// ...standard builder-test scaffolding (see sibling broken-link-verify.*.test.ts)...
it('writes discoveryCoverageJson with the off-baseline count for a sitemap audit', async () => {
  // Seed: complete SiteAudit, discoveredUrls=['https://d/a'], discoveryMode='sitemap',
  // discoveryCapped=false; HarvestedLink internal-link rows: /a (in baseline) and /z (off).
  await runBrokenLinkVerifyJob({ siteAuditId, domain: 'd' } as any, injectedDeps)
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
    select: { discoveryCoverageJson: true },
  })
  const cov = JSON.parse(run!.discoveryCoverageJson!)
  expect(cov.offBaselineCount).toBe(1)
  expect(cov.applicable).toBe(true)
  expect(cov.mode).toBe('sitemap')
})
```

> Use the exact handler export name + injected-deps shape from the sibling `broken-link-verify` tests. Also add an assertion that no `Finding` row with a discovery-coverage `type` exists (the measurement must never be a finding).

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.discovery-coverage.test.ts`
Expected: FAIL — `discoveryCoverageJson` is null (builder doesn't compute it yet).

- [ ] **Step 3a: Select the baseline + provenance** — extend the SiteAudit load (line 110):

```ts
  const site = await prisma.siteAudit.findUnique({
    where: { id: job.siteAuditId },
    select: {
      id: true, domain: true, clientId: true, pagesTotal: true, pagesError: true, seoIntent: true,
      discoveredUrls: true, discoveryMode: true, discoveryCapped: true,
    },
  })
```

- [ ] **Step 3b: Compute coverage** — just before the `const bundle: FindingsBundle = {` assembly (line 393), add:

```ts
  // C6 hybrid-discovery Increment 1: sitemap miss-rate from already-harvested
  // internal links vs the discovery baseline. ZERO new fetches. NOT a Finding.
  const discoveredUrls = safeParseUrlList(site.discoveredUrls)
  const coverage = computeDiscoveryCoverage({
    discoveredUrls,
    internalLinks: rows
      .filter((r) => r.kind === 'internal-link')
      .map((r) => ({ sourcePageUrl: r.sourcePageUrl, targetUrl: r.targetUrl })),
    discoveryMode: (site.discoveryMode as DiscoveryMode | null) ?? null,
    discoveryCapped: site.discoveryCapped ?? false,
  })
```

Add the import + a local parse helper near the top of the file (Codex fix #2: `parseUrlList` is **private** to `site-audit-discover.ts` — do not import it; define a local one):

```ts
import { computeDiscoveryCoverage, type DiscoveryMode } from '@/lib/ada-audit/seo/discovery-coverage'

function safeParseUrlList(json: string | null): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
```

- [ ] **Step 3c: Attach to the run** — in the `run:` object (lines 394-401), add:

```ts
      discoveryCoverageJson: JSON.stringify(coverage),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.discovery-coverage.test.ts`
Expected: PASS. Then run the full builder suite to confirm no regression:
`DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.discovery-coverage.test.ts
git commit -m "feat(discovery-coverage): builder computes + stores sitemap miss-rate on the live-scan run"
```

---

### Task 5: `DiscoveryCoverageSection` + results-page wiring

**Files:**
- Create: `components/site-audit/DiscoveryCoverageSection.tsx`
- Test: `components/site-audit/DiscoveryCoverageSection.test.tsx`
- Modify: `app/ada-audit/site/[id]/page.tsx` (select at ~166-173; render at ~215-224)

**Interfaces:**
- Consumes: a `run` object exposing `discoveryCoverageJson: string | null` (parsed client-side).
- Produces: `DiscoveryCoverageSection({ run }: { run: { discoveryCoverageJson: string | null } | null })`.

- [ ] **Step 1: Write the failing test**

Create `components/site-audit/DiscoveryCoverageSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DiscoveryCoverageSection } from './DiscoveryCoverageSection'

afterEach(cleanup)

const cov = (o: object) => ({ discoveryCoverageJson: JSON.stringify(o) })

describe('DiscoveryCoverageSection', () => {
  it('renders nothing when run is null or column is absent', () => {
    const { container } = render(<DiscoveryCoverageSection run={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the off-sitemap count + rate for an applicable measurement', () => {
    render(
      <DiscoveryCoverageSection
        run={cov({ applicable: true, mode: 'sitemap', capped: false, discoveredCount: 10, offBaselineCount: 3, missRate: 0.23, sample: [] })}
      />,
    )
    expect(screen.getByText(/3 additional same-domain URLs/i)).toBeInTheDocument()
    expect(screen.getByText(/23%/)).toBeInTheDocument()
  })

  it('shows "not applicable" for shallow-crawl / capped', () => {
    render(<DiscoveryCoverageSection run={cov({ applicable: false, mode: 'shallow-crawl', capped: false, offBaselineCount: 5, missRate: null, sample: [] })} />)
    expect(screen.getByText(/not measured/i)).toBeInTheDocument()
  })

  it('shows a clean state when nothing is off-sitemap', () => {
    render(<DiscoveryCoverageSection run={cov({ applicable: true, mode: 'sitemap', capped: false, discoveredCount: 8, offBaselineCount: 0, missRate: 0, sample: [] })} />)
    expect(screen.getByText(/every internally-linked URL was in the sitemap/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/DiscoveryCoverageSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `components/site-audit/DiscoveryCoverageSection.tsx`:

```tsx
// components/site-audit/DiscoveryCoverageSection.tsx
//
// C6 hybrid-discovery Increment 1: read-time sitemap miss-rate. Reads the SAME
// live-scan CrawlRun as BrokenLinksSection/OnPageSeoSection, from the
// discoveryCoverageJson column. Measurement, NOT a finding — never feeds
// priority scoring. Copy says "URLs" not "pages" (internal-link may be assets).
import React from 'react'

// Local Card wrapper — matches BrokenLinksSection/OnPageSeoSection exactly
// (there is no shared components/ui/Card in this repo).
function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      {children}
    </section>
  )
}

interface CoverageData {
  mode: 'sitemap' | 'shallow-crawl' | 'pre-discovered' | null
  capped: boolean
  applicable: boolean
  discoveredCount: number
  linkedInternalCount: number
  offBaselineCount: number
  missRate: number | null
  sample: Array<{ targetUrl: string; sourcePageUrls: string[] }>
}

export function DiscoveryCoverageSection({
  run,
}: {
  run: { discoveryCoverageJson: string | null } | null
}) {
  if (!run?.discoveryCoverageJson) return null
  let data: CoverageData
  try {
    data = JSON.parse(run.discoveryCoverageJson)
  } catch {
    return null
  }

  const heading = (
    <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white">
      Discovery coverage
    </h2>
  )

  if (!data.applicable) {
    return (
      <Card>
        {heading}
        <p className="mt-1 text-[13px] font-body text-navy/50 dark:text-white/50">
          Discovery coverage not measured (no sitemap was used, or the sitemap exceeded the
          1,000-URL cap).
        </p>
      </Card>
    )
  }

  if (data.offBaselineCount === 0) {
    return (
      <Card>
        {heading}
        <p className="mt-1 text-[13px] font-body text-navy/70 dark:text-white/70">
          No off-sitemap URLs found — every internally-linked URL was in the sitemap
          ({data.discoveredCount} listed).
        </p>
      </Card>
    )
  }

  const pct = data.missRate != null ? Math.round(data.missRate * 100) : 0
  return (
    <Card>
      {heading}
      <p className="mt-1 text-[13px] font-body text-navy/70 dark:text-white/70">
        Sitemap listed {data.discoveredCount} same-domain URLs.{' '}
        <span className="font-semibold text-navy dark:text-white">
          {data.offBaselineCount} additional same-domain URLs
        </span>{' '}
        were linked from audited pages but absent from the sitemap ({pct}% off-sitemap).
      </p>
      {data.sample.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[13px] font-body text-navy/60 dark:text-white/60">
            Show {data.sample.length} example URL{data.sample.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1 space-y-1">
            {data.sample.map((s) => (
              <li key={s.targetUrl} className="text-[12px] font-mono text-navy/70 dark:text-white/70 break-all">
                {s.targetUrl}
                {s.sourcePageUrls.length > 0 && (
                  <span className="text-navy/40 dark:text-white/40">
                    {' '}← {s.sourcePageUrls[0]}
                    {s.sourcePageUrls.length > 1 ? ` (+${s.sourcePageUrls.length - 1})` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}
```

> Codex fix #3: there is NO `@/components/ui/Card` — `BrokenLinksSection`, `OnPageSeoSection`, and `TechnicalSeoSection` each define a local `Card` wrapper (`<section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">`). The component above inlines that exact wrapper; do not import a shared Card.

- [ ] **Step 4a: Run the component test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/DiscoveryCoverageSection.test.tsx`
Expected: PASS.

- [ ] **Step 4b: Wire into the results page** (`app/ada-audit/site/[id]/page.tsx`)

Add to the `liveScanRun` select (after `scoreBreakdown: true,`, ~line 169):

```ts
      discoveryCoverageJson: true,
```

Add the import (near line 10):

```ts
import { DiscoveryCoverageSection } from '@/components/site-audit/DiscoveryCoverageSection'
```

Render it beside the others (after `<OnPageSeoSection ... />`, ~line 224):

```tsx
      <DiscoveryCoverageSection run={liveScanRun} />
```

- [ ] **Step 4c: Verify the page type-checks and gates pass**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add components/site-audit/DiscoveryCoverageSection.tsx components/site-audit/DiscoveryCoverageSection.test.tsx app/ada-audit/site/[id]/page.tsx
git commit -m "feat(discovery-coverage): DiscoveryCoverageSection + results-page wiring"
```

---

## Codex review (2026-07-04) — accept-with-fixes ×6, all applied

1. **Task 3 seedUrls caveat** — `queueSiteAuditRequest` injects `Client.seedUrls`, so seed-url `seoIntent` audits are `pre-discovered`. Corrected the note; decision = don't bypass seedUrls (preserve audited set), accept N/A, test it. Kevin follow-up flagged.
2. **Task 4 `parseUrlList`** — it's private to `site-audit-discover.ts`; replaced with a local `safeParseUrlList`.
3. **Task 5 `Card`** — no `@/components/ui/Card`; inlined the local `<section>` wrapper the sibling sections use.
4. **Task 3 existing tests** — enumerated the `sitemap-crawler.test.ts` return-shape updates explicitly.
5. **Task 1** — added tests documenting query-order + `index.html` as intentionally distinct (v1 accepted).
6. **Task 3** — added a `queueSiteAuditRequest`-seedUrls → `pre-discovered` provenance test.

Non-blocking (Codex "verify"): shallow-crawl needs no cap signal (never applicable → `capped:false` fine); `liveScanRun` gains `discoveryCoverageJson` via Task 5 select and structural typing lets it pass where `BrokenLinksRun` is expected (no widening).

## Self-Review

**Spec coverage:**
- §2/§4 pure diff + coverage normalizer + non-page exclusion + honest labeling → Task 1. ✓
- §5 not-a-Finding + JSON column + writer plumbing → Task 2 (storage) + Task 4 (builder writes it, never a Finding; test asserts no finding). ✓
- §6 discoveryMode/discoveryCapped across all writers + sitemap-cap provenance → Task 3. ✓
- §7 sibling `DiscoveryCoverageSection` + all UI states → Task 5. ✓
- §11 additive nullable migration + `CrawlRunInput`/writer → Task 2. ✓
- §10 testing (pure/builder/migration/UI/discoverPages-mode) → Tasks 1,2,3,4,5. ✓

**Placeholder scan:** The three `>` notes ("adjust to the real handler signature", "confirm parseUrlList import", "confirm Card path") point the implementer at sibling files to copy exact shapes — the deliverable + assertions are concrete. These are seam-confirmation notes, not deferred work.

**Type consistency:** `DiscoveryMode`, `DiscoveryCoverage`, `computeDiscoveryCoverage`, `normalizeCoverageUrl` names match across Tasks 1/4/5. `discoveryCoverageJson` column/field name consistent across Tasks 2/4/5. `discoveryMode`/`discoveryCapped` consistent across Tasks 2/3/4. `discoverPages` return `{ urls, mode, capped }` consistent across Tasks 3/4.

## Prod verification (post-deploy, after merge)

Inert until the next real seoIntent audit of an indexable client site with a sitemap. On the weekly canary (proway.erstaging.site, noindex, few links) the section will render but show a small/zero measurement — correct, not a bug. On the next Manhattan-class client audit: confirm the live-scan run's `discoveryCoverageJson` is populated with `mode:'sitemap'` and a plausible `offBaselineCount`, and `DiscoveryCoverageSection` renders the measured state. Record the miss-rate — this is the first data point for the Phase-2 gate.
