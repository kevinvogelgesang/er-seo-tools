// lib/findings/retention.ts
//
// Blob-archive retention (A2 Phase 4, spec § "Retention / archive demotion").
// Once a tool's readers have flipped to the findings tables, its origin
// blobs become a 90-day archive: runs completed more than 90 days ago get
// their origin blob column nulled (Session.result / SiteAudit.summary /
// AdaAudit.result), all scalar columns kept, and archivePrunedAt stamped.
// Runs as a task inside runCleanup().
//
// Pruning activates per tool via PRUNE_ACTIVATED below; each flag flips in
// the same PR as that tool's last blob reader (the A1 pattern of deleting
// the legacy path only after parity). 'ada-audit' flipped in C3; 'seo-parser'
// flipped in C5 (every Session.result reader serves a findings fallback or
// an explicit session_archived 409).
//
// Scope (since C3): the origin row's blob AND, for ada-audit site runs, the
// child AdaAudit.result blobs — the real DB weight. Child lighthouseSummary
// is KEPT (diff baselines + Lighthouse history live there, tiny). Screenshot
// artifacts for pruned audits are deleted best-effort over an exact snapshot
// of affected ids — never a directory sweep.
//
// Rows with no CrawlRun (pre-A2) are untouched: sessions expire via the
// 180-day TTL; audits have no TTL (out of scope).

import { prisma } from '@/lib/db'
import { deleteAuditArtifacts } from '@/lib/ada-audit/screenshot-helpers'

const DAY_MS = 24 * 60 * 60 * 1000
/** Origin blobs are kept 90 days after the run completes. */
export const ARCHIVE_WINDOW_MS = 90 * DAY_MS

type PrunableTool = 'seo-parser' | 'ada-audit'

/** Per-tool activation. Flip ONLY in the same PR as the tool's last blob reader. */
export const PRUNE_ACTIVATED: Readonly<Record<PrunableTool, boolean>> = {
  'seo-parser': true, // C5: every Session.result reader is findings-capable (fallback or 409)
  'ada-audit': true,  // C3: all readers fall back to findings tables (spec § 5.4)
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
    // Tool-origin-aware selection (C6): a seo-parser run can now be a live-scan
    // run carrying siteAuditId (no blob of its own — the SiteAudit.summary blob
    // belongs to the ADA run). Pruning it must NEVER null that summary. So
    // seo-parser prunes ONLY session-origin runs; ada-audit prunes site/standalone.
    const runs = await prisma.crawlRun.findMany({
      where: {
        tool,
        completedAt: { lt: cutoff }, // lt excludes null completedAt
        archivePrunedAt: null,
        ...(tool === 'seo-parser'
          ? { sessionId: { not: null } }
          : { OR: [{ siteAuditId: { not: null } }, { adaAuditId: { not: null } }] }),
      },
      select: { id: true, sessionId: true, siteAuditId: true, adaAuditId: true },
    })

    for (let i = 0; i < runs.length; i += CHUNK_SIZE) {
      const chunk = runs.slice(i, i + CHUNK_SIZE)
      const sessionIds = chunk.map((r) => r.sessionId).filter((x): x is string => x !== null)
      const siteAuditIds = chunk.map((r) => r.siteAuditId).filter((x): x is string => x !== null)
      const adaAuditIds = chunk.map((r) => r.adaAuditId).filter((x): x is string => x !== null)

      // Snapshot the affected child audits BEFORE the transaction (Codex
      // spec-fix #6) — artifact deletion below uses exactly this snapshot,
      // never a directory sweep.
      const childAudits = tool === 'ada-audit' && siteAuditIds.length > 0
        ? await prisma.adaAudit.findMany({
            where: { siteAuditId: { in: siteAuditIds }, result: { not: null } },
            select: { id: true },
          })
        : []

      // Array-form transaction only (house rule). Empty `in: []` lists are
      // no-ops; Session/SiteAudit @updatedAt is maintained by updateMany.
      await prisma.$transaction([
        prisma.session.updateMany({ where: { id: { in: sessionIds } }, data: { result: null } }),
        prisma.siteAudit.updateMany({ where: { id: { in: siteAuditIds } }, data: { summary: null } }),
        prisma.adaAudit.updateMany({ where: { id: { in: adaAuditIds } }, data: { result: null } }),
        // C3: child blobs of pruned site audits — the real DB weight (spec § D3).
        // Bounded in-list: siteAuditIds ≤ CHUNK_SIZE (never the child-id list).
        ...(childAudits.length > 0
          ? [prisma.adaAudit.updateMany({
              where: { siteAuditId: { in: siteAuditIds } },
              data: { result: null },
            })]
          : []),
        prisma.crawlRun.updateMany({
          where: { id: { in: chunk.map((r) => r.id) } },
          data: { archivePrunedAt: now },
        }),
      ])

      // Best-effort screenshot cleanup over the snapshot — blobs held the only
      // screenshotPath references; keeping the files would orphan disk forever.
      if (tool === 'ada-audit') {
        const artifactIds = [...adaAuditIds, ...childAudits.map((c) => c.id)]
        const settled = await Promise.allSettled(artifactIds.map((aid) => deleteAuditArtifacts(aid)))
        const failed = settled.filter((s) => s.status === 'rejected').length
        if (failed > 0) {
          console.warn(`[findings] failed to delete screenshot artifacts for ${failed} pruned audit(s)`)
        }
      }
    }

    if (runs.length > 0) {
      console.log(`[findings] pruned ${runs.length} archived ${tool} blob(s)`)
    }
  }
}

