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

### Task 3: Mapper — external type + per-call severity

**Files:**
- Modify: `lib/findings/broken-link-mapper.ts`
- Test: `lib/findings/broken-link-mapper.test.ts`

**Interfaces:**
- Consumes: `BrokenTarget` (kind union already includes `'external-link'`), `runFindingKey`, `pageFindingKey`, `normalizeFindingUrl`.
- Produces: `mapBrokenLinkFindings(broken, deps)` where `BrokenLinkMapDeps` gains ONE optional field:
  - `severity?: 'critical' | 'warning'` (default `'critical'` — internal callers unchanged).
  - `TYPE_OF['external-link']` now maps to `'broken_external_links'` (was `null`).
- **No zero-count emission** — the mapper still emits a type's findings only when that type has broken targets (byte-unchanged behavior). External coverage/partial transparency is handled by the UI via `run.status` (Task 6), NOT a zero-count finding (avoids the `priority.service` count-0 inflation Codex found).

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
    })
    const run = out.find((f) => f.scope === 'run')!
    expect(run.type).toBe('broken_external_links')
    expect(run.severity).toBe('warning')
    expect(run.count).toBe(1)
    expect(out.some((f) => f.scope === 'page' && f.type === 'broken_external_links')).toBe(true)
  })

  it('emits nothing when there are no broken external targets (no zero-count finding)', () => {
    const out = mapBrokenLinkFindings([], {
      runId: 'R', ensurePage: makeEnsure(), affectedComplete: true,
      confidence: { ...conf, checked: 12, unconfirmed: 3 }, severity: 'warning',
    })
    expect(out).toHaveLength(0)
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
  return findings
}
```

> The `for (const [type, targets] of byType)` loop is unchanged from today except the `severity` variable replaces the hardcoded `'critical'` at the two push sites. No zero-count emission — an empty `broken` array yields `[]`.

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
- Produces (module-local, consumed by Task 5): the variables `externalBroken: BrokenTarget[]`, `externalChecked`, `externalUnconfirmed`, `externalCapped`, `externalHarvestTruncated`.
- Extends `VerifyDeps` with a REQUIRED field `resolveExternal: (url: string, timeoutMs: number) => Promise<ResolveResult>`; `productionDeps` provides it.

**This task's tests assert CALL BEHAVIOR only** (was `resolveExternal` called / not called; did the job resolve without throwing; kill switch). Findings-emission assertions live in **Task 5** (Codex plan-#1) — the external mapper call is wired there, so a findings assertion here would be red at this commit.

- [ ] **Step 1: Write the failing tests**

Append to `lib/jobs/handlers/broken-link-verify.test.ts`. First add a small external seed helper next to the existing `seed()` (reuses `DOMAIN` + the `harvestedLink.createMany` pattern):

```ts
// External-link seed: N distinct external targets, each linked from one source page on DOMAIN.
async function seedExternal(targets: { targetUrl: string; sourcePageUrl?: string }[]) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })
  if (targets.length)
    await prisma.harvestedLink.createMany({
      data: targets.map((t) => ({
        siteAuditId: sa.id, targetUrl: t.targetUrl, kind: 'external-link',
        sourcePageUrl: t.sourcePageUrl ?? 'https://c6blv.example.com/a',
      })),
    })
  return sa.id
}
```

Then a controllable-clock describe (Codex plan-#3/#4 — advance `now` explicitly, never a call-count clock):

```ts
describe('runBrokenLinkVerify — external verification (call behavior)', () => {
  it('calls resolveExternal for each external target', async () => {
    const id = await seedExternal([
      { targetUrl: 'https://ext.example/dead' },
      { targetUrl: 'https://ext.example/live' },
    ])
    const seen: string[] = []
    const deps: VerifyDeps = {
      resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      resolveExternal: async (url) => { seen.push(url); return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false } },
      now: () => 0, sleep: async () => {},
    }
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    expect(seen.sort()).toEqual(['https://ext.example/dead', 'https://ext.example/live'])
  })

  it('kill switch: BROKEN_LINK_EXTERNAL_MAX_CHECKS=0 never calls resolveExternal', async () => {
    const prev = process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS
    process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS = '0'
    try {
      const id = await seedExternal([{ targetUrl: 'https://ext.example/x' }])
      const seen: string[] = []
      const deps: VerifyDeps = {
        resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
        resolveExternal: async (url) => { seen.push(url); return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false } },
        now: () => 0, sleep: async () => {},
      }
      await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
      expect(seen).toHaveLength(0)
    } finally {
      if (prev === undefined) delete process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS
      else process.env.BROKEN_LINK_EXTERNAL_MAX_CHECKS = prev
    }
  })

  it('no remaining time before the external pass: resolveExternal is never called, job resolves', async () => {
    const id = await seedExternal([{ targetUrl: 'https://ext.example/dead' }])
    let now = 0
    const seen: string[] = []
    const deps: VerifyDeps = {
      // The internal pass runs first; advance the clock past (JOB_TIMEOUT_MS - SAFETY_RESERVE_MS)
      // inside the internal resolve so the external budget computes <= 0.
      resolve: async (url) => { now = 850_001; return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false } },
      resolveExternal: async (url) => { seen.push(url); return { result: 'broken', finalUrl: url, status: 404, hops: 0, chain: [], tooManyRedirects: false } },
      now: () => now, sleep: async () => {},
    }
    // Seed one internal target too so the internal `resolve` runs and advances the clock.
    await prisma.harvestedLink.create({ data: { siteAuditId: id, targetUrl: 'https://c6blv.example.com/i', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a' } })
    await expect(runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)).resolves.toBeUndefined()
    expect(seen).toHaveLength(0) // budget <= 0 -> external pass skipped
  })

  it('mid-pass budget exhaustion launches only a prefix, job still resolves', async () => {
    // Pin concurrency to 1 so the budget-trip point is deterministic: with N workers
    // all N claim before the first resolveExternal advances the clock.
    const prev = process.env.BROKEN_LINK_CONCURRENCY
    process.env.BROKEN_LINK_CONCURRENCY = '1'
    try {
      const id = await seedExternal([
        { targetUrl: 'https://ext.example/a' }, { targetUrl: 'https://ext.example/b' },
        { targetUrl: 'https://ext.example/c' }, { targetUrl: 'https://ext.example/d' },
      ])
      let now = 0
      const seen: string[] = []
      const deps: VerifyDeps = {
        resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
        // First external check consumes the whole budget; the next claim sees it exceeded and stops.
        resolveExternal: async (url) => { seen.push(url); now += 400_000; return { result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false } },
        now: () => now, sleep: async () => {},
      }
      await expect(runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)).resolves.toBeUndefined()
      expect(seen).toHaveLength(1) // 400_000 > 300_000 budget -> exactly one launched, rest skipped
    } finally {
      if (prev === undefined) delete process.env.BROKEN_LINK_CONCURRENCY
      else process.env.BROKEN_LINK_CONCURRENCY = prev
    }
  })

  it('a throwing resolveExternal does not reject the verifier (failure isolation)', async () => {
    const id = await seedExternal([{ targetUrl: 'https://ext.example/boom' }])
    const deps: VerifyDeps = {
      resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      resolveExternal: async () => { throw new Error('transport blew up') },
      now: () => 0, sleep: async () => {},
    }
    await expect(runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)).resolves.toBeUndefined()
  })
})
```

> Implementer note: DB-backed — needs `DATABASE_URL="file:./local-dev.db"`. The mid-pass test pins `BROKEN_LINK_CONCURRENCY=1` and makes the first external check consume 400_000 ms (> the 300_000 default `EXTERNAL_TIME_BUDGET`), so exactly one target launches before the next claim sees the budget exceeded. `jobStartedAt`/`externalStartedAt` are both 0 here (no internal targets seeded to advance the clock), so `externalDeadlineMs = min(300_000, 900_000 - 0 - 60_000) = 300_000`.

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
          const norm = normalizeFindingUrl(t.targetUrl)
          let host = ''
          try { host = new URL(t.targetUrl).hostname } catch {
            extCache.set(norm, unconfirmedResult()); continue
          }
          // Failure isolation (Codex plan-#5): wrap BOTH throttle.wait and resolveExternal
          // so a throw anywhere degrades this one target to unconfirmed, never rejecting the pool.
          try {
            await throttle.wait(host)
            extCache.set(norm, await deps.resolveExternal(t.targetUrl, timeout))
          } catch {
            extCache.set(norm, unconfirmedResult())
          }
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
Expected: PASS — all existing tests (internal/score/validation) + the 5 new call-behavior tests. These assert only `resolveExternal` call behavior + that the job resolves, NOT emitted findings, so they are fully green at this commit. The existing "does not count external-link targets as broken" test (L67) also still passes here — externals are resolved into `externalBroken` but NOT yet emitted (emission is Task 5), so the run still has 0 external findings. Task 5 flips that test.

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
- Consumes: Task 4's `externalBroken`, `externalChecked`, `externalUnconfirmed`, `externalCapped`, `externalHarvestTruncated`.
- Produces: `broken_external_links` findings in the live-scan `CrawlRun` (only when there are broken external targets); `run.status` reflects external capping/truncation.

- [ ] **Step 1: Write/adjust the failing tests**

First, **flip the existing "does not count external-link targets as broken" test** (near L67) — its premise is now false. Rename and change its assertion to prove externals ARE verified and counted:

```ts
it('counts external-link targets as broken_external_links (warning)', async () => {
  const id = await seed([
    { targetUrl: 'https://other.com/x', kind: 'external-link', sourcePageUrl: 'https://c6blv.example.com/a' },
  ])
  await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, depsFor(new Set(['https://other.com/x'])))
  const run = await liveRun(id)
  const ext = run!.findings.find((f) => f.scope === 'run' && f.type === 'broken_external_links')
  expect(ext?.count).toBe(1)
  expect(ext?.severity).toBe('warning')
})
```
(This relies on `depsFor`'s `resolveExternal` returning `broken` for URLs in `brokenSet`, added in Task 4 Step 3.)

Then add findings-level tests to the external describe:

```ts
it('emits broken_external_links only for broken targets, none when clean', async () => {
  const cleanId = await seedExternal([{ targetUrl: 'https://ext.example/live' }])
  await runBrokenLinkVerify({ siteAuditId: cleanId, domain: DOMAIN }, depsFor(new Set())) // nothing broken
  const cleanRun = await liveRun(cleanId)
  expect(cleanRun!.findings.some((f) => f.type === 'broken_external_links')).toBe(false) // NO zero-count finding
})

