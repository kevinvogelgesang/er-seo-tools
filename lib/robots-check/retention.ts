// lib/robots-check/retention.ts
//
// D4: keep the newest ROBOTS_CHECK_HISTORY_LIMIT + 1 RobotsCheck rows per
// (clientId, domain) — the +1 hidden predecessor keeps the oldest VISIBLE
// row's read-time `changed` flag stable when its comparison target would
// otherwise be pruned (Codex #3). Tagged $executeRaw with quoted
// identifiers only (KS-1 retention precedent); ordering matches the
// service's (createdAt DESC, id DESC) everywhere.

import { prisma } from '@/lib/db'
import { ROBOTS_CHECK_HISTORY_LIMIT } from './types'

const KEEP = ROBOTS_CHECK_HISTORY_LIMIT + 1

export async function pruneRobotsChecks(): Promise<void> {
  const count = await prisma.$executeRaw`
    DELETE FROM "RobotsCheck" WHERE "id" NOT IN (
      SELECT "id" FROM "RobotsCheck" AS "keep"
      WHERE "keep"."clientId" = "RobotsCheck"."clientId"
        AND "keep"."domain" = "RobotsCheck"."domain"
      ORDER BY "keep"."createdAt" DESC, "keep"."id" DESC
      LIMIT ${KEEP}
    )
  `
  if (count > 0) console.log(`[robots-check] pruned ${count} stale RobotsCheck row(s)`)
}
