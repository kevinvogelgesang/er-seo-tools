# Hybrid-discovery L1 — coverage-metric normalization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `discoveryCoverageJson.residualMissRate` count only policy-filtered *content* pages (dropping tracking-param dupes, malformed URLs, pagination, WP taxonomy, thank-you, and account URLs), while retaining the raw number and a per-reason breakdown for full transparency.

**Architecture:** A pure, coverage-local normalization layer inside `lib/ada-audit/seo/discovery-coverage.ts`. `contentNormalize()` extends the shared `normalizeCoverageUrl()` (extra tracking params + trailing-whitespace trim) WITHOUT modifying it; `classifyExclusion()` flags non-content URL patterns. `computeDiscoveryCoverage()` computes the raw rate (unchanged, → `residualMissRateRaw`) AND the filtered rate (→ `residualMissRate`, the gate), plus `nonContentExcludedCount` + `excludedByReason`. No schema, no fetch, no crawl change.

**Tech Stack:** TypeScript, Vitest. Pure functions only.

## Global Constraints

- **No schema change** — coverage rides `CrawlRun.discoveryCoverageJson` (JSON string).
- **Do NOT modify the shared `normalizeCoverageUrl`** — it is the crawl's dedup KEY (`hybrid-crawl.ts`) and feeds the FROZEN `broken-link-verify.characterization.test.ts`. All new normalization is coverage-local, layered on top.
- **Pure functions** — no `Date.now()`, no `Math.random()`, no IO. Deterministic.
- **`residualMissRate` = policy-filtered gate number; `residualMissRateRaw` = today's exact behavior.** `residualMissRateRaw ≥ residualMissRate` is NOT an invariant (filtering both sides can make the filtered rate rise).
- **`nonContentExcludedCount` = distinct normalized URLs excluded** (never occurrences or summed set sizes).
- Copy/wording: "policy-filtered", never "identifies indexable content".
- Functional params (`position`, `page`, `s`, `p`, `id`) are NEVER stripped — only known tracking params.

---

## File Structure

- `lib/ada-audit/seo/discovery-coverage.ts` — add `contentNormalize`, `classifyExclusion`, `ExclusionReason`; extend `DiscoveryCoverage` interface; rework `computeDiscoveryCoverage`. (Modify)
- `lib/ada-audit/seo/discovery-coverage.test.ts` — new fixtures per pattern class + "filtered can rise" + attribution. (Modify)
- `components/site-audit/DiscoveryCoverageSection.tsx` — read filtered rate; optional raw-vs-filtered note; sample already comes filtered. (Modify)
- `components/site-audit/DiscoveryCoverageSection.test.tsx` — update fixtures for new fields. (Modify)
- `components/sales/sections.tsx` — `sitemapMissRatePct` now derives from the filtered `sitemapMissRate`; verify copy still honest. (Verify/Modify)

---

## Task 1: `contentNormalize` — extra tracking params + trailing-whitespace trim

**Files:**
- Modify: `lib/ada-audit/seo/discovery-coverage.ts`
- Test: `lib/ada-audit/seo/discovery-coverage.test.ts`

**Interfaces:**
- Consumes: the existing exported `normalizeCoverageUrl(url: string): string`.
- Produces: `contentNormalize(url: string): string` — `normalizeCoverageUrl` output with the extra tracking params removed and trailing encoded/literal whitespace trimmed from the pathname. Idempotent; passes non-URLs through unchanged.

- [ ] **Step 1: Write the failing test**

Add to `discovery-coverage.test.ts`:

```ts
import { normalizeCoverageUrl, computeDiscoveryCoverage, contentNormalize, classifyExclusion } from './discovery-coverage'

describe('contentNormalize', () => {
  it('strips extra tracking params (lead_src/gclid/gad/fbclid) but keeps functional params', () => {
    expect(contentNormalize('https://x.com/apply?lead_src=w-menu')).toBe('https://x.com/apply')
    expect(contentNormalize('https://x.com/?gad=1&gclid=abc')).toBe('https://x.com')
    // functional params survive
    expect(contentNormalize('https://x.com/jobs?position=414')).toBe('https://x.com/jobs?position=414')
  })
  it('trims trailing encoded/literal whitespace (%C2%A0, %20) off the pathname', () => {
    expect(contentNormalize('https://x.com/blog/a/%C2%A0')).toBe('https://x.com/blog/a')
    expect(contentNormalize('https://x.com/blog/b%20')).toBe('https://x.com/blog/b')
  })
  it('is idempotent and preserves the existing normalize behavior for clean URLs', () => {
    expect(contentNormalize('https://www.x.com/foo/')).toBe('https://x.com/foo')
    expect(contentNormalize(contentNormalize('https://x.com/apply?lead_src=z'))).toBe('https://x.com/apply')
  })
  it('passes non-URLs through unchanged', () => {
    expect(contentNormalize('not a url')).toBe('not a url')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts -t contentNormalize`
