// v2 PR2: syncVersion bump statement factory (spec §6). Bumps ride INSIDE the
// existing array-form transactions. Fence-sharing: predicated variants carry
// the SAME pre-state predicate as the domain statement they accompany and are
// placed BEFORE it (the activity-insert companion pattern) — a failed or
// replayed domain write bumps nothing. Raw SQL sets updatedAt manually.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export function syncVersionBumpStatement(viewbookId: number) {
  return prisma.$executeRaw`UPDATE "Viewbook" SET "syncVersion" = "syncVersion" + 1, "updatedAt" = ${Date.now()} WHERE "id" = ${viewbookId}`
}

// predicate MUST be a self-contained expression (typically a full
// EXISTS (SELECT 1 FROM … JOIN … WHERE …) with its own aliases) — never a
// bare WHERE fragment that references aliases from another statement's scope.
export function syncVersionBumpWhere(viewbookId: number, predicate: Prisma.Sql) {
  return prisma.$executeRaw`UPDATE "Viewbook" SET "syncVersion" = "syncVersion" + 1, "updatedAt" = ${Date.now()} WHERE "id" = ${viewbookId} AND (${predicate})`
}

export function syncVersionBumpAllStatement() {
  return prisma.$executeRaw`UPDATE "Viewbook" SET "syncVersion" = "syncVersion" + 1, "updatedAt" = ${Date.now()}`
}

// unscoped bump with a caller-supplied predicate (Task 4: e.g. every
// viewbook belonging to a client whose global content changed).
export function syncVersionBumpAllWhere(predicate: Prisma.Sql) {
  return prisma.$executeRaw`UPDATE "Viewbook" SET "syncVersion" = "syncVersion" + 1, "updatedAt" = ${Date.now()} WHERE (${predicate})`
}
