# D0 — Ops Safety (DB Backup + Failure Alert) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app durable DB-backup job and an in-app failure-alert job so production can survive data loss and notice its own failures — the minimal ops-safety layer for D0.

**Architecture:** Two new durable job types reusing the existing queue + system-schedule pattern. `db-backup` runs `VACUUM INTO` a temp file then atomic-renames a timestamped snapshot under `BACKUP_DIR`, pruning to the last N. `health-alert` evaluates four failure conditions and POSTs a message to an optional `ALERT_WEBHOOK_URL`, deduping via an atomic JSON state file (no schema migration). Both are seeded into `SYSTEM_SCHEDULES`.

**Tech Stack:** Next.js 15 / TypeScript, Prisma + SQLite (WAL), the durable job queue in `lib/jobs/`, `fs/promises`, vitest.

## Global Constraints

- **Node 22, SQLite only, single PM2 fork, no serverless.** All the code assumes one long-lived process (module-level registry, one-writer job worker).
- **Array-form `$transaction([...])` only** — never interactive `$transaction(async tx => ...)`. The one raw statement here (`VACUUM INTO`) runs as a bare `$executeRawUnsafe`, never inside a transaction (VACUUM cannot run in a transaction).
- **`AdaAudit` has NO `updatedAt`** — only `createdAt` / `status` / `completedAt`. Edge-trigger ADA errors on `completedAt`.
- **No required-in-prod env vars.** Every new env var has a safe default; an unset var must never `process.exit(1)` at boot. `ALERT_WEBHOOK_URL` unset → alerts computed + logged, not sent.
- **Webhook URL is trusted operator config, not user input** — a plain timed `fetch`, not `safeFetch`.
- **Never throw from the alert path** — a webhook or FS failure must not fail the job or lose an alert.
- **Local dev / test commands** prefix Prisma + vitest with `DATABASE_URL="file:./local-dev.db"`.
- Gate-green before PR: `npm run lint` (tsc) + `npm test` (vitest run) + `npm run build`.

---

## File Structure

- `lib/ops/backup.ts` — `runDbBackup()` (VACUUM INTO tmp + rename + prune) and `newestBackupMtime()`. Reusable by handler + script.
- `lib/ops/backup.test.ts` — DB-backed.
- `lib/ops/alert-state.ts` — `readAlertState()` / `writeAlertState()` (atomic JSON).
- `lib/ops/alert-state.test.ts`.
- `lib/ops/alert-webhook.ts` — `sendAlert()`.
- `lib/ops/alert-webhook.test.ts`.
- `lib/ops/health-check.ts` — `evaluateHealth()` (pure) + `collectHealthSignals()` (DB/FS) + types + config readers.
- `lib/ops/health-check.test.ts` — pure evaluator (no DB).
- `lib/ops/health-check.collect.test.ts` — DB-backed collector.
- `lib/jobs/handlers/db-backup.ts` — `DB_BACKUP_JOB_TYPE`, `registerDbBackupHandler()`.
- `lib/jobs/handlers/db-backup.test.ts`.
- `lib/jobs/handlers/health-alert.ts` — `HEALTH_ALERT_JOB_TYPE`, `registerHealthAlertHandler()`.
- `lib/jobs/handlers/health-alert.test.ts`.
- `scripts/db-backup.ts` — thin `npx tsx` manual-run wrapper.
- Modify `lib/jobs/handlers/register.ts` — register the two new handlers.
- Modify `lib/jobs/system-schedules.ts` — add `system-db-backup` + `system-health-alert`.
- Modify `ecosystem.config.js` — add `BACKUP_DIR` (+ commented `ALERT_WEBHOOK_URL` placeholder).

---

## Task 1: Backup runner

**Files:**
- Create: `lib/ops/backup.ts`
- Test: `lib/ops/backup.test.ts`

**Interfaces:**
- Produces:
  - `backupDir(): string` — `process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups')`.
  - `runDbBackup(opts?: { now?: Date; retention?: number }): Promise<{ file: string; bytes: number; prunedCount: number }>`.
  - `newestBackupMtimeMs(): Promise<number | null>` — max mtime of `db-*.sqlite` in `backupDir()`, or `null` when none.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/ops/backup.test.ts
