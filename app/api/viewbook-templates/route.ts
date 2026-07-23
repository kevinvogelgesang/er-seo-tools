import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { getTemplateTree } from '@/lib/viewbook/template-service'

export const dynamic = 'force-dynamic'

/** GET /api/viewbook-templates — the full section/subsection/field tree. */
export const GET = withRoute(async (request: NextRequest) => {
  await requireOperatorEmail(request)
  return NextResponse.json(await getTemplateTree())
})
