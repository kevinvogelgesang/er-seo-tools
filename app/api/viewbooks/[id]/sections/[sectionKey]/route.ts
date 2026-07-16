import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { setSectionState, updateSectionText } from '@/lib/viewbook/service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; sectionKey: string }> }

/** PATCH /api/viewbooks/:id/sections/:sectionKey — { state? , introNote?, narrative? }. */
export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { id: rawId, sectionKey } = await params
  const id = parseId(rawId)
  const body = requireJsonObject(await parseJsonBody<Record<string, unknown>>(request))
  let handled = false
  if ('state' in body) {
    if (body.state !== 'hidden' && body.state !== 'active' && body.state !== 'done') {
      throw new HttpError(400, 'invalid_section')
    }
    await setSectionState(id, sectionKey, body.state, operator)
    handled = true
  }
  const text: { introNote?: string | null; narrative?: string | null } = {}
  if ('introNote' in body) text.introNote = body.introNote as string | null
  if ('narrative' in body) text.narrative = body.narrative as string | null
  if (Object.keys(text).length > 0) {
    await updateSectionText(id, sectionKey, text)
    handled = true
  }
  if (!handled) throw new HttpError(400, 'invalid_section')
  return NextResponse.json({ ok: true })
})
