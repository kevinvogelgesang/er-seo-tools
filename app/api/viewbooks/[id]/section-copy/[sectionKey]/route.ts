import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { putSectionCopyOverride, deleteSectionCopyOverride } from '@/lib/viewbook/section-copy-content'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; sectionKey: string }> }

export const PUT = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { id: rawId, sectionKey } = await params
  const body = requireJsonObject(await parseJsonBody<Record<string, unknown>>(request))
  await putSectionCopyOverride(parseId(rawId), sectionKey, body, operator)
  return NextResponse.json({ ok: true })
})

export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const { id: rawId, sectionKey } = await params
  await deleteSectionCopyOverride(parseId(rawId), sectionKey)
  return NextResponse.json({ ok: true })
})
