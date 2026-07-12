# A7 — Auth & Testing Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three still-open A7 hardening gaps — login brute-force friction, serialized-test slowness, and no end-to-end smoke — as three sequential, independently gate-green PRs.

**Architecture:** PR1 adds an extracted in-memory fixed-window rate limiter and wires it into the break-glass password login. PR2 gives each vitest worker its own migrated SQLite file (template-copy) so `fileParallelism` can be re-enabled. PR3 adds a Playwright smoke suite that boots the built app in production mode against a loopback fixture, gated by a new default-off exact-loopback SSRF allowlist.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, vitest (forks pool), Playwright, puppeteer-core + system Chrome, RunCloud + PM2 (single fork-mode process), Cloudflare front.

**Spec:** `docs/superpowers/specs/2026-07-11-a7-auth-testing-hardening-design.md` (Codex accept-with-fixes ×6, applied).

## Global Constraints

- **Node 22**; **SQLite only** (no Postgres/Redis); **no serverless** (RunCloud + PM2, single fork-mode process). In-memory limiter is correct here — do NOT add a store.
- **Gates before every merge:** `npm run lint` (`tsc --noEmit`) + `DATABASE_URL="file:./local-dev.db" npm test` (`vitest run`) + `npm run build`. All green, no exceptions.
- **Array-form `$transaction([...])` only** — never interactive. (Not expected in this work, but the rule stands.)
- **`lib/security/safe-url.ts` is a never-weaken file.** The PR3 change must be additive, default-off (unset env → byte-identical behavior), and covered by new tests proving the boundary holds. Kevin sign-off required before PR3 build.
- **No new *required-in-prod* env var** (would brick boot via `instrumentation.ts` fail-fast). PR1's `LOGIN_RATE_LIMIT_*` and PR3's `SMOKE_LOOPBACK_TARGET` are all optional/default-off.
- **Commit messages via the Bash tool: NO backticks in `-m`** (shell command substitution). Use plain words.
- **Never `git add -A`/`-u` at repo root** — `pentest-results/`, `.playwright-mcp/`, `googlefc*.html`, `SEO_Report_1st_Draft.pdf` are untracked/sensitive. Stage explicit paths.
- **Component/UI:** dark-mode `dark:` variants on every element; no hydration-mismatch patterns.
- Three PRs ship on three branches; PR1 = `feat/a7-pr1-login-rate-limit` (current), PR2/PR3 branch from updated `main` after each merge.

---

## PR1 — Login rate-limiting

**Branch:** `feat/a7-pr1-login-rate-limit`
**Class:** security-sensitive (auth surface).
**Files:**
- Create: `lib/rate-limit.ts`, `lib/rate-limit.test.ts`
- Modify: `app/api/auth/login/route.ts`, `app/api/auth/login/route.test.ts`
- Modify: `app/(public)/login/page.tsx`

### Task 1.1: `lib/rate-limit.ts` — generic fixed-window limiter

**Files:**
- Create: `lib/rate-limit.ts`
- Test: `lib/rate-limit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RateLimitResult { allowed: boolean; retryAfterSeconds: number; remaining: number }
  export interface FixedWindowLimiter { hit(key: string): RateLimitResult; reset(key: string): void }
  export function createFixedWindowLimiter(opts: {
    max: number; windowMs: number; now?: () => number; maxKeys?: number
  }): FixedWindowLimiter
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/rate-limit.test.ts
import { describe, it, expect } from 'vitest'
import { createFixedWindowLimiter } from './rate-limit'

function fakeClock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('createFixedWindowLimiter', () => {
  it('allows up to max hits then blocks', () => {
    const c = fakeClock()
    const l = createFixedWindowLimiter({ max: 3, windowMs: 1000, now: c.now })
    expect(l.hit('k').allowed).toBe(true)   // 1
    expect(l.hit('k').allowed).toBe(true)   // 2
    expect(l.hit('k').allowed).toBe(true)   // 3
    const blocked = l.hit('k')              // 4
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBe(1)
    expect(blocked.remaining).toBe(0)
  })

  it('rolls the window at exactly windowMs (>= boundary, no Retry-After:0-while-blocked)', () => {
    const c = fakeClock()
    const l = createFixedWindowLimiter({ max: 1, windowMs: 1000, now: c.now })
    expect(l.hit('k').allowed).toBe(true)
    expect(l.hit('k').allowed).toBe(false)
    c.advance(1000) // exactly at the boundary
    expect(l.hit('k').allowed).toBe(true)   // window rolled at ==, not >
  })

  it('reset clears a key', () => {
    const c = fakeClock()
    const l = createFixedWindowLimiter({ max: 1, windowMs: 1000, now: c.now })
    expect(l.hit('k').allowed).toBe(true)
    expect(l.hit('k').allowed).toBe(false)
    l.reset('k')
    expect(l.hit('k').allowed).toBe(true)
  })

  it('keys are independent', () => {
    const c = fakeClock()
    const l = createFixedWindowLimiter({ max: 1, windowMs: 1000, now: c.now })
    expect(l.hit('a').allowed).toBe(true)
    expect(l.hit('b').allowed).toBe(true)
  })

  it('prunes at maxKeys but never evicts the key being evaluated', () => {
    const c = fakeClock()
    const l = createFixedWindowLimiter({ max: 5, windowMs: 100000, now: c.now, maxKeys: 2 })
    l.hit('old1'); c.advance(1); l.hit('old2'); c.advance(1)
    // adding a 3rd distinct key triggers prune; the new key must survive and count as 1
    const r = l.hit('fresh')
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(4) // count is 1, not reset/evicted
  })

  it('coerces invalid config to safe defaults', () => {
    const c = fakeClock()
    // max=0 / negative windowMs must not disable or throw
    const l = createFixedWindowLimiter({ max: 0, windowMs: -5, now: c.now })
    expect(() => l.hit('k')).not.toThrow()
    expect(l.hit('k').allowed).toBe(true) // falls back to a positive default max
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/rate-limit.test.ts`
Expected: FAIL — `createFixedWindowLimiter` is not defined.

