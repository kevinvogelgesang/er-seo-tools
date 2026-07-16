import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId } from '@/lib/viewbook/route-utils'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; feedbackId: string }> }

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { id: rawId, feedbackId: rawFeedbackId } = await params
  const viewbookId = parseId(rawId)
  const feedbackId = parseId(rawFeedbackId)
  const resolvedAt = new Date()
  const updated = await prisma.viewbookFeedback.updateMany({
    where: { id: feedbackId, reviewLink: { milestone: { viewbookId } } },
    data: { resolvedAt, resolvedBy: operator },
  })
  if (updated.count !== 1) throw new HttpError(404, 'not_found')
  return NextResponse.json({ feedback: { id: feedbackId, resolvedAt, resolvedBy: operator } })
})
