import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId } from '@/lib/viewbook/route-utils'
import { lockViewbook } from '@/lib/viewbook/answers'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operatorEmail = await requireOperatorEmail(request)
  const id = parseId((await params).id)
  return NextResponse.json(await lockViewbook(id, operatorEmail))
})
