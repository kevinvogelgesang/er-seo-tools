import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { createSubsection } from '@/lib/viewbook/template-service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

// createSubsection (unlike patchSubsection) does not itself type-check the
// offering* flags — it just `?? false`s them straight into a Boolean column,
// so the route is the only place a bad type gets caught before Prisma does.
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new HttpError(400, 'invalid_content')
  return value
}

/**
 * POST /api/viewbook-templates/sections/:id/subsections —
 * { version, subsectionKey, title, offeringWebsite?, offeringVa?, offeringPpc?, copy?, content? }.
 * version is required here (Codex fix #5 — createSubsection's sortOrder read
 * is safe only because a concurrent create conflicts on the SECTION version).
 */
export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const sectionId = parseId((await params).id)
  const body = requireJsonObject(await parseJsonBody(request))
  if (!Number.isInteger(body.version)) throw new HttpError(400, 'invalid_content')
  if (typeof body.subsectionKey !== 'string') throw new HttpError(400, 'invalid_key')
  if (typeof body.title !== 'string') throw new HttpError(400, 'invalid_content')

  await createSubsection(
    sectionId,
    {
      version: body.version as number,
      subsectionKey: body.subsectionKey,
      title: body.title,
      offeringWebsite: optionalBoolean(body.offeringWebsite),
      offeringVa: optionalBoolean(body.offeringVa),
      offeringPpc: optionalBoolean(body.offeringPpc),
      copy: body.copy,
      content: body.content,
    },
    operator,
  )
  return NextResponse.json({ ok: true })
})
