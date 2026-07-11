// lib/keywords/retention.ts
//
// KS-1 Task 6: keep-latest-3 GscSnapshot retention. GscSnapshot has no
// updatedAt column and the delete is a single correlated-subquery statement,
// so (unlike lib/findings/retention.ts's blob-nulling passes) no transaction
// is needed. Runs in runCleanup() (lib/cleanup.ts).
//
// KS-2 Task 6: 30-d KeywordVolumeCache prune. Client-agnostic shared cache
// (no per-group keep rule, unlike GscSnapshot) — a plain deleteMany on the
// 30-d TTL is sufficient. Also runs in runCleanup().

import { prisma } from '@/lib/db'
import { VOLUME_CACHE_TTL_DAYS } from '@/lib/keywords/volume-config'

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

/**
 * Delete KeywordVolumeCache rows older than the 30-d TTL (VOLUME_CACHE_TTL_DAYS).
 * Client-agnostic shared cache — no per-group keep rule, so a plain deleteMany
 * on fetchedAt suffices (unlike pruneGscSnapshots' per-client keep-latest-3).
 */
export async function pruneKeywordVolumeCache(): Promise<void> {
  const cutoff = new Date(Date.now() - VOLUME_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)
  const { count } = await prisma.keywordVolumeCache.deleteMany({
    where: { fetchedAt: { lt: cutoff } },
  })
  if (count > 0) console.log(`[keywords] pruned ${count} stale KeywordVolumeCache row(s)`)
}
