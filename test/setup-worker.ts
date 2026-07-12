// test/setup-worker.ts — a `setupFiles` entry: runs in EACH worker BEFORE any
// test module (so before lib/db.ts constructs its Prisma singleton). MUST NOT
// import any app module (or anything that transitively imports lib/db.ts) — raw
// node builtins only — or the singleton binds the wrong URL.
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const dir = resolve(root, '.test-dbs')
const workerId = process.env.VITEST_WORKER_ID ?? '1'
const templatePath = resolve(dir, 'template.db')
const workerPath = resolve(dir, `worker-${workerId}.db`)

// Idempotent: copy only if absent; never overwrite a DB that may already be open.
// Copy ONLY template.db (checkpointed single file); copying a stale WAL would
// make the worker DB inconsistent.
if (!existsSync(workerPath)) {
  copyFileSync(templatePath, workerPath)
}

process.env.DATABASE_URL = `file:${workerPath}`