- [ ] **Step 3: Implement `lib/rate-limit.ts`**

```ts
// lib/rate-limit.ts
// Generic in-memory fixed-window rate limiter. Correct for this single
// fork-mode process stack (no Redis). Extracted + injectable clock so it is
// deterministically unit-testable (the inlined uploadSizeByIP limiter in
// app/api/upload/route.ts is the precedent this generalizes).

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
  remaining: number
}

export interface FixedWindowLimiter {
  hit(key: string): RateLimitResult
  reset(key: string): void
}

interface Window { count: number; windowStart: number }

const DEFAULT_MAX = 10
const DEFAULT_WINDOW_MS = 15 * 60 * 1000
const DEFAULT_MAX_KEYS = 10_000

export function createFixedWindowLimiter(opts: {
  max: number
  windowMs: number
  now?: () => number
  maxKeys?: number
}): FixedWindowLimiter {
  const now = opts.now ?? (() => Date.now())
  const max = Number.isFinite(opts.max) && opts.max > 0 ? Math.floor(opts.max) : DEFAULT_MAX
  const windowMs =
    Number.isFinite(opts.windowMs) && opts.windowMs > 0 ? Math.floor(opts.windowMs) : DEFAULT_WINDOW_MS
  const maxKeys =
    Number.isFinite(opts.maxKeys) && (opts.maxKeys ?? 0) > 0 ? Math.floor(opts.maxKeys!) : DEFAULT_MAX_KEYS

  const map = new Map<string, Window>()

  function prune(protectKey: string) {
    if (map.size <= maxKeys) return
    const t = now()
    for (const [k, w] of map) {
      if (k === protectKey) continue
      if (t - w.windowStart >= windowMs) map.delete(k)
    }
    if (map.size <= maxKeys) return
    // Still over: drop oldest windowStart first, never the protected key.
    const entries = [...map.entries()]
      .filter(([k]) => k !== protectKey)
      .sort((a, b) => a[1].windowStart - b[1].windowStart)
    for (const [k] of entries) {
      if (map.size <= maxKeys) break
      map.delete(k)
    }
  }

  return {
    hit(key: string): RateLimitResult {
      const t = now()
      let w = map.get(key)
      if (!w || t - w.windowStart >= windowMs) {
        w = { count: 0, windowStart: t }
        map.set(key, w)
      }
      w.count += 1
      prune(key)
      const allowed = w.count <= max
      const remaining = Math.max(0, max - w.count)
      const retryAfterSeconds = allowed
        ? 0
        : Math.max(0, Math.ceil((w.windowStart + windowMs - t) / 1000))
      return { allowed, retryAfterSeconds, remaining }
    },
    reset(key: string) {
      map.delete(key)
    },
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/rate-limit.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/rate-limit.ts lib/rate-limit.test.ts
git commit -m "feat(a7): generic in-memory fixed-window rate limiter"
```

### Task 1.2: Wire the limiter into the login route

**Files:**
- Modify: `app/api/auth/login/route.ts`
- Test: `app/api/auth/login/route.test.ts`

**Interfaces:**
- Consumes: `createFixedWindowLimiter` (Task 1.1), `getClientIp` (`lib/upload-helpers.ts`).
- Produces: `export function __resetLoginLimiter(): void` (test-only reset seam) from `app/api/auth/login/route.ts`.

- [ ] **Step 1: Write the failing tests (extend the existing file)**

Add to `app/api/auth/login/route.test.ts`. Note the existing tests send no IP headers → `getClientIp` returns `'unknown'`, so all requests share one key; the reset seam must run between cases.

**Codex fix #1 — import ordering:** the existing file already does `const { POST } = await import('./route')` AFTER setting `process.env`. A *static* `import { __resetLoginLimiter }` would execute BEFORE the `LOGIN_RATE_LIMIT_*` assignments, so the module singleton would bind the defaults (max 10) not 3. Set the env FIRST, then destructure BOTH from the existing dynamic import.

```ts
// with the existing env block near the top of the file, ADD:
process.env.LOGIN_RATE_LIMIT_MAX = '3'
process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '60000'

// CHANGE the existing dynamic import line to also pull the reset seam:
const { POST, __resetLoginLimiter } = await import('./route')

// CHANGE the existing top-level beforeEach to also reset the limiter:
beforeEach(() => { vi.clearAllMocks(); __resetLoginLimiter() })

// give a request a distinct client IP so cases don't share the 'unknown' key:
function formRequestFromIp(body: Record<string, string>, ip: string): NextRequest {
  const fd = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) fd.set(k, v)
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: fd,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': ip,
    },
  })
}

describe('POST /api/auth/login — rate limiting', () => {
  beforeEach(() => { __resetLoginLimiter() })

  it('blocks with too_many_attempts after max failures from one IP', async () => {
    const ip = '203.0.113.7'
    for (let i = 0; i < 3; i++) await POST(formRequestFromIp({ password: 'wrong' }, ip))
    const res = await POST(formRequestFromIp({ password: 'wrong' }, ip))
    expect(res.headers.get('location') ?? '').toContain('error=too_many_attempts')
    expect(res.headers.get('retry-after')).toBeTruthy()
  })

  it('does not block a different IP', async () => {
    for (let i = 0; i < 5; i++) await POST(formRequestFromIp({ password: 'wrong' }, '203.0.113.7'))
    const res = await POST(formRequestFromIp({ password: 'wrong' }, '198.51.100.9'))
    expect(res.headers.get('location') ?? '').toContain('error=invalid')
    expect(res.headers.get('location') ?? '').not.toContain('too_many_attempts')
  })

  it('successful login resets the IP counter', async () => {
    const ip = '203.0.113.7'
    await POST(formRequestFromIp({ password: 'wrong' }, ip))
    await POST(formRequestFromIp({ password: 'wrong' }, ip))
    await POST(formRequestFromIp({ password: 'pw' }, ip)) // success → reset
    // now three fresh failures are allowed again before blocking
    await POST(formRequestFromIp({ password: 'wrong' }, ip))
    await POST(formRequestFromIp({ password: 'wrong' }, ip))
    const res = await POST(formRequestFromIp({ password: 'wrong' }, ip))
    expect(res.headers.get('location') ?? '').toContain('error=invalid')
  })

  it('ALLOW_PASSWORD_LOGIN=false short-circuits WITHOUT consuming limiter budget', async () => {
    const ip = '203.0.113.7'
    process.env.ALLOW_PASSWORD_LOGIN = 'false'
    try {
      for (let i = 0; i < 5; i++) await POST(formRequestFromIp({ password: 'pw' }, ip))
    } finally { delete process.env.ALLOW_PASSWORD_LOGIN }
    // budget untouched → a real wrong password now still returns invalid, not blocked
    const res = await POST(formRequestFromIp({ password: 'wrong' }, ip))
    expect(res.headers.get('location') ?? '').toContain('error=invalid')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/auth/login/route.test.ts`
