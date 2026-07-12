// Break-glass password login rate limiter (A7 PR1).
//
// This singleton lives in its own module (not inline in
// app/api/auth/login/route.ts) because a Next.js App Router `route.ts` file
// may only export HTTP method handlers plus a small set of known config
// symbols (`dynamic`, `revalidate`, etc). Any other named export — e.g. a
// test-only reset seam — fails Next's generated route-module type check
// (`.next/types/app/**/route.ts`) at `tsc --noEmit` time even though nothing
// is wrong at runtime. Extracting the limiter here keeps route.ts's export
// surface clean while still giving tests a way to reset the module-scope
// state between cases (same pattern as `lib/ops/health-summary.ts`'s
// `__resetHealthSummaryCache`).
import { createFixedWindowLimiter, type FixedWindowLimiter } from '@/lib/rate-limit'

function readIntEnv(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}

function build(): FixedWindowLimiter {
  return createFixedWindowLimiter({
    max: readIntEnv('LOGIN_RATE_LIMIT_MAX', 10),
    windowMs: readIntEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  })
}

let loginLimiter: FixedWindowLimiter = build()

export function hitLoginLimiter(key: string) {
  return loginLimiter.hit(key)
}

export function resetLoginLimiter(key: string): void {
  loginLimiter.reset(key)
}

// Test-only: rebuilds the singleton so per-key state (and env-driven
// max/windowMs) never leaks across test cases.
export function __resetLoginLimiter(): void {
  loginLimiter = build()
}
