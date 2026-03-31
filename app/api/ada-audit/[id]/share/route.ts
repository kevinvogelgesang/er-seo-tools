import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// ─── POST /api/ada-audit/[id]/share ──────────────────────────────────────────
// Generates (or returns existing) share token for a completed audit.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const audit = await prisma.adaAudit.findUnique({
    where: { id },
    select: { id: true, status: true, shareToken: true },
  })

  if (!audit) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  }

  if (audit.status !== 'complete') {
    return NextResponse.json(
      { error: 'Audit must be complete before sharing' },
      { status: 400 }
    )
  }

  // Return existing token if already generated
  let token = audit.shareToken

  if (!token) {
    token = crypto.randomUUID()
    await prisma.adaAudit.update({
      where: { id },
      data: { shareToken: token },
    })
  }

  const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL}/ada-audit/share/${token}`
  return NextResponse.json({ shareUrl })
}

// ─── GET /api/ada-audit/[id]/share ───────────────────────────────────────────
// Returns share token info for the given audit.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const audit = await prisma.adaAudit.findUnique({
    where: { id },
    select: { shareToken: true },
  })

  if (!audit) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  }

  if (!audit.shareToken) {
    return NextResponse.json({ shareToken: null })
  }

  const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL}/ada-audit/share/${audit.shareToken}`
  return NextResponse.json({ shareToken: audit.shareToken, shareUrl })
}