// Run: DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/backup.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { PrismaClient } from '@prisma/client'
import { runDbBackup, newestBackupMtimeMs } from './backup'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-'))
  vi.stubEnv('BACKUP_DIR', tmpDir)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('runDbBackup', () => {
  it('writes a valid SQLite snapshot and leaves no .tmp', async () => {
    const res = await runDbBackup()
    expect(res.bytes).toBeGreaterThan(0)
    const entries = await fs.readdir(tmpDir)
    expect(entries.some((e) => /^db-.*\.sqlite$/.test(e))).toBe(true)
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false)
    // The snapshot opens as a real DB.
    const c = new PrismaClient({ datasources: { db: { url: `file:${res.file}` } } })
    try {
      const rows = await c.$queryRawUnsafe<Array<{ n: number }>>(
        "SELECT count(*) as n FROM sqlite_master WHERE type='table'",
      )
      expect(Number(rows[0].n)).toBeGreaterThan(0)
    } finally {
      await c.$disconnect()
    }
  })

  it('prunes to the newest `retention` snapshots', async () => {
    // Seed 5 fake older snapshots.
    for (let i = 1; i <= 5; i++) {
      await fs.writeFile(path.join(tmpDir, `db-2026010${i}-000000000-aaaa.sqlite`), 'x')
    }
    const res = await runDbBackup({ retention: 3 })
    expect(res.prunedCount).toBeGreaterThanOrEqual(3) // 6 files (5 seeded + new) → keep 3
    const remaining = (await fs.readdir(tmpDir)).filter((e) => /^db-.*\.sqlite$/.test(e))
    expect(remaining.length).toBe(3)
    expect(remaining).toContain(path.basename(res.file)) // the newest is kept
  })

  it('newestBackupMtimeMs returns null when the dir is empty', async () => {
    expect(await newestBackupMtimeMs()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/backup.test.ts`
Expected: FAIL — `runDbBackup` / `newestBackupMtimeMs` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/ops/backup.ts
import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@/lib/db'

// Read at call time (not module load) so env stubbing in tests takes effect.
function defaultRetention(): number {
  return Number(process.env.BACKUP_RETENTION_COUNT) || 7
}

export function backupDir(): string {
  return process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups')
}

function stamp(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const rand = Math.floor(Math.random() * 1e6).toString(36).padStart(4, '0')
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}${p(now.getUTCMilliseconds(), 3)}` +
    `-${rand}`
  )
}

async function listSnapshots(dir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return entries.filter((e) => /^db-.*\.sqlite$/.test(e)).sort() // timestamp sorts lexicographically
}

export async function newestBackupMtimeMs(): Promise<number | null> {
  const dir = backupDir()
  const snaps = await listSnapshots(dir)
  if (snaps.length === 0) return null
  let newest = 0
  for (const name of snaps) {
    const st = await fs.stat(path.join(dir, name))
    if (st.mtimeMs > newest) newest = st.mtimeMs
  }
  return newest
}

export async function runDbBackup(
  opts: { now?: Date; retention?: number } = {},
): Promise<{ file: string; bytes: number; prunedCount: number }> {
  const now = opts.now ?? new Date()
  const retention = opts.retention ?? defaultRetention()
  const dir = backupDir()
  await fs.mkdir(dir, { recursive: true })

  const base = `db-${stamp(now)}.sqlite`
  const finalPath = path.join(dir, base)
  const tmpPath = `${finalPath}.tmp`

  // VACUUM INTO fails if the target exists; the tmp name is unique, but be defensive.
  await fs.rm(tmpPath, { force: true })
  // Bare statement — VACUUM cannot run inside a transaction. Path is app-constructed (no user input).
  await prisma.$executeRawUnsafe(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`)
  await fs.rename(tmpPath, finalPath)

  const bytes = (await fs.stat(finalPath)).size

  // Prune: keep the newest `retention` final snapshots.
  const snaps = await listSnapshots(dir)
  const doomed = snaps.slice(0, Math.max(0, snaps.length - retention))
  for (const name of doomed) {
    await fs.rm(path.join(dir, name), { force: true })
  }
  return { file: finalPath, bytes, prunedCount: doomed.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/backup.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ops/backup.ts lib/ops/backup.test.ts
git commit -m "feat(ops): D0 DB backup runner (VACUUM INTO + atomic rename + prune)"
```

---

## Task 2: db-backup job handler + schedule

**Files:**
- Create: `lib/jobs/handlers/db-backup.ts`
- Test: `lib/jobs/handlers/db-backup.test.ts`
- Modify: `lib/jobs/handlers/register.ts`
- Modify: `lib/jobs/system-schedules.ts`

**Interfaces:**
- Consumes: `runDbBackup` (Task 1).
- Produces: `DB_BACKUP_JOB_TYPE = 'db-backup'`, `registerDbBackupHandler()`.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/jobs/handlers/db-backup.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const runDbBackup = vi.fn()
vi.mock('@/lib/ops/backup', () => ({ runDbBackup }))

import { registerDbBackupHandler, DB_BACKUP_JOB_TYPE } from './db-backup'
import { getJobHandler, clearJobRegistryForTests } from '../registry'

beforeEach(() => {
  clearJobRegistryForTests()
  runDbBackup.mockReset()
})

describe('db-backup handler', () => {
  it('registers with concurrency 1', () => {
    registerDbBackupHandler()
    const cfg = getJobHandler(DB_BACKUP_JOB_TYPE)
    expect(cfg?.concurrency).toBe(1)
  })

  it('calls runDbBackup and rethrows on failure', async () => {
    registerDbBackupHandler()
    const cfg = getJobHandler(DB_BACKUP_JOB_TYPE)!
    runDbBackup.mockResolvedValueOnce({ file: '/x/db.sqlite', bytes: 10, prunedCount: 0 })
    const ctx = { jobId: 'j', attempt: 1, signal: new AbortController().signal }
    await expect(cfg.handler({}, ctx)).resolves.toBeUndefined()
    expect(runDbBackup).toHaveBeenCalledOnce()
    runDbBackup.mockRejectedValueOnce(new Error('disk full'))
    await expect(cfg.handler({}, ctx)).rejects.toThrow('disk full')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/db-backup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/jobs/handlers/db-backup.ts
//
// Scheduled DB backup (D0). VACUUM INTO a timestamped snapshot, prune to N.
// maxAttempts 2: a transient FS/lock error retries once; the next daily slot
// is the ultimate retry. A throw correctly fails the job → visible in
// introspection and feeds the health-alert 'jobs-exhausted' condition.
import { runDbBackup } from '@/lib/ops/backup'
import { registerJobHandler } from '../registry'

export const DB_BACKUP_JOB_TYPE = 'db-backup'

export function registerDbBackupHandler(): void {
  registerJobHandler({
    type: DB_BACKUP_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 2,
    timeoutMs: 10 * 60 * 1000,
    handler: async () => {
      const res = await runDbBackup()
      console.log(`[db-backup] wrote ${res.file} (${res.bytes} bytes), pruned ${res.prunedCount}`)
    },
  })
}
```

Then register it — add to `lib/jobs/handlers/register.ts`:

```typescript
import { registerDbBackupHandler } from './db-backup'
// ...inside registerBuiltInJobHandlers():
  registerDbBackupHandler()
```

Then seed the schedule — in `lib/jobs/system-schedules.ts`, add the import and array entry:

```typescript
import { DB_BACKUP_JOB_TYPE } from './handlers/db-backup'
// ...inside SYSTEM_SCHEDULES (append):
  // Fresh snapshot before system-cleanup (09:00) runs its retention deletes.
  { name: 'system-db-backup', jobType: DB_BACKUP_JOB_TYPE, cadence: 'daily@08:00', immediate: false },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/db-backup.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/db-backup.ts lib/jobs/handlers/db-backup.test.ts lib/jobs/handlers/register.ts lib/jobs/system-schedules.ts
git commit -m "feat(ops): D0 db-backup job type + daily system schedule"
```

---

## Task 3: Alert state (atomic JSON)

**Files:**
- Create: `lib/ops/alert-state.ts`
- Test: `lib/ops/alert-state.test.ts`

**Interfaces:**
- Produces:
  - `interface AlertState { lastCheckAt: number; cooldowns: Record<string, number> }`
  - `readAlertState(): Promise<AlertState>` — missing/corrupt → `{ lastCheckAt: 0, cooldowns: {} }`.
  - `writeAlertState(s: AlertState): Promise<void>` — temp file + rename.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/ops/alert-state.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { readAlertState, writeAlertState } from './alert-state'

let tmpDir: string
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'as-'))
  vi.stubEnv('BACKUP_DIR', tmpDir)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('alert-state', () => {
  it('round-trips', async () => {
    await writeAlertState({ lastCheckAt: 123, cooldowns: { 'queue-stalled': 99 } })
    expect(await readAlertState()).toEqual({ lastCheckAt: 123, cooldowns: { 'queue-stalled': 99 } })
  })
  it('missing file → default', async () => {
    expect(await readAlertState()).toEqual({ lastCheckAt: 0, cooldowns: {} })
  })
  it('corrupt JSON → default', async () => {
    await fs.writeFile(path.join(tmpDir, 'alert-state.json'), '{not json')
    expect(await readAlertState()).toEqual({ lastCheckAt: 0, cooldowns: {} })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/alert-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/ops/alert-state.ts
import { promises as fs } from 'fs'
import path from 'path'
import { backupDir } from './backup'

export interface AlertState {
  lastCheckAt: number
  cooldowns: Record<string, number>
}

const DEFAULT_STATE: AlertState = { lastCheckAt: 0, cooldowns: {} }

function statePath(): string {
  return path.join(backupDir(), 'alert-state.json')
}

export async function readAlertState(): Promise<AlertState> {
  try {
    const raw = await fs.readFile(statePath(), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      lastCheckAt: typeof parsed.lastCheckAt === 'number' ? parsed.lastCheckAt : 0,
      cooldowns: parsed.cooldowns && typeof parsed.cooldowns === 'object' ? parsed.cooldowns : {},
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export async function writeAlertState(s: AlertState): Promise<void> {
  const dir = backupDir()
  await fs.mkdir(dir, { recursive: true })
  const rand = Math.floor(Math.random() * 1e9).toString(36)
  const tmp = path.join(dir, `alert-state.json.${process.pid}.${rand}.tmp`)
  await fs.writeFile(tmp, JSON.stringify(s), 'utf8')
  await fs.rename(tmp, statePath())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/alert-state.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ops/alert-state.ts lib/ops/alert-state.test.ts
git commit -m "feat(ops): D0 alert-state atomic JSON store"
```

---

## Task 4: Alert webhook sender

**Files:**
- Create: `lib/ops/alert-webhook.ts`
- Test: `lib/ops/alert-webhook.test.ts`

**Interfaces:**
- Produces: `sendAlert(text: string): Promise<{ sent: boolean; skipped: boolean }>`.
  - URL unset → `{ sent:false, skipped:true }` (dark; logs once).
  - 2xx → `{ sent:true, skipped:false }`; non-2xx / throw / timeout → `{ sent:false, skipped:false }`. Never throws.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/ops/alert-webhook.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendAlert } from './alert-webhook'

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.unstubAllEnvs())

describe('sendAlert', () => {
  it('URL unset → skipped, no fetch', async () => {
    vi.unstubAllEnvs()
    delete process.env.ALERT_WEBHOOK_URL
    const f = vi.spyOn(globalThis, 'fetch')
    expect(await sendAlert('hi')).toEqual({ sent: false, skipped: true })
    expect(f).not.toHaveBeenCalled()
  })
  it('URL set + 2xx → sent, one POST with {text}', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/x')
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    expect(await sendAlert('boom')).toEqual({ sent: true, skipped: false })
    expect(f).toHaveBeenCalledOnce()
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ text: 'boom' })
  })
  it('fetch rejection is swallowed → not sent, not skipped', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/x')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    expect(await sendAlert('boom')).toEqual({ sent: false, skipped: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/alert-webhook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/ops/alert-webhook.ts
//
// D0 failure-alert delivery. ALERT_WEBHOOK_URL is trusted operator config
// (not user input), so a plain timed fetch is correct — NOT safeFetch, which
// would block a legitimately-internal endpoint. Never throws.
export async function sendAlert(text: string): Promise<{ sent: boolean; skipped: boolean }> {
  const url = process.env.ALERT_WEBHOOK_URL
  if (!url) {
    console.log(`[health-alert] webhook unset; alert not sent: ${text}`)
    return { sent: false, skipped: true }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    })
    if (res.ok) return { sent: true, skipped: false }
    console.warn(`[health-alert] webhook responded ${res.status}`)
    return { sent: false, skipped: false }
  } catch (err) {
    console.warn(`[health-alert] webhook post failed: ${(err as Error).message}`)
    return { sent: false, skipped: false }
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/alert-webhook.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ops/alert-webhook.ts lib/ops/alert-webhook.test.ts
git commit -m "feat(ops): D0 alert webhook sender (sent/skipped split)"
```

---

## Task 5: Health evaluator (pure)

**Files:**
- Create: `lib/ops/health-check.ts`
- Test: `lib/ops/health-check.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  interface HealthSignals {
    newErroredSiteAudits: number
    newErroredAdaAudits: number
    newExhaustedJobs: number
    stalledAudit: { id: string; minutesStuck: number } | null
    newestBackupAgeHours: number | null // null = no backup exists
  }
  interface EvalOpts { lookbackMs: number; cooldownMs: number; backupStaleHours: number }
  function evaluateHealth(
    signals: HealthSignals, state: AlertState, now: Date, opts: EvalOpts,
  ): { alerts: string[]; nextState: AlertState }
  ```
- Consumes: `AlertState` (Task 3).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/ops/health-check.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateHealth, type HealthSignals } from './health-check'
import type { AlertState } from './alert-state'

const now = new Date('2026-07-02T12:00:00Z')
const OPTS = { lookbackMs: 15 * 60_000, cooldownMs: 360 * 60_000, backupStaleHours: 26 }
const clean: HealthSignals = {
  newErroredSiteAudits: 0, newErroredAdaAudits: 0, newExhaustedJobs: 0,
  stalledAudit: null, newestBackupAgeHours: 1,
}
const st: AlertState = { lastCheckAt: now.getTime() - OPTS.lookbackMs, cooldowns: {} }

describe('evaluateHealth', () => {
  it('all clean → no alerts, advances lastCheckAt', () => {
    const r = evaluateHealth(clean, st, now, OPTS)
    expect(r.alerts).toEqual([])
    expect(r.nextState.lastCheckAt).toBe(now.getTime())
  })
  it('errored audits + exhausted jobs each produce a line', () => {
    const r = evaluateHealth({ ...clean, newErroredSiteAudits: 2, newExhaustedJobs: 1 }, st, now, OPTS)
    expect(r.alerts.length).toBe(2)
    expect(r.alerts.join('\n')).toMatch(/audit/i)
    expect(r.alerts.join('\n')).toMatch(/job/i)
  })
  it('queue-stalled fires once then is suppressed by cooldown', () => {
    const sig = { ...clean, stalledAudit: { id: 'a1', minutesStuck: 74 } }
    const r1 = evaluateHealth(sig, st, now, OPTS)
    expect(r1.alerts.some((a) => /stall/i.test(a))).toBe(true)
    // Second run within cooldown, using r1's committed cooldowns.
    const r2 = evaluateHealth(sig, r1.nextState, new Date(now.getTime() + 60_000), OPTS)
    expect(r2.alerts.some((a) => /stall/i.test(a))).toBe(false)
  })
  it('backup-stale fires when age exceeds threshold or no backup exists', () => {
    expect(evaluateHealth({ ...clean, newestBackupAgeHours: 31 }, st, now, OPTS).alerts.some((a) => /backup/i.test(a))).toBe(true)
    expect(evaluateHealth({ ...clean, newestBackupAgeHours: null }, st, now, OPTS).alerts.some((a) => /backup/i.test(a))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/health-check.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** (pure part only; collector added in Task 6)

```typescript
// lib/ops/health-check.ts
import type { AlertState } from './alert-state'

export interface HealthSignals {
  newErroredSiteAudits: number
  newErroredAdaAudits: number
  newExhaustedJobs: number
  stalledAudit: { id: string; minutesStuck: number } | null
  newestBackupAgeHours: number | null
}

export interface EvalOpts {
  lookbackMs: number
  cooldownMs: number
  backupStaleHours: number
}

export function evaluateHealth(
  signals: HealthSignals,
  state: AlertState,
  now: Date,
  opts: EvalOpts,
): { alerts: string[]; nextState: AlertState } {
  const alerts: string[] = []
  const nowMs = now.getTime()
  const cooldowns = { ...state.cooldowns }

  const erroredAudits = signals.newErroredSiteAudits + signals.newErroredAdaAudits
  if (erroredAudits > 0) alerts.push(`• ${erroredAudits} audit(s) errored since last check`)
  if (signals.newExhaustedJobs > 0) alerts.push(`• ${signals.newExhaustedJobs} durable job(s) exhausted retries`)

  const onCooldown = (key: string) => nowMs - (cooldowns[key] ?? 0) < opts.cooldownMs

  if (signals.stalledAudit && !onCooldown('queue-stalled')) {
    alerts.push(`• queue stalled: audit ${signals.stalledAudit.id} transient for ${signals.stalledAudit.minutesStuck}m`)
    cooldowns['queue-stalled'] = nowMs
  }

  const backupStale = signals.newestBackupAgeHours === null || signals.newestBackupAgeHours > opts.backupStaleHours
  if (backupStale && !onCooldown('backup-stale')) {
    alerts.push(
      signals.newestBackupAgeHours === null
        ? '• backup stale: no snapshot found'
        : `• backup stale: newest snapshot ${Math.round(signals.newestBackupAgeHours)}h old`,
    )
    cooldowns['backup-stale'] = nowMs
  }

  return { alerts, nextState: { lastCheckAt: nowMs, cooldowns } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/health-check.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ops/health-check.ts lib/ops/health-check.test.ts
git commit -m "feat(ops): D0 pure health evaluator (windowing + cooldowns)"
```

---

## Task 6: Health signal collector (DB + FS)

**Files:**
- Modify: `lib/ops/health-check.ts`
- Test: `lib/ops/health-check.collect.test.ts`

**Interfaces:**
- Consumes: `newestBackupMtimeMs` (Task 1), Prisma models `SiteAudit`, `AdaAudit`, `Job`.
- Produces: `collectHealthSignals(now: Date, since: number): Promise<HealthSignals>` and the config readers `healthEvalOpts(): EvalOpts`.

**Note:** `since` is the window boundary (`state.lastCheckAt || now - lookbackMs`). The stall threshold is separate (`QUEUE_STALL_MINUTES`, default 60).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/ops/health-check.collect.test.ts
// Run: DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/health-check.collect.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { prisma } from '@/lib/db'
import { collectHealthSignals } from './health-check'

const PFX = 'd0health.test.'
let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-'))
  vi.stubEnv('BACKUP_DIR', tmpDir)
  vi.stubEnv('QUEUE_STALL_MINUTES', '60')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PFX } } })
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('collectHealthSignals', () => {
  it('counts recent errored site audits and detects a stalled one', async () => {
    const now = new Date()
    const since = now.getTime() - 15 * 60_000
    // Recent errored audit (updatedAt auto-set to now on create).
    await prisma.siteAudit.create({
      data: { domain: `${PFX}err`, wcagLevel: 'wcag21aa', status: 'error', requestedBy: 'manual' },
    })
    // Stalled running audit. collectHealthSignals is GLOBAL (not prefix-scoped),
    // and findFirst(orderBy updatedAt asc) returns the OLDEST transient audit in
    // the shared local-dev.db — so force this row's updatedAt to epoch ms 1 to
    // guarantee it is the global oldest, making the id assertion non-flaky
    // (Codex fix #3). Raw integer-ms is how updatedAt is stored.
    const stalled = await prisma.siteAudit.create({
      data: { domain: `${PFX}stall`, wcagLevel: 'wcag21aa', status: 'running', requestedBy: 'manual' },
    })
    await prisma.$executeRawUnsafe(`UPDATE SiteAudit SET updatedAt = 1 WHERE id = '${stalled.id}'`)
    const sig = await collectHealthSignals(now, since)
    expect(sig.newErroredSiteAudits).toBeGreaterThanOrEqual(1)
    expect(sig.stalledAudit?.id).toBe(stalled.id)
    expect(sig.stalledAudit!.minutesStuck).toBeGreaterThan(60)
    expect(sig.newestBackupAgeHours).toBeNull() // empty BACKUP_DIR
  })
})
```

**Note for the implementer:** confirm the required non-null columns on `SiteAudit` before running — if `create` rejects for a missing field, add the minimal columns the schema demands (e.g. `runnerType`) and keep the domain-prefix cleanup. Check with `awk '/^model SiteAudit /,/^}/' prisma/schema.prisma`.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/health-check.collect.test.ts`
Expected: FAIL — `collectHealthSignals` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `lib/ops/health-check.ts`)

```typescript
import { prisma } from '@/lib/db'
import { newestBackupMtimeMs } from './backup'

const TRANSIENT_STATUSES = ['queued', 'pending', 'running', 'pdfs-running', 'lighthouse-running']

export function healthEvalOpts(): EvalOpts {
  return {
    lookbackMs: 15 * 60_000,
    cooldownMs: (Number(process.env.ALERT_COOLDOWN_MINUTES) || 360) * 60_000,
    backupStaleHours: Number(process.env.BACKUP_STALE_HOURS) || 26,
  }
}

export async function collectHealthSignals(now: Date, since: number): Promise<HealthSignals> {
  const sinceDate = new Date(since)
  const stallMinutes = Number(process.env.QUEUE_STALL_MINUTES) || 60
  const stallBefore = new Date(now.getTime() - stallMinutes * 60_000)

  const [newErroredSiteAudits, newErroredAdaAudits, newExhaustedJobs, stalled, backupMtime] =
    await Promise.all([
      prisma.siteAudit.count({ where: { status: 'error', updatedAt: { gt: sinceDate } } }),
      prisma.adaAudit.count({ where: { status: 'error', completedAt: { gt: sinceDate } } }),
      prisma.job.count({ where: { status: 'error', updatedAt: { gt: sinceDate } } }),
      prisma.siteAudit.findFirst({
        where: { status: { in: TRANSIENT_STATUSES }, updatedAt: { lt: stallBefore } },
        orderBy: { updatedAt: 'asc' },
        select: { id: true, updatedAt: true },
      }),
      newestBackupMtimeMs(),
    ])

  return {
    newErroredSiteAudits,
    newErroredAdaAudits,
    newExhaustedJobs,
    stalledAudit: stalled
      ? { id: stalled.id, minutesStuck: Math.round((now.getTime() - stalled.updatedAt.getTime()) / 60_000) }
      : null,
    newestBackupAgeHours: backupMtime === null ? null : (now.getTime() - backupMtime) / 3_600_000,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/health-check.collect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ops/health-check.ts lib/ops/health-check.collect.test.ts
git commit -m "feat(ops): D0 health signal collector (audits/jobs/stall/backup age)"
```

---

## Task 7: health-alert job handler + schedule

**Files:**
- Create: `lib/jobs/handlers/health-alert.ts`
- Test: `lib/jobs/handlers/health-alert.test.ts`
- Modify: `lib/jobs/handlers/register.ts`
- Modify: `lib/jobs/system-schedules.ts`

**Interfaces:**
- Consumes: `readAlertState`/`writeAlertState`, `collectHealthSignals`/`evaluateHealth`/`healthEvalOpts`, `sendAlert`.
- Produces: `HEALTH_ALERT_JOB_TYPE = 'health-alert'`, `registerHealthAlertHandler()`, and the exported orchestrator `runHealthAlert(now?: Date): Promise<void>` (so the test drives logic without the registry).

**Commit rule (Codex fix #4):** persist `nextState` only when `alerts.length === 0`, OR `send.sent`, OR `send.skipped`. On a genuine delivery failure (URL set, not sent), leave state unchanged.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/jobs/handlers/health-alert.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const readAlertState = vi.fn()
const writeAlertState = vi.fn()
const collectHealthSignals = vi.fn()
const sendAlert = vi.fn()
vi.mock('@/lib/ops/alert-state', () => ({ readAlertState, writeAlertState }))
vi.mock('@/lib/ops/alert-webhook', () => ({ sendAlert }))
vi.mock('@/lib/ops/health-check', async (orig) => ({
  ...(await orig<typeof import('@/lib/ops/health-check')>()),
  collectHealthSignals,
}))

import { runHealthAlert } from './health-alert'

const CLEAN = {
  newErroredSiteAudits: 0, newErroredAdaAudits: 0, newExhaustedJobs: 0,
  stalledAudit: null, newestBackupAgeHours: 1,
}
beforeEach(() => {
  readAlertState.mockReset(); writeAlertState.mockReset()
  collectHealthSignals.mockReset(); sendAlert.mockReset()
  readAlertState.mockResolvedValue({ lastCheckAt: 0, cooldowns: {} })
})

describe('runHealthAlert', () => {
  it('no alerts → advances state, no send', async () => {
    collectHealthSignals.mockResolvedValue(CLEAN)
    await runHealthAlert(new Date())
    expect(sendAlert).not.toHaveBeenCalled()
    expect(writeAlertState).toHaveBeenCalledOnce()
  })
  it('alerts + delivery failure → state NOT advanced', async () => {
    collectHealthSignals.mockResolvedValue({ ...CLEAN, newExhaustedJobs: 1 })
    sendAlert.mockResolvedValue({ sent: false, skipped: false })
    await runHealthAlert(new Date())
    expect(sendAlert).toHaveBeenCalledOnce()
    expect(writeAlertState).not.toHaveBeenCalled()
  })
  it('alerts + delivered → state advanced', async () => {
    collectHealthSignals.mockResolvedValue({ ...CLEAN, newExhaustedJobs: 1 })
    sendAlert.mockResolvedValue({ sent: true, skipped: false })
    await runHealthAlert(new Date())
    expect(writeAlertState).toHaveBeenCalledOnce()
  })
  it('alerts + dark (skipped) → state advanced', async () => {
    collectHealthSignals.mockResolvedValue({ ...CLEAN, newExhaustedJobs: 1 })
    sendAlert.mockResolvedValue({ sent: false, skipped: true })
    await runHealthAlert(new Date())
    expect(writeAlertState).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/health-alert.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/jobs/handlers/health-alert.ts
//
// D0 failure alert. Every 15m: collect signals, evaluate, and POST to an
// optional webhook. Commit-rule: advance dedup state only when there was
// nothing to send, the send succeeded, or the webhook is deliberately dark.
// A real delivery failure leaves state unchanged so the next tick retries.
// Never throws — a monitoring job must not itself become a failed job.
import { registerJobHandler } from '../registry'
import { readAlertState, writeAlertState } from '@/lib/ops/alert-state'
import { sendAlert } from '@/lib/ops/alert-webhook'
import { collectHealthSignals, evaluateHealth, healthEvalOpts } from '@/lib/ops/health-check'

export const HEALTH_ALERT_JOB_TYPE = 'health-alert'

export async function runHealthAlert(now: Date = new Date()): Promise<void> {
  const opts = healthEvalOpts()
  const state = await readAlertState()
  const since = state.lastCheckAt || now.getTime() - opts.lookbackMs
  const signals = await collectHealthSignals(now, since)
  const { alerts, nextState } = evaluateHealth(signals, state, now, opts)

  if (alerts.length === 0) {
    await writeAlertState(nextState)
    return
  }
  const text = `:rotating_light: er-seo-tools alert (${process.env.NEXT_PUBLIC_APP_URL || 'prod'})\n${alerts.join('\n')}`
  const send = await sendAlert(text)
  if (send.sent || send.skipped) {
    await writeAlertState(nextState)
  }
  // else: genuine delivery failure — leave state unchanged, retry next tick.
}

export function registerHealthAlertHandler(): void {
  registerJobHandler({
    type: HEALTH_ALERT_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 1, // the next 15m slot is the retry
    timeoutMs: 60 * 1000,
    handler: async () => {
      try {
        await runHealthAlert()
      } catch (err) {
        console.warn(`[health-alert] unexpected failure: ${(err as Error).message}`)
      }
    },
  })
}
```

Then register — add to `lib/jobs/handlers/register.ts`:

```typescript
import { registerHealthAlertHandler } from './health-alert'
// ...inside registerBuiltInJobHandlers():
  registerHealthAlertHandler()
```

Then seed the schedule — in `lib/jobs/system-schedules.ts`:

```typescript
import { HEALTH_ALERT_JOB_TYPE } from './handlers/health-alert'
// ...inside SYSTEM_SCHEDULES (append):
  { name: 'system-health-alert', jobType: HEALTH_ALERT_JOB_TYPE, cadence: 'every:15m', immediate: true },
```

- [ ] **Step 3b: Extend `lib/jobs/system-schedules.test.ts`** (Codex nice-to-have — the existing test loop already validates jobType/cadence/enabled for all entries generically; add explicit immediate-behavior coverage for the two new rows). In the seed test's first `it`, alongside the existing `sweep`/`staleReset`/`cleanup` `nextRunAt` assertions, add:

```typescript
    const backup = rows.find((r) => r.name === 'system-db-backup')!
    const alert = rows.find((r) => r.name === 'system-health-alert')!
    expect(backup.nextRunAt.getTime()).toBeGreaterThan(now.getTime()) // non-immediate
    expect(alert.nextRunAt.getTime()).toBeLessThanOrEqual(now.getTime()) // immediate
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/health-alert.test.ts lib/jobs/system-schedules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/health-alert.ts lib/jobs/handlers/health-alert.test.ts lib/jobs/handlers/register.ts lib/jobs/system-schedules.ts lib/jobs/system-schedules.test.ts
git commit -m "feat(ops): D0 health-alert job type + 15m system schedule"
```

---

## Task 8: Manual-run script + prod env wiring

**Files:**
- Create: `scripts/db-backup.ts`
- Modify: `ecosystem.config.js`

**Interfaces:**
- Consumes: `runDbBackup` (Task 1).

- [ ] **Step 1: Write the manual-run script** (no unit test — it is a thin `npx tsx` wrapper; behavior is covered by Task 1)

```typescript
// scripts/db-backup.ts
// Manual on-demand DB backup / restore-prep tool.
// Run from the app dir: npx tsx scripts/db-backup.ts
import { prisma } from '../lib/db'
import { runDbBackup, backupDir } from '../lib/ops/backup'

async function main() {
  const res = await runDbBackup()
  console.log(`Backup written to ${res.file} (${res.bytes} bytes) in ${backupDir()}; pruned ${res.prunedCount}.`)
}
main()
  .catch((err) => {
    console.error('Backup failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
```

**Note (Codex fix #1):** relative imports (`../lib/...`) + `prisma.$disconnect()` in `finally` matches the actual existing script pattern (`scripts/findings-rebuild.ts:10,69`). `initPragmas()` is intentionally NOT called — `findings-rebuild.ts` omits it and `VACUUM INTO` produces a correct snapshot regardless of the connection's journal-mode pragma (the persistent DB file is already WAL).

- [ ] **Step 2: Wire prod env in `ecosystem.config.js`**

Add to the `env` block (next to `REPORTS_DIR`):

```javascript
      BACKUP_DIR: `${DATA_HOME}/backups`,
      // ALERT_WEBHOOK_URL: set on the server .env to enable failure alerts (Slack incoming webhook).
      // Optional: QUEUE_STALL_MINUTES (60), BACKUP_STALE_HOURS (26), BACKUP_RETENTION_COUNT (7), ALERT_COOLDOWN_MINUTES (360).
```

- [ ] **Step 3: Commit**

```bash
git add scripts/db-backup.ts ecosystem.config.js
git commit -m "feat(ops): D0 manual backup script + prod BACKUP_DIR wiring"
```

**PR note for Kevin (pre-deploy):** `BACKUP_DIR` is added to `ecosystem.config.js`, and `ecosystem.config.js` env changes are NOT picked up by `pm2 restart` — this deploy needs `pm2 delete seo-tools && pm2 start ecosystem.config.js`. To enable alerts, set `ALERT_WEBHOOK_URL` in the server `.env` (a Slack incoming webhook). All new vars are optional — nothing bricks boot if unset. After deploy, run one manual backup (`npx tsx scripts/db-backup.ts` from `$APP_HOME`) so `backup-stale` doesn't fire before the first 08:00 slot.

---

## Task 9: Full gate + PR

- [ ] **Step 1: Run the full gate**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all green. (If pre-existing unrelated failures appear, confirm they exist on `main` before proceeding — house convention.)

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/ops-safety-backup-alert
gh pr create --title "D0: ops safety — DB backup + failure alert" --body "$(cat <<'EOF'
Implements D0 (roadmap tracker): in-app durable DB-backup job + failure-alert job.

- `db-backup` (daily@08:00): VACUUM INTO a timestamped snapshot under BACKUP_DIR, atomic temp+rename, prune to N (default 7).
- `health-alert` (every:15m): alerts on errored audits / exhausted jobs / stalled queue / stale backup; POST to optional ALERT_WEBHOOK_URL; atomic JSON-file dedup; never advances dedup state on a failed delivery.
- No schema migration. All new env vars optional (no boot-brick).

Spec: docs/superpowers/specs/2026-07-02-ops-safety-backup-alert-design.md (Codex-reviewed).
Plan: docs/superpowers/plans/2026-07-02-ops-safety-backup-alert.md

**Kevin pre-deploy:** set BACKUP_DIR (done in ecosystem.config.js) + optional ALERT_WEBHOOK_URL in server .env; deploy needs `pm2 delete seo-tools && pm2 start ecosystem.config.js` (env changes not picked up by restart); run one manual backup after deploy.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Stop.** Kevin merges + deploys + prod-verifies (spec §8), then the tracker/handoff ritual runs.

---

## Self-Review

- **Spec coverage:** §4 backup → Tasks 1,2,8. §5 alert (webhook/state/evaluator/collector/handler) → Tasks 3,4,5,6,7. §6 env → Tasks 6,7,8. §7 testing → per-task tests. §8 prod-verify → Task 8 note + Task 9 stop. All Codex fixes (§10): #1 temp+rename (T1), #2 no checkpoint (T1), #3 AdaAudit completedAt (T6), #4 delivery-aware state (T7), #5 atomic state (T3), #6 deliberate stall set (T6). Covered.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `AlertState`, `HealthSignals`, `EvalOpts`, `sendAlert`→`{sent,skipped}`, `runDbBackup`→`{file,bytes,prunedCount}`, `collectHealthSignals(now, since)`, `evaluateHealth(signals, state, now, opts)`, `runHealthAlert(now?)` consistent across tasks.

## Codex review (2026-07-02)

Routed through `consulting-codex` (session `019f14d4`). Verdict: **ship-with-fixes** — all applied in place:
1. **Script style (T8)** — relative imports + `$disconnect()` in `finally`, matching `findings-rebuild.ts` (verified: it omits `initPragmas`; `VACUUM INTO` doesn't need it).
2. **Handler ctx (T2)** — `JobHandlerContext = { jobId, attempt, signal }` (verified `types.ts`); test passes a real ctx, no `as never`.
3. **Collector test robustness (T6)** — seeded stalled row forced to `updatedAt = 1` so the global `findFirst(orderBy asc)` id assertion is non-flaky.
- Nice-to-haves applied: snapshot client `finally`-disconnect (T1 test), retention read at call-time (T1), random temp suffix (T3), explicit new-schedule immediate-behavior assertions (T7).
- Verified by Codex against real files: VACUUM INTO syntax; Prisma singleton + pragma timing; `vi.stubEnv`/`unstubAllEnvs` + `node` vitest mode; `globalThis.fetch`/`new Response()` on Node 22; partial `vi.mock` pattern; `prisma.job`/`siteAudit`/`adaAudit` delegates; `wcagLevel`+`runnerType` schema defaults (so the collector test's `create` data is sufficient).
