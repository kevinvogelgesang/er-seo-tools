import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { requireJsonObject } from '@/lib/viewbook/route-utils'
import { putSectionCopyGlobal, deleteSectionCopyGlobal } from '@/lib/viewbook/section-copy-content'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ sectionKey: string }> }

/** PUT /api/viewbooks/section-copy/:sectionKey — company-wide section copy override. */
export const PUT = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { sectionKey } = await params
  const body = requireJsonObject(await parseJsonBody<Record<string, unknown>>(request))
  await putSectionCopyGlobal(sectionKey, body, operator)
  return NextResponse.json({ ok: true })
})

/** DELETE /api/viewbooks/section-copy/:sectionKey — revert to code default. */
export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const { sectionKey } = await params
  await deleteSectionCopyGlobal(sectionKey)
  return NextResponse.json({ ok: true })
})