/** Days a HarvestedLink row survives if its verifier never ran (crash/exhaustion). */
const HARVEST_RETENTION_MS = 7 * DAY_MS

/**
 * C6: delete stale HarvestedLink scaffolding. The broken-link verifier deletes
 * its own rows on success; this backstops audits whose verify never completed,
 * keeping steady-state HarvestedLink volume near zero. Runs in runCleanup().
 */
export async function pruneHarvestedLinks(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - HARVEST_RETENTION_MS)
  const { count } = await prisma.harvestedLink.deleteMany({ where: { createdAt: { lt: cutoff } } })
  if (count > 0) console.log(`[findings] pruned ${count} stale HarvestedLink row(s)`)
}

/**
 * C6 Phase 2: delete stale HarvestedPageSeo scaffolding. The live-scan builder
 * deletes its own rows on success; this backstops audits whose build never ran.
 * Reuses the 7-day HARVEST_RETENTION_MS window. Runs in runCleanup().
 */
export async function pruneHarvestedPageSeo(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - HARVEST_RETENTION_MS)
  const { count } = await prisma.harvestedPageSeo.deleteMany({ where: { createdAt: { lt: cutoff } } })
  if (count > 0) console.log(`[findings] pruned ${count} stale HarvestedPageSeo row(s)`)
}

/**
 * C12 D1: DELETE retained HarvestedPageSeo rows once their audit's retention
 * window has elapsed. Only non-null contentAuditRetainUntil rows are swept
 * (the stamp is written only after a successful live-scan run), so stranded
 * (null) rows are left for recoverBrokenLinkVerifies + the 7-d backstop. The
 * table has no updatedAt; a DELETE needs none. Hosted in runCleanup + the
 * every-10-min stale-audit-reset job.
 */
export async function sweepExpiredContentAudit(now: Date = new Date()): Promise<void> {
  // DateTime columns are stored as INTEGER ms in this SQLite setup (CLAUDE.md:
  // "storage is integer ms"; every raw-SQL DateTime comparison in the repo binds
  // ${x.getTime()}, e.g. lib/ops/health-check.collect.test.ts). Bind integer ms
  // — NOT a bare Date — so the comparison is integer-vs-integer and can't silently
  // never-match on a serialization mismatch.
  const count = await prisma.$executeRaw`
    DELETE FROM "HarvestedPageSeo"
    WHERE "siteAuditId" IN (
      SELECT "id" FROM "SiteAudit"
      WHERE "contentAuditRetainUntil" IS NOT NULL AND "contentAuditRetainUntil" < ${now.getTime()}
    )`
  if (count > 0) console.log(`[findings] content-audit sweep deleted ${count} expired HarvestedPageSeo row(s)`)
}
