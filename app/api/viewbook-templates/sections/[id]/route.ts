import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { patchSectionTemplate } from '@/lib/viewbook/template-service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * PATCH /api/viewbook-templates/sections/:id — { version, title?, copy? }.
 * Route validation stays SHAPE-only (version is an integer token, title is a
 * string when present) — domain rules (non-empty title, section-copy schema,
 * the 13-key bridge catalog) live in patchSectionTemplate.
 */
export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const sectionId = parseId((await params).id)
  const body = requireJsonObject(await parseJsonBody(request))
  if (!Number.isInteger(body.version)) throw new HttpError(400, 'invalid_content')
  if (body.title !== undefined && typeof body.title !== 'string') throw new HttpError(400, 'invalid_content')

  await patchSectionTemplate(
    sectionId,
    {
      version: body.version as number,
      title: body.title as string | undefined,
      copy: body.copy,
    },
    operator,
  )
  return NextResponse.json({ ok: true })
})
