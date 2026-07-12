// lib/jobs/worker.ts
//
// The claim-execute-settle loop for the durable job queue.
//
// Invariants (see spec):
// - Claim is a conditional UPDATE ... WHERE status='queued'; the claimer
//   records claimedAttempt (attempts value it wrote) as a fencing token.
// - EVERY subsequent write for that execution (heartbeat + settle) is fenced:
//   WHERE id AND status='running' AND attempts=claimedAttempt. A fenced write
//   matching 0 rows means the lease was lost — discard silently.
// - Handlers run OUTSIDE any DB transaction, raced against timeoutMs so the
//   wrapper always settles even if the underlying promise hangs forever.
// - Active-slot bookkeeping is a per-type Map<jobId, claimedAttempt>; the
//   wrapper deletes its own entry idempotently AFTER the settle write, so a
//   poll/kick during settle can't overfill the type's concurrency.
// - Single-process assumption: concurrency accounting is in-memory. The
//   conditional claim keeps an accidental second process safe (just
//   over-concurrent), not corrupt.

import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { publishInvalidation } from '@/lib/events/bus'
import { recentsTopic } from '@/lib/events/topics'
import { BACKOFF_CAP_MS, HEARTBEAT_MS, jobPollMs, jobStaleSweepMs } from './config'
import { topicForGroup } from './job-topics'
import { getJobHandler, listJobTypes, runOnExhausted } from './registry'
import type { JobHandlerContext, ResolvedJobHandlerConfig } from './types'

interface ClaimedJob {
  id: string
  type: string
  payload: string
  attempts: number // post-claim value = the fencing token
  maxAttempts: number
  groupKey: string | null
}

const activeByType = new Map<string, Map<string, number>>()

let stopped = true
let ticking = false
let pollTimer: NodeJS.Timeout | null = null
let sweepTimer: NodeJS.Timeout | null = null
let scheduleTimer: NodeJS.Timeout | null = null

function activeSet(type: string): Map<string, number> {
  let set = activeByType.get(type)
  if (!set) {
    set = new Map()
    activeByType.set(type, set)
  }
  return set
}

export function getActiveJobCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [type, set] of activeByType) counts[type] = set.size
  return counts
}

export function backoffMs(baseMs: number, attempt: number): number {
  return Math.min(baseMs * 2 ** (attempt - 1), BACKOFF_CAP_MS)
}

export function kickJobWorker(): void {
  if (stopped) return
  void runWorkerTickOnce()
}

/** One pass: for each registered type, claim jobs into free slots. Exported for tests. */
export async function runWorkerTickOnce(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    for (const type of listJobTypes()) {
      const cfg = getJobHandler(type)
      if (!cfg) continue
      while (activeSet(type).size < cfg.concurrency) {
        const claimed = await claimNext(type)
        if (!claimed) break
        activeSet(type).set(claimed.id, claimed.attempts)
        void executeJob(cfg, claimed)
      }
    }
  } catch (err) {
    logError({ subsystem: '[jobs]', scope: 'worker-tick' }, err)
  } finally {
    ticking = false
  }
}

async function claimNext(type: string): Promise<ClaimedJob | null> {
  for (;;) {
    const candidate = await prisma.job.findFirst({
      where: { type, status: 'queued', runAfter: { lte: new Date() } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        type: true,
        payload: true,
        attempts: true,
        maxAttempts: true,
        groupKey: true,
      },
    })
    if (!candidate) return null
    const res = await prisma.job.updateMany({
      where: { id: candidate.id, status: 'queued' },
      data: {
        status: 'running',
        attempts: { increment: 1 },
        startedAt: new Date(),
        heartbeatAt: new Date(),
        progress: null,
        progressMessage: null,
      },
    })
    if (res.count === 1) {
      return { ...candidate, attempts: candidate.attempts + 1 }
    }
    // Lost the claim race (concurrent cancel or another claimer) — next candidate.
  }
}

interface HeartbeatFence { id: string; status: string; attempts: number }
type ProgressSnapshot = { progress: number | null; message: string | null }

