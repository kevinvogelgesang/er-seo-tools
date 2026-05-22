// lib/ada-audit/site-audit-finalizer.ts
//
// Single decision point for a SiteAudit's terminal transition. Called from
// every settle pathway (page loop, PDF orchestrator, PSI worker). Owns the
// drain predicate: pages done && pdfs done && lighthouse done.
//
// When not fully drained, flips to the appropriate transient status
// (pdfs-running OR lighthouse-running) so the UI knows what we're waiting on
// and the queue treats this slot as in-flight. When fully drained, builds
// the summary, writes 'complete', closes the batch, and kicks the queue.
//
// Lives in its own module with no queue-manager import to keep the dep
// graph acyclic: queue-manager → finalizer (static), pdf-orchestrator →
// finalizer (dynamic), lighthouse-queue → finalizer (static). The queue
// kick happens here via dynamic import.

import { prisma } from '@/lib/db'
import { buildSiteAuditSummary } from './site-audit-helpers'
import { closeBatchIfDrained } from './audit-batch-helpers'

export async function finalizeSiteAudit(id: string): Promise<void> {
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    include: { pageAudits: { include: { pdfAudits: true } } },
  })
  if (!audit) return
  if (audit.status === 'complete' || audit.status === 'error' || audit.status === 'cancelled') return

  const pagesDone      = audit.pagesComplete + audit.pagesError >= audit.pagesTotal
  const pdfsDone       = audit.pdfsComplete + audit.pdfsError + audit.pdfsSkipped >= audit.pdfsTotal
  const lighthouseDone = audit.lighthouseComplete + audit.lighthouseError >= audit.lighthouseTotal

  if (!pagesDone) {
    // Page loop still owns the row — don't touch status.
    return
  }

  if (!pdfsDone || !lighthouseDone) {
    // PDFs win over lighthouse for the transient status — PDFs are typically
    // slower and more user-visible, so showing 'pdfs-running' is more
    // informative when both are outstanding.
    const next = !pdfsDone ? 'pdfs-running' : 'lighthouse-running'
    if (audit.status !== next) {
      await prisma.siteAudit.update({ where: { id }, data: { status: next } })
    }
    return
  }

  // All drained — build summary and finalize.
  const summary = buildSiteAuditSummary(audit.pageAudits)
  await prisma.siteAudit.update({
    where: { id },
    data: {
      status: 'complete',
      summary: JSON.stringify(summary),
    },
  })

  await closeBatchIfDrained(audit.batchId).catch((e) => {
    console.warn('[site-audit-finalizer] closeBatchIfDrained failed for batch', audit.batchId, ':', (e as Error).message)
  })

  // Kick the queue from here (via dynamic import to avoid the cycle).
  try {
    const { processNext } = await import('./queue-manager')
    void processNext()
  } catch (e) {
    console.warn('[site-audit-finalizer] processNext kick failed:', (e as Error).message)
  }
}
