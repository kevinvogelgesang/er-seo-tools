# Hybrid-Discovery Increment 2 (The Crawler) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand site-audit discovery from sitemap-only to sitemap + a bounded raw-HTTP link crawl, for `seoIntent` audits only, so internally-reachable pages the sitemap omits get audited — while preserving the intrinsic sitemap miss-rate measurement.

**Architecture:** A pure bounded BFS crawler (`hybrid-crawl.ts`, injected fetch) runs at discovery time inside `discoverPages` behind a `hybrid` flag that only `seoIntent` audits pass. It preserves the discover→fan-out→drain invariants (the crawl finishes before any child rows exist). A per-URL provenance map (new nullable `SiteAudit.discoverySourcesJson`, a versioned object with cap metadata) lets `computeDiscoveryCoverage` report two rates: `sitemapMissRate` (intrinsic, campaign-comparable) and `residualMissRate` (what even the crawl missed).

**Tech Stack:** TypeScript, Next.js 15, Prisma + SQLite, Vitest. No new dependencies. Raw HTTP via existing `safeFetch`; no headless Chrome in the crawl (memory fence).

## Global Constraints

- **Node 22, SQLite only, no serverless, single PM2 process.** Do not change the core stack.
- **Array-form `$transaction([...])` only** — never interactive `$transaction(async tx => …)`. Express conditionals as SQL; raw SQL sets `updatedAt` manually (`Date.now()`, integer ms).
- **No browser pages in the crawl.** `BROWSER_POOL_SIZE ≤ 4`; the crawl is raw HTTP only.
- **All external fetches go through `safeFetch`/`assertSafeHttpUrl`** (SSRF guard) — no new egress path.
- **Env tunables use `parsePositiveInt`/`parseNonNegativeInt` from `lib/jobs/config.ts`**, read lazily as `() => parsePositiveInt(process.env.X, default)`; a bad value must never crash boot (fallback).
- **Only scan client sites / domains you control** in any manual test. Unit tests use synthetic HTML/URL fixtures and injected fetchers — **no live scanning**.
- **Gates:** `npm run lint` (tsc) + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`, all green before PR.
- **seoIntent scope:** hybrid discovery runs ONLY when `SiteAudit.seoIntent === true`. Plain ADA audits keep today's exact behavior — a hard regression guard in Task 5.

Spec: `docs/superpowers/specs/2026-07-06-hybrid-discovery-crawler-design.md`.

---

## File Structure

- **Create** `lib/ada-audit/seo/robots-rules.ts` — pure robots.txt `User-agent: *` group parser + `isAllowed`.
- **Create** `lib/ada-audit/seo/robots-rules.test.ts`.
- **Create** `lib/ada-audit/seo/hybrid-crawl.ts` — pure bounded BFS (injected fetch + clock).
- **Create** `lib/ada-audit/seo/hybrid-crawl.test.ts`.
- **Modify** `lib/ada-audit/seo/discovery-coverage.ts` — dual-rate + per-rate applicability; `DiscoveryMode += 'hybrid'`.
- **Modify** `lib/ada-audit/seo/discovery-coverage.test.ts` — dual-rate + back-compat.
- **Modify** `prisma/schema.prisma` + **create** migration — `SiteAudit.discoverySourcesJson String?`.
- **Modify** `lib/ada-audit/sitemap-crawler.ts` — `fetchPageLinks` helper (final-URL + same-domain), `discoverPages(domain, opts)` hybrid path, env tunables.
- **Modify** `lib/ada-audit/sitemap-crawler.test.ts` — hybrid:false regression + hybrid:true injected.
- **Modify** `lib/jobs/handlers/site-audit-discover.ts` — seoIntent select, non-pre-discovered + pre-discovered hybrid paths, atomic source-map persist, ensure-repair preserve, effective budget clamp.
- **Modify** `lib/jobs/handlers/broken-link-verify.ts` — select `discoverySourcesJson`, derive `sitemapBaseline` + `sitemapCapped`, pass to `computeDiscoveryCoverage`.

Task order: 1 (robots) → 2 (coverage) → 3 (crawl) → 4 (schema) → 5 (discoverPages) → 6 (discover handler) → 7 (builder). Tasks 1–4 are independent leaves; 5 depends on 1+3; 6 on 4+5; 7 on 2+4.

---

### Task 1: robots.txt rule parser

**Files:**
- Create: `lib/ada-audit/seo/robots-rules.ts`
- Test: `lib/ada-audit/seo/robots-rules.test.ts`

**Interfaces:**
- Produces: `interface RobotsRules { disallow: string[]; allow: string[] }`; `parseRobots(text: string): RobotsRules`; `isAllowed(pathname: string, rules: RobotsRules): boolean`.
- Consumes: nothing.

Policy (from spec Codex #9): v1 honors the `User-agent: *` group only. `isAllowed` uses longest-match; an equal-or-longer `Allow` match overrides a `Disallow`. `*` (any run) and `$` (end anchor) wildcards supported. Empty `Disallow:` means allow-all for that group.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/ada-audit/seo/robots-rules.test.ts
import { describe, it, expect } from 'vitest'
import { parseRobots, isAllowed } from './robots-rules'

describe('parseRobots', () => {
  it('collects only the User-agent: * group', () => {
    const r = parseRobots(
      'User-agent: Googlebot\nDisallow: /secret\n\nUser-agent: *\nDisallow: /admin\nAllow: /admin/public\n'
    )
    expect(r.disallow).toEqual(['/admin'])
    expect(r.allow).toEqual(['/admin/public'])
  })

  it('ignores comments, blank lines, and empty Disallow', () => {
    const r = parseRobots('User-agent: *\n# comment\nDisallow:\nDisallow: /x\n')
    expect(r.disallow).toEqual(['/x'])
  })

  it('returns empty rules when no * group exists', () => {
    expect(parseRobots('User-agent: Bingbot\nDisallow: /')).toEqual({ disallow: [], allow: [] })
  })

  it('honors a group that lists * alongside another agent (Codex #10)', () => {
    // Consecutive User-agent lines share the following rules; if any is *, the group applies to us.
    const r = parseRobots('User-agent: Googlebot\nUser-agent: *\nDisallow: /shared\n')
    expect(r.disallow).toEqual(['/shared'])
  })
})

describe('isAllowed', () => {
  const r = { disallow: ['/admin', '/tmp/'], allow: ['/admin/public'] }
  it('blocks a disallowed prefix', () => expect(isAllowed('/admin/settings', r)).toBe(false))
  it('allows an Allow override that is at least as long', () =>
    expect(isAllowed('/admin/public/page', r)).toBe(true))
  it('allows an unmatched path', () => expect(isAllowed('/programs', r)).toBe(true))
  it('supports $ end-anchor', () =>
    expect(isAllowed('/x.php', { disallow: ['/*.php$'], allow: [] })).toBe(false))
  it('supports * wildcard', () =>
    expect(isAllowed('/a/b/c', { disallow: ['/a/*/c'], allow: [] })).toBe(false))
  it('allow-all on empty rules', () => expect(isAllowed('/anything', { disallow: [], allow: [] })).toBe(true))
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/robots-rules.test.ts`
Expected: FAIL — `Cannot find module './robots-rules'`.

- [ ] **Step 3: Implement**

```typescript
// lib/ada-audit/seo/robots-rules.ts
//
// Pure robots.txt rule matcher for the hybrid-discovery crawl (Increment 2).
// v1 honors the `User-agent: *` group ONLY — the crawler's UA is a full browser
// string (to dodge WAF bot-403s), so there is no custom token to match a
// UA-specific group against. Rules apply to the LINKED crawl frontier only;
// sitemap/seed URLs are kept regardless (continuity: the existing pipeline
// already audits every sitemap URL without consulting Disallow).

export interface RobotsRules {
  disallow: string[]
  allow: string[]
}

export function parseRobots(text: string): RobotsRules {
  const disallow: string[] = []
  const allow: string[] = []
  // A group is a run of consecutive User-agent lines followed by rules.
  // Codex #10: if ANY User-agent line in the current group is `*`, the group
  // applies to us. `prevWasUserAgent` detects group boundaries: a User-agent
  // line right after a rule line starts a NEW group.
  let groupIsStar = false
  let prevWasUserAgent = false
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (field === 'user-agent') {
      if (!prevWasUserAgent) groupIsStar = false // a rule line ended the last group → new group
      if (value === '*') groupIsStar = true
      prevWasUserAgent = true
    } else {
      prevWasUserAgent = false
      if (!groupIsStar) continue
      if (field === 'disallow' && value) disallow.push(value)
      else if (field === 'allow' && value) allow.push(value)
    }
  }
  return { disallow, allow }
}

/** Convert a robots path pattern (with * and $) to a RegExp matched at the start of the pathname. */
function toMatcher(pattern: string): RegExp {
  let re = ''
  for (const ch of pattern) {
    if (ch === '*') re += '.*'
    else if (ch === '$') re += '$'
    else re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re)
}

/** Longest-match; an Allow at least as long as the matching Disallow wins. */
export function isAllowed(pathname: string, rules: RobotsRules): boolean {
  let longestDisallow = -1
  for (const p of rules.disallow) {
    if (toMatcher(p).test(pathname)) longestDisallow = Math.max(longestDisallow, p.replace(/[*$]/g, '').length)
  }
  if (longestDisallow === -1) return true
  let longestAllow = -1
  for (const p of rules.allow) {
    if (toMatcher(p).test(pathname)) longestAllow = Math.max(longestAllow, p.replace(/[*$]/g, '').length)
  }
  return longestAllow >= longestDisallow
}
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/robots-rules.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/robots-rules.ts lib/ada-audit/seo/robots-rules.test.ts
git commit -m "feat(c6): robots.txt rule parser for hybrid-discovery crawl"
```

