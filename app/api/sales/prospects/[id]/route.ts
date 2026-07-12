import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'
import { publishInvalidation } from '@/lib/events/bus'
import { prospectListTopic } from '@/lib/events/topics'

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
  // A5 Task 19: a row disappeared from the /sales dashboard list. Emit AFTER
  // the delete resolved (unreached on the 404 above — nothing changed there).
  publishInvalidation(prospectListTopic())
  return NextResponse.json({ ok: true })
})
