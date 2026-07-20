# Hybrid-discovery L1 — coverage-metric normalization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `discoveryCoverageJson.residualMissRate` count only policy-filtered *content* pages (dropping tracking-param dupes, malformed URLs, pagination, WP taxonomy, thank-you, and account URLs), while retaining the raw number and a two-sided (numerator + baseline) per-reason breakdown that fully explains the raw→filtered delta.

**Architecture:** A pure, coverage-local normalization layer inside `lib/ada-audit/seo/discovery-coverage.ts`. `contentNormalize()` extends the shared `normalizeCoverageUrl()` (extra tracking params + trailing-whitespace trim) WITHOUT modifying it; `classifyExclusion()` flags non-content URL patterns. `computeDiscoveryCoverage()` computes the raw rate (unchanged → `residualMissRateRaw`) AND the filtered rate (→ `residualMissRate`, the gate), plus numerator-side `excludedByReason`/`nonContentExcludedCount` and baseline-side `baselineExcludedByReason`/`baselineExcludedCount`. No schema, no fetch, no crawl change.

**Tech Stack:** TypeScript, Vitest. Pure functions only.

## Global Constraints

- **No schema change** — coverage rides `CrawlRun.discoveryCoverageJson` (JSON string).
- **Do NOT modify the shared `normalizeCoverageUrl`** — it is the crawl's dedup KEY (`hybrid-crawl.ts`) and feeds the FROZEN `broken-link-verify.characterization.test.ts`. All new normalization is coverage-local, layered on top.
- **The frozen characterization test WILL break on the new JSON shape (Codex F3).** Its `EXPECTED_DISCOVERY_COVERAGE` must be deliberately re-pinned to ADD the new fields (`residualMissRateRaw: null`, `nonContentExcludedCount: 0`, zeroed `excludedByReason`, empty `excludedSampleByReason`, `baselineExcludedCount: 0`, zeroed `baselineExcludedByReason`). Every PRE-EXISTING field/count MUST stay byte-identical — that is what proves the shared normalizer is untouched.
- **Pure functions** — no `Date.now()`, no `Math.random()`, no IO. Deterministic (sort inputs before sampling).
- **`residualMissRate` = policy-filtered gate; `residualMissRateRaw` = today's exact behavior.** `residualMissRateRaw ≥ residualMissRate` is NOT an invariant (filtering both sides can make the filtered rate rise — Codex F4).
- **`nonContentExcludedCount` = distinct numerator (off-baseline) URLs removed; `baselineExcludedCount` = distinct baseline URLs removed.** Never occurrences or summed sizes.
- Copy/wording: "policy-filtered" / "policy-excluded URL variants", never "identifies indexable content" and never "non-content URLs" for param/malformed dupes.
- Functional params (`position`, `page`, `s`, `p`, `id`, `paged`) are NEVER stripped — only known tracking params.
- **Fuller ≠ exhaustive (Codex F6):** the pattern set is the locked policy; known false-negatives (`/blog/category/news`, `?paged=2`, `/thankyou`, `/thank_you_application`, `/thank-you/application`) and intentional policy false-positives (a real `/tag/*` landing page) are documented in the parity log, not silently implied as complete.

---

## File Structure

- `lib/ada-audit/seo/discovery-coverage.ts` — add `contentNormalize`, `classifyExclusion`, `ExclusionReason`; extend `DiscoveryCoverage` interface; rework `computeDiscoveryCoverage`. (Modify)
- `lib/ada-audit/seo/discovery-coverage.test.ts` — new fixtures per pattern class + "filtered can rise" + two-sided attribution + collision cases. (Modify)
- `lib/jobs/handlers/broken-link-verify.characterization.test.ts` — re-pin `EXPECTED_DISCOVERY_COVERAGE` with the new fields (old fields unchanged). (Modify)
- `components/site-audit/DiscoveryCoverageSection.tsx` — filtered rate + policy-excluded note; non-hybrid branch copy → "policy-filtered". (Modify)
- `components/site-audit/DiscoveryCoverageSection.test.tsx` — update fixtures for new fields. (Modify)
- `lib/sales/sales-report-data.ts` — verify `sitemapMissRatePct` now derives from filtered `missRate` (Codex F7); confirm hybrid behavior unchanged. (Verify)
- `lib/sales/sales-report-data.test.ts` (or the nearest sales-data test) — confirm/adjust the sitemap-% expectation. (Verify/Modify)

