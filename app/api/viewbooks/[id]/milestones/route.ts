import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId } from '@/lib/viewbook/route-utils'
import { createMilestone } from '@/lib/viewbook/service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

function parseTargetDate(raw: unknown): Date | null {
  if (raw == null) return null
  if (typeof raw !== 'string') throw new HttpError(400, 'invalid_milestone')
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'invalid_milestone')
  return d
}

/** POST /api/viewbooks/:id/milestones — { title, blurb?, sortOrder, targetDate?, current? }. */
export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const id = parseId((await params).id)
  const body = await parseJsonBody<Record<string, unknown>>(request)
  if (typeof body.title !== 'string' || typeof body.sortOrder !== 'number') {
    throw new HttpError(400, 'invalid_milestone')
  }
  const created = await createMilestone(
    id,
    {
      title: body.title,
      blurb: typeof body.blurb === 'string' ? body.blurb : null,
      sortOrder: body.sortOrder,
      targetDate: parseTargetDate(body.targetDate),
    },
    { current: body.current === true },
  )
  return NextResponse.json({ milestone: created }, { status: 201 })
})
