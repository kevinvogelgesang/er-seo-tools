import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { setSectionState, updateSectionText } from '@/lib/viewbook/service'
import { patchSectionInstance } from '@/lib/viewbook/instance-service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; sectionKey: string }> }

const STATE_KEYS = ['state', 'introNote', 'narrative'] as const
const INSTANCE_KEYS = ['title', 'copy'] as const

/**
 * PATCH /api/viewbooks/:id/sections/:sectionKey.
 *
 * Two DISJOINT bodies (F2 Task 4, spec §9):
 *   - state path (unfenced, today's semantics): { state?, introNote?, narrative? }
 *   - instance path (fenced on `version`): { version, title?, copy? }
 * A body mixing keys from both is a 400 `invalid_field` — compose one or the
 * other, never both in the same request.
 */
export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { id: rawId, sectionKey } = await params
  const id = parseId(rawId)
  const body = requireJsonObject(await parseJsonBody<Record<string, unknown>>(request))

  const hasState = STATE_KEYS.some((k) => k in body)
  const hasInstance = INSTANCE_KEYS.some((k) => k in body)
  if (hasState && hasInstance) throw new HttpError(400, 'invalid_field')

  if (hasInstance) {
    if (!Number.isInteger(body.version)) throw new HttpError(400, 'invalid_content')
    await patchSectionInstance(
      id,
      sectionKey,
      {
        version: body.version as number,
        title: body.title as string | undefined,
        copy: body.copy,
      },
      operator,
    )
    return NextResponse.json({ ok: true })
  }

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