---

## Task 1: `contentNormalize` — extra tracking params + trailing-whitespace trim

**Files:**
- Modify: `lib/ada-audit/seo/discovery-coverage.ts`
- Test: `lib/ada-audit/seo/discovery-coverage.test.ts`

**Interfaces:**
- Consumes: exported `normalizeCoverageUrl(url: string): string`.
- Produces: `contentNormalize(url: string): string` — `normalizeCoverageUrl` output with the extra tracking params removed and trailing encoded/literal whitespace trimmed from the pathname. Idempotent; passes non-URLs through unchanged.

- [ ] **Step 1: Write the failing test**

Add to `discovery-coverage.test.ts` (extend the import line to include `contentNormalize, classifyExclusion`):

```ts
import { normalizeCoverageUrl, computeDiscoveryCoverage, contentNormalize, classifyExclusion } from './discovery-coverage'

describe('contentNormalize', () => {
  it('strips extra tracking params (lead_src/gclid/gad/fbclid) but keeps functional params', () => {
    expect(contentNormalize('https://x.com/apply?lead_src=w-menu')).toBe('https://x.com/apply')
    expect(contentNormalize('https://x.com/?gad=1&gclid=abc')).toBe('https://x.com')
    expect(contentNormalize('https://x.com/jobs?position=414')).toBe('https://x.com/jobs?position=414')
    expect(contentNormalize('https://x.com/blog?paged=2')).toBe('https://x.com/blog?paged=2')
  })
  it('trims trailing encoded/literal whitespace (%C2%A0, %20) off the pathname', () => {
    expect(contentNormalize('https://x.com/blog/a/%C2%A0')).toBe('https://x.com/blog/a')
    expect(contentNormalize('https://x.com/blog/b%20')).toBe('https://x.com/blog/b')
  })
  it('is idempotent and preserves existing normalize behavior for clean URLs', () => {
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
Expected: FAIL — `contentNormalize` not exported.

- [ ] **Step 3: Write the implementation**

Add to `discovery-coverage.ts` after `normalizeCoverageUrl`:

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
    return base
  }
  for (const p of EXTRA_TRACKING_PARAMS) u.searchParams.delete(p)
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
- Produces: `type ExclusionReason = 'pagination' | 'taxonomy' | 'thankyou' | 'account'` and `classifyExclusion(normalizedUrl: string): ExclusionReason | null` — matches on the pathname; returns the FIRST match (pagination before taxonomy before account before thankyou — precedence pinned by test), or `null`.

- [ ] **Step 1: Write the failing test** (includes Codex F6 boundary cases)

```ts
describe('classifyExclusion', () => {
  it('flags WordPress pagination', () => {
    expect(classifyExclusion('https://x.com/blog/page/2')).toBe('pagination')
    expect(classifyExclusion('https://x.com/category/news/page/3')).toBe('pagination') // precedence: pagination first
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
  it('does NOT false-positive on content slugs that merely contain the words (Codex F6)', () => {
    expect(classifyExclusion('https://x.com/category-of-programs')).toBeNull()
    expect(classifyExclusion('https://x.com/tagline')).toBeNull()
    expect(classifyExclusion('https://x.com/authoring')).toBeNull()
    expect(classifyExclusion('https://x.com/my-accounting')).toBeNull()
    expect(classifyExclusion('https://x.com/landing-page')).toBeNull()
    expect(classifyExclusion('https://x.com/programs/nursing')).toBeNull()
  })
  it('documents known false-negatives — outside the locked pattern set, return null (Codex F6)', () => {
    // These are intentionally NOT caught; recorded in the parity log, not silently "content".
    expect(classifyExclusion('https://x.com/blog/category/news')).toBeNull() // taxonomy not at segment 0
    expect(classifyExclusion('https://x.com/thankyou')).toBeNull()           // no hyphen
    expect(classifyExclusion('https://x.com/thank-you/application')).toBeNull() // thank-you not last segment
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts -t classifyExclusion`
Expected: FAIL — not exported.

- [ ] **Step 3: Write the implementation**

```ts
export type ExclusionReason = 'pagination' | 'taxonomy' | 'thankyou' | 'account'

// Policy filter: well-known non-content URL shapes. NOTE (honesty): taxonomy /
// pagination are NOT categorically non-content — they can be indexable landing
// pages. This is a policy choice (Kevin, 2026-07-20), surfaced per-reason and
// never claimed as "identifies indexable content". Precedence: pagination >
// taxonomy > account > thankyou.
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
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/discovery-coverage.ts lib/ada-audit/seo/discovery-coverage.test.ts
git commit -m "feat(discovery-coverage): classifyExclusion — non-content URL patterns"
```

---

## Task 3: `computeDiscoveryCoverage` — filtered gate + raw companion + two-sided attribution

**Files:**
- Modify: `lib/ada-audit/seo/discovery-coverage.ts`
- Test: `lib/ada-audit/seo/discovery-coverage.test.ts`

**Interfaces:**
- Consumes: `contentNormalize`, `classifyExclusion`, `normalizeCoverageUrl`, `isNonPage`.
- Produces: extended `DiscoveryCoverage`:
  - `residualMissRate: number | null` — now **policy-filtered** (content-only). Same field name, changed meaning.
  - `residualMissRateRaw: number | null` — pre-L1 residual (raw normalizer, no pattern exclusion). Equals today's value.
  - `nonContentExcludedCount: number` — distinct raw off-baseline (numerator) URLs removed by the filter.
  - `excludedByReason: Record<'param'|'malformed'|'pagination'|'taxonomy'|'thankyou'|'account', number>` — numerator side.
  - `excludedSampleByReason: Partial<Record<string, string[]>>` — ≤3 examples/reason (numerator side).
  - `baselineExcludedCount: number` — distinct baseline URLs removed from the denominator by the policy pattern / non-page filter.
  - `baselineExcludedByReason: Record<'pagination'|'taxonomy'|'thankyou'|'account'|'nonpage', number>`.
  - `missRate` and `sitemapMissRate` also become filtered; `sample` drawn from the FILTERED off-baseline set.
- `discoveredCount`/`linkedInternalCount`/`offBaselineCount` now report FILTERED (content) counts.

- [ ] **Step 1: Write the failing tests** (numerator + baseline attribution, collisions, non-monotone)

```ts
describe('computeDiscoveryCoverage — L1 policy filter', () => {
  const base = { discoveryMode: 'hybrid' as const, discoveryCapped: false }

  it('excludes thank-you/pagination/taxonomy/account from residual and attributes numerator + baseline', () => {
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
    expect(r.residualMissRate).toBeCloseTo(1 / 3)       // 1 real miss / (2 baseline + 1)
    expect(r.residualMissRateRaw).toBeCloseTo(5 / 7)    // all 5 off-baseline / (2 + 5)
    expect(r.excludedByReason.thankyou).toBe(1)
    expect(r.excludedByReason.pagination).toBe(1)
    expect(r.excludedByReason.taxonomy).toBe(1)
    expect(r.excludedByReason.account).toBe(1)
    expect(r.nonContentExcludedCount).toBe(4)
    expect(r.offBaselineCount).toBe(1)                  // filtered
    expect(r.discoveredCount).toBe(2)                   // filtered baseline
  })

  it('duplicate tracking variant of one off-baseline miss is attributed, not double-counted (Codex F1a)', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://x.com/home'],
      sitemapBaseline: ['https://x.com/home'],
      internalLinks: [
        { sourcePageUrl: 'https://x.com/home', targetUrl: 'https://x.com/apply' },
        { sourcePageUrl: 'https://x.com/home', targetUrl: 'https://x.com/apply?gclid=x' }, // same page, tracking
      ],
    })
    // /apply is NOT in baseline → one surviving filtered miss; the ?gclid variant collapses onto it.
    expect(r.offBaselineCount).toBe(1)
    expect(r.excludedByReason.param).toBe(1)
    expect(r.nonContentExcludedCount).toBe(1)
  })

  it('clean link covered by a tracking-variant baseline URL becomes covered (Codex F1b)', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://x.com/apply?gclid=x'],       // baseline carries a tracking variant
      sitemapBaseline: ['https://x.com/apply?gclid=x'],
      internalLinks: [{ sourcePageUrl: 'https://x.com/home', targetUrl: 'https://x.com/apply' }],
    })
    expect(r.residualMissRate).toBe(0)                        // filtered baseline has /apply
    expect(r.excludedByReason.param).toBe(1)                  // the raw off-baseline /apply resolved by param normalization
    expect(r.residualMissRateRaw).toBeGreaterThan(0)         // raw counted it as missed
  })

  it('baseline-only policy exclusions raise the filtered rate and are counted (Codex F1c, F4 non-monotone)', () => {
    const discoveredUrls = [
      'https://x.com/home',
      ...Array.from({ length: 10 }, (_, i) => `https://x.com/category/c${i}`),
    ]
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls,
      sitemapBaseline: discoveredUrls,
      internalLinks: [{ sourcePageUrl: 'https://x.com/home', targetUrl: 'https://x.com/programs/x' }],
    })
    expect(r.residualMissRateRaw!).toBeLessThan(r.residualMissRate!) // filtered CAN exceed raw
    expect(r.residualMissRate).toBeCloseTo(0.5)              // 1 miss / (1 content baseline + 1)
    expect(r.nonContentExcludedCount).toBe(0)               // numerator unchanged
    expect(r.baselineExcludedCount).toBe(10)               // denominator shrank — this explains the rise
    expect(r.baselineExcludedByReason.taxonomy).toBe(10)
  })

  it('collapses malformed (%C2%A0) dupes onto their real page (Codex F1)', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://x.com/blog/a'],
      sitemapBaseline: ['https://x.com/blog/a'],
      internalLinks: [{ sourcePageUrl: 'https://x.com/home', targetUrl: 'https://x.com/blog/a/%C2%A0' }],
    })
    expect(r.residualMissRate).toBe(0)
    expect(r.excludedByReason.malformed).toBe(1)
    expect(r.nonContentExcludedCount).toBe(1)
  })

  it('sample is drawn from the FILTERED off-baseline set, sorted deterministically (Codex F2)', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://x.com/a'],
      sitemapBaseline: ['https://x.com/a'],
      internalLinks: [
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/thank-you' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/programs/nursing' },
      ],
    })
    const urls = r.sample.map((s) => s.targetUrl)
    expect(urls).toContain('https://x.com/programs/nursing')
    expect(urls).not.toContain('https://x.com/thank-you')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts -t "L1 policy filter"`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Extend the interface:

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
  baselineExcludedCount: number
  baselineExcludedByReason: Record<'pagination' | 'taxonomy' | 'thankyou' | 'account' | 'nonpage', number>
}
```

