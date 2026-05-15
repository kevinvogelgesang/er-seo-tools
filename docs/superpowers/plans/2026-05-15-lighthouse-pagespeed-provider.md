# Lighthouse PageSpeed-Insights Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `LIGHTHOUSE_PROVIDER=pagespeed` as the new production default; keep `local` as a reversible fallback. Validate whether fei.edu finishes under PSI — if yes, we've isolated the V8 OOM to local Lighthouse execution.

**Architecture:** Introduce a 3-value provider selector (`pagespeed | local | off`) read from `LIGHTHOUSE_PROVIDER`. The PSI client is a pure HTTP function in a new module — no puppeteer dependency. `runLighthouse()` becomes a thin facade that dispatches to local or PSI. The audit runner branches navigation responsibility: local-LH owns `page.goto`; PSI / off paths own it themselves. To keep the new module graph acyclic, `extractSummary()` moves to a new `lib/ada-audit/lighthouse-summary.ts` leaf module and `RunLighthouseResult` moves to `lighthouse-types.ts` — both PSI and local then import from these leaves without ever depending on each other.

**Tech Stack:** Next.js 15 · TypeScript · vitest · global `fetch` for the HTTP client

**Companion spec:** `docs/superpowers/specs/2026-05-15-lighthouse-pagespeed-provider-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/ada-audit/lighthouse-types.ts` | Modify | Add `RunLighthouseResult` (relocated from `lighthouse-runner.ts`) |
| `lib/ada-audit/lighthouse-summary.ts` | Create | `extractSummary(lhr)` + CWV thresholds + accessibility extractor. Leaf module — imports `lighthouse-types` only. |
| `lib/ada-audit/lighthouse-summary.test.ts` | Create | Relocates the existing 10 `extractSummary` tests from `lighthouse-runner.test.ts` |
| `lib/ada-audit/lighthouse-provider.ts` | Create | `LighthouseProvider` type, `getLighthouseProvider()`, `lighthouseOwnsNavigation()` |
| `lib/ada-audit/lighthouse-provider.test.ts` | Create | 5 selector tests + 1 ownership test |
| `lib/ada-audit/lighthouse-pagespeed.ts` | Create | `runPageSpeedInsights(url)`: fetch PSI, error-map, run result through `extractSummary` from the new summary module |
| `lib/ada-audit/lighthouse-pagespeed.test.ts` | Create | 10 tests: success + URL shape + key on/off + 429 / 400 / 5xx / timeout / malformed-JSON / missing-lighthouseResult |
| `lib/ada-audit/lighthouse-runner.ts` | Modify | `runLighthouse()` becomes a facade that dispatches to local or PSI. Local impl is `runLocalLighthouse(url, page)`. `extractSummary` is removed (moved). `resetCdpAfterLighthouse` stays. |
| `lib/ada-audit/lighthouse-runner.test.ts` | Modify | Remove the relocated tests; if no tests remain, delete the file. (Provider dispatch is covered indirectly via the PSI + provider suites; not worth a puppeteer-mocked runner test for a 5-line facade.) |
| `lib/ada-audit/runner.ts` | Modify | Branch on `lighthouseOwnsNavigation()` — when false, own navigation; when true, let LH own it |
| `ecosystem.config.js` | Modify | Add `LIGHTHOUSE_PROVIDER=pagespeed`, `PAGESPEED_TIMEOUT_MS=90000` |
| `.env.example` | Modify | Add `LIGHTHOUSE_PROVIDER`, `PAGESPEED_API_KEY` |
| `CLAUDE.md` | Modify | One-line note about the provider abstraction in the ADA audit section |
| `docs/SERVER_SETUP.md` | Modify | Env-var table entries; deploy step to set `PAGESPEED_API_KEY` in `.env` before first deploy |

### Module graph after this PR (no cycles)

```
lighthouse-types ───────────┬─── lighthouse-summary ───┬─── lighthouse-pagespeed ───┐
                            │                          │                            │
                            │                          └────────────────────────────┴─── lighthouse-runner
                            │                                                       │
                            └───────────────────────────────────────────────────────┘
lighthouse-provider (leaf; reads env only)──────────────────────────────────────────┘
```

`lighthouse-types` and `lighthouse-provider` are leaves. `lighthouse-summary` imports only `lighthouse-types`. `lighthouse-pagespeed` imports `lighthouse-summary` + `lighthouse-types`. `lighthouse-runner` imports everything below it. **No edge points "up"** — no circular imports.

---

### Task 1: Branch + working tree

**Files:** none.

- [ ] **Step 1: Pull latest main**

```bash
git checkout main && git pull origin main
```

- [ ] **Step 2: Create the feature branch (new worktree expected per skill)**

