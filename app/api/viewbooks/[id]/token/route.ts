import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId } from '@/lib/viewbook/route-utils'
import { revokeViewbook, rotateViewbookToken } from '@/lib/viewbook/service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/** POST /api/viewbooks/:id/token — rotate (new token, revocation cleared). */
export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const id = parseId((await params).id)
  return NextResponse.json(await rotateViewbookToken(id))
})

/** DELETE /api/viewbooks/:id/token — revoke (public page 404s until rotate). */
export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const id = parseId((await params).id)
  await revokeViewbook(id)
  return NextResponse.json({ ok: true })
})
