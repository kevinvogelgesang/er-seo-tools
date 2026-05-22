import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'
import { getAdaAuditChecks, setAdaAuditCheck } from '@/lib/ada-audit/checks-store'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const audit = await prisma.adaAudit.findUnique({ where: { id }, select: { id: true } })
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  const checks = await getAdaAuditChecks(id)
  return NextResponse.json({ checks })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const audit = await prisma.adaAudit.findUnique({ where: { id }, select: { id: true } })
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const b = body as Record<string, unknown>
  const scope = b.scope
  const key = b.key
  const checked = b.checked
  if (scope !== 'node' || typeof key !== 'string' || typeof checked !== 'boolean') {
    return NextResponse.json({ error: 'scope must be "node", key must be string, checked must be boolean' }, { status: 400 })
  }

  const operator = sanitizeOperatorName(req.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value)
  const checks = await setAdaAuditCheck({ adaAuditId: id, scope: 'node', key, checked, operator })
  return NextResponse.json({ checks })
}