If executing via subagent-driven-development, use `EnterWorktree` with name `feat-lighthouse-pagespeed`. If running inline, `git checkout -b feat/lighthouse-pagespeed-provider`.

- [ ] **Step 3: Move the design + plan docs into the new branch tree**

The spec and plan were drafted in the `fix-audit-stability` worktree filesystem. Move both files into the new worktree:

```bash
mv /Users/kevin/enrollment-resources/Claude/er-seo-tools/.claude/worktrees/fix-audit-stability/docs/superpowers/specs/2026-05-15-lighthouse-pagespeed-provider-design.md \
   docs/superpowers/specs/

mv /Users/kevin/enrollment-resources/Claude/er-seo-tools/.claude/worktrees/fix-audit-stability/docs/superpowers/plans/2026-05-15-lighthouse-pagespeed-provider.md \
   docs/superpowers/plans/
```

- [ ] **Step 4: Commit docs**

```bash
git add docs/superpowers/specs/2026-05-15-lighthouse-pagespeed-provider-design.md docs/superpowers/plans/2026-05-15-lighthouse-pagespeed-provider.md
git commit -m "docs: spec + plan for PageSpeed Insights Lighthouse provider"
```

---

### Task 2: TDD `LighthouseProvider` type + `getLighthouseProvider()` selector

**Files:**
- Create: `lib/ada-audit/lighthouse-provider.ts`
- Create: `lib/ada-audit/lighthouse-provider.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/ada-audit/lighthouse-provider.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getLighthouseProvider, lighthouseOwnsNavigation } from './lighthouse-provider'

const ORIG = { ...process.env }

beforeEach(() => {
  delete process.env.LIGHTHOUSE_PROVIDER
  delete process.env.LIGHTHOUSE_ENABLED
})
afterEach(() => {
  process.env = { ...ORIG }
})

describe('getLighthouseProvider', () => {
  it('returns "off" when LIGHTHOUSE_ENABLED=false regardless of provider', () => {
    process.env.LIGHTHOUSE_ENABLED = 'false'
    process.env.LIGHTHOUSE_PROVIDER = 'pagespeed'
    expect(getLighthouseProvider()).toBe('off')
  })

  it('returns "pagespeed" when LIGHTHOUSE_PROVIDER=pagespeed', () => {
    process.env.LIGHTHOUSE_PROVIDER = 'pagespeed'
    expect(getLighthouseProvider()).toBe('pagespeed')
  })

  it('returns "pagespeed" when LIGHTHOUSE_PROVIDER=PAGESPEED (case-insensitive)', () => {
    process.env.LIGHTHOUSE_PROVIDER = 'PAGESPEED'
    expect(getLighthouseProvider()).toBe('pagespeed')
  })

  it('returns "local" as the default when LIGHTHOUSE_PROVIDER is unset', () => {
    expect(getLighthouseProvider()).toBe('local')
  })

  it('falls back to "local" for unknown values (safer default than off)', () => {
    process.env.LIGHTHOUSE_PROVIDER = 'garbage'
    expect(getLighthouseProvider()).toBe('local')
  })
})

describe('lighthouseOwnsNavigation', () => {
  it('returns true only when provider is local', () => {
    process.env.LIGHTHOUSE_PROVIDER = 'local'
    expect(lighthouseOwnsNavigation()).toBe(true)

    process.env.LIGHTHOUSE_PROVIDER = 'pagespeed'
    expect(lighthouseOwnsNavigation()).toBe(false)

    process.env.LIGHTHOUSE_ENABLED = 'false'
    expect(lighthouseOwnsNavigation()).toBe(false)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/lighthouse-provider.test.ts
```

Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the module**

Create `lib/ada-audit/lighthouse-provider.ts`:

```typescript
// lib/ada-audit/lighthouse-provider.ts
//
// Provider selection for the Lighthouse data source. Three providers:
//   - 'pagespeed' — Google PageSpeed Insights v5 over HTTPS (default in prod)
//   - 'local'     — local puppeteer-core + lighthouse package (fallback)
//   - 'off'       — skip Lighthouse entirely
//
// LIGHTHOUSE_ENABLED=false short-circuits to 'off' regardless of provider —
// preserves the existing kill-switch behavior.

export type LighthouseProvider = 'pagespeed' | 'local' | 'off'

export function getLighthouseProvider(): LighthouseProvider {
  if ((process.env.LIGHTHOUSE_ENABLED ?? 'true') === 'false') return 'off'
  const raw = (process.env.LIGHTHOUSE_PROVIDER ?? 'local').toLowerCase()
  if (raw === 'pagespeed' || raw === 'local' || raw === 'off') return raw
  return 'local'   // unknown values fall back to local (safer than silently disabling)
}

/**
 * True when the chosen provider is responsible for calling `page.goto()`
 * during the audit. Local Lighthouse owns navigation; PSI and 'off' do not,
 * so the caller (runAxeAudit) must navigate itself before running axe.
 */
export function lighthouseOwnsNavigation(): boolean {
  return getLighthouseProvider() === 'local'
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/lighthouse-provider.test.ts
```

