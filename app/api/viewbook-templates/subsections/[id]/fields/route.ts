import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { createField } from '@/lib/viewbook/template-service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * POST /api/viewbook-templates/subsections/:id/fields —
 * { version, fieldKey, label, fieldType }. version is required here (Codex
 * fix #5, same rationale as the subsections POST route).
 */
export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const subsectionId = parseId((await params).id)
  const body = requireJsonObject(await parseJsonBody(request))
  if (!Number.isInteger(body.version)) throw new HttpError(400, 'invalid_content')
  if (typeof body.fieldKey !== 'string') throw new HttpError(400, 'invalid_key')
  if (typeof body.label !== 'string') throw new HttpError(400, 'invalid_content')
  if (typeof body.fieldType !== 'string') throw new HttpError(400, 'invalid_content')

  await createField(
    subsectionId,
    {
      version: body.version as number,
      fieldKey: body.fieldKey,
      label: body.label,
      fieldType: body.fieldType,
    },
    operator,
  )
  return NextResponse.json({ ok: true })
})
