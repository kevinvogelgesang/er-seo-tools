# Redirect / Canonical / Hreflang Validation (C6 Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add technical-SEO validation (canonical, internal-link redirect chains, hreflang) to the live scan by folding a shared URL-resolver into the existing `broken-link-verify` builder and surfacing findings in a new results-page section.

**Architecture:** A thin `resolveUrl()` exposes the final URL + redirect chain + status that `safeFetch` already computes; `checkUrl` delegates to it (broken-link behavior unchanged). The `broken-link-verify` builder resolves one dedup'd, legacy-first-ordered, same-domain set once into a cache, then a pure `validation-mapper` derives canonical/redirect/hreflang findings into the SAME live-scan `CrawlRun`. A new `TechnicalSeoSection` renders them. Hreflang href harvest requires a small, helper-free change to the `.toString()`-injected `parseSeoFromDocument`.

**Tech Stack:** TypeScript, Next.js 15, Prisma/SQLite, Vitest, puppeteer-core (harvest), `lib/security/safe-url.ts` (SSRF-guarded fetch + manual redirects).

**Spec:** `docs/superpowers/specs/2026-07-03-redirect-canonical-hreflang-validation-design.md` (Codex-reviewed, 7 fixes applied).

## Global Constraints

- **No schema migration.** `HarvestedPageSeo.detailsJson` is an existing string column (shape change only); `Finding.type`/`affectedSource` are free strings.
- **Same-domain-only initial-target selection** (www-insensitive). Cross-domain *initial* targets are recorded-not-fetched. A same-domain target that redirects off-site IS followed by `safeFetch` — existing Phase 1 behavior, not changed here.
- **`parseSeoFromDocument` must stay SWC-helper-free** — it is `.toString()`-injected. No `typeof`, no spread-of-unknown, no constructs that emit an es2017 helper. Verified by a compile-and-grep gate (Task 3).
- **`checkUrl` external contract + broken-link behavior stay byte-identical** — existing broken-link tests are the guard.
- **Array-form `$transaction` only** (repo rule) — not relevant here; the builder already uses `writeFindingsRun`.
- **Local dev/test:** prefix vitest with `DATABASE_URL="file:./local-dev.db"`. Node tests use `// @vitest-environment node`; React render tests use `// @vitest-environment jsdom` + `afterEach(cleanup)`.
- **Gate-green before PR:** `npm run lint` (tsc) + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`.
- **Commit granularity:** one commit per task (TDD: test → impl → green → commit). Never `git add -A` at repo root (untracked `pentest-results/` etc.).

---

### Task 1: `resolveUrl` shared resolver

**Files:**
- Create: `lib/ada-audit/url-resolver.ts`
- Test: `lib/ada-audit/url-resolver.test.ts`

**Interfaces:**
- Produces:
  - `interface ResolveResult { result: 'ok'|'broken'|'unconfirmed'; finalUrl: string|null; status: number|null; hops: number; chain: string[]; tooManyRedirects: boolean }`
  - `interface ResolveDeps { fetchResolved: (url: string, method: 'HEAD'|'GET', timeoutMs: number) => Promise<{ status: number; finalUrl: string; redirects: string[] }>; now: () => number; sleep: (ms: number) => Promise<void> }`
  - `const realResolveDeps: ResolveDeps`
  - `function resolveUrl(url: string, deps?: ResolveDeps, timeoutMs?: number): Promise<ResolveResult>`
- Consumes: `safeFetch`, `SafeUrlError` from `@/lib/security/safe-url`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { resolveUrl, type ResolveDeps } from './url-resolver'
import { SafeUrlError } from '@/lib/security/safe-url'

function deps(fetchResolved: ResolveDeps['fetchResolved']): ResolveDeps {
  return { fetchResolved, now: () => 0, sleep: async () => {} }
}

describe('resolveUrl', () => {
  it('ok when HEAD < 400, chain verbatim, hops from redirects', async () => {
    const d = deps(async (_u, _m) => ({ status: 200, finalUrl: 'https://x.com/c', redirects: ['https://x.com/b', 'https://x.com/c'] }))
    const r = await resolveUrl('https://x.com/a', d)
    expect(r.result).toBe('ok')
    expect(r.finalUrl).toBe('https://x.com/c')
    expect(r.hops).toBe(2)
    expect(r.chain).toEqual(['https://x.com/b', 'https://x.com/c']) // NOT duplicated
    expect(r.tooManyRedirects).toBe(false)
  })

  it('broken: HEAD 404 confirmed by GET 404', async () => {
    const calls: string[] = []
    const d = deps(async (_u, m) => { calls.push(m); return { status: 404, finalUrl: 'https://x.com/a', redirects: [] } })
    const r = await resolveUrl('https://x.com/a', d)
    expect(r.result).toBe('broken')
    expect(calls).toEqual(['HEAD', 'GET'])
  })

  it('ok: HEAD 405 but GET 200 (server mishandles HEAD)', async () => {
    const d = deps(async (_u, m) => m === 'HEAD'
      ? { status: 405, finalUrl: 'https://x.com/a', redirects: [] }
      : { status: 200, finalUrl: 'https://x.com/a', redirects: [] })
    expect((await resolveUrl('https://x.com/a', d)).result).toBe('ok')
  })

  it('SafeUrlError on HEAD → unconfirmed with NO GET call', async () => {
    const calls: string[] = []
    const d = deps(async (_u, m) => { calls.push(m); throw new SafeUrlError('blocked') })
    const r = await resolveUrl('https://x.com/a', d)
    expect(r.result).toBe('unconfirmed')
    expect(calls).toEqual(['HEAD']) // no GET
  })

  it("SafeUrlError('Too many redirects') on HEAD → unconfirmed + tooManyRedirects, no GET", async () => {
    const calls: string[] = []
    const d = deps(async (_u, m) => { calls.push(m); throw new SafeUrlError('Too many redirects') })
    const r = await resolveUrl('https://x.com/a', d)
    expect(r.result).toBe('unconfirmed')
    expect(r.tooManyRedirects).toBe(true)
    expect(calls).toEqual(['HEAD'])
  })

  it('network error (non-SafeUrlError) on HEAD → falls through to GET', async () => {
    const calls: string[] = []
    const d = deps(async (_u, m) => { calls.push(m); if (m === 'HEAD') throw new Error('ECONNRESET'); return { status: 200, finalUrl: 'https://x.com/a', redirects: [] } })
    expect((await resolveUrl('https://x.com/a', d)).result).toBe('ok')
    expect(calls).toEqual(['HEAD', 'GET'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/url-resolver.test.ts`
