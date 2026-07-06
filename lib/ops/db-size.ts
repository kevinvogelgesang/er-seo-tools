// lib/ops/db-size.ts
//
// A4 observability — SQLite on-disk footprint. Reports main + -wal + -shm.
// Path parsing hardened for absolute/relative/query-suffix file: URLs; a relative
// path resolves against prisma/ the way Prisma does. Never throws; returns null so
// the UI renders "—".
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
