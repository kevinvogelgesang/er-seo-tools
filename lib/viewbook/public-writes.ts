// Transactional cores for the public client writes (feedback + materials).
//
// Extracted from the route files (cross-review fix): Next.js route modules may
// only export HTTP-method handlers — exporting these helpers there fails the
// `.next/types` route-shape check. Behavior is unchanged.
//
// Each insert is ONE array-form transaction whose statements are commit-time
// fenced (token current, not revoked, client active, section visible, target
// belongs to the viewbook, cap not exceeded — EXISTS predicates) with
// clientMutationId replay idempotency; the activity row rides the same
// transaction. `createdAt` is bound as integer ms per the raw-SQL house rule.

import { Prisma, type Viewbook, type ViewbookFeedback, type ViewbookMaterialLink } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { syncVersionBumpWhere } from '@/lib/viewbook/sync'

const FEEDBACK_CAP = 200
const MATERIAL_CAP = 100

export interface MutationHooks {
  beforeCommit?: () => Promise<void>
}

export interface ClientFeedbackInput {
  reviewLinkId: number
  body: string
  authorName: string | null
  clientMutationId: string
}

export interface ClientMaterialInput {
  label: string
  url: string
  clientMutationId: string
}

export async function insertClientFeedback(
  viewbook: Viewbook,
  token: string,
  input: ClientFeedbackInput,
  hooks: MutationHooks = {},
): Promise<{ feedback: ViewbookFeedback; replayed: boolean }> {
  await hooks.beforeCommit?.()
  const now = Date.now()
  const summary = `Client feedback: ${input.body.trim().slice(0, 120)}`
  // Same predicate the activity INSERT below uses (replay guard + full access
  // chain) — already self-contained (its own FROM/JOIN aliases, no dangling
  // reference), so it can be reused verbatim as the bump's predicate.
  const activityPredicate = Prisma.sql`
    NOT EXISTS (
      SELECT 1 FROM "ViewbookFeedback" f WHERE f."clientMutationId" = ${input.clientMutationId}
    )
    AND EXISTS (
      SELECT 1 FROM "Viewbook" v JOIN "Client" c ON c."id" = v."clientId"
      JOIN "ViewbookSection" s ON s."viewbookId" = v."id" AND s."sectionKey" = 'milestones'
      JOIN "ViewbookMilestone" m ON m."viewbookId" = v."id"
      JOIN "ViewbookReviewLink" r ON r."milestoneId" = m."id"
      WHERE v."id" = ${viewbook.id} AND v."token" = ${token} AND v."revokedAt" IS NULL
        AND c."archivedAt" IS NULL AND s."state" <> 'hidden' AND r."id" = ${input.reviewLinkId}
        AND (SELECT COUNT(*) FROM "ViewbookFeedback" f2 WHERE f2."reviewLinkId" = r."id") < ${FEEDBACK_CAP}
    )
  `
  const [, activityCount, insertCount] = await prisma.$transaction([
    syncVersionBumpWhere(viewbook.id, activityPredicate),
    prisma.$executeRaw`
      INSERT INTO "ViewbookActivity" ("viewbookId", "kind", "actor", "summary", "createdAt")
      SELECT ${viewbook.id}, 'feedback', 'client', ${summary}, ${now}
      WHERE ${activityPredicate}
    `,
    prisma.$executeRaw`
      INSERT INTO "ViewbookFeedback"
        ("reviewLinkId", "body", "authorName", "authorKind", "clientMutationId", "createdAt")
      SELECT ${input.reviewLinkId}, ${input.body}, ${input.authorName}, 'client', ${input.clientMutationId}, ${now}
      WHERE EXISTS (
        SELECT 1 FROM "Viewbook" v JOIN "Client" c ON c."id" = v."clientId"
        JOIN "ViewbookSection" s ON s."viewbookId" = v."id" AND s."sectionKey" = 'milestones'
        JOIN "ViewbookMilestone" m ON m."viewbookId" = v."id"
        JOIN "ViewbookReviewLink" r ON r."milestoneId" = m."id"
        WHERE v."id" = ${viewbook.id} AND v."token" = ${token} AND v."revokedAt" IS NULL
          AND c."archivedAt" IS NULL AND s."state" <> 'hidden' AND r."id" = ${input.reviewLinkId}
          AND (SELECT COUNT(*) FROM "ViewbookFeedback" f2 WHERE f2."reviewLinkId" = r."id") < ${FEEDBACK_CAP}
      )
      ON CONFLICT("clientMutationId") DO NOTHING
    `,
  ])

  if (insertCount === 1 && activityCount === 1) {
    return {
      feedback: await prisma.viewbookFeedback.findUniqueOrThrow({ where: { clientMutationId: input.clientMutationId } }),
      replayed: false,
    }
  }
  const replay = await prisma.viewbookFeedback.findFirst({
    where: {
      clientMutationId: input.clientMutationId,
      reviewLinkId: input.reviewLinkId,
      reviewLink: {
        milestone: {
          viewbookId: viewbook.id,
          viewbook: { token, revokedAt: null, client: { archivedAt: null } },
        },
      },
    },
  })
  if (replay) return { feedback: replay, replayed: true }

  await requireViewbookToken(token)
  const target = await prisma.viewbookReviewLink.findFirst({
    where: {
      id: input.reviewLinkId,
      milestone: { viewbookId: viewbook.id, viewbook: { sections: { some: { sectionKey: 'milestones', state: { not: 'hidden' } } } } },
    },
    select: { id: true, _count: { select: { feedback: true } } },
  })
  if (!target) throw new HttpError(404, 'not_found')
  if (target._count.feedback >= FEEDBACK_CAP) throw new HttpError(409, 'feedback_limit_reached')
  throw new HttpError(404, 'not_found')
}

