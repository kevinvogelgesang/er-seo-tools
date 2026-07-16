// PR2 live sync: admin-side read of the version counter (e.g. for an
// operator-side polling indicator). Read-only — mirrors GET
// /api/viewbooks/:id's convention of relying on middleware cookie-gating
// rather than an explicit requireOperatorEmail call.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { prisma } from '@/lib/db'
import { parseId } from '@/lib/viewbook/route-utils'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/** GET /api/viewbooks/:id/sync — the current syncVersion counter. */
export const GET = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const id = parseId((await params).id)
  const vb = await prisma.viewbook.findUnique({ where: { id }, select: { syncVersion: true } })
  if (!vb) throw new HttpError(404, 'not_found')
  return NextResponse.json({ v: vb.syncVersion })
})