Expected: FAIL — `__resetLoginLimiter` not exported / no `too_many_attempts` behavior.

- [ ] **Step 3: Implement the route change**

Edit `app/api/auth/login/route.ts`:

```ts
// add imports
import { createFixedWindowLimiter } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/upload-helpers'

// module scope, after imports:
function readIntEnv(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}
let loginLimiter = createFixedWindowLimiter({
  max: readIntEnv('LOGIN_RATE_LIMIT_MAX', 10),
  windowMs: readIntEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
})
// Test-only reset seam (module-scope singleton would otherwise leak across cases).
export function __resetLoginLimiter(): void {
  loginLimiter = createFixedWindowLimiter({
    max: readIntEnv('LOGIN_RATE_LIMIT_MAX', 10),
    windowMs: readIntEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  })
}
```

In `POST`, AFTER the `ALLOW_PASSWORD_LOGIN=false` short-circuit and BEFORE `verifyPassword`:

```ts
  const ip = getClientIp(request)
  const rl = loginLimiter.hit(ip)
  if (!rl.allowed) {
    const loginUrl = new URL('/login', base)
    loginUrl.searchParams.set('error', 'too_many_attempts')
    loginUrl.searchParams.set('next', nextPath)
    const blocked = NextResponse.redirect(loginUrl, { status: 303 })
    blocked.headers.set('Retry-After', String(rl.retryAfterSeconds))
    return blocked
  }
```

On the **successful** path, before building the success response (i.e. right after `verifyPassword` passes and operatorName is parsed):

```ts
  loginLimiter.reset(ip)
```

(The invalid-password branch stays as-is; the failed `hit` above already counted it.)

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/auth/login/route.test.ts`
Expected: PASS (original 7 + new 4).

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/login/route.ts app/api/auth/login/route.test.ts
git commit -m "feat(a7): rate-limit break-glass password login per client IP"
```

### Task 1.3: Login page copy for the throttle case

**Files:**
- Modify: `app/(public)/login/page.tsx`

- [ ] **Step 1: Inspect the current error handling**

Run: `grep -n "error" app/\(public\)/login/page.tsx`
Read how `error=invalid` (and `password_login_disabled`) are mapped to a message. Follow that exact pattern.

- [ ] **Step 2: Add the `too_many_attempts` message**

Add a branch mapping `error === 'too_many_attempts'` to: "Too many attempts. Please wait a few minutes and try again." Use the SAME element/styling and dark-mode `dark:` classes as the existing `invalid` message (no new component). If errors are mapped via an object/switch, add the key there.

- [ ] **Step 3: Verify build + typecheck**

