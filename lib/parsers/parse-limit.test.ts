// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseConcurrencyFromEnv, Semaphore, mapWithConcurrency, PARSE_CONCURRENCY } from './parse-limit';

describe('parseConcurrencyFromEnv', () => {
  it('defaults to 2 when unset', () => {
    expect(parseConcurrencyFromEnv(undefined)).toBe(2);
  });
  it('clamps zero, negative, and non-numeric to the default', () => {
    expect(parseConcurrencyFromEnv('0')).toBe(2);
    expect(parseConcurrencyFromEnv('-3')).toBe(2);
    expect(parseConcurrencyFromEnv('abc')).toBe(2);
    expect(parseConcurrencyFromEnv('')).toBe(2);
  });
  it('accepts a valid positive integer', () => {
    expect(parseConcurrencyFromEnv('3')).toBe(3);
    expect(parseConcurrencyFromEnv('1')).toBe(1);
  });
});

describe('Semaphore', () => {
  // Drive N concurrent tasks through Semaphore(size) and assert the peak
  // number holding a permit never exceeds size.
  async function runUnderSemaphore(size: number, taskCount: number) {
    const sem = new Semaphore(size);
    let current = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const gate = () => new Promise<void>((r) => release.push(r));
    const tasks = Array.from({ length: taskCount }, () =>
      (async () => {
        await sem.acquire();
        current++;
        peak = Math.max(peak, current);
        await gate(); // hold the permit until released
        current--;
        sem.release();
      })(),
    );
    // Let all acquires settle, then drain one-by-one.
    for (let i = 0; i < taskCount; i++) {
      await Promise.resolve();
      await Promise.resolve();
      const r = release.shift();
      if (r) r();
    }
    await Promise.all(tasks);
    return peak;
  }

  it('never exceeds the cap for size 1, 2, 3', async () => {
    expect(await runUnderSemaphore(1, 6)).toBe(1);
    expect(await runUnderSemaphore(2, 6)).toBe(2);
    expect(await runUnderSemaphore(3, 6)).toBe(3);
  });

  it('releases a permit even when the holder throws (no leak / no deadlock)', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    try {
      throw new Error('boom');
    } catch {
      // expected — swallow so we can assert the finally still ran release()
    } finally {
      sem.release();
    }
    // A second acquire must resolve — the permit was handed back.
    let acquired = false;
    await sem.acquire().then(() => { acquired = true; });
    expect(acquired).toBe(true);
  });

  it('hands a released permit to the next FIFO waiter', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();            // permit taken
    const order: number[] = [];
    const w1 = sem.acquire().then(() => order.push(1));
    const w2 = sem.acquire().then(() => order.push(2));
    sem.release();                 // wakes w1
    await w1;
    sem.release();                 // wakes w2
    await w2;
    expect(order).toEqual([1, 2]); // FIFO
  });

  it('clamps a bad constructor size (0 / negative / NaN) to a usable 1 permit', async () => {
    for (const bad of [0, -5, NaN]) {
      const sem = new Semaphore(bad);
      let acquired = false;
      await sem.acquire().then(() => { acquired = true; });
      expect(acquired).toBe(true); // would hang (timeout) if clamp yielded 0/NaN
    }
  });
});

// A controllable async task: resolves after `ms` (fake time via real timers is
// fine here — keep delays tiny). Records enter/exit for concurrency probing.
function makeProbe() {
  let current = 0;
  let peak = 0;
  const run = async <T>(value: T, ms: number): Promise<T> => {
    current++;
    peak = Math.max(peak, current);
    await new Promise((r) => setTimeout(r, ms));
    current--;
    return value;
  };
  return { run, peak: () => peak };
}

describe('mapWithConcurrency', () => {
  it('returns results in input order even when tasks finish out of order', async () => {
    // item 0 is slowest, item 3 fastest → completion order reverses input.
    const delays = [40, 30, 20, 10];
    const out = await mapWithConcurrency(delays, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it('completes every task', async () => {
    const items = Array.from({ length: 7 }, (_, i) => i);
    const out = await mapWithConcurrency(items, async (v) => v * 2);
    expect(out).toEqual([0, 2, 4, 6, 8, 10, 12]);
  });

  it('never runs more than PARSE_CONCURRENCY tasks at once', async () => {
    const probe = makeProbe();
    const items = Array.from({ length: 8 }, (_, i) => i);
    await mapWithConcurrency(items, (v) => probe.run(v, 15));
    expect(probe.peak()).toBeLessThanOrEqual(PARSE_CONCURRENCY);
  });

  it('caps ACROSS two overlapping calls (process-wide shared semaphore)', async () => {
    const probe = makeProbe();
    const a = mapWithConcurrency([1, 2, 3, 4], (v) => probe.run(v, 20));
    const b = mapWithConcurrency([5, 6, 7, 8], (v) => probe.run(v, 20));
    await Promise.all([a, b]);
    // Both calls share ONE module semaphore → combined peak ≤ cap.
    expect(probe.peak()).toBeLessThanOrEqual(PARSE_CONCURRENCY);
  });

  it('lets a second call make progress before a large first call drains (no head-of-line starvation)', async () => {
    // Deterministic (no scheduler race): every task blocks on one shared gate
    // the test releases explicitly. Microtask ordering — not setTimeout timing —
    // decides interleaving.
    let releaseAll!: () => void;
    const gate = new Promise<void>((r) => { releaseAll = r; });
    const started: string[] = [];
    const runGated = (v: string) => { started.push(v); return gate.then(() => v); };

    // Big call starts; its first PARSE_CONCURRENCY workers grab the permits and
    // block on the gate (holding them).
    const big = mapWithConcurrency(Array.from({ length: 20 }, (_, i) => `A${i}`), async (v) => runGated(v));
    await new Promise((r) => setTimeout(r, 0)); // flush microtasks: A-workers register + block

    // Second call's workers now enqueue as FIFO waiters (no free permits).
    const small = mapWithConcurrency(['B0', 'B1'], async (v) => runGated(v));
    await new Promise((r) => setTimeout(r, 0));

    releaseAll(); // A-workers finish → release() hands permits to B's FIFO waiters
    await Promise.all([big, small]);

    // Under the worker-pool + direct FIFO hand-off, B0/B1 start right after the
    // first A-pair releases — BEFORE the remaining A's. (Under enqueue-all, all
    // 20 A-waiters would sit ahead of B and B would start only after ~18 A's.)
    const firstB = started.findIndex((s) => s.startsWith('B'));
    expect(firstB).toBeGreaterThanOrEqual(0);
    expect(firstB).toBeLessThan(20); // B began before all 20 A's had started
    expect(started.slice(firstB).some((s) => s.startsWith('A'))).toBe(true); // A's remain after B
  });

  it('rejects only after all started workers settle, and leaks no permit', async () => {
    let settledCount = 0;
    const items = [0, 1, 2, 3];
    await expect(
      mapWithConcurrency(items, async (v) => {
        try {
          if (v === 1) throw new Error('task 1 failed');
          await new Promise((r) => setTimeout(r, 10));
          return v;
        } finally {
          settledCount++;
        }
      }),
    ).rejects.toThrow('task 1 failed');
    // Every started worker finished its finally before the reject surfaced.
    expect(settledCount).toBeGreaterThanOrEqual(PARSE_CONCURRENCY);
    // No permit leaked: a fresh batch larger than the cap still fully resolves
    // (a leaked permit would shrink the pool; a total leak would hang → timeout).
    await expect(
      mapWithConcurrency([1, 2, 3, 4], async (v) => v),
    ).resolves.toEqual([1, 2, 3, 4]);
  });
});
