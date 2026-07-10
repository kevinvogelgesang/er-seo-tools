// POST extends-or-rotates (mirror of app/api/site-audit/[id]/share); GET is read-only.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'

export const SALES_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function buildSalesUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${base}/sales/${token}`
}

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export const POST = withRoute(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const id = parseId((await params).id)
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const prospect = await prisma.prospect.findUnique({
    where: { id },
    select: { salesToken: true, salesTokenExpiresAt: true },
  })
  if (!prospect) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const now = new Date()
  const expiresAt = new Date(now.getTime() + SALES_TTL_MS)
  let token = prospect.salesToken
  if (!token || !prospect.salesTokenExpiresAt || prospect.salesTokenExpiresAt <= now) {
    token = crypto.randomUUID()
    await prisma.prospect.update({ where: { id }, data: { salesToken: token, salesTokenExpiresAt: expiresAt } })
  } else {
    await prisma.prospect.update({ where: { id }, data: { salesTokenExpiresAt: expiresAt } })
  }
  return NextResponse.json({ salesUrl: buildSalesUrl(token), expiresAt: expiresAt.toISOString() })
})

export const GET = withRoute(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const id = parseId((await params).id)
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const prospect = await prisma.prospect.findUnique({
    where: { id },
    select: { salesToken: true, salesTokenExpiresAt: true },
  })
  if (!prospect) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!prospect.salesToken || !prospect.salesTokenExpiresAt || prospect.salesTokenExpiresAt <= new Date()) {
    return NextResponse.json({ salesToken: null })
  }
  return NextResponse.json({
    salesToken: prospect.salesToken,
    salesUrl: buildSalesUrl(prospect.salesToken),
    expiresAt: prospect.salesTokenExpiresAt.toISOString(),
  })
})
