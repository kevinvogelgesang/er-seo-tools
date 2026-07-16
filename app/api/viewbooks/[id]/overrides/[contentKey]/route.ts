import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { deleteContentOverride, putContentOverride } from '@/lib/viewbook/global-content'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; contentKey: string }> }

/** PUT /api/viewbooks/:id/overrides/:contentKey — { body } per-client "your plan" block. */
export const PUT = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { id: rawId, contentKey } = await params
  const id = parseId(rawId)
  const body = requireJsonObject(await parseJsonBody<{ body?: unknown }>(request))
  if (typeof body.body !== 'string') throw new HttpError(400, 'invalid_content')
  await putContentOverride(id, contentKey, body.body, operator)
  return NextResponse.json({ ok: true })
})

/** DELETE /api/viewbooks/:id/overrides/:contentKey */
export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const { id: rawId, contentKey } = await params
  await deleteContentOverride(parseId(rawId), contentKey)
  return NextResponse.json({ ok: true })
})
