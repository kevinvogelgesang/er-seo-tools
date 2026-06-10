// lib/jobs/types.ts
//
// Shared types for the durable job queue. See
// docs/superpowers/specs/2026-06-10-durable-job-queue-design.md.

export const JOB_ACTIVE_STATUSES = ['queued', 'running'] as const

export type JobStatus = 'queued' | 'running' | 'complete' | 'error' | 'cancelled'

export interface JobHandlerContext {
  jobId: string
  attempt: number
  signal: AbortSignal
}

export interface JobExhaustedContext {
  jobId: string
  attempts: number
  lastError: string
}

export interface JobHandlerConfig {
  type: string
  /** Max simultaneously running jobs of this type (in-process slots). */
  concurrency: number
  /** Total starts before the job is failed. Default 3. */
  maxAttempts?: number
  /** Backoff: delay = backoffBaseMs * 2^(attempt-1), capped at 15 min. Default 30s. */
  backoffBaseMs?: number
  /** Hard runtime cap; the worker aborts ctx.signal and settles as a throw. Default 5 min. */
  timeoutMs?: number
  handler: (payload: unknown, ctx: JobHandlerContext) => Promise<void>
  /**
   * Domain settle for terminal job failure. Invoked (best-effort) from EVERY
   * path that flips a job to status='error': final-attempt settle, stale
   * sweep exhaustion, and startup-recovery exhaustion.
   */
  onExhausted?: (payload: unknown, ctx: JobExhaustedContext) => Promise<void>
}

/** JobHandlerConfig with all optional knobs resolved. */
export interface ResolvedJobHandlerConfig extends JobHandlerConfig {
  maxAttempts: number
  backoffBaseMs: number
  timeoutMs: number
}

export interface EnqueueJobOptions {
  type: string
  payload?: unknown
  dedupKey?: string
  groupKey?: string
  priority?: number
  runAfter?: Date
  maxAttempts?: number
  scheduleId?: string
  scheduledFor?: Date
}

export interface EnqueueJobResult {
  id: string
  deduped: boolean
}
