# Streaming Parse Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse the uploaded Screaming Frog CSVs concurrently under a bounded, process-wide cap (default 2) instead of strictly one at a time, cutting wall-clock parse time on multi-big-file crawls while keeping aggregated output byte-identical.

**Architecture:** A new `lib/parsers/parse-limit.ts` module owns a single process-wide `Semaphore(PARSE_CONCURRENCY)` and a `mapWithConcurrency` driver that runs a per-call worker pool (≤ `PARSE_CONCURRENCY` workers, each acquiring a shared permit just-in-time). The parse route swaps its sequential `for...of await parseOne(...)` loop for `mapWithConcurrency(sessionFiles, parseOne)`; results come back in input order so the unchanged, order-sensitive aggregator ingestion is preserved.

**Tech Stack:** TypeScript, Next.js 15 App Router (Node runtime), Vitest.

## Global Constraints

- **No new runtime dependency.** Hand-roll the semaphore/pool (repo convention: `BROKEN_LINK_CONCURRENCY`, PSI, queue-manager). Verbatim from spec N6.
- **No parser, aggregator, schema, route-contract, or output-shape change.** Only the loop driving `parseOne` changes; `parseOne` itself is untouched. No migration. (Spec N4.)
- **Ordering invariant:** aggregator ingestion (`addParserResult`), `parsers_used`, `file_reports`, and the domain tally must see results in `sessionFiles` order regardless of parse completion order. (Spec §4.)
- **Process-wide cap is single-process-only:** exactly one `Semaphore` per Node process (RunCloud + PM2 fork mode). Document the assumption; do not add a per-request semaphore. (Spec §8, Codex #7.)
- **Cap default = 2, env `PARSE_CONCURRENCY`, clamp to ≥ 1** (bad/zero/negative/NaN → 2). Not required-in-prod (safe default) → no `instrumentation.ts` fail-fast, no Kevin pre-deploy `.env` step. (Spec §8.)
- **`parseConcurrencyFromEnv` must never yield a deadlocking value.** (Spec §5.1.)
- Local dev test quirk: prefix vitest with `DATABASE_URL="file:./local-dev.db"`. React tests need jsdom; these are node-env unit tests.
- `tsc --noEmit` (= `npm run lint`) has no `noUnusedLocals`; build is `NODE_OPTIONS='--max-old-space-size=3072' next build`.

---

### Task 1: `Semaphore` primitive + `parseConcurrencyFromEnv`

**Files:**
- Create: `lib/parsers/parse-limit.ts`
- Test: `lib/parsers/parse-limit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function parseConcurrencyFromEnv(raw: string | undefined): number`
  - `export const PARSE_CONCURRENCY: number`
  - `export class Semaphore { constructor(size: number); acquire(): Promise<void>; release(): void }`

- [ ] **Step 1: Write the failing tests**

Create `lib/parsers/parse-limit.test.ts`:

```ts
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
      /* swallow — the caller-side try/finally still releases */
    } finally {
      sem.release();
    }
    // A second acquire must resolve — the permit was handed back.
    let acquired = false;
    await sem.acquire().then(() => { acquired = true; });
    expect(acquired).toBe(true);
  });

  it('clamps a bad constructor size (0 / negative / NaN) to a usable 1 permit', async () => {
    for (const bad of [0, -5, NaN]) {
      const sem = new Semaphore(bad);
      let acquired = false;
      await sem.acquire().then(() => { acquired = true; });
      expect(acquired).toBe(true); // would hang (timeout) if clamp yielded 0/NaN
    }
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/parse-limit.test.ts`
Expected: FAIL — `Cannot find module './parse-limit'` / exports undefined.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/parsers/parse-limit.ts`:

```ts
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
    // NOTE: Math.max(1, NaN) === NaN — must test finiteness explicitly.
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/parse-limit.test.ts`
Expected: PASS (all 5 `it` cases).

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/parse-limit.ts lib/parsers/parse-limit.test.ts
git commit -m "feat(parse): Semaphore primitive + PARSE_CONCURRENCY env helper"
```

---

### Task 2: `mapWithConcurrency` worker-pool driver

**Files:**
- Modify: `lib/parsers/parse-limit.ts` (append the driver + the module singleton)
- Test: `lib/parsers/parse-limit.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `Semaphore`, `PARSE_CONCURRENCY` from Task 1.
- Produces:
  - `export async function mapWithConcurrency<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]>`
    — results in input order; ≤ `PARSE_CONCURRENCY` in flight process-wide;
    on `fn` rejection, rejects only after all started workers settle.

- [ ] **Step 1: Write the failing tests**

First, extend the EXISTING import at the top of `lib/parsers/parse-limit.test.ts`
(do not append a second `import` mid-file):

```ts
import { parseConcurrencyFromEnv, Semaphore, mapWithConcurrency, PARSE_CONCURRENCY } from './parse-limit';
```

Then append the new describe block:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/parse-limit.test.ts`
Expected: FAIL — `mapWithConcurrency is not a function` (not yet exported).