---

### Task 2: dual miss-rate in `computeDiscoveryCoverage`

**Files:**
- Modify: `lib/ada-audit/seo/discovery-coverage.ts`
- Test: `lib/ada-audit/seo/discovery-coverage.test.ts` (extend)

**Interfaces:**
- Consumes: existing `DiscoveryCoverageInput`, `normalizeCoverageUrl`.
- Produces: `DiscoveryMode` gains `'hybrid'`. `DiscoveryCoverageInput` gains optional `sitemapBaseline?: string[]` and `sitemapCapped?: boolean`. `DiscoveryCoverage` gains `sitemapMissRate: number | null`, `sitemapApplicable: boolean`, `residualMissRate: number | null`, `residualApplicable: boolean`, `hybridCapped: boolean`. Existing `missRate`/`applicable`/counts/`sample` keep their current meaning.

Back-compat rule (spec): when `sitemapBaseline` is undefined, output `missRate`/`applicable` are byte-for-byte today's values; `sitemapMissRate === missRate`, `residualMissRate === null`.

- [ ] **Step 1: Write the failing tests (append to the existing describe)**

```typescript
// append to lib/ada-audit/seo/discovery-coverage.test.ts
describe('computeDiscoveryCoverage — hybrid dual rate', () => {
  it('reports sitemap vs residual rates from the sitemap baseline', () => {
    // sitemap baseline: /a. full hybrid baseline (discoveredUrls): /a,/b (crawler found /b).
    // harvested links: /a,/b,/c. sitemap misses {b,c}=2 of 3; residual misses {c}=1 of 3.
    const r = computeDiscoveryCoverage({
      discoveredUrls: ['https://x.com/a', 'https://x.com/b'],
      sitemapBaseline: ['https://x.com/a'],
      sitemapCapped: false,
      internalLinks: [
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/a' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/b' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/c' },
      ],
      discoveryMode: 'hybrid',
      discoveryCapped: false,
    })
    expect(r.sitemapMissRate).toBeCloseTo(2 / 3)
    expect(r.sitemapApplicable).toBe(true)
    expect(r.residualMissRate).toBeCloseTo(1 / 3)
    expect(r.residualApplicable).toBe(true)
  })

  it('sitemapApplicable is false when the sitemap portion was capped', () => {
    const r = computeDiscoveryCoverage({
      discoveredUrls: ['https://x.com/a'], sitemapBaseline: ['https://x.com/a'],
      sitemapCapped: true, internalLinks: [], discoveryMode: 'hybrid', discoveryCapped: false,
    })
    expect(r.sitemapApplicable).toBe(false)
    expect(r.sitemapMissRate).toBeNull()
  })

  it('back-compat: no sitemapBaseline behaves exactly as before', () => {
    const input = {
      discoveredUrls: ['https://x.com/a'],
      internalLinks: [{ sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/b' }],
      discoveryMode: 'sitemap' as const, discoveryCapped: false,
    }
    const r = computeDiscoveryCoverage(input)
    expect(r.missRate).toBeCloseTo(1 / 2)      // {b} off {a} baseline
    expect(r.sitemapMissRate).toBe(r.missRate)
    expect(r.residualMissRate).toBeNull()
    expect(r.applicable).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts`
Expected: FAIL — `sitemapMissRate`/`residualMissRate` undefined; type error on `sitemapBaseline`.

- [ ] **Step 3: Implement**

In `lib/ada-audit/seo/discovery-coverage.ts`:

Change the mode type and interfaces:

```typescript
export type DiscoveryMode = 'sitemap' | 'shallow-crawl' | 'pre-discovered' | 'hybrid'
```

Add to `DiscoveryCoverageInput`:

```typescript
  sitemapBaseline?: string[]   // sitemap-sourced subset of discoveredUrls; enables the intrinsic sitemapMissRate
  sitemapCapped?: boolean       // the sitemap portion alone exceeded HARD_CAP (drives sitemapApplicable)
```

Add to `DiscoveryCoverage`:

```typescript
  sitemapMissRate: number | null
  sitemapApplicable: boolean
  residualMissRate: number | null
  residualApplicable: boolean
  hybridCapped: boolean
```

Replace the body of `computeDiscoveryCoverage` from the `const baseline = …` line through the `return {…}` with this (a pure helper `rate(baseSet)` computes off-baseline miss-rate against a given baseline over the same linked set):

```typescript
  const { discoveredUrls, internalLinks, discoveryMode, discoveryCapped, sitemapBaseline, sitemapCapped } = input

  const fullBaseline = new Set(discoveredUrls.map(normalizeCoverageUrl))

  // linked set (normalized page targets, non-pages excluded) built once
  const linkedTargets: string[] = []
  const linked = new Set<string>()
  const offSourcesFull = new Map<string, Set<string>>()
  for (const link of internalLinks) {
    const target = normalizeCoverageUrl(link.targetUrl)
    if (isNonPage(target)) continue
    linkedTargets.push(target)
    linked.add(target)
    if (!fullBaseline.has(target)) {
      let s = offSourcesFull.get(target)
      if (!s) { s = new Set<string>(); offSourcesFull.set(target, s) }
      s.add(normalizeCoverageUrl(link.sourcePageUrl))
    }
  }

  const missAgainst = (base: Set<string>): number => {
    const off = new Set<string>()
    for (const t of linked) if (!base.has(t)) off.add(t)
    const denom = base.size + off.size
    return denom === 0 ? 0 : off.size / denom
  }

  const discoveredCount = fullBaseline.size
  const linkedInternalCount = linked.size
  const offBaselineCount = offSourcesFull.size

  // Legacy fields: unchanged semantics (diff vs the FULL baseline, gated on the old rule).
  const applicable = discoveryMode === 'sitemap' && discoveryCapped === false
  const missRate = applicable ? missAgainst(fullBaseline) : null

  // Hybrid dual rates.
  const hybridCapped = discoveryCapped === true
  const hasSitemapBaseline = Array.isArray(sitemapBaseline)
  const sitemapSet = hasSitemapBaseline ? new Set(sitemapBaseline!.map(normalizeCoverageUrl)) : null
  const sitemapApplicable = hasSitemapBaseline && sitemapCapped !== true
  const sitemapMissRate = sitemapApplicable ? missAgainst(sitemapSet!) : (hasSitemapBaseline ? null : missRate)
  const residualApplicable = hasSitemapBaseline && !hybridCapped
  const residualMissRate = residualApplicable ? missAgainst(fullBaseline) : null

  const sample: DiscoveryCoverageSampleEntry[] = [...offSourcesFull.keys()]
    .sort()
    .slice(0, SAMPLE_CAP)
    .map((targetUrl) => ({
      targetUrl,
      sourcePageUrls: [...offSourcesFull.get(targetUrl)!].sort().slice(0, SOURCES_PER_TARGET),
    }))

  return {
    mode: discoveryMode, capped: discoveryCapped, applicable,
    discoveredCount, linkedInternalCount, offBaselineCount, missRate, sample,
    sitemapMissRate, sitemapApplicable, residualMissRate, residualApplicable, hybridCapped,
  }
```

(The `missAgainst(fullBaseline)` result equals the old `offBaselineCount/(discoveredCount+offBaselineCount)` because `offSourcesFull` keys == the off-baseline linked set — verify against the existing Increment-1 tests, which must stay green.)

