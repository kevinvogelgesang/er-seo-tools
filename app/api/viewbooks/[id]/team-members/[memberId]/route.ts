import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { prisma } from '@/lib/db'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId } from '@/lib/viewbook/route-utils'
import { syncVersionBumpWhere } from '@/lib/viewbook/sync'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; memberId: string }> }

export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operatorEmail = await requireOperatorEmail(request)
  const { id: rawViewbookId, memberId: rawMemberId } = await params
  const viewbookId = parseId(rawViewbookId)
  const memberId = parseId(rawMemberId)
  const now = Date.now()
  const removal = Prisma.sql`EXISTS (
    SELECT 1 FROM "ViewbookTeamMember"
    WHERE "id" = ${memberId} AND "viewbookId" = ${viewbookId}
  )`

  const [bumped, activityCount, deleted] = await prisma.$transaction([
    syncVersionBumpWhere(viewbookId, removal),
    prisma.$executeRaw`
      INSERT INTO "ViewbookActivity" ("viewbookId", "kind", "actor", "actorKind", "summary", "createdAt")
      SELECT ${viewbookId}, 'team-remove', ${operatorEmail}, 'operator', 'Removed team member', ${now}
      WHERE (${removal})
    `,
    prisma.$executeRaw`
      DELETE FROM "ViewbookTeamMember"
      WHERE "id" = ${memberId} AND "viewbookId" = ${viewbookId}
    `,
  ])

  if (deleted !== 1) throw new HttpError(404, 'not_found')
  if (bumped !== 1 || activityCount !== 1) {
    throw new Error('viewbook_team_remove_activity_mismatch')
  }
  return NextResponse.json({ ok: true })
})
