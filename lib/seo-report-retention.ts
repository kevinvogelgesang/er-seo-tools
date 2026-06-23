// lib/seo-report-retention.ts — SEO performance report retention sweep (§8)
//
// Algorithm (spec §8):
//   1. Snapshot doomed ids: SeoReport rows where retainUntil IS NOT NULL AND < now.
//      (null retainUntil = not yet rendered / never expires → never pruned.)
//   2. For each doomed id: cancel any queued render jobs (cancelJobsByGroup FIRST).
//   3. Delete the rows via array-form deleteMany inside $transaction.
//   4. Best-effort unlink each derived seoReportPath(id) — ENOENT-tolerant.
//   5. Remove SeoReportBatch rows whose reports relation is now empty (follow-up pass).
//   6. Return { deleted: doomedIds.length }.
//
// Registered in runCleanup() alongside pruneArchivedBlobs() and pruneScheduledSiteAudits().

import { prisma } from '@/lib/db'
import { cancelJobsByGroup } from '@/lib/jobs/queue'
import { deleteSeoReportFile } from '@/lib/report/seo/seo-report-file'

/**
 * Prune SeoReport rows past their retainUntil date.
 * Accepts an explicit `now` so tests are deterministic.
 */
export async function pruneSeoReports(now: Date = new Date()): Promise<{ deleted: number }> {
  // Step 1: snapshot doomed report ids (retainUntil not null AND before now)
  const doomed = await prisma.seoReport.findMany({
    where: {
      retainUntil: { not: null, lt: now },
    },
    select: { id: true },
  })

  if (doomed.length === 0) return { deleted: 0 }

  const doomedIds = doomed.map((r) => r.id)

  // Step 2: cancel any queued render jobs for doomed ids FIRST
  await Promise.allSettled(doomedIds.map((id) => cancelJobsByGroup(`seo-report:${id}`)))

  // Step 3: delete the rows — array-form $transaction (no interactive tx, house rule)
  await prisma.$transaction([
    prisma.seoReport.deleteMany({ where: { id: { in: doomedIds } } }),
  ])

  // Step 4: best-effort unlink derived PDFs (ENOENT-tolerant — deleteSeoReportFile handles it)
  await Promise.allSettled(doomedIds.map((id) => deleteSeoReportFile(id)))

  // Step 5: remove SeoReportBatch rows that now have zero reports
  // Safe guard: `reports: { none: {} }` matches ONLY batches with no remaining children —
  // it never touches batches that still hold live SeoReport rows.
  await prisma.seoReportBatch.deleteMany({ where: { reports: { none: {} } } })

  console.log(`[seo-retention] pruned ${doomedIds.length} SEO report(s)`)

  return { deleted: doomedIds.length }
}
