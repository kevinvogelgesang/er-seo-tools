import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId } from '@/lib/viewbook/route-utils'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; reviewLinkId: string }> }

export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const { id: rawId, reviewLinkId: rawReviewLinkId } = await params
  const viewbookId = parseId(rawId)
  const reviewLinkId = parseId(rawReviewLinkId)
  const deleted = await prisma.viewbookReviewLink.deleteMany({
    where: { id: reviewLinkId, milestone: { viewbookId } },
  })
  if (deleted.count !== 1) throw new HttpError(404, 'not_found')
  return NextResponse.json({ ok: true })
})
