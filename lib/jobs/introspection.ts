// lib/jobs/introspection.ts
//
// Read-only queue state for the future /admin/ops page (roadmap A4) and
// debugging. No UI in this phase.

import { prisma } from '@/lib/db'

export interface JobQueueState {
  counts: Record<string, Record<string, number>> // type → status → count
  oldestRunning: { id: string; type: string; startedAt: Date | null } | null
  recentFailures: Array<{ id: string; type: string; lastError: string | null; completedAt: Date | null }>
}

export async function getJobQueueState(): Promise<JobQueueState> {
  const grouped = await prisma.job.groupBy({
    by: ['type', 'status'],
    _count: { _all: true },
  })
  const counts: Record<string, Record<string, number>> = {}
  for (const row of grouped) {
    counts[row.type] = counts[row.type] ?? {}
    counts[row.type][row.status] = row._count._all
  }
  const oldestRunning = await prisma.job.findFirst({
    where: { status: 'running' },
    orderBy: { startedAt: 'asc' },
    select: { id: true, type: true, startedAt: true },
  })
  const recentFailures = await prisma.job.findMany({
    where: { status: 'error' },
    orderBy: { completedAt: 'desc' },
    take: 10,
    select: { id: true, type: true, lastError: true, completedAt: true },
  })
  return { counts, oldestRunning, recentFailures }
}
