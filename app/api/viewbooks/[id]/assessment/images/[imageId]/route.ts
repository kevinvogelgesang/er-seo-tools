import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId } from '@/lib/viewbook/route-utils'
import { deleteAssessmentImage } from '@/lib/viewbook/assessment-notes'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; imageId: string }> }

/**
 * DELETE /api/viewbooks/:id/assessment/images/:imageId — removes the image
 * row + file. `deleteAssessmentImage` owns the cross-viewbook/archived-client
 * fencing (both 404 — no distinct 409 on delete, unlike the note/create
 * paths) and the syncVersion bump.
 */
export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const actor = await requireOperatorEmail(request)
  const raw = await params
  const id = parseId(raw.id)
  const imageId = parseId(raw.imageId)
  await deleteAssessmentImage(id, imageId, actor)
  return NextResponse.json({ ok: true })
})
