// app/api/site-audit/bulk-queue/route.ts
//
// "Queue all clients" — POSTed by the Clients section bulk button.
// Pre-flight: if ANY client has zero domains, refuse with 400 + the offending
// list so the operator can fix the data before queueing anything. Per-client
// duplicates (already in flight) are collected in the response's `skipped`
// list, not propagated as failures.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const requestedBy = sanitizeOperatorName(request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value)

  const clients = await prisma.client.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, domains: true },
  })

  // Pre-check: any client without a domain triggers a hard 400 with the list.
  const clientsWithoutDomains: { id: number; name: string }[] = []
  const eligible: { id: number; name: string; firstDomain: string }[] = []
  for (const c of clients) {
    let domains: string[] = []
    try { domains = JSON.parse(c.domains) } catch { /* keep [] */ }
    const firstDomain = domains.find((d) => typeof d === 'string' && d.trim() !== '')
    if (!firstDomain) {
      clientsWithoutDomains.push({ id: c.id, name: c.name })
    } else {
      eligible.push({ id: c.id, name: c.name, firstDomain })
    }
  }

  if (clientsWithoutDomains.length > 0) {
    return NextResponse.json(
      { error: 'missing_domains', clientsWithoutDomains },
      { status: 400 },
    )
  }

  const queued: { clientId: number; auditId: string }[] = []
  const skipped: { clientId: number; reason: string }[] = []

  // Sequential rather than Promise.all so the open-batch logic and the
  // partial unique index don't see a thundering herd. ~30 clients is fast
  // enough sequentially.
  for (const c of eligible) {
    const result = await queueSiteAuditRequest({
      domain: c.firstDomain,
      clientId: c.id,
      wcagLevel: 'wcag21aa',
      requestedBy,
    })
    if (result.kind === 'queued') {
      queued.push({ clientId: c.id, auditId: result.id })
    } else if (result.kind === 'duplicate') {
      skipped.push({ clientId: c.id, reason: `already queued or running (audit ${result.existingId})` })
    } else {
      skipped.push({ clientId: c.id, reason: result.reason })
    }
  }

  return NextResponse.json({ queued, skipped })
}
