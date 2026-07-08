import { prisma } from '@/lib/db'
import { BROKEN_LINK_VERIFY_JOB_TYPE } from '@/lib/jobs/handlers/broken-link-verify'

export type SeoPhaseState = 'done' | 'running' | 'queued' | 'failed' | 'unavailable'

export interface SeoPhase {
  state: SeoPhaseState
  progress: number | null
  message: string | null
}

type VerifyJob = { status: string; progress: number | null; progressMessage: string | null }

/** Pure. liveScanRunId present == SEO phase done, regardless of any Job row. */
export function classifySeoPhase(input: { liveScanRunId: string | null; job: VerifyJob | null }): SeoPhase {
  if (input.liveScanRunId) return { state: 'done', progress: null, message: null }
  const job = input.job
  if (!job) return { state: 'unavailable', progress: null, message: null }
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

/** Convenience for callers without a preloaded run id. */
export async function getSeoPhase(siteAuditId: string): Promise<SeoPhase> {
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
    select: { id: true },
  })
  if (run) return { state: 'done', progress: null, message: null }
  return classifySeoPhase({ liveScanRunId: null, job: await getLatestSeoVerifyJob(siteAuditId) })
}