Run: `npm run lint`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/login/page.tsx"
git commit -m "feat(a7): login page copy for too_many_attempts throttle"
```

### PR1 gate + land

- [ ] Run all three gates: `npm run lint` && `DATABASE_URL="file:./local-dev.db" npm test` && `npm run build`. All green.
- [ ] Docs ritual (hard gate 2) in one commit: tick A7 sub-status in the tracker with a dated status-log line noting PR1; rewrite `HANDOFF-improvement-roadmap.md`.
- [ ] Push, open PR with `gh`, merge when gate-green (rule 1), deploy (`ssh seo@144.126.213.242 "~/deploy.sh"`), prod-verify: a burst of >max bad passwords against prod `/api/auth/login` yields the `too_many_attempts` redirect + `Retry-After`; a correct login still succeeds. Record the result.

---

## PR2 — Per-worker test DBs

**Branch:** `feat/a7-pr2-per-worker-test-dbs` (from updated `main` after PR1).
**Class:** test-infra (no shipped runtime behavior change).
**Files:**
- Create: `test/global-setup.ts`, `test/setup-worker.ts`, `test/worker-db.test.ts` (binding canary)
- Modify: `vitest.config.mts`, `.gitignore`

### Task 2.1: Template DB + per-worker copy + config + canary

**Files:**
- Create: `test/global-setup.ts`, `test/setup-worker.ts`, `test/worker-db.test.ts`
- Modify: `vitest.config.mts`, `.gitignore`

**Interfaces:**
- Produces: each worker binds `process.env.DATABASE_URL` to an absolute
  `file:<root>/.test-dbs/worker-<VITEST_WORKER_ID>.db` before any app module loads.

- [ ] **Step 1: Add `.test-dbs/` to `.gitignore`**

Append a line `\.test-dbs/` (and confirm `.test-dbs/**` is excluded in vitest, Step 4).

- [ ] **Step 2: Write `test/global-setup.ts`**

```ts
// test/global-setup.ts — runs ONCE per `vitest run`, in the main process.
// Builds a single migrated template DB; workers copy it (instant) instead of
// each running migrations. Uses ABSOLUTE paths: Prisma resolves relative
// SQLite URLs against the schema dir (prisma/), NOT repo root.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

export default function setup() {
  const root = process.cwd()
  const dir = resolve(root, '.test-dbs')
  rmSync(dir, { recursive: true, force: true }) // clean stale sidecars too
  mkdirSync(dir, { recursive: true })
  const templatePath = resolve(dir, 'template.db')
  const url = `file:${templatePath}`
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  })
  if (!existsSync(templatePath)) {
    throw new Error(`[test] template DB not created at ${templatePath}`)
  }
  // Codex fix #2 — verify the migrate subprocess left a checkpointed single file
  // (no open WAL). If a sidecar exists, the "copy only template.db" contract in
  // setup-worker.ts would be unsafe, so fail loudly here instead.
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(templatePath + suffix)) {
      throw new Error(`[test] unexpected template${suffix} — WAL not checkpointed; do not copy a live WAL`)
    }
  }
}
```

- [ ] **Step 3: Write `test/setup-worker.ts`**

```ts
// test/setup-worker.ts — a `setupFiles` entry: runs in EACH worker BEFORE any
// test module (and therefore before lib/db.ts constructs its Prisma singleton).
// MUST NOT import any app module (or anything that transitively imports
// lib/db.ts) — raw node builtins only — or the singleton binds the wrong URL.
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const dir = resolve(root, '.test-dbs')
const workerId = process.env.VITEST_WORKER_ID ?? '1'
const templatePath = resolve(dir, 'template.db')
const workerPath = resolve(dir, `worker-${workerId}.db`)

// Idempotent: setupFiles can run per test-file context, not strictly once per
// worker. Copy only if the worker DB does not already exist — never overwrite a
// DB that may already be open under a live Prisma connection.
//
// Codex fix #2 — single verified contract, no sidecar copy. `prisma migrate
// deploy` runs in its own subprocess that fully exits (global-setup asserts no
// leftover template -wal/-shm), so template.db is a checkpointed, self-contained
// file. Copy ONLY template.db. Do NOT copy -wal/-shm: a stale/mismatched WAL
// would make the worker DB inconsistent.
if (!existsSync(workerPath)) {
  copyFileSync(templatePath, workerPath)
}

process.env.DATABASE_URL = `file:${workerPath}`
```

- [ ] **Step 4: Update `vitest.config.mts`**

Remove the `fileParallelism: false` line and its comment. Add, inside `test: { ... }`:

```ts
    pool: 'forks',
    poolOptions: { forks: { maxForks: 4 } },
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-worker.ts'],
```

Add `'.test-dbs/**'` to the existing `exclude` array.

- [ ] **Step 5: Write the binding canary `test/worker-db.test.ts`**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'

describe('per-worker DB binding', () => {
  it('this worker uses its own DB file (not a shared one)', async () => {
    // Codex: type the row shape explicitly (name + file) rather than casting.
    const rows = await prisma.$queryRawUnsafe<Array<{ seq: number; name: string; file: string }>>(
      'PRAGMA database_list'
    )
    const main = rows.find((r) => r.name === 'main') ?? rows[0]
    const file = main?.file ?? ''
    const id = process.env.VITEST_WORKER_ID ?? '1'
    expect(file).toContain('.test-dbs')
    expect(file).toContain(`worker-${id}.db`)
  })
})
```

- [ ] **Step 6: Run the canary alone under the new config**

Run: `npx vitest run test/worker-db.test.ts`
Expected: PASS — proves `DATABASE_URL` bound to a per-worker file and the Prisma singleton picked it up. (No `DATABASE_URL=` prefix now — the setup file sets it.)

- [ ] **Step 7: Commit**

```bash
git add test/global-setup.ts test/setup-worker.ts test/worker-db.test.ts vitest.config.mts .gitignore
git commit -m "feat(a7): per-worker test DB template-copy + parallelism config + binding canary"
```

### Task 2.2: Shared-resource audit + full parallel suite green

**Files:** none created — this is the empirical verification task (may produce small pins).

- [ ] **Step 1: Audit for non-DB shared resources**

Run each and read hits:
```bash
grep -rn "local-dev.db" --include=*.ts --include=*.tsx . | grep -v node_modules | grep -v .claude/worktrees
grep -rln "UPLOADS_DIR\|REPORTS_DIR\|local-uploads\|mkdtemp\|os.tmpdir\|listen(\|\.listen(" --include=*.test.ts . | grep -v node_modules | grep -v .claude/worktrees
```
For any test that writes a FIXED filesystem path or binds a FIXED port, note it — parallel workers must not collide there. (Module-level in-memory singletons are per-process = per-worker, so they reset automatically; the risk is a shared *external* path/port.)

- [ ] **Step 2: Run the FULL suite under parallelism**

Run: `npm test`  (no `DATABASE_URL` prefix needed now; the worker setup overrides it)
Expected: all tests green (baseline was 3358 / 368 files at PR-start — re-count and confirm no regressions).

- [ ] **Step 3: If a file fails only under parallelism**

Diagnose with `superpowers:systematic-debugging`. **Codex fix #3:** `describe.sequential`/`test.sequential` only serialize tests *within* one file — they do NOT stop that file from running concurrently with other files, so they cannot fix a cross-file collision. The two valid fixes, in preference order:
1. **Isolate the shared resource per worker** (the real fix) — key the fixed path/port on `VITEST_WORKER_ID` (e.g. `uploads-${workerId}/`, `port = base + Number(workerId)`), same idea as the per-worker DB. Prefer this.
2. **If a legacy test genuinely cannot be isolated**, move it into a separate, explicitly single-fork vitest project/command (a second config with `poolOptions.forks.maxForks = 1` and its own `include`, run as a distinct `npm` script) so the main parallel run stays the acceptance proof.
Document each isolation/quarantine in the commit message; never revert the whole parallelism change for one file.

- [ ] **Step 4: Record wall-clock**

Run and note before/after:
```bash
/usr/bin/time -p npm test 2>&1 | tail -3   # note real seconds
```
Compare against a serial baseline (`git stash` the config or note the pre-PR time). Put the delta in the tracker status line.

- [ ] **Step 5: Gate + commit any pins**

Run all three gates green. Commit only if Step 3 produced pins:
```bash
git add <pinned test files>
git commit -m "test(a7): pin <file> to serial under parallelism (cross-file <reason>)"
```

### PR2 gate + land

- [ ] Three gates green (`npm test` now runs parallel).
- [ ] Docs ritual in one commit (tracker line + handoff rewrite; note wall-clock delta + any pins).
- [ ] Push, PR, merge gate-green. Deploy is a behavior no-op (test-infra only) but rides the next deploy; confirm prod boots clean after it goes out with a later PR or on its own.

---

## PR3 — Playwright smoke suite

**Branch:** `feat/a7-pr3-playwright-smoke` (from updated `main` after PR2).
**Class:** security-sensitive (touches `lib/security/safe-url.ts`) + test-infra.
**⚠️ Requires Kevin sign-off on the SSRF allowlist (spec §5.1b) BEFORE building Task 3.1.** Fallback if declined: drop the ADA-audit leg (Task 3.3 step for the audit) and skip Task 3.1 entirely.

**Files:**
- Modify: `lib/security/safe-url.ts`, `lib/security/safe-url.test.ts`, `instrumentation.ts`
- Create: `playwright.config.ts`, `smoke/` (specs + fixture server), `test-fixtures/smoke/` (tiny SF export), `package.json` script
- Modify: `.gitignore`, `package.json`, the `er-seo-tools-change-control` skill doc

### Task 3.1: Exact-loopback SSRF allowlist (default-off) + boot guard

**Files:**
- Modify: `lib/security/safe-url.ts`
- Test: `lib/security/safe-url.test.ts`
- Modify: `instrumentation.ts`

**Interfaces:**
- Produces: when `SMOKE_LOOPBACK_TARGET` is set to an exact `host:port` whose host is loopback, `parseSafeHttpUrl`/`resolveSafeHttpUrl`/`assertSafeHttpUrl` permit that exact authority; unset → unchanged.

- [ ] **Step 1: Write failing tests**

**Codex fix #4/#7 — amend the EXISTING `lib/security/safe-url.test.ts` imports** (it already imports from `vitest` and `./safe-url`); add only `afterEach` / any missing named exports to that existing import line — do NOT add a duplicate import block. The allowance also requires smoke mode (fix #5), so tests set both `SMOKE_MODE` and a loopback `NEXT_PUBLIC_APP_URL`.

```ts
// in lib/security/safe-url.test.ts (new describe block; imports amended above)
describe('SMOKE_LOOPBACK_TARGET allowlist', () => {
  const enableSmoke = () => {
    process.env.SMOKE_MODE = 'true'
    process.env.NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:41300'
    process.env.SMOKE_LOOPBACK_TARGET = '127.0.0.1:41234'
  }
  afterEach(() => {
    delete process.env.SMOKE_MODE
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.SMOKE_LOOPBACK_TARGET
  })

  it('unset: loopback is still rejected (default-off, no behavior change)', async () => {
    await expect(assertSafeHttpUrl('http://127.0.0.1:41234/')).rejects.toBeInstanceOf(SafeUrlError)
  })

  it('set + smoke mode: the EXACT authority is permitted', async () => {
    enableSmoke()
    const url = await assertSafeHttpUrl('http://127.0.0.1:41234/audit-target')
    expect(url.host).toBe('127.0.0.1:41234')
  })

  it('set but NOT smoke mode: still rejected (fail closed)', async () => {
    process.env.SMOKE_LOOPBACK_TARGET = '127.0.0.1:41234' // no SMOKE_MODE, non-loopback base URL absent
    await expect(assertSafeHttpUrl('http://127.0.0.1:41234/')).rejects.toBeInstanceOf(SafeUrlError)
  })

  it('smoke mode but NON-loopback app base URL: rejected', async () => {
    process.env.SMOKE_MODE = 'true'
    process.env.NEXT_PUBLIC_APP_URL = 'https://seo.example.com'
    process.env.SMOKE_LOOPBACK_TARGET = '127.0.0.1:41234'
    await expect(assertSafeHttpUrl('http://127.0.0.1:41234/')).rejects.toBeInstanceOf(SafeUrlError)
  })

  it('set: a DIFFERENT loopback port is still rejected', async () => {
    enableSmoke()
    await expect(assertSafeHttpUrl('http://127.0.0.1:9999/')).rejects.toBeInstanceOf(SafeUrlError)
  })

  it('set: private (non-loopback) and link-local hosts still rejected', async () => {
    enableSmoke()
    await expect(assertSafeHttpUrl('http://10.0.0.5:41234/')).rejects.toBeInstanceOf(SafeUrlError)
    await expect(assertSafeHttpUrl('http://169.254.169.254:41234/')).rejects.toBeInstanceOf(SafeUrlError)
  })

  it('portless target env is refused (no implicit port 80)', async () => {
    process.env.SMOKE_MODE = 'true'
    process.env.NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:41300'
    process.env.SMOKE_LOOPBACK_TARGET = '127.0.0.1' // no port
    await expect(assertSafeHttpUrl('http://127.0.0.1/')).rejects.toBeInstanceOf(SafeUrlError)
  })

  it('parseSafeHttpUrl honors the same exact-authority allowance', () => {
    enableSmoke()
    const u = parseSafeHttpUrl('http://127.0.0.1:41234/x')
    expect(u.host).toBe('127.0.0.1:41234')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/security/safe-url.test.ts`
Expected: the new cases FAIL (loopback still rejected even when the env is set).

- [ ] **Step 3: Implement the allowlist in `lib/security/safe-url.ts`**

Add a helper near the top (after the constants):

```ts
// Test-only, default-OFF loopback allowance for the Playwright smoke suite.
// SMOKE_LOOPBACK_TARGET names ONE exact host:port; only that authority is let
// through, and ONLY when the app is running in smoke mode (SMOKE_MODE=true AND
// a loopback NEXT_PUBLIC_APP_URL). A normal deployed app (public base URL, no
// SMOKE_MODE) never honors it — and instrumentation.ts refuses to boot if it is
// set outside smoke mode. So it can never widen SSRF in production; the worst a
// misconfig reaches is one self-loopback port during a smoke run. Unset → byte-
// identical behavior to before.
function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}
// Parse a host:port authority structurally (Codex #4): new URL handles IPv6
// brackets; require an explicit non-empty port and a loopback hostname.
function parseLoopbackAuthority(value: string): { host: string } | null {
  let u: URL
  try { u = new URL('http://' + value) } catch { return null }
  if (!u.port) return null                 // no implicit port 80
  if (!isLoopbackHostname(u.hostname)) return null
  if (u.pathname !== '/' && u.pathname !== '') return null
  return { host: u.host }                   // normalized hostname:port
}
function smokeModeActive(): boolean {
  if (process.env.SMOKE_MODE !== 'true') return false
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) return false
  try { return isLoopbackHostname(new URL(base).hostname) } catch { return false }
}
export function allowlistedSmokeAuthority(parsed: URL): boolean {
  if (!smokeModeActive()) return false
  const target = process.env.SMOKE_LOOPBACK_TARGET
  if (!target) return false
  const allowed = parseLoopbackAuthority(target)
  return allowed !== null && parsed.host === allowed.host
}
```

In `parseSafeHttpUrl`, after the protocol + credentials checks and BEFORE `assertPublicHostname(parsed.hostname)`:

```ts
  if (allowlistedSmokeAuthority(parsed)) return parsed
```

In `resolveSafeHttpUrl`, at the very top (after `const parsed = parseSafeHttpUrl(input)`), short-circuit the DNS/private-address checks for the allowlisted authority:

```ts
  if (allowlistedSmokeAuthority(parsed)) {
    return { url: parsed, addresses: [{ address: '127.0.0.1', family: 4 }] }
  }
```

(Note: `parseSafeHttpUrl` returning early means it won't throw for the loopback host; `resolveSafeHttpUrl` calls it, then also returns early, skipping the `isPrivateOrInternalAddress` rejection.)

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/security/safe-url.test.ts`
Expected: PASS (all existing + 5 new). Existing SSRF-rejection tests MUST still pass (default-off).

- [ ] **Step 5: Add the `instrumentation.ts` boot guard**

Find the production fail-fast block (the `PILLAR_TOKEN_SECRET` / `APP_AUTH_PASSWORD` / egress-guard `process.exit(1)` cluster). Add a check that runs regardless of NODE_ENV (the smoke runs in production mode, so a NODE_ENV gate would be wrong):

```ts
  // Smoke-only loopback audit allowance (Codex #4/#5 — fail CLOSED outside smoke
  // mode). If SMOKE_LOOPBACK_TARGET is set, the app must be unambiguously in
  // smoke mode: SMOKE_MODE=true AND a loopback NEXT_PUBLIC_APP_URL AND the target
  // itself a loopback host:port with an explicit port. ANY other combination
  // (e.g. a real RunCloud deploy with a public base URL) is a misconfiguration
  // we refuse to boot with — so a stray SMOKE_LOOPBACK_TARGET can never widen
  // SSRF in production.
  if (process.env.NODE_ENV === 'production' && process.env.SMOKE_LOOPBACK_TARGET) {
    const isLoopback = (h?: string) =>
      h === 'localhost' || h === '127.0.0.1' || h === '::1'
    let targetOk = false
    try {
      const u = new URL('http://' + process.env.SMOKE_LOOPBACK_TARGET)
      targetOk = Boolean(u.port) && isLoopback(u.hostname.toLowerCase())
    } catch { targetOk = false }
    let baseOk = false
    try {
      baseOk = isLoopback(new URL(process.env.NEXT_PUBLIC_APP_URL ?? '').hostname.toLowerCase())
    } catch { baseOk = false }
    const smokeMode = process.env.SMOKE_MODE === 'true'
    if (!(smokeMode && baseOk && targetOk)) {
      console.error(
        '[startup] SMOKE_LOOPBACK_TARGET is set outside smoke mode (needs SMOKE_MODE=true + loopback NEXT_PUBLIC_APP_URL + loopback host:port target). Refusing to start.'
      )
      process.exit(1)
    }
    console.warn(
      `[startup] SMOKE MODE — loopback audit target ${process.env.SMOKE_LOOPBACK_TARGET} allowlisted. Never set these in a real deployment.`
    )
  }
```

- [ ] **Step 6: Typecheck + full security test file**

Run: `npm run lint && DATABASE_URL="file:./local-dev.db" npx vitest run lib/security/safe-url.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/security/safe-url.ts lib/security/safe-url.test.ts instrumentation.ts
git commit -m "feat(a7): default-off exact-loopback SSRF allowlist for smoke + boot guard"
```

### Task 3.2: Playwright deps, config, fixture server, smoke harness

**Files:**
- Modify: `package.json`, `.gitignore`
- Create: `playwright.config.ts`, `smoke/fixture-server.mjs`, `test-fixtures/smoke/` (tiny SF export)

- [ ] **Step 1: Add Playwright (dev dep, pinned) and the smoke script**

Run: `npm install -D @playwright/test` then `npx playwright install chromium`.
Add to `package.json` scripts:
```json
"smoke": "playwright test --config=playwright.config.ts"
```
Add `.gitignore` lines: `\.smoke-db/`, `test-results/`, `playwright-report/`, `\.smoke-uploads/`, `\.smoke-reports/`.

- [ ] **Step 2: Create the local fixture HTTP server `smoke/fixture-server.mjs`**

```js
// smoke/fixture-server.mjs — a tiny loopback static page for the single-page
// ADA audit target. NEVER a third-party site. Port from FIXTURE_PORT.
import { createServer } from 'node:http'
const port = Number(process.env.FIXTURE_PORT || 41234)
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Smoke Fixture</title></head><body>
<h1>Smoke audit target</h1>
<img src="/logo.png">
<a href="#main">skip</a>
<p>Content for the accessibility audit.</p>
</body></html>`
createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(html)
}).listen(port, '127.0.0.1', () => console.log(`[fixture] http://127.0.0.1:${port}`))
```

- [ ] **Step 3: Create the tiny SF export fixture `test-fixtures/smoke/`**

Build the smallest valid Screaming Frog export the SEO upload accepts. Determine the required CSV(s) and headers from the parser layer:
```bash
grep -rn "expectedExports\|parserKey\|internal_all\|internal_html\|required" lib/parsers/expected-exports.ts | head
```
Create the minimal CSV set (2–3 data rows) matching those exact filenames + headers under `test-fixtures/smoke/`. Verify it parses by pointing an existing parser unit test or a quick `npx tsx` probe at it before wiring the UI step. (This fixture is committed — it is synthetic, not a real crawl.)

- [ ] **Step 4: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const PORT = 41300
const FIXTURE_PORT = 41234
const root = process.cwd()
const smokeDbUrl = `file:${resolve(root, '.smoke-db/smoke.db')}`

export default defineConfig({
  testDir: './smoke',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: [
    {
      // fixture target server
      command: 'node smoke/fixture-server.mjs',
      env: { FIXTURE_PORT: String(FIXTURE_PORT) },
      url: `http://127.0.0.1:${FIXTURE_PORT}`,
      reuseExistingServer: false,
    },
    {
      // the built app in production mode with the full prod env set
      command:
        'npx prisma migrate deploy && next start -p ' + PORT,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: smokeDbUrl,
        // Codex #6 — instrumentation.ts fail-fasts in production without this:
        PILLAR_TOKEN_SECRET: 'smoke-pillar-secret',
        APP_AUTH_SECRET: 'smoke-secret',
        APP_AUTH_PASSWORD: 'smoke-pw',
        ALLOW_PASSWORD_LOGIN: 'true',
        NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
        UPLOADS_DIR: resolve(root, '.smoke-uploads'),
        REPORTS_DIR: resolve(root, '.smoke-reports'),
        CHROMIUM_NETWORK_ISOLATED: 'true',
        // On a macOS workstation set CHROME_EXECUTABLE to the local Chrome path
        // (the Linux default below only works on the server / Linux CI).
        CHROME_EXECUTABLE:
          process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome',
        // Smoke-mode signals — the SSRF allowance is honored ONLY with all three:
        SMOKE_MODE: 'true',
        SMOKE_LOOPBACK_TARGET: `127.0.0.1:${FIXTURE_PORT}`,
      },
    },
  ],
})
```

Note in the smoke README/comment: **the app must be built first** with `NEXT_PUBLIC_APP_URL` set (it is compile-time-inlined). The `smoke` script chain must run `NEXT_PUBLIC_APP_URL=http://127.0.0.1:41300 npm run build` before `playwright test` — add a `pretest`-style wrapper or document it in Task 3.4.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore playwright.config.ts smoke/fixture-server.mjs test-fixtures/smoke
git commit -m "feat(a7): playwright config, loopback fixture server, tiny SF smoke fixture"
```

### Task 3.3: The smoke spec

**Files:**
- Create: `smoke/happy-path.spec.ts`

**Codex fix #7 — derive EXACT locators from the real components, don't guess.**
Ground the selectors in these files before writing the spec (read them, then pin
the exact tab label / toggle / expand control / file input / completion signal /
submit button / score text):
- Single-page audit form: `components/ada-audit/AuditForm.tsx` — the URL input is
  `#audit-url` (`type="text"`, NOT a `name="url"`/`type="url"` field). Use
  `page.locator('#audit-url')`.
- Scan-type tabs / page structure: `app/(app)/ada-audit/page.tsx`,
  `components/ada-audit/AuditIndexTabs.tsx`, `components/ada-audit/SiteAuditForm.tsx`.
- SF upload: `components/seo-parser/SeoUploadCard.tsx` → `FileDropzone`
  (`components/seo-parser/FileDropzone.tsx`, react-dropzone). The file input is a
  hidden `input[type="file"]` rendered by `getInputProps()`; drive it with
  `page.setInputFiles(...)` on that hidden input (Playwright can set files on a
  hidden input by locator; expand/reveal the SEO upload section first if it is
  collapsed under the SEO scan-type path).

- [ ] **Step 1: Write the smoke spec (fill the TODO locators from the files above)**

```ts
// smoke/happy-path.spec.ts
import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'

const FIXTURE_URL = 'http://127.0.0.1:41234/'

test('login → upload SF → parse → report → single-page audit → complete', async ({ page }) => {
  // 1. LOGIN: a gated page redirects to /login; submit the break-glass password.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await page.fill('input[name="password"]', 'smoke-pw')
  await page.click('button[type="submit"]')
  await expect(page).not.toHaveURL(/\/login/)

  // 2. UPLOAD → PARSE → REPORT.
  await page.goto('/ada-audit')
  // <<< switch Scan Type to SEO + expand the SeoUploadCard (exact tab/toggle from
  //     AuditIndexTabs.tsx / SiteAuditForm.tsx) >>>
  await page.locator('input[type="file"]').setInputFiles([
    resolve(process.cwd(), 'test-fixtures/smoke/internal_all.csv'),
    // ...the rest of the minimal fixture set from Task 3.2 Step 3
  ])
  // wait for the parse session to complete and the report/results to render
  // (assert on the exact completion text seen in the results UI):
  await expect(page.getByText(/health score|results|report/i).first()).toBeVisible({ timeout: 60_000 })

  // 3. SINGLE-PAGE ADA AUDIT → COMPLETE against the loopback fixture.
  await page.goto('/ada-audit')
  await page.locator('#audit-url').fill(FIXTURE_URL)
  // <<< click the AuditForm submit button (exact label from AuditForm.tsx) >>>
  await page.getByRole('button', { name: /audit|scan|run/i }).first().click()
  // poll the live progress UI until the audit reaches complete with a score:
  await expect(page.getByText(/score|complete/i).first()).toBeVisible({ timeout: 90_000 })
})
```

> The `<<< >>>` markers are the two spots that MUST be replaced with the exact
> locators read from the named component files — they are the known-friction
> points of any E2E, not placeholders to ship as-is.

- [ ] **Step 2: Build the app with the inlined base URL, then run the smoke**

Run:
```bash
rm -rf .smoke-db .smoke-uploads .smoke-reports && mkdir -p .smoke-db
NEXT_PUBLIC_APP_URL=http://127.0.0.1:41300 npm run build
npm run smoke
```
Expected: the spec passes end-to-end. Iterate on selectors against the real UI (this is the expected friction — assert on stable, user-visible text, not brittle DOM).

- [ ] **Step 3: Commit**

```bash
git add smoke/happy-path.spec.ts
git commit -m "feat(a7): playwright happy-path smoke (login/upload/parse/report/audit)"
```

### Task 3.4: `smoke` script wrapper + change-control doc

**Files:**
- Modify: `package.json`, `.claude/skills/er-seo-tools-change-control/SKILL.md` (the gate list)

- [ ] **Step 1: Make `npm run smoke` self-contained**

Replace the `smoke` script so it builds with the inlined URL and cleans dirs first:
```json
"smoke": "rm -rf .smoke-db .smoke-uploads .smoke-reports && mkdir -p .smoke-db && NEXT_PUBLIC_APP_URL=http://127.0.0.1:41300 npm run build && playwright test --config=playwright.config.ts"
```
Run: `npm run smoke` → PASS from a clean state.

- [ ] **Step 2: Document the gate in change-control**

In `.claude/skills/er-seo-tools-change-control/SKILL.md`, under the gate commands / pipeline, add `npm run smoke` as a **local pre-merge gate** for PRs touching auth, upload/parse, or the audit pipeline — explicitly noting it is NOT wired into `~/deploy.sh` (prod OOM) and NOT CI.

- [ ] **Step 3: Commit**

```bash
git add package.json ".claude/skills/er-seo-tools-change-control/SKILL.md"
git commit -m "docs(a7): document npm run smoke as a local pre-merge gate"
```

### PR3 gate + land

- [ ] Three gates green (`npm run lint` + `npm test` + `npm run build`) AND `npm run smoke` green.
- [ ] `audit:ci` green (security class).
- [ ] Docs ritual in one commit: mark A7 **complete** in the tracker with a dated status-log line covering all three PRs; rewrite handoff; **move the spec + plan to `docs/superpowers/archive/`** (`git mv`).
- [ ] Push, PR (call out the SSRF `safe-url.ts` change + Kevin sign-off in the description), merge gate-green, deploy, prod-verify: `SMOKE_LOOPBACK_TARGET` unset in prod, clean boot, a normal single-page audit against a real client URL still SSRF-guards as before.

---

## Self-Review

**Spec coverage:** PR1 §3.1→Task 1.1, §3.2→Task 1.2, §3.3→Task 1.3, §3.4 tests folded into 1.1/1.2. PR2 §4.1→Task 2.1 (absolute paths, idempotent WAL-aware copy, import hygiene), §4.2→Task 2.1 Step 4 (forks/maxForks), §4.3→Task 2.1 Step 5 canary + Task 2.2 audit, §4.5→Task 2.2. PR3 §5.1a→Task 3.2 config env, §5.1b→Task 3.1, §5.2→Task 3.3, §5.3→Task 3.4, §5.4→PR3 land. §8 verify items map to PR1/PR2/PR3 prod-verify + audit steps. Covered.

**Placeholder scan:** the only deferred concretes are (a) exact SF-fixture CSV filenames/headers (Task 3.2 Step 3 gives the exact command to derive them from `expected-exports.ts` — a real instruction, not a placeholder) and (b) Playwright selectors (Task 3.3 explicitly says confirm against the real UI — inherent to E2E authoring). No "TODO/TBD/handle edge cases" left.

**Type consistency:** `createFixedWindowLimiter`/`RateLimitResult`/`FixedWindowLimiter` consistent across 1.1↔1.2; `__resetLoginLimiter` destructured from the dynamic `await import('./route')` (Codex #1) and used in its test; `getClientIp` matches `lib/upload-helpers.ts`; `allowlistedSmokeAuthority`/`isLoopbackHostname`/`parseLoopbackAuthority`/`smokeModeActive` consistent within 3.1; the smoke SSRF exception keys on the SAME three signals in safe-url AND instrumentation (`SMOKE_MODE=true` + loopback `NEXT_PUBLIC_APP_URL` + exact loopback `SMOKE_LOOPBACK_TARGET`), and playwright config sets all three; canary rows typed `{seq,name,file}`.

**Codex plan review (2026-07-11): accept-with-named-fixes ×7** — all applied above (test import ordering, no-WAL-copy contract, valid cross-file isolation, structural authority parse, fail-closed smoke guard, `PILLAR_TOKEN_SECRET` in smoke env, verified locators).
