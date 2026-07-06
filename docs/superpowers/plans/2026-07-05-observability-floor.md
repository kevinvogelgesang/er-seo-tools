# A4 — Observability Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a two-tier `/api/health` liveness endpoint, a cookie-gated `/admin/ops` page, and a `lib/log/` structured logger adopted at the job-worker seam — so scheduled/queued work can be operated without SSH archaeology.

**Architecture:** Reuse existing groundwork (`lib/jobs/introspection.ts` `getJobQueueState`, `lib/ops/health-check.ts` `collectHealthSignals`/`evaluateHealth`, A3's `lib/api/` kit). New leaf helpers (`lib/ops/disk.ts`, `lib/ops/db-size.ts`, `browser-pool.getPoolState`, `lib/log/`) feed a public shallow health route and an authed server-component ops page. Logging is adopted at seams only — not a 132-site migration.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Vitest, pino, Tailwind (class-based dark mode), puppeteer-core.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-05-observability-floor-design.md` (Codex-reviewed, 10 fixes applied — tagged `Codex #1`–`#10`).
- **Gate commands (all must pass before PR):** `npm run lint` (= `tsc --noEmit`) · `DATABASE_URL="file:./local-dev.db" npm test` (= `vitest run`) · `npm run build`.
- **Tests need the dev DB:** prefix vitest with `DATABASE_URL="file:./local-dev.db"`.
- **React render tests:** `// @vitest-environment jsdom` at file top + `afterEach(cleanup)`.
- **`tsc --noEmit` has NO `noUnusedLocals`** — unused imports won't fail lint, but keep clean.
- **Array-form `$transaction([...])` only** — never interactive. (No transactions needed in A4, but the rule stands.)
- **Never rely on `Class.name`/function names at runtime** (SWC minifies). N/A here but noted.
- **Injected-into-page code must be SWC-helper-free** — the logger is server-only, never `.toString()`-injected; safe.
- **New public route rule (bit us 3×):** any new public/token route needs a `middleware.ts` `isPublicPath` entry **and** a `middleware.test.ts` case.
- **UI-change gate:** every element on `/admin/ops` + the `/settings` link gets Tailwind `dark:` variants (`bg-white`→`dark:bg-navy-card`, `text-gray-*`→`dark:text-white/*`, borders→`dark:border-navy-border`, page bg `bg-[#f4f6f9] dark:bg-navy-deep`).
- **pino:** prod = plain JSON to stdout, NO transport; `pino-pretty` is a **devDependency**, dev-only, lazily referenced, with a plain-pino fallback. The logger must never trigger a `process.exit(1)` boot dependency.
- **No migration** in A4 → plain `~/deploy.sh` at deploy time.
- **Commit hygiene:** `git add <explicit paths>` only — never `git add -A` (untracked `pentest-results/`, `SEO_Report_1st_Draft.pdf`, `googlefc472dc61896519a.html` must not be committed). Commit messages end with the repo's Co-Authored-By + Claude-Session trailers.

---

### Task 1: `lib/log/` — pino logger + `logError`

**Files:**
- Create: `lib/log/index.ts`
- Test: `lib/log/index.test.ts`
- Modify: `package.json` (add `pino` dependency + `pino-pretty` devDependency)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `logger: pino.Logger` (module singleton)
  - `serializeError(err: unknown): { name?: string; message: string; stack?: string }`
  - `logError(context: Record<string, unknown>, err: unknown): void`

- [ ] **Step 1: Add the dependencies**

Run:
```bash
npm install pino && npm install --save-dev pino-pretty
```
Expected: `package.json` gains `"pino"` in `dependencies` and `"pino-pretty"` in `devDependencies`; `npm install` (NOT `npm ci`) succeeds.

- [ ] **Step 2: Write the failing test**

Create `lib/log/index.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { serializeError, logError, logger } from './index'

describe('serializeError', () => {
  it('extracts name/message/stack from an Error', () => {
    const e = new Error('boom')
    const s = serializeError(e)
    expect(s.message).toBe('boom')
    expect(s.name).toBe('Error')
    expect(typeof s.stack).toBe('string')
  })

  it('stringifies a non-Error', () => {
    expect(serializeError('nope')).toEqual({ message: 'nope' })
    expect(serializeError(42)).toEqual({ message: '42' })
  })

  it('does not leak arbitrary enumerable props of an error-like object', () => {
    const gaxiosLike = Object.assign(new Error('bad'), { config: { headers: { authorization: 'secret' } } })
    const s = serializeError(gaxiosLike)
    expect(s).not.toHaveProperty('config')
    expect(JSON.stringify(s)).not.toContain('secret')
  })
})

describe('logError', () => {
  it('emits context + serialized err via logger.error', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    logError({ jobId: 'j1', type: 'psi', attempt: 2 }, new Error('kaboom'))
    expect(spy).toHaveBeenCalledTimes(1)
    const arg = spy.mock.calls[0][0] as Record<string, unknown>
    expect(arg.jobId).toBe('j1')
    expect(arg.type).toBe('psi')
    expect((arg.err as { message: string }).message).toBe('kaboom')
    spy.mockRestore()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/log/index.test.ts`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 4: Write the implementation**

Create `lib/log/index.ts`:
```ts
// lib/log/index.ts
//
// A4 observability — structured logger. Prod: plain JSON to stdout (NO transport
// worker), which PM2 rotates. Dev: pino-pretty (a devDependency) via a lazy,
// try/caught transport that falls back to plain pino if it can't load. The
// logger is server-only and never .toString()-injected into an audited page, so
// the SWC-helper hazard does not apply. It must never participate in the
// instrumentation.ts fail-fast boot exits — construction is fully guarded.
import pino, { type Logger } from 'pino'

function createLogger(): Logger {
  const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
  // Codex-plan #1: gate pretty transport to development ONLY. Under NODE_ENV='test'
  // (vitest) a transport worker thread leaks open handles; and prod has no dev deps.
  if (process.env.NODE_ENV === 'development') {
    try {
      return pino({ level, transport: { target: 'pino-pretty', options: { colorize: true } } })
    } catch {
      // pino-pretty absent or transport failed — fall through to plain JSON.
    }
  }
  return pino({ level })
}

export const logger: Logger = createLogger()

export function serializeError(err: unknown): { name?: string; message: string; stack?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack }
  return { message: String(err) }
}

export function logError(context: Record<string, unknown>, err: unknown): void {
  logger.error({ ...context, err: serializeError(err) })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/log/index.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 6: Commit**

```bash
git add lib/log/index.ts lib/log/index.test.ts package.json package-lock.json
git commit -m "feat(a4): lib/log structured logger + logError (pino)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 2: `getPoolState()` on the browser pool

**Files:**
- Modify: `lib/ada-audit/browser-pool.ts` (add exported accessor near the other exports)
- Test: `lib/ada-audit/browser-pool.test.ts` (append a describe block — puppeteer already mocked in this file)

**Interfaces:**
- Consumes: nothing.
- Produces: `getPoolState(): { poolSize: number; inUse: number; free: number; waiting: number; draining: boolean; browserAlive: boolean; pagesServed: number }`

- [ ] **Step 1: Write the failing test**

Append to `lib/ada-audit/browser-pool.test.ts` (this file already mocks `puppeteer-core` and exposes `loadPool()`):
```ts
describe('getPoolState (A4)', () => {
  it('reports initial idle state with no browser', async () => {
    const pool = await loadPool({ pool: '2' })
    expect(pool.getPoolState()).toEqual({
      poolSize: 2, inUse: 0, free: 2, waiting: 0,
      draining: false, browserAlive: false, pagesServed: 0,
    })
  })

  it('reflects an acquired page and a live browser', async () => {
    const pool = await loadPool({ pool: '2' })
    const page = await pool.acquirePage()
    const s = pool.getPoolState()
    expect(s.inUse).toBe(1)
    expect(s.free).toBe(1)
    expect(s.browserAlive).toBe(true) // mock browser.connected === true
    expect(s.pagesServed).toBe(1)
    await pool.releasePage(page)
    expect(pool.getPoolState().inUse).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/browser-pool.test.ts -t "getPoolState"`
Expected: FAIL — `pool.getPoolState is not a function`.

- [ ] **Step 3: Write the implementation**

In `lib/ada-audit/browser-pool.ts`, add (after the existing `closeBrowser` export or near the other module-state functions — it reads the module-level `POOL_SIZE`, `slots`, `waiters`, `draining`, `browser`, `pagesServed`):
```ts
// A4 observability: synchronous module-state snapshot for /admin/ops + /api/health.
// No await, no lock acquisition — cannot perturb the pool.
export function getPoolState(): {
  poolSize: number
  inUse: number
  free: number
  waiting: number
  draining: boolean
  browserAlive: boolean
  pagesServed: number
} {
  return {
    poolSize: POOL_SIZE,
    inUse: POOL_SIZE - slots,
    free: slots,
    waiting: waiters.length,
    draining,
    // Codex #9: `browser !== null` overstates health during a disconnect edge.
    browserAlive: browser?.connected === true,
    pagesServed,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/browser-pool.test.ts -t "getPoolState"`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/browser-pool.ts lib/ada-audit/browser-pool.test.ts
git commit -m "feat(a4): getPoolState() accessor on the browser pool

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 3: `lib/ops/disk.ts` — free-space helper

**Files:**
- Create: `lib/ops/disk.ts`
- Test: `lib/ops/disk.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `getDiskFree(path: string): Promise<number | null>` (free bytes on the volume containing `path`, or `null` on failure)

- [ ] **Step 1: Write the failing test**

Create `lib/ops/disk.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fsp from 'fs/promises'
import { getDiskFree } from './disk'

vi.mock('fs/promises', () => ({ statfs: vi.fn() }))

describe('getDiskFree', () => {
  beforeEach(() => { vi.mocked(fsp.statfs).mockReset() })

  it('returns bavail * bsize', async () => {
    vi.mocked(fsp.statfs).mockResolvedValue({ bavail: 1000, bsize: 4096 } as never)
    expect(await getDiskFree('/data')).toBe(1000 * 4096)
  })

  it('returns null when statfs throws', async () => {
    vi.mocked(fsp.statfs).mockRejectedValue(new Error('ENOSYS'))
    expect(await getDiskFree('/data')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/disk.test.ts`
Expected: FAIL — `Cannot find module './disk'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ops/disk.ts`:
```ts
// lib/ops/disk.ts
//
// A4 observability — free space on the data volume. Node 22 has fs.promises.statfs.
// Never throws; returns null so the UI renders "—".
import { statfs } from 'fs/promises'

export async function getDiskFree(path: string): Promise<number | null> {
  try {
    const s = await statfs(path)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/disk.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ops/disk.ts lib/ops/disk.test.ts
git commit -m "feat(a4): lib/ops/disk getDiskFree helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 4: `lib/ops/db-size.ts` — SQLite footprint (main + WAL + shm)

**Files:**
- Create: `lib/ops/db-size.ts`
- Test: `lib/ops/db-size.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `resolveDbPath(databaseUrl: string | undefined): string | null` (exported for testing — resolves a Prisma `file:` URL to an absolute path)
  - `getDbSizeBytes(): Promise<number | null>` (sum of `main + -wal + -shm`, or `null` on failure)

**Notes:** Prisma resolves a **relative** SQLite `file:` path against the `prisma/` schema directory, not `process.cwd()`. `resolveDbPath` must match that (Codex #4). Sum sidecars best-effort; a missing sidecar contributes 0 (Codex #3).

- [ ] **Step 1: Write the failing test**

Create `lib/ops/db-size.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import path from 'path'
import { resolveDbPath } from './db-size'

describe('resolveDbPath', () => {
  it('handles an absolute file: URL (prod shape)', () => {
    expect(resolveDbPath('file:/home/seo/data/seo-tools/db.sqlite'))
      .toBe('/home/seo/data/seo-tools/db.sqlite')
  })

  it('resolves a relative file: URL against the prisma/ dir (local dev shape)', () => {
    const got = resolveDbPath('file:./local-dev.db')
    expect(got).toBe(path.join(process.cwd(), 'prisma', 'local-dev.db'))
  })

  it('handles ../ relative paths', () => {
    const got = resolveDbPath('file:../data/db.sqlite')
    expect(got).toBe(path.join(process.cwd(), 'data', 'db.sqlite'))
  })

  it('strips a ?query suffix', () => {
    expect(resolveDbPath('file:/x/db.sqlite?connection_limit=1')).toBe('/x/db.sqlite')
  })

  it('returns null for a non-file URL or undefined', () => {
    expect(resolveDbPath(undefined)).toBeNull()
    expect(resolveDbPath('postgresql://x')).toBeNull()
  })
})

// Codex-plan #2: getDbSizeBytes itself must be tested (not only resolveDbPath).
import * as fsp from 'fs/promises'
import { getDbSizeBytes } from './db-size'
vi.mock('fs/promises', () => ({ stat: vi.fn() }))

describe('getDbSizeBytes', () => {
  const OLD = process.env.DATABASE_URL
  beforeEach(() => { vi.mocked(fsp.stat).mockReset(); process.env.DATABASE_URL = 'file:/x/db.sqlite' })
  afterEach(() => { process.env.DATABASE_URL = OLD })

  it('sums main + -wal + -shm', async () => {
    vi.mocked(fsp.stat).mockImplementation(async (f) => {
      const map: Record<string, number> = { '/x/db.sqlite': 100, '/x/db.sqlite-wal': 20, '/x/db.sqlite-shm': 3 }
      return { size: map[String(f)] ?? 0 } as never
    })
    expect(await getDbSizeBytes()).toBe(123)
  })

  it('counts a missing sidecar as 0', async () => {
    vi.mocked(fsp.stat).mockImplementation(async (f) => {
      if (String(f) === '/x/db.sqlite') return { size: 50 } as never
      throw new Error('ENOENT') // -wal / -shm absent
    })
    expect(await getDbSizeBytes()).toBe(50)
  })

  it('returns null when DATABASE_URL is not a file: URL', async () => {
    process.env.DATABASE_URL = 'postgresql://x'
    expect(await getDbSizeBytes()).toBeNull()
  })

  it('returns null when even the main file is absent (total 0)', async () => {
    vi.mocked(fsp.stat).mockRejectedValue(new Error('ENOENT'))
    expect(await getDbSizeBytes()).toBeNull()
  })
})
```

Add `vi, beforeEach, afterEach` to the vitest import at the top of this test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/db-size.test.ts`
Expected: FAIL — `Cannot find module './db-size'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ops/db-size.ts`:
```ts
// lib/ops/db-size.ts
//
// A4 observability — SQLite on-disk footprint. Reports main + -wal + -shm
// (Codex #3). Path parsing hardened for absolute/relative/query-suffix file:
// URLs; a relative path resolves against prisma/ the way Prisma does (Codex #4).
// Never throws; returns null so the UI renders "—".
import { stat } from 'fs/promises'
import path from 'path'

export function resolveDbPath(databaseUrl: string | undefined): string | null {
  if (!databaseUrl || !databaseUrl.startsWith('file:')) return null
  // Strip scheme + any ?query suffix.
  let p = databaseUrl.slice('file:'.length)
  const q = p.indexOf('?')
  if (q !== -1) p = p.slice(0, q)
  if (!p) return null
  if (path.isAbsolute(p)) return p
  // Prisma resolves relative SQLite paths against the schema (prisma/) dir.
  return path.resolve(process.cwd(), 'prisma', p)
}

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size
  } catch {
    return 0 // missing sidecar (or main) contributes 0
  }
}

export async function getDbSizeBytes(): Promise<number | null> {
  const main = resolveDbPath(process.env.DATABASE_URL)
  if (!main) return null
  try {
    const [a, b, c] = await Promise.all([sizeOf(main), sizeOf(`${main}-wal`), sizeOf(`${main}-shm`)])
    const total = a + b + c
    return total > 0 ? total : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/db-size.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ops/db-size.ts lib/ops/db-size.test.ts
git commit -m "feat(a4): lib/ops/db-size SQLite footprint (main+WAL+shm)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 5: `lib/ops/health-summary.ts` — public liveness summary (TTL-cached, fail-open)

**Files:**
- Create: `lib/ops/health-summary.ts`
- Test: `lib/ops/health-summary.test.ts`

**Interfaces:**
- Consumes: `collectHealthSignals`, `evaluateHealth`, `healthEvalOpts` from `lib/ops/health-check`.
- Produces: `getLivenessSummary(now?: Date): Promise<{ status: 'ok' | 'degraded' }>` — TTL-cached (10 s), lookback-window `since`, fresh zero-cooldown state, fail-open to `ok`.

**Notes:** This isolates the guardrails (Codex #1, #2) from the route so they're unit-testable. The DB `SELECT 1` ping stays in the route (Task 6), NOT here — this only computes the degraded flag.

- [ ] **Step 1: Write the failing test**

Create `lib/ops/health-summary.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as hc from './health-check'
import { getLivenessSummary, __resetHealthSummaryCache } from './health-summary'

const zeroSignals: hc.HealthSignals = {
  newErroredSiteAudits: 0, newErroredAdaAudits: 0, newExhaustedJobs: 0,
  stalledAudit: null, newestBackupAgeHours: 1,
}

describe('getLivenessSummary', () => {
  beforeEach(() => { __resetHealthSummaryCache(); vi.restoreAllMocks() })

  it('ok when no signals trip', async () => {
    vi.spyOn(hc, 'collectHealthSignals').mockResolvedValue(zeroSignals)
    expect(await getLivenessSummary()).toEqual({ status: 'ok' })
  })

  it('degraded when a signal trips', async () => {
    vi.spyOn(hc, 'collectHealthSignals').mockResolvedValue({ ...zeroSignals, newExhaustedJobs: 3 })
    expect(await getLivenessSummary()).toEqual({ status: 'degraded' })
  })

  it('passes a lookback-window since, not 0 (Codex #2)', async () => {
    const spy = vi.spyOn(hc, 'collectHealthSignals').mockResolvedValue(zeroSignals)
    const now = new Date('2026-07-05T12:00:00Z')
    await getLivenessSummary(now)
    const sinceArg = spy.mock.calls[0][1] as number
    expect(sinceArg).toBe(now.getTime() - hc.healthEvalOpts().lookbackMs)
    expect(sinceArg).toBeGreaterThan(0)
  })

  it('fails open to ok when signal collection throws (Codex #1)', async () => {
    vi.spyOn(hc, 'collectHealthSignals').mockRejectedValue(new Error('db slow'))
    expect(await getLivenessSummary()).toEqual({ status: 'ok' })
  })

  it('caches within the TTL (one collect call for two reads)', async () => {
    const spy = vi.spyOn(hc, 'collectHealthSignals').mockResolvedValue(zeroSignals)
    await getLivenessSummary()
    await getLivenessSummary()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/health-summary.test.ts`
Expected: FAIL — `Cannot find module './health-summary'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ops/health-summary.ts`:
```ts
// lib/ops/health-summary.ts
//
// A4 observability — the public /api/health degraded flag. Guardrails for an
// UNAUTHENTICATED poller: a 10 s in-memory TTL cache (Codex #1), a lookback-window
// `since` so historical errors don't pin it degraded forever (Codex #2), and
// fail-open to `ok` on any error/timeout (Codex #1). This computes ONLY the
// degraded flag — the hard DB ping lives in the route and is never cached.
import { collectHealthSignals, evaluateHealth, healthEvalOpts } from './health-check'

const TTL_MS = 10_000
let cache: { at: number; value: { status: 'ok' | 'degraded' } } | null = null

// Test-only: clear the module cache between cases.
export function __resetHealthSummaryCache(): void {
  cache = null
}

export async function getLivenessSummary(now: Date = new Date()): Promise<{ status: 'ok' | 'degraded' }> {
  const nowMs = now.getTime()
  if (cache && nowMs - cache.at < TTL_MS) return cache.value
  let value: { status: 'ok' | 'degraded' } = { status: 'ok' }
  try {
    const opts = healthEvalOpts()
    const since = nowMs - opts.lookbackMs // Codex #2 — window, never 0
    const signals = await collectHealthSignals(now, since)
    const { alerts } = evaluateHealth(signals, { lastCheckAt: 0, cooldowns: {} }, now, opts)
    value = alerts.length > 0 ? { status: 'degraded' } : { status: 'ok' }
  } catch {
    value = { status: 'ok' } // Codex #1 — fail open
  }
  cache = { at: nowMs, value }
  return value
}
```

Note: verify the `AlertState` shape (`{ lastCheckAt, cooldowns }`) against `lib/ops/alert-state.ts`; import its type if exported, otherwise the inline literal above matches `evaluateHealth`'s parameter.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/health-summary.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ops/health-summary.ts lib/ops/health-summary.test.ts
git commit -m "feat(a4): liveness summary (TTL cache + lookback since + fail-open)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 6: `/api/health` route (two-tier, public shallow)

**Files:**
- Create: `app/api/health/route.ts`
- Test: `app/api/health/route.test.ts`

**Interfaces:**
- Consumes: `prisma` (`lib/db`), `getLivenessSummary` (Task 5), `logError` (Task 1).
- Produces: `GET(): Promise<Response>` — `200 {status,uptimeSec,version}` up · `503 {status:'down'}` DB-down. `Cache-Control: no-store` on all responses.

- [ ] **Step 1: Write the failing test**

Create `app/api/health/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as summary from '@/lib/ops/health-summary'
import { logError } from '@/lib/log'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn() } }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

describe('GET /api/health', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]) })

  it('200 ok when DB up + no signals', async () => {
    vi.spyOn(summary, 'getLivenessSummary').mockResolvedValue({ status: 'ok' })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(typeof body.uptimeSec).toBe('number')
    expect(typeof body.version).toBe('string')
  })

  it('200 degraded when a signal trips; body carries only the flag (no alert text)', async () => {
    vi.spyOn(summary, 'getLivenessSummary').mockResolvedValue({ status: 'degraded' })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('degraded')
    expect(JSON.stringify(body)).not.toMatch(/audit|job|backup|queue/i)
  })

  it('503 down when the DB ping rejects, and logs the failure', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('db gone'))
    const res = await GET()
    expect(res.status).toBe(503)
    expect((await res.json()).status).toBe('down')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(logError).toHaveBeenCalledWith({ scope: 'health-db-ping' }, expect.any(Error))
  })

  it('fails open to 200 ok if the summary throws (does not 500/503)', async () => {
    vi.spyOn(summary, 'getLivenessSummary').mockRejectedValue(new Error('boom'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ok')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/health/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

Create `app/api/health/route.ts`:
```ts
// app/api/health/route.ts
//
// A4 observability — PUBLIC shallow liveness for an uptime monitor. 200 when the
// app + DB are up (status ok|degraded — degraded stays 200 so the monitor does not
// false-page on a soft issue); 503 only when the DB ping fails (the sole hard-down
// signal). Operational internals stay behind the cookie gate on /admin/ops. This
// route is self-handling — it returns explicit Responses and never 500s.
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getLivenessSummary } from '@/lib/ops/health-summary'
import { logError } from '@/lib/log'
import pkg from '@/package.json'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(): Promise<Response> {
  // Hard-down signal: a cheap, uncached DB ping. A failure here is the one thing
  // worth logging from this endpoint (Codex-plan #3).
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (err) {
    logError({ scope: 'health-db-ping' }, err)
    return NextResponse.json({ status: 'down' }, { status: 503, headers: NO_STORE })
  }

  // Soft signal: TTL-cached, fail-open degraded flag (Task 5 owns the guardrails).
  let status: 'ok' | 'degraded' = 'ok'
  try {
    status = (await getLivenessSummary()).status
  } catch {
    status = 'ok'
  }

  return NextResponse.json(
    { status, uptimeSec: Math.round(process.uptime()), version: pkg.version },
    { status: 200, headers: NO_STORE },
  )
}
```

Note: `import pkg from '@/package.json'` requires `resolveJsonModule` (already on in this TS project — Next enables it). If tsc complains, use `{ version } from '@/package.json'`. Verify with the lint gate.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/health/route.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add app/api/health/route.ts app/api/health/route.test.ts
git commit -m "feat(a4): /api/health two-tier liveness route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 7: Make `/api/health` public in middleware

**Files:**
- Modify: `middleware.ts` (add `/api/health` to `PUBLIC_EXACT_PATHS`)
- Test: `middleware.test.ts` (add cases)

**Interfaces:**
- Consumes: `isPublicPath` (existing).
- Produces: nothing new — behavior change only.

- [ ] **Step 1: Write the failing test**

In `middleware.test.ts`, add a new describe block:
```ts
describe('isPublicPath — A4 health endpoint', () => {
  it('exempts exactly /api/health', () => {
    expect(isPublicPath('/api/health')).toBe(true)
  })
  it('does NOT exempt a deeper health path (future detail stays gated)', () => {
    expect(isPublicPath('/api/health/detail')).toBe(false)
  })
  it('keeps /admin/ops gated', () => {
    expect(isPublicPath('/admin/ops')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run middleware.test.ts -t "A4 health endpoint"`
Expected: FAIL — `/api/health` returns false (not yet in the allowlist).

- [ ] **Step 3: Write the implementation**

In `middleware.ts`, add `'/api/health'` to the `PUBLIC_EXACT_PATHS` set (exact match, not a prefix — Codex #8):
```ts
const PUBLIC_EXACT_PATHS = new Set([
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/privacy',
  '/about',
  // A4 observability — public shallow liveness for an uptime monitor. Exact match
  // only; a future /api/health/detail must stay cookie-gated.
  '/api/health',
])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run middleware.test.ts`
Expected: PASS (new block + all existing cases).

- [ ] **Step 5: Commit**

```bash
git add middleware.ts middleware.test.ts
git commit -m "feat(a4): make /api/health a public exact path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 8: `getCleanupStats()` — last-run summary for maintenance schedules

**Files:**
- Modify: `lib/jobs/introspection.ts` (add an exported reader)
- Test: `lib/jobs/introspection.test.ts` (append a case; runs against the shared dev DB — assert shape, not values)

**Interfaces:**
- Consumes: `prisma`.
- Produces: `getCleanupStats(): Promise<Array<{ type: string; lastCompletedAt: Date | null; lastStatus: string | null; lastError: string | null }>>` for the maintenance job types `['cleanup','screenshot-sweep','stale-audit-reset','db-backup','health-alert']`.

**Notes:** No structured cleanup metric exists, so report last-run timestamp + **status** + error (spec: "timestamp + status only … do not fabricate counts"; Codex-plan #4 — include status).

- [ ] **Step 1: Write the failing test**

Append to `lib/jobs/introspection.test.ts`. This test mocks Prisma so the newest-row selection + field mapping are actually asserted (Codex-plan #5), rather than only the shape:
```ts
describe('getCleanupStats', () => {
  it('maps the newest job row per maintenance type (status + error + completedAt)', async () => {
    const { prisma } = await import('@/lib/db')
    const spy = vi.spyOn(prisma.job, 'findFirst').mockImplementation((async (args: { where: { type: string } }) => {
      if (args.where.type === 'cleanup') {
        return { completedAt: new Date('2026-07-05T09:00:00Z'), status: 'complete', lastError: null }
      }
      if (args.where.type === 'db-backup') {
        return { completedAt: new Date('2026-07-05T08:00:00Z'), status: 'error', lastError: 'disk full' }
      }
      return null // no run yet for the other types
    }) as never)

    const { getCleanupStats } = await import('./introspection')
    const rows = await getCleanupStats()

    // findFirst called once per maintenance type, ordered by completedAt desc.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { completedAt: 'desc' } }))

    const cleanup = rows.find((r) => r.type === 'cleanup')!
    expect(cleanup.lastStatus).toBe('complete')
    expect(cleanup.lastError).toBeNull()
    expect(cleanup.lastCompletedAt?.toISOString()).toBe('2026-07-05T09:00:00.000Z')

    const backup = rows.find((r) => r.type === 'db-backup')!
    expect(backup.lastStatus).toBe('error')
    expect(backup.lastError).toBe('disk full')

    const swept = rows.find((r) => r.type === 'screenshot-sweep')!
    expect(swept.lastCompletedAt).toBeNull()
    expect(swept.lastStatus).toBeNull()

    spy.mockRestore()
  })
})
```
Add `vi` to the vitest import at the top of `introspection.test.ts` if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/introspection.test.ts -t "getCleanupStats"`
Expected: FAIL — `getCleanupStats is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `lib/jobs/introspection.ts`:
```ts
const MAINTENANCE_TYPES = ['cleanup', 'screenshot-sweep', 'stale-audit-reset', 'db-backup', 'health-alert'] as const

export interface CleanupStat {
  type: string
  lastCompletedAt: Date | null
  lastStatus: string | null
  lastError: string | null
}

export async function getCleanupStats(): Promise<CleanupStat[]> {
  const rows = await Promise.all(
    MAINTENANCE_TYPES.map(async (type) => {
      const last = await prisma.job.findFirst({
        where: { type },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true, status: true, lastError: true },
      })
      return {
        type,
        lastCompletedAt: last?.completedAt ?? null,
        lastStatus: last?.status ?? null,
        lastError: last?.lastError ?? null,
      }
    }),
  )
  return rows
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/introspection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/introspection.ts lib/jobs/introspection.test.ts
git commit -m "feat(a4): getCleanupStats() maintenance last-run reader

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 9: `lib/ops/ops-snapshot.ts` — per-section fault-isolated loader

**Files:**
- Create: `lib/ops/ops-snapshot.ts`
- Test: `lib/ops/ops-snapshot.test.ts`

**Interfaces:**
- Consumes: `getJobQueueState`, `getCleanupStats` (`lib/jobs/introspection`), `collectHealthSignals`, `healthEvalOpts` (`lib/ops/health-check`), `getDiskFree` (Task 3), `getDbSizeBytes` (Task 4), `getPoolState` (Task 2).
- Produces: `loadOpsSnapshot(): Promise<OpsSnapshot>` where each section is `{ ok: true; data: T } | { ok: false }` (Codex #5 — a failed loader never blanks the page).

- [ ] **Step 1: Write the failing test**

Create `lib/ops/ops-snapshot.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/jobs/introspection', () => ({
  getJobQueueState: vi.fn(async () => ({ counts: {}, oldestRunning: null, recentFailures: [] })),
  getCleanupStats: vi.fn(async () => [{ type: 'cleanup', lastCompletedAt: null, lastError: null }]),
}))
vi.mock('@/lib/ops/health-check', () => ({
  collectHealthSignals: vi.fn(async () => { throw new Error('db down') }), // force one section to fail
  healthEvalOpts: () => ({ lookbackMs: 900000, cooldownMs: 1, backupStaleHours: 26 }),
}))
vi.mock('@/lib/ops/disk', () => ({ getDiskFree: vi.fn(async () => 123) }))
vi.mock('@/lib/ops/db-size', () => ({ getDbSizeBytes: vi.fn(async () => 456) }))
vi.mock('@/lib/ada-audit/browser-pool', () => ({
  getPoolState: () => ({ poolSize: 2, inUse: 0, free: 2, waiting: 0, draining: false, browserAlive: false, pagesServed: 0 }),
}))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

import { loadOpsSnapshot } from './ops-snapshot'
import { logError } from '@/lib/log'

describe('loadOpsSnapshot', () => {
  it('isolates a failed section without blanking the rest, and logs it (Codex #5/#6)', async () => {
    const snap = await loadOpsSnapshot()
    expect(snap.queue.ok).toBe(true)
    expect(snap.health.ok).toBe(false) // collectHealthSignals threw
    expect(snap.disk.ok).toBe(true)
    if (snap.disk.ok) expect(snap.disk.data).toBe(123)
    expect(snap.pool.ok).toBe(true)
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'ops-snapshot', section: 'health' }),
      expect.any(Error),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/ops-snapshot.test.ts`
Expected: FAIL — `Cannot find module './ops-snapshot'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ops/ops-snapshot.ts`:
```ts
// lib/ops/ops-snapshot.ts
//
// A4 observability — the /admin/ops data loader. Each panel loads independently;
// a throwing loader degrades to { ok: false } instead of blanking the page
// (Codex #5), because /admin/ops is most needed WHILE things are failing.
import { getJobQueueState, getCleanupStats, type JobQueueState, type CleanupStat } from '@/lib/jobs/introspection'
import { collectHealthSignals, evaluateHealth, healthEvalOpts, type HealthSignals } from '@/lib/ops/health-check'
import { getDiskFree } from '@/lib/ops/disk'
import { getDbSizeBytes } from '@/lib/ops/db-size'
import { getPoolState } from '@/lib/ada-audit/browser-pool'
import { resolveDbPath } from '@/lib/ops/db-size'
import { logError } from '@/lib/log'
import path from 'path'

export type Section<T> = { ok: true; data: T } | { ok: false }

export interface HealthPanel {
  signals: HealthSignals
  degraded: boolean
}

export interface OpsSnapshot {
  queue: Section<JobQueueState>
  cleanup: Section<CleanupStat[]>
  health: Section<HealthPanel>
  disk: Section<number | null>
  dbSize: Section<number | null>
  pool: Section<ReturnType<typeof getPoolState>>
}

async function section<T>(name: string, fn: () => Promise<T> | T): Promise<Section<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    // Codex-plan #6: a failed panel degrades to { ok:false } AND is logged, so the
    // page still renders while the failure is captured for the ops log.
    logError({ scope: 'ops-snapshot', section: name }, err)
    return { ok: false }
  }
}

export async function loadOpsSnapshot(): Promise<OpsSnapshot> {
  // Disk is measured on the DB's data volume; fall back to cwd if unresolved.
  const dbPath = resolveDbPath(process.env.DATABASE_URL)
  const dataDir = dbPath ? path.dirname(dbPath) : process.cwd()

  const [queue, cleanup, health, disk, dbSize, pool] = await Promise.all([
    section('queue', () => getJobQueueState()),
    section('cleanup', () => getCleanupStats()),
    section('health', async () => {
      const now = new Date()
      const opts = healthEvalOpts()
      const signals = await collectHealthSignals(now, now.getTime() - opts.lookbackMs)
      const { alerts } = evaluateHealth(signals, { lastCheckAt: 0, cooldowns: {} }, now, opts)
      return { signals, degraded: alerts.length > 0 }
    }),
    section('disk', () => getDiskFree(dataDir)),
    section('dbSize', () => getDbSizeBytes()),
    section('pool', () => getPoolState()),
  ])

  return { queue, cleanup, health, disk, dbSize, pool }
}
```

Note: confirm `getJobQueueState` exports `JobQueueState` (it does) and add `type CleanupStat` export from Task 8. `HealthSignals` is exported from `health-check.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/ops-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ops/ops-snapshot.ts lib/ops/ops-snapshot.test.ts
git commit -m "feat(a4): ops-snapshot per-section fault-isolated loader

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 10: `/admin/ops` page + `/settings` link

**Files:**
- Create: `app/admin/ops/page.tsx`
- Create: `components/admin/OpsView.tsx` (presentational; testable with mocked snapshot)
- Test: `components/admin/OpsView.test.tsx`
- Modify: `app/settings/page.tsx` (add a link to `/admin/ops`)

**Interfaces:**
- Consumes: `loadOpsSnapshot` (Task 9), `OpsSnapshot` type.
- Produces: `/admin/ops` route (cookie-gated by middleware — NOT public).

- [ ] **Step 1: Write the failing test**

Create `components/admin/OpsView.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { OpsView } from './OpsView'
import type { OpsSnapshot } from '@/lib/ops/ops-snapshot'

afterEach(cleanup)

const base: OpsSnapshot = {
  queue: { ok: true, data: { counts: { psi: { complete: 3, error: 1 } }, oldestRunning: null, recentFailures: [] } },
  cleanup: { ok: true, data: [{ type: 'cleanup', lastCompletedAt: null, lastStatus: null, lastError: null }] },
  health: { ok: true, data: { degraded: false, signals: { newErroredSiteAudits: 0, newErroredAdaAudits: 0, newExhaustedJobs: 0, stalledAudit: null, newestBackupAgeHours: 2 } } },
  disk: { ok: true, data: 5_000_000_000 },
  dbSize: { ok: true, data: 456_000_000 },
  pool: { ok: true, data: { poolSize: 2, inUse: 1, free: 1, waiting: 0, draining: false, browserAlive: true, pagesServed: 9 } },
}

describe('OpsView', () => {
  it('renders the queue counts and pool state', () => {
    render(<OpsView snapshot={base} />)
    expect(screen.getByText(/psi/i)).toBeTruthy()
    expect(screen.getByText(/pages served/i)).toBeTruthy()
  })

  it('shows "—" for a null metric', () => {
    render(<OpsView snapshot={{ ...base, disk: { ok: true, data: null } }} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows "unavailable" for a failed section (Codex #5)', () => {
    render(<OpsView snapshot={{ ...base, health: { ok: false } }} />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })

  it('renders a failed System metric as "unavailable", not "—" (Codex-plan #7)', () => {
    render(<OpsView snapshot={{ ...base, disk: { ok: false } }} />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/admin/OpsView.test.tsx`
Expected: FAIL — `Cannot find module './OpsView'`.

- [ ] **Step 3: Write the implementation**

Create `components/admin/OpsView.tsx` — a presentational component taking `{ snapshot }`. Render six panels; for any `{ ok: false }` section render an "unavailable" note; for null numeric metrics render `—`. Every element carries dark-mode variants. Use a byte formatter (GB) for disk/dbSize.

```tsx
import type { OpsSnapshot } from '@/lib/ops/ops-snapshot'

function fmtBytes(n: number | null): string {
  if (n === null || n === undefined) return '—'
  const gb = n / 1_073_741_824
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(n / 1_048_576).toFixed(1)} MB`
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card p-5">
      <h2 className="font-display font-bold text-lg text-navy dark:text-white mb-3">{title}</h2>
      {children}
    </section>
  )
}

const Unavailable = () => (
  <p className="text-sm font-body text-amber-600 dark:text-amber-400">Section unavailable (loader failed).</p>
)

export function OpsView({ snapshot }: { snapshot: OpsSnapshot }) {
  const { queue, cleanup, health, disk, dbSize, pool } = snapshot
  return (
    <div className="space-y-2">
      <Card title="System">
        {/* Codex-plan #7: a failed loader renders "unavailable", distinct from a
            null metric ("—") which means "measured, not available on this host". */}
        <dl className="grid grid-cols-2 gap-2 text-sm font-body text-gray-700 dark:text-white/70">
          <dt>Disk free</dt><dd>{disk.ok ? fmtBytes(disk.data) : <span className="text-amber-600 dark:text-amber-400">unavailable</span>}</dd>
          <dt>DB footprint (main+WAL)</dt><dd>{dbSize.ok ? fmtBytes(dbSize.data) : <span className="text-amber-600 dark:text-amber-400">unavailable</span>}</dd>
        </dl>
      </Card>

      <Card title="Browser pool">
        {pool.ok ? (
          <dl className="grid grid-cols-2 gap-2 text-sm font-body text-gray-700 dark:text-white/70">
            <dt>In use / size</dt><dd>{pool.data.inUse} / {pool.data.poolSize}</dd>
            <dt>Waiting</dt><dd>{pool.data.waiting}</dd>
            <dt>Draining</dt><dd>{String(pool.data.draining)}</dd>
            <dt>Browser alive</dt><dd>{String(pool.data.browserAlive)}</dd>
            <dt>Pages served</dt><dd>{pool.data.pagesServed}</dd>
          </dl>
        ) : <Unavailable />}
      </Card>

      <Card title="Health signals">
        {health.ok ? (
          <div className="text-sm font-body text-gray-700 dark:text-white/70">
            <p className={health.data.degraded ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-green-600 dark:text-green-400 font-semibold'}>
              {health.data.degraded ? 'Degraded' : 'OK'}
            </p>
            <dl className="grid grid-cols-2 gap-2 mt-2">
              <dt>Errored site audits (window)</dt><dd>{health.data.signals.newErroredSiteAudits}</dd>
              <dt>Errored ADA audits (window)</dt><dd>{health.data.signals.newErroredAdaAudits}</dd>
              <dt>Exhausted jobs (window)</dt><dd>{health.data.signals.newExhaustedJobs}</dd>
              <dt>Stalled audit</dt><dd>{health.data.signals.stalledAudit ? `${health.data.signals.stalledAudit.id} (${health.data.signals.stalledAudit.minutesStuck}m)` : 'none'}</dd>
              <dt>Newest backup age</dt><dd>{health.data.signals.newestBackupAgeHours === null ? '—' : `${Math.round(health.data.signals.newestBackupAgeHours)}h`}</dd>
            </dl>
          </div>
        ) : <Unavailable />}
      </Card>

      <Card title="Job queue">
        {queue.ok ? (
          <div className="text-sm font-body text-gray-700 dark:text-white/70">
            <table className="w-full text-left">
              <thead><tr className="text-gray-500 dark:text-white/50"><th>Type</th><th>Status counts</th></tr></thead>
              <tbody>
                {Object.entries(queue.data.counts).map(([type, byStatus]) => (
                  <tr key={type} className="border-t border-gray-100 dark:border-navy-border">
                    <td className="py-1">{type}</td>
                    <td className="py-1">{Object.entries(byStatus).map(([s, c]) => `${s}:${c}`).join('  ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2">Oldest running: {queue.data.oldestRunning ? `${queue.data.oldestRunning.type} ${queue.data.oldestRunning.id}` : 'none'}</p>
            {queue.data.recentFailures.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {queue.data.recentFailures.map((f) => (
                  <li key={f.id}>{f.type}: {f.lastError ?? 'error'}</li>
                ))}
              </ul>
            )}
          </div>
        ) : <Unavailable />}
      </Card>

      <Card title="Maintenance (last run)">
        {cleanup.ok ? (
          <dl className="grid grid-cols-2 gap-2 text-sm font-body text-gray-700 dark:text-white/70">
            {cleanup.data.map((c) => (
              <React.Fragment key={c.type}>
                <dt>{c.type}</dt>
                <dd>
                  {c.lastCompletedAt ? new Date(c.lastCompletedAt).toISOString() : '—'}
                  {c.lastStatus ? ` [${c.lastStatus}]` : ''}
                  {c.lastError ? ` (err: ${c.lastError})` : ''}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        ) : <Unavailable />}
      </Card>
    </div>
  )
}
```
Add `import React from 'react'` at the top (for `React.Fragment` / `React.ReactNode`).

Create `app/admin/ops/page.tsx` (server component):
```tsx
import type { Metadata } from 'next'
import { loadOpsSnapshot } from '@/lib/ops/ops-snapshot'
import { OpsView } from '@/components/admin/OpsView'

export const metadata: Metadata = { title: 'Ops — ER SEO Tools' }
export const dynamic = 'force-dynamic' // always live; never statically cached

export default async function OpsPage() {
  const snapshot = await loadOpsSnapshot()
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="font-display font-extrabold text-2xl text-navy dark:text-white mb-1">Ops</h1>
          <p className="text-sm font-body text-gray-500 dark:text-white/50">
            Job queue, health signals, disk/DB footprint, and browser-pool state. Read-only.
          </p>
        </div>
        <OpsView snapshot={snapshot} />
      </div>
    </div>
  )
}
```

Modify `app/settings/page.tsx` — add a link to `/admin/ops` (dark-mode compliant), e.g. under the heading `<p>`:
```tsx
        <p className="mt-2 text-sm font-body">
          <a href="/admin/ops" className="text-blue-600 dark:text-blue-400 hover:underline">Ops dashboard →</a>
        </p>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/admin/OpsView.test.tsx`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add app/admin/ops/page.tsx components/admin/OpsView.tsx components/admin/OpsView.test.tsx app/settings/page.tsx
git commit -m "feat(a4): /admin/ops page + settings link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 11: Adopt `logError` at the job-worker seam

**Files:**
- Modify: `lib/jobs/worker.ts` (retain the caught error object; `logError` at error/exhausted; replace the two console lines)
- Test: `lib/jobs/worker.test.ts` (add a case asserting `logError` fires on a job that exhausts)

**Interfaces:**
- Consumes: `logError` (Task 1).
- Produces: nothing new — logging behavior only.

**Notes (Codex #6):** the worker currently flattens the handler failure into `error: string | null`, losing the stack. Keep the caught `unknown` alongside so `logError` gets the real Error.

- [ ] **Step 1: Write the failing test**

Inspect `lib/jobs/worker.test.ts` first to match its harness (how it registers a handler + drives a tick). Add a case:
```ts
it('logs a structured error when a job exhausts its retries', async () => {
  const { logger } = await import('@/lib/log')
  const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})
  try {
    // register a handler that always throws, enqueue with maxAttempts=1, run one tick
    // (use the file's existing enqueue/tick helpers)
    // ... drive the worker so the job settles to 'error' ...
    expect(spy).toHaveBeenCalledTimes(1) // exactly one structured error on exhaustion
    const arg = spy.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(arg).toHaveProperty('jobId')
    expect((arg.err as { message: string }).message).toMatch(/./)
  } finally {
    // Codex-plan #9: restore in finally so a failed assertion cannot poison
    // later worker tests that share this module's logger singleton.
    spy.mockRestore()
  }
})
```
If `worker.test.ts`'s harness makes a full enqueue→tick awkward to assert in isolation, instead add a focused unit around the settle path, or assert via the existing "job errors" test by spying on `logger.error`. Keep the assertion to: `logger.error` called with `{ jobId, type, attempt, err:{message} }` on exhaustion.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/worker.test.ts -t "structured error"`
Expected: FAIL — `logger.error` not called (seam not wired yet).

- [ ] **Step 3: Write the implementation**

In `lib/jobs/worker.ts`:
1. Add `import { logError } from '@/lib/log'` at the top.
2. In the handler try/catch that sets `error` (around line 134), retain the caught object:
```ts
    let caughtErr: unknown = null
    // ...
    } catch (err) {
      caughtErr = err
      error = err instanceof Error ? err.message : String(err)
    } finally {
      clearInterval(heartbeat)
    }
```
3. In the exhausted branch (after `runOnExhausted`, when `res.count === 1`), log the structured error:
```ts
        if (res.count === 1) {
          logError({ jobId: job.id, type: job.type, attempt: job.attempts }, caughtErr ?? error)
          await runOnExhausted(job.type, job.payload, job.id, job.attempts, error)
        }
```
4. Replace the two existing bare console calls in this file with the logger:
   - `console.error('[jobs] worker tick failed:', (err as Error).message)` → `logError({ scope: 'worker-tick' }, err)`
   - `console.warn(`[jobs] settle failed for job=${job.id}:`, (err as Error).message)` → `logError({ scope: 'worker-settle', jobId: job.id }, err)`
   (Leave the other `console.warn` lines — dead active-set retire, sweep-pass — as-is; they are lower-signal and out of this seam's scope.)

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/worker.test.ts`
Expected: PASS (new case + all existing worker cases still green).

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/worker.ts lib/jobs/worker.test.ts
git commit -m "feat(a4): logError at the job-worker error/exhausted seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 12: Full gates + PR

**Files:** none (verification + PR only).

- [ ] **Step 1: Run the full gate suite**

Run:
```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: `tsc --noEmit` clean · all vitest files pass (new A4 tests + existing suite) · `next build` compiles.

- [ ] **Step 2: Manual dev smoke (optional but recommended)**

Run: `DATABASE_URL="file:./local-dev.db" npm run dev`, then:
```bash
curl -s localhost:3000/api/health   # expect {"status":"ok"|"degraded","uptimeSec":N,"version":"0.2.0"} + 200
```
Load `http://localhost:3000/admin/ops` in a browser (log in if the dev gate is on) and eyeball the panels; toggle dark mode to confirm variants.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin <branch>
gh pr create --title "A4: observability floor (/api/health + /admin/ops + lib/log)" --body "$(cat <<'EOF'
Implements A4 observability floor per docs/superpowers/specs/2026-07-05-observability-floor-design.md (Codex-reviewed).

- Two-tier /api/health (public shallow liveness 200/503 + degraded flag; TTL-cached, lookback-window since, fail-open, no-store)
- Cookie-gated /admin/ops server-component page (queue, health signals, disk, DB footprint, pool state, maintenance last-run) with per-section fault isolation
- lib/log/ pino logger + logError, adopted at the job-worker error seam
- getPoolState() accessor; lib/ops/disk + db-size helpers; getCleanupStats()

No migration → plain ~/deploy.sh. New public route /api/health added to middleware isPublicPath (exact) + middleware.test.ts cases.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Merge + deploy + prod-verify** (per change-control rule 1, gate-green autonomous)

After gate-green + PR merge:
```bash
ssh seo@144.126.213.242 "~/deploy.sh"
```
Then prod verification:
```bash
curl -s https://seo.erstaging.site/api/health          # 200 {status:ok|degraded,...}, cookie-less
curl -s -o /dev/null -w "%{http_code}" https://seo.erstaging.site/admin/ops   # 401/redirect cookie-less (gated)
```
Log in and load `/admin/ops`; confirm the panels render with real prod numbers. `pm2 logs` shows JSON `logError` lines only on real failures (do not force one in prod). Record the result in the tracker + rewrite the handoff (docs ritual).

---

## Self-Review

**Spec coverage:**
- Deliverable 1 `/api/health` → Tasks 5 (summary guardrails) + 6 (route) + 7 (public middleware). Covers 200 ok/degraded, 503 down, TTL cache (#1), lookback since (#2), fail-open (#1), no-store (#1), exact allowlist (#8). ✓
- Deliverable 2 `/admin/ops` → Tasks 2 (pool), 3 (disk), 4 (db-size #3/#4), 8 (cleanup stats), 9 (fault isolation #5), 10 (page + link + dark mode). ✓
- Deliverable 3 `lib/log/` → Task 1 (logger, runtime-safe transport #7) + Task 11 (worker seam, retain error object #6). ✓
- Browser-pool accessor `browser?.connected` (#9) → Task 2. ✓
- Pool tests mock puppeteer (#10) → Task 2 uses the existing mocked `loadPool`. ✓
- Testing section items → each task's Step 1. ✓
- Gates + prod verification → Task 12. ✓

**Placeholder scan:** Task 11 Step 1 leaves the worker-test harness wiring to be matched against the actual `worker.test.ts` (the file's enqueue/tick helpers aren't reproduced here) — this is a deliberate "inspect first" instruction, not a code placeholder, because the harness shape must be read from the file; the assertion contract (spy on `logger.error`, check `{jobId,type,attempt,err.message}`) is fully specified. All other steps contain complete code.

**Type consistency:** `getPoolState`'s return shape is identical in Task 2 (definition), Task 9 (`ReturnType<typeof getPoolState>`), and Task 10 (mock + render). `Section<T>` / `OpsSnapshot` defined in Task 9, consumed verbatim in Task 10. `CleanupStat` defined in Task 8, imported in Task 9. `HealthSignals` reused from `health-check.ts`. `getLivenessSummary` returns `{status:'ok'|'degraded'}` in Tasks 5 + 6. ✓

## Codex plan review

Routed through Codex (session `019f2b57`, 2026-07-05; retried after a transient
websocket drop). Verdict: accept-with-fixes — no rewrite; Codex independently
**verified** the load-bearing assumptions (`AlertState` shape, `collectHealthSignals`/
`evaluateHealth`/`healthEvalOpts` signatures, `JobQueueState` export, the
`browser-pool.test.ts` `loadPool` mock, `PUBLIC_EXACT_PATHS`, `resolveJsonModule`
on for the `@/package.json` import). 9 findings applied in place:
- #1 gate pino-pretty transport to `NODE_ENV==='development'` (no transport worker under vitest `test`).
- #2 test `getDbSizeBytes` itself (summing, missing sidecars, non-file URL, all-absent).
- #3 `/api/health` actually uses `logError` on the 503 DB-down path (interface/spec had claimed it).
- #4 `getCleanupStats` includes `lastStatus`; rendered on `/admin/ops`.
- #5 strengthen the cleanup-stats test (mock Prisma, assert newest-row selection + mapping).
- #6 `ops-snapshot` `section()` logs each failed loader (`scope:'ops-snapshot'`) while still degrading to `{ok:false}`.
- #7 `OpsView` renders a failed System metric as "unavailable" (distinct from a null metric's "—").
- #9 worker-seam test restores the `logger.error` spy in `finally` (one-call assertion).
(#8 was a confirmation that `caughtErr`'s scope + log-before-`runOnExhausted` ordering is correct — no change.)
