import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { CATALOG_CATEGORIES } from '@/lib/viewbook/catalog'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { syncVersionBumpWhere } from '@/lib/viewbook/sync'

export const dynamic = 'force-dynamic'

const FIELD_TYPES = ['text', 'textarea', 'list'] as const
const LABEL_MAX_CHARS = 200
const LABEL_MAX_BYTES = 800

type RouteParams = { params: Promise<{ id: string }> }

function parseLabel(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'invalid_field')
  const label = raw.trim()
  if (!label || [...label].length > LABEL_MAX_CHARS || Buffer.byteLength(label, 'utf8') > LABEL_MAX_BYTES) {
    throw new HttpError(400, 'invalid_field')
  }
  return label
}

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operatorEmail = await requireOperatorEmail(request)
  const viewbookId = parseId((await params).id)
  const body = requireJsonObject(await parseJsonBody(request))
  const label = parseLabel(body.label)
  if (!(FIELD_TYPES as readonly unknown[]).includes(body.fieldType)) throw new HttpError(400, 'invalid_field')
  if (!(CATALOG_CATEGORIES as readonly unknown[]).includes(body.category)) throw new HttpError(400, 'invalid_field')
  const category = body.category as string

  // F2 (Task 4): a viewbook that genuinely doesn't exist (or whose client is
  // archived) stays a 404 not_found — the SAME undifferentiated case the
  // pre-F2 route returned. Distinct from the case below.
  const viewbook = await prisma.viewbook.findUnique({
    where: { id: viewbookId },
    select: { id: true, client: { select: { archivedAt: true } } },
  })
  if (!viewbook || viewbook.client.archivedAt !== null) throw new HttpError(404, 'not_found')

  // F2: fields are subsection-instance-owned — resolve the owning data-source
  // subsection INSTANCE from `category` by durable key (subsectionKey ===
  // category, catalog seed contract). Task 3 left a missing instance here as
  // an indistinguishable 404 folded into the viewbook-missing case; Task 4
  // splits it out — an EXISTING viewbook whose category subsection instance
  // is absent (not yet pulled in, or archived away — Task 6/7 territory) is
  // a 409 conflicting_ops, never a 404 (spec §9, Codex fix carried from
  // Task 3 review).
  const subsection = await prisma.viewbookSubsection.findFirst({
    where: { viewbookId, subsectionKey: category, section: { sectionKey: 'data-source' } },
    select: { id: true, sectionId: true },
  })
  if (!subsection) throw new HttpError(409, 'conflicting_ops')

  const createdAt = Date.now()
  // Defense-in-depth only: the preconditions above were just verified, so this
  // WHERE is a narrow-race safety net (client archived / row deleted between
  // the reads above and this txn), not the primary authorization mechanism.
  //
  // Fix round 1 (Codex review, Finding 1): all three statements below share
  // this EXACT predicate — a client archived in the race window makes the
  // sync bump, the aggregate bump, AND the INSERT no-op TOGETHER (0 rows,
  // no throw), so version + syncVersion stay untouched whenever no field is
  // actually created. Mirrors the DELETE route's shared-`archiveGuard`
  // pattern (fields/[fieldId]/route.ts).
  const activeClientGuard = Prisma.sql`
    EXISTS (SELECT 1 FROM "Viewbook" v JOIN "Client" c ON c."id" = v."clientId" WHERE v."id" = ${viewbookId} AND c."archivedAt" IS NULL)
  `
  let results: unknown[]
  try {
    results = await prisma.$transaction([
      syncVersionBumpWhere(viewbookId, activeClientGuard),
      // ONE aggregate bump per create — the field row's owning section (Codex
      // fix carried from Task 3 review: this bump was previously missing).
      // Guarded (not the throwing bumpSectionAggregateGuarded helper) so a
      // client-archived race no-ops it instead of committing a spurious bump
      // alongside a zero-row INSERT below.
      prisma.$executeRaw`UPDATE "ViewbookSection" SET "version" = "version" + 1, "updatedAt" = ${createdAt} WHERE "id" = ${subsection.sectionId} AND (${activeClientGuard})`,
      prisma.$queryRaw<Array<{ id: number }>>`
        INSERT INTO "ViewbookField"
          ("viewbookId", "subsectionId", "defKey", "category", "label", "fieldType", "sortOrder", "version", "createdBy", "createdAt")
        SELECT v."id", ${subsection.id}, NULL, ${category}, ${label}, ${body.fieldType as string},
          COALESCE((SELECT MAX(f."sortOrder") + 1 FROM "ViewbookField" f
                    WHERE f."viewbookId" = v."id" AND f."category" = ${category}), 1),
          0, ${operatorEmail},
          CASE
            WHEN v."dataLockedAt" IS NOT NULL AND v."dataLockedAt" >= ${createdAt}
              THEN v."dataLockedAt" + 1
            ELSE ${createdAt}
          END
        FROM "Viewbook" v JOIN "Client" c ON c."id" = v."clientId"
        WHERE v."id" = ${viewbookId} AND c."archivedAt" IS NULL
        RETURNING "id"
      `,
    ])
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new HttpError(409, 'conflicting_ops')
    }
    throw err
  }
  const inserted = results[2] as Array<{ id: number }>
  if (inserted.length !== 1) throw new HttpError(404, 'not_found')
  const field = await prisma.viewbookField.findUniqueOrThrow({ where: { id: inserted[0].id } })
  return NextResponse.json({ field }, { status: 201 })
})
