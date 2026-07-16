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
  const createdAt = Date.now()
  // Bump shares the same guard the INSERT's WHERE uses (mechanism b) — the
  // RETURNING statement is the LAST array member; its returned id is what the
  // response uses (never a post-tx findFirst by label — duplicate custom
  // labels are legal, which would make that lookup ambiguous under concurrency).
  const insertGuard = Prisma.sql`
    EXISTS (
      SELECT 1 FROM "Viewbook" v JOIN "Client" c ON c."id" = v."clientId"
      WHERE v."id" = ${viewbookId} AND c."archivedAt" IS NULL
    )
  `
  const [, inserted] = await prisma.$transaction([
    syncVersionBumpWhere(viewbookId, insertGuard),
    prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO "ViewbookField"
        ("viewbookId", "defKey", "category", "label", "fieldType", "sortOrder", "version", "createdBy", "createdAt")
      SELECT v."id", NULL, ${body.category as string}, ${label}, ${body.fieldType as string},
        COALESCE((SELECT MAX(f."sortOrder") + 1 FROM "ViewbookField" f
                  WHERE f."viewbookId" = v."id" AND f."category" = ${body.category as string}), 1),
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
  if (inserted.length !== 1) throw new HttpError(404, 'not_found')
  const field = await prisma.viewbookField.findUniqueOrThrow({ where: { id: inserted[0].id } })
  return NextResponse.json({ field }, { status: 201 })
})
