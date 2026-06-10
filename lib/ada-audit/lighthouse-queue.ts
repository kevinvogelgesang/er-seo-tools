// lib/ada-audit/lighthouse-queue.ts
//
// Thin facade over the durable job queue for PageSpeed Insights work. The
// page loop calls enqueuePsiJob() after each page's axe completes; the jobs
// worker drains them via lib/jobs/handlers/psi.ts (concurrency =
// PSI_CONCURRENCY). The in-memory worker pool that used to live here was
// deleted after production parity (2026-06-10) — PSI jobs are durable and
// survive restarts.

export interface PsiJob {
  adaAuditId: string
  siteAuditId: string
  url: string
  wcagLevel: string
}

export function enqueuePsiJob(job: PsiJob): void {
  void import('@/lib/jobs/queue')
    .then(({ enqueueJob }) =>
      enqueueJob({
        type: 'psi',
        payload: job,
        dedupKey: `psi:${job.adaAuditId}`,
        groupKey: `site-audit:${job.siteAuditId}`,
      }),
    )
    .catch(async (err) => {
      // The page loop already committed axe-complete + lighthouseTotal++.
      // With no durable job, nothing would ever drain this page — settle
      // the LH portion as failed NOW instead of waiting for the parent's
      // stale-failure path.
      console.error('[lighthouse-queue] durable PSI enqueue failed for', job.adaAuditId, ':', (err as Error).message)
      try {
        const { settlePsiFailure } = await import('@/lib/jobs/handlers/psi')
        await settlePsiFailure(job, `Failed to enqueue durable PSI job: ${(err as Error).message}`)
      } catch (settleErr) {
        console.error('[lighthouse-queue] PSI enqueue-failure settle also failed for', job.adaAuditId, ':', (settleErr as Error).message)
      }
    })
}
