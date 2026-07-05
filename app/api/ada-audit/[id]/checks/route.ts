import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME, getOperatorLabel } from '@/lib/auth'
import { getAdaAuditChecks, setAdaAuditCheck } from '@/lib/ada-audit/checks-store'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'

export const dynamic = 'force-dynamic'

export const GET = withRoute(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const audit = await prisma.adaAudit.findUnique({ where: { id }, select: { id: true } })
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  const checks = await getAdaAuditChecks(id)
  return NextResponse.json({ checks })
})

export const PUT = withRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const audit = await prisma.adaAudit.findUnique({ where: { id }, select: { id: true } })
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })

  const body = await parseJsonBody(req)
  const b = body as Record<string, unknown>
  const scope = b.scope
  const key = b.key
  const checked = b.checked
  if (scope !== 'node' || typeof key !== 'string' || typeof checked !== 'boolean') {
    return NextResponse.json({ error: 'scope must be "node", key must be string, checked must be boolean' }, { status: 400 })
  }
  // Keys are sha256 hex digests produced client-side. Reject anything that
  // isn't the canonical 64-char lowercase hex shape so the table can't be
  // poisoned with arbitrary strings.
  if (!/^[0-9a-f]{64}$/.test(key)) {
    return NextResponse.json({ error: 'key must be a 64-char lowercase hex string' }, { status: 400 })
  }

  const operator = await getOperatorLabel(
    req.cookies.get(AUTH_COOKIE_NAME)?.value,
    req.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value,
  )
  const checks = await setAdaAuditCheck({ adaAuditId: id, scope: 'node', key, checked, operator })
  return NextResponse.json({ checks })
})
