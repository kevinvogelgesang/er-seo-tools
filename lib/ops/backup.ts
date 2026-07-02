// lib/ops/backup.ts
//
// D0 ops safety — durable DB backup runner. Takes a consistent single-file
// snapshot of the live SQLite DB via VACUUM INTO (safe under WAL; includes
// committed WAL content, no checkpoint needed), writing to a temp path first
// and atomic-renaming on success so an interrupted run never leaves a partial
// file that would masquerade as a good recent backup. Prunes to the newest N.
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
