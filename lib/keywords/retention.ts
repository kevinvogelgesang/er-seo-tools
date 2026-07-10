// lib/keywords/retention.ts
//
// KS-1 Task 6: keep-latest-3 GscSnapshot retention. GscSnapshot has no
// updatedAt column and the delete is a single correlated-subquery statement,
// so (unlike lib/findings/retention.ts's blob-nulling passes) no transaction
// is needed. Runs in runCleanup() (lib/cleanup.ts).

import { prisma } from '@/lib/db'

/** Snapshots retained per client, newest-first by (fetchedAt DESC, id DESC). */
const KEEP_PER_CLIENT = 3

/**
 * Delete all but the latest KEEP_PER_CLIENT GscSnapshot rows per client.
 * Tagged $executeRaw template with quoted identifiers only — never
 * $executeRawUnsafe/string interpolation (house rule).
 */
export async function pruneGscSnapshots(): Promise<void> {
  const count = await prisma.$executeRaw`
    DELETE FROM "GscSnapshot" WHERE "id" NOT IN (
      SELECT "id" FROM "GscSnapshot" AS "keep"
      WHERE "keep"."clientId" = "GscSnapshot"."clientId"
      ORDER BY "keep"."fetchedAt" DESC, "keep"."id" DESC
      LIMIT ${KEEP_PER_CLIENT}
    )
  `
  if (count > 0) console.log(`[keywords] pruned ${count} stale GscSnapshot row(s)`)
}
