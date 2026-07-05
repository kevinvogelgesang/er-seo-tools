// lib/jobs/config.ts

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_BACKOFF_BASE_MS = 30_000
export const BACKOFF_CAP_MS = 15 * 60 * 1000
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
export const HEARTBEAT_MS = 15_000
export const STALE_HEARTBEAT_MS = 2 * 60 * 1000

export function jobPollMs(): number {
  return parsePositiveInt(process.env.JOB_POLL_MS, 5_000)
}

export function jobStaleSweepMs(): number {
  return parsePositiveInt(process.env.JOB_STALE_SWEEP_MS, 60_000)
}