Expected: FAIL — `Cannot find module './url-resolver'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/ada-audit/url-resolver.ts
//
// C6 Phase 4: shared URL resolver. Exposes the final URL + redirect chain +
// final status that safeFetch already computes (checkUrl discards them).
// Preserves checkUrl's EXACT precision posture: HEAD-first; HEAD>=400 or a
// non-SafeUrlError HEAD throw confirms with GET; a SafeUrlError on HEAD
// (SSRF/DNS/'Too many redirects') returns 'unconfirmed' immediately (no GET).
import { safeFetch, SafeUrlError } from '@/lib/security/safe-url'

export interface ResolveResult {
  result: 'ok' | 'broken' | 'unconfirmed'
  finalUrl: string | null
  status: number | null
  hops: number
  chain: string[]
  tooManyRedirects: boolean
}

export interface ResolveDeps {
  /** Final status + final url + redirect chain (safeFetch's redirects[], verbatim). */
  fetchResolved: (url: string, method: 'HEAD' | 'GET', timeoutMs: number) => Promise<{ status: number; finalUrl: string; redirects: string[] }>
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const DEFAULT_TIMEOUT = Number(process.env.BROKEN_LINK_REQUEST_TIMEOUT_MS) || 10_000

export const realResolveDeps: ResolveDeps = {
  fetchResolved: async (url, method, timeoutMs) => {
    const { response, url: finalUrl, redirects } = await safeFetch(url, { method, signal: AbortSignal.timeout(timeoutMs) })
    try { await response.body?.cancel() } catch { /* ignore */ }
    return { status: response.status, finalUrl, redirects }
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

const UNCONFIRMED: ResolveResult = { result: 'unconfirmed', finalUrl: null, status: null, hops: 0, chain: [], tooManyRedirects: false }

export async function resolveUrl(url: string, deps: ResolveDeps = realResolveDeps, timeoutMs: number = DEFAULT_TIMEOUT): Promise<ResolveResult> {
  try {
    const head = await deps.fetchResolved(url, 'HEAD', timeoutMs)
    if (head.status < 400) {
      return { result: 'ok', finalUrl: head.finalUrl, status: head.status, hops: head.redirects.length, chain: head.redirects, tooManyRedirects: false }
    }
    // HEAD >= 400: confirm with GET.
  } catch (err) {
    if (err instanceof SafeUrlError) {
      return { ...UNCONFIRMED, tooManyRedirects: err.message === 'Too many redirects' }
    }
    // network/timeout on HEAD: fall through to GET.
  }
  try {
    const get = await deps.fetchResolved(url, 'GET', timeoutMs)
    return {
      result: get.status >= 400 ? 'broken' : 'ok',
      finalUrl: get.finalUrl, status: get.status, hops: get.redirects.length, chain: get.redirects, tooManyRedirects: false,
    }
  } catch (err) {
    return { ...UNCONFIRMED, tooManyRedirects: err instanceof SafeUrlError && err.message === 'Too many redirects' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/url-resolver.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/url-resolver.ts lib/ada-audit/url-resolver.test.ts
git commit -m "feat(c6-p4): resolveUrl — final url + redirect chain over safeFetch"
```

---

### Task 2: `checkUrl` delegates to `resolveUrl`

**Files:**
- Modify: `lib/ada-audit/broken-link-check.ts`
- Test: `lib/ada-audit/broken-link-check.test.ts` (add one regression; keep all existing)

**Interfaces:**
- Consumes: `resolveUrl`, `ResolveDeps`, `realResolveDeps` from Task 1.
- Produces: `checkUrl(url, deps?, timeoutMs?)` unchanged signature + return `CheckResult`; `realDeps` + `CheckDeps` + `HostThrottle` unchanged exports.

- [ ] **Step 1: Write the failing test** (append to existing file)

```ts
it('SafeUrlError on HEAD returns unconfirmed without a GET (delegation preserves posture)', async () => {
  const calls: string[] = []
  const deps: CheckDeps = {
    fetchStatus: async (_u, m) => { calls.push(m); throw new SafeUrlError('blocked') },
    now: () => 0, sleep: async () => {},
  }
  expect(await checkUrl('https://x.com/a', deps)).toBe('unconfirmed')
  expect(calls).toEqual(['HEAD'])
})
```

(Ensure `CheckDeps`, `checkUrl`, `SafeUrlError` are imported at the top of the test file; they already are for existing cases — add `SafeUrlError` from `@/lib/security/safe-url` if missing.)

- [ ] **Step 2: Run test to verify it fails or passes-for-wrong-reason**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/broken-link-check.test.ts`
Expected: PASS already (current `checkUrl` returns unconfirmed on SafeUrlError HEAD) — this test locks the behavior before the refactor so Step 4 proves delegation preserves it.

- [ ] **Step 3: Refactor `checkUrl` to delegate**

Replace the body of `checkUrl` (keep the signature, `CheckDeps`, `realDeps`, `HostThrottle`, `CheckResult` exactly). Adapt the injected `CheckDeps.fetchStatus` (status-only) into a `ResolveDeps` (the chain is empty via this path — `checkUrl` never needs it):

```ts
import { resolveUrl, type ResolveDeps } from './url-resolver'
// ... keep existing imports (safeFetch, SafeUrlError) ...

