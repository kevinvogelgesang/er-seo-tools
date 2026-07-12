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
import type { Prisma } from '@prisma/client'
import { buildSiteAuditSummary } from './site-audit-helpers'
import { closeBatchIfDrained } from './audit-batch-helpers'
import { carryForwardSiteAuditChecks } from './carry-forward-checks'
import { mapAdaChildren } from '@/lib/findings/ada-mapper'
import { writeFindingsRun } from '@/lib/findings/writer'
import { enqueueBrokenLinkVerify } from '@/lib/jobs/handlers/broken-link-verify'
import { resolveAdaScoringWeights } from '@/lib/scoring/resolve-ada-weights'
import { DEFAULT_ADA_V4_WEIGHTS } from '@/lib/scoring/ada-v4'
import { publishInvalidation } from '@/lib/events/bus'
import { queueTopic, siteAuditTopic, clientSummaryTopic, recentsTopic } from '@/lib/events/topics'

export async function finalizeSiteAudit(id: string): Promise<void> {
  // Scalar-first: page settles call finalize once per page; loading every
  // child (with PDFs) on each call is O(pages²) over an audit. The heavy
  // include runs once, after the drain predicate passes.
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: {
      status: true, batchId: true, discoveredUrls: true, seoOnly: true,
      domain: true, clientId: true, wcagLevel: true, startedAt: true,
      pagesTotal: true, pagesComplete: true, pagesError: true, pagesRedirected: true,
      pdfsTotal: true, pdfsComplete: true, pdfsError: true, pdfsSkipped: true,
      lighthouseTotal: true, lighthouseComplete: true, lighthouseError: true,
    },
  })
  if (!audit) return
  if (audit.status === 'complete' || audit.status === 'error' || audit.status === 'cancelled') return
  if (audit.status === 'queued') return // promoter owns queued rows

  // Discovery guard: while the discover handler owns a 'running' row, all
  // counters are legitimately 0 and the drain predicate would be a lie.
  // discoveredUrls + pagesTotal are always written together (at creation for
  // pre-discovered audits, by the discover persist otherwise), so non-null
  // discoveredUrls means the predicate is meaningful.
  if (audit.status === 'running' && audit.discoveredUrls === null) return

  const pagesDone      = audit.pagesComplete + audit.pagesError + audit.pagesRedirected >= audit.pagesTotal
  const pdfsDone       = audit.pdfsComplete + audit.pdfsError + audit.pdfsSkipped >= audit.pdfsTotal
  const lighthouseDone = audit.lighthouseComplete + audit.lighthouseError >= audit.lighthouseTotal

  if (!pagesDone) {
    // Page jobs still own the row — don't touch status.
    return
  }

  if (!pdfsDone || !lighthouseDone) {
    // PDFs win over lighthouse for the transient status — PDFs are typically
    // slower and more user-visible, so showing 'pdfs-running' is more
    // informative when both are outstanding.
    const next = !pdfsDone ? 'pdfs-running' : 'lighthouse-running'
    if (audit.status !== next) {
      await prisma.siteAudit.update({ where: { id }, data: { status: next } })
      // A5: the transient status flip changed the queue view (which phase the
      // active audit is in). Emit AFTER the write, only when we actually
      // transitioned (guarded on audit.status !== next above).
      publishInvalidation(queueTopic())
    }
    return
  }

  // All drained — NOW build the completion. A full audit loads its children
  // and writes an ADA summary; a seoOnly audit (C11) has no axe results, so it
  // writes a bare `complete` with a null summary and never loads children (the
  // children exist only for the ADA summary + dual-write, both skipped below).
  // Deterministic order (A2): the findings mapper's keep-first URL dedupe
  // must keep the same child here as in writeAdaSiteFindings/compareAdaParity.
  // Harmless to the summary build (it re-sorts pages itself).
  const completedAt = new Date()
  let pageAudits: Prisma.AdaAuditGetPayload<{ include: { pdfAudits: true } }>[] | null = null
  if (audit.seoOnly) {
    await prisma.siteAudit.update({
      where: { id },
      data: { status: 'complete', summary: null, completedAt },
    })
    // A5: the terminal flip released the queue slot. Emit `queue` only —
    // seoOnly `site-audit:<id>` readiness re-emit is deferred to Task 14
    // (the live-scan run isn't ready at this point).
    publishInvalidation(queueTopic())
  } else {
    pageAudits = await prisma.adaAudit.findMany({
      where: { siteAuditId: id },
      include: { pdfAudits: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const summary = buildSiteAuditSummary(pageAudits)
    await prisma.siteAudit.update({
      where: { id },
      data: {
        status: 'complete',
        summary: JSON.stringify(summary),
        completedAt,
      },
    })
    // A5: the terminal flip released the queue slot AND the audit's detail
    // view is now complete (summary written). Emit AFTER the write.
    publishInvalidation(queueTopic())
    publishInvalidation(siteAuditTopic(id))
  }

  // Order below is IDENTICAL to the full-audit path today: closeBatch →
  // processNext → (ADA-only) carryForward → ADA dual-write →
  // enqueueBrokenLinkVerify (LAST, both modes).
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

  if (!audit.seoOnly && pageAudits) {
    // Carry triage checks forward from the previous completed same-domain
    // audit (C2). Fire-and-forget; invoked before the findings hook so the
    // findings hook stays LAST. Disjoint tables — overlap is harmless.
    void carryForwardSiteAuditChecks(id).catch((e) => {
      console.error('[checks] carry-forward failed for site audit', id, e)
    })

    // Dual-write the normalized findings run (A2 Phase 2). Fire-and-forget and
    // best-effort: must never delay or fail the legacy completion side effects
    // above. The bundle maps from the already-loaded children — no second load.
    // Skipped for seoOnly: no ADA results, and an empty ada-audit run would
    // make ADA export routes (which gate purely on the run existing) look valid.
    try {
      // C19 PR3: score with the operator profile; fall back to defaults rather
      // than lose the findings run to a transient weights-read failure.
      const adaWeights = await resolveAdaScoringWeights().catch((e) => {
        console.warn('[findings] ADA weights resolve failed — scoring with defaults:', (e as Error).message)
        return { ...DEFAULT_ADA_V4_WEIGHTS }
      })
      const bundle = mapAdaChildren(
        {
          id,
          domain: audit.domain,
          clientId: audit.clientId,
          wcagLevel: audit.wcagLevel,
          pagesError: audit.pagesError,
          startedAt: audit.startedAt,
          completedAt,
          pagesTotal: audit.pagesTotal,
        },
        pageAudits,
        adaWeights,
      )
      void writeFindingsRun(bundle)
        .then(() => {
          // A5 Task 14: the CrawlRun.score didn't exist at the parent-completion
          // flip above — this is the actual data-ready moment for client/recents
          // consumers of this audit's score. Post-commit, outside any tx.
          publishInvalidation(clientSummaryTopic())
          publishInvalidation(recentsTopic())
        })
        .catch((e) => {
          console.error('[findings] ADA dual-write failed for site audit', id, e)
        })
    } catch (e) {
      console.error('[findings] ADA bundle mapping failed for site audit', id, e)
    }
  }

  // C6: verify harvested links out-of-band. Fire-and-forget, and the LAST step
  // here — the audit is now terminal 'complete', which is what makes reusing the
  // site-audit:<id> job group liveness-safe (finalize early-returns on complete,
  // so a pending verifier can never trip recovery). Does no DB writes itself.
  void enqueueBrokenLinkVerify(id, audit.domain)
}
