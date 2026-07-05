// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseConcurrencyFromEnv, Semaphore } from './parse-limit';

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
