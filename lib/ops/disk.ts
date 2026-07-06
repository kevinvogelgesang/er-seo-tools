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
