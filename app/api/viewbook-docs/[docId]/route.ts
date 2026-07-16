import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { deleteViewbookDoc } from '@/lib/viewbook/docs'
import { parseId } from '@/lib/viewbook/route-utils'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ docId: string }> }

export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const docId = parseId((await params).docId)
  await deleteViewbookDoc(docId, null)
  return NextResponse.json({ ok: true })
})
