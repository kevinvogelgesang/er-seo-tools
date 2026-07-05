/**
 * Bounded-concurrency runner for the SEO parse loop (`/api/parse/[sessionId]`).
 *
 * PROCESS-WIDE cap: this module instantiates exactly ONE Semaphore, and every
 * parse task across every concurrent request acquires from it. This is sound
 * ONLY because the app runs as a single long-lived Node process (RunCloud +
 * PM2 fork mode — the frozen core stack). Under cluster/serverless each worker
 * would get its own module instance → its own semaphore → the cap would be
 * per-worker, not global. Do not port this to a multi-process runtime without
 * revisiting. (Spec §8 / Codex #7.)
 */

const DEFAULT_PARSE_CONCURRENCY = 2;

/** Coerce the env value to an integer ≥ 1; any bad value falls back to the
 *  default so the pool can never deadlock. */
export function parseConcurrencyFromEnv(raw: string | undefined): number {
  if (raw == null) return DEFAULT_PARSE_CONCURRENCY;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PARSE_CONCURRENCY;
  return n;
}

export const PARSE_CONCURRENCY = parseConcurrencyFromEnv(process.env.PARSE_CONCURRENCY);

/** Minimal FIFO counting semaphore. `acquire()` resolves when a permit is
 *  free; `release()` hands the permit directly to the next FIFO waiter (or
 *  returns it to the free pool). No timers, no dependencies. */
export class Semaphore {
  private free: number;
  private readonly waiters: Array<() => void> = [];

  constructor(size: number) {
    // Clamp defensively: the class is exported, so guard against an accidental
    // 0/negative/NaN size that would deadlock (env is already clamped upstream).
    this.free = Number.isFinite(size) && size >= 1 ? Math.floor(size) : 1;
  }

  acquire(): Promise<void> {
    if (this.free > 0) {
      this.free--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next(); // transfer the permit directly — free count unchanged
    } else {
      this.free++;
    }
  }
}