export async function insertClientMaterial(
  viewbook: Viewbook,
  token: string,
  input: ClientMaterialInput,
  hooks: MutationHooks = {},
): Promise<{ material: ViewbookMaterialLink; replayed: boolean }> {
  await hooks.beforeCommit?.()
  const now = Date.now()
  const summary = `Client shared material: ${input.label}`
  // Same predicate the activity INSERT below uses — self-contained already.
  const activityPredicate = Prisma.sql`
    NOT EXISTS (
      SELECT 1 FROM "ViewbookMaterialLink" ml WHERE ml."clientMutationId" = ${input.clientMutationId}
    )
    AND EXISTS (
      SELECT 1 FROM "Viewbook" v JOIN "Client" c ON c."id" = v."clientId"
      JOIN "ViewbookSection" s ON s."viewbookId" = v."id" AND s."sectionKey" = 'materials'
      WHERE v."id" = ${viewbook.id} AND v."token" = ${token} AND v."revokedAt" IS NULL
        AND c."archivedAt" IS NULL AND s."state" <> 'hidden'
        AND (SELECT COUNT(*) FROM "ViewbookMaterialLink" ml2 WHERE ml2."viewbookId" = v."id") < ${MATERIAL_CAP}
    )
  `
  const [, activityCount, insertCount] = await prisma.$transaction([
    syncVersionBumpWhere(viewbook.id, activityPredicate),
    prisma.$executeRaw`
      INSERT INTO "ViewbookActivity" ("viewbookId", "kind", "actor", "summary", "createdAt")
      SELECT ${viewbook.id}, 'material-link', 'client', ${summary}, ${now}
      WHERE ${activityPredicate}
    `,
    prisma.$executeRaw`
      INSERT INTO "ViewbookMaterialLink"
        ("viewbookId", "label", "status", "url", "clientMutationId", "addedBy", "providedAt", "createdAt")
      SELECT ${viewbook.id}, ${input.label}, 'provided', ${input.url}, ${input.clientMutationId}, 'client', ${now}, ${now}
      WHERE EXISTS (
        SELECT 1 FROM "Viewbook" v JOIN "Client" c ON c."id" = v."clientId"
        JOIN "ViewbookSection" s ON s."viewbookId" = v."id" AND s."sectionKey" = 'materials'
        WHERE v."id" = ${viewbook.id} AND v."token" = ${token} AND v."revokedAt" IS NULL
          AND c."archivedAt" IS NULL AND s."state" <> 'hidden'
          AND (SELECT COUNT(*) FROM "ViewbookMaterialLink" ml2 WHERE ml2."viewbookId" = v."id") < ${MATERIAL_CAP}
      )
      ON CONFLICT("clientMutationId") DO NOTHING
    `,
  ])
  if (insertCount === 1 && activityCount === 1) {
    return {
      material: await prisma.viewbookMaterialLink.findUniqueOrThrow({ where: { clientMutationId: input.clientMutationId } }),
      replayed: false,
    }
  }
  const replay = await prisma.viewbookMaterialLink.findFirst({
    where: {
      clientMutationId: input.clientMutationId, viewbookId: viewbook.id,
      viewbook: { token, revokedAt: null, client: { archivedAt: null } },
    },
  })
  if (replay) return { material: replay, replayed: true }
  await requireViewbookToken(token)
  const section = await prisma.viewbookSection.findFirst({
    where: { viewbookId: viewbook.id, sectionKey: 'materials', state: { not: 'hidden' } }, select: { id: true },
  })
  if (!section) throw new HttpError(404, 'not_found')
  if (await prisma.viewbookMaterialLink.count({ where: { viewbookId: viewbook.id } }) >= MATERIAL_CAP) {
    throw new HttpError(409, 'material_limit_reached')
  }
  throw new HttpError(404, 'not_found')
}
