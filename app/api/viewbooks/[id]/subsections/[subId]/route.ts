import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { patchSubsectionInstance } from '@/lib/viewbook/instance-service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; subId: string }> }

/**
 * PATCH /api/viewbooks/:id/subsections/:subId — { version, title?, copy?, content? }
 * (F2 Task 4, spec §9). Fenced on the subsection's OWN version; the same txn
 * bumps the owning section's aggregate version exactly once. Authorization:
 * `patchSubsectionInstance` resolves the row via the composite
 * `(id, viewbookId)` key, so a subId belonging to a DIFFERENT viewbook is an
 * indistinguishable 404 — never a cross-tenant write.
 */
export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { id: rawId, subId: rawSubId } = await params
  const viewbookId = parseId(rawId)
  const subId = parseId(rawSubId)
  const body = requireJsonObject(await parseJsonBody(request))
  if (!Number.isInteger(body.version)) throw new HttpError(400, 'invalid_content')
  if (body.title !== undefined && typeof body.title !== 'string') throw new HttpError(400, 'invalid_content')

  await patchSubsectionInstance(
    viewbookId,
    subId,
    {
      version: body.version as number,
      title: body.title as string | undefined,
      copy: body.copy,
      content: body.content,
    },
    operator,
  )
  return NextResponse.json({ ok: true })
})