it('internal-link verification is unchanged when a broken external is present', async () => {
  const id = await seed([
    { targetUrl: 'https://c6blv.example.com/int-dead', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a' },
    { targetUrl: 'https://other.com/ext-dead', kind: 'external-link', sourcePageUrl: 'https://c6blv.example.com/a' },
  ])
  await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, depsFor(new Set(['https://c6blv.example.com/int-dead', 'https://other.com/ext-dead'])))
  const run = await liveRun(id)
  const internal = run!.findings.find((f) => f.scope === 'run' && f.type === 'broken_internal_links')
  expect(internal?.severity).toBe('critical')
  expect(internal?.count).toBe(1)
  const ext = run!.findings.find((f) => f.scope === 'run' && f.type === 'broken_external_links')
  expect(ext?.severity).toBe('warning')
})
```

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: the flipped test + the two new findings tests FAIL (external emission not wired yet).

- [ ] **Step 2: Wire the second mapper call + partial status**

In `runBrokenLinkVerify`, replace the existing single broken-findings call and the findings array assembly (the external call is **plain** — no `alwaysEmitRunTypes`; an empty `externalBroken` yields no findings):

```ts
const brokenFindings = mapBrokenLinkFindings(broken, {
  runId, ensurePage, affectedComplete: !capped && !harvestTruncated,
  confidence: { checked, broken: broken.length, unconfirmed, capped, harvestTruncated },
})
const externalFindings = mapBrokenLinkFindings(externalBroken, {
  runId, ensurePage, affectedComplete: !externalCapped && !externalHarvestTruncated,
  confidence: { checked: externalChecked, broken: externalBroken.length, unconfirmed: externalUnconfirmed, capped: externalCapped, harvestTruncated: externalHarvestTruncated },
  severity: 'warning',
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
- Produces: a warning-tier external block (only when external links are broken); per-tier coverage/partial lines derived from each finding's detail; a `run.status`-based partial note on the clean state.

- [ ] **Step 1: Write the failing tests**

Create `components/site-audit/BrokenLinksSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BrokenLinksSection, type BrokenLinksRun } from './BrokenLinksSection'

afterEach(cleanup)

const runFinding = (type: string, count: number, detail: object = {}) =>
  ({ scope: 'run', type, count, url: null, detail: JSON.stringify(detail) })
const pageFinding = (type: string, url: string, targets: string[]) =>
  ({ scope: 'page', type, count: targets.length, url, detail: JSON.stringify({ brokenTargetUrls: targets }) })

describe('BrokenLinksSection — external links', () => {
  it('shows not-verified when run is null', () => {
    render(<BrokenLinksSection run={null} />)
    expect(screen.getByText(/not yet verified/i)).toBeTruthy()
  })

  it('shows plain verified-clean when everything clean and complete', () => {
    render(<BrokenLinksSection run={{ status: 'complete', findings: [] }} />)
    expect(screen.getByText(/no broken links or images found/i)).toBeTruthy()
    expect(screen.queryByText(/partial/i)).toBeNull()
  })

  it('appends a partial note to the clean state when run.status is partial', () => {
    render(<BrokenLinksSection run={{ status: 'partial', findings: [] }} />)
    expect(screen.getByText(/no broken links or images found/i)).toBeTruthy()
    expect(screen.getByText(/partial/i)).toBeTruthy()
  })

  it('renders the external warning block (amber) when external links are broken', () => {
    const run: BrokenLinksRun = {
      status: 'complete',
      findings: [
        runFinding('broken_external_links', 2, { checked: 5, unconfirmed: 1 }),
        pageFinding('broken_external_links', 'https://site.example/a', ['https://out.example/dead']),
      ],
    }
    render(<BrokenLinksSection run={run} />)
    const label = screen.getByText(/Broken external links/i)
    expect(label.className).toMatch(/amber/) // warning tier, not red
    expect(screen.getByText(/https:\/\/site\.example\/a/)).toBeTruthy()
  })

  it('renders both tiers when internal and external are both broken', () => {
    const run: BrokenLinksRun = {
      status: 'complete',
      findings: [
        runFinding('broken_internal_links', 1, { checked: 3 }),
        runFinding('broken_external_links', 1, { checked: 2 }),
      ],
    }
    render(<BrokenLinksSection run={run} />)
    expect(screen.getByText(/Broken internal links/i)).toBeTruthy()
    expect(screen.getByText(/Broken external links/i)).toBeTruthy()
  })

  it('renders only the internal tier when internal broken but external clean', () => {
    const run: BrokenLinksRun = {
      status: 'complete',
      findings: [runFinding('broken_internal_links', 1, { checked: 3 })],
    }
    render(<BrokenLinksSection run={run} />)
    expect(screen.getByText(/Broken internal links/i)).toBeTruthy()
    expect(screen.queryByText(/Broken external links/i)).toBeNull()
  })

  it('derives per-tier partial from the finding detail, not global run.status', () => {
    // External capped (its detail says so); internal complete. Only the external tier shows partial.
    const run: BrokenLinksRun = {
      status: 'partial',
      findings: [
        runFinding('broken_internal_links', 1, { checked: 3, capped: false, harvestTruncated: false }),
        runFinding('broken_external_links', 1, { checked: 2, capped: true, harvestTruncated: false }),
      ],
    }
    render(<BrokenLinksSection run={run} />)
    // Exactly one "partial" note (the external tier's), not one on the internal tier too.
    expect(screen.getAllByText(/partial/i)).toHaveLength(1)
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

// Per-tier partial (Codex plan-#6): derived from THIS finding's detail, not global run.status.
function CoverageLine({ detail }: { detail: string | null }) {
  const conf = parseDetail(detail)
  const checked = typeof conf.checked === 'number' ? conf.checked : null
  const unconfirmed = typeof conf.unconfirmed === 'number' ? conf.unconfirmed : 0
  const partial = conf.capped === true || conf.harvestTruncated === true
  if (checked === null && unconfirmed === 0 && !partial) return null
  return (
    <p className="text-[12px] font-body text-navy/45 dark:text-white/45 mb-3">
      {checked !== null && <>Checked {checked} unique target{checked === 1 ? '' : 's'}. </>}
      {unconfirmed > 0 && <>{unconfirmed} could not be confirmed (timeout/blocked) and are excluded. </>}
      {partial && <>Results are partial (capped or budget/harvest-truncated).</>}
    </p>
  )
}

function BrokenGroup({ label, color, findingCount, pages }: {
  label: string; color: string; findingCount: number; pages: { url: string; targets: string[] }[]
}) {
  return (
    <div>
      <p className={`text-[13px] font-body font-semibold ${color}`}>{label}: {findingCount}</p>
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

  // We only ever emit run findings with count > 0 (no zero-count coverage findings), so
  // presence == "there are broken items of this type".
  const internalRunScope = run.findings.filter((f) => f.scope === 'run' && f.count > 0 && BROKEN_TYPES.has(f.type))
  const externalRun = run.findings.find((f) => f.scope === 'run' && f.count > 0 && f.type === EXTERNAL_TYPE)
  const hasInternal = internalRunScope.length > 0
  const hasExternal = !!externalRun

  if (!hasInternal && !hasExternal) {
    // Clean. The only coverage signal available here is the global run.status (there is no
    // finding to read a per-tier detail from), so surface partial from it.
    return (
      <Card>
        <p className="text-[13px] font-body text-green-700 dark:text-green-400">
          Verified — no broken links or images found.
          {run.status === 'partial' && (
            <span className="text-navy/45 dark:text-white/45">{' '}Some links could not be fully checked — results are partial.</span>
          )}
        </p>
      </Card>
    )
  }

  const internalPages = pagesForTypes(run, (t) => BROKEN_TYPES.has(t))
  const externalPages = pagesForTypes(run, (t) => t === EXTERNAL_TYPE)

  return (
    <Card>
      {hasInternal && (
        <div className="mb-4">
          <CoverageLine detail={internalRunScope[0].detail} />
          <div className="space-y-4">
            {internalRunScope.map((f) => (
              <BrokenGroup key={f.type} label={TYPE_LABEL[f.type] ?? f.type} color="text-red-600 dark:text-red-400"
                findingCount={f.count} pages={internalPages.get(f.type) ?? []} />
            ))}
          </div>
        </div>
      )}
      {hasExternal && (
        <div>
          <CoverageLine detail={externalRun!.detail} />
          <BrokenGroup label={TYPE_LABEL[EXTERNAL_TYPE]} color="text-amber-600 dark:text-amber-400"
            findingCount={externalRun!.count} pages={externalPages.get(EXTERNAL_TYPE) ?? []} />
        </div>
      )}
    </Card>
  )
}
```

> `BROKEN_TYPES` stays internal-only (critical). The external type is handled separately as a warning tier. `CoverageLine` no longer takes a `partial` prop — it derives partial from the finding's own `capped`/`harvestTruncated` detail (per-tier). The clean-state partial note is the one place global `run.status` is used (no finding detail exists there).

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/BrokenLinksSection.test.tsx`
Expected: PASS (7 tests).

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

Then open the PR (`feat/external-link-verification` → `main`), record the gate output in the body, merge when gate-green (autonomous per change-control rule 1), deploy (`ssh $PROD_SSH "~/deploy.sh"` — no migration; env vars are optional with safe defaults, so no server `.env` change is required before deploy), then prod-verify and run the tracker/handoff ritual.

**Prod verification (external-link-specific):** trigger a `seoIntent` audit on a real client site with known outbound links (e.g. manhattanschool.edu), wait for `complete` + the `broken-link-verify` job, then check the live-scan run's findings for a `broken_external_links` run finding and confirm `BrokenLinksSection` renders the warning tier + coverage line. The canary (proway.erstaging.site, noindex) still exercises the harvest→verify plumbing but has few externals.

## Self-Review notes (author)

- **Spec coverage:** cap (T4) · warning severity (T3) · anti-bot→unconfirmed (T2 resolver) · HEAD-only + GET-never test (T2) · remaining-time budget + failure isolation (T4) · split emit + per-pass confidence (T3+T5) · NO zero-count finding — coverage via `run.status` (T5+T6, resolves Codex plan-#7) · harvest-truncation scoped per pass (T4/T5) · kill switch via parseNonNegativeInt (T1/T4) · UI warning tier + per-tier partial + clean-state partial note (T6) · env docs + stale CLAUDE.md (T7). All spec sections mapped.
- **Type consistency:** `resolveExternal(url, timeoutMs)` (T4) matches `resolveExternalHead(url, deps?, timeoutMs?)` (T2); `severity` (T3) consumed in T5; `externalCapped`/`externalHarvestTruncated`/`externalChecked`/`externalUnconfirmed`/`externalBroken` produced in T4, consumed in T5. `alwaysEmitRunTypes` was removed after plan review (no zero-count emission).
- **Codex plan-review fixes applied:** #1 findings assertions moved to T5 (T4 tests are call-behavior only) · #2 concrete `seedExternal` helper · #3 controllable `let now` clock · #4 mid-pass budget test (`BROKEN_LINK_CONCURRENCY=1`) · #5 catch wraps `throttle.wait`+`resolveExternal` · #6 per-tier partial from detail · #7/#8 dropped zero-count finding entirely (no downstream priority pollution) · #9 mixed-combination UI tests · #12 all `VerifyDeps` fixtures get `resolveExternal`.
- **No placeholders.** T4/T5 tests use the concrete `seed`/`seedExternal`/`depsFor`/`liveRun` helpers from the existing test file.
