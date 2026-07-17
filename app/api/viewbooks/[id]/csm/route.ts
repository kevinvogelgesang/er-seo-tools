import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { assignViewbookCsm } from '@/lib/viewbook/service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const actor = await requireOperatorEmail(request)
  const id = parseId((await params).id)
  const body = requireJsonObject(await parseJsonBody<Record<string, unknown>>(request))
  if (!('csmName' in body) || (body.csmName !== null && typeof body.csmName !== 'string')) {
    throw new HttpError(400, 'invalid_csm')
  }
  await assignViewbookCsm(id, body.csmName as string | null, actor)
  return NextResponse.json({ ok: true })
})
