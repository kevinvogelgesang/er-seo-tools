import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { listActivity } from '@/lib/viewbook/activity'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId } from '@/lib/viewbook/route-utils'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

function optionalPositiveInt(raw: string | null): number | undefined {
  if (raw == null) return undefined
  if (!/^[1-9][0-9]*$/.test(raw)) throw new HttpError(400, 'invalid_cursor')
  return Number(raw)
}

export const GET = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const viewbookId = parseId((await params).id)
  const exists = await prisma.viewbook.findUnique({ where: { id: viewbookId }, select: { id: true } })
  if (!exists) throw new HttpError(404, 'not_found')
  const url = new URL(request.url)
  const feed = await listActivity(
    viewbookId,
    optionalPositiveInt(url.searchParams.get('cursor')),
    optionalPositiveInt(url.searchParams.get('limit')),
  )
  return NextResponse.json(feed)
})
