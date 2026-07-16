import { prisma } from '@/lib/db'
import { BROKEN_LINK_VERIFY_JOB_TYPE } from '@/lib/jobs/handlers/broken-link-verify'
import { isPlaceholderRun } from '@/lib/findings/exhausted-placeholder'

export type SeoPhaseState = 'done' | 'running' | 'queued' | 'failed' | 'unavailable'

export interface SeoPhase {
  state: SeoPhaseState
  progress: number | null
  message: string | null
}

type VerifyJob = { status: string; progress: number | null; progressMessage: string | null }

// C17 (plan Codex fix #1): the finalizer enqueues broken-link-verify
// fire-and-forget AFTER the complete flip, and a crashed enqueue is
// re-created by recoverBrokenLinkVerifies (boot + the 10-min
// stale-audit-reset tick). Within this window a missing job means
// "not enqueued yet", not "never ran" — classify queued, keep pollers alive.
export const SEO_PHASE_ENQUEUE_GRACE_MS = 12 * 60_000

/** Pure. liveScanRunId present == SEO phase done, regardless of any Job row. */
export function classifySeoPhase(input: {
  liveScanRunId: string | null
  job: VerifyJob | null
  completedAt?: Date | null
  now?: Date
}): SeoPhase {
  if (input.liveScanRunId) return { state: 'done', progress: null, message: null }
  const job = input.job
  if (!job) {
    const completedAt = input.completedAt ?? null
    const now = input.now ?? new Date()
    if (completedAt && now.getTime() - completedAt.getTime() < SEO_PHASE_ENQUEUE_GRACE_MS) {
      return { state: 'queued', progress: null, message: null }
    }
    return { state: 'unavailable', progress: null, message: null }
  }
  switch (job.status) {
    case 'running':
      return { state: 'running', progress: job.progress, message: job.progressMessage }
    case 'queued':
      return { state: 'queued', progress: null, message: null }
    case 'error':
      return { state: 'failed', progress: null, message: null }
    // 'complete' with no run is anomalous (builder always writes a run, even
    // empty-harvest); 'cancelled' likewise -> not done.
    default:
      return { state: 'unavailable', progress: null, message: null }
  }
}

/** The latest broken-link-verify job for this audit (job-only; callers already
 *  know the live-scan run id and pass it to classifySeoPhase). */
export async function getLatestSeoVerifyJob(siteAuditId: string): Promise<VerifyJob | null> {
  return prisma.job.findFirst({
    where: { type: BROKEN_LINK_VERIFY_JOB_TYPE, groupKey: `site-audit:${siteAuditId}` },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // id tiebreaker → deterministic on same-ms rows
    select: { status: true, progress: true, progressMessage: true },
  })
}

/** Convenience for callers without a preloaded run id. An exhausted-verifier
 * placeholder run must NOT read as done (it means "SEO analysis unavailable"). */
export async function getSeoPhase(siteAuditId: string, completedAt?: Date | null): Promise<SeoPhase> {
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
    select: { id: true, source: true },
  })
  if (run && !isPlaceholderRun(run)) return { state: 'done', progress: null, message: null }
  return classifySeoPhase({ liveScanRunId: null, job: await getLatestSeoVerifyJob(siteAuditId), completedAt })
}
