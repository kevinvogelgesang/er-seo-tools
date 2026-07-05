# External-link Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the already-harvested external `<a href>`/`<img src>` targets in the live-scan builder and surface a `broken_external_links` finding, closing a Screaming-Frog capability gap.

**Architecture:** The `broken-link-verify` job (`lib/jobs/handlers/broken-link-verify.ts`) currently verifies only same-domain internal links/images. This adds a **second, additive resolution pass** for `external-link` rows — HEAD-only, its own cap, its own remaining-time-aware soft budget — then emits `broken_external_links` (severity `warning`) via a second `mapBrokenLinkFindings` call. The internal pass is left byte-unchanged.

**Tech Stack:** TypeScript, Next.js 15, Prisma+SQLite, Vitest. No new dependencies. No schema migration. No new route/middleware. No `.toString()`-injected code.

**Spec:** `docs/superpowers/specs/2026-07-04-external-link-verification-design.md` (Codex accept-with-fixes ×12 applied).

## Global Constraints

- **Internal-link/image verification MUST stay byte-unchanged** — same query, dedup, cap, pool, timeout, classification, findings, severity (`critical`), confidence. External work is strictly additive.
- **No `Class.name`/function-name runtime lookups** (SWC minifies them). Resolve by import binding only.
- **Array-form `prisma.$transaction([...])` only** — never interactive. (No new transaction is added here; `writeFindingsRun` owns persistence.)
- **UI changes carry dark-mode variants** on every element (`dark:` classes) and no hydration-mismatch patterns.
- **Externals are third-party sites** — only ever exercised against client sites already in the system or domains we control. Never scan non-client sites.
- **Test env pragmas:** node-only tests use `// @vitest-environment node`; React tests use `// @vitest-environment jsdom` + `afterEach(cleanup)`.
- **Test/prisma commands prefix:** `DATABASE_URL="file:./local-dev.db"`.

---

### Task 1: `parseNonNegativeInt` config helper

**Files:**
- Modify: `lib/jobs/config.ts`
- Test (create): `lib/jobs/config.test.ts`

**Interfaces:**
- Produces: `parseNonNegativeInt(value: string | undefined, fallback: number): number` — returns the parsed int when finite and `>= 0`, else `fallback`. (Distinct from `parsePositiveInt`, which rejects `0`.) Used by Task 4 so `BROKEN_LINK_EXTERNAL_MAX_CHECKS=0` disables the external pass.

- [ ] **Step 1: Write the failing test**

Create `lib/jobs/config.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseNonNegativeInt } from './config'

describe('parseNonNegativeInt', () => {
  it('parses 0 as 0 (not the fallback)', () => {
    expect(parseNonNegativeInt('0', 300)).toBe(0)
  })
  it('parses a positive integer', () => {
    expect(parseNonNegativeInt('7', 300)).toBe(7)
  })
  it('falls back on negative', () => {
    expect(parseNonNegativeInt('-1', 300)).toBe(300)
  })
  it('falls back on undefined/garbage', () => {
    expect(parseNonNegativeInt(undefined, 300)).toBe(300)
    expect(parseNonNegativeInt('abc', 300)).toBe(300)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/config.test.ts`
Expected: FAIL — `parseNonNegativeInt` is not exported.

- [ ] **Step 3: Add the helper**

In `lib/jobs/config.ts`, directly below `parsePositiveInt`:

```ts
export function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/config.ts lib/jobs/config.test.ts
git commit -m "feat(config): parseNonNegativeInt (0 allowed, for external-check kill switch)"
```

---

### Task 2: HEAD-only external resolver

**Files:**
- Modify: `lib/ada-audit/url-resolver.ts`
- Test: `lib/ada-audit/url-resolver.test.ts`

