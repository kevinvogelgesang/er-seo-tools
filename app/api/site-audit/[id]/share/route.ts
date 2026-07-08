import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000

function buildShareUrl(token: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${origin}/ada-audit/site/share/${token}`
}

// ─── POST /api/site-audit/[id]/share ─────────────────────────────────────────
// Generates (or returns existing) share token for a completed site audit.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: { id: true, status: true, shareToken: true, shareExpiresAt: true, seoOnly: true },
  })

  if (!audit) {
    return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  }

  if (audit.status !== 'complete') {
    return NextResponse.json(
      { error: 'Site audit must be complete before sharing' },
      { status: 400 }
    )
  }

  if (audit.seoOnly) {
    return NextResponse.json(
      { error: 'SEO-only scans are not shareable as accessibility reports' },
      { status: 400 }
    )
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + SHARE_TTL_MS)

  // Return existing token if it is still valid; rotate expired tokens.
  let token = audit.shareToken

  if (!token || !audit.shareExpiresAt || audit.shareExpiresAt <= now) {
    token = crypto.randomUUID()
    await prisma.siteAudit.update({
      where: { id },
      data: { shareToken: token, shareExpiresAt: expiresAt },
    })
  } else {
    await prisma.siteAudit.update({
      where: { id },
      data: { shareExpiresAt: expiresAt },
    })
  }

  const shareUrl = buildShareUrl(token)
  return NextResponse.json({ shareUrl, expiresAt: expiresAt.toISOString() })
}

// ─── GET /api/site-audit/[id]/share ──────────────────────────────────────────
// Returns share token info for the given site audit.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: { shareToken: true, shareExpiresAt: true },
  })

  if (!audit) {
    return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  }

  if (!audit.shareToken || !audit.shareExpiresAt || audit.shareExpiresAt <= new Date()) {
    return NextResponse.json({ shareToken: null })
  }

  const shareUrl = buildShareUrl(audit.shareToken)
  return NextResponse.json({
    shareToken: audit.shareToken,
    shareUrl,
    expiresAt: audit.shareExpiresAt.toISOString(),
  })
}
