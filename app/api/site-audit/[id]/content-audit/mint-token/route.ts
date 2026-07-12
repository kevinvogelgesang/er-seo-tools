// Cookie-gated mint for the cat_ content-audit bridge. Guards: audit complete +
// has a seo-parser live-scan run + client not archived. Extends the retention
// window (max(), never shorten) to the token's life; reports textAvailable.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'
import { mintContentAuditToken, CONTENT_AUDIT_TOKEN_TTL_MS } from '@/lib/content-audit-token'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ id: string }> }

export const POST = withRoute(async (_req: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: { id: true, status: true, contentAuditRetainUntil: true, client: { select: { archivedAt: true } } },
  })
  if (!audit) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (audit.status !== 'complete') return NextResponse.json({ error: 'audit_not_complete' }, { status: 409 })
  if (audit.client?.archivedAt) return NextResponse.json({ error: 'client_archived' }, { status: 409 })
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: id, tool: 'seo-parser' } },
    select: { id: true },
  })
  if (!run) return NextResponse.json({ error: 'no_live_scan_run' }, { status: 409 })

  // Codex plan #2: atomic MONOTONIC extension. `now + TTL` is always >= any
  // earlier extension, so a conditional raw UPDATE that only RAISES the column
  // can't shorten a concurrently-extended window (no read-modify-write race).
  // Integer-ms bind (DateTime storage is integer ms — see the sweep note).
  const extendedMs = Date.now() + CONTENT_AUDIT_TOKEN_TTL_MS
  await prisma.$executeRaw`
    UPDATE "SiteAudit" SET "contentAuditRetainUntil" = ${extendedMs}
    WHERE "id" = ${id}
      AND ("contentAuditRetainUntil" IS NULL OR "contentAuditRetainUntil" < ${extendedMs})`

  // Re-read the effective window (a concurrent mint may have set it higher) +
  // whether any retained text remains, to report an honest textAvailable.
  const fresh = await prisma.siteAudit.findUnique({ where: { id }, select: { contentAuditRetainUntil: true } })
  const textRows = await prisma.harvestedPageSeo.count({ where: { siteAuditId: id, contentText: { not: null } } })
  const windowOpen = (fresh?.contentAuditRetainUntil?.getTime() ?? 0) > Date.now()
  const textAvailable = textRows > 0 && windowOpen

  const minted = await mintContentAuditToken(id)
  return NextResponse.json({ token: minted.token, expiresAt: minted.expiresAt, textAvailable })
})
