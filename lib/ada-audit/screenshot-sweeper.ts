import { promises as fs } from 'fs'
import { prisma } from '@/lib/db'
import { SCREENSHOTS_DIR, SCREENSHOT_RETENTION_MS, deleteScreenshots } from './screenshot-helpers'

// Runs every 30 min via the 'screenshot-sweep' scheduled job
// (lib/jobs/handlers/screenshot-sweep.ts) — Phase 4 replaced this module's
// own setInterval.
export async function sweepExpiredScreenshots(): Promise<{ checked: number; deleted: number }> {
  let dirents: import('fs').Dirent[]
  try {
    dirents = await fs.readdir(SCREENSHOTS_DIR, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { checked: 0, deleted: 0 }
    throw err
  }

  const subdirs = dirents.filter((d) => d.isDirectory()).map((d) => d.name)
  const cutoff = Date.now() - SCREENSHOT_RETENTION_MS
  let deleted = 0
  for (const auditId of subdirs) {
    const audit = await prisma.adaAudit.findUnique({
      where: { id: auditId },
      select: { completedAt: true, status: true, createdAt: true },
    })
    const shouldDelete = (() => {
      if (!audit) return true
      if (audit.completedAt && audit.completedAt.getTime() < cutoff) return true
      const terminal = audit.status === 'complete' || audit.status === 'error' || audit.status === 'redirected'
      if (terminal && !audit.completedAt && audit.createdAt.getTime() < cutoff) return true
      return false
    })()
    if (shouldDelete) {
      try { await deleteScreenshots(auditId); deleted++ }
      catch (err) { console.warn(`[screenshot-sweeper] failed to delete ${auditId}:`, err) }
    }
  }
  return { checked: subdirs.length, deleted }
}
