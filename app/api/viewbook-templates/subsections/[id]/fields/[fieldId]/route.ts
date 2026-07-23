import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { prisma } from '@/lib/db'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { patchField } from '@/lib/viewbook/template-service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; fieldId: string }> }

/**
 * PATCH /api/viewbook-templates/subsections/:id/fields/:fieldId —
 * { version, label?, sortOrder?, archived? }. fieldKey is IMMUTABLE
 * (patchField's signature has no fieldKey param at all) — a fieldKey
 * property in the body is rejected explicitly rather than silently ignored.
 * The `:id` segment is resolve-and-checked: a field under a DIFFERENT
 * subsection is an indistinguishable 404.
 */
export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { id: rawId, fieldId: rawFieldId } = await params
  const subsectionId = parseId(rawId)
  const fieldId = parseId(rawFieldId)
  const body = requireJsonObject(await parseJsonBody(request))
  if (Object.prototype.hasOwnProperty.call(body, 'fieldKey')) throw new HttpError(400, 'invalid_content')
  if (!Number.isInteger(body.version)) throw new HttpError(400, 'invalid_content')
  if (body.label !== undefined && typeof body.label !== 'string') throw new HttpError(400, 'invalid_content')
  if (body.sortOrder !== undefined && !Number.isInteger(body.sortOrder)) throw new HttpError(400, 'invalid_content')
  if (body.archived !== undefined && typeof body.archived !== 'boolean') throw new HttpError(400, 'invalid_content')

  const field = await prisma.fieldTemplate.findUnique({
    where: { id: fieldId },
    select: { subsectionTemplateId: true },
  })
  if (!field || field.subsectionTemplateId !== subsectionId) throw new HttpError(404, 'not_found')

  await patchField(
    fieldId,
    {
      version: body.version as number,
      label: body.label as string | undefined,
      sortOrder: body.sortOrder as number | undefined,
      archived: body.archived as boolean | undefined,
    },
    operator,
  )
  return NextResponse.json({ ok: true })
})
