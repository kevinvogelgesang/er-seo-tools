// lib/jobs/handlers/cleanup.ts
//
// Scheduled-job wrapper around runCleanup() (Phase 4 — replaces the daily
// setInterval that lived in instrumentation.ts; the inline startup call
// remains there). maxAttempts 1: the next daily slot IS the retry, matching
// the old interval semantics. runCleanup swallows per-task failures
// internally (Promise.allSettled), so a throw here is unexpected (DB/FS
// down) and correctly fails the job — visible in introspection.

import { runCleanup } from '@/lib/cleanup'
import { registerJobHandler } from '../registry'

export const CLEANUP_JOB_TYPE = 'cleanup'

export function registerCleanupHandler(): void {
  registerJobHandler({
    type: CLEANUP_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 1,
    // FS-heavy passes over 180-day-old sessions can be slow on the VPS.
    timeoutMs: 10 * 60 * 1000,
    handler: async () => {
      await runCleanup()
    },
  })
}
