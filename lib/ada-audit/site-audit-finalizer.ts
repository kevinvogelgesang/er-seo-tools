// lib/ada-audit/site-audit-finalizer.ts
//
// Single source of truth for "this SiteAudit is done — write the summary and
// flip status to complete." Called from two places:
//   1. The per-page worker in queue-manager.ts when the last page settles
//      AND there are no PDFs in flight. (queue-manager's outer processNext()
//      recursion handles the queue kick after runAudit() returns.)
//   2. The per-PDF settle callback in pdf-orchestrator.ts when the last
//      pending PDF row resolves AND all pages are already done. (That caller
//      kicks processNext() itself via dynamic import so we don't import
//      queue-manager here.)
//
// Lives in its own module + has no queue-manager import to keep the
// dependency graph acyclic: queue-manager → finalizer (static),
// pdf-orchestrator → finalizer (dynamic), and finalizer is a leaf.

import { prisma } from '@/lib/db'
import { buildSiteAuditSummary } from './site-audit-helpers'
import { closeBatchIfDrained } from './audit-batch-helpers'

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

  // Close the batch if this audit was the last in-flight member.
  // Idempotent — closeBatchIfDrained is a no-op when others are still in flight.
  await closeBatchIfDrained(audit.batchId).catch((e) => {
    console.warn('[site-audit-finalizer] closeBatchIfDrained failed for batch', audit.batchId, ':', (e as Error).message)
  })
}
