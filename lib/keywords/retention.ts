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
//
// KS-5 Task 9: tiered KeywordStrategySession prune (plan-Codex #1 — pruning
// must never delete request rows the monthly ceiling still counts). Single
// tagged $executeRaw DELETE with EXISTS/NOT EXISTS request-row predicates
// (KS-1 retention precedent above); KeywordStrategyVolumeRequest cascades via
// its FK (ON DELETE CASCADE), so no separate child delete is needed.
// tokenMintedAt is stored as an INTEGER Unix-ms column in this SQLite DB
// (same convention verified by lib/keywords/strategy-volume-ledger.ts against
// createdAt), so cutoffs compare as ms numbers, not Date objects.

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

/** Memo-less sessions with no volume-request rows are abandoned mints. */
const MEMOLESS_NO_REQUESTS_TTL_DAYS = 7

/**
 * Memo-less sessions WITH volume-request rows are held longer — past any
 * UTC-month window `monthlyUsedKeywords` (strategy-volume-ledger.ts) can
 * query — so the monthly ceiling's spend accounting never loses a row it
 * still counts.
 */
const MEMOLESS_WITH_REQUESTS_TTL_DAYS = 45

/**
 * Tiered KeywordStrategySession prune (KS-5 Task 9, plan-Codex #1):
 *   - memo-less (`memoMarkdown IS NULL`) + NO request rows: prune at 7 d.
 *   - memo-less + WITH request rows: prune at 45 d (request rows cascade via
 *     the FK — no separate delete).
 *   - memo-bearing sessions: never pruned (documents, same posture as
 *     KeywordResearchSession).
 */
export async function pruneKeywordStrategySessions(): Promise<void> {
  const now = Date.now()
  const noRequestsCutoffMs = now - MEMOLESS_NO_REQUESTS_TTL_DAYS * 24 * 60 * 60 * 1000
  const withRequestsCutoffMs = now - MEMOLESS_WITH_REQUESTS_TTL_DAYS * 24 * 60 * 60 * 1000

  const count = await prisma.$executeRaw`
    DELETE FROM "KeywordStrategySession"
    WHERE "memoMarkdown" IS NULL
      AND (
        (
          "tokenMintedAt" < ${noRequestsCutoffMs}
          AND NOT EXISTS (
            SELECT 1 FROM "KeywordStrategyVolumeRequest"
            WHERE "strategySessionId" = "KeywordStrategySession"."id"
          )
        )
        OR (
          "tokenMintedAt" < ${withRequestsCutoffMs}
          AND EXISTS (
            SELECT 1 FROM "KeywordStrategyVolumeRequest"
            WHERE "strategySessionId" = "KeywordStrategySession"."id"
          )
        )
      )
  `
  if (count > 0) console.log(`[keywords] pruned ${count} stale KeywordStrategySession row(s)`)
}
