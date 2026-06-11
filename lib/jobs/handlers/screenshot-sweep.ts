// lib/jobs/handlers/screenshot-sweep.ts
//
// Scheduled-job wrapper around sweepExpiredScreenshots() (Phase 4 — replaces
// the sweeper's own 30-min setInterval module state). maxAttempts 1: the
// next slot is the retry. The sweep walks SCREENSHOTS_DIR with one DB lookup
// per directory and per-directory try/catch, so a throw is unexpected.

import { sweepExpiredScreenshots } from '@/lib/ada-audit/screenshot-sweeper'
import { registerJobHandler } from '../registry'

export const SCREENSHOT_SWEEP_JOB_TYPE = 'screenshot-sweep'

export function registerScreenshotSweepHandler(): void {
  registerJobHandler({
    type: SCREENSHOT_SWEEP_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 1,
    // One DB lookup per screenshot dir; large fleets can outgrow 5 min.
    timeoutMs: 10 * 60 * 1000,
    handler: async () => {
      await sweepExpiredScreenshots()
    },
  })
}
