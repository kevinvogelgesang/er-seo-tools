import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { moveViewbookStage } from '@/lib/viewbook/service'
import { isViewbookStage } from '@/lib/viewbook/stages'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operatorEmail = await requireOperatorEmail(request)
  const id = parseId((await params).id)
  const body = requireJsonObject(await parseJsonBody(request))
  const direction = body.direction === 'forward' || body.direction === 'back' ? body.direction : null
  const expectedStage = typeof body.expectedStage === 'string' && isViewbookStage(body.expectedStage)
    ? body.expectedStage : null
  if (!direction || !expectedStage) return NextResponse.json({ error: 'invalid_direction' }, { status: 400 })
  const force = body.force === true
  return NextResponse.json(await moveViewbookStage(id, direction, expectedStage, operatorEmail, force))
})
