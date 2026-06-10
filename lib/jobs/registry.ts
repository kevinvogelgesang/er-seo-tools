// lib/jobs/registry.ts
//
// In-process handler registry for the durable job queue. Handlers are
// registered at worker startup; the registry is module-level state, which is
// correct under the single-process PM2 assumption.

import {
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
} from './config'
import type { JobHandlerConfig, ResolvedJobHandlerConfig } from './types'

const registry = new Map<string, ResolvedJobHandlerConfig>()

export function registerJobHandler(config: JobHandlerConfig): void {
  registry.set(config.type, {
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    backoffBaseMs: DEFAULT_BACKOFF_BASE_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...config,
  })
}

export function getJobHandler(type: string): ResolvedJobHandlerConfig | undefined {
  return registry.get(type)
}

export function listJobTypes(): string[] {
  return [...registry.keys()]
}

export function clearJobRegistryForTests(): void {
  registry.clear()
}

/**
 * Invoke the type's onExhausted hook (if any). Best-effort: hook errors are
 * logged, never thrown — callers are settle/recovery paths that must finish.
 * Called from EVERY path that flips a job to terminal 'error'.
 *
 * KNOWN FALLBACK: if the hook itself fails, the domain settle is lost and the
 * owning entity (e.g. a lighthouse-running SiteAudit) is eventually cleaned
 * up by its parent-level stale-failure path (resetStaleAudits). Acceptable
 * for Phase 1; revisit if a job type ever needs a guaranteed domain settle.
 */
export async function runOnExhausted(
  type: string,
  payloadJson: string,
  jobId: string,
  attempts: number,
  lastError: string,
): Promise<void> {
  const cfg = registry.get(type)
  if (!cfg?.onExhausted) return
  let payload: unknown = null
  try {
    payload = JSON.parse(payloadJson)
  } catch {
    // hook still runs; it must tolerate null payload
  }
  try {
    await cfg.onExhausted(payload, { jobId, attempts, lastError })
  } catch (err) {
    console.warn(`[jobs] onExhausted hook for type=${type} job=${jobId} failed:`, (err as Error).message)
  }
}