Replace `computeDiscoveryCoverage`:

```ts
export function computeDiscoveryCoverage(input: DiscoveryCoverageInput): DiscoveryCoverage {
  const { discoveredUrls, internalLinks, discoveryMode, discoveryCapped, sitemapBaseline, sitemapCapped } = input

  const isContent = (normalized: string) => !isNonPage(normalized) && classifyExclusion(normalized) === null
  const missAgainst = (baseSet: Set<string>, linkedSet: Set<string>): number => {
    let off = 0
    for (const t of linkedSet) if (!baseSet.has(t)) off++
    const denom = baseSet.size + off
    return denom === 0 ? 0 : off / denom
  }
  const collapseReason = (rawUrl: string): 'param' | 'malformed' => {
    try {
      const u = new URL(rawUrl)
      if (/(?:%C2%A0|%20)$/i.test(u.pathname) || /\s$/.test(decodeURIComponent(u.pathname))) return 'malformed'
    } catch { /* fall through */ }
    return 'param'
  }

  // ── RAW sets (pre-L1: shared normalizer, isNonPage only) ──
  const rawBaseline = new Set(discoveredUrls.map(normalizeCoverageUrl))
  const rawLinked = new Set<string>()
  for (const l of internalLinks) {
    const t = normalizeCoverageUrl(l.targetUrl)
    if (isNonPage(t)) continue
    rawLinked.add(t)
  }

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

  // ── Numerator attribution: raw off-baseline URLs no longer counted as filtered misses ──
  const excludedByReason = { param: 0, malformed: 0, pagination: 0, taxonomy: 0, thankyou: 0, account: 0 }
  const excludedSampleByReason: Record<string, string[]> = {}
  const noteNum = (reason: keyof typeof excludedByReason, url: string) => {
    excludedByReason[reason]++
    const arr = excludedSampleByReason[reason] ?? (excludedSampleByReason[reason] = [])
    if (arr.length < 3) arr.push(url)
  }
  const survivors = new Set<string>()          // filtered miss keys that survive
  const rawOff = [...rawLinked].filter((t) => !rawBaseline.has(t)).sort()  // deterministic
  for (const t of rawOff) {
    const cn = contentNormalize(t)
    const pat = classifyExclusion(cn)
    if (pat) { noteNum(pat, t); continue }
    if (isNonPage(cn)) { noteNum('malformed', t); continue }  // trim revealed a non-page ext
    if (fBaseline.has(cn)) { noteNum(collapseReason(t), t); continue }  // collapsed onto a covered page
    if (survivors.has(cn)) { noteNum(collapseReason(t), t); continue }  // duplicate variant of a surviving miss
    survivors.add(cn)                                          // first (sorted) survivor
  }
  const nonContentExcludedCount = Object.values(excludedByReason).reduce((a, b) => a + b, 0)

  // ── Baseline attribution: distinct raw baseline URLs removed from the denominator ──
  const baselineExcludedByReason = { pagination: 0, taxonomy: 0, thankyou: 0, account: 0, nonpage: 0 }
  const baselineExcludedUrls = new Set<string>()
  for (const rb of rawBaseline) {
    const cn = contentNormalize(rb)
    const pat = classifyExclusion(cn)
    if (pat) { baselineExcludedByReason[pat]++; baselineExcludedUrls.add(rb); continue }
    if (isNonPage(cn)) { baselineExcludedByReason.nonpage++; baselineExcludedUrls.add(rb) }
  }
  const baselineExcludedCount = baselineExcludedUrls.size

  // ── Rates (filtered) + raw residual companion ──
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
    nonContentExcludedCount,
    excludedByReason,
    excludedSampleByReason,
    baselineExcludedCount,
    baselineExcludedByReason,
  }
}
```

