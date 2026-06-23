// lib/jobs/handlers/stale-audit-reset.ts
//
// Scheduled-job wrapper around resetStaleAudits() (Phase 4 — replaces the
// 10-min setInterval in instrumentation.ts). It is a thin safety net since
// Phase 3; if the scheduler itself is wedged, audits aren't progressing
// either, and boot-time recoverQueue() is the real backstop.

import { registerJobHandler } from '../registry'

export const STALE_AUDIT_RESET_JOB_TYPE = 'stale-audit-reset'

export function registerStaleAuditResetHandler(): void {
  registerJobHandler({
    type: STALE_AUDIT_RESET_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 1,
    handler: async () => {
      // Dynamic import avoids a static handler → queue-manager → jobs/queue
      // edge (same reasoning as site-audit-discover).
      const { resetStaleAudits } = await import('@/lib/ada-audit/queue-manager')
      await resetStaleAudits()
      // C6: also recover stranded broken-link verifiers (guarded).
      await import('@/lib/ada-audit/broken-link-recovery')
        .then((m) => m.recoverBrokenLinkVerifies())
        .catch((err) => console.warn('[stale-audit-reset] broken-link verify recovery failed:', (err as Error).message))
      // C10: global stranded SEO-report recovery — re-enqueue seo-report-render jobs
      // for any non-terminal SeoReport whose heartbeat has gone cold. Guarded.
      await import('@/lib/seo-report-recovery')
        .then((m) => m.recoverSeoReports())
        .catch((err) => console.warn('[stale-audit-reset] seo-report recovery failed:', (err as Error).message))
    },
  })
}
