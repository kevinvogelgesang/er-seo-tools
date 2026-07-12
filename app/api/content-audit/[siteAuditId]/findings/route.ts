// PATCH ingest for the cat_ bridge. Order (Codex #3): bounded-body read (byte cap
// regardless of Content-Length) -> parse -> requireContentAuditToken(findings-write)
// -> validate (caps + evidence-URL binding) -> store on the live-scan CrawlRun.
// Last-writer-wins.
import { NextRequest, NextResponse } from 'next/server'
import { HttpError } from '@/lib/api/errors'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'
import { readBoundedText } from '@/lib/content-audit/read-bounded-json'
import { requireContentAuditToken } from '@/lib/content-audit/route-auth'
import { validateContentAuditFindings } from '@/lib/content-audit/ingest-schema'
import { contentAuditEligibleUrls } from '@/lib/content-audit/manifest'
import { publishInvalidation } from '@/lib/events/bus'
import { contentAuditTopic } from '@/lib/events/topics'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ siteAuditId: string }> }
const MAX_BODY_BYTES = 300 * 1024 // > the 256K aggregate cap, leaves envelope room

export const PATCH = withRoute(async (req: NextRequest, { params }: RouteParams) => {
  const { siteAuditId } = await params

  const raw = await readBoundedText(req, MAX_BODY_BYTES)
  if (raw === null) return NextResponse.json({ error: 'body_too_large' }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(raw) } catch { throw new HttpError(400, 'invalid_json') }

  const auth = await requireContentAuditToken(req, siteAuditId, 'findings-write')
  if (!auth.ok) return auth.res

  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } }, select: { id: true },
  })
  if (!run) return NextResponse.json({ error: 'no_live_scan_run' }, { status: 409 })

  const allowed = await contentAuditEligibleUrls(siteAuditId)
  const result = validateContentAuditFindings(body, allowed, new Date())
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: 400 })

  await prisma.crawlRun.update({ where: { id: run.id }, data: { contentAuditJson: JSON.stringify(result.payload) } })
  // A5 Task 20: the ContentAuditCard subscribes to this topic to refetch
  // immediately once the skill's PATCH lands ingested findings. Emitted AFTER
  // the awaited update resolves (a resolved update() always succeeded — P2025
  // on a missing row throws and never reaches here).
  publishInvalidation(contentAuditTopic(siteAuditId))
  return NextResponse.json({ ok: true, count: result.payload.findings.length })
})