- [ ] **Step 3: Write the minimal implementation**

Append to `lib/parsers/parse-limit.ts`:

```ts
// The single process-wide permit pool (see the module header).
const parseSemaphore = new Semaphore(PARSE_CONCURRENCY);

/**
 * Run `fn` over `items` with at most PARSE_CONCURRENCY in flight PROCESS-WIDE
 * (the shared `parseSemaphore`). Uses a per-call worker pool that pulls the
 * next index and acquires a permit just-in-time — NOT an enqueue-all map — so
 * concurrent calls interleave fairly instead of one draining first.
 *
 * Results are returned in INPUT order (`result[i]` ⟷ `items[i]`), regardless
 * of completion order. If `fn` rejects for any item, this rejects with the
 * first such reason but ONLY after every started worker has settled, so no
 * parse keeps running in the background past the caller's catch.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(PARSE_CONCURRENCY, items.length);

  const worker = async (): Promise<void> => {
    // `cursor++` is atomic within a synchronous step (single-threaded JS).
    for (let index = cursor++; index < items.length; index = cursor++) {
      await parseSemaphore.acquire();
      try {
        results[index] = await fn(items[index], index);
      } finally {
        parseSemaphore.release();
      }
    }
  };

  const workers = Array.from({ length: workerCount }, () => worker());
  const settled = await Promise.allSettled(workers);
  const failure = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/parse-limit.test.ts`