- [ ] **Step 4: Run to verify pass (new + all existing coverage tests)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts`
Expected: PASS — the 3 new tests AND every pre-existing Increment-1 test (back-compat guard).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/discovery-coverage.ts lib/ada-audit/seo/discovery-coverage.test.ts
git commit -m "feat(c6): dual miss-rate (sitemap + residual) in computeDiscoveryCoverage"
```

---

### Task 3: pure bounded BFS crawler

**Files:**
- Create: `lib/ada-audit/seo/hybrid-crawl.ts`
- Test: `lib/ada-audit/seo/hybrid-crawl.test.ts`

**Interfaces:**
- Consumes: `RobotsRules`/`isAllowed` (Task 1); `normalizeLinkTarget`, `sameDomain` from `lib/ada-audit/link-harvest.ts`; `normalizeCoverageUrl` from `./discovery-coverage`; `NON_PAGE_EXT` — export it from `discovery-coverage.ts` (add `export` to the existing `const NON_PAGE_EXT`).
- Produces:

```typescript
export type CrawlSource = 'sitemap' | 'seed' | 'shallow' | 'linked'
export interface FetchedPage { links: string[]; finalUrl: string }
export interface CrawlDeps { fetchPageLinks(url: string): Promise<FetchedPage | null>; now(): number }
export interface CrawlBounds { maxDepth: number; maxAdded: number; maxFetches: number; timeBudgetMs: number; hardCap: number }
export interface CrawlSeed { url: string; source: 'sitemap' | 'seed' | 'shallow' }
export interface CrawlResult {
  urls: string[]
  sources: Record<string, CrawlSource>
  sitemapCount: number
  addedByCrawl: number
  fetches: number
  stoppedBy: 'depth' | 'maxAdded' | 'maxFetches' | 'timeBudget' | 'hardCap' | 'exhausted'
}
export async function hybridCrawl(seeds: CrawlSeed[], auditedHost: string, bounds: CrawlBounds, deps: CrawlDeps, robots: RobotsRules): Promise<CrawlResult>
```

Determinism: results are assembled in **frontier order** (seeds in input order, then discovery order), NOT fetch-completion order — so bounded concurrency never changes the output. Source precedence `sitemap > seed > shallow > linked`: a seed's source is never downgraded by a later `linked` hit on the same normalized key. Trap heuristics: per-path query-variant cap (`maxQueryVariantsPerPath`) and max path-segment count (`maxPathSegments`) are passed inside `bounds` — add them to `CrawlBounds` as `maxQueryVariantsPerPath: number; maxPathSegments: number`.

Concurrency (`concurrency` also in `CrawlBounds`): process the frontier in waves — pop up to `concurrency` unfetched URLs at the current depth, `Promise.all` their `fetchPageLinks`, then merge results in popped order. Enforce `timeBudget`/`maxFetches`/`maxAdded`/`hardCap` between and within waves.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/ada-audit/seo/hybrid-crawl.test.ts
import { describe, it, expect } from 'vitest'
import { hybridCrawl, type CrawlBounds, type FetchedPage } from './hybrid-crawl'

const HOST = 'x.com'
const B = (over: Partial<CrawlBounds> = {}): CrawlBounds => ({
  maxDepth: 3, maxAdded: 100, maxFetches: 100, timeBudgetMs: 10_000, hardCap: 1000,
  maxQueryVariantsPerPath: 5, maxPathSegments: 12, concurrency: 4, ...over,
})
// deterministic fake graph fetcher
const graph = (g: Record<string, string[]>, finalMap: Record<string, string> = {}) => {
  let clock = 0
  return {
    now: () => (clock += 10),
    async fetchPageLinks(url: string): Promise<FetchedPage | null> {
      if (!(url in g)) return null
      return { links: g[url], finalUrl: finalMap[url] ?? url }
    },
  }
}

