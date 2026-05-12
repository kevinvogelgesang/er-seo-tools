import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000

function buildShareUrl(request: NextRequest, token: string): string {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    request.headers.get('origin') ||
    'http://localhost:3000'
  return `${origin}/ada-audit/share/${token}`
}

// ─── POST /api/ada-audit/[id]/share ──────────────────────────────────────────
// Generates (or returns existing) share token for a completed audit.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const audit = await prisma.adaAudit.findUnique({
    where: { id },
    select: { id: true, status: true, shareToken: true, shareExpiresAt: true },
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

  const now = new Date()
  const expiresAt = new Date(now.getTime() + SHARE_TTL_MS)

  // Return existing token if it is still valid; rotate expired tokens.
  let token = audit.shareToken

  if (!token || !audit.shareExpiresAt || audit.shareExpiresAt <= now) {
    token = crypto.randomUUID()
    await prisma.adaAudit.update({
      where: { id },
      data: { shareToken: token, shareExpiresAt: expiresAt },
    })
  } else {
    await prisma.adaAudit.update({
      where: { id },
      data: { shareExpiresAt: expiresAt },
    })
  }

  const shareUrl = buildShareUrl(request, token)
  return NextResponse.json({ shareUrl, expiresAt: expiresAt.toISOString() })
}

// ─── GET /api/ada-audit/[id]/share ───────────────────────────────────────────
// Returns share token info for the given audit.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const audit = await prisma.adaAudit.findUnique({
    where: { id },
    select: { shareToken: true, shareExpiresAt: true },
  })

  if (!audit) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  }

  if (!audit.shareToken || !audit.shareExpiresAt || audit.shareExpiresAt <= new Date()) {
    return NextResponse.json({ shareToken: null })
  }

  const shareUrl = buildShareUrl(request, audit.shareToken)
  return NextResponse.json({
    shareToken: audit.shareToken,
    shareUrl,
    expiresAt: audit.shareExpiresAt.toISOString(),
  })
}