export async function checkUrl(
  url: string,
  deps: CheckDeps = realDeps,
  timeoutMs: number = DEFAULT_TIMEOUT,
): Promise<CheckResult> {
  const resolveDeps: ResolveDeps = {
    fetchResolved: async (u, method, t) => ({ status: await deps.fetchStatus(u, method, t), finalUrl: u, redirects: [] }),
    now: deps.now,
    sleep: deps.sleep,
  }
  return (await resolveUrl(url, resolveDeps, timeoutMs)).result
}
```

Leave `realDeps.fetchStatus` (HEAD→status with body-cancel) intact — existing callers/tests use it. `resolveUrl`'s own `realResolveDeps` is separate.

- [ ] **Step 4: Run the full broken-link-check suite**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/broken-link-check.test.ts`
Expected: PASS (all existing cases + the new one) — broken-link behavior byte-identical.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/broken-link-check.ts lib/ada-audit/broken-link-check.test.ts
git commit -m "refactor(c6-p4): checkUrl delegates to resolveUrl (behavior unchanged)"
```

---

### Task 3: Harvest hreflang hrefs (`parseSeoFromDocument`) — LANDMINE

**Files:**
- Modify: `lib/ada-audit/seo/parse-seo-dom.ts` (`RawPageSeo.hreflang` type + extraction)
- Test: `lib/ada-audit/seo/parse-seo-dom.test.ts` (update hreflang assertions)
- Verify: es2017 compile-and-grep gate (Step 5)

**Interfaces:**
- Produces: `RawPageSeo.hreflang: { lang: string; href: string }[]` (was `string[]`).
- Note: `persistPageSeo` in `site-audit-page.ts` serializes `seo.hreflang` verbatim into `detailsJson` — no change needed there. The SF-CSV aggregator's `parsedData.hreflang` is unrelated and unaffected.

- [ ] **Step 1: Write the failing test** (update the hreflang case in `parse-seo-dom.test.ts`)

FIRST open `lib/ada-audit/seo/parse-seo-dom.test.ts` and use its EXISTING DOM-construction helper (the file builds a `JSDOM` and passes `dom.window.document`/`dom.window` into `parseSeoFromDocument` — it does NOT use vitest globals). Mirror that helper (whatever it is named — e.g. `parse(html)` / `dom(html)`); do not introduce `document`/`window` globals. Replace the old `hreflang: string[]` assertion with:

```ts
it('harvests hreflang as {lang, href} pairs, dedupes by lang keep-first, keeps raw href', () => {
  // build the page via THIS FILE's existing JSDOM helper; the <head> contains:
  //   <link rel="alternate" hreflang="en" href="https://x.com/en">
  //   <link rel="alternate" hreflang="fr" href="/fr">
  //   <link rel="alternate" hreflang="en" href="https://x.com/en-dup">
  //   <link rel="alternate" hreflang="x-default" href="https://x.com/">
  //   <link rel="alternate" hreflang="" href="https://x.com/empty">
  const seo = parseWithHelper(/* the file's helper */ HEAD_HTML)
  expect(seo.hreflang).toEqual([
    { lang: 'en', href: 'https://x.com/en' },     // keep-first (dup 'en' dropped)
    { lang: 'fr', href: '/fr' },                  // raw relative href preserved
    { lang: 'x-default', href: 'https://x.com/' },
  ]) // empty-lang entry dropped
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/parse-seo-dom.test.ts`
Expected: FAIL — current code returns `string[]` codes.

- [ ] **Step 3: Change the type + extraction (helper-free)**

In `RawPageSeo`: `hreflang: { lang: string; href: string }[]`.

Replace the hreflang block (lines ~75–81) — remove the old `.map(getAttribute('hreflang'))` + the `boundedHreflang` Set-dedupe, and drop `hreflang` from the CAP block. New extraction (imperative, object-literal, NO `typeof`/spread — SWC-helper-free):

```ts
  // hreflang alternates as {lang, href} pairs — dedupe by lang keep-first, cap 50.
  const hreflang: { lang: string; href: string }[] = []
  const seenLang: Record<string, number> = {}
  for (const l of Array.from(doc.querySelectorAll('link[rel="alternate"][hreflang]'))) {
    const lang = l.getAttribute('hreflang') || ''
    if (!lang || seenLang[lang]) continue
    seenLang[lang] = 1
    hreflang.push({ lang: lang, href: l.getAttribute('href') || '' })
    if (hreflang.length >= 50) break
  }
```

Keep `boundedSchema` as-is. In the return object, replace `hreflang: boundedHreflang` with `hreflang` (and delete the now-unused `boundedHreflang` const). Leave every other field untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/parse-seo-dom.test.ts`
Expected: PASS.

- [ ] **Step 5: es2017 helper-free verification gate (MANDATORY)**

Compile the file alone to es2017 and prove no SWC/TS helper escaped (the 2026-06-16 `typeof`→`_type_of` landmine):

```bash
npx esbuild lib/ada-audit/seo/parse-seo-dom.ts --target=es2017 --format=esm 2>/dev/null \
  | grep -nE '_type_of|_define_property|_to_consumable_array|_create_class|_object_spread|__spread|__assign|_ts_' \
  && echo "HELPER LEAKED — FIX BEFORE COMMIT" || echo "clean: no escaping helper at es2017"
```

Expected: `clean: no escaping helper at es2017`. If a helper leaks, rewrite the offending construct (do not commit).

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/seo/parse-seo-dom.ts lib/ada-audit/seo/parse-seo-dom.test.ts
git commit -m "feat(c6-p4): harvest hreflang as {lang,href} pairs (es2017 helper-free)"
```

---

### Task 4: `validation-mapper` (pure) + shared `sameDomain` export

**Files:**
- Modify: `lib/ada-audit/link-harvest.ts` (export `sameDomain`)
- Create: `lib/findings/validation-mapper.ts`
- Test: `lib/findings/validation-mapper.test.ts`

**Interfaces:**
- Consumes: `ResolveResult` (Task 1); `normalizeLinkTarget`, `sameDomain` (link-harvest); `runFindingKey`, `pageFindingKey`, `normalizeFindingUrl` (keys); `CrawlPageInput`, `FindingInput` (types).
- Produces:
  - `interface HreflangEntry { lang: string; href: string }`
  - `interface ValidationSeoRow { url: string; canonicalUrl: string | null; hreflang: HreflangEntry[] }`
  - `interface ValidationLink { sourcePageUrl: string; targetUrl: string }` (internal-link only)
  - `interface ResolveLookup { get(normUrl: string): ResolveResult | undefined }`
  - `interface ValidationMapDeps { runId: string; ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput; auditedHost: string; affectedComplete: boolean }`
  - `function mapValidationFindings(seoRows: ValidationSeoRow[], links: ValidationLink[], resolve: ResolveLookup, deps: ValidationMapDeps): FindingInput[]`
  - `affectedComplete` is `false` when the builder capped the validation resolution set (Codex plan-fix); external-unverified run notices are always complete (externals are never resolved, so the cap can't truncate them).

**Finding types produced:** `canonical_broken`, `canonical_redirect`, `redirect_chain`, `redirect_loop`, `hreflang_broken`, `hreflang_no_return`, `hreflang_missing_self`, `hreflang_missing_x_default`, `hreflang_invalid_code`, `canonical_external_unverified` (run-only), `hreflang_external_unverified` (run-only). Broken-link types (`broken_*`) are NOT produced here — they stay in `broken-link-mapper`.

- [ ] **Step 1: Export `sameDomain` from link-harvest**

In `lib/ada-audit/link-harvest.ts` change `const sameDomain = ...` to `export const sameDomain = ...` (leave `stripWww` private; `sameDomain` already takes both hosts).

- [ ] **Step 2: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mapValidationFindings, type ValidationSeoRow, type ValidationLink, type ResolveLookup } from './validation-mapper'
import type { ResolveResult } from '@/lib/ada-audit/url-resolver'
import type { CrawlPageInput } from './types'
import { normalizeFindingUrl } from './keys'
import { randomUUID } from 'crypto'

const ok = (finalUrl: string, hops = 0): ResolveResult => ({ result: 'ok', finalUrl, status: 200, hops, chain: hops ? [finalUrl] : [], tooManyRedirects: false })
const broken = (): ResolveResult => ({ result: 'broken', finalUrl: null, status: 404, hops: 0, chain: [], tooManyRedirects: false })
const loop = (): ResolveResult => ({ result: 'unconfirmed', finalUrl: null, status: null, hops: 0, chain: [], tooManyRedirects: true })

function lookup(map: Record<string, ResolveResult>): ResolveLookup {
  const m = new Map(Object.entries(map).map(([k, v]) => [normalizeFindingUrl(k), v]))
  return { get: (u) => m.get(u) }
}
function makeDeps() {
  const pages: CrawlPageInput[] = []
  const byUrl = new Map<string, CrawlPageInput>()
  const ensurePage = (url: string): CrawlPageInput => {
    const u = normalizeFindingUrl(url)
    let p = byUrl.get(u)
    if (!p) { p = { id: randomUUID(), runId: 'R', url: u, status: null, error: null, finalUrl: null, statusCode: null, title: null, h1: null, metaDescription: null, wordCount: null, crawlDepth: null, indexable: null, score: null, passCount: null, incompleteCount: null, adaAuditId: null }; pages.push(p); byUrl.set(u, p) }
    return p
  }
  return { runId: 'R', ensurePage, auditedHost: 'x.com', affectedComplete: true, pages }
}

describe('mapValidationFindings', () => {
  it('canonical_broken when same-domain canonical resolves broken', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: 'https://x.com/dead', hreflang: [] }]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/dead': broken() }), makeDeps())
    expect(f.find((x) => x.scope === 'run' && x.type === 'canonical_broken')?.count).toBe(1)
    expect(f.find((x) => x.scope === 'page' && x.type === 'canonical_broken')?.url).toBe(normalizeFindingUrl('https://x.com/a'))
  })

  it('canonical_redirect when same-domain canonical redirects (hops>=1)', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: 'https://x.com/c', hreflang: [] }]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/c': ok('https://x.com/final', 1) }), makeDeps())
    expect(f.some((x) => x.type === 'canonical_redirect' && x.scope === 'run')).toBe(true)
  })

  it('resolves a relative canonical against the declaring page URL', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/dir/a', canonicalUrl: '/dead', hreflang: [] }]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/dead': broken() }), makeDeps())
    expect(f.some((x) => x.type === 'canonical_broken')).toBe(true)
  })

  it('redirect_chain on an internal link that resolves ok with hops>=1 (keyed by source page)', () => {
    const links: ValidationLink[] = [{ sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/t' }]
    const f = mapValidationFindings([], links, lookup({ 'https://x.com/t': ok('https://x.com/final', 1) }), makeDeps())
    const run = f.find((x) => x.scope === 'run' && x.type === 'redirect_chain')
    expect(run?.count).toBe(1)
    expect(f.some((x) => x.scope === 'page' && x.type === 'redirect_chain' && x.url === normalizeFindingUrl('https://x.com/a'))).toBe(true)
  })

  it('does NOT emit redirect_chain when the link is broken (no double-count with broken_internal_links)', () => {
    const links: ValidationLink[] = [{ sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/t' }]
    const f = mapValidationFindings([], links, lookup({ 'https://x.com/t': broken() }), makeDeps())
    expect(f.some((x) => x.type === 'redirect_chain')).toBe(false)
  })

  it('redirect_loop on tooManyRedirects', () => {
    const links: ValidationLink[] = [{ sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/t' }]
    const f = mapValidationFindings([], links, lookup({ 'https://x.com/t': loop() }), makeDeps())
    expect(f.some((x) => x.type === 'redirect_loop')).toBe(true)
  })

  it('aggregates multiple hreflang_broken on one page into ONE page finding (count>1, no dup dedupKey)', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: null, hreflang: [
      { lang: 'en', href: 'https://x.com/en-dead' }, { lang: 'fr', href: 'https://x.com/fr-dead' },
    ] }]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/en-dead': broken(), 'https://x.com/fr-dead': broken() }), makeDeps())
    const pageFindings = f.filter((x) => x.scope === 'page' && x.type === 'hreflang_broken')
    expect(pageFindings).toHaveLength(1)
    expect(pageFindings[0].count).toBe(2)
    expect(new Set(f.map((x) => x.dedupKey)).size).toBe(f.length) // all dedupKeys distinct
  })

  it('hreflang_no_return only when both pages in-set and B does not link back', () => {
    const rows: ValidationSeoRow[] = [
      { url: 'https://x.com/a', canonicalUrl: null, hreflang: [{ lang: 'fr', href: 'https://x.com/b' }] },
      { url: 'https://x.com/b', canonicalUrl: null, hreflang: [] }, // no return to /a
    ]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/b': ok('https://x.com/b') }), makeDeps())
    expect(f.some((x) => x.type === 'hreflang_no_return' && x.url === normalizeFindingUrl('https://x.com/a'))).toBe(true)
  })

  it('no hreflang_no_return when B is not in the harvested set', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: null, hreflang: [{ lang: 'fr', href: 'https://x.com/notharvested' }] }]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/notharvested': ok('https://x.com/notharvested') }), makeDeps())
    expect(f.some((x) => x.type === 'hreflang_no_return')).toBe(false)
  })

  it('hreflang_missing_self + hreflang_missing_x_default for a cluster (>=2) lacking both', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: null, hreflang: [
      { lang: 'fr', href: 'https://x.com/b' }, { lang: 'de', href: 'https://x.com/c' },
    ] }]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/b': ok('https://x.com/b'), 'https://x.com/c': ok('https://x.com/c') }), makeDeps())
    expect(f.some((x) => x.type === 'hreflang_missing_self')).toBe(true)
    expect(f.some((x) => x.type === 'hreflang_missing_x_default')).toBe(true)
  })

  it('hreflang_invalid_code for a malformed lang', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: null, hreflang: [{ lang: 'not_a_lang!', href: 'https://x.com/a' }] }]
    const f = mapValidationFindings(rows, [], lookup({}), makeDeps())
    expect(f.some((x) => x.type === 'hreflang_invalid_code')).toBe(true)
  })

  it('cross-domain canonical/hreflang are recorded-unverified (run notices), never fetched', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: 'https://other.com/c', hreflang: [{ lang: 'fr', href: 'https://other.com/fr' }] }]
    // resolve lookup is EMPTY — cross-domain must not require a cache hit
    const f = mapValidationFindings(rows, [], lookup({}), makeDeps())
    expect(f.find((x) => x.type === 'canonical_external_unverified')?.count).toBe(1)
    expect(f.find((x) => x.type === 'hreflang_external_unverified')?.count).toBe(1)
    expect(f.some((x) => x.type === 'canonical_broken' || x.type === 'hreflang_broken')).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/validation-mapper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `validation-mapper.ts`**

```ts
// lib/findings/validation-mapper.ts
//
// C6 Phase 4 (pure): canonical/redirect/hreflang validation findings for the
// live-scan run, derived from a pre-resolved URL cache. Broken-link findings are
// NOT produced here (see broken-link-mapper). Page-scope findings keyed by the
// declaring/source page and AGGREGATED (one per (type, page), targets in detail)
// to avoid @@unique([runId, dedupKey]) collisions.
import { randomUUID } from 'crypto'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import { normalizeLinkTarget, sameDomain } from '@/lib/ada-audit/link-harvest'
import type { ResolveResult } from '@/lib/ada-audit/url-resolver'
import type { CrawlPageInput, FindingInput } from './types'

export interface HreflangEntry { lang: string; href: string }
export interface ValidationSeoRow { url: string; canonicalUrl: string | null; hreflang: HreflangEntry[] }
export interface ValidationLink { sourcePageUrl: string; targetUrl: string }
export interface ResolveLookup { get(normUrl: string): ResolveResult | undefined }
export interface ValidationMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
  auditedHost: string
  affectedComplete: boolean   // false when the builder capped the validation resolution set
}

const SEVERITY: Record<string, FindingInput['severity']> = {
  canonical_broken: 'warning', canonical_redirect: 'warning',
  redirect_chain: 'notice', redirect_loop: 'warning',
  hreflang_broken: 'warning', hreflang_no_return: 'warning',
  hreflang_missing_self: 'notice', hreflang_missing_x_default: 'notice', hreflang_invalid_code: 'notice',
  canonical_external_unverified: 'notice', hreflang_external_unverified: 'notice',
}
const DESC: Record<string, string> = {
  canonical_broken: 'Canonical URL resolves to a 4xx/5xx response.',
  canonical_redirect: 'Canonical URL is itself a redirect (should point at the final URL).',
  redirect_chain: 'Internal link resolves through one or more redirects.',
  redirect_loop: 'Internal link exceeds the redirect limit (loop/too many redirects).',
  hreflang_broken: 'Hreflang alternate resolves to a 4xx/5xx response.',
  hreflang_no_return: 'Hreflang alternate does not declare a return link (in audited set).',
  hreflang_missing_self: 'Hreflang cluster has no self-referencing entry.',
  hreflang_missing_x_default: 'Hreflang cluster has no x-default entry.',
  hreflang_invalid_code: 'Hreflang language/region code is malformed.',
  canonical_external_unverified: 'Cross-domain canonical targets recorded but not fetched.',
  hreflang_external_unverified: 'Cross-domain hreflang targets recorded but not fetched.',
}
const LANG_RE = /^([a-z]{2,3}(-[A-Za-z0-9]{2,8})*|x-default)$/i
const URLS_PER_FINDING = 25

export function mapValidationFindings(seoRows: ValidationSeoRow[], links: ValidationLink[], resolve: ResolveLookup, deps: ValidationMapDeps): FindingInput[] {
  const { runId, ensurePage, auditedHost, affectedComplete } = deps
  const findings: FindingInput[] = []

  // page -> type -> affected target url list (aggregation buffer). Run-scope count
  // per page-derived type = number of distinct affected pages (computed at the end).
  const pageHits = new Map<string, Map<string, string[]>>()
  const addPageHit = (page: string, type: string, targetUrl: string) => {
    const p = normalizeFindingUrl(page)
    let byType = pageHits.get(p); if (!byType) { byType = new Map(); pageHits.set(p, byType) }
    const arr = byType.get(type) ?? byType.set(type, []).get(type)!
    arr.push(targetUrl)
  }

  const isSameDomain = (host: string) => sameDomain(host, auditedHost.toLowerCase())
  const hostOf = (url: string): string | null => { try { return new URL(url).hostname.toLowerCase() } catch { return null } }

  const externalCanonical = new Set<string>()
  const externalHreflang = new Set<string>()

  // harvested set for reciprocity: normalized page urls we have hreflang for
  const harvested = new Map<string, Set<string>>() // normPageUrl -> set of normalized same-domain hreflang targets
  for (const row of seoRows) {
    const base = row.url
    const set = new Set<string>()
    for (const h of row.hreflang) {
      const abs = normalizeLinkTarget(h.href, base); if (!abs) continue
      const host = hostOf(abs); if (!host || !isSameDomain(host)) continue
      set.add(normalizeFindingUrl(abs))
    }
    harvested.set(normalizeFindingUrl(base), set)
  }

  // ---- Canonical ----
  for (const row of seoRows) {
    if (!row.canonicalUrl) continue
    const abs = normalizeLinkTarget(row.canonicalUrl, row.url); if (!abs) continue
    const host = hostOf(abs); if (!host) continue
    if (!isSameDomain(host)) { externalCanonical.add(normalizeFindingUrl(abs)); continue }
    const r = resolve.get(normalizeFindingUrl(abs)); if (!r) continue
    if (r.result === 'broken') addPageHit(row.url, 'canonical_broken', abs)
    else if (r.result === 'ok' && r.hops >= 1) addPageHit(row.url, 'canonical_redirect', abs)
  }

  // ---- Internal-link redirects ----
  for (const link of links) {
    const host = hostOf(link.targetUrl); if (!host || !isSameDomain(host)) continue
    const r = resolve.get(normalizeFindingUrl(link.targetUrl)); if (!r) continue
    if (r.result === 'ok' && r.hops >= 1) addPageHit(link.sourcePageUrl, 'redirect_chain', link.targetUrl)
    else if (r.tooManyRedirects) addPageHit(link.sourcePageUrl, 'redirect_loop', link.targetUrl)
    // broken (final >= 400) is handled by broken-link-mapper — NOT here (no double-count).
  }

  // ---- Hreflang ----
  for (const row of seoRows) {
    const cluster = row.hreflang
    const clusterSize = cluster.length
    let referencesSelf = false
    const selfNorm = normalizeFindingUrl(row.url)
    for (const h of cluster) {
      if (!LANG_RE.test(h.lang)) addPageHit(row.url, 'hreflang_invalid_code', h.lang)
      const abs = normalizeLinkTarget(h.href, row.url)
      if (abs && normalizeFindingUrl(abs) === selfNorm) referencesSelf = true
      if (!abs) continue
      const host = hostOf(abs); if (!host) continue
      if (!isSameDomain(host)) { externalHreflang.add(normalizeFindingUrl(abs)); continue }
      const norm = normalizeFindingUrl(abs)
      const r = resolve.get(norm)
      if (r && r.result === 'broken') addPageHit(row.url, 'hreflang_broken', abs)
      // reciprocity: only if B is in the harvested set and B has no return href to row.url
      const bSet = harvested.get(norm)
      if (bSet && !bSet.has(selfNorm)) addPageHit(row.url, 'hreflang_no_return', abs)
    }
    if (clusterSize >= 2) {
      if (!referencesSelf) addPageHit(row.url, 'hreflang_missing_self', row.url)
      if (!cluster.some((h) => h.lang.toLowerCase() === 'x-default')) addPageHit(row.url, 'hreflang_missing_x_default', row.url)
    }
  }

  // Recount run-scope for page-derived types = number of distinct affected pages.
  const pageTypeCounts = new Map<string, number>()
  for (const [, byType] of pageHits) for (const [type] of byType) pageTypeCounts.set(type, (pageTypeCounts.get(type) ?? 0) + 1)

  // Emit run-scope + page-scope findings. (affectedComplete threaded from deps.)
  for (const [type, pageCount] of pageTypeCounts) {
    findings.push({ id: randomUUID(), runId, pageId: null, scope: 'run', type, severity: SEVERITY[type] ?? 'notice',
      url: null, count: pageCount, affectedComplete, affectedSource: sourceOf(type),
      detail: JSON.stringify({ description: DESC[type] ?? type }), dedupKey: runFindingKey(type) })
  }
  for (const [page, byType] of pageHits) {
    for (const [type, targets] of byType) {
      const p = ensurePage(page)
      findings.push({ id: randomUUID(), runId, pageId: p.id, scope: 'page', type, severity: SEVERITY[type] ?? 'notice',
        url: page, count: targets.length, affectedComplete, affectedSource: sourceOf(type),
        detail: JSON.stringify({ targets: targets.slice(0, URLS_PER_FINDING) }), dedupKey: pageFindingKey(type, page) })
    }
  }
  // External-unverified run-only notices (only when >0).
  if (externalCanonical.size > 0) findings.push(runNotice(runId, 'canonical_external_unverified', externalCanonical.size))
  if (externalHreflang.size > 0) findings.push(runNotice(runId, 'hreflang_external_unverified', externalHreflang.size))
  return findings
}

function sourceOf(type: string): string {
  if (type.startsWith('canonical_')) return 'live-scan-canonical'
  if (type.startsWith('redirect_')) return 'live-scan-redirect'
  return 'live-scan-hreflang'
}
function runNotice(runId: string, type: string, count: number): FindingInput {
  return { id: randomUUID(), runId, pageId: null, scope: 'run', type, severity: SEVERITY[type] ?? 'notice',
    url: null, count, affectedComplete: true, affectedSource: sourceOf(type),
    detail: JSON.stringify({ description: DESC[type] ?? type }), dedupKey: runFindingKey(type) }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/validation-mapper.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/link-harvest.ts lib/findings/validation-mapper.ts lib/findings/validation-mapper.test.ts
git commit -m "feat(c6-p4): validation-mapper — canonical/redirect/hreflang findings (pure)"
```

---

### Task 5: Fold validation into the `broken-link-verify` builder

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts`
- Test: `lib/jobs/handlers/broken-link-verify.test.ts` (add a validation integration case; keep existing)

**Interfaces:**
- Consumes: `resolveUrl`/`ResolveResult`/`realResolveDeps` (Task 1), `mapValidationFindings`/`ValidationSeoRow`/`ValidationLink` (Task 4), `sameDomain` (link-harvest).
- Changes `VerifyDeps`: replace `checkUrl: (url) => Promise<CheckResult>` with `resolve: (url: string) => Promise<ResolveResult>` (production = `(u) => resolveUrl(u, realResolveDeps)`). Update the test's `productionDeps` accordingly.

- [ ] **Step 1: Write the failing test** (add to the existing DB-backed suite)

FIRST read `lib/jobs/handlers/broken-link-verify.test.ts`: reuse its EXISTING `SiteAudit` seeding helper AND its cleanup DOMAIN (do NOT introduce `x.com` if the file scopes cleanup to a specific domain — use that domain; Codex flagged `x.com` as outside the file's cleanup). Import `normalizeFindingUrl` from `@/lib/findings/normalize-url` (or `@/lib/findings/keys`). Type the stub `resolve` as `VerifyDeps['resolve']` so `result` literals don't widen to `string`. Substitute `<DOMAIN>` with the file's cleanup domain below:

```ts
import type { VerifyDeps } from './broken-link-verify'
// ... normalizeFindingUrl imported at top ...

it('emits canonical/redirect/hreflang validation findings in the live-scan run', async () => {
  const siteAuditId = await <existingSeedHelper>({ domain: '<DOMAIN>', pagesTotal: 1 })
  await prisma.harvestedLink.createMany({ data: [
    { siteAuditId, sourcePageUrl: 'https://<DOMAIN>/a', targetUrl: 'https://<DOMAIN>/t', kind: 'internal-link', harvestTruncated: false },
  ] })
  await prisma.harvestedPageSeo.create({ data: {
    siteAuditId, url: normalizeFindingUrl('https://<DOMAIN>/a'), statusCode: 200, isHtml: true,
    canonicalUrl: 'https://<DOMAIN>/canon', robotsNoindex: false, loginLike: false,
    detailsJson: JSON.stringify({ schemaTypes: [], hreflang: [{ lang: 'fr', href: 'https://<DOMAIN>/dead' }] }),
  } })
  const resolve: VerifyDeps['resolve'] = async (url) => {
    if (url.includes('/t')) return { result: 'ok', finalUrl: 'https://<DOMAIN>/t2', status: 200, hops: 1, chain: ['https://<DOMAIN>/t2'], tooManyRedirects: false }
    if (url.includes('/canon')) return { result: 'ok', finalUrl: 'https://<DOMAIN>/canon2', status: 200, hops: 1, chain: ['https://<DOMAIN>/canon2'], tooManyRedirects: false }
    if (url.includes('/dead')) return { result: 'broken', finalUrl: null, status: 404, hops: 0, chain: [], tooManyRedirects: false }
    return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }
  }
  await runBrokenLinkVerify({ siteAuditId, domain: '<DOMAIN>' }, { resolve, now: () => Date.now(), sleep: async () => {} })
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } }, select: { status: true, findings: { select: { scope: true, type: true, count: true } } } })
  const types = new Set(run!.findings.map((f) => f.type))
  expect(types.has('redirect_chain')).toBe(true)
  expect(types.has('canonical_redirect')).toBe(true)
  expect(types.has('hreflang_broken')).toBe(true)
  expect(await prisma.harvestedLink.count({ where: { siteAuditId } })).toBe(0)
  expect(await prisma.harvestedPageSeo.count({ where: { siteAuditId } })).toBe(0)
})
```

Also add, in the SAME file:
- **Dedup-once test:** one URL used as internal-link target AND a page's canonical resolves through the shared cache exactly once (assert the stub `resolve` is called once for that URL via a call-count spy) yet still yields both a `broken_internal_links`/`redirect_chain` AND a `canonical_*` finding as applicable.
- **Cap→partial test:** set `process.env.BROKEN_LINK_MAX_CHECKS = '1'`, seed 1 legacy link + 1 canonical-only target, assert the canonical-only target is NOT resolved (cap consumed by the legacy link) and `run.status === 'partial'`. Restore the env in `afterEach`.

**Also update `lib/jobs/handlers/broken-link-verify.graph.test.ts`** (Codex-flagged): its `VerifyDeps` stub uses `checkUrl` — change it to the new `resolve` shape (return a full `ResolveResult`) so it compiles under the changed `VerifyDeps`.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: FAIL — validation findings absent (and `VerifyDeps` shape mismatch on the new call).

- [ ] **Step 3: Rework the builder**

Concrete edits to `runBrokenLinkVerify`:

1. **Imports** — add:
```ts
import { resolveUrl, realResolveDeps, type ResolveResult } from '@/lib/ada-audit/url-resolver'
import { mapValidationFindings, type ValidationSeoRow, type ValidationLink } from '@/lib/findings/validation-mapper'
import { sameDomain } from '@/lib/ada-audit/link-harvest'
```

2. **`VerifyDeps` + `productionDeps`** — replace `checkUrl` with `resolve`:
```ts
export interface VerifyDeps {
  resolve: (url: string) => Promise<ResolveResult>
  now: () => number
  sleep: (ms: number) => Promise<void>
}
const productionDeps: VerifyDeps = {
  resolve: (url) => resolveUrl(url, realResolveDeps),
  now: realResolveDeps.now,
  sleep: realResolveDeps.sleep,
}
```

3. **Add `canonicalUrl` + `detailsJson` to the `seoRows` select** (the `prisma.harvestedPageSeo.findMany` select gains `canonicalUrl: true, detailsJson: true`).

4. **Reorder + replace the worker (Codex plan-fix — Task 5 does NOT compose literally otherwise).** In the CURRENT function the order is: build `toCheck` + `cap`/`capped` (~L128) → old worker loop that fills `broken[]` (~L133–158) → `seoRows = harvestedPageSeo.findMany(...)` (~L160). Two structural edits:
   - **(a) Move the `seoRows` findMany block ABOVE the resolution-set construction** (it must exist before `validationRows` reads it). The later graph/on-page/score code keeps using the same `seoRows` — moving it up is safe. Add `canonicalUrl: true, detailsJson: true` to its select (step 3 above).
   - **(b) DELETE the old worker block entirely** — the `let checked = 0`, `let unconfirmed = 0`, `let cursor = 0`, `const broken: BrokenTarget[] = []`, the `const worker = async () => {...}`, and its `await Promise.all(...)`. **KEEP** `const throttle = new HostThrottle(HOST_DELAY(), deps)`. `checked`/`unconfirmed`/`broken` are re-declared in step 5 from the cache.

   Then build the ordered, dedup'd, same-domain resolution set + cache-filling worker. `auditedHost` = `(site.domain ?? job.domain ?? '')`.

```ts
  const auditedHost = (site.domain ?? job.domain ?? '').toLowerCase()
  const isSameHost = (url: string): boolean => { try { return sameDomain(new URL(url).hostname.toLowerCase(), auditedHost) } catch { return false } }

  // Parse hreflang pairs (tolerate legacy string[] shape) + collect validation inputs.
  const parseHreflang = (json: string | null): { lang: string; href: string }[] => {
    if (!json) return []
    try {
      const d = JSON.parse(json) as { hreflang?: unknown }
      const h = d.hreflang
      if (!Array.isArray(h)) return []
      return h.map((e) => (e && typeof e === 'object' && 'href' in (e as object))
        ? { lang: String((e as { lang?: unknown }).lang ?? ''), href: String((e as { href?: unknown }).href ?? '') }
        : { lang: String(e), href: '' }) // legacy code-only: no href → no target/reciprocity finding
        .filter((e) => e.lang)
    } catch { return [] }
  }
  const validationRows: ValidationSeoRow[] = seoRows.map((r) => ({ url: r.url, canonicalUrl: r.canonicalUrl ?? null, hreflang: parseHreflang(r.detailsJson) }))
  const internalLinks: ValidationLink[] = rows.filter((r) => r.kind === 'internal-link').map((r) => ({ sourcePageUrl: r.sourcePageUrl, targetUrl: r.targetUrl }))

  // Resolution set: legacy link/image targets FIRST (existing order preserved), then
  // canonical/hreflang-only same-domain targets not already present. Cap applies AFTER ordering.
  const legacyTargets = toCheck.map((t) => t.targetUrl) // toCheck already deterministic + capped for legacy
  const legacySet = new Set(legacyTargets.map((u) => normalizeFindingUrl(u)))
  const validationTargets: string[] = []
  const validationSeen = new Set<string>()
  const addValidationTarget = (raw: string, base: string) => {
    const abs = normalizeLinkTarget(raw, base); if (!abs || !isSameHost(abs)) return
    const norm = normalizeFindingUrl(abs)
    if (legacySet.has(norm) || validationSeen.has(norm)) return
    validationSeen.add(norm); validationTargets.push(abs)
  }
  for (const r of validationRows) {
    if (r.canonicalUrl) addValidationTarget(r.canonicalUrl, r.url)
    for (const h of r.hreflang) if (h.href) addValidationTarget(h.href, r.url)
  }
  validationTargets.sort()
  // Reuse the existing `cap` (const cap = MAX_CHECKS() already declared above at ~line 128).
  const remaining = Math.max(0, cap - legacyTargets.length)
  const cappedValidation = validationTargets.length > remaining
  const validationToResolve = cappedValidation ? validationTargets.slice(0, remaining) : validationTargets

  // Resolve legacy + validation targets ONCE into a shared cache.
  const cache = new Map<string, ResolveResult>()
  const allToResolve = [...legacyTargets, ...validationToResolve]
  let cursor2 = 0
  const cacheWorker = async (): Promise<void> => {
    while (cursor2 < allToResolve.length) {
      const url = allToResolve[cursor2++]
      let host = ''
      try { host = new URL(url).hostname } catch { cache.set(normalizeFindingUrl(url), { result: 'unconfirmed', finalUrl: null, status: null, hops: 0, chain: [], tooManyRedirects: false }); continue }
      await throttle.wait(host)
      cache.set(normalizeFindingUrl(url), await deps.resolve(url))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY(), allToResolve.length || 1) }, () => cacheWorker()))
```

   NOTE: this REPLACES the existing `worker`/`Promise.all` block. `checked`/`unconfirmed`/`broken` are now derived from the cache below. Keep `throttle` as-is. Remove the old `broken: BrokenTarget[]` push loop.

5. **Derive broken targets from the cache** (for `mapBrokenLinkFindings`, unchanged mapper):
```ts
  let checked = 0, unconfirmed = 0
  const broken: BrokenTarget[] = []
  for (const t of toCheck) {
    const r = cache.get(normalizeFindingUrl(t.targetUrl))
    if (!r) continue
    checked++
    if (r.result === 'broken') broken.push({ targetUrl: t.targetUrl, kind: t.kind, sourcePageUrls: [...t.sources] })
    else if (r.result === 'unconfirmed') unconfirmed++
  }
```

6. **Call `mapValidationFindings`** after `onPageFindings`/`brokenFindings` and merge (thread `affectedComplete: !cappedValidation`):
```ts
  const validationFindings = mapValidationFindings(validationRows, internalLinks, cache,
    { runId, ensurePage, auditedHost, affectedComplete: !cappedValidation })
  const findings: FindingInput[] = [...onPageFindings, ...brokenFindings, ...validationFindings]
```

7. **`capped` for run status** now also considers validation truncation:
```ts
  status: capped || harvestTruncated || cappedValidation ? 'partial' : 'complete',
```
   (Add `const capped = ...` already exists for legacy; OR the two: e.g. keep existing `capped` and add `|| cappedValidation` in the status expression.)

8. Ensure `normalizeLinkTarget` is imported (it is used in step 4): `import { normalizeLinkTarget } from '@/lib/ada-audit/link-harvest'` — extend the existing link-harvest import.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS (existing broken-link/on-page cases + new validation case).

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(c6-p4): fold canonical/redirect/hreflang validation into the live-scan builder"
```

---

### Task 6: `TechnicalSeoSection` component + results-page wiring

**Files:**
- Create: `components/site-audit/TechnicalSeoSection.tsx`
- Test: `components/site-audit/TechnicalSeoSection.test.tsx`
- Modify: `app/ada-audit/site/[id]/page.tsx` (render the section)

**Interfaces:**
- Consumes: the `liveScanRun` object already loaded on the page (`{ status, findings: { scope, type, count, url, detail }[] }` — same `BrokenLinksRun` shape) + `analyzed` (the existing `onPageAnalyzed` marker).
- Produces: `TechnicalSeoSection({ run, analyzed }: { run: BrokenLinksRun | null; analyzed: boolean })`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TechnicalSeoSection } from './TechnicalSeoSection'

afterEach(cleanup)

const run = (findings: any[]) => ({ status: 'complete', findings })

describe('TechnicalSeoSection', () => {
  it('not-analyzed state when run is null', () => {
    render(<TechnicalSeoSection run={null} analyzed={false} />)
    expect(screen.getByText(/not yet analyzed|runs shortly/i)).toBeTruthy()
  })
  it('clean state when analyzed with no validation findings', () => {
    render(<TechnicalSeoSection run={run([{ scope: 'run', type: 'broken_internal_links', count: 3, url: null, detail: null }])} analyzed={true} />)
    expect(screen.getByText(/No canonical, redirect, or hreflang issues/i)).toBeTruthy()
  })
  it('renders grouped validation findings', () => {
    render(<TechnicalSeoSection analyzed={true} run={run([
      { scope: 'run', type: 'canonical_broken', count: 2, url: null, detail: JSON.stringify({ description: 'x' }) },
      { scope: 'page', type: 'canonical_broken', count: 1, url: 'https://x.com/a', detail: null },
      { scope: 'run', type: 'redirect_chain', count: 1, url: null, detail: null },
    ])} />)
    expect(screen.getByText(/Canonical broken/i)).toBeTruthy()
    expect(screen.getByText('https://x.com/a')).toBeTruthy()
    expect(screen.getByText(/Redirect chain/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/TechnicalSeoSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component** (mirror `OnPageSeoSection`'s card + states + dark-mode classes)

```tsx
// components/site-audit/TechnicalSeoSection.tsx
//
// C6 Phase 4: renders canonical/redirect/hreflang validation findings from the
// SAME live-scan CrawlRun as BrokenLinksSection/OnPageSeoSection, scoped to the
// validation type-set (disjoint from broken_* and on-page types). Clean = no
// validation findings among the audited pages.
import type { BrokenLinksRun } from './BrokenLinksSection'

const TECH_LABEL: Record<string, string> = {
  canonical_broken: 'Canonical broken',
  canonical_redirect: 'Canonical is a redirect',
  redirect_chain: 'Redirect chain (internal link)',
  redirect_loop: 'Redirect loop (internal link)',
  hreflang_broken: 'Hreflang alternate broken',
  hreflang_no_return: 'Hreflang missing return link',
  hreflang_missing_self: 'Hreflang missing self-reference',
  hreflang_missing_x_default: 'Hreflang missing x-default',
  hreflang_invalid_code: 'Hreflang invalid code',
  canonical_external_unverified: 'Canonical (external, not verified)',
  hreflang_external_unverified: 'Hreflang (external, not verified)',
}
const TECH_TYPES = new Set(Object.keys(TECH_LABEL))

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">Technical SEO validation</h2>
      {children}
    </section>
  )
}

export function TechnicalSeoSection({ run, analyzed }: { run: BrokenLinksRun | null; analyzed: boolean }) {
  if (!run) {
    return (
      <Card>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          Technical SEO not yet analyzed — the live scan runs shortly after the audit completes.
        </p>
      </Card>
    )
  }
  if (!analyzed) {
    return (
      <Card>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          This audit predates technical SEO validation — re-run the audit to populate it.
        </p>
      </Card>
    )
  }
  const runScope = run.findings.filter((f) => f.scope === 'run' && f.count > 0 && TECH_TYPES.has(f.type))
  if (runScope.length === 0) {
    return (
      <Card>
        <p className="text-[13px] font-body text-green-700 dark:text-green-400">
          No canonical, redirect, or hreflang issues found among the audited pages.
        </p>
      </Card>
    )
  }
  const pageByType = new Map<string, string[]>()
  for (const f of run.findings) {
    if (f.scope !== 'page' || !f.url || !TECH_TYPES.has(f.type)) continue
    const list = pageByType.get(f.type) ?? []
    list.push(f.url)
    pageByType.set(f.type, list)
  }
  return (
    <Card>
      <div className="space-y-4">
        {runScope.map((f) => {
          const pages = pageByType.get(f.type) ?? []
          return (
            <div key={f.type}>
              <p className="text-[13px] font-body font-semibold text-navy dark:text-white">
                {TECH_LABEL[f.type] ?? f.type}: {f.count}
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

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/TechnicalSeoSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into the results page**

In `app/ada-audit/site/[id]/page.tsx`: add the import near the other section imports:
```ts
import { TechnicalSeoSection } from '@/components/site-audit/TechnicalSeoSection'
```
And render it immediately after `<OnPageSeoSection … />` (line ~215):
```tsx
      <TechnicalSeoSection run={liveScanRun} analyzed={onPageAnalyzed} />
```
(No extra query — `liveScanRun` already carries the findings; the share view (`SiteAuditResultsView shareMode`) does not render these sections, so no share-page change.)

**Known limitation (Codex plan-fix, documented not fixed):** `analyzed` reuses `onPageAnalyzed` (a CrawlPage with `statusCode != null`), which is also true for pre-Phase-4 live-scan runs (Phase 2/3). Such an older run has no validation findings, so `TechnicalSeoSection` renders "clean" for it even though validation never ran. This is a transient, self-healing cosmetic gap — the next audit rebuilds the run with validation, and we deliberately avoid a schema migration for a marker. Note it in the post-merge verification + the handoff so it isn't mistaken for a bug. (Do NOT add a durable Phase-4 marker in this increment.)

- [ ] **Step 6: Commit**

```bash
git add components/site-audit/TechnicalSeoSection.tsx components/site-audit/TechnicalSeoSection.test.tsx "app/ada-audit/site/[id]/page.tsx"
git commit -m "feat(c6-p4): TechnicalSeoSection results-page block"
```

---

### Task 7: Gate-green + PR

- [ ] **Step 1: Full gate**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: tsc clean · all tests pass (new: url-resolver, validation-mapper, broken-link-verify validation case, TechnicalSeoSection; unchanged: broken-link-check) · build clean.

- [ ] **Step 2: Authoritative helper-free gate on the REAL build output** (Codex plan-fix — esbuild is only a precheck; SWC/Next is the prod compiler)

The `npm run build` in Step 1 emits the actual SWC-compiled bundle. Grep it for escaping helpers in the `parseSeoFromDocument`/parse-seo-dom emit (the injected fn is bundled into the site-audit-page path):

```bash
grep -rlE 'parseSeoFromDocument|link\[rel="alternate"\]\[hreflang\]' .next/server 2>/dev/null \
  | xargs grep -lE '_type_of|_to_consumable_array|_object_spread|_sliced_to_array|__spread|__assign|_create_class' 2>/dev/null \
  && echo "HELPER LEAKED NEAR INJECTED FN — DO NOT MERGE" || echo "clean: no escaping helper in the built parse-seo-dom path"
```
Expected: `clean: ...`. (The esbuild es2017 grep in Task 3 Step 5 stays as the fast pre-check during development.)

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/c6-p4-validation
gh pr create --title "C6 Phase 4: redirect/canonical/hreflang validation" --body "$(cat <<'EOF'
Folds a shared resolveUrl() into the broken-link-verify builder; derives canonical/redirect/hreflang findings into the same live-scan CrawlRun; new TechnicalSeoSection. hreflang harvest now captures {lang,href} pairs (es2017 helper-free verified). No schema migration. Same-domain-only initial targets (cross-domain recorded-unverified).

Spec: docs/superpowers/specs/2026-07-03-redirect-canonical-hreflang-validation-design.md
Plan: docs/superpowers/plans/2026-07-03-redirect-canonical-hreflang-validation.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Post-merge (change-control ritual — outside the plan tasks)

Deploy is code-only (no migration, no new env) → plain `ssh $PROD_SSH "~/deploy.sh"`, then prod-verify:
- App online, low restart count, memory under ceiling.
- **Minification survival:** grep the deployed `.next/server` bundle for the new finding-type literals + confirm no `_type_of` helper in the parse-seo-dom path (the landmine check, same as Phase 2).
- On the next real client audit (canary / manhattanschool.edu), confirm the live-scan run carries canonical/redirect/hreflang findings alongside broken-link + on-page, in one CrawlRun, transient tables cleaned.
- Tracker checkbox + dated status-log line + rewritten handoff, same commit; end the reply with the paste-in prompt.
