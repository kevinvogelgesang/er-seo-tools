import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { deleteMilestone, updateMilestone } from '@/lib/viewbook/service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; milestoneId: string }> }

/** PATCH /api/viewbooks/:id/milestones/:milestoneId — title/blurb/description/order/date/status. */
export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const { id: rawId, milestoneId: rawMid } = await params
  const id = parseId(rawId)
  const milestoneId = parseId(rawMid)
  const body = requireJsonObject(await parseJsonBody<Record<string, unknown>>(request))

  const patch: Parameters<typeof updateMilestone>[2] = {}
  if ('title' in body) {
    if (typeof body.title !== 'string') throw new HttpError(400, 'invalid_milestone')
    patch.title = body.title
  }
  if ('blurb' in body) patch.blurb = typeof body.blurb === 'string' ? body.blurb : null
  // Passed through as-is (not coerced to null on a bad type) — the service
  // validates description's type/length and 400s otherwise.
  if ('description' in body) patch.description = body.description as string | null | undefined
  if ('sortOrder' in body) {
    if (typeof body.sortOrder !== 'number') throw new HttpError(400, 'invalid_milestone')
    patch.sortOrder = body.sortOrder
  }
  if ('targetDate' in body) {
    if (body.targetDate == null) patch.targetDate = null
    else if (typeof body.targetDate === 'string') {
      const d = new Date(body.targetDate)
      if (Number.isNaN(d.getTime())) throw new HttpError(400, 'invalid_milestone')
      patch.targetDate = d
    } else throw new HttpError(400, 'invalid_milestone')
  }
  if ('status' in body) {
    if (body.status !== 'upcoming' && body.status !== 'current' && body.status !== 'done') {
      throw new HttpError(400, 'invalid_milestone')
    }
    patch.status = body.status
  }
  const milestone = await updateMilestone(id, milestoneId, patch)
  return NextResponse.json({ milestone })
})

/** DELETE /api/viewbooks/:id/milestones/:milestoneId */
export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const { id: rawId, milestoneId: rawMid } = await params
  await deleteMilestone(parseId(rawId), parseId(rawMid))
  return NextResponse.json({ ok: true })
})
