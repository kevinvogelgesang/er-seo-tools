import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; milestoneId: string }> }

function httpsUrl(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'invalid_review_link')
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') throw new Error('not https')
    return url.toString()
  } catch {
    throw new HttpError(400, 'invalid_review_link')
  }
}

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { id: rawId, milestoneId: rawMilestoneId } = await params
  const viewbookId = parseId(rawId)
  const milestoneId = parseId(rawMilestoneId)
  const body = requireJsonObject(await parseJsonBody(request))
  if (typeof body.label !== 'string' || !body.label.trim() || Buffer.byteLength(body.label, 'utf8') > 256) {
    throw new HttpError(400, 'invalid_review_link')
  }
  if (body.kind !== 'mockup' && body.kind !== 'live') throw new HttpError(400, 'invalid_review_link')
  const url = httpsUrl(body.url)
  const createdAt = Date.now()
  const inserted = await prisma.$queryRaw<Array<{ id: number }>>`
    INSERT INTO "ViewbookReviewLink" ("milestoneId", "label", "url", "kind", "createdBy", "createdAt")
    SELECT ${milestoneId}, ${body.label.trim()}, ${url}, ${body.kind}, ${operator}, ${createdAt}
    WHERE EXISTS (
      SELECT 1 FROM "ViewbookMilestone" m
      WHERE m."id" = ${milestoneId} AND m."viewbookId" = ${viewbookId}
    )
    RETURNING "id"
  `
  if (inserted.length !== 1) throw new HttpError(404, 'not_found')
  const reviewLink = await prisma.viewbookReviewLink.findUniqueOrThrow({ where: { id: inserted[0].id } })
  return NextResponse.json({ reviewLink }, { status: 201 })
})