/**
 * One fenced heartbeat write + an effect-gated, delta-gated emit. Extracted so
 * it is unit-testable WITHOUT fake timers (see worker.heartbeat-emit.test.ts;
 * worker.progress.test.ts:36 documents why the real interval can't be driven by
 * fake timers).
 *
 * Contract:
 * - Always attempts the fenced `updateMany` (this is the liveness heartbeat).
 * - `emit` fires ONLY when the write took effect (`count === 1`) AND the
 *   snapshot's progress/message differ from `lastEmitted.current`. On emit,
 *   `lastEmitted.current` advances to the snapshot. A lost fence (count === 0)
 *   or an unchanged snapshot emits nothing and leaves `lastEmitted` untouched.
 * - NEVER rejects: the DB write is wrapped, and `emit` (publishInvalidation)
 *   owns its own try/catch — so an appended `flushChain` link can never poison
 *   later awaits.
 *
 * `lastEmitted` is a mutable per-execution cell (a 4th arg beyond the plan's
 * `(fence, snapshot, emit)` sketch — the cross-tick dedup state has to live
 * somewhere the caller owns; a pure 3-arg helper could not dedupe across calls).
 */
export async function flushJobHeartbeat(
  fence: HeartbeatFence,
  snapshot: ProgressSnapshot,
  emit: () => void,
  lastEmitted: { current: ProgressSnapshot | null },
): Promise<void> {
  let res: { count: number }
  try {
    res = await prisma.job.updateMany({
      where: fence,
      data: { heartbeatAt: new Date(), progress: snapshot.progress, progressMessage: snapshot.message },
    })
  } catch {
    return // stale heartbeat write failed (e.g. SQLITE_BUSY); never reject the chain
  }
  if (res.count !== 1) return // fence lost — no delta emit
  const prev = lastEmitted.current
  if (prev && prev.progress === snapshot.progress && prev.message === snapshot.message) return
  lastEmitted.current = { progress: snapshot.progress, message: snapshot.message }
  emit()
}

async function executeJob(cfg: ResolvedJobHandlerConfig, job: ClaimedJob): Promise<void> {
  const fence = { id: job.id, status: 'running', attempts: job.attempts }
  const abort = new AbortController()

  // A5 SSE: this job's group maps to at most one progress topic. When null
  // (system jobs, unmapped types) emitProgress is a no-op — no spurious frames.
  const topic = topicForGroup(job.groupKey)
  const emitProgress = topic
    ? () => { publishInvalidation(topic); publishInvalidation(recentsTopic()) }
    : () => {}
  // Delta-dedup state for the heartbeat flush (see flushJobHeartbeat). Seeded to
  // the claim's just-written {null,null} so the first no-progress heartbeat is
  // not treated as a change.
  const lastEmitted: { current: ProgressSnapshot | null } = { current: { progress: null, message: null } }
  // Per-execution flush chain (NOT module-level — that would serialize all
  // concurrent jobs). Each link catches its own errors so a rejection can never
  // poison a later `await flushChain`.
  let flushChain: Promise<void> = Promise.resolve()

  // Claim already committed (claimNext returns only on count===1) → the row is
  // now 'running'. Emit once so watchers see the flip.
  emitProgress()

  // Per-execution progress cell; the heartbeat is the only DB writer.
  let progressCell: ProgressSnapshot = { progress: null, message: null }
  const heartbeat = setInterval(() => {
    // Capture an immutable snapshot at tick time — the async flush must not read
    // a progressCell the handler mutates mid-write.
    const snapshot: ProgressSnapshot = { progress: progressCell.progress, message: progressCell.message }
    flushChain = flushChain
      .then(() => flushJobHeartbeat(fence, snapshot, emitProgress, lastEmitted))
      .catch(() => {})
  }, HEARTBEAT_MS)

  const ctx: JobHandlerContext = {
    jobId: job.id,
    attempt: job.attempts,
    signal: abort.signal,
    reportProgress: (progress, message) => {
      progressCell = {
        progress: progress == null ? null : Math.max(0, Math.min(100, Math.round(progress))),
        message: message ?? null,
      }
    },
  }

  let error: string | null = null
  // Retain the original caught object so logError gets the real Error (stack +
  // context), not just the pre-flattened message.
  let caughtErr: unknown = null
  try {
    try {
      let payload: unknown
      try {
        payload = JSON.parse(job.payload)
      } catch {
        throw new Error('Unparseable job payload')
      }
      await runWithTimeout(
        cfg.handler(payload, ctx),
        cfg.timeoutMs,
        abort,
      )
    } catch (err) {
      caughtErr = err
      error = err instanceof Error ? err.message : String(err)
    } finally {
      clearInterval(heartbeat)
    }

    // Drain any in-flight heartbeat flush BEFORE the terminal/requeue write, so
    // a late heartbeat continuation can't emit stale progress AFTER the final
    // state has been settled + emitted below.
    await flushChain

    try {
      if (error === null) {
        const res = await prisma.job.updateMany({
          where: fence,
          data: { status: 'complete', completedAt: new Date(), progress: 100, progressMessage: null },
        })
        if (res.count === 1) emitProgress()
      } else if (job.attempts >= job.maxAttempts) {
        const res = await prisma.job.updateMany({
          where: fence,
          data: { status: 'error', lastError: error, completedAt: new Date(), progress: null, progressMessage: null },
        })
        if (res.count === 1) {
          emitProgress()
          logError({ subsystem: '[jobs]', jobId: job.id, type: job.type, attempt: job.attempts }, caughtErr ?? error)
          await runOnExhausted(job.type, job.payload, job.id, job.attempts, error)
        }
      } else {
        const res = await prisma.job.updateMany({
          where: fence,
          data: {
            status: 'queued',
            lastError: error,
            runAfter: new Date(Date.now() + backoffMs(cfg.backoffBaseMs, job.attempts)),
            heartbeatAt: null,
            progress: null,
            progressMessage: null,
          },
        })
        if (res.count === 1) emitProgress()
      }
    } catch (err) {
      // Settle write failed (e.g. transient SQLITE_BUSY). The row stays
      // 'running' with a stale heartbeat; the stale sweep recovers it.
      logError({ subsystem: '[jobs]', scope: 'worker-settle', jobId: job.id }, err)
    }
  } finally {
    // Release the slot only AFTER settle so a concurrent poll/kick can't
    // overfill this type's concurrency during the settle window. Map delete
    // is idempotent — it can't double-fire into negative counts.
    activeSet(job.type).delete(job.id)
  }

  if (!stopped) void runWorkerTickOnce() // backfill the freed slot
}