**Interfaces:**
- Consumes: `ResolveDeps`, `ResolveResult`, `realResolveDeps`, `SafeUrlError`, `DEFAULT_TIMEOUT` (all already in the module).
- Produces: `resolveExternalHead(url: string, deps?: ResolveDeps, timeoutMs?: number): Promise<ResolveResult>` — issues **only a HEAD** (never GET). Classifies: status `<400` → `ok`; `404`/`410`/`5xx` → `broken`; every other status (incl. `401/403/405/429` anti-bot) → `unconfirmed`; any throw (`SafeUrlError`, network, timeout) → `unconfirmed`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/ada-audit/url-resolver.test.ts` (match the existing import/test style in that file; add `resolveExternalHead` to the import from `./url-resolver`):

```ts
describe('resolveExternalHead (HEAD-only)', () => {
  const depsWith = (headStatus: number | Error) => {
    const calls: string[] = []
    const deps: ResolveDeps = {
      fetchResolved: async (_url, method) => {
        calls.push(method)
        if (headStatus instanceof Error) throw headStatus
        return { status: headStatus, finalUrl: _url, redirects: [] }
      },
      now: () => 0,
      sleep: async () => {},
    }
    return { deps, calls }
  }

  it('classifies 404/410/5xx as broken', async () => {
    for (const s of [404, 410, 500, 503]) {
      const { deps } = depsWith(s)
      expect((await resolveExternalHead('https://x.example/a', deps, 8000)).result).toBe('broken')
    }
  })

  it('classifies anti-bot 401/403/405/429 and other 4xx as unconfirmed', async () => {
    for (const s of [401, 403, 405, 429, 400, 402]) {
      const { deps } = depsWith(s)
      expect((await resolveExternalHead('https://x.example/a', deps, 8000)).result).toBe('unconfirmed')
    }
  })

  it('classifies <400 as ok', async () => {
    for (const s of [200, 204, 301, 302]) {
      const { deps } = depsWith(s)
      expect((await resolveExternalHead('https://x.example/a', deps, 8000)).result).toBe('ok')
    }
  })

  it('never issues a GET (HEAD-only), even on a 5xx', async () => {
    const { deps, calls } = depsWith(500)
    await resolveExternalHead('https://x.example/a', deps, 8000)
    expect(calls).toEqual(['HEAD'])
  })

  it('treats a SafeUrlError as unconfirmed and does not GET', async () => {
    const { deps, calls } = depsWith(new SafeUrlError('blocked'))
    expect((await resolveExternalHead('https://x.example/a', deps, 8000)).result).toBe('unconfirmed')
    expect(calls).toEqual(['HEAD'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/url-resolver.test.ts`
Expected: FAIL — `resolveExternalHead` is not exported.

- [ ] **Step 3: Implement the resolver**

In `lib/ada-audit/url-resolver.ts`, add after `resolveUrl`:

```ts
/** HEAD-only external-link check (C6 external verification). Never issues a GET.
 * broken = 404 | 410 | 5xx; ok = <400; everything else (401/403/405/429, other
 * 4xx, throws) = unconfirmed — the deliberate anti-bot-tolerant posture. */
export async function resolveExternalHead(
  url: string,
  deps: ResolveDeps = realResolveDeps,
  timeoutMs: number = DEFAULT_TIMEOUT,
): Promise<ResolveResult> {
  try {
    const head = await deps.fetchResolved(url, 'HEAD', timeoutMs)
    const status = head.status
    const broken = status === 404 || status === 410 || (status >= 500 && status <= 599)
    const result: ResolveResult['result'] = status < 400 ? 'ok' : broken ? 'broken' : 'unconfirmed'
    return { result, finalUrl: head.finalUrl, status, hops: head.redirects.length, chain: head.redirects, tooManyRedirects: false }
  } catch (err) {
    return { ...UNCONFIRMED, tooManyRedirects: err instanceof SafeUrlError && err.message === 'Too many redirects' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/url-resolver.test.ts`
Expected: PASS (existing `resolveUrl` tests + the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/url-resolver.ts lib/ada-audit/url-resolver.test.ts
git commit -m "feat(url-resolver): resolveExternalHead — HEAD-only, anti-bot-tolerant"
```

---

### Task 3: Mapper — external type, per-call severity, zero-count run finding

**Files:**
- Modify: `lib/findings/broken-link-mapper.ts`
- Test: `lib/findings/broken-link-mapper.test.ts`

**Interfaces:**
- Consumes: `BrokenTarget` (kind union already includes `'external-link'`), `runFindingKey`, `pageFindingKey`, `normalizeFindingUrl`.
- Produces: `mapBrokenLinkFindings(broken, deps)` where `BrokenLinkMapDeps` gains two OPTIONAL fields:
  - `severity?: 'critical' | 'warning'` (default `'critical'` — internal callers unchanged).
  - `alwaysEmitRunTypes?: string[]` — types that MUST get a run-scope finding even at `count 0` (used for external coverage transparency). Default: none.
  - `TYPE_OF['external-link']` now maps to `'broken_external_links'` (was `null`).

- [ ] **Step 1: Write the failing tests**

Append to `lib/findings/broken-link-mapper.test.ts` (reuse the existing `ensurePage` stub pattern at the top of that file; import `mapBrokenLinkFindings`, `type BrokenTarget` if not already):

```ts
describe('mapBrokenLinkFindings — external links', () => {
  // Minimal ensurePage stub (mirror the file's existing one if present).
  const makeEnsure = () => {
    const byUrl = new Map<string, any>()
    return (url: string) => {
      let p = byUrl.get(url)
      if (!p) { p = { id: `p-${byUrl.size}`, runId: 'R', url } as any; byUrl.set(url, p) }
      return p
    }
  }
  const conf = { checked: 0, broken: 0, unconfirmed: 0, capped: false, harvestTruncated: false }

  it('maps external-link broken targets to broken_external_links at warning severity', () => {
    const broken: BrokenTarget[] = [
      { targetUrl: 'https://out.example/dead', kind: 'external-link', sourcePageUrls: ['https://site.example/a'] },
    ]
    const out = mapBrokenLinkFindings(broken, {
      runId: 'R', ensurePage: makeEnsure(), affectedComplete: true,
      confidence: { ...conf, broken: 1, checked: 1 }, severity: 'warning',
      alwaysEmitRunTypes: ['broken_external_links'],
    })
    const run = out.find((f) => f.scope === 'run')!
    expect(run.type).toBe('broken_external_links')
    expect(run.severity).toBe('warning')
    expect(run.count).toBe(1)
    expect(out.some((f) => f.scope === 'page' && f.type === 'broken_external_links')).toBe(true)
  })

  it('emits a zero-count run finding when alwaysEmitRunTypes is set but nothing broke', () => {
    const out = mapBrokenLinkFindings([], {
      runId: 'R', ensurePage: makeEnsure(), affectedComplete: true,
      confidence: { ...conf, checked: 12, unconfirmed: 3 }, severity: 'warning',
      alwaysEmitRunTypes: ['broken_external_links'],
    })
    expect(out).toHaveLength(1)
    expect(out[0].scope).toBe('run')
    expect(out[0].type).toBe('broken_external_links')
    expect(out[0].count).toBe(0)
    expect(out[0].severity).toBe('warning')
    expect(JSON.parse(out[0].detail!)).toMatchObject({ checked: 12, unconfirmed: 3 })
  })

  it('defaults internal-link severity to critical (unchanged) and emits nothing extra', () => {
    const broken: BrokenTarget[] = [
      { targetUrl: 'https://site.example/dead', kind: 'internal-link', sourcePageUrls: ['https://site.example/a'] },
    ]
    const out = mapBrokenLinkFindings(broken, {
      runId: 'R', ensurePage: makeEnsure(), affectedComplete: true, confidence: { ...conf, broken: 1, checked: 1 },
    })
    expect(out.find((f) => f.scope === 'run')!.severity).toBe('critical')
    expect(out.every((f) => f.type === 'broken_internal_links')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/broken-link-mapper.test.ts`
Expected: FAIL — external maps to `null` today (skipped), no `severity`/`alwaysEmitRunTypes` support.

- [ ] **Step 3: Edit the mapper**

In `lib/findings/broken-link-mapper.ts`:

Change `TYPE_OF` and `DESC`:

```ts
const TYPE_OF: Record<BrokenTarget['kind'], string | null> = {
  'internal-link': 'broken_internal_links',
  image: 'broken_images',
  'external-link': 'broken_external_links',
}
const DESC: Record<string, string> = {
  broken_internal_links: 'Internal links that resolve to a 4xx/5xx response.',
  broken_images: 'Image resources that resolve to a 4xx/5xx response.',
  broken_external_links: 'External links that resolve to a 404, 410, or 5xx response.',
}
```

Extend `BrokenLinkMapDeps` (add the two optional fields):

```ts
export interface BrokenLinkMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
  affectedComplete: boolean
  severity?: 'critical' | 'warning'
  alwaysEmitRunTypes?: string[]
  confidence: {
    checked: number
    broken: number
    unconfirmed: number
    capped: boolean
    harvestTruncated: boolean
  }
}
```

In `mapBrokenLinkFindings`, destructure `severity` (default `'critical'`) and use it at both push sites; after the `for (const [type, targets] of byType)` loop, add the zero-count emission:

```ts
export function mapBrokenLinkFindings(broken: BrokenTarget[], deps: BrokenLinkMapDeps): FindingInput[] {
  const { runId, ensurePage, affectedComplete, confidence } = deps
  const severity = deps.severity ?? 'critical'
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
      id: randomUUID(), runId, pageId: null, scope: 'run', type, severity,
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
        id: randomUUID(), runId, pageId: page.id, scope: 'page', type, severity,
        url: src, count: targetUrls.length, affectedComplete, affectedSource: 'live-scan-verify',
        detail: JSON.stringify({ brokenTargetUrls: targetUrls.slice(0, URLS_PER_FINDING) }),
        dedupKey: pageFindingKey(type, src),
      })
    }
  }

  // Zero-count run findings for types that were ATTEMPTED but had no broken targets
  // (external coverage transparency). Skip any type already emitted above.
  for (const type of deps.alwaysEmitRunTypes ?? []) {
    if (byType.has(type)) continue
    findings.push({
      id: randomUUID(), runId, pageId: null, scope: 'run', type, severity,
      url: null, count: 0, affectedComplete, affectedSource: 'live-scan-verify',
      detail: JSON.stringify({ description: DESC[type] ?? type, ...confidence }),
      dedupKey: runFindingKey(type),
    })
  }
  return findings
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/broken-link-mapper.test.ts`
Expected: PASS (existing test + 3 new).

- [ ] **Step 5: Commit**

```bash
git add lib/findings/broken-link-mapper.ts lib/findings/broken-link-mapper.test.ts
git commit -m "feat(findings): mapper emits broken_external_links (warning) + zero-count run findings"
```

---

### Task 4: Builder — external read, HEAD-only pass, remaining-time budget, derivation

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts`
- Test: `lib/jobs/handlers/broken-link-verify.test.ts`

**Interfaces:**
- Consumes: `parseNonNegativeInt` (Task 1), `resolveExternalHead` (Task 2), `BrokenTarget`, `ResolveResult`, `HostThrottle`, `normalizeFindingUrl`, `CONCURRENCY()`, `URLS_PER_FINDING`.
- Produces (module-local, consumed by Task 5): the variables `externalBroken: BrokenTarget[]`, `externalChecked`, `externalUnconfirmed`, `externalCapped`, `externalHarvestTruncated`, `externalAttempted`.
- Extends `VerifyDeps` with a REQUIRED field `resolveExternal: (url: string, timeoutMs: number) => Promise<ResolveResult>`; `productionDeps` provides it.

- [ ] **Step 1: Write the failing tests**

Append to `lib/jobs/handlers/broken-link-verify.test.ts`. First, note both existing deps factories (`depsFor`, `stubDeps`) and the 3 inline deps literals need a `resolveExternal` field once `VerifyDeps` requires it — Step 3 updates them. Add a new describe that seeds external `HarvestedLink` rows and asserts external verification (use the file's existing seeding helpers/`prisma` import and `DOMAIN`/id conventions — mirror the internal broken-link test at the top of the file):

```ts
describe('runBrokenLinkVerify — external links', () => {
  it('verifies external targets HEAD-only and emits broken_external_links (warning)', async () => {
    const id = /* create a complete SiteAudit + external HarvestedLink rows:
      target https://ext.example/dead (will resolve broken) + https://ext.example/live (ok),
      each with a sourcePageUrl on DOMAIN. Seed via prisma like the internal test does. */ ''
    const deps: VerifyDeps = {
      resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      resolveExternal: async (url) => (url.includes('/dead')
        ? { result: 'broken', finalUrl: url, status: 404, hops: 0, chain: [], tooManyRedirects: false }
        : { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      now: () => 0, sleep: async () => {},
    }
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    const run = await prisma.crawlRun.findFirst({ where: { siteAuditId: id, tool: 'seo-parser', source: 'live-scan' } })
    const findings = await prisma.finding.findMany({ where: { runId: run!.id, type: 'broken_external_links' } })
    const runScope = findings.find((f) => f.scope === 'run')!
    expect(runScope.severity).toBe('warning')
    expect(runScope.count).toBe(1) // only /dead
  })

  it('emits a zero-count external run finding when externals were attempted but all clean', async () => {
    const id = /* SiteAudit + external HarvestedLink rows that all resolve ok */ ''
    const deps: VerifyDeps = {
      resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      resolveExternal: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      now: () => 0, sleep: async () => {},
    }
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    const run = await prisma.crawlRun.findFirst({ where: { siteAuditId: id, tool: 'seo-parser', source: 'live-scan' } })
    const runScope = await prisma.finding.findFirst({ where: { runId: run!.id, type: 'broken_external_links', scope: 'run' } })
    expect(runScope).not.toBeNull()
    expect(runScope!.count).toBe(0)
  })

  it('kill switch: BROKEN_LINK_EXTERNAL_MAX_CHECKS=0 skips externals entirely', async () => {
    const prev = process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS
    process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS = '0'
    try {
      const id = /* SiteAudit + external HarvestedLink rows */ ''
      const seen: string[] = []
      const deps: VerifyDeps = {
        resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
        resolveExternal: async (url) => { seen.push(url); return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false } },
        now: () => 0, sleep: async () => {},
      }
      await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
      expect(seen).toHaveLength(0) // never called
      const run = await prisma.crawlRun.findFirst({ where: { siteAuditId: id, tool: 'seo-parser', source: 'live-scan' } })
      const ext = await prisma.finding.findFirst({ where: { runId: run!.id, type: 'broken_external_links' } })
      expect(ext).toBeNull()
    } finally {
      if (prev === undefined) delete process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS
      else process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS = prev
    }
  })

  it('remaining-time budget exhausted: externals skipped, run marked partial, no job failure', async () => {
    const id = /* SiteAudit + external HarvestedLink rows */ ''
    let t = 0
    const deps: VerifyDeps = {
      resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      resolveExternal: async (url) => ({ result: 'broken', finalUrl: url, status: 404, hops: 0, chain: [], tooManyRedirects: false }),
      // Clock jumps past the 15-min job budget on the SECOND read (jobStartedAt is the first now()).
      now: () => { t += 1; return t === 1 ? 0 : 1_000_000 },
      sleep: async () => {},
    }
    await expect(runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)).resolves.toBeUndefined()
    const run = await prisma.crawlRun.findFirst({ where: { siteAuditId: id, tool: 'seo-parser', source: 'live-scan' } })
    expect(run!.status).toBe('partial')
    const ext = await prisma.finding.findFirst({ where: { runId: run!.id, type: 'broken_external_links', scope: 'run' } })
    expect(ext!.count).toBe(0) // budget tripped before any external check counted
  })

  it('internal-link verification is unchanged when externals are present', async () => {
    // Seed one broken internal link + one broken external; assert the internal run
    // finding is still broken_internal_links at severity critical with its own count.
    const id = '' /* seed both */
    const deps: VerifyDeps = {
      resolve: async (url) => (url.includes('/int-dead')
        ? { result: 'broken', finalUrl: url, status: 404, hops: 0, chain: [], tooManyRedirects: false }
        : { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      resolveExternal: async (url) => ({ result: 'broken', finalUrl: url, status: 404, hops: 0, chain: [], tooManyRedirects: false }),
      now: () => 0, sleep: async () => {},
    }
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    const run = await prisma.crawlRun.findFirst({ where: { siteAuditId: id, tool: 'seo-parser', source: 'live-scan' } })
    const internal = await prisma.finding.findFirst({ where: { runId: run!.id, type: 'broken_internal_links', scope: 'run' } })
    expect(internal!.severity).toBe('critical')
  })
})
```

> Implementer note: fill the `id = ...` seeds using the same `prisma.siteAudit.create` + `prisma.harvestedLink.createMany` pattern the existing internal broken-link tests at the top of this file already use (status `'complete'`, `kind: 'external-link'` for external rows). Keep DOMAIN/host consistent so `sameDomain` classifies correctly. Since these are DB-backed, they need the `local-dev.db` env.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: FAIL — `resolveExternal` missing on `VerifyDeps`; externals not verified.

- [ ] **Step 3: Extend `VerifyDeps` + `productionDeps` + add constants**

In `lib/jobs/handlers/broken-link-verify.ts`:

Add imports:

```ts
import { resolveExternalHead } from '@/lib/ada-audit/url-resolver'
import { parsePositiveInt, parseNonNegativeInt } from '../config'
```
(The existing `import { parsePositiveInt } from '../config'` line becomes the combined import above.)

Add constants near `MAX_CHECKS`/`HOST_DELAY`:

```ts
const JOB_TIMEOUT_MS = 900_000 // 15-min queue ceiling (single source; used at registration + external budget)
const SAFETY_RESERVE_MS = 60_000 // reserve to write the run before the ceiling
const EXTERNAL_MAX_CHECKS = () => parseNonNegativeInt(process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS, 300)
const EXTERNAL_TIMEOUT = () => parsePositiveInt(process.env.BROKEN_LINK_EXTERNAL_TIMEOUT_MS, 8_000)
const EXTERNAL_TIME_BUDGET = () => parsePositiveInt(process.env.BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS, 300_000)
```

Extend `VerifyDeps` and `productionDeps`:

```ts
export interface VerifyDeps {
  resolve: (url: string) => Promise<ResolveResult>
  resolveExternal: (url: string, timeoutMs: number) => Promise<ResolveResult>
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const productionDeps: VerifyDeps = {
  resolve: (url) => resolveUrl(url, realResolveDeps),
  resolveExternal: (url, timeoutMs) => resolveExternalHead(url, realResolveDeps, timeoutMs),
  now: realResolveDeps.now,
  sleep: realResolveDeps.sleep,
}
```

Update the job registration to use the constant: change `timeoutMs: 900_000,` to `timeoutMs: JOB_TIMEOUT_MS,`.

**Update the existing test deps** so lint/build stay green: add `resolveExternal` to `depsFor` (mirror `resolve` over the same `brokenSet`, HEAD-only shape), to `stubDeps`, and to each of the 3 inline `{ resolve, now, sleep }` literals in the validation describe:

```ts
// in depsFor(brokenSet):
resolveExternal: async (url: string) => (brokenSet.has(url)
  ? { result: 'broken' as const, finalUrl: url, status: 404, hops: 0, chain: [], tooManyRedirects: false }
  : { result: 'ok' as const, finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
// in stubDeps and each inline literal:
resolveExternal: async (url: string) => ({ result: 'ok' as const, finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
```

- [ ] **Step 4: Capture `jobStartedAt` + add the external pass**

At the top of `runBrokenLinkVerify`, right after `const job = assertPayload(payload)`:

```ts
const jobStartedAt = deps.now()
```

Insert the external pass **after** the internal derivation loop (the `for (const t of toCheck) { ... }` block that fills `broken`/`checked`/`unconfirmed`) and **before** the `computeLinkGraph` block:

```ts
// ---- External-link verification (HEAD-only; separate cap + remaining-time soft budget) ----
const EXTERNAL_MAX = EXTERNAL_MAX_CHECKS()
const externalBroken: BrokenTarget[] = []
let externalChecked = 0
let externalUnconfirmed = 0
let externalCapped = false
let externalHarvestTruncated = false
let externalAttempted = false
if (EXTERNAL_MAX > 0) {
  const extRows = await prisma.harvestedLink.findMany({
    where: { siteAuditId: job.siteAuditId, kind: 'external-link' },
    orderBy: [{ targetUrl: 'asc' }, { sourcePageUrl: 'asc' }],
    select: { targetUrl: true, sourcePageUrl: true, harvestTruncated: true },
  })
  externalHarvestTruncated = extRows.some((r) => r.harvestTruncated)
  const extByTarget = new Map<string, Set<string>>()
  for (const r of extRows) {
    let s = extByTarget.get(r.targetUrl)
    if (!s) { s = new Set<string>(); extByTarget.set(r.targetUrl, s) }
    if (s.size < URLS_PER_FINDING) s.add(normalizeFindingUrl(r.sourcePageUrl))
  }
  const extUnique = [...extByTarget.entries()].map(([targetUrl, sources]) => ({ targetUrl, sources }))
  externalCapped = extUnique.length > EXTERNAL_MAX
  const extToCheck = externalCapped ? extUnique.slice(0, EXTERNAL_MAX) : extUnique
  externalAttempted = extToCheck.length > 0 || externalCapped

  if (extToCheck.length > 0) {
    const remaining = JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS
    const externalDeadlineMs = Math.max(0, Math.min(EXTERNAL_TIME_BUDGET(), remaining))
    if (externalDeadlineMs <= 0) {
      externalCapped = true // no time left; skip the pass, run stays partial
    } else {
      const timeout = EXTERNAL_TIMEOUT()
      const externalStartedAt = deps.now()
      const extCache = new Map<string, ResolveResult>()
      let extCursor = 0
      const unconfirmedResult = (): ResolveResult => ({ result: 'unconfirmed', finalUrl: null, status: null, hops: 0, chain: [], tooManyRedirects: false })
      const extWorker = async (): Promise<void> => {
        while (extCursor < extToCheck.length) {
          if (deps.now() - externalStartedAt >= externalDeadlineMs) { externalCapped = true; return }
          const t = extToCheck[extCursor++]
          let host = ''
          try { host = new URL(t.targetUrl).hostname } catch {
            extCache.set(normalizeFindingUrl(t.targetUrl), unconfirmedResult()); continue
          }
          await throttle.wait(host)
          try { extCache.set(normalizeFindingUrl(t.targetUrl), await deps.resolveExternal(t.targetUrl, timeout)) }
          catch { extCache.set(normalizeFindingUrl(t.targetUrl), unconfirmedResult()) } // failure isolation: never job-fail
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY(), extToCheck.length) }, () => extWorker()))
      for (const t of extToCheck) {
        const r = extCache.get(normalizeFindingUrl(t.targetUrl))
        if (!r) continue // never launched (budget tripped) -> uncounted; externalCapped already set
        externalChecked++
        if (r.result === 'broken') externalBroken.push({ targetUrl: t.targetUrl, kind: 'external-link', sourcePageUrls: [...t.sources] })
        else if (r.result === 'unconfirmed') externalUnconfirmed++
      }
    }
  }
}
```

> Note: `throttle` is the existing `HostThrottle` instance created for the internal pass (reused — safe across sequential passes). `CONCURRENCY`, `URLS_PER_FINDING`, `normalizeFindingUrl`, `ResolveResult`, `BrokenTarget` are already in scope/imported.

- [ ] **Step 5: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS (existing internal/score/validation tests + the 5 new external tests). Task 5 wires the findings emission; if a test asserting the external *finding* fails here because emission isn't wired yet, that's expected — the derivation-only assertions (kill switch `seen` empty, run partial on budget) pass now; finding-count assertions go green after Task 5. (If splitting is awkward, the reviewer may run Tasks 4+5 together before final gate.)

- [ ] **Step 6: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(broken-link-verify): external HEAD-only pass — cap, kill switch, remaining-time budget, failure isolation"
```

---

### Task 5: Builder — split findings emission + partial status

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts`
- Test: `lib/jobs/handlers/broken-link-verify.test.ts` (the external describe from Task 4 now fully asserts findings)

**Interfaces:**
- Consumes: Task 4's `externalBroken`, `externalChecked`, `externalUnconfirmed`, `externalCapped`, `externalHarvestTruncated`, `externalAttempted`.
- Produces: `broken_external_links` findings in the live-scan `CrawlRun`; `run.status` reflects external capping/truncation.

- [ ] **Step 1: Confirm the failing assertions**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: the external finding-count/severity/zero-count assertions from Task 4 FAIL (no external emission wired).

- [ ] **Step 2: Wire the second mapper call + partial status**

In `runBrokenLinkVerify`, replace the existing single broken-findings call and the findings array assembly:

```ts
const brokenFindings = mapBrokenLinkFindings(broken, {
  runId, ensurePage, affectedComplete: !capped && !harvestTruncated,
  confidence: { checked, broken: broken.length, unconfirmed, capped, harvestTruncated },
})
const externalFindings = mapBrokenLinkFindings(externalBroken, {
  runId, ensurePage, affectedComplete: !externalCapped && !externalHarvestTruncated,
  confidence: { checked: externalChecked, broken: externalBroken.length, unconfirmed: externalUnconfirmed, capped: externalCapped, harvestTruncated: externalHarvestTruncated },
  severity: 'warning',
  alwaysEmitRunTypes: externalAttempted ? ['broken_external_links'] : [],
})
const validationFindings = mapValidationFindings(validationRows, internalLinks, cache, {
  runId, ensurePage, auditedHost, affectedComplete: !capped && !cappedValidation,
})
const findings: FindingInput[] = [...onPageFindings, ...brokenFindings, ...externalFindings, ...validationFindings]
```

Update the bundle `status` to also account for external state:

```ts
status: capped || harvestTruncated || cappedValidation || externalCapped || externalHarvestTruncated ? 'partial' : 'complete',
```

Update the final log line to include external counts:

```ts
console.log(
  `[broken-link-verify] ${job.siteAuditId}: checked ${checked}, broken ${broken.length}, unconfirmed ${unconfirmed}, external checked ${externalChecked}, external broken ${externalBroken.length}, external unconfirmed ${externalUnconfirmed}, on-page rows ${seoRows.length}`,
)
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS (all external findings assertions green; internal unchanged).

- [ ] **Step 4: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(broken-link-verify): emit broken_external_links (split mapper call) + partial status"
```

---

### Task 6: UI — external warning block in `BrokenLinksSection`

**Files:**
- Modify: `components/site-audit/BrokenLinksSection.tsx`
- Test (create): `components/site-audit/BrokenLinksSection.test.tsx`

**Interfaces:**
- Consumes: the live-scan run's findings, now including `broken_external_links` (run + page scope).
- Produces: a warning-tier external block; a coverage line when externals were attempted; correct clean-state handling.

- [ ] **Step 1: Write the failing tests**

Create `components/site-audit/BrokenLinksSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BrokenLinksSection, type BrokenLinksRun } from './BrokenLinksSection'

afterEach(cleanup)

const extRun = (count: number, detail: object): BrokenLinksRun => ({
  status: count > 0 ? 'complete' : 'complete',
  findings: [{ scope: 'run', type: 'broken_external_links', count, url: null, detail: JSON.stringify(detail) }],
})

describe('BrokenLinksSection — external links', () => {
  it('shows not-verified when run is null', () => {
    render(<BrokenLinksSection run={null} />)
    expect(screen.getByText(/not yet verified/i)).toBeTruthy()
  })

  it('shows plain verified-clean when internal clean and externals were not analyzed', () => {
    render(<BrokenLinksSection run={{ status: 'complete', findings: [] }} />)
    expect(screen.getByText(/no broken links or images found/i)).toBeTruthy()
  })

  it('renders external coverage + clean line when externals attempted but none broken', () => {
    render(<BrokenLinksSection run={extRun(0, { checked: 12, unconfirmed: 3 })} />)
    expect(screen.getByText(/no broken external links/i)).toBeTruthy()
    expect(screen.getByText(/12/)).toBeTruthy() // checked count surfaced
  })

  it('renders the external warning block when external links are broken', () => {
    const run: BrokenLinksRun = {
      status: 'complete',
      findings: [
        { scope: 'run', type: 'broken_external_links', count: 2, url: null, detail: JSON.stringify({ checked: 5, unconfirmed: 1 }) },
        { scope: 'page', type: 'broken_external_links', count: 1, url: 'https://site.example/a', detail: JSON.stringify({ brokenTargetUrls: ['https://out.example/dead'] }) },
      ],
    }
    render(<BrokenLinksSection run={run} />)
    expect(screen.getByText(/Broken external links/i)).toBeTruthy()
    expect(screen.getByText(/https:\/\/site\.example\/a/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/BrokenLinksSection.test.tsx`
Expected: FAIL — external type not rendered; clean-state logic hides the external block.

- [ ] **Step 3: Rewrite the component**

Replace the body of `components/site-audit/BrokenLinksSection.tsx` (keep the `FindingLite`/`BrokenLinksRun` interfaces, `parseDetail`, and `Card` helpers unchanged). Add the external type/label and a coverage-line helper, and restructure the render:

```tsx
const BROKEN_TYPES = new Set(['broken_internal_links', 'broken_images']) // critical tier
const EXTERNAL_TYPE = 'broken_external_links'

const TYPE_LABEL: Record<string, string> = {
  broken_internal_links: 'Broken internal links',
  broken_images: 'Broken images',
  broken_external_links: 'Broken external links',
}

function pagesForTypes(run: BrokenLinksRun, allow: (t: string) => boolean) {
  const byType = new Map<string, { url: string; targets: string[] }[]>()
  for (const f of run.findings) {
    if (f.scope !== 'page' || !f.url || !allow(f.type)) continue
    const targets = (parseDetail(f.detail).brokenTargetUrls as string[]) ?? []
    const list = byType.get(f.type) ?? []
    list.push({ url: f.url, targets })
    byType.set(f.type, list)
  }
  return byType
}

function CoverageLine({ detail, partial }: { detail: string | null; partial: boolean }) {
  const conf = parseDetail(detail)
  const checked = typeof conf.checked === 'number' ? conf.checked : null
  const unconfirmed = typeof conf.unconfirmed === 'number' ? conf.unconfirmed : 0
  if (checked === null && unconfirmed === 0 && !partial) return null
  return (
    <p className="text-[12px] font-body text-navy/45 dark:text-white/45 mb-3">
      {checked !== null && <>Checked {checked} unique target{checked === 1 ? '' : 's'}. </>}
      {unconfirmed > 0 && <>{unconfirmed} could not be confirmed (timeout/blocked) and are excluded. </>}
      {partial && <>Results are partial (capped or budget/harvest-truncated).</>}
    </p>
  )
}

export function BrokenLinksSection({ run }: { run: BrokenLinksRun | null }) {
  if (!run) {
    return (
      <Card>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          Broken links not yet verified — the out-of-band check runs shortly after the audit completes.
        </p>
      </Card>
    )
  }

  const partial = run.status === 'partial'
  const internalRunScope = run.findings.filter((f) => f.scope === 'run' && f.count > 0 && BROKEN_TYPES.has(f.type))
  const externalRun = run.findings.find((f) => f.scope === 'run' && f.type === EXTERNAL_TYPE)
  const hasInternal = internalRunScope.length > 0
  const externalAttempted = !!externalRun
  const externalBrokenCount = externalRun?.count ?? 0

  if (!hasInternal && !externalAttempted) {
    return (
      <Card>
        <p className="text-[13px] font-body text-green-700 dark:text-green-400">
          Verified — no broken links or images found.
        </p>
      </Card>
    )
  }

  const internalPages = pagesForTypes(run, (t) => BROKEN_TYPES.has(t))
  const externalPages = pagesForTypes(run, (t) => t === EXTERNAL_TYPE)

  return (
    <Card>
      {/* Internal (critical) tier */}
      {hasInternal && (
        <div className="mb-4">
          <CoverageLine detail={internalRunScope[0].detail} partial={partial} />
          <div className="space-y-4">
            {internalRunScope.map((f) => {
              const pages = internalPages.get(f.type) ?? []
              return (
                <div key={f.type}>
                  <p className="text-[13px] font-body font-semibold text-red-600 dark:text-red-400">
                    {TYPE_LABEL[f.type] ?? f.type}: {f.count}
                  </p>
                  {pages.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {pages.slice(0, 25).map((p, i) => (
                        <li key={i} className="text-[12px] font-body text-navy/60 dark:text-white/60">
                          <span className="break-all">{p.url}</span>
                          {p.targets.length > 0 && (
                            <span className="text-navy/40 dark:text-white/40">
                              {' '}→ {p.targets.slice(0, 5).join(', ')}
                              {p.targets.length > 5 ? ` (+${p.targets.length - 5} more)` : ''}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* External (warning) tier */}
      {externalAttempted && (
        <div>
          <CoverageLine detail={externalRun!.detail} partial={partial} />
          {externalBrokenCount === 0 ? (
            <p className="text-[13px] font-body text-green-700 dark:text-green-400">No broken external links found.</p>
          ) : (
            <div>
              <p className="text-[13px] font-body font-semibold text-amber-600 dark:text-amber-400">
                {TYPE_LABEL[EXTERNAL_TYPE]}: {externalBrokenCount}
              </p>
              {(externalPages.get(EXTERNAL_TYPE) ?? []).length > 0 && (
                <ul className="mt-1 space-y-1">
                  {(externalPages.get(EXTERNAL_TYPE) ?? []).slice(0, 25).map((p, i) => (
                    <li key={i} className="text-[12px] font-body text-navy/60 dark:text-white/60">
                      <span className="break-all">{p.url}</span>
                      {p.targets.length > 0 && (
                        <span className="text-navy/40 dark:text-white/40">
                          {' '}→ {p.targets.slice(0, 5).join(', ')}
                          {p.targets.length > 5 ? ` (+${p.targets.length - 5} more)` : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/BrokenLinksSection.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/site-audit/BrokenLinksSection.tsx components/site-audit/BrokenLinksSection.test.tsx
git commit -m "feat(ui): BrokenLinksSection external warning tier + coverage line + clean-state handling"
```

---

### Task 7: Docs — env vars + stale CLAUDE.md line

**Files:**
- Modify: `.claude/skills/er-seo-tools-config-and-flags/SKILL.md`
- Modify: `CLAUDE.md`

**Interfaces:** none (docs-only).

- [ ] **Step 1: Document the three new env vars**

In `.claude/skills/er-seo-tools-config-and-flags/SKILL.md`, in the broken-link env table (near the existing `BROKEN_LINK_MAX_CHECKS`/`BROKEN_LINK_HOST_DELAY_MS`/`BROKEN_LINK_CONCURRENCY` rows), add:

```
| BROKEN_LINK_EXTERNAL_MAX_CHECKS | 300 | Max distinct external targets verified per live-scan run. **0 disables external verification entirely** (no-deploy kill switch; parsed via parseNonNegativeInt). |
| BROKEN_LINK_EXTERNAL_TIMEOUT_MS | 8000 | Per-request HEAD timeout for external checks (shorter than the 10s internal default). |
| BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS | 300000 | Soft wall-clock cap on the external pass; further clamped by remaining job time (JOB_TIMEOUT_MS − elapsed − 60s reserve). Overflow → run status 'partial'. |
```

- [ ] **Step 2: Fix the stale "externals not checked in v1" line in CLAUDE.md**

In `CLAUDE.md`, update the C6 broken-link description and the `link-harvest.ts`/`broken-link-check.ts` key-file lines that say externals are "harvested but NOT checked in v1" / "externals harvested but not checked in v1" to reflect that external links/images are now verified HEAD-only (404/410/5xx = broken, 401/403/405/429 = unconfirmed) under a separate cap `BROKEN_LINK_EXTERNAL_MAX_CHECKS` and a remaining-time budget, emitting `broken_external_links` (warning). (Search: `rg "external" CLAUDE.md | rg -i "not.*check|v1"`.)

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/er-seo-tools-config-and-flags/SKILL.md CLAUDE.md
git commit -m "docs: document external-link verification env vars + update stale CLAUDE.md v1 note"
```

---

## Final gate (before PR)

Run all three, all must be green:

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```

Then open the PR (`feat/external-link-verification` → `main`), record the gate output in the body, merge when gate-green (autonomous per change-control rule 1), deploy (`ssh seo@144.126.213.242 "~/deploy.sh"` — no migration; env vars are optional with safe defaults, so no server `.env` change is required before deploy), then prod-verify and run the tracker/handoff ritual.

**Prod verification (external-link-specific):** trigger a `seoIntent` audit on a real client site with known outbound links (e.g. manhattanschool.edu), wait for `complete` + the `broken-link-verify` job, then check the live-scan run's findings for a `broken_external_links` run finding and confirm `BrokenLinksSection` renders the warning tier + coverage line. The canary (proway.erstaging.site, noindex) still exercises the harvest→verify plumbing but has few externals.

## Self-Review notes (author)

- **Spec coverage:** cap (T4) · warning severity (T3) · anti-bot→unconfirmed (T2 resolver) · HEAD-only + GET-never test (T2) · remaining-time budget + failure isolation (T4) · split emit + per-pass confidence + zero-count finding (T3+T5) · harvest-truncation scoped per pass (T4/T5) · kill switch via parseNonNegativeInt (T1/T4) · UI warning tier + partial-clean gap (T6) · env docs + stale CLAUDE.md (T7). All spec sections mapped.
- **Type consistency:** `resolveExternal(url, timeoutMs)` (T4) matches `resolveExternalHead(url, deps?, timeoutMs?)` (T2); `severity`/`alwaysEmitRunTypes` (T3) consumed verbatim in T5; `externalAttempted`/`externalCapped`/`externalHarvestTruncated` produced in T4, consumed in T5.
- **No placeholders** except the DB-seed `id = ...` lines in T4 tests, which carry an explicit implementer note to reuse the file's existing seeding pattern (DB-backed fixtures can't be inlined without duplicating ~40 lines of the file's helpers).
