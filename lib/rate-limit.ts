// Generic in-memory fixed-window rate limiter. Correct for this single
// fork-mode process stack (no Redis). Extracted + injectable clock so it is
// deterministically unit-testable (the inlined uploadSizeByIP limiter in
// app/api/upload/route.ts is the precedent this generalizes).

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
  remaining: number
}

export interface FixedWindowLimiter {
  hit(key: string): RateLimitResult
  reset(key: string): void
}

interface Window { count: number; windowStart: number }

const DEFAULT_MAX = 10
const DEFAULT_WINDOW_MS = 15 * 60 * 1000
const DEFAULT_MAX_KEYS = 10_000

export function createFixedWindowLimiter(opts: {
  max: number
  windowMs: number
  now?: () => number
  maxKeys?: number
}): FixedWindowLimiter {
  const now = opts.now ?? (() => Date.now())
  const max = Number.isFinite(opts.max) && opts.max > 0 ? Math.floor(opts.max) : DEFAULT_MAX
  const windowMs =
    Number.isFinite(opts.windowMs) && opts.windowMs > 0 ? Math.floor(opts.windowMs) : DEFAULT_WINDOW_MS
  const maxKeys =
    Number.isFinite(opts.maxKeys) && (opts.maxKeys ?? 0) > 0 ? Math.floor(opts.maxKeys!) : DEFAULT_MAX_KEYS

  const map = new Map<string, Window>()

  function prune(protectKey: string) {
    if (map.size <= maxKeys) return
    const t = now()
    for (const [k, w] of map) {
      if (k === protectKey) continue
      if (t - w.windowStart >= windowMs) map.delete(k)
    }
    if (map.size <= maxKeys) return
    const entries = [...map.entries()]
      .filter(([k]) => k !== protectKey)
      .sort((a, b) => a[1].windowStart - b[1].windowStart)
    for (const [k] of entries) {
      if (map.size <= maxKeys) break
      map.delete(k)
    }
  }

  return {
    hit(key: string): RateLimitResult {
      const t = now()
      let w = map.get(key)
      if (!w || t - w.windowStart >= windowMs) {
        w = { count: 0, windowStart: t }
        map.set(key, w)
      }
      w.count += 1
      prune(key)
      const allowed = w.count <= max
      const remaining = Math.max(0, max - w.count)
      const retryAfterSeconds = allowed
        ? 0
        : Math.max(0, Math.ceil((w.windowStart + windowMs - t) / 1000))
      return { allowed, retryAfterSeconds, remaining }
    },
    reset(key: string) {
      map.delete(key)
    },
  }
}