- [ ] **Step 4: Run the whole file**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts`
Expected: PASS — new L1 tests + all pre-existing tests (they use content URLs, so filtered == raw). If a pre-existing test's comment says "raw count still computed" (line ~94), update the comment to note the value is now filtered but equals the raw value for that content URL.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/discovery-coverage.ts lib/ada-audit/seo/discovery-coverage.test.ts
git commit -m "feat(discovery-coverage): policy-filtered residual + raw companion + two-sided attribution"
```

---

## Task 4: Re-pin the frozen characterization test (Codex F3)

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.characterization.test.ts`

**Interfaces:**
- Consumes: the new `DiscoveryCoverage` shape.

- [ ] **Step 1: Run the frozen test to see the exact break**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.characterization.test.ts -t discoveryCoverage`
Expected: FAIL — `toEqual(EXPECTED_DISCOVERY_COVERAGE)` reports the 6 new keys present in actual but missing from expected.

- [ ] **Step 2: Add ONLY the new fields to `EXPECTED_DISCOVERY_COVERAGE`**

Locate `const EXPECTED_DISCOVERY_COVERAGE = { ... }` (~line 216). Append the new fields; **do NOT touch any existing key/value** (unchanged old fields are the isolation proof):

```ts
  // L1 additions (isolation proof: all pre-existing fields above are unchanged)
  residualMissRateRaw: null,
  nonContentExcludedCount: 0,
  excludedByReason: { param: 0, malformed: 0, pagination: 0, taxonomy: 0, thankyou: 0, account: 0 },
  excludedSampleByReason: {},
  baselineExcludedCount: 0,
  baselineExcludedByReason: { pagination: 0, taxonomy: 0, thankyou: 0, account: 0, nonpage: 0 },
```

