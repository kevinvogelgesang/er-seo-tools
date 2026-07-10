import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME, getOperatorLabel } from '@/lib/auth'
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'

export const POST = withRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const prospect = await prisma.prospect.findUnique({ where: { id }, select: { id: true, domain: true } })
  if (!prospect) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const requestedBy = await getOperatorLabel(
    request.cookies.get(AUTH_COOKIE_NAME)?.value,
    request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value,
  )
  // FULL audit — Accessibility + Performance sections need axe + PSI (never seoOnly).
  const result = await queueSiteAuditRequest({
    domain: prospect.domain,
    clientId: null,
    prospectId: prospect.id,
    wcagLevel: 'wcag21aa',
    requestedBy,
    seoOnly: false,
  })
  if (result.kind === 'invalid') return NextResponse.json({ error: result.reason }, { status: 400 })
  if (result.kind === 'duplicate') return NextResponse.json({ error: 'audit already in flight', auditId: result.existingId }, { status: 409 })
  return NextResponse.json({ auditId: result.id }, { status: 202 })
})