Expected: FAIL — `contentNormalize` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `discovery-coverage.ts` (after the existing `normalizeCoverageUrl`):

```ts
// Coverage-local content normalization layered ON TOP of the shared
// normalizeCoverageUrl (which stays the crawl's dedup KEY and must not change).
// Removes tracking params beyond utm_* and trims trailing whitespace so a
// tracking variant / broken-nbsp URL collapses onto its real page.
const EXTRA_TRACKING_PARAMS = [
  'lead_src', 'gclid', 'gad', 'gbraid', 'wbraid', 'fbclid',
  'msclkid', 'yclid', 'mc_cid', 'mc_eid', '_ga',
]

export function contentNormalize(url: string): string {
  const base = normalizeCoverageUrl(url)
  let u: URL
  try {
    u = new URL(base)
  } catch {
    return base // non-URL passthrough (normalizeFindingUrl already ran)
  }
  for (const p of EXTRA_TRACKING_PARAMS) u.searchParams.delete(p)
  // Trim trailing encoded (%C2%A0 nbsp, %20) or literal whitespace off the path.
  u.pathname = u.pathname.replace(/(?:%C2%A0|%20|\s)+$/i, '')
  if (u.pathname === '') u.pathname = '/'
  if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '')
  let out = u.toString()
  if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '')
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts -t contentNormalize`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/discovery-coverage.ts lib/ada-audit/seo/discovery-coverage.test.ts
git commit -m "feat(discovery-coverage): contentNormalize — extra tracking params + whitespace trim"
```

---

## Task 2: `classifyExclusion` — non-content URL pattern classifier

**Files:**
- Modify: `lib/ada-audit/seo/discovery-coverage.ts`
- Test: `lib/ada-audit/seo/discovery-coverage.test.ts`

**Interfaces:**
- Produces: `type ExclusionReason = 'pagination' | 'taxonomy' | 'thankyou' | 'account'` and `classifyExclusion(normalizedUrl: string): ExclusionReason | null` — matches on the pathname of an already-normalized URL. Returns the FIRST matching reason (pagination before taxonomy), or `null` for content.

- [ ] **Step 1: Write the failing test**

```ts
describe('classifyExclusion', () => {
  it('flags WordPress pagination', () => {
    expect(classifyExclusion('https://x.com/blog/page/2')).toBe('pagination')
    expect(classifyExclusion('https://x.com/category/news/page/3')).toBe('pagination')
    expect(classifyExclusion('https://x.com/author/joe/page/2')).toBe('pagination')
  })
  it('flags WP taxonomy archives', () => {
    expect(classifyExclusion('https://x.com/category/blog')).toBe('taxonomy')
    expect(classifyExclusion('https://x.com/tag/beauty')).toBe('taxonomy')
    expect(classifyExclusion('https://x.com/author/dareen')).toBe('taxonomy')
  })
  it('flags thank-you confirmation pages (prefix and suffix forms)', () => {
    expect(classifyExclusion('https://x.com/thank-you')).toBe('thankyou')
    expect(classifyExclusion('https://x.com/thank-you-apply-online')).toBe('thankyou')
    expect(classifyExclusion('https://x.com/application-thank-you')).toBe('thankyou')
  })
  it('flags WooCommerce account pages', () => {
    expect(classifyExclusion('https://x.com/my-account/lost-password')).toBe('account')
  })
  it('returns null for real content pages', () => {
    expect(classifyExclusion('https://x.com/programs/nursing')).toBeNull()
    expect(classifyExclusion('https://x.com/education')).toBeNull()
    expect(classifyExclusion('https://x.com/locations/austin-tx')).toBeNull()
    // "page" as a content word, not /page/N, is not pagination
    expect(classifyExclusion('https://x.com/landing-page')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts -t classifyExclusion`
Expected: FAIL — `classifyExclusion` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `discovery-coverage.ts`:

```ts
export type ExclusionReason = 'pagination' | 'taxonomy' | 'thankyou' | 'account'

// Policy filter: well-known non-content URL shapes. NOTE (honesty): taxonomy /
// pagination are NOT categorically non-content — they can be indexable landing
// pages. This is a policy choice (Kevin, 2026-07-20), surfaced per-reason, never
// claimed as "identifies indexable content".
export function classifyExclusion(normalizedUrl: string): ExclusionReason | null {
  let pathname: string
  try {
    pathname = new URL(normalizedUrl).pathname
  } catch {
    return null
  }
  if (/\/page\/\d+\/?$/.test(pathname)) return 'pagination'
  const segs = pathname.split('/').filter(Boolean)
  const first = segs[0]?.toLowerCase()
  if (first === 'category' || first === 'tag' || first === 'author') return 'taxonomy'
  if (first === 'my-account') return 'account'
  const last = (segs[segs.length - 1] ?? '').toLowerCase()
  if (/^(?:thank-you|thank_you)(?:-.*)?$/.test(last) || /-thank-you$/.test(last)) return 'thankyou'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts -t classifyExclusion`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/discovery-coverage.ts lib/ada-audit/seo/discovery-coverage.test.ts
git commit -m "feat(discovery-coverage): classifyExclusion — non-content URL patterns"
```

---

## Task 3: `computeDiscoveryCoverage` — filtered gate rate + raw companion + attribution

**Files:**
- Modify: `lib/ada-audit/seo/discovery-coverage.ts`
- Test: `lib/ada-audit/seo/discovery-coverage.test.ts`

**Interfaces:**
- Consumes: `contentNormalize`, `classifyExclusion`, existing `normalizeCoverageUrl`, `isNonPage`.
- Produces: extended `DiscoveryCoverage` with new fields:
  - `residualMissRate: number | null` — now **policy-filtered** (content-only). Unchanged field name; changed meaning.
  - `residualMissRateRaw: number | null` — the pre-L1 residual (uses `normalizeCoverageUrl`, no pattern exclusion). Equals today's prod value.
  - `nonContentExcludedCount: number` — distinct raw off-baseline URLs removed by the filter.
  - `excludedByReason: Record<'param'|'malformed'|'pagination'|'taxonomy'|'thankyou'|'account', number>`.
  - `excludedSampleByReason: Partial<Record<string, string[]>>` — ≤3 example URLs per reason.
  - `missRate` and `sitemapMissRate` also become filtered (consistency); `sample` drawn from the FILTERED off-baseline set.

- [ ] **Step 1: Write the failing tests**

```ts
describe('computeDiscoveryCoverage — L1 policy filter', () => {
  const base = { discoveryMode: 'hybrid' as const, discoveryCapped: false }

  it('excludes thank-you/pagination/taxonomy/account from residual and attributes them', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://x.com/a', 'https://x.com/b'],
      sitemapBaseline: ['https://x.com/a', 'https://x.com/b'],
      internalLinks: [
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/thank-you' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/blog/page/2' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/category/news' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/my-account/orders' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/programs/nursing' }, // real miss
      ],
    })
    // filtered: only /programs/nursing is a real miss; baseline has 2 content pages
    expect(r.residualMissRate).toBeCloseTo(1 / 3) // 1 / (2 + 1)
    expect(r.excludedByReason.thankyou).toBe(1)
    expect(r.excludedByReason.pagination).toBe(1)
    expect(r.excludedByReason.taxonomy).toBe(1)
    expect(r.excludedByReason.account).toBe(1)
    expect(r.nonContentExcludedCount).toBe(4)
    // raw counts all 5 off-baseline
    expect(r.residualMissRateRaw).toBeCloseTo(5 / 7) // 5 / (2 + 5)
  })

  it('collapses tracking-param + malformed dupes onto their real page (param/malformed reasons)', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://x.com/apply', 'https://x.com/blog/a'],
      sitemapBaseline: ['https://x.com/apply', 'https://x.com/blog/a'],
      internalLinks: [
        { sourcePageUrl: 'https://x.com/', targetUrl: 'https://x.com/apply?lead_src=w-menu' },
        { sourcePageUrl: 'https://x.com/', targetUrl: 'https://x.com/blog/a/%C2%A0' },
      ],
    })
    expect(r.residualMissRate).toBe(0) // both collapse onto baseline
    expect(r.excludedByReason.param).toBe(1)
    expect(r.excludedByReason.malformed).toBe(1)
    expect(r.nonContentExcludedCount).toBe(2)
    expect(r.residualMissRateRaw).toBeGreaterThan(0) // raw counted them as missed
  })

  it('filtered rate CAN EXCEED raw rate (not monotone) — Codex F4', () => {
    // 1 content baseline + many excluded baseline + 1 missed content page.
    const discoveredUrls = [
      'https://x.com/home',
      ...Array.from({ length: 10 }, (_, i) => `https://x.com/category/c${i}`),
    ]
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls,
      sitemapBaseline: discoveredUrls,
      internalLinks: [
        { sourcePageUrl: 'https://x.com/home', targetUrl: 'https://x.com/programs/x' },
      ],
    })
    // raw: 1 miss / (11 baseline + 1) = 1/12 ≈ 0.083
    // filtered: baseline drops the 10 taxonomy → 1 content baseline; 1 miss / (1 + 1) = 0.5
    expect(r.residualMissRateRaw!).toBeLessThan(r.residualMissRate!)
    expect(r.residualMissRate).toBeCloseTo(0.5)
  })

  it('sample is drawn from the FILTERED off-baseline set (no excluded URLs shown)', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://x.com/a'],
      sitemapBaseline: ['https://x.com/a'],
      internalLinks: [
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/thank-you' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/programs/nursing' },
      ],
    })
    const sampleUrls = r.sample.map((s) => s.targetUrl)
    expect(sampleUrls).toContain('https://x.com/programs/nursing')
    expect(sampleUrls).not.toContain('https://x.com/thank-you')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts -t "L1 policy filter"`
Expected: FAIL — new fields undefined / rates use raw values.

- [ ] **Step 3: Write the implementation**

Extend the `DiscoveryCoverage` interface:

```ts
export interface DiscoveryCoverage {
  mode: DiscoveryMode | null
  capped: boolean
  applicable: boolean
  discoveredCount: number
  linkedInternalCount: number
  offBaselineCount: number
  missRate: number | null
  sample: DiscoveryCoverageSampleEntry[]
  sitemapMissRate: number | null
  sitemapApplicable: boolean
  residualMissRate: number | null
  residualApplicable: boolean
  hybridCapped: boolean
  // L1 additions
  residualMissRateRaw: number | null
  nonContentExcludedCount: number
  excludedByReason: Record<'param' | 'malformed' | 'pagination' | 'taxonomy' | 'thankyou' | 'account', number>
  excludedSampleByReason: Partial<Record<string, string[]>>
}
```

Replace the body of `computeDiscoveryCoverage` with:

```ts
export function computeDiscoveryCoverage(input: DiscoveryCoverageInput): DiscoveryCoverage {
  const { discoveredUrls, internalLinks, discoveryMode, discoveryCapped, sitemapBaseline, sitemapCapped } = input

  const isContent = (normalized: string) => !isNonPage(normalized) && classifyExclusion(normalized) === null

  // pure off/(base+off) over provided (base, linked) sets
  const missAgainst = (base: Set<string>, linked: Set<string>): number => {
    let off = 0
    for (const t of linked) if (!base.has(t)) off++
    const denom = base.size + off
    return denom === 0 ? 0 : off / denom
  }

  // ── RAW sets (pre-L1 behavior, shared normalizer, isNonPage only) ──
  const rawBaseline = new Set(discoveredUrls.map(normalizeCoverageUrl))
  const rawLinked = new Set<string>()
  for (const l of internalLinks) {
    const t = normalizeCoverageUrl(l.targetUrl)
    if (isNonPage(t)) continue
    rawLinked.add(t)
  }
  const rawSitemap = Array.isArray(sitemapBaseline)
    ? new Set(sitemapBaseline.map(normalizeCoverageUrl)) : null

  // ── FILTERED sets (contentNormalize + content-only) ──
  const fBaseline = new Set<string>()
  for (const u of discoveredUrls) {
    const n = contentNormalize(u)
    if (isContent(n)) fBaseline.add(n)
  }
  const fLinked = new Set<string>()
  const offSourcesFull = new Map<string, Set<string>>()
  for (const l of internalLinks) {
    const t = contentNormalize(l.targetUrl)
    if (!isContent(t)) continue
    fLinked.add(t)
    if (!fBaseline.has(t)) {
      let s = offSourcesFull.get(t)
      if (!s) { s = new Set<string>(); offSourcesFull.set(t, s) }
      s.add(contentNormalize(l.sourcePageUrl))
    }
  }
  const fSitemap = Array.isArray(sitemapBaseline)
    ? new Set(sitemapBaseline.map(contentNormalize).filter(isContent)) : null

  // ── Exclusion attribution over RAW off-baseline URLs ──
  const excludedByReason = { param: 0, malformed: 0, pagination: 0, taxonomy: 0, thankyou: 0, account: 0 }
  const excludedSampleByReason: Record<string, string[]> = {}
  const excludedUrls = new Set<string>()
  const noteExcluded = (reason: keyof typeof excludedByReason, url: string) => {
    if (excludedUrls.has(url)) return
    excludedUrls.add(url)
    excludedByReason[reason]++
    const arr = excludedSampleByReason[reason] ?? (excludedSampleByReason[reason] = [])
    if (arr.length < 3) arr.push(url)
  }
  for (const t of rawLinked) {
    if (rawBaseline.has(t)) continue // not a raw miss
    const cn = contentNormalize(t)
    const reason = classifyExclusion(cn)
    if (reason) { noteExcluded(reason, t); continue }
    if (fBaseline.has(cn)) {
      // collapsed onto a real page by extra normalization
      let bucket: 'param' | 'malformed' = 'param'
      try {
        const u = new URL(t)
        if (/(?:%C2%A0|%20)$/i.test(u.pathname) || /\s$/.test(decodeURIComponent(u.pathname))) bucket = 'malformed'
      } catch { /* keep param */ }
      noteExcluded(bucket, t)
    }
  }

  // ── Rates ──
  const applicable = discoveryMode === 'sitemap' && discoveryCapped === false
  const missRate = applicable ? missAgainst(fBaseline, fLinked) : null

  const hybridCapped = discoveryCapped === true
  const hasSitemapBaseline = Array.isArray(sitemapBaseline)
  const sitemapApplicable = hasSitemapBaseline && sitemapCapped !== true
  const sitemapMissRate = sitemapApplicable
    ? missAgainst(fSitemap!, fLinked)
    : (hasSitemapBaseline ? null : missRate)
  const residualApplicable = hasSitemapBaseline && !hybridCapped
  const residualMissRate = residualApplicable ? missAgainst(fBaseline, fLinked) : null
  const residualMissRateRaw = residualApplicable ? missAgainst(rawBaseline, rawLinked) : null

  const sample: DiscoveryCoverageSampleEntry[] = [...offSourcesFull.keys()]
    .sort()
    .slice(0, SAMPLE_CAP)
    .map((targetUrl) => ({
      targetUrl,
      sourcePageUrls: [...offSourcesFull.get(targetUrl)!].sort().slice(0, SOURCES_PER_TARGET),
    }))

  return {
    mode: discoveryMode,
    capped: discoveryCapped,
    applicable,
    discoveredCount: fBaseline.size,
    linkedInternalCount: fLinked.size,
    offBaselineCount: offSourcesFull.size,
    missRate,
    sample,
    sitemapMissRate,
    sitemapApplicable,
    residualMissRate,
    residualApplicable,
    hybridCapped,
    residualMissRateRaw,
    nonContentExcludedCount: excludedUrls.size,
    excludedByReason,
    excludedSampleByReason,
  }
}
```

Note: `discoveredCount`/`linkedInternalCount`/`offBaselineCount` now report FILTERED (content) counts — the numbers that match the gate rate. Raw totals live in `residualMissRateRaw` + `nonContentExcludedCount`.

- [ ] **Step 4: Run tests to verify they pass (whole file)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts`
Expected: PASS — new L1 tests green AND all pre-existing tests green (they use content URLs like `/a`,`/b`, so filtered == raw for them). If a pre-existing test asserts on `discoveredCount`/`offBaselineCount` with excluded URLs, update its expectation to the filtered count and note why in the test.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/discovery-coverage.ts lib/ada-audit/seo/discovery-coverage.test.ts
git commit -m "feat(discovery-coverage): policy-filtered residual + raw companion + reason breakdown"
```

---

## Task 4: Update read-time consumers (UI + sales)

**Files:**
- Modify: `components/site-audit/DiscoveryCoverageSection.tsx`
- Test: `components/site-audit/DiscoveryCoverageSection.test.tsx`
- Verify/Modify: `components/sales/sections.tsx`

**Interfaces:**
- Consumes: the extended `DiscoveryCoverage` JSON on `run.discoveryCoverageJson`.

- [ ] **Step 1: Write the failing test**

Add to `DiscoveryCoverageSection.test.tsx` (hybrid state):

```ts
it('shows the filtered residual and a raw-vs-filtered note when they differ', () => {
  render(<DiscoveryCoverageSection run={cov({
    mode: 'hybrid', capped: false, discoveredCount: 20, offBaselineCount: 1,
    missRate: null, sitemapMissRate: 0.3, residualMissRate: 0.03,
    residualMissRateRaw: 0.19, nonContentExcludedCount: 12,
    excludedByReason: { param: 2, malformed: 1, pagination: 4, taxonomy: 3, thankyou: 2, account: 0 },
    excludedSampleByReason: {}, sample: [],
  })} />)
  expect(screen.getByText(/3% remained undiscovered/i)).toBeInTheDocument()
  expect(screen.getByText(/12 non-content URLs excluded/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/DiscoveryCoverageSection.test.tsx`
Expected: FAIL — the "non-content URLs excluded" note isn't rendered.

- [ ] **Step 3: Add the note to the hybrid branch of `DiscoveryCoverageSection.tsx`**

In the `data.mode === 'hybrid'` block, after the existing `<p>` (rate line), add:

```tsx
{typeof data.nonContentExcludedCount === 'number' && data.nonContentExcludedCount > 0 && (
  <p className="mt-1 text-[12px] font-body text-navy/50 dark:text-white/50">
    {data.nonContentExcludedCount} non-content URLs excluded (policy filter:
    params, pagination, taxonomy, thank-you, account
    {typeof data.residualMissRateRaw === 'number'
      ? `; raw ${Math.round(data.residualMissRateRaw * 100)}%`
      : ''}).
  </p>
)}
```

Extend the `CoverageData` interface in this file with `residualMissRateRaw?: number | null` and `nonContentExcludedCount?: number` and `excludedByReason?` (optional — legacy runs lack them).

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/DiscoveryCoverageSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify the sales consumer**

Read `components/sales/sections.tsx` around `sitemapMissRatePct`. `sitemapMissRate` is now the FILTERED value — confirm the sales copy ("X% of reachable pages are missing from the sitemap") is still accurate for the filtered number (it is: filtered = content pages missing from the sitemap). No code change needed unless the copy implies "all URLs"; if so, leave copy as-is (it says "pages", which is now more accurate). No edit required — this step is a verified no-op unless the wording claims completeness.

- [ ] **Step 6: Commit**

```bash
git add components/site-audit/DiscoveryCoverageSection.tsx components/site-audit/DiscoveryCoverageSection.test.tsx
git commit -m "feat(discovery-coverage): surface policy-filtered residual + excluded count in UI"
```

---

## Task 5: Full gate + parity-log documentation

**Files:**
- Modify: `docs/superpowers/todos/2026-07-05-sf-live-parity-log.md`

- [ ] **Step 1: Run the full local gate**

Run: `npm run lint` (tsc --noEmit)
Expected: clean.

Run: `DATABASE_URL="file:./local-dev.db" npm test`
Expected: all green (including the FROZEN `broken-link-verify.characterization.test.ts` — L1 never touched the shared `normalizeCoverageUrl`, so it must remain byte-identical; if it fails, STOP — the isolation was violated).

Run: `npm run build`
Expected: build completes.

- [ ] **Step 2: Append the L1 section to the parity log**

Add a dated "L1 coverage normalization" section documenting: the fuller policy filter definition (params/malformed/pagination/taxonomy/thankyou/account), the "policy-filtered" wording decision, the 29-domain cohort ledger captured 2026-07-20 (raw residual per domain), and the *projected* filtered residual (recomputed off the stored samples). Note that the real re-baseline lands after the next weekly sweep re-runs coverage with L1 deployed.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/todos/2026-07-05-sf-live-parity-log.md
git commit -m "docs(parity-log): L1 policy-filter definition + 29-domain raw ledger"
```

---

## Self-Review

- **Spec coverage:** L1 §4 items 1–4 → Tasks 1–3; transparency fields → Task 3; UI/sales consumers → Task 4; gate + parity log → Task 5. ✓
- **Placeholder scan:** all steps carry real code/commands. ✓
- **Type consistency:** `contentNormalize`/`classifyExclusion`/`ExclusionReason` defined in Tasks 1–2, consumed in Task 3; `DiscoveryCoverage` new fields defined in Task 3, consumed in Task 4. ✓
- **Isolation invariant:** shared `normalizeCoverageUrl` untouched; frozen characterization test guards it (Task 5 Step 1). ✓
- **Codex F4 monotonicity:** Task 3 asserts the filtered rate CAN exceed raw — no monotonic assertion anywhere. ✓
