// lib/ada-audit/site-audit-finalizer.ts
//
// Single source of truth for "this SiteAudit is done — write the summary and
// flip status to complete." Called from two places:
//   1. The per-page worker in queue-manager.ts when the last page settles
//      AND there are no PDFs in flight.
//   2. The per-PDF settle callback in pdf-orchestrator.ts when the last
//      pending PDF row resolves AND all pages are already done.
//
// Lives in its own module to avoid a queue-manager ↔ pdf-orchestrator cycle.

import { prisma } from '@/lib/db'
import { buildSiteAuditSummary } from './site-audit-helpers'
import { processNext } from './queue-manager'

export async function finalizeSiteAudit(id: string): Promise<void> {
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    // The relation on SiteAudit is `pageAudits` (see prisma/schema.prisma),
    // NOT `audits`. `pdfAudits` is the relation on AdaAudit added in this PR.
    include: { pageAudits: { include: { pdfAudits: true } } },
  })
  if (!audit) return
  if (audit.status === 'complete') return // idempotent — multiple PDF callbacks can race here

  const summary = buildSiteAuditSummary(audit.pageAudits)
  await prisma.siteAudit.update({
    where: { id },
    data: {
      status: 'complete',
      summary: JSON.stringify(summary),
    },
  })

  // Hand off the queue slot. Site audits don't have `progressMessage`;
  // only update fields that exist on the SiteAudit model.
  void processNext()
}