If the run reports that any PRE-EXISTING field changed (e.g. `offBaselineCount` moved from 11), STOP — that means a fixture URL matched a new pattern and isolation is NOT clean; investigate before re-pinning.

- [ ] **Step 3: Run to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.characterization.test.ts`
Expected: PASS — only the additive keys changed.

- [ ] **Step 4: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.characterization.test.ts
git commit -m "test(char): re-pin discoveryCoverage shape with L1 additive fields (old fields unchanged)"
```

---

## Task 5: Read-time consumers — UI + sales (Codex F7)

**Files:**
- Modify: `components/site-audit/DiscoveryCoverageSection.tsx` + its test
- Verify: `lib/sales/sales-report-data.ts` + its test

**Interfaces:**
- Consumes: the extended `DiscoveryCoverage` JSON.

- [ ] **Step 1: Write the failing UI test**

Add to `DiscoveryCoverageSection.test.tsx` (hybrid state):

```ts
it('shows filtered residual + policy-excluded note with raw companion', () => {
  render(<DiscoveryCoverageSection run={cov({
    mode: 'hybrid', capped: false, discoveredCount: 20, offBaselineCount: 1,
    missRate: null, sitemapMissRate: 0.3, residualMissRate: 0.03,
    residualMissRateRaw: 0.19, nonContentExcludedCount: 8, baselineExcludedCount: 4,
    excludedByReason: { param: 2, malformed: 1, pagination: 3, taxonomy: 2, thankyou: 0, account: 0 },
    baselineExcludedByReason: { pagination: 1, taxonomy: 3, thankyou: 0, account: 0, nonpage: 0 },
    excludedSampleByReason: {}, sample: [],
  })} />)
  expect(screen.getByText(/3% remained undiscovered/i)).toBeInTheDocument()
  expect(screen.getByText(/policy-excluded/i)).toBeInTheDocument()
  expect(screen.getByText(/raw 19%/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/DiscoveryCoverageSection.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Update `DiscoveryCoverageSection.tsx`**

Extend the local `CoverageData` interface with `residualMissRateRaw?: number | null`, `nonContentExcludedCount?: number`, `baselineExcludedCount?: number`, `excludedByReason?`, `baselineExcludedByReason?` (all optional — legacy runs lack them).

In the `data.mode === 'hybrid'` block, after the existing rate `<p>`, add:

```tsx
{((data.nonContentExcludedCount ?? 0) + (data.baselineExcludedCount ?? 0)) > 0 && (
  <p className="mt-1 text-[12px] font-body text-navy/50 dark:text-white/50">
    {(data.nonContentExcludedCount ?? 0) + (data.baselineExcludedCount ?? 0)} URLs policy-excluded
    (tracking-param/malformed variants, pagination, taxonomy, thank-you, account)
    {typeof data.residualMissRateRaw === 'number'
      ? `; raw ${Math.round(data.residualMissRateRaw * 100)}%`
      : ''}.
  </p>
)}
```

In the NON-hybrid `data.applicable` branch (the "Sitemap listed N same-domain URLs … off-sitemap" copy), change "same-domain URLs" → "same-domain content URLs (policy-filtered)" and the additional-URLs phrase to note the count is policy-filtered, so the number matches the gate semantics.

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/DiscoveryCoverageSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify the sales consumer (Codex F7)**

Read `lib/sales/sales-report-data.ts:~223,281`. It computes `sitemapMissRatePct` from `coverage.applicable && coverage.missRate` — `missRate` is now filtered, so the sales % becomes the content miss-rate (an honest improvement; hybrid runs still show nothing because `applicable` is false for `mode:'hybrid'`, unchanged). Run its test:

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/sales/sales-report-data.test.ts`
Expected: PASS. If a fixture asserted a specific `sitemapMissRatePct` on data that now filters differently, update the expectation and note it derives from the filtered `missRate`. If the fixture uses only content URLs, no change.

