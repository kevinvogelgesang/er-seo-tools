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
    },
  })
}