Expected: PASS (all Task-1 + Task-2 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/parse-limit.ts lib/parsers/parse-limit.test.ts
git commit -m "feat(parse): mapWithConcurrency worker-pool over the shared semaphore"
```

---

### Task 3: Wire concurrency into the parse route + ordering tests

**Files:**
- Modify: `app/api/parse/[sessionId]/route.ts` (import + replace the loop at lines ~172–178)
- Modify: `app/api/parse/[sessionId]/route.test.ts` (record aggregator ingestion order; add ordering/tie/cap tests)

**Interfaces:**
- Consumes: `mapWithConcurrency` (Task 2), the existing `parseOne` closure, `sessionFiles`.
- Produces: no new exports; the route's external contract is unchanged.

- [ ] **Step 1: Write the failing tests (route ordering + cap)**

First, upgrade the shared `AggregatorService` mock to RECORD ingestion order. In `route.test.ts`, replace the existing `vi.mock('@/lib/services/aggregator.service', ...)` block with a hoisted-array version:

```ts
const { aggregatorCalls } = vi.hoisted(() => ({ aggregatorCalls: [] as string[] }));
vi.mock('@/lib/services/aggregator.service', () => ({
  AggregatorService: class {
    addParserResult(_name: string, _data: unknown, filename: string) {
      aggregatorCalls.push(filename);
    }
    aggregate() {
      return {
        crawl_summary: {}, issues: { critical: [], warnings: [], notices: [] },
        site_structure: {}, resources: {}, technical_seo: {}, performance: {},
        recommendations: [],
        metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0 },
      };
    }
  },
}));
```

Then append a new describe block to `route.test.ts` (it reuses the existing
`fakeStreamingParser`, `goodParser`, `dir`, `ctx`, `VALID_ID`, and the mock
handles already declared at the top of the file):

```ts
describe('POST /api/parse/[sessionId] — concurrent parse ordering', () => {
  const dir = getUploadDir(VALID_ID);

  beforeEach(async () => {
    sessionUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
    sessionUpdateMock.mockReset().mockResolvedValue({});
    clientFindManyMock.mockReset().mockResolvedValue([]);
    txMock.mockReset().mockResolvedValue([]);
    triggerPillarAnalysisMock.mockReset().mockResolvedValue(undefined);
    aggregatorCalls.length = 0;
    await fs.mkdir(dir, { recursive: true });
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('ingests into the aggregator in sessionFiles order even when parses finish out of order', async () => {
    const files = ['a.csv', 'b.csv', 'c.csv'];
    // Delay reads so the FIRST file resolves LAST → completion order reverses.
    const delayByFile: Record<string, number> = { 'a.csv': 40, 'b.csv': 20, 'c.csv': 5 };
    sessionFindUniqueMock.mockReset().mockResolvedValue({
      id: VALID_ID, status: 'pending', workflow: 'keyword-research', files: JSON.stringify(files),
    });
    // Every file is a whole-file (non-streaming) match → route calls fs.readFile.
    findParserForFileMock.mockReset().mockImplementation((filename: string) =>
      files.includes(filename) ? goodParser(filename.replace('.csv', '')) : null
    );
    for (const f of files) await fs.writeFile(path.join(dir, f), 'Address\nhttps://example.com/\n');

    const realReadFile = fs.readFile;
    const delayedRead = async (p: unknown, options: unknown): Promise<string | Buffer> => {
      const base = path.basename(String(p));
      if (base in delayByFile) await new Promise((r) => setTimeout(r, delayByFile[base]));
      return (realReadFile as (a: unknown, b: unknown) => Promise<string | Buffer>)(p, options);
    };
    vi.spyOn(fs, 'readFile').mockImplementation(delayedRead as unknown as typeof fs.readFile);

    const res = await POST({} as never, ctx as never);
    expect(res.status).toBe(200);
    // Ingestion order is manifest order, NOT completion order (c,b,a).
    expect(aggregatorCalls).toEqual(['a.csv', 'b.csv', 'c.csv']);
    const body = await res.json();
    const reports = body.result.metadata.file_reports as Array<{ filename: string }>;
    expect(reports.map((r) => r.filename)).toEqual(['a.csv', 'b.csv', 'c.csv']);
  });

  it('resolves the domain tie-break to the manifest-order winner under out-of-order completion', async () => {
    // Two files, equal primary-domain count (1 each) for DIFFERENT domains;
    // the manifest-first file's domain must win (stable sort + ordered successes).
    const files = ['first.csv', 'second.csv'];
    sessionFindUniqueMock.mockReset().mockResolvedValue({
      id: VALID_ID, status: 'pending', workflow: 'keyword-research', files: JSON.stringify(files),
    });
    findParserForFileMock.mockReset().mockImplementation((filename: string) => {
      if (filename === 'first.csv') return goodParserWithDomain('first', 'first.example.com');
      if (filename === 'second.csv') return goodParserWithDomain('second', 'second.example.com');
      return null;
    });
    for (const f of files) await fs.writeFile(path.join(dir, f), 'Address\nhttps://example.com/\n');

    // second.csv resolves first, first.csv resolves last.
    const realReadFile = fs.readFile;
    const delayedRead = async (p: unknown, options: unknown): Promise<string | Buffer> => {
      if (path.basename(String(p)) === 'first.csv') await new Promise((r) => setTimeout(r, 30));
      return (realReadFile as (a: unknown, b: unknown) => Promise<string | Buffer>)(p, options);
    };
    vi.spyOn(fs, 'readFile').mockImplementation(delayedRead as unknown as typeof fs.readFile);

    const res = await POST({} as never, ctx as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.metadata.site_name).toBe('first.example.com');
  });

  it('runs at most PARSE_CONCURRENCY parses at once', async () => {
    const files = ['p1.csv', 'p2.csv', 'p3.csv', 'p4.csv', 'p5.csv'];
    sessionFindUniqueMock.mockReset().mockResolvedValue({
      id: VALID_ID, status: 'pending', workflow: 'keyword-research', files: JSON.stringify(files),
    });
    findParserForFileMock.mockReset().mockImplementation((filename: string) =>
      files.includes(filename) ? goodParser(filename.replace('.csv', '')) : null
    );
    for (const f of files) await fs.writeFile(path.join(dir, f), 'Address\nhttps://example.com/\n');

    let current = 0; let peak = 0;
    const realReadFile = fs.readFile;
    const delayedRead = async (p: unknown, options: unknown): Promise<string | Buffer> => {
      current++; peak = Math.max(peak, current);
      await new Promise((r) => setTimeout(r, 15));
      current--;
      return (realReadFile as (a: unknown, b: unknown) => Promise<string | Buffer>)(p, options);
    };
    vi.spyOn(fs, 'readFile').mockImplementation(delayedRead as unknown as typeof fs.readFile);

    const res = await POST({} as never, ctx as never);
    expect(res.status).toBe(200);
    expect(peak).toBeLessThanOrEqual(PARSE_CONCURRENCY);
    // env-tunable: only assert real parallelism when the cap allows it.
    if (PARSE_CONCURRENCY > 1) expect(peak).toBeGreaterThan(1);
  });
});
```

Add this helper at **module top-level**, right next to the existing top-level
`goodParser` (≈ line 130) — NOT inside a `describe` block (the two-path block's
`fakeStreamingParser` is describe-scoped and would be invisible to the new
concurrent-ordering describe; `goodParser` is top-level, so mirror it):

```ts
function goodParserWithDomain(key: string, domain: string) {
  return class {
    static parserKey = key;
    constructor(_content: string) {}
    parse() { return { ok: true }; }
    getPrimaryDomain() { return domain; }
  };
}
```

Also add the shared import at the top of the test file (with the other imports):

```ts
import { PARSE_CONCURRENCY } from '@/lib/parsers/parse-limit';
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run 'app/api/parse/[sessionId]/route.test.ts' -t "concurrent parse ordering"`
Expected: FAIL — the route is still sequential, so `peak` stays 1 (the "peak > 1" assertion fails) and/or `aggregatorCalls` recording is not yet wired. (The ordering test may pass incidentally under the sequential loop; the cap test's `peak > 1` is the one that must fail pre-change.)

- [ ] **Step 3: Wire the route change**

In `app/api/parse/[sessionId]/route.ts`, add the import next to the other parser imports (after line 8):

```ts
import { mapWithConcurrency } from '@/lib/parsers/parse-limit';
```

Replace the sequential loop (lines ~172–178):

```ts
    const reports: FileReport[] = [];
    const successes: ParseSuccess[] = [];
    for (const filename of sessionFiles) {
      const outcome = await parseOne(filename);
      reports.push(outcome.report);
      if (outcome.success) successes.push(outcome.success);
    }
```

with the concurrent map + ordered collection:

```ts
    // Parse concurrently under a bounded, process-wide cap (parse-limit.ts).
    // Results come back in sessionFiles order, so the order-sensitive aggregator
    // ingestion below (latest-wins scalars / per_url_index, domain tally) is
    // byte-identical to the old sequential loop.
    const outcomes = await mapWithConcurrency(sessionFiles, (filename) => parseOne(filename));

    const reports: FileReport[] = [];
    const successes: ParseSuccess[] = [];
    for (const outcome of outcomes) {
      reports.push(outcome.report);
      if (outcome.success) successes.push(outcome.success);
    }
```

Everything from the aggregator ingestion loop onward is unchanged.

- [ ] **Step 4: Run the route tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run 'app/api/parse/[sessionId]/route.test.ts'`
Expected: PASS — the new "concurrent parse ordering" block plus all pre-existing route tests (gate, file_reports, two-path parseOne) stay green.

- [ ] **Step 5: Commit**

```bash
git add "app/api/parse/[sessionId]/route.ts" "app/api/parse/[sessionId]/route.test.ts"
git commit -m "feat(parse): parse files concurrently via mapWithConcurrency (ordered ingestion preserved)"
```

---

### Task 4: Document `PARSE_CONCURRENCY` + full gate

**Files:**
- Modify: `.claude/skills/er-seo-tools-config-and-flags/SKILL.md` (add `PARSE_CONCURRENCY` to the concurrency-knobs section — same style as `SITE_AUDIT_CONCURRENCY`/`PSI_CONCURRENCY`/`BROKEN_LINK_CONCURRENCY`)

**Interfaces:** none (docs + verification only).

- [ ] **Step 1: Document the env var**

In the config-and-flags skill, in the table/section listing concurrency env vars, add a row/line for `PARSE_CONCURRENCY`:

> `PARSE_CONCURRENCY` — max concurrent CSV parses in `/api/parse/[sessionId]`. Default **2**, env-tunable, clamped ≥ 1 (bad value → 2). Process-wide (single shared semaphore in `lib/parsers/parse-limit.ts`), safe only under the single-PM2-process model. Not required-in-prod (safe default → no `instrumentation.ts` fail-fast). Drop to 1 on a box under heavy co-scheduled site-audit/Lighthouse load; raising it multiplies peak parse memory (~751 MB per big-file stream).

(Match the file's existing formatting — locate the section with `grep -n "PSI_CONCURRENCY\|BROKEN_LINK_CONCURRENCY" .claude/skills/er-seo-tools-config-and-flags/SKILL.md` and mirror it.)

- [ ] **Step 2: Run the full gate**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: `tsc --noEmit` clean; full vitest suite green (new parse-limit + route tests included); `next build` clean.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/er-seo-tools-config-and-flags/SKILL.md
git commit -m "docs(config): document PARSE_CONCURRENCY env var"
```

---

## Self-Review

**Spec coverage:**
- §4 ordering invariant → Task 3 (position-indexed `outcomes` + ordered collection; aggregator-order test).
- §5.1 Semaphore + `parseConcurrencyFromEnv` + `PARSE_CONCURRENCY` → Task 1.
- §5.1 worker-pool `mapWithConcurrency` (no enqueue-all) → Task 2 (+ head-of-line test).
- §5.1 rejection contract (settle-before-reject) → Task 2 (rejection test).
- §5.2 route change → Task 3.
- §8 env config + memory wording + Node-runtime assumption → Task 1 (module header comment) + Task 4 (doc).
- §9.1 all six primitive tests → Tasks 1–2. §9.2 all four route tests (ordered ingestion, out-of-order via delayed I/O, domain-tie, cap bound) → Task 3. §9.3 guard suites → Task 4 full gate.
- Codex #1 (worker pool) → Task 2. #2 (rejection) → Task 2. #3 (observe ingestion) → Task 3 hoisted mock. #4 (delayed I/O) → Task 3. #5 (domain tie) → Task 3. #6 (memory wording) → Task 4 doc. #7 (runtime) → Task 1 header. #8 (overlap fairness) → Task 2.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `parseConcurrencyFromEnv`, `PARSE_CONCURRENCY`, `Semaphore.acquire/release`, `mapWithConcurrency<T,R>(items, fn)` used identically across tasks and the route wiring. `goodParser`/`goodParserWithDomain`/`fakeStreamingParser` match the test file's existing helper shapes.

**Risk note:** the only shared-mock change (Task 3's hoisted `aggregatorCalls`) is additive — existing describe blocks don't assert on aggregate's return, so recording ingested filenames can't regress them.

**Codex plan-review fixes folded in (2026-07-04):** (1) `goodParserWithDomain` placed at module top-level, not inside a describe; (2) Task-2 import merged into the existing import line; (3) rejection test strengthened with a post-reject full-batch resolve to catch permit leaks; (4) removed the always-true head-of-line assertion; (5) head-of-line test rewritten with a manually-controlled gate promise (deterministic, no `setTimeout` scheduler race); (6) `peak > 1` guarded on `PARSE_CONCURRENCY > 1`; (7) `fs.readFile` mocks typed via a single `as unknown as typeof fs.readFile` cast instead of `never`; (8) `Semaphore` constructor clamps `size` to ≥ 1. Codex confirmed the worker-loop, index partitioning, and `allSettled` settle-before-reject are correct as written.
```
