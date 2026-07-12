import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireContentAuditToken } from '@/lib/content-audit/route-auth'
import { loadContentAuditManifest } from '@/lib/content-audit/manifest'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ siteAuditId: string }> }

export const GET = withRoute(async (req: NextRequest, { params }: RouteParams) => {
  const { siteAuditId } = await params
  const auth = await requireContentAuditToken(req, siteAuditId, 'read')
  if (!auth.ok) return auth.res
  const manifest = await loadContentAuditManifest(siteAuditId, new Date())
  if (!manifest) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(manifest)
})
