// Cookie-gated poll for the dashboard ContentAuditCard. Returns whether a
// content audit has been ingested + the raw JSON. NEVER reuses the public
// token routes (Codex #4).
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ id: string }> }

export const GET = withRoute(async (_req: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: id, tool: 'seo-parser' } },
    select: { contentAuditJson: true },
  })
  return NextResponse.json({ minted: run?.contentAuditJson != null, contentAuditJson: run?.contentAuditJson ?? null })
})