Expected: 6/6 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/lighthouse-provider.ts lib/ada-audit/lighthouse-provider.test.ts
git commit -m "feat(ada-audit): LighthouseProvider type + selector"
```

---

### Task 3: Extract `extractSummary` into `lighthouse-summary.ts`; move `RunLighthouseResult` to `lighthouse-types.ts`

**Why this task exists:** the PSI client (Task 4) needs `extractSummary` to map `response.lighthouseResult` into a `LighthouseSummary`. The current `extractSummary` lives in `lighthouse-runner.ts` alongside the local Lighthouse implementation. If PSI imports from `lighthouse-runner.ts`, and `lighthouse-runner.ts` later imports from `lighthouse-pagespeed.ts` (Task 5's facade), we get a circular module dependency. The circular import would probably work at runtime (the bindings aren't used during module init) but is brittle — refactor it away now.

**Files:**
- Modify: `lib/ada-audit/lighthouse-types.ts` — add `RunLighthouseResult`
- Create: `lib/ada-audit/lighthouse-summary.ts` — house `extractSummary` + private helpers
- Create: `lib/ada-audit/lighthouse-summary.test.ts` — relocate the existing 10 tests
- Modify: `lib/ada-audit/lighthouse-runner.ts` — remove relocated code, import from new modules
- Delete: `lib/ada-audit/lighthouse-runner.test.ts` (after relocating its content). If no tests remain in `lighthouse-runner.ts` paths, the file should be removed rather than left empty.

- [ ] **Step 1: Add `RunLighthouseResult` to `lighthouse-types.ts`**

Append to `lib/ada-audit/lighthouse-types.ts`:

```typescript
/**
 * Common shape returned by every Lighthouse provider (local, pagespeed, off).
 * `summary` is null when the provider was off, when PSI couldn't produce a
 * result, or when local LH failed. `error` carries the human-readable reason
 * when summary is null but the run was attempted.
 */
export interface RunLighthouseResult {
  summary: LighthouseSummary | null
  error?: string
}
```

- [ ] **Step 2: Create `lighthouse-summary.ts`**

Cut the following from `lighthouse-runner.ts` and paste into a new `lib/ada-audit/lighthouse-summary.ts`:

- The `CwvStatus` threshold helpers (`lcpStatus`, `clsStatus`, `tbtStatus`)
- The `Lhr` type alias
- The `TOP_FAILURE_CATEGORIES` const
- The `extractAccessibility(lhr)` private function
- The `extractSummary(lhr)` exported function

The new file should look like:

```typescript
// lib/ada-audit/lighthouse-summary.ts
//
// Pure extraction from a raw Lighthouse Result (LHR) to the LighthouseSummary
// shape consumed by the UI. Same LHR shape comes from either local Lighthouse
// or PageSpeed Insights, so both providers funnel through this module.

