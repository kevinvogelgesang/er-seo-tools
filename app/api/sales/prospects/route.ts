import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME, getOperatorLabel } from '@/lib/auth'
import { createProspect, listProspects } from '@/lib/services/prospects'

export const GET = withRoute(async () => {
  return NextResponse.json({ prospects: await listProspects() })
})

export const POST = withRoute(async (request: NextRequest) => {
  const body = await parseJsonBody<{ name?: unknown; domain?: unknown; notes?: unknown }>(request)
  const name = typeof body?.name === 'string' ? body.name : ''
  const domain = typeof body?.domain === 'string' ? body.domain : ''
  const notes = typeof body?.notes === 'string' ? body.notes : null
  const createdBy = await getOperatorLabel(
    request.cookies.get(AUTH_COOKIE_NAME)?.value,
    request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value,
  )
  const result = await createProspect({ name, domain, notes, createdBy })
  if (result.kind === 'invalid') return NextResponse.json({ error: result.reason }, { status: 400 })
  if (result.kind === 'existing') return NextResponse.json({ prospect: result.prospect, existing: true })
  return NextResponse.json({ prospect: result.prospect }, { status: 201 })
})
