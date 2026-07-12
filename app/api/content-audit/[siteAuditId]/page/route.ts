import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireContentAuditToken } from '@/lib/content-audit/route-auth'
import { loadContentAuditPageText } from '@/lib/content-audit/manifest'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ siteAuditId: string }> }

export const GET = withRoute(async (req: NextRequest, { params }: RouteParams) => {
  const { siteAuditId } = await params
  const auth = await requireContentAuditToken(req, siteAuditId, 'read')
  if (!auth.ok) return auth.res
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'missing_url' }, { status: 400 })
  const result = await loadContentAuditPageText(siteAuditId, url, new Date())
  if ('status' in result) return NextResponse.json({ error: 'text_unavailable' }, { status: result.status })
  return NextResponse.json(result)
})