/**
 * Race the handler against timeoutMs. On expiry: abort the signal and reject —
 * the wrapper settles even if the underlying promise never does. A zombie
 * promise that settles later is harmless: the attempt fence discards its
 * effects at the queue layer, and handler bodies are required to be idempotent
 * at the domain layer.
 */
function runWithTimeout(promise: Promise<void>, timeoutMs: number, abort: AbortController): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      abort.abort()
      reject(new Error(`Job timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    promise.then(
      () => { clearTimeout(timer); resolve() },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

/**
 * Defense-in-depth: drop in-memory active entries whose DB lease is gone
 * (row no longer running, or attempts moved past the recorded token).
 * Called by the stale sweep.
 */
export async function reconcileActiveSets(): Promise<void> {
  for (const [type, set] of activeByType) {
    for (const [jobId, claimedAttempt] of set) {
      const row = await prisma.job.findUnique({
        where: { id: jobId },
        select: { status: true, attempts: true },
      })
      if (!row || row.status !== 'running' || row.attempts !== claimedAttempt) {
        set.delete(jobId)
        console.warn(`[jobs] retired dead active-set entry type=${type} job=${jobId}`)
      }
    }
  }
}

export async function startJobWorker(): Promise<void> {
  if (!stopped) return
  stopped = false

  // Dynamic imports keep this module free of domain/scheduler edges
  // (queue.ts ← lighthouse-queue ← queue-manager would otherwise cycle).
  // Idempotent — instrumentation already registered handlers before startup
  // recovery; this covers any other caller.
  const { registerBuiltInJobHandlers } = await import('./handlers/register')
  registerBuiltInJobHandlers()

  const { sweepStaleJobs } = await import('./recovery')
  const { tickSchedules } = await import('./scheduler')

  pollTimer = setInterval(() => void runWorkerTickOnce(), jobPollMs())
  // Sweep BEFORE reconcile, sequentially: reconciliation frees in-memory
  // slots based on DB lease state, so it must observe the sweep's re-queues
  // in the same pass — racing them delays slot release by a full interval.
  sweepTimer = setInterval(() => {
    void (async () => {
      await sweepStaleJobs()
      await reconcileActiveSets()
    })().catch((err) => console.warn('[jobs] sweep pass failed:', (err as Error).message))
  }, jobStaleSweepMs())
  scheduleTimer = setInterval(() => void tickSchedules(), 60_000)

  void runWorkerTickOnce()
  void tickSchedules()
}

export async function stopJobWorker(): Promise<void> {
  stopped = true
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null }
  if (scheduleTimer) { clearInterval(scheduleTimer); scheduleTimer = null }
  // Short grace for in-flight handlers; anything unfinished is recovered as
  // 'running' → re-queued by recoverJobsOnStartup() on the next boot.
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    let active = 0
    for (const set of activeByType.values()) active += set.size
    if (active === 0) break
    await new Promise((r) => setTimeout(r, 100))
  }
}

export function resetWorkerForTests(): void {
  stopped = true
  ticking = false
  activeByType.clear()
}