describe('hybridCrawl', () => {
  it('BFS-discovers linked pages beyond the seeds', async () => {
    const deps = graph({
      'https://x.com/': ['https://x.com/a', 'https://x.com/b'],
      'https://x.com/a': ['https://x.com/c'],
      'https://x.com/b': [], 'https://x.com/c': [],
    })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B(), deps, { disallow: [], allow: [] })
    expect(r.urls).toContain('https://x.com/c')
    expect(r.addedByCrawl).toBe(3) // a,b,c
    expect(r.sources['https://x.com/c']).toBe('linked')
    expect(r.sources['https://x.com']).toBe('sitemap') // seed keeps its source
  })

  it('respects maxDepth', async () => {
    const deps = graph({
      'https://x.com/': ['https://x.com/a'], 'https://x.com/a': ['https://x.com/b'], 'https://x.com/b': ['https://x.com/c'],
    })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B({ maxDepth: 1 }), deps, { disallow: [], allow: [] })
    expect(r.urls).toContain('https://x.com/a') // depth 1 accepted
    expect(r.urls).not.toContain('https://x.com/b') // depth 2 never fetched
    expect(r.stoppedBy).toBe('depth') // Codex #1: leaf accepted at the depth ceiling ⇒ stopped by depth
  })

  it('reports exhausted when the whole graph fits under the bounds', async () => {
    const deps = graph({ 'https://x.com/': ['https://x.com/a'], 'https://x.com/a': [] })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B(), deps, { disallow: [], allow: [] })
    expect(r.stoppedBy).toBe('exhausted')
  })

  it('never fetches more than maxFetches even when a wave would overshoot', async () => {
    const deps = graph({
      'https://x.com/': ['https://x.com/a', 'https://x.com/b'],
      'https://x.com/a': [], 'https://x.com/b': [],
    })
    // seed fetch (1) + at most 1 more ⇒ maxFetches:2 must not fetch both a and b
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B({ maxFetches: 2, concurrency: 4 }), deps, { disallow: [], allow: [] })
    expect(r.fetches).toBeLessThanOrEqual(2)
    expect(r.stoppedBy).toBe('maxFetches')
  })

  it('stops at maxAdded', async () => {
    const deps = graph({ 'https://x.com/': ['https://x.com/a', 'https://x.com/b', 'https://x.com/c'] })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B({ maxAdded: 2 }), deps, { disallow: [], allow: [] })
    expect(r.addedByCrawl).toBe(2)
    expect(r.stoppedBy).toBe('maxAdded')
  })

  it('drops links from an off-host final URL (redirect off-domain)', async () => {
    const deps = graph(
      { 'https://x.com/r': ['https://x.com/should-not-appear'] },
      { 'https://x.com/r': 'https://evil.com/r' }, // final URL left the host
    )
    const r = await hybridCrawl([{ url: 'https://x.com/r', source: 'sitemap' }], HOST, B(), deps, { disallow: [], allow: [] })
    expect(r.urls).not.toContain('https://x.com/should-not-appear')
  })

  it('applies robots Disallow to linked targets only, not seeds', async () => {
    const deps = graph({ 'https://x.com/admin': ['https://x.com/admin/x'], 'https://x.com/': ['https://x.com/admin'] })
    const r = await hybridCrawl(
      [{ url: 'https://x.com/admin', source: 'sitemap' }, { url: 'https://x.com/', source: 'sitemap' }],
      HOST, B(), deps, { disallow: ['/admin'], allow: [] },
    )
    expect(r.urls).toContain('https://x.com/admin')          // seed kept despite Disallow
    expect(r.urls).not.toContain('https://x.com/admin/x')    // linked child blocked
  })

  it('caps query-string variants per path', async () => {
    const links = ['?a=1', '?a=2', '?a=3', '?a=4', '?a=5', '?a=6'].map((q) => `https://x.com/f${q}`)
    const deps = graph({ 'https://x.com/': links })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B({ maxQueryVariantsPerPath: 3 }), deps, { disallow: [], allow: [] })
    const variants = r.urls.filter((u) => u.startsWith('https://x.com/f'))
    expect(variants.length).toBe(3)
  })

  it('drops deep calendar-trap paths', async () => {
    const deps = graph({ 'https://x.com/': ['https://x.com/a/b/c/d/e/f/g/h/i/j/k/l/m'] })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B({ maxPathSegments: 5 }), deps, { disallow: [], allow: [] })
    expect(r.urls.some((u) => u.includes('/m'))).toBe(false)
  })

  it('honors Disallow on a directory-root trailing-slash target (robots matches the real path, not the coverage key)', async () => {
    // key of https://x.com/admin/ normalizes to /admin; Disallow:/admin/ must still block it.
    const deps = graph({ 'https://x.com/': ['https://x.com/admin/'] })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B(), deps, { disallow: ['/admin/'], allow: [] })
    expect(r.urls.some((u) => u.includes('/admin'))).toBe(false)
  })

  it('stops at hardCap, including capping seeds', async () => {
    const seeds = Array.from({ length: 5 }, (_, i) => ({ url: `https://x.com/s${i}`, source: 'sitemap' as const }))
    const r = await hybridCrawl(seeds, HOST, B({ hardCap: 3 }), graph({}), { disallow: [], allow: [] })
    expect(r.urls.length).toBe(3)
    expect(r.stoppedBy).toBe('hardCap')
  })

  it('stops at the time budget', async () => {
    // clock advances 10ms per now() call; timeBudget 5ms trips on the first wave check.
    const deps = graph({ 'https://x.com/': ['https://x.com/a'], 'https://x.com/a': [] })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B({ timeBudgetMs: 5 }), deps, { disallow: [], allow: [] })
    expect(r.stoppedBy).toBe('timeBudget')
  })

  it('counts sitemap/seed seeds in sitemapCount, linked in addedByCrawl', async () => {
    const deps = graph({ 'https://x.com/': ['https://x.com/a'], 'https://x.com/a': [] })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B(), deps, { disallow: [], allow: [] })
    expect(r.sitemapCount).toBe(1) // the one seed
    expect(r.addedByCrawl).toBe(1) // /a
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/hybrid-crawl.test.ts`
Expected: FAIL — `Cannot find module './hybrid-crawl'`.

- [ ] **Step 3: Implement**

First, in `discovery-coverage.ts`, export the trap regex so the crawler reuses it: change `const NON_PAGE_EXT` to `export const NON_PAGE_EXT`. Add `maxQueryVariantsPerPath` and `maxPathSegments` and `concurrency` to `CrawlBounds` (they are in the interface above). Then:

```typescript
// lib/ada-audit/seo/hybrid-crawl.ts
//
// Hybrid-discovery Increment 2: pure bounded same-domain BFS link crawler.
// Fetch + clock are injected (CrawlDeps) so the BFS logic is unit-testable with
// no network. Raw HTTP only — NO headless Chrome (memory fence). Results are
// assembled in frontier order so bounded concurrency never changes the output.
//
// TWO REPRESENTATIONS per node (do NOT conflate them — this was a real bug):
//   • KEY   = normalizeCoverageUrl(url) — dedup + precedence + `sources` map key
//             + frontier bookkeeping. Coverage-normalization strips the root
//             trailing slash, strips `www.`, and pins https, so it MUST NOT be
//             the URL we fetch (that would mutate the request target).
//   • FETCH = the resolved real URL (seed's original url, or normalizeLinkTarget
//             output for a link) — what deps.fetchPageLinks receives AND what
//             lands in `urls` (→ discoveredUrls → the audited AdaAudit.url set,
//             matching the existing sitemap path which stores real URLs).
// `sources` keys are coverage-normalized; each corresponds 1:1 to a `urls`
// entry via normalizeCoverageUrl (they are not always string-equal — e.g. a
// root seed's url `https://x.com/` has key `https://x.com`).
import { normalizeLinkTarget, sameDomain } from '../link-harvest'
import { normalizeCoverageUrl, NON_PAGE_EXT } from './discovery-coverage'
import { isAllowed, type RobotsRules } from './robots-rules'

export type CrawlSource = 'sitemap' | 'seed' | 'shallow' | 'linked'
export interface FetchedPage { links: string[]; finalUrl: string }
export interface CrawlDeps { fetchPageLinks(url: string): Promise<FetchedPage | null>; now(): number }
export interface CrawlBounds {
  maxDepth: number; maxAdded: number; maxFetches: number; timeBudgetMs: number; hardCap: number
  maxQueryVariantsPerPath: number; maxPathSegments: number; concurrency: number
}
export interface CrawlSeed { url: string; source: 'sitemap' | 'seed' | 'shallow' }
export interface CrawlResult {
  urls: string[]
  sources: Record<string, CrawlSource>
  sitemapCount: number
  addedByCrawl: number
  fetches: number
  stoppedBy: 'depth' | 'maxAdded' | 'maxFetches' | 'timeBudget' | 'hardCap' | 'exhausted'
}

const PRECEDENCE: Record<CrawlSource, number> = { sitemap: 3, seed: 2, shallow: 1, linked: 0 }

function isNonPage(normalized: string): boolean {
  try { return NON_PAGE_EXT.test(new URL(normalized).pathname) } catch { return false }
}
function pathKey(normalized: string): string {
  try { return new URL(normalized).pathname } catch { return normalized }
}
function segmentCount(normalized: string): number {
  try { return new URL(normalized).pathname.split('/').filter(Boolean).length } catch { return 0 }
}

export async function hybridCrawl(
  seeds: CrawlSeed[], auditedHost: string, bounds: CrawlBounds, deps: CrawlDeps, robots: RobotsRules,
): Promise<CrawlResult> {
  const start = deps.now()
  const host = auditedHost.toLowerCase()
  const sources: Record<string, CrawlSource> = {}
  const order: string[] = []            // coverage-normalized KEYS in frontier order
  const fetchUrlOf = new Map<string, string>()  // key → resolved FETCH url (real url to request / emit)
  const depthOf = new Map<string, number>()
  const queryVariants = new Map<string, number>()
  let addedByCrawl = 0
  let fetches = 0
  let sitemapCount = 0
  let stoppedBy: CrawlResult['stoppedBy'] = 'exhausted'

  // `key` is coverage-normalized (dedup/sources); `fetchUrl` is the resolved
  // real URL to fetch and to emit in `urls`.
  const accept = (key: string, fetchUrl: string, source: CrawlSource, depth: number): boolean => {
    const existing = sources[key]
    if (existing !== undefined) {
      if (PRECEDENCE[source] > PRECEDENCE[existing]) sources[key] = source // upgrade only
      return false
    }
    sources[key] = source
    order.push(key)
    fetchUrlOf.set(key, fetchUrl)
    depthOf.set(key, depth)
    if (source === 'linked') addedByCrawl++
    else sitemapCount++
    return true
  }

  // Seed the frontier (seeds bypass robots + traps — publisher intent).
  // Codex #3: stop accepting seeds at hardCap so `urls`, `sources`, and the
  // sitemap baseline all stay aligned (never more sources than sliced urls).
  for (const s of seeds) {
    if (order.length >= bounds.hardCap) { stoppedBy = 'hardCap'; break }
    const key = normalizeCoverageUrl(s.url)
    let ok = false
    try { ok = sameDomain(new URL(key).hostname.toLowerCase(), host) } catch { ok = false }
    if (ok) accept(key, s.url, s.source, 0)  // fetchUrl = the seed's ORIGINAL url (not coverage-normalized)
  }

  // Frontier = accepted URLs at the current depth not yet fetched.
  let depth = 0
  outer: while (depth < bounds.maxDepth) {
    const frontier = order.filter((u) => depthOf.get(u) === depth)
    if (frontier.length === 0) break
    for (let i = 0; i < frontier.length; i += bounds.concurrency) {
      if (deps.now() - start >= bounds.timeBudgetMs) { stoppedBy = 'timeBudget'; break outer }
      if (fetches >= bounds.maxFetches) { stoppedBy = 'maxFetches'; break outer }
      // Codex #2: slice the wave so fetches never exceeds maxFetches.
      const room = Math.min(bounds.concurrency, bounds.maxFetches - fetches)
      const wave = frontier.slice(i, i + room)
      fetches += wave.length
      if (fetches >= bounds.maxFetches && i + room < frontier.length) stoppedBy = 'maxFetches'
      const pages = await Promise.all(wave.map((k) => deps.fetchPageLinks(fetchUrlOf.get(k)!)))  // fetch the REAL url, not the key
      for (const page of pages) {                       // assemble in wave (=frontier) order
        if (!page) continue
        let finalOk = false
        try { finalOk = sameDomain(new URL(page.finalUrl).hostname.toLowerCase(), host) } catch { finalOk = false }
        if (!finalOk) continue                          // Codex #7: off-host final URL contributes nothing
        for (const raw of page.links) {
          const resolved = normalizeLinkTarget(raw, page.finalUrl)  // Codex #8: resolve vs final URL (the FETCH url)
          if (!resolved) continue
          const key = normalizeCoverageUrl(resolved)                // dedup/sources KEY
          let h: string
          try { h = new URL(key).hostname.toLowerCase() } catch { continue }
          if (!sameDomain(h, host)) continue
          if (isNonPage(key)) continue
          if (segmentCount(key) > bounds.maxPathSegments) continue
          // robots must match the REAL resolved path — a trailing slash is
          // significant to Disallow patterns (`^/admin/` ≠ `/admin`), and
          // normalizeCoverageUrl STRIPS non-root trailing slashes, so matching
          // the coverage `key` here would let a Disallow:/admin/ target through.
          // (isNonPage/segmentCount are trailing-slash-insensitive → key is fine.)
          let pn: string
          try { pn = new URL(resolved).pathname } catch { continue }
          if (!isAllowed(pn, robots)) continue
          const pk = pathKey(key)
          const seenVariants = queryVariants.get(pk) ?? 0
          if (seenVariants >= bounds.maxQueryVariantsPerPath) continue
          if (sources[key] !== undefined) continue      // already known
          if (addedByCrawl >= bounds.maxAdded) { stoppedBy = 'maxAdded'; break outer }
          if (order.length >= bounds.hardCap) { stoppedBy = 'hardCap'; break outer }
          queryVariants.set(pk, seenVariants + 1)
          accept(key, resolved, 'linked', depth + 1)     // fetchUrl = the resolved real url
        }
      }
    }
    depth++
  }
  if (depth >= bounds.maxDepth && stoppedBy === 'exhausted') {
    // reached the depth ceiling with frontier possibly remaining
    const deeper = order.some((u) => (depthOf.get(u) ?? 0) === bounds.maxDepth)
    if (deeper) stoppedBy = 'depth'
  }

  // Emit the REAL fetch urls (keys map 1:1 to fetchUrls), sliced to hardCap.
  const urls = order.slice(0, bounds.hardCap).map((k) => fetchUrlOf.get(k)!)
  return { urls, sources, sitemapCount, addedByCrawl, fetches, stoppedBy }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/hybrid-crawl.test.ts lib/ada-audit/seo/discovery-coverage.test.ts`
Expected: PASS (all crawl tests + coverage tests still green after the `NON_PAGE_EXT` export).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/hybrid-crawl.ts lib/ada-audit/seo/hybrid-crawl.test.ts lib/ada-audit/seo/discovery-coverage.ts
git commit -m "feat(c6): pure bounded BFS hybrid-discovery crawler"
```

---

### Task 4: schema — `SiteAudit.discoverySourcesJson`

**Files:**
- Modify: `prisma/schema.prisma` (near `discoveryCoverageJson`/`discoveryMode` on `SiteAudit`, around line 141–143)
- Create: `prisma/migrations/<timestamp>_discovery_sources/migration.sql`

**Interfaces:**
- Produces: nullable column `discoverySourcesJson String?` on `SiteAudit`.

- [ ] **Step 1: Edit the schema**

Add under the existing discovery fields on the `SiteAudit` model:

```prisma
  discoverySourcesJson  String?   // C6 Increment 2: JSON {v,sources(url->source),sitemapCount,sitemapCapped,stoppedBy,fetches}
```

- [ ] **Step 2: Author the migration SQL**

Create `prisma/migrations/<timestamp>_discovery_sources/migration.sql` (use a UTC timestamp after the latest existing migration dir, format `YYYYMMDDHHMMSS`):

```sql
-- Additive nullable column; no table rebuild needed (SQLite).
ALTER TABLE "SiteAudit" ADD COLUMN "discoverySourcesJson" TEXT;
```

- [ ] **Step 3: Apply locally + regenerate client**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: "1 migration applied" (the new one), client regenerated, no errors.

- [ ] **Step 4: Verify the column exists**

Run: `DATABASE_URL="file:./local-dev.db" npx tsx -e "import {prisma} from '@/lib/db'; prisma.siteAudit.findFirst({select:{discoverySourcesJson:true}}).then(r=>{console.log('ok',r);process.exit(0)})"`
Expected: `ok null` (or an object) — no "no such column" error.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(c6): add SiteAudit.discoverySourcesJson (hybrid discovery provenance)"
```

---

### Task 5: wire the crawl into `discoverPages`

**Files:**
- Modify: `lib/ada-audit/sitemap-crawler.ts`
- Test: `lib/ada-audit/sitemap-crawler.test.ts` (extend)

**Interfaces:**
- Consumes: `hybridCrawl`, `CrawlBounds`, `CrawlSource` (Task 3); `parseRobots` (Task 1); `parsePositiveInt` from `@/lib/jobs/config`.
- Produces:
  - Export `fetchPageLinks(url: string, auditedHost: string): Promise<FetchedPage | null>` — raw-HTTP HTML → `{ links, finalUrl }`, rejecting off-host final URLs; reuses `safeFetch`, byte/timeout limits, the existing `USER_AGENT`.
  - `discoverPages(domain, opts?: { hybrid?: boolean; seeds?: string[]; timeBudgetMs?: number })` returns `{ urls: string[]; mode: 'sitemap'|'shallow-crawl'|'hybrid'; capped: boolean; coverage?: { sources: Record<string, CrawlSource>; sitemapCount: number; sitemapCapped: boolean; stoppedBy: string; fetches: number } }`.
  - Regression guarantee: `discoverPages(domain)` and `discoverPages(domain, { hybrid: false })` return the exact pre-existing shape+behavior (no `coverage`, mode never `'hybrid'`).

- [ ] **Step 1: Write the failing tests (extend the existing suite; use dependency injection for fetch)**

The cleanest injection point: add an internal `discoverPagesWithDeps(domain, opts, deps)` where `deps` supplies `fetchPageLinks` + `now`, and `discoverPages` calls it with real deps. Test `discoverPagesWithDeps` (export it test-only) plus the crawl. If the existing suite already mocks `safeFetch`, follow that pattern instead; otherwise inject.

**Codex #7:** the test file already imports `discoverPages` and mocks `safeFetch` at the top. Add `discoverPagesWithDeps` to that **existing top-level import line** — do NOT insert a new `import` mid-file (ESM parse error). The new `describe` block goes at the end of the file.

```typescript
// EDIT the existing top import in lib/ada-audit/sitemap-crawler.test.ts:
//   import { discoverPages, discoverPagesWithDeps } from './sitemap-crawler'
// then append this describe block at the end of the file:

describe('discoverPages hybrid', () => {
  it('hybrid:false is unchanged (no coverage, never mode hybrid)', async () => {
    // Uses the suite's existing sitemap-mock harness; assert shape:
    const r = await discoverPagesWithDeps('x.com', { hybrid: false }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/a'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async () => null, now: () => 0,
    })
    expect(r).toEqual({ urls: ['https://x.com/a'], mode: 'sitemap', capped: false })
    expect('coverage' in r).toBe(false)
  })

  it('hybrid:true expands the seed set and returns provenance', async () => {
    const graph: Record<string, string[]> = {
      'https://x.com/a': ['https://x.com/b'], 'https://x.com/b': [],
    }
    const r = await discoverPagesWithDeps('x.com', { hybrid: true }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/a'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => (u in graph ? { links: graph[u], finalUrl: u } : null),
      now: () => 0,
      robots: { disallow: [], allow: [] },
    })
    expect(r.mode).toBe('hybrid')
    expect(r.urls).toContain('https://x.com/b')
    expect(r.coverage!.sources['https://x.com/a']).toBe('sitemap')
    expect(r.coverage!.sources['https://x.com/b']).toBe('linked')
    expect(r.coverage!.sitemapCount).toBe(1)
  })

  it('hybrid:true with provided seeds tags them seed', async () => {
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, seeds: ['https://x.com/p'] }, {
      resolveSeeds: async () => { throw new Error('should not resolve when seeds provided') },
      fetchPageLinks: async () => null, now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.mode).toBe('hybrid')
    expect(r.coverage!.sources['https://x.com/p']).toBe('seed')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/sitemap-crawler.test.ts`
Expected: FAIL — `discoverPagesWithDeps` not exported.

- [ ] **Step 3: Implement**

In `lib/ada-audit/sitemap-crawler.ts`:

Add imports and env tunables near the top constants:

```typescript
import { hybridCrawl, type CrawlBounds, type CrawlSource, type FetchedPage } from './seo/hybrid-crawl'
import { parseRobots, type RobotsRules } from './seo/robots-rules'
import { normalizeLinkTarget, sameDomain } from './link-harvest'
import { parsePositiveInt } from '@/lib/jobs/config'

const HY_MAX_DEPTH = () => parsePositiveInt(process.env.HYBRID_CRAWL_MAX_DEPTH, 3)
const HY_MAX_ADDED = () => parsePositiveInt(process.env.HYBRID_CRAWL_MAX_ADDED, 300)
const HY_MAX_FETCHES = () => parsePositiveInt(process.env.HYBRID_CRAWL_MAX_FETCHES, 400)
const HY_TIME_BUDGET = () => parsePositiveInt(process.env.HYBRID_CRAWL_TIME_BUDGET_MS, 120_000)
const HY_CONCURRENCY = () => parsePositiveInt(process.env.HYBRID_CRAWL_CONCURRENCY, 6)
const HY_QUERY_VARIANTS = () => parsePositiveInt(process.env.HYBRID_CRAWL_MAX_QUERY_VARIANTS_PER_PATH, 5)
const HY_PATH_SEGMENTS = () => parsePositiveInt(process.env.HYBRID_CRAWL_MAX_PATH_SEGMENTS, 12)
```

Add the exported `fetchPageLinks` (reusing `fetchHtml`'s pattern but returning the final URL and rejecting off-host):

```typescript
/** Raw-HTTP fetch of a page's same-doc <a href>s + the post-redirect final URL.
 *  Returns null on any fetch failure or if the final URL left the audited host. */
export async function fetchPageLinks(url: string, auditedHost: string): Promise<FetchedPage | null> {
  try {
    const { response: res, url: finalUrl } = await safeFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('html')) return null
    let finalHost: string
    try { finalHost = new URL(finalUrl).hostname.toLowerCase() } catch { return null }
    if (!sameDomain(finalHost, auditedHost.toLowerCase())) return null
    const { text, truncated } = await readResponseTextWithLimit(res, MAX_HTML_BYTES)
    if (truncated) return null
    const hrefs: string[] = []
    const re = /<a[^>]+href=["']([^"']+)["']/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) hrefs.push(m[1])
    return { links: hrefs, finalUrl }
  } catch {
    return null
  }
}
```

Add the deps-injected core + the public wrapper. Keep the existing `discoverPages` body as the seed resolver:

```typescript
interface DiscoverDeps {
  resolveSeeds: (domain: string) => Promise<{ urls: string[]; mode: 'sitemap' | 'shallow-crawl'; capped: boolean }>
  fetchPageLinks: (url: string) => Promise<FetchedPage | null>
  now: () => number
  robots?: RobotsRules
}

export interface DiscoverResult {
  urls: string[]
  mode: 'sitemap' | 'shallow-crawl' | 'hybrid'
  capped: boolean
  coverage?: { sources: Record<string, CrawlSource>; sitemapCount: number; sitemapCapped: boolean; stoppedBy: string; fetches: number }
}

export async function discoverPagesWithDeps(
  domain: string,
  opts: { hybrid?: boolean; seeds?: string[]; timeBudgetMs?: number },
  deps: DiscoverDeps,
): Promise<DiscoverResult> {
  const normDomain = normaliseDomain(domain)
  const host = normDomain

  // Resolve seeds: provided (pre-discovered) or via sitemap/shallow.
  let seedMode: 'sitemap' | 'shallow-crawl'
  let seedUrls: string[]
  let seedCapped: boolean
  let seedSource: 'sitemap' | 'seed' | 'shallow'
  if (opts.seeds) {
    seedUrls = [...new Set(opts.seeds)]; seedMode = 'sitemap'; seedCapped = false; seedSource = 'seed'
  } else {
    const resolved = await deps.resolveSeeds(domain)
    seedUrls = resolved.urls; seedMode = resolved.mode; seedCapped = resolved.capped
    seedSource = resolved.mode === 'shallow-crawl' ? 'shallow' : 'sitemap'
  }

  if (!opts.hybrid) {
    return { urls: seedUrls, mode: seedMode, capped: seedCapped }
  }

  const robots = deps.robots ?? { disallow: [], allow: [] }
  // Codex #4: resolveSeedsReal already sliced to HARD_CAP, so `seedUrls.length >
  // HARD_CAP` is always false. The sitemap portion's cap comes from the
  // resolver's `capped` flag (sitemap mode) or, for provided seeds, whether the
  // raw seed count exceeded the cap before slicing.
  const sitemapCappedBefore = opts.seeds ? opts.seeds.length > HARD_CAP : (seedSource === 'sitemap' && seedCapped)
  const bounds: CrawlBounds = {
    maxDepth: HY_MAX_DEPTH(), maxAdded: HY_MAX_ADDED(), maxFetches: HY_MAX_FETCHES(),
    // Budget = min(env ceiling, remaining-job-time passed by the handler). The
    // env HYBRID_CRAWL_TIME_BUDGET_MS is the PRIMARY ceiling (must stay live so
    // it's tunable without redeploy); opts.timeBudgetMs only clamps it DOWN when
    // little job time remains. `??` (fallback) would let the handler's larger
    // remaining-time value bypass the ceiling entirely — use Math.min.
    timeBudgetMs: Math.min(opts.timeBudgetMs ?? Number.POSITIVE_INFINITY, HY_TIME_BUDGET()), hardCap: HARD_CAP,
    maxQueryVariantsPerPath: HY_QUERY_VARIANTS(), maxPathSegments: HY_PATH_SEGMENTS(),
    concurrency: HY_CONCURRENCY(),
  }
  const crawl = await hybridCrawl(
    seedUrls.map((u) => ({ url: u, source: seedSource })),
    host, bounds, { fetchPageLinks: deps.fetchPageLinks, now: deps.now }, robots,
  )
  // Codex #5: a set of exactly HARD_CAP is NOT capped (matches existing
  // discoverPages semantics: capped only when a source overflowed the cap).
  const capped = seedCapped || crawl.stoppedBy === 'hardCap'
  return {
    urls: crawl.urls,
    // 'hybrid' when a crawl ran on provided seeds OR the crawl expanded the set.
    // (opts.seeds means a deliberate pre-discovered hybrid expansion, even if 0
    // new links were found — the provided-seeds test requires 'hybrid' here.)
    mode: (opts.seeds || crawl.addedByCrawl > 0) ? 'hybrid' : seedMode,
    capped,
    coverage: {
      sources: crawl.sources, sitemapCount: crawl.sitemapCount,
      sitemapCapped: sitemapCappedBefore, stoppedBy: crawl.stoppedBy, fetches: crawl.fetches,
    },
  }
}
```

**Codex #6 — fetch robots.txt exactly once.** The current `discoverPages` body calls `fetchRobotsTxt(base)` internally to get `Sitemap:` lines; the hybrid wrapper ALSO needs the `Disallow` rules. Do not fetch robots twice. Refactor so one fetch feeds both:

1. Add `fetchRobotsRaw(base): Promise<string>` — returns the raw robots body (`''` on failure), via `safeFetch` + `readResponseTextWithLimit(res, MAX_ROBOTS_BYTES)` (both already imported/defined in the file).
2. Refactor `fetchRobotsTxt` to accept the already-fetched text: `extractSitemapUrls(robotsText): string[]` (the existing `Sitemap:` line scan, now pure).
3. Rename the current public `discoverPages` body into a private `resolveSeedsReal(domain, robotsText)` returning `{ urls, mode, capped }` — it uses `extractSitemapUrls(robotsText)` instead of fetching, and drops nothing else (still the sitemap→shallow logic; it never produced `'hybrid'`).

```typescript
export async function discoverPages(
  domain: string,
  opts: { hybrid?: boolean; seeds?: string[]; timeBudgetMs?: number } = {},
): Promise<DiscoverResult> {
  const normDomain = normaliseDomain(domain)
  // SSRF check FIRST, before ANY network fetch — preserves the existing
  // "rejects internal hostnames before fetching" guarantee (the robots fetch
  // below would otherwise be the first network call). Per-request SSRF still
  // re-resolves inside safeFetch; this top check is the pre-fetch reject.
  await assertSafeHttpUrl(`https://${normDomain}`)
  const robotsText = await fetchRobotsRaw(`https://${normDomain}`) // single robots fetch
  return discoverPagesWithDeps(domain, opts, {
    resolveSeeds: (d) => resolveSeedsReal(d, robotsText),
    fetchPageLinks: (u) => fetchPageLinks(u, normDomain),
    now: () => Date.now(),
    robots: parseRobots(robotsText),
  })
}
```

`DiscoverDeps.resolveSeeds` stays `(domain: string) => Promise<{urls,mode,capped}>` — the closure captures `robotsText`, so the injected test resolver still needs no robots. (When `opts.seeds` is provided, `discoverPagesWithDeps` never calls `resolveSeeds`, so the robots fetch is the only network call before the crawl.)

- [ ] **Step 4: Run to verify pass (including the regression tests)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/sitemap-crawler.test.ts`
Expected: PASS — new hybrid tests AND all pre-existing sitemap-crawler tests (hybrid:false regression).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/sitemap-crawler.ts lib/ada-audit/sitemap-crawler.test.ts
git commit -m "feat(c6): wire hybrid crawl into discoverPages behind a hybrid flag"
```

---

### Task 6: wire the discover handler (seoIntent + persist + budget clamp)

**Files:**
- Modify: `lib/jobs/handlers/site-audit-discover.ts`

**Interfaces:**
- Consumes: `discoverPages` returning `DiscoverResult` (Task 5).
- Produces: for seoIntent audits, persists `discoveryMode:'hybrid'` + `discoverySourcesJson` (the versioned object) atomically with `discoveredUrls`; pre-discovered seoIntent audits get hybrid-expanded.

Key facts: the discover handler's `JOB_TIMEOUT` is 300_000 (its `timeoutMs`). The one-active claim + first-writer-wins persist are at lines ~73–150. `enqueueAudit` (`lib/ada-audit/queue-manager.ts:114`) writes `discoveredUrls` for pre-discovered audits. Use `Date.now()` for `updatedAt` in raw SQL only; the `updateMany` here is Prisma (auto `@updatedAt`).

- [ ] **Step 1: Write the failing test**

Add a handler test (mock `discoverPages` and prisma) asserting: (a) a seoIntent audit persists `discoveryMode:'hybrid'` + non-null `discoverySourcesJson`; (b) a non-seoIntent audit persists `discoveryMode:'sitemap'` + null `discoverySourcesJson`. If the repo has no existing `site-audit-discover.test.ts`, follow the mocking pattern of the nearest handler test (e.g. `broken-link-verify.test.ts`) — mock `@/lib/ada-audit/sitemap-crawler`'s `discoverPages` and `@/lib/db`.

```typescript
// lib/jobs/handlers/site-audit-discover.test.ts  (create; adapt mocks to the repo's handler-test style)
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ada-audit/sitemap-crawler', () => ({
  discoverPages: vi.fn(),
}))
// ...mock @/lib/db, ../queue, ./site-audit-page, @/lib/ada-audit/site-audit-finalizer per repo style...

