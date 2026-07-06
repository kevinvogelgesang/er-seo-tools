// lib/ops/ops-snapshot.ts
//
// A4 observability — the /admin/ops data loader. Each panel loads independently;
// a throwing loader degrades to { ok: false } (and is logged) instead of blanking
// the page, because /admin/ops is most needed WHILE things are failing.
import { getJobQueueState, getCleanupStats, type JobQueueState, type CleanupStat } from '@/lib/jobs/introspection'
import { type HealthSignals } from '@/lib/ops/health-check'
import { computeHealthAlerts } from '@/lib/ops/health-summary'
import { getDiskFree } from '@/lib/ops/disk'
import { getDbSizeBytes, resolveDbPath } from '@/lib/ops/db-size'
import { getPoolState } from '@/lib/ada-audit/browser-pool'
import { logError } from '@/lib/log'
import path from 'path'

export type Section<T> = { ok: true; data: T } | { ok: false }

export interface HealthPanel {
  signals: HealthSignals
  degraded: boolean
}

export interface OpsSnapshot {
  queue: Section<JobQueueState>
  cleanup: Section<CleanupStat[]>
  health: Section<HealthPanel>
  disk: Section<number | null>
  dbSize: Section<number | null>
  pool: Section<ReturnType<typeof getPoolState>>
}

async function section<T>(name: string, fn: () => Promise<T> | T): Promise<Section<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    // A failed panel degrades to { ok:false } AND is logged, so the page still
    // renders while the failure is captured for the ops log.
    logError({ scope: 'ops-snapshot', section: name }, err)
    return { ok: false }
  }
}

export async function loadOpsSnapshot(): Promise<OpsSnapshot> {
  // Disk is measured on the DB's data volume; fall back to cwd if unresolved.
  const dbPath = resolveDbPath(process.env.DATABASE_URL)
  const dataDir = dbPath ? path.dirname(dbPath) : process.cwd()

  const [queue, cleanup, health, disk, dbSize, pool] = await Promise.all([
    section('queue', () => getJobQueueState()),
    section('cleanup', () => getCleanupStats()),
    section('health', async () => {
      const { signals, alerts } = await computeHealthAlerts(new Date())
      return { signals, degraded: alerts.length > 0 }
    }),
    section('disk', () => getDiskFree(dataDir)),
    section('dbSize', () => getDbSizeBytes()),
    section('pool', () => getPoolState()),
  ])

  return { queue, cleanup, health, disk, dbSize, pool }
}
