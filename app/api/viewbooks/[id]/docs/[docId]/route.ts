import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { prisma } from '@/lib/db'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { deleteViewbookDoc } from '@/lib/viewbook/docs'
import { parseId } from '@/lib/viewbook/route-utils'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ id: string; docId: string }> }

export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const raw = await params
  const id = parseId(raw.id)
  const docId = parseId(raw.docId)
  const row = await prisma.viewbook.findUnique({
    where: { id },
    select: { client: { select: { archivedAt: true } } },
  })
  if (!row) throw new HttpError(404, 'not_found')
  if (row.client.archivedAt) throw new HttpError(409, 'client_archived')
  await deleteViewbookDoc(docId, id)
  return NextResponse.json({ ok: true })
})
