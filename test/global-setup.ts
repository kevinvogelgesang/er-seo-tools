// test/global-setup.ts — runs ONCE per `vitest run`, in the main process.
// Builds a single migrated template DB; workers copy it (instant) instead of
// each running migrations. Absolute paths (Prisma resolves relative SQLite URLs
// against prisma/, not repo root).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

export default function setup() {
  const root = process.cwd()
  const dir = resolve(root, '.test-dbs')
  rmSync(dir, { recursive: true, force: true })
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
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(templatePath + suffix)) {
      throw new Error(`[test] unexpected template${suffix} — WAL not checkpointed; do not copy a live WAL`)
    }
  }
}
