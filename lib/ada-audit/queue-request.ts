// lib/ada-audit/queue-request.ts
//
// Shared "validate + dedup + enqueue" helper. Owned by:
//   - POST /api/site-audit (single audit request)
//   - POST /api/site-audit/bulk-queue (per-client iteration)
//
// The in-flight duplicate guard lives here (not in enqueueAudit) because the
// queue-manager itself shouldn't reject — it's a producer interface used by
// recovery paths too. Keeping the guard at the request layer means both
// route handlers see the same dedup behavior.

import { prisma } from '@/lib/db'
import { enqueueAudit } from './queue-manager'
import { normaliseSiteAuditDomain, normaliseDiscoveredSiteAuditUrls } from './site-audit-helpers'

const IN_FLIGHT_STATUSES = ['queued', 'pending', 'running', 'pdfs-running', 'lighthouse-running']

export type QueueRequestResult =
  | { kind: 'queued'; id: string }
  | { kind: 'duplicate'; existingId: string }
  | { kind: 'invalid'; reason: string }

export interface QueueRequestInput {
  domain: string
  clientId: number | null
  wcagLevel: string
  preDiscoveredUrls?: string[]
  requestedBy?: string | null
}

export async function queueSiteAuditRequest(input: QueueRequestInput): Promise<QueueRequestResult> {
  const rawDomain = typeof input.domain === 'string' ? input.domain.trim() : ''
  if (!rawDomain) return { kind: 'invalid', reason: 'domain is required' }

  const domain = normaliseSiteAuditDomain(rawDomain)
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return { kind: 'invalid', reason: 'Invalid domain (e.g. example.edu)' }
  }

  const existing = await prisma.siteAudit.findFirst({
    where: { domain, status: { in: IN_FLIGHT_STATUSES } },
    select: { id: true },
  })
  if (existing) return { kind: 'duplicate', existingId: existing.id }

  let effectivePreDiscoveredUrls = input.preDiscoveredUrls
  if (
    (!effectivePreDiscoveredUrls || effectivePreDiscoveredUrls.length === 0) &&
    typeof input.clientId === 'number'
  ) {
    const client = await prisma.client.findFirst({
      where: { id: input.clientId, archivedAt: null }, // archived clients contribute no seed URLs
      select: { seedUrls: true },
    })
    if (client?.seedUrls) {
      try {
        const parsed = JSON.parse(client.seedUrls)
        if (Array.isArray(parsed)) effectivePreDiscoveredUrls = parsed
      } catch { /* ignore — treat as no seedUrls */ }
    }
  }

  const normalisedUrls = effectivePreDiscoveredUrls
    ? normaliseDiscoveredSiteAuditUrls(effectivePreDiscoveredUrls, domain)
    : undefined

  if (effectivePreDiscoveredUrls && effectivePreDiscoveredUrls.length > 0 && (!normalisedUrls || normalisedUrls.length === 0)) {
    return { kind: 'invalid', reason: `No submitted URLs belong to ${domain}` }
  }

  const wcagLevel = input.wcagLevel === 'wcag22aa' ? 'wcag22aa' : 'wcag21aa'
  const { id } = await enqueueAudit(domain, input.clientId, wcagLevel, {
    preDiscoveredUrls: normalisedUrls,
    requestedBy: input.requestedBy ?? null,
  })
  return { kind: 'queued', id }
}