import type {
  LighthouseSummary,
  LighthouseFailure,
  LighthouseCategory,
  LighthouseAccessibility,
  LighthouseA11yAudit,
  LighthouseA11yFailingElement,
  LighthouseA11yGroup,
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

const TOP_FAILURE_CATEGORIES: LighthouseCategory[] = ['performance', 'best-practices']

function extractAccessibility(lhr: Lhr): LighthouseAccessibility {
  // (unchanged — copy verbatim from the current lighthouse-runner.ts body)
  // …
}

export function extractSummary(lhr: Lhr): LighthouseSummary {
  // (unchanged — copy verbatim from the current lighthouse-runner.ts body)
  // …
}
```

(Copy the existing bodies of `extractAccessibility` and `extractSummary` verbatim. They don't need any changes — only their physical location moves.)

- [ ] **Step 3: Relocate the existing test file**

```bash
git mv lib/ada-audit/lighthouse-runner.test.ts lib/ada-audit/lighthouse-summary.test.ts
```

Update the import line at the top of the new test file:

```typescript
import { extractSummary } from './lighthouse-summary'
```

(Was `import { extractSummary } from './lighthouse-runner'`. The other 10 test bodies don't change.)

- [ ] **Step 4: Remove the relocated code from `lighthouse-runner.ts`**

In `lib/ada-audit/lighthouse-runner.ts`:
- Remove the local definitions of `lcpStatus`, `clsStatus`, `tbtStatus`, `extractAccessibility`, `extractSummary`, `TOP_FAILURE_CATEGORIES`, and the `Lhr` type alias.
- Remove the `LighthouseFailure` / `LighthouseAccessibility` / `LighthouseA11yAudit` / `LighthouseA11yFailingElement` / `LighthouseA11yGroup` / `CwvStatus` imports since they're no longer used in this file.
- Remove the local `RunLighthouseResult` interface (replaced by the import from `lighthouse-types`).
- Add the import: `import type { RunLighthouseResult } from './lighthouse-types'`
- Add the import inside the local runner body: `import { extractSummary } from './lighthouse-summary'`

The remaining file should still export `isLighthouseEnabled`, `runLighthouse`, and `resetCdpAfterLighthouse`, and contain the `runLighthouse` body that calls `extractSummary` after a successful local run.

- [ ] **Step 5: Run the test suite**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/
```

Expected: same total count as before this task (the 10 extractSummary tests pass from their new location, no new tests yet), plus the 6 provider tests from Task 2. Build/type check should be clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/lighthouse-types.ts lib/ada-audit/lighthouse-summary.ts lib/ada-audit/lighthouse-summary.test.ts lib/ada-audit/lighthouse-runner.ts
git commit -m "refactor(ada-audit): extract extractSummary into lighthouse-summary leaf module"
```

---

### Task 4: TDD `runPageSpeedInsights()` HTTP client

**Files:**
- Create: `lib/ada-audit/lighthouse-pagespeed.ts`
- Create: `lib/ada-audit/lighthouse-pagespeed.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/ada-audit/lighthouse-pagespeed.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runPageSpeedInsights } from './lighthouse-pagespeed'

const ORIG = { ...process.env }

// Minimal LHR payload matching what extractSummary expects.
const MINIMAL_LHR = {
  categories: {
    performance:      { score: 0.5,  auditRefs: [] },
    accessibility:    { score: 0.9,  auditRefs: [] },
    'best-practices': { score: 0.8,  auditRefs: [] },
  },
  categoryGroups: {},
  audits: {
    'largest-contentful-paint': { numericValue: 2400, score: 0.7 },
    'cumulative-layout-shift':  { numericValue: 0.08, score: 0.9 },
    'total-blocking-time':      { numericValue: 150, score: 0.85 },
  },
}

function mockFetch(response: { ok: boolean; status?: number; body?: unknown; jsonThrows?: boolean }) {
  return vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => {
      if (response.jsonThrows) throw new SyntaxError('Unexpected token < in JSON at position 0')
      return response.body
    },
    text: async () => typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
  }) as unknown as Response)
}

beforeEach(() => {
  delete process.env.PAGESPEED_API_KEY
  delete process.env.PAGESPEED_TIMEOUT_MS
})
afterEach(() => {
  process.env = { ...ORIG }
  vi.unstubAllGlobals()
})

