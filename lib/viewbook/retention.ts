import { prisma } from '@/lib/db'

export const VIEWBOOK_ACTIVITY_RETENTION_MS = 180 * 24 * 60 * 60 * 1000

export async function pruneViewbookActivity(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - VIEWBOOK_ACTIVITY_RETENTION_MS)
  const result = await prisma.viewbookActivity.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return result.count
}
