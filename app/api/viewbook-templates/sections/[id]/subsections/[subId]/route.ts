import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { prisma } from '@/lib/db'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { patchSubsection } from '@/lib/viewbook/template-service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; subId: string }> }

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new HttpError(400, 'invalid_content')
  return value
}

/**
 * PATCH /api/viewbook-templates/sections/:id/subsections/:subId —
 * { version, title?, offeringWebsite?, offeringVa?, offeringPpc?, copy?, content?, archived? }.
 * The `:id` segment is resolve-and-checked here (patchSubsection itself only
 * takes subId): a subsection that exists but belongs to a DIFFERENT section
 * is an indistinguishable 404, never a cross-section write.
 */
export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { id: rawId, subId: rawSubId } = await params
  const sectionId = parseId(rawId)
  const subId = parseId(rawSubId)
  const body = requireJsonObject(await parseJsonBody(request))
  if (!Number.isInteger(body.version)) throw new HttpError(400, 'invalid_content')
  if (body.title !== undefined && typeof body.title !== 'string') throw new HttpError(400, 'invalid_content')
  if (body.archived !== undefined && typeof body.archived !== 'boolean') throw new HttpError(400, 'invalid_content')

  const sub = await prisma.subsectionTemplate.findUnique({
    where: { id: subId },
    select: { sectionTemplateId: true },
  })
  if (!sub || sub.sectionTemplateId !== sectionId) throw new HttpError(404, 'not_found')

  await patchSubsection(
    subId,
    {
      version: body.version as number,
      title: body.title as string | undefined,
      offeringWebsite: optionalBoolean(body.offeringWebsite),
      offeringVa: optionalBoolean(body.offeringVa),
      offeringPpc: optionalBoolean(body.offeringPpc),
      copy: body.copy,
      content: body.content,
      archived: body.archived as boolean | undefined,
    },
    operator,
  )
  return NextResponse.json({ ok: true })
})