describe('runPageSpeedInsights', () => {
  it('returns summary when PSI returns a valid lighthouseResult', async () => {
    const fetchMock = mockFetch({ ok: true, body: { lighthouseResult: MINIMAL_LHR } })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(result.error).toBeUndefined()
    expect(result.summary?.scores.performance).toBe(50)
    expect(result.summary?.scores.accessibility).toBe(90)
    expect(result.summary?.scores.bestPractices).toBe(80)
  })

  it('requests all three categories with strategy=DESKTOP', async () => {
    const fetchMock = mockFetch({ ok: true, body: { lighthouseResult: MINIMAL_LHR } })
    vi.stubGlobal('fetch', fetchMock)

    await runPageSpeedInsights('https://example.com/')

    const callArg = String(fetchMock.mock.calls[0][0])
    expect(callArg).toContain('strategy=DESKTOP')
    expect(callArg).toContain('category=PERFORMANCE')
    expect(callArg).toContain('category=ACCESSIBILITY')
    expect(callArg).toContain('category=BEST_PRACTICES')
  })

  it('includes API key when PAGESPEED_API_KEY is set', async () => {
    process.env.PAGESPEED_API_KEY = 'test-key-123'
    const fetchMock = mockFetch({ ok: true, body: { lighthouseResult: MINIMAL_LHR } })
    vi.stubGlobal('fetch', fetchMock)

    await runPageSpeedInsights('https://example.com/')

    const callArg = String(fetchMock.mock.calls[0][0])
    expect(callArg).toContain('key=test-key-123')
  })

  it('omits key param when PAGESPEED_API_KEY is unset', async () => {
    const fetchMock = mockFetch({ ok: true, body: { lighthouseResult: MINIMAL_LHR } })
    vi.stubGlobal('fetch', fetchMock)

    await runPageSpeedInsights('https://example.com/')

    const callArg = String(fetchMock.mock.calls[0][0])
    expect(callArg).not.toMatch(/[?&]key=/)
  })

  it('surfaces HTTP 429 as a rate-limit error', async () => {
    const fetchMock = mockFetch({ ok: false, status: 429, body: { error: { message: 'quota' } } })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/rate limit/i)
  })

  it('surfaces HTTP 400 as an unfetchable-URL error', async () => {
    const fetchMock = mockFetch({ ok: false, status: 400, body: { error: { message: 'could not fetch' } } })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/private')

    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/private|blocked|unfetch|HTTP 400/i)
  })

  it('surfaces HTTP 5xx as a server error', async () => {
    const fetchMock = mockFetch({ ok: false, status: 503, body: '' })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/server error|HTTP 5/i)
  })

  it('surfaces a malformed JSON body as a malformed-response error', async () => {
    const fetchMock = mockFetch({ ok: true, jsonThrows: true })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/malformed/i)
  })

  it('surfaces missing lighthouseResult in the body', async () => {
    const fetchMock = mockFetch({ ok: true, body: { somethingElse: true } })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/no lighthouseResult/i)
  })

  it('surfaces an AbortError as a timeout', async () => {
    const fetchMock = vi.fn(async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/timed out/i)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/lighthouse-pagespeed.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the PSI client**

Create `lib/ada-audit/lighthouse-pagespeed.ts`:

```typescript
// lib/ada-audit/lighthouse-pagespeed.ts
//
// Google PageSpeed Insights API v5 client. Returns a RunLighthouseResult
// shaped identically to the local-LH runner so the caller doesn't care
// which provider produced it.
//
// PSI's `response.lighthouseResult` is structurally identical to a
// locally-generated LHR, so we pass it through `extractSummary()` unchanged.

import type { RunLighthouseResult } from './lighthouse-types'
import { extractSummary } from './lighthouse-summary'

const PSI_ENDPOINT = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed'

function buildPsiUrl(targetUrl: string): string {
  const params = new URLSearchParams()
  params.set('url', targetUrl)
  params.set('strategy', 'DESKTOP')
  // category is repeated, not comma-separated, per the v5 spec
  params.append('category', 'PERFORMANCE')
  params.append('category', 'ACCESSIBILITY')
  params.append('category', 'BEST_PRACTICES')
  const key = process.env.PAGESPEED_API_KEY
  if (key) params.set('key', key)
  return `${PSI_ENDPOINT}?${params.toString()}`
}

function mapHttpError(status: number): string {
  if (status === 429) return `PSI rate limit exceeded (HTTP 429). Slow down or add an API key.`
  if (status === 400) return `PSI could not fetch the URL (HTTP 400). The page may be private or blocked.`
  if (status >= 500) return `PSI server error (HTTP ${status}).`
  return `PSI request failed (HTTP ${status}).`
}

export async function runPageSpeedInsights(targetUrl: string): Promise<RunLighthouseResult> {
  const timeoutMs = parsePositiveInt(process.env.PAGESPEED_TIMEOUT_MS, 90_000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(buildPsiUrl(targetUrl), { signal: controller.signal })
    if (!response.ok) {
      return { summary: null, error: mapHttpError(response.status) }
    }
    let json: unknown
    try {
      json = await response.json()
    } catch {
      return { summary: null, error: 'PSI returned malformed response.' }
    }
    const lhr = (json as { lighthouseResult?: unknown }).lighthouseResult
    if (!lhr) {
      return { summary: null, error: 'PSI returned no lighthouseResult.' }
    }
    // extractSummary already handles its own type-permissive parsing.
    return { summary: extractSummary(lhr) }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { summary: null, error: `PSI timed out after ${timeoutMs}ms.` }
    }
    return { summary: null, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/lighthouse-pagespeed.test.ts
```

Expected: 10/10 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/lighthouse-pagespeed.ts lib/ada-audit/lighthouse-pagespeed.test.ts
git commit -m "feat(ada-audit): runPageSpeedInsights PSI v5 client"
```

---

### Task 5: Wire the dispatcher into `runLighthouse()`

**Files:**
- Modify: `lib/ada-audit/lighthouse-runner.ts`

- [ ] **Step 1: Refactor `runLighthouse` to dispatch on provider**

After Task 3, `lighthouse-runner.ts` no longer contains `extractSummary`. Its current `runLighthouse(url, page)` body is the local-LH implementation. Refactor:

1. Rename the existing local body to `runLocalLighthouse(url, page)` (internal function — not exported).
2. Add a new exported `runLighthouse(url, page)` that switches on `getLighthouseProvider()`.

Add at the top of the file:

```typescript
import { getLighthouseProvider } from './lighthouse-provider'
import { runPageSpeedInsights } from './lighthouse-pagespeed'
```

Replace the existing exported `runLighthouse` block with:

```typescript
export async function runLighthouse(url: string, page: Page): Promise<RunLighthouseResult> {
  const provider = getLighthouseProvider()
  if (provider === 'off') return { summary: null }
  if (provider === 'pagespeed') return runPageSpeedInsights(url)
  return runLocalLighthouse(url, page)
}

async function runLocalLighthouse(url: string, page: Page): Promise<RunLighthouseResult> {
  // (the existing body of the previous runLighthouse function, unchanged)
}
```

The dynamic `import('lighthouse')` stays inside `runLocalLighthouse` so PSI-only deployments never load the lighthouse package into memory.

- [ ] **Step 2: Keep `isLighthouseEnabled()` as a thin alias**

`isLighthouseEnabled()` today returns `LIGHTHOUSE_ENABLED !== 'false'`. With the new provider model, `getLighthouseProvider() === 'off'` covers that. Keep `isLighthouseEnabled()` exported for backwards-compat in `runner.ts`, reimplemented as:

```typescript
export const isLighthouseEnabled = () => getLighthouseProvider() !== 'off'
```

- [ ] **Step 3: Run all impacted tests**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/
```

Expected: all tests pass (10 summary + 6 provider + 10 PSI + existing).

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/lighthouse-runner.ts
git commit -m "feat(ada-audit): runLighthouse dispatches local/pagespeed/off"
```

---

### Task 6: Update `runner.ts` navigation flow

**Files:**
- Modify: `lib/ada-audit/runner.ts`

- [ ] **Step 1: Read the current Lighthouse + navigation block**

```bash
sed -n '110,180p' lib/ada-audit/runner.ts
```

The current code is roughly:

```typescript
if (isLighthouseEnabled()) {
  await progress(20, 'Running Lighthouse…')
  try { ... runLighthouse ... }
  await resetCdpAfterLighthouse(page).catch(() => {})
} else {
  await progress(20, 'Loading page…')
  response = await page.goto(...)
  // 304 / 403 / 401 / response.ok checks
}
```

- [ ] **Step 2: Restructure the conditional**

Add the import:

```typescript
import { getLighthouseProvider, lighthouseOwnsNavigation } from './lighthouse-provider'
```

Replace the existing branch with:

```typescript
// (inside runAxeAudit, replacing the current Lighthouse-vs-not block)

const provider = getLighthouseProvider()

if (provider === 'local') {
  // Existing single-navigation optimization: LH owns page.goto
  await progress(20, 'Running Lighthouse…')
  try {
    const lh = await runLighthouse(parsed.toString(), page)
    lighthouseSummary = lh.summary
    lighthouseError = lh.error ?? null
  } catch (err) {
    lighthouseError = err instanceof Error ? err.message : String(err)
  }
  // Reset CDP unconditionally — Lighthouse mutates network/CPU throttling
  // and cache state even if it errors mid-run.
  await resetCdpAfterLighthouse(page).catch(() => {})
} else {
  // 'pagespeed' or 'off': we own navigation
  await progress(20, 'Loading page…')
  let response
  try {
    response = await page.goto(parsed.toString(), {
      waitUntil: 'networkidle2',
      timeout: 30_000,
    })
  } catch (err) {
    if (blockedNavigationError) throw blockedNavigationError
    throw err
  }
  // (Keep the existing response-status validation block intact:
  //  304 / 403 / 401 / non-OK throws.)

  if (provider === 'pagespeed') {
    await progress(22, 'Fetching Lighthouse from PageSpeed Insights…')
    try {
      const lh = await runLighthouse(parsed.toString(), page)
      lighthouseSummary = lh.summary
      lighthouseError = lh.error ?? null
    } catch (err) {
      lighthouseError = err instanceof Error ? err.message : String(err)
    }
  }
}
```

The PSI call comes after the local page.goto so the SSRF guard's request interception has already validated the navigation origin. PSI itself does its own remote fetch outside our process; we accept that we can't apply the SSRF guard to PSI's traffic (PSI fetches from Google's infrastructure, not ours).

- [ ] **Step 3: Verify the rest of runner.ts is untouched**

The pdfOrchestrator, axe call, screenshot capture, and progress reporting after this block should be unchanged.

- [ ] **Step 4: Build + lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/runner.ts
git commit -m "feat(ada-audit): runner branches navigation on lighthouseOwnsNavigation"
```

---

### Task 7: Update `ecosystem.config.js`, `.env.example`, and `CLAUDE.md`

**Files:**
- Modify: `ecosystem.config.js`
- Modify: `.env.example`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `ecosystem.config.js`**

Add `LIGHTHOUSE_PROVIDER` and `PAGESPEED_TIMEOUT_MS` to the env block. `PAGESPEED_API_KEY` does NOT go here — it's a secret, lives in `.env` on the VPS:

```javascript
    env: {
      // …existing entries…
      LIGHTHOUSE_PROVIDER: 'pagespeed',
      PAGESPEED_TIMEOUT_MS: '90000',
    },
```

- [ ] **Step 2: Update `.env.example`**

Add the two new variables (with documentation comments). After `SITE_AUDIT_BROWSER_RECYCLE_PAGES`:

```
LIGHTHOUSE_PROVIDER=pagespeed            # pagespeed | local | off
PAGESPEED_API_KEY=                       # optional; raises PSI rate limit from keyless to 25k/day
```

- [ ] **Step 3: Update `CLAUDE.md`**

Append one bullet to the "ADA Audit specifics" section:

```markdown
- **Lighthouse provider:** controlled by `LIGHTHOUSE_PROVIDER` (`pagespeed` | `local` | `off`). Default is `local` in code, `pagespeed` in the deployed `ecosystem.config.js`. PSI uses Google's infrastructure; expect score variance versus historical local-LH numbers. Per-page PSI failures fail the Lighthouse portion only — axe + PDFs still run.
```

- [ ] **Step 4: Verify config parses**

```bash
node -e "console.log(JSON.stringify(require('./ecosystem.config.js'), null, 2))" | grep -E 'LIGHTHOUSE|PAGESPEED'
```

Expected: prints `LIGHTHOUSE_PROVIDER: "pagespeed"` and `PAGESPEED_TIMEOUT_MS: "90000"`.

- [ ] **Step 5: Commit**

```bash
git add ecosystem.config.js .env.example CLAUDE.md
git commit -m "chore(ada-audit): wire LIGHTHOUSE_PROVIDER=pagespeed default + docs"
```

---

### Task 8: Update `docs/SERVER_SETUP.md`

**Files:**
- Modify: `docs/SERVER_SETUP.md`

- [ ] **Step 1: Add a deploy-time prerequisite block**

Locate Section 5.3 (Environment Variables) and add to the `cat > .env` block:

```
PAGESPEED_API_KEY=
```

with a one-line note:

> `PAGESPEED_API_KEY` raises the PageSpeed Insights quota from keyless (limited) to 25,000/day. Optional — leave empty if not yet provisioned.

- [ ] **Step 2: Update the env-variable table**

In the "Quick Reference / Environment Variables" section near the bottom, add two rows:

```markdown
| `LIGHTHOUSE_PROVIDER` | `pagespeed` | `pagespeed` (default in prod), `local`, or `off` |
| `PAGESPEED_API_KEY` | (none) | Google Cloud key for PageSpeed Insights API; raises quota |
```

- [ ] **Step 3: Commit**

```bash
git add docs/SERVER_SETUP.md
git commit -m "docs(server-setup): document LIGHTHOUSE_PROVIDER + PAGESPEED_API_KEY"
```

---

### Task 9: Verify lint + full test suite + build

**Files:** none.

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 2: Full test suite**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run
```

Expected: PASS. Delta vs. baseline:
- Pre-PR baseline: 1123 tests
- Task 3 moves 10 tests (no net change)
- Task 2 adds 6 provider tests
- Task 4 adds 10 PSI tests
- **+16 new tests; new total: 1139**

- [ ] **Step 3: Production build**

```bash
rm -rf .next && npm run build
```

Expected: clean. The `lighthouse` package is still a dependency but only the local code path imports it dynamically.

---

### Task 10: Open the PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/lighthouse-pagespeed-provider
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(ada-audit): PageSpeed Insights Lighthouse provider (default in prod)" --body "$(cat <<'EOF'
## Summary
Adds Google PageSpeed Insights as the new production-default Lighthouse provider, with local execution preserved as a reversible fallback. Validates the hypothesis that local Lighthouse trace processing is the dominant retainer behind the 2026-05-15 fei.edu V8 OOM at page 29/34.

## Provider selector
`LIGHTHOUSE_PROVIDER` env var, three values:

| Value | Behavior |
|---|---|
| `pagespeed` (new prod default) | Call PSI v5 over HTTPS; pass `response.lighthouseResult` through existing `extractSummary()` |
| `local` (former prod default; fallback) | Existing puppeteer-core + `lighthouse` package run |
| `off` | Skip Lighthouse entirely |

`LIGHTHOUSE_ENABLED=false` still short-circuits to `off`.

## What changed
- `lib/ada-audit/lighthouse-types.ts` — `RunLighthouseResult` moved here (was inline in `lighthouse-runner`)
- `lib/ada-audit/lighthouse-summary.ts` (new) — `extractSummary` + CWV thresholds + accessibility extractor. Leaf module — both local + PSI consume from here, no circular imports.
- `lib/ada-audit/lighthouse-provider.ts` (new) — selector + `lighthouseOwnsNavigation()` helper
- `lib/ada-audit/lighthouse-pagespeed.ts` (new) — PSI v5 HTTP client; maps HTTP errors to specific messages (429 → rate limit, 400 → unfetchable, 5xx → server error, AbortError → timeout, malformed JSON → "malformed response")
- `runLighthouse()` becomes a facade that dispatches by provider
- `runner.ts` branches navigation: local-LH owns `page.goto`; PSI / off paths own it themselves

## Failure handling — surface and continue
When PSI fails for a page (429 / 400 / 5xx / timeout / malformed body), the audit sets `lighthouseError` for that page and continues with axe + PDF harvest. The audit detail page renders "Lighthouse failed: <reason>" alongside whatever axe found. **No silent fall-through to local** — the experiment requires honest signal.

## Tests
- 6 selector tests covering provider parsing, case-insensitivity, kill-switch precedence, ownership
- 10 PSI client tests covering success, request shape (3 categories + DESKTOP), API key on/off, 429 / 400 / 5xx, malformed JSON, missing lighthouseResult, AbortError-as-timeout
- Existing 10 `extractSummary` tests relocated to `lighthouse-summary.test.ts` — same assertions, new home
- Total: **+16 new tests**, 1139 total

## Deploy mechanics
The `PAGESPEED_API_KEY` is a secret. Before the standard deploy, append it to the VPS `.env`:

```bash
ssh seo@144.126.213.242 'echo "PAGESPEED_API_KEY=<key>" >> /home/seo/webapps/seo-tools/.env'
```

Then `~/deploy.sh`, then `pm2 delete seo-tools && pm2 start ecosystem.config.js` to pick up the new `LIGHTHOUSE_PROVIDER` from `ecosystem.config.js`.

## Rollback
One env flip:

```bash
ssh seo@144.126.213.242 'cd /home/seo/webapps/seo-tools && sed -i "s/LIGHTHOUSE_PROVIDER: .pagespeed./LIGHTHOUSE_PROVIDER: '\''local'\''/" ecosystem.config.js && pm2 delete seo-tools && pm2 start ecosystem.config.js'
```

Or revert the PR.

## Post-deploy verification (the actual experiment)
- [ ] Queue fei.edu — the same 34-page site that V8-OOMed at page 29 yesterday under local LH
- [ ] Monitor Node heap (`pm2 list` mem column) — expect Node heap to stay well below the 2 GB ceiling; Chrome footprint roughly unchanged
- [ ] Verify completion: `pagesComplete === 34`, no PM2 restarts
- [ ] If fei.edu finishes: local-LH leak is confirmed isolated; close the throughput-tuning question separately
- [ ] If fei.edu still OOMs: leak is elsewhere (axe / screenshots / PDF orchestrator) — heap snapshots become the next move

## Score-environment shift
PSI runs in Google's infrastructure with different CPU and network than our VPS. Score numbers will shift from historical local-LH values. Operators reading "this site dropped from 71 to 62" should be aware it may be a measurement environment change, not a real regression. Documented in CLAUDE.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return PR URL**

---

## Self-review checklist

- [x] **Spec coverage**: every spec section maps to a task. Provider abstraction → Tasks 2, 5. PSI client → Task 4. Module-graph refactor → Task 3 (closes the circular-import concern). Runner navigation flow → Task 6. Docs + env → Tasks 7, 8. Tests → Tasks 2, 3, 4.
- [x] **No placeholders**: all code blocks are working code; all command lines are runnable.
- [x] **Type consistency**: `RunLighthouseResult` lives in `lighthouse-types.ts` and is the return type of both `runLocalLighthouse` and `runPageSpeedInsights`. Both consumed by `runLighthouse` facade.
- [x] **Module graph is acyclic**: types → summary → pagespeed → runner. Provider is a leaf. No edge points up. Verified visually in the diagram in the File Structure section.
- [x] **Secret hygiene**: the literal API key never appears in any committed file. Plan references `<key>` placeholder. Key goes into VPS `.env` at deploy time only.
- [x] **Test ordering**: each test is written before its implementation; RED verified before each GREEN.
- [x] **Deploy reminder**: `pm2 delete + start` requirement is called out; the `.env` set step is called out as a deploy prerequisite (must come BEFORE deploy because Next.js reads `.env` at process start).
