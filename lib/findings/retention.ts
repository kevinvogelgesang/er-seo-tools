// lib/findings/retention.ts
//
// Blob-archive retention (A2 Phase 4, spec § "Retention / archive demotion").
// Once a tool's readers have flipped to the findings tables, its origin
// blobs become a 90-day archive: runs completed more than 90 days ago get
// their origin blob column nulled (Session.result / SiteAudit.summary /
// AdaAudit.result), all scalar columns kept, and archivePrunedAt stamped.
// Runs as a task inside runCleanup().
//
// SHIPPED INERT: pruning activates per tool via PRUNE_ACTIVATED below; each
// flag flips in the same PR as that tool's last blob reader (the A1 pattern
// of deleting the legacy path only after parity). Both are false in A2.
//
// Scope: origin row's blob ONLY. For a site-audit run that is
// SiteAudit.summary — child AdaAudit.result blobs are NOT pruned here; the
// site-audit results view still reads them. Extending pruning to children
// is a decision for the PR that flips 'ada-audit' (post-C3/C4).
//
// Rows with no CrawlRun (pre-A2) are untouched: sessions expire via the
// 180-day TTL; audits have no TTL (out of scope).

import { prisma } from '@/lib/db'

const DAY_MS = 24 * 60 * 60 * 1000
/** Origin blobs are kept 90 days after the run completes. */
export const ARCHIVE_WINDOW_MS = 90 * DAY_MS

type PrunableTool = 'seo-parser' | 'ada-audit'

/** Per-tool activation. Flip ONLY in the same PR as the tool's last blob reader. */
export const PRUNE_ACTIVATED: Readonly<Record<PrunableTool, boolean>> = {
  'seo-parser': false,
  'ada-audit': false,
}

/** Origin updates per array-form transaction (matches writer chunking style). */
const CHUNK_SIZE = 100

export async function pruneArchivedBlobs(
  now: Date = new Date(),
  activated: Readonly<Record<PrunableTool, boolean>> = PRUNE_ACTIVATED,
): Promise<void> {
  const cutoff = new Date(now.getTime() - ARCHIVE_WINDOW_MS)
  const tools = (Object.keys(activated) as PrunableTool[]).filter((t) => activated[t])

  for (const tool of tools) {
    // Origin FKs are SetNull, so a non-null FK guarantees the origin row
    // exists — "origin row present" is just the OR below.
    const runs = await prisma.crawlRun.findMany({
      where: {
        tool,
        completedAt: { lt: cutoff }, // lt excludes null completedAt
        archivePrunedAt: null,
        OR: [
          { sessionId: { not: null } },
          { siteAuditId: { not: null } },
          { adaAuditId: { not: null } },
        ],
      },
      select: { id: true, sessionId: true, siteAuditId: true, adaAuditId: true },
    })

    for (let i = 0; i < runs.length; i += CHUNK_SIZE) {
      const chunk = runs.slice(i, i + CHUNK_SIZE)
      const sessionIds = chunk.map((r) => r.sessionId).filter((x): x is string => x !== null)
      const siteAuditIds = chunk.map((r) => r.siteAuditId).filter((x): x is string => x !== null)
      const adaAuditIds = chunk.map((r) => r.adaAuditId).filter((x): x is string => x !== null)

      // Array-form transaction only (house rule). Empty `in: []` lists are
      // no-ops; Session/SiteAudit @updatedAt is maintained by updateMany.
      await prisma.$transaction([
        prisma.session.updateMany({ where: { id: { in: sessionIds } }, data: { result: null } }),
        prisma.siteAudit.updateMany({ where: { id: { in: siteAuditIds } }, data: { summary: null } }),
        prisma.adaAudit.updateMany({ where: { id: { in: adaAuditIds } }, data: { result: null } }),
        prisma.crawlRun.updateMany({
          where: { id: { in: chunk.map((r) => r.id) } },
          data: { archivePrunedAt: now },
        }),
      ])
    }

    if (runs.length > 0) {
      console.log(`[findings] pruned ${runs.length} archived ${tool} blob(s)`)
    }
  }
}