- [ ] **Step 6: Commit**

```bash
git add components/site-audit/DiscoveryCoverageSection.tsx components/site-audit/DiscoveryCoverageSection.test.tsx
git commit -m "feat(discovery-coverage): surface policy-filtered residual + excluded counts in UI"
```

---

## Task 6: Full gate + parity-log documentation (Codex F8)

**Files:**
- Modify: `docs/superpowers/todos/2026-07-05-sf-live-parity-log.md`

- [ ] **Step 1: Run the full local gate**

Run: `npm run lint`  → clean.
Run: `DATABASE_URL="file:./local-dev.db" npm test`  → all green, INCLUDING the re-pinned `broken-link-verify.characterization.test.ts`.
Run: `npm run build`  → completes.

- [ ] **Step 2: Append the L1 section to the parity log**

Document: (a) the fuller policy-filter definition (params list, `%C2%A0` trim, pagination/taxonomy/thankyou/account patterns) with the "policy-filtered, not exhaustive" caveat and the known false-negatives/false-positives from Task 2; (b) the two-sided attribution fields; (c) the 29-domain raw-residual ledger captured 2026-07-20. **Codex F8:** do NOT record sample-derived filtered residuals as recomputed values — stored `sample` is capped at 50 and holds only off-baseline URLs, so it cannot reconstruct baseline exclusions. Label any pre-deploy estimate explicitly as an **estimate / directional lower-bound**; the authoritative re-baseline lands from the next weekly sweep after L1 deploys.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/todos/2026-07-05-sf-live-parity-log.md
git commit -m "docs(parity-log): L1 policy-filter definition + raw ledger + non-exhaustive caveats"
```

---

## Self-Review

- **Spec coverage:** L1 §4 items 1–4 → Tasks 1–3; transparency (two-sided) → Task 3; frozen-test re-pin → Task 4; UI/sales → Task 5; gate + parity log → Task 6. ✓
- **Codex F1 (attribution):** two-sided (numerator `excludedByReason` + baseline `baselineExcludedByReason`), duplicate-variant collapse, baseline-only exclusions, nonpage-after-trim all covered with fixtures. ✓
- **Codex F2 (determinism):** `rawOff` sorted before survivor selection + sample sort; precedence pinned by test. ✓
- **Codex F3 (frozen test):** Task 4 re-pins additively; old fields guarded as isolation proof. ✓
- **Codex F4 (non-monotone):** fixture asserts filtered > raw; no monotonic assertion. ✓
- **Codex F6 (patterns):** boundary + documented false-neg/pos tests. ✓
- **Codex F7 (sales/UI):** correct consumer file (`sales-report-data.ts`) verified; non-hybrid copy updated; "policy-excluded" wording. ✓
- **Codex F8 (parity log):** estimates labeled, authoritative re-baseline deferred to post-deploy sweep. ✓
- **Placeholder scan:** all steps carry real code/commands. ✓
- **Type consistency:** helpers defined Tasks 1–2, consumed Task 3; interface fields defined Task 3, consumed Tasks 4–5. ✓
