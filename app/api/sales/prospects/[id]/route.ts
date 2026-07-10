import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export const DELETE = withRoute(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const id = parseId((await params).id)
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const existing = await prisma.prospect.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  await prisma.prospect.delete({ where: { id } }) // SiteAudit.prospectId SetNulls via relation
  return NextResponse.json({ ok: true })
})
