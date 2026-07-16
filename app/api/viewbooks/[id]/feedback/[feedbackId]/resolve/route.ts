import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId } from '@/lib/viewbook/route-utils'
import { syncVersionBumpWhere } from '@/lib/viewbook/sync'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; feedbackId: string }> }

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { id: rawId, feedbackId: rawFeedbackId } = await params
  const viewbookId = parseId(rawId)
  const feedbackId = parseId(rawFeedbackId)
  const resolvedAt = new Date()
  // Bump predicate mirrors the updateMany's relational where verbatim
  // (mechanism c) — join chain feedback -> reviewLink -> milestone -> viewbookId.
  const [, updated] = await prisma.$transaction([
    syncVersionBumpWhere(viewbookId, Prisma.sql`
      EXISTS (
        SELECT 1 FROM "ViewbookFeedback" f
        JOIN "ViewbookReviewLink" r ON r."id" = f."reviewLinkId"
        JOIN "ViewbookMilestone" m ON m."id" = r."milestoneId"
        WHERE f."id" = ${feedbackId} AND m."viewbookId" = ${viewbookId}
      )
    `),
    prisma.viewbookFeedback.updateMany({
      where: { id: feedbackId, reviewLink: { milestone: { viewbookId } } },
      data: { resolvedAt, resolvedBy: operator },
    }),
  ])
  if (updated.count !== 1) throw new HttpError(404, 'not_found')
  return NextResponse.json({ feedback: { id: feedbackId, resolvedAt, resolvedBy: operator } })
})