import { discoverPages } from '@/lib/ada-audit/sitemap-crawler'

describe('site-audit-discover hybrid wiring', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists hybrid mode + source map for a seoIntent audit', async () => {
    ;(discoverPages as any).mockResolvedValue({
      urls: ['https://x.com/a', 'https://x.com/b'], mode: 'hybrid', capped: false,
      coverage: { sources: { 'https://x.com/a': 'sitemap', 'https://x.com/b': 'linked' }, sitemapCount: 1, sitemapCapped: false, stoppedBy: 'exhausted', fetches: 2 },
    })
    // ...arrange a queued seoIntent audit with discoveredUrls: null; run runSiteAuditDiscoverJob...
    // assert the updateMany data included discoveryMode:'hybrid' and a JSON discoverySourcesJson with v:1
  })

  it('passes hybrid:false for a non-seoIntent audit', async () => {
    ;(discoverPages as any).mockResolvedValue({ urls: ['https://x.com/a'], mode: 'sitemap', capped: false })
    // ...run with seoIntent:false; assert discoverPages called with { hybrid:false, ... } and discoverySourcesJson stays null
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-discover.test.ts`
Expected: FAIL — handler doesn't pass `hybrid` or persist `discoverySourcesJson` yet.

- [ ] **Step 3: Implement**

In `lib/jobs/handlers/site-audit-discover.ts`:

1. Add `seoIntent: true` to the `findUnique` select (line ~85).
2. Compute the effective crawl budget from the job's remaining time. Add near the top: `const DISCOVER_JOB_TIMEOUT_MS = 300_000; const INSERT_RESERVE_MS = 60_000; const CRAWL_FLOOR_MS = 15_000;`. Capture `const jobStartedAt = Date.now()` at the top of `runSiteAuditDiscoverJob`.
3. Replace the `discoverPages(audit.domain)` call and the persist block. For the **non-pre-discovered** branch (`urls === null`):

Declare a same-invocation flag before the `urls === null` block: `let freshlyDiscoveredThisRun = false`. **Why (real bug found in review):** `audit` is read once at the top; `audit.discoverySourcesJson` stays the stale in-memory `null` even after the fresh branch persists a non-null map. Without the flag, the pre-discovered branch's guard (`… && audit.discoverySourcesJson === null && …`) evaluates true after a fresh discovery and fires a SECOND full hybrid crawl (the DB guard makes the persist no-op, but the wasted crawl burns the very budget this task adds). The flag makes the fresh and pre-discovered branches mutually exclusive within one invocation.

```typescript
  let freshlyDiscoveredThisRun = false
  if (urls === null) {
    const elapsed = Date.now() - jobStartedAt
    const timeBudgetMs = Math.max(0, DISCOVER_JOB_TIMEOUT_MS - elapsed - INSERT_RESERVE_MS)
    const hybrid = audit.seoIntent && timeBudgetMs >= CRAWL_FLOOR_MS
    const result = await discoverPages(audit.domain, { hybrid, timeBudgetMs })
    freshlyDiscoveredThisRun = true
    const discovered = [...new Set(result.urls)]
    const persisted = await prisma.siteAudit.updateMany({
      where: { id: siteAuditId, discoveredUrls: null },
      data: {
        discoveredUrls: JSON.stringify(discovered),
        pagesTotal: discovered.length,
        discoveryMode: result.mode,
        discoveryCapped: result.capped,
        discoverySourcesJson: result.coverage
          ? JSON.stringify({ v: 1, ...result.coverage })
          : null,
      },
    })
    if (persisted.count === 1) { urls = discovered }
    else {
      const reread = await prisma.siteAudit.findUnique({ where: { id: siteAuditId }, select: { discoveredUrls: true } })
      urls = parseUrlList(reread?.discoveredUrls ?? null) ?? discovered
    }
  }
```

4. Add the **pre-discovered seoIntent** branch right after the `urls === null` block resolves a non-null stored set — but only when the audit hasn't been hybrid-expanded yet. Select `discoverySourcesJson: true` in the initial findUnique too, then:

```typescript
  // Pre-discovered seoIntent audit not yet hybrid-expanded → expand from stored seeds.
  // `!freshlyDiscoveredThisRun`: if the fresh branch above already ran, `audit`'s
  // in-memory discoverySourcesJson is stale-null — the flag prevents a double crawl.
  if (!freshlyDiscoveredThisRun && audit.seoIntent && audit.discoverySourcesJson === null && urls && urls.length > 0) {
    const elapsed = Date.now() - jobStartedAt
    const timeBudgetMs = Math.max(0, DISCOVER_JOB_TIMEOUT_MS - elapsed - INSERT_RESERVE_MS)
    if (timeBudgetMs >= CRAWL_FLOOR_MS) {
      const result = await discoverPages(audit.domain, { hybrid: true, seeds: urls, timeBudgetMs })
      const expanded = [...new Set(result.urls)]
      const persisted = await prisma.siteAudit.updateMany({
        where: { id: siteAuditId, discoverySourcesJson: null },
        data: {
          discoveredUrls: JSON.stringify(expanded),
          pagesTotal: expanded.length,
          discoveryMode: result.mode,
          discoveryCapped: result.capped,
          discoverySourcesJson: result.coverage ? JSON.stringify({ v: 1, ...result.coverage }) : null,
        },
      })
      if (persisted.count === 1) {
        urls = expanded
      } else {
        // Codex #8: another attempt expanded first. Re-read the stored set so we
        // do NOT fall through to the ensure-repair step and overwrite
        // discoveredUrls/pagesTotal back to seed-only while the winner's source
        // map stays. Prefer the persisted (expanded) set.
        const reread = await prisma.siteAudit.findUnique({ where: { id: siteAuditId }, select: { discoveredUrls: true } })
        urls = parseUrlList(reread?.discoveredUrls ?? null) ?? urls
      }
    }
  }
```

5. The **ensure-repair** `updateMany` (guarded on `status:'running'`, currently rewriting `discoveredUrls`/`pagesTotal`): do NOT write `discoverySourcesJson` here at all (omit the field, so it is never overwritten to null). Add a code comment: the source map is written atomically by the two persist branches above; the ensure step only normalizes the URL array. **Codex #9 honesty caveat:** this preserves an existing map correctly, but it does NOT *create* a map for the corrupt-legacy re-discovery path (`parseUrlList` returned null → re-discovered above). In that path the non-pre-discovered branch already ran `discoverPages(hybrid)` and persisted `discoverySourcesJson` in its own guarded `updateMany`, so a map DOES exist by the time we reach ensure-repair. The only residual gap: a corrupt-legacy set on a **non-seoIntent** audit gets no map — which is correct (non-seoIntent never has one). No stranding.

- [ ] **Step 4: Run to verify pass + no regressions in the discover handler suite**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-discover.test.ts`
Expected: PASS — hybrid persisted for seoIntent, null for non-seoIntent.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/site-audit-discover.ts lib/jobs/handlers/site-audit-discover.test.ts
git commit -m "feat(c6): discover handler runs hybrid crawl for seoIntent audits, persists provenance + budget-clamped"
```

---

### Task 7: feed the dual miss-rate in the builder

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (select ~line 138; coverage call ~line 442)

**Interfaces:**
- Consumes: `computeDiscoveryCoverage` with the new optional inputs (Task 2); `DiscoverySourcesJson` shape (Task 6).
- Produces: `CrawlRun.discoveryCoverageJson` now carries `sitemapMissRate`/`residualMissRate` + applicability for hybrid runs.

- [ ] **Step 1: Write the failing test**

Extend the builder's existing test (or add a focused unit) asserting: given a `site.discoverySourcesJson` with `sources` mixing sitemap+linked and `sitemapCapped:false`, the `computeDiscoveryCoverage` call receives a `sitemapBaseline` = the sitemap-sourced URLs and `sitemapCapped:false`. If the builder test is heavy, instead add a tiny pure helper `deriveSitemapBaseline(json): { baseline: string[] | undefined; sitemapCapped: boolean | undefined }` in the builder and unit-test that:

```typescript
// in broken-link-verify.test.ts (or a new deriveSitemapBaseline.test.ts if extracted)
import { deriveSitemapBaseline } from './broken-link-verify'
it('derives the sitemap baseline from the source map', () => {
  const json = JSON.stringify({ v: 1, sources: { 'https://x.com/a': 'sitemap', 'https://x.com/b': 'linked', 'https://x.com/c': 'seed' }, sitemapCount: 2, sitemapCapped: false })
  const d = deriveSitemapBaseline(json)
  expect(d.baseline!.sort()).toEqual(['https://x.com/a', 'https://x.com/c'])
  expect(d.sitemapCapped).toBe(false)
})
it('returns undefined for null / non-hybrid', () => {
  expect(deriveSitemapBaseline(null)).toEqual({ baseline: undefined, sitemapCapped: undefined })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: FAIL — `deriveSitemapBaseline` not exported.

- [ ] **Step 3: Implement**

1. Add `discoverySourcesJson: true` to the `site` select (the block at ~line 138).
2. Add the exported helper:

```typescript
export function deriveSitemapBaseline(json: string | null): { baseline: string[] | undefined; sitemapCapped: boolean | undefined } {
  if (!json) return { baseline: undefined, sitemapCapped: undefined }
  try {
    const parsed = JSON.parse(json) as { sources?: Record<string, string>; sitemapCapped?: boolean }
    if (!parsed || typeof parsed.sources !== 'object' || !parsed.sources) return { baseline: undefined, sitemapCapped: undefined }
    const baseline = Object.entries(parsed.sources)
      .filter(([, src]) => src === 'sitemap' || src === 'seed' || src === 'shallow')
      .map(([url]) => url)
    return { baseline, sitemapCapped: parsed.sitemapCapped === true }
  } catch {
    return { baseline: undefined, sitemapCapped: undefined }
  }
}
```

3. At the `computeDiscoveryCoverage` call (~line 442), derive and pass:

```typescript
  const { baseline: sitemapBaseline, sitemapCapped } = deriveSitemapBaseline(site.discoverySourcesJson)
  const coverage = computeDiscoveryCoverage({
    discoveredUrls,
    internalLinks: rows.filter((r) => r.kind === 'internal-link').map((r) => ({ sourcePageUrl: r.sourcePageUrl, targetUrl: r.targetUrl })),
    discoveryMode: (site.discoveryMode as DiscoveryMode | null) ?? null,
    discoveryCapped: site.discoveryCapped ?? false,
    sitemapBaseline,
    sitemapCapped,
  })
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(c6): builder feeds sitemap baseline → dual miss-rate on live-scan run"
```

---

### Task 8: full gates + config docs

**Files:**
- Modify: whatever env-var reference doc the repo keeps (per `er-seo-tools-config-and-flags`; likely a section in `CLAUDE.md` or a config doc — grep for `BROKEN_LINK_MAX_CHECKS` to find where existing tunables are documented and add the 7 `HYBRID_CRAWL_*` vars there).

- [ ] **Step 1: Document the new env vars**

Add all **7** `HYBRID_CRAWL_*` vars wherever `BROKEN_LINK_*` vars are documented, with defaults: `HYBRID_CRAWL_MAX_DEPTH=3`, `HYBRID_CRAWL_MAX_ADDED=300`, `HYBRID_CRAWL_MAX_FETCHES=400`, `HYBRID_CRAWL_TIME_BUDGET_MS=120000`, `HYBRID_CRAWL_CONCURRENCY=6`, `HYBRID_CRAWL_MAX_QUERY_VARIANTS_PER_PATH=5`, `HYBRID_CRAWL_MAX_PATH_SEGMENTS=12`.

- [ ] **Step 2: Run the full gate suite**

Run:
```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: tsc clean; all tests green (including every pre-existing test — the back-compat guards); build completes.

- [ ] **Step 3: Commit**

```bash
git add -- CLAUDE.md docs   # explicit paths only — NEVER git add -A (untracked pentest-results/ etc.)
git commit -m "docs(c6): document HYBRID_CRAWL_* env vars"
```

---

## Self-Review

**Spec coverage:**
- seoIntent-only scope → Task 5 (`hybrid` flag) + Task 6 (passes `audit.seoIntent`, regression guard).
- Raw-HTTP crawl, no Chrome → Task 3 (injected fetch) + Task 5 (`fetchPageLinks` via `safeFetch`).
- Bounds (depth/added/fetches/time/traps) + env-configurable → Task 3 (`CrawlBounds`) + Task 5 (env tunables) + Task 8 (docs).
- Effective budget clamp (Codex #5) → Task 6.
- Total fetch cap (Codex #6) → Task 3 (`maxFetches`) + Task 5 env.
- Final-URL same-domain (Codex #7) → Task 3 + `fetchPageLinks` (Task 5).
- `normalizeLinkTarget` reuse (Codex #8) → Task 3.
- robots UA=* policy (Codex #9) → Task 1 + Task 5 wiring.
- Source map atomic persist + pre-discovered path (Codex #1, #2) → Task 6.
- Cap metadata + precedence (Codex #3, #4) → Task 3 (`sitemapCount`, precedence) + Task 5 (`sitemapCapped`) + Task 4 (JSON shape).
- Per-rate applicability (Codex #10) → Task 2.
- Miss-rate continuity → Task 2 (dual rate) + Task 7 (derive baseline).
- Schema migration → Task 4.

**Type consistency:** `DiscoverResult.coverage` shape (Task 5) ↔ persisted `{v:1,...coverage}` (Task 6) ↔ `deriveSitemapBaseline` reading `sources`/`sitemapCapped` (Task 7) — all agree. `CrawlBounds` fields (Task 3) match the object built in Task 5. `CrawlSource` union identical across Tasks 3/5/7.

**Placeholder scan:** migration timestamp is the only intentional `<timestamp>` — resolved at build time in Task 4 Step 2. Handler-test mocks (Task 6) say "adapt to repo style" because the exact prisma-mock harness must match the sibling handler test; the assertions are concrete.

**Codex plan-review verify items (folded in):**
- Existing `discovery-coverage` tests run unchanged — back-compat guard in Task 2 Step 4.
- Pre-discovered race test — Task 6 Step 1 should include a case where a second attempt's guarded `updateMany` returns `count === 0` and the handler re-reads (fix #8).
- **Confirm scheduled `seoIntent` audits are NOT pre-seeded** (else the crawler runs the cheap pre-discovered path over stored seeds instead of full sitemap discovery, or — if seeds are absent — the normal path). Verify at prod-verification time that the campaign clients hit the sitemap-discovery hybrid path (`discoveryMode:'hybrid'`, `sources` mostly `sitemap`+`linked`, not `seed`).
- Inspect one produced `discoverySourcesJson`: every `sources` key must be the coverage-normalized form of some `SiteAudit.discoveredUrls` entry (they are NOT always string-equal — a root seed url `https://x.com/` has key `https://x.com`; `discoveredUrls` holds the real fetch URLs, `sources` keys are coverage-normalized). Verify `normalizeCoverageUrl(url)` of each discoveredUrls entry covers the key set — no stranded source-map-only keys (guaranteed by Task 3 fix #3 + the key↔fetchUrl 1:1 map, verify empirically).

## Execution Handoff

(Offered after save.)
